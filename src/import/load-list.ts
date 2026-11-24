import ExcelJS from 'exceljs';
import {checkZip} from './guard';
import {type DrumOption,defaultDrum,Drum} from '../store/schema';
import {COLUMNS,INPUT_COLS,clip,emptyRow,isBlankRow,listOptions,type InputCol,type SheetRow} from '../engine/sheet';
import {parseDelimited} from './parse';

export const normalize=(value:string)=>value.toLowerCase().replace(/²/g,'2').replace(/[^a-z0-9]/g,'');
// A merged range, 0-based and inclusive. Excel keeps the value in the top-left cell only; rows repeat it in every cell it covers.
export type Merge={top:number;left:number;bottom:number;right:number};
export type InputTable={name:string;rows:string[][];formulaCells:number;merges?:Merge[]};
export async function readTables(file:File):Promise<InputTable[]> {
 if(!file.size||file.size>25*1024*1024)throw Error('Choose a non-empty file up to 25 MB.');
 const ext=file.name.split('.').pop()?.toLowerCase();
 if(['csv','tsv','txt'].includes(ext??''))return [{name:file.name,rows:parseDelimited(await file.text()),formulaCells:0}];
 if(ext!=='xlsx')throw Error('Use an XLSX, CSV or tab-delimited TXT file.');
 const bytes=await file.arrayBuffer();checkZip(bytes);const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
 if(book.worksheets.length>30)throw Error('Workbook exceeds 30 worksheets.');
 return book.worksheets.map(sheet=>{
  // exceljs recounts every row each time columnCount is read, so read both counts once (a 3,000-row sheet took seconds).
  const rowCount=sheet.rowCount,columnCount=sheet.columnCount;
  if(rowCount>10000||columnCount>200)throw Error(`${sheet.name} exceeds 10,000 rows or 200 columns.`);
  let formulaCells=0;
  const rows:string[][]=[],merges=new Map<string,Merge>();
  for(let rowIndex=1;rowIndex<=rowCount;rowIndex++) {
   const row=sheet.getRow(rowIndex),values:string[]=[];
   for(let col=1;col<=columnCount;col++) {
    const cell=row.getCell(col),v=cell.value,m=cell.master.fullAddress,copy=m.row!==rowIndex||m.col!==col;
    if(copy){const s=merges.get(m.address);if(s){s.bottom=Math.max(s.bottom,rowIndex-1);s.right=Math.max(s.right,col-1);}else merges.set(m.address,{top:m.row-1,left:m.col-1,bottom:rowIndex-1,right:col-1});}
    // Load lists often calculate kW or current with formulas, so the saved result is what the engineer sees.
    if(v&&typeof v==='object'&&('formula' in v||'sharedFormula' in v)){if(!copy)formulaCells++;const r=v.result;values.push(typeof r==='number'||typeof r==='string'?String(r):'');}
    else if(v&&typeof v==='object'&&'richText' in v)values.push(v.richText.map(t=>t.text).join(''));
    else if(v&&typeof v==='object'&&'hyperlink' in v)values.push(typeof v.text==='string'?v.text:'');
    else if(typeof v==='boolean')values.push(v?'TRUE':'FALSE');
    else values.push(typeof v==='string'||typeof v==='number'?String(v):'');
   }
   rows.push(values);
  }
  return merges.size?{name:sheet.name,rows,formulaCells,merges:[...merges.values()]}:{name:sheet.name,rows,formulaCells};
 });
}
// The rows of a table as Excel shows them, for reading items under its heading (headings are read from the rows as they are,
// where a merged heading names every column it covers). A value merged across columns belongs to its first column only;
// merged down rows it stands for each row (a brand or duty shared by several items). A row with no value of its own is the
// second line of the item above, and a row holding only a title merged across three or more columns is a section heading:
// both come back blank.
export function itemRows(t:InputTable):string[][] {
 const merges=t.merges??[];if(!merges.length)return t.rows;
 const rows=t.rows.map(r=>[...r]),own=t.rows.map(r=>r.map(v=>!!v.trim()));
 for(const m of merges)for(let r=m.top;r<=m.bottom;r++){const row=rows[r],mine=own[r];if(!row||!mine)continue;
  for(let c=m.left;c<=m.right;c++){if(r===m.top&&c===m.left)continue;mine[c]=false;if(c>m.left)row[c]='';}}
 return rows.map((r,i)=>{
  const filled=r.flatMap((v,c)=>v.trim()?[c]:[]);
  const heading=filled.length===1&&merges.some(m=>m.top<=i&&i<=m.bottom&&m.left===filled[0]&&m.right-m.left>=2);
  return !own[i]!.some(Boolean)||heading?r.map(()=>''):r;
 });
}
// A heading merged across columns stands for one field: it is read from whichever covered column holds the values.
export function valueColumns<K extends string>(map:Partial<Record<K,number>>,t:InputTable,header:number,body:readonly string[][]=itemRows(t)):Partial<Record<K,number>> {
 const out={...map},used=new Set(Object.values(map).filter((c):c is number=>typeof c==='number'));
 const filled=(c:number)=>{let n=0;for(let r=header+1;r<body.length;r++)if(body[r]?.[c]?.trim())n++;return n;};
 for(const k of Object.keys(out) as K[]){
  const c=out[k]!,m=t.merges?.find(m=>m.top<=header&&header<=m.bottom&&m.left<=c&&c<=m.right&&m.right>m.left);if(!m)continue;
  let best=c,most=filled(c);for(let j=m.left;j<=m.right;j++)if(j!==c&&!used.has(j)){const n=filled(j);if(n>most){best=j;most=n;}}
  used.delete(c);used.add(best);out[k]=best;
 }
 return out;
}
export const DRUM_TEMPLATE='Code,Manufacturer,Flange mm,Barrel mm,Width mm,Payload kg,Tare kg,Lift limit kg,Clearance mm,Fill factor,Capacity m,Rated cable OD mm,Source\n';
export function parseDrumOptions(table:InputTable):DrumOption[] {
 const headers=table.rows[0]?.map(normalize)??[];
 const get=(row:string[],names:string[])=>{const i=headers.findIndex(h=>names.includes(h));return i<0?'':(row[i]??'').trim();};
 const options:DrumOption[]=[];
 for(const [i,row] of table.rows.slice(1).entries()) {
  if(!row.some(v=>v.trim()))continue;
  const code=get(row,['code','drumcode','model']);
  const num=(names:string[],fallback?:number)=>{const raw=get(row,names);return raw?Number(raw):fallback??NaN;};
  const drum={...defaultDrum,flangeMm:num(['flangemm','flangediametermm']),barrelMm:num(['barrelmm','barreldiametermm']),widthMm:num(['widthmm','windingwidthmm']),maxLoadKg:num(['payloadkg','maxloadkg']),tareKg:num(['tarekg','emptyweightkg']),liftLimitKg:num(['liftlimitkg'],2000),clearanceMm:num(['clearancemm'],25),fillFactor:num(['fillfactor'],.9),overrideM:num(['capacitym'],0)};
  const od=num(['ratedcableodmm']);
  if(!code||!Drum.safeParse(drum).success||drum.flangeMm<=drum.barrelMm||drum.liftLimitKg<=drum.tareKg)throw Error(`Drum row ${i+2}: provide code and valid dimensions, payload and tare. Lifting limit must exceed tare.`);
  if(drum.overrideM>0&&(!Number.isFinite(od)||od<=0))throw Error(`Drum row ${i+2}: a supplier capacity needs its rated cable OD.`);
  options.push({id:`supplier-${crypto.randomUUID()}`,code,manufacturer:get(row,['manufacturer','supplier'])||'Supplier to confirm',source:get(row,['source'])||`${table.name}, row ${i+2}`,basis:'supplier',drum,ratedCableOdMm:Number.isFinite(od)&&od>0?od:null});
 }
 if(!options.length||options.length>100)throw Error('Supply between 1 and 100 drum options with the template headers.');
 if(new Set(options.map(o=>o.code)).size!==options.length)throw Error('Drum codes must be unique.');
 return options;
}

// Load-list columns that feed the Cable Sizing sheet. The workbook's own headers always match, so an exported sheet re-imports as is.
// "Load factor" is not diversity: it is operating/rated load for the load balance, and would undersize a single load's cable.
const aliases:Partial<Record<InputCol,string[]>>={B:['transformerkva','transformer','txkva'],C:['from','source','sourceboard','upstream','frompanel','fedfrom','supplyfrom','feederfrom','board','panel'],D:['to','tag','tagno','equipmenttag','loadtag','equipmentno','equipment','destination','topanel','load','loadname','description','circuitdescription','loaddescription','equipmentdescription','circuitname'],
 E:['phase','phases','ph','noofphases','numberofphases'],F:['voltage','voltagev','v','un','unv','nominalvoltage','nominalvoltagev','ratedvoltage','ratedvoltagev','supplyvoltage','operatingvoltage'],G:['ratedinputpowerkw','ratedinputkw','inputpowerkw','kw','loadkw','designkw','ratedkw','powerkw','absorbedkw','connectedloadkw','ratedpowerkw','motorkw','demandkw','ratedoutputkw','consumedloadkw','consumedkw'],
 H:['diversity','diversityfactor','demandfactor','df'],I:['pf','powerfactor','cosphi','cosφ','pfcosphi'],L:['thd','thdi','harmonics'],N:['protectiondeviceratinga','protectiondevicerating','ina','protectiona','breakera','breakerrating','breakerratinga','mccba','mcba','cbratinga','protectiverating','protectiondevicea','tripa','fusea','ratingina','breaker','cb','cba','mcb','mccb','ocpd','ocpda','fuse','ratinga','devicerating','protectivedevicea'],
 O:['cabletype','cableconstruction','construction'],P:['cores','noofcores','corecount'],Q:['method','installationmethod','referencemethod','installation'],R:['airtemp','ambienttemp','ambienttemperature','airtempc'],S:['groundtemp','groundtempc','soiltemp'],U:['grouping','groupedcircuits','noofgroupedcircuits'],W:['soilresistivity','soilthermalresistivity'],
 AC:['cablesize','sizemm2','cablesizemm2','csa','csamm2'],AD:['noofcables','cablesinparallel','parallelcables','noofruns','runs','sets'],AH:['length','lengthm','cablelength','cablelengthm','cablerun','cablerunm','runlength','runlengthm','routelength','distance','distancem','approxlength','approxlengthm','estimatedlength','estimatedlengthm'],AM:['permissiblevd','vdlimit','allowablevd','maxvd'],
 BP:['startertype','starter','typeofstarter','startingmethod','startingtype','starttype','motorstarter']};
const headerKeys=(col:InputCol)=>{const h=COLUMNS.find(c=>c.col===col)?.header??'';return [normalize(h),normalize(h.split('\n')[0]??''),normalize(h.replace(/\(.*?\)/g,'')),...(aliases[col]??[]).map(normalize)];};
export type Mapping=Partial<Record<InputCol,number>>;
export function detectColumns(headers:readonly string[]):Mapping {
 const mapping:Mapping={},used=new Set<number>(),keys=headers.map(normalize);
 // Exact workbook headers first, then aliases in order of preference.
 for(const col of INPUT_COLS){const want=headerKeys(col);for(const k of want){const i=keys.findIndex((h,j)=>h&&h===k&&!used.has(j));if(i>=0){mapping[col]=i;used.add(i);break;}}}
 return mapping;
}
export const mappingAt=(t:InputTable,header:number,body?:readonly string[][]):Mapping=>valueColumns(detectColumns(t.rows[header]??[]),t,header,body);
export function bestHeader(rows:readonly string[][]):number {let best=0,score=0;for(let i=0;i<Math.min(25,rows.length);i++){const n=Object.keys(detectColumns(rows[i]??[])).length;if(n>score){score=n;best=i;}}return best;}
// Starter words seen in load lists, by the sheet's list entry. "-", N/A or None mean no starter (not a motor).
const STARTER_WORDS:[RegExp,string][]=[[/^(dol|directonline|direct)$/,'DOL'],[/^(stardelta|sd|yd|ydelta|wyedelta|y[δ∆])$/,'Star-delta'],[/^(softstarter|softstart|soft|ss)$/,'Soft starter'],[/^(vfd|vsd|vsdvfd|vfdvsd|inverter|drive|variablefrequencydrive|variablespeeddrive|frequencyconverter)$/,'VFD']];
function cleanStarter(v:string):string {
 const key=(s:string)=>s.toLowerCase().replace(/[\s./\\_-]/g,''),k=key(v),options=listOptions(emptyRow()).BP;// A power feeder (PWR FDR) supplies a board, not a motor: no starting check.
 if(!k||/^(na|none|nil|no|0|pwrfdr|powerfeeder|feeder|fdr)$/.test(k))return '';
 const word=options.find(o=>key(o)===k)??STARTER_WORDS.find(([re])=>re.test(k))?.[1];return word&&options.includes(word)?word:v;
}
function cleanNumber(col:InputCol,raw:string):string {
 const original=raw.trim();let v=original.replace(/\s+/g,' ');if(!v)return '';
 if(col==='BP')return cleanStarter(original);
 if(col==='E'){const t=v.toLowerCase().replace(/[\s-]/g,'');if(/^(3|3p|3ph|3phase|three|threephase|tp|tpn|3φ)$/.test(t))return '3';if(/^(1|1p|1ph|1phase|single|singlephase|sp|spn|1φ)$/.test(t))return '1';return original;}
 // Keep ambiguous or malformed values visible for correction; never take just the first number.
 const match=v.match(/^([+-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(.*?)$/i);if(!match)return original;
 let numeric=match[1]??'',unit=(match[2]??'').toLowerCase().replace(/[\s·.°²]/g,c=>c==='²'?'2':'');
 if(/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(numeric))numeric=numeric.replace(/,/g,'');else if(/^[+-]?\d+,\d+$/.test(numeric))numeric=numeric.replace(',','.');else if(numeric.includes(','))return original;
 const units:Partial<Record<InputCol,Record<string,number>>>={B:{kva:1},F:{v:1,kv:1000},G:{kw:1,w:.001},N:{a:1},AC:{mm2:1},AH:{m:1,km:1000,mm:.001},R:{c:1},S:{c:1},W:{'km/w':1},AM:{'%':1},H:{'%':.01},I:{'%':.01},L:{'%':.01}};
 if(unit&&units[col]?.[unit]===undefined)return original;
 const n=Number(numeric)*(unit?units[col]?.[unit]??1:1);return Number.isFinite(n)?String(n):original;
}
// Matches typed names to the workbook's dropdown entries ("4" or "4 core" → "4C", "e" → the only method E).
function cleanChoice(col:'O'|'P'|'Q',raw:string,row:SheetRow):string {
 const v=raw.trim();if(!v)return '';const options=listOptions(row)[col],key=(s:string)=>s.toLowerCase().replace(/\s+/g,'');
 const exact=options.find(o=>key(o)===key(v));if(exact)return exact;
 if(col==='P'){const n=v.match(/^(\d+)\s*(c|core|cores)?$/i);if(n&&options.includes(`${n[1]}C`))return `${n[1]}C`;}
 if(col==='Q'){const starts=options.filter(o=>key(o).startsWith(key(v)));if(starts.length===1)return starts[0]!;}
 return v;
}
export function toSheetRows(rows:readonly string[][],header:number,mapping:Mapping):SheetRow[] {
 const out:SheetRow[]=[];
 for(const values of rows.slice(header+1)){
  const row=emptyRow();
  for(const col of INPUT_COLS){const i=mapping[col];if(i===undefined)continue;const raw=(values[i]??'').trim();if(col==='O'||col==='P'||col==='Q')continue;row[col]=clip(['C','D'].includes(col)?raw:cleanNumber(col,raw));}
  for(const col of ['O','P','Q'] as const){const i=mapping[col];if(i!==undefined)row[col]=clip(cleanChoice(col,values[i]??'',row));}
  // Rows without a load or a tag are headings, totals or spacer rows in most load lists.
  if(isBlankRow(row)||!row.G&&!row.D)continue;
  out.push(row);
 }
 if(out.length>2000)throw Error('Limit a load list to 2,000 rows.');
 return out;
}
// Pasted cells get the same clean-up as imported ones.
export const cleanValue=(col:InputCol,raw:string,row:SheetRow):string=>clip(col==='O'||col==='P'||col==='Q'?cleanChoice(col,raw,row):col==='C'||col==='D'?raw.trim():cleanNumber(col,raw));
