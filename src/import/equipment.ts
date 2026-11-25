import {clip,emptyRow,type SheetRow} from '../engine/sheet';
import {ID_WORDS,LOAD_NOUNS,fieldsIn,loadsIn} from './vocabulary';
import {DUTIES,FROM_CATALOGUE,LOAD_KEYS,TICK,TICK_KEYS,emptyEntry,emptyLoad,fillRow,indexCatalogue,isTick,num,sameText,
 DEFAULT_FACTORS,DEFAULT_MARGIN,type CatalogueIndex,type CatalogueKey,type CatalogueRow,type Duty,type Factors,type LoadKey} from '../engine/loads';
import type {LoadPanel,PageEvidence} from '../store/schema';
import type {EquipmentType,Param} from '../engine/equipment-types';
import {cleanValue,itemRows,normalize,valueColumns,type InputTable} from './load-list';
import type {PositionedLine} from './parse';

// Header words for each equipment-list and catalogue column, tried in this order; each column takes the first unused match.
// Remarks are read only as a catalogue entry's source note. kwC, kwI and kwS: a load listed under the duty it runs at.
type HeadKey=LoadKey|'remarks'|'kwC'|'kwI'|'kwS';
const HEADS:[HeadKey,RegExp][]=[
 ['kks',/kks|kss|^tag|equipmenttag|tagnumber|equipment(no|number|id)|plantid|asset(no|number|id)/],
 ['description',/description|^(equipment|item|load|loadname|name|consumers?|consumername|feeder|feedername|circuit|equipmentname)$/],
 ['brand',/brand|^make$|manufacturer|vendor|supplier/],['model',/model|partn(o|umber)|articleno|ordercode|catalog(ue)?no/],['config',/config|variant/],
 ['nonEssential',/nonessential/],['essential',/essential/],['vital',/vital/],['restart',/restart/],['starter',/starter/],
 ['cis',/cis$|^ci$|equipmentci$|^duty|^(mode|operatingmode|operationmode)$/],
 ['kwC',/^(?!.*kvar).*continuous/],['kwI',/^(?!.*kvar).*intermittent/],['kwS',/^(?!.*kvar).*standby/],
 ['consumedKw',/consumed|absorbed|operatingload|runningload|actualload|demandload|^load(kw)?$/],
 ['ratedKw',/rated(input)?power|inputpower|ratedkw|feederrating|ratedoutput|installed(power|load)|connectedload|motorrating|powerrating|^rating(kw)?$/],
 ['protA',/protection|breaker|fuse|mccb|mcb|^cb|^ocpd/],
 ['inA',/^ina?$|nominalcurrent|ratedcurrent|fullloadcurrent|^flc|^fla|^current|loadcurrent|runningcurrent/],
 ['un',/^un$|^un[^a-z]|nominalvoltage|ratedvoltage|^voltage|^volts?$|supplyvoltage|systemvoltage|operatingvoltage|^ue$/],
 ['efficiency',/efficien|^eff|^eta$/],['pf',/powerfactor|cosphi|^pf$|^pf[^a-z]/],
 ['remarks',/remark|comment|note/],
];
// Starting, locked-rotor and inrush values are not running data, whatever else the heading says.
const SKIP=/startingcurrent|lockedrotor|inrush/;
// η and φ carry the meaning of a heading ("η (%)", "cos φ"), so they are spelt out before matching.
const fold=(s:string)=>normalize(s.replace(/η/g,'eta').replace(/[φϕΦ]/g,'phi'));
type Columns=Partial<Record<HeadKey,number>>;
// Headings often stack over a few rows ("CONSUMED" / "LOAD" / "(kW)"): each column's heading nearest the values is read first,
// then its headings together. Long sentences are notes, not headings, and a title repeated across the table (merged) is none.
function columnsIn(rows:readonly string[][],from:number,to:number,skip?:number):Columns {
 const map:Columns={},band:string[][]=[];
 for(let i=Math.max(0,from);i<=to;i++){const r=rows[i]??[];if(heads(r))band.push(r);}
 const width=Math.max(0,...band.map(r=>r.length));
 for(let c=0;c<width;c++){
  if(c===skip)continue;
  const texts=band.map(r=>(r[c]??'').trim()).filter(Boolean),own=fold(texts.at(-1)??''),tall=fold([...new Set(texts.filter(x=>x.length<=40))].join(' '));
  if(SKIP.test(tall))continue;
  const free=HEADS.filter(([k])=>map[k]===undefined);
  const hit=(own&&free.find(([,re])=>re.test(own)))||(tall&&free.find(([,re])=>re.test(tall)));if(hit)map[hit[0]]=c;
 }
 return map;
}
function bestHeader(rows:readonly string[][]):number {let best=-1,score=0;for(let i=0;i<Math.min(40,rows.length);i++){const n=Object.keys(columnsIn(rows,i,i)).length;if(n>score){score=n;best=i;}}return best;}
// The S/N column numbers the items ("1", "2", "4.1", "A-3"): a row with a number there is an item; headings, totals, notes and
// spacer rows have none. Its heading row and the first numbered row bound the headings above the list.
const SERIAL_HEAD=/^(sn|sno|snos|srno|slno|serialno|serialnumber|no|nos|itemno|item|sr|sl)$/;
const SERIAL=/^\(?[a-z]{0,3}[-.]?\d{1,4}(?:\.\d{1,3})*[.)]?$/i;
const serialKey=(v:string)=>v.trim().replace(/^\(|[.)]$/g,'');
// A row of plain column numbers under the headings ("1  2  3  4 …") is no item.
const numbering=(r:readonly string[])=>{const v=r.map(x=>x.trim()).filter(Boolean);return v.length>=3&&v.every(x=>/^\d+$/.test(x));};
// A row that can hold headings: not blank, not column numbers, not one title repeated across the table (merged).
function heads(r:readonly string[]):boolean {const v=r.map(x=>x.trim()).filter(Boolean);return !!v.length&&(v.length<3||new Set(v).size>1)&&!numbering(r);}
type Serial={col:number;head:number;first:number};
function serialColumn(rows:readonly string[][],body:readonly string[][]):Serial|null {
 let best:(Serial&{n:number})|null=null;
 for(let r=0;r<Math.min(40,rows.length);r++)(rows[r]??[]).forEach((v,c)=>{
  if(v.trim()!=='#'&&!SERIAL_HEAD.test(fold(v)))return;
  const first=body.findIndex((x,i)=>i>r&&i<=r+10&&SERIAL.test((x[c]??'').trim())&&!numbering(x));if(first<0)return;
  // The numbers must mostly count up by one, or the column holds codes ("Item No." as a part number).
  const nums=body.slice(first).filter(x=>!numbering(x)).map(x=>(x[c]??'').trim()).filter((x,i,a)=>SERIAL.test(x)&&x!==a[i-1]);
  const tails=nums.map(x=>Number(/(\d+)\D*$/.exec(x)?.[1]));let steps=0;for(let i=1;i<tails.length;i++)if(tails[i]===tails[i-1]!+1)steps++;
  if(nums.length>1&&steps*2<nums.length-1)return;
  if(!best||nums.length>best.n)best={col:c,head:r,first,n:nums.length};
 });
 return best;
}
const KW={C:'kwC',I:'kwI',S:'kwS'} as const;
// Duty as written: C, I, S or the words.
const dutyOf=(v:string)=>{const d=v.trim().toLowerCase();return /^c(ont\w*)?$/.test(d)?'C':/^i(nt\w*)?$/.test(d)?'I':/^s(tand\W?by|tby|b)?$/.test(d)?'S':v.trim();};
const TOTAL=/^(?:sub[\s-]*)?total\b|\bgrand\s+total\b/i;
// The workbook's room summary block: operating factor per duty and the design margin.
function readFactors(rows:readonly string[][]):{factors:Factors;margin:string} {
 const factors={...DEFAULT_FACTORS};let margin=DEFAULT_MARGIN;
 rows.forEach((r,i)=>{
  const d=r.findIndex(v=>/^duty$/i.test(v.trim())),f=r.findIndex(v=>/^factor$/i.test(v.trim()));
  if(d>=0&&f>=0)for(const x of rows.slice(i+1,i+4)){const duty=(x[d]??'').trim().toUpperCase(),v=(x[f]??'').trim();if((DUTIES as readonly string[]).includes(duty)&&num(v)!==null)factors[duty as Duty]=v;}
  const operating=r.findIndex(v=>/^operating factors$/i.test(v.trim()));
  if(operating>=0)for(const x of rows.slice(i+1,i+4)){const duty=(x[operating]??'').trim().toUpperCase(),v=(x[operating+1]??'').trim();if((DUTIES as readonly string[]).includes(duty)&&num(v)!==null)factors[duty as Duty]=v;}
  const m=r.findIndex(v=>/^design margin$/i.test(v.trim()));if(m>=0){const v=r.slice(m+1).find(x=>num(x)!==null);if(v)margin=v.trim();}
 });
 return {factors,margin};
}
export type EquipmentRead={panels:LoadPanel[];catalogue:CatalogueRow[];notes:string[]};
// A workbook of equipment lists, one sheet per panel, and brand catalogues: sheets named "Brand (Name)" or with a Model column but no Description.
// A sheet with an S/N column is read item by item from its numbered rows; one without falls back to rows that name an item.
export function readEquipment(tables:readonly InputTable[],file:string):EquipmentRead {
 const panels:LoadPanel[]=[],catalogue:CatalogueRow[]=[],notes:string[]=[];
 for(const t of tables){
  const body=itemRows(t),sn=serialColumn(t.rows,body);let h=sn?sn.first-1:bestHeader(t.rows);if(h<0)continue;
  // The headings end at the last heading row above the first item, not at a section title or a row of column numbers.
  if(sn)while(h>sn.head&&!heads(t.rows[h]??[]))h--;
  const top=sn?sn.head-3:h-4,cols=valueColumns(columnsIn(t.rows,top,h,sn?.col),t,h,body),cell=(r:readonly string[],k:HeadKey)=>{const i=cols[k];return i===undefined?'':clip((r[i]??'').trim());};
  // Headings merged over two rows, or repeated for printing, come back as rows that repeat the heading: not items.
  const heading=(r:readonly string[],k:HeadKey)=>normalize(cell(r,k))===normalize(cell(t.rows[h]!,k));
  const brandSheet=/^brand\s*\((.+)\)\s*$/i.exec(t.name)?.[1]?.trim();
  if(brandSheet!==undefined||cols.model!==undefined&&(cols.description===undefined||/catalog/i.test(t.name))){
   body.slice(h+1).forEach((r,j)=>{const model=cell(r,'model');if(!model||heading(r,'model')||numbering(r))return;const e=emptyEntry(),remarks=cell(r,'remarks');
    e.brand=clip(brandSheet??cell(r,'brand'));e.model=model;for(const k of ['config',...FROM_CATALOGUE] as const)e[k]=cell(r,k);
    // A model with no brand and nothing to fill is a label on a summary sheet, not a catalogue entry.
    if(!e.brand&&!e.config&&FROM_CATALOGUE.every(k=>!e[k]))return;
    // The sheet's remarks name the data source; otherwise the file and row do.
    e.source=remarks||clip(`${file} · ${t.name} row ${h+j+2}`);catalogue.push(e);});
   continue;
  }
  // The template's panel summary lists boards, not equipment.
  if(cols.description===undefined||Object.keys(cols).length<4||t.rows.slice(Math.max(0,top),h+1).some(r=>/distribution\s*boards?/i.test(r[cols.description!]??'')))continue;
  // Everything from the panel's "Normal Running Plant Load" summary down is totals and notes.
  const found=t.rows.findIndex((r,j)=>j>h&&/normal\s+running/i.test(r.join(' '))),end=found<0?body.length:found;
  let source=body.slice(h+1,end);
  if(sn){
   // A number merged down two rows is one item written on two lines: the second line fills what the first left blank.
   const goesOn=(i:number)=>!!t.merges?.some(m=>m.left<=sn.col&&sn.col<=m.right&&m.top<i&&i<=m.bottom);
   const picked:{r:string[];key:string}[]=[];
   for(let i=sn.first;i<end;i++){const r=body[i]!,v=(r[sn.col]??'').trim(),last=picked.at(-1);if(!SERIAL.test(v)||numbering(r))continue;
    if(last&&goesOn(i)){r.forEach((x,c)=>{if(x.trim()&&!last.r[c]?.trim())last.r[c]=x;});continue;}
    picked.push({r:[...r],key:serialKey(v)});}
   // "4" over "4.1" and "4.2" titles a group: the numbered sub-items are the items.
   source=picked.filter((p,k)=>!picked[k+1]?.key.startsWith(`${p.key}.`)).map(p=>p.r);
  }
  const rows=source.flatMap(r=>{const d=cell(r,'description');if(!d&&!(sn&&cell(r,'kks'))||TOTAL.test(d)||d&&heading(r,'description'))return [];const row=emptyLoad();
   for(const k of LOAD_KEYS)row[k]=cell(r,k);for(const k of TICK_KEYS)row[k]=isTick(row[k])?TICK:'';row.cis=dutyOf(row.cis);
   // A list that shows duty by the column its load is entered in (Continuous / Intermittent / Standby kW).
   if(!/^[CIS]$/.test(row.cis)){const at=(['C','I','S'] as const).filter(d=>num(cell(r,KW[d]))!==null);if(at.length===1){const d=at[0]!;row.cis=d;row.consumedKw||=cell(r,KW[d]);}}
   return [row];});
  if(!rows.length)continue;
  if(rows.length>500)throw Error(`${t.name} lists more than 500 items. Split it over two sheets.`);
  const name=t.name.trim().slice(0,60)||`Panel ${panels.length+1}`;
  // A KKS names one item: the same KKS twice usually means the column read as KKS holds something else (a model).
  const count=new Map<string,number>();for(const r of rows){const k=r.kks.toLowerCase();if(k)count.set(k,(count.get(k)??0)+1);}
  const twice=[...count].filter(([,n])=>n>1).map(([k])=>rows.find(r=>r.kks.toLowerCase()===k)!.kks);
  if(twice.length)notes.push(`${name}: KKS ${twice.slice(0,5).join(', ')}${twice.length>5?'…':''} ${twice.length===1?'is':'are'} on more than one item. Check the KKS column.`);
  panels.push({name,rows,...readFactors(t.rows)});
 }
 // A search or summary sheet repeats rows from two or more room sheets: skip it rather than count the equipment twice.
 const keyOf=(r:object)=>JSON.stringify(r),homes=panels.map(p=>new Set(p.rows.map(keyOf)));
 const views=panels.filter((p,i)=>{const from=new Set<number>();for(const r of p.rows){const k=keyOf(r),at=homes.findIndex((s,j)=>j!==i&&s.has(k));if(at<0)return false;from.add(at);}return from.size>=2;});
 if(views.length)notes.push(`${views.map(v=>v.name).join(', ')} repeat${views.length===1?'s':''} items from other sheets and ${views.length===1?'was':'were'} skipped.`);
 const kept=panels.filter(p=>!views.includes(p)),cat=mergeCatalogue([],catalogue).catalogue;
 if(kept.length>50)throw Error('A load list supports at most 50 panels.');
 // Values the workbook looked up from its catalogue stay blank here, so the catalogue keeps supplying them.
 const idx=indexCatalogue(cat);
 for(const p of kept)p.rows=p.rows.map(r=>{const probe={...r};for(const k of FROM_CATALOGUE)probe[k]='';const f=fillRow(probe,idx).row,out={...r};for(const k of FROM_CATALOGUE)if(out[k]&&sameText(out[k],f[k]))out[k]='';return out;});
 if(!kept.length&&!cat.length)throw Error('No equipment list or brand catalogue found. An equipment list needs a Description column; a catalogue needs a Model column.');
 return {panels:kept,catalogue:cat,notes};
}
const entryKey=(e:CatalogueRow)=>[e.brand,e.model,e.config].map(v=>v.trim().toLowerCase()).join('\u0000');
// New entries replace ones with the same brand, model and configuration.
export function mergeCatalogue(current:readonly CatalogueRow[],incoming:readonly CatalogueRow[]):{catalogue:CatalogueRow[];added:number;replaced:number} {
 const out=[...current],at=new Map(out.map((e,i)=>[entryKey(e),i]));let added=0,replaced=0;
 for(const e of incoming){const k=entryKey(e),i=at.get(k);if(i===undefined){at.set(k,out.length);out.push(e);added++;}else{out[i]=e;replaced++;}}
 if(out.length>5000)throw Error('The catalogue holds at most 5,000 entries.');
 return {catalogue:out,added,replaced};
}
// Imported panels replace panels of the same name; the rest are added.
export function mergePanels(current:readonly LoadPanel[],incoming:readonly LoadPanel[]):{panels:LoadPanel[];added:number;replaced:number} {
 const out=[...current];let added=0,replaced=0;
 for(const p of incoming){const i=out.findIndex(o=>sameText(o.name,p.name));if(i<0){out.push(p);added++;}else{out[i]=p;replaced++;}}
 if(out.length>50)throw Error('A load list supports at most 50 panels.');
 return {panels:out,added,replaced};
}

// Load list to cable sizing: From = panel, To = description, Design Load = rated input power.
const volts=(t:string)=>{const m=t.trim().match(/^(\d+(?:\.\d+)?)$/)??t.match(/(\d+(?:\.\d+)?)\s*(k?)v/i);return m?Number(m[1])*(m[2]?.toLowerCase()==='k'?1000:1):null;};
function phasesOf(text:string,v:number|null):string {
 if(/\b3\s*-?\s*(?:phase|ph)\b|three[\s-]*phase|\b3\s*~/i.test(text))return '3';if(/\b1\s*-?\s*(?:phase|ph)\b|single[\s-]*phase|\b1\s*~/i.test(text))return '1';
 // LV three-phase systems run at 380–1000 V, single-phase at 220–240 V; anything else is left for the engineer.
 return v===null?'':v>=380&&v<=1000?'3':v>=220&&v<=240?'1':'';
}
export function toSizing(panels:readonly LoadPanel[],idx:CatalogueIndex):SheetRow[] {
 const out:SheetRow[]=[];
 for(const p of panels)for(const raw of p.rows){
  if(!raw.description.trim())continue;const r=fillRow(raw,idx).row,row=emptyRow(),text=`${r.config} ${r.un}`,dc=/\bv?dc\b|vdc/i.test(text);
  const v=dc?null:volts(r.un)??volts(r.config);
  row.C=clip(p.name.trim());row.D=r.description.trim();if(v!==null)row.F=String(v);row.E=dc?'':phasesOf(text,v);
  row.G=cleanValue('G',r.ratedKw,row);row.I=cleanValue('I',r.pf,row);row.N=cleanValue('N',r.protA,row);row.BP=cleanValue('BP',r.starter,row);
  out.push(row);
 }
 return out;
}
const SENT=['C','D','E','F','G','I','N','BP'] as const;
// Re-sending updates the rows sent before and adds new ones; it never deletes a row or clears a value typed on the sizing sheet.
// Rows with the same From and To are separate items (two pumps): the second such load updates the second such sizing row.
export function mergeSizing(existing:readonly SheetRow[],incoming:readonly SheetRow[]):{rows:SheetRow[];added:number;updated:number} {
 const k=(r:SheetRow)=>`${r.C.trim().toLowerCase()}\u0000${r.D.trim().toLowerCase()}`,slots=new Map<string,number[]>();
 existing.forEach((r,i)=>{const list=slots.get(k(r));if(list)list.push(i);else slots.set(k(r),[i]);});
 const rows=[...existing],seen=new Map<string,number>();let added=0,updated=0;
 for(const r of incoming){
  const key=k(r),n=seen.get(key)??0,at=slots.get(key)?.[n];seen.set(key,n+1);
  if(at===undefined){rows.push(r);added++;continue;}
  const next={...rows[at]!};let changed=false;for(const c of SENT)if(r[c].trim()&&next[c]!==r[c]){next[c]=r[c];changed=true;}
  if(changed){rows[at]=next;updated++;}
 }
 return {rows,added,updated};
}

// Datasheet PDFs and scans: labelled values only, each proposal checked against the page text before anyone accepts it.
// boxes: where each value is printed on its page (PDF points), for showing it in the review.
export type Box={key:CatalogueKey;x0:number;x1:number;y:number;h:number};
// note: why In and Un are flagged when a row's values do not work out to its voltage.
// typeGuess: two of the picked equipment types fit the row equally well, so its type is for the engineer to choose.
// doubt: the parameters (by key) whose values do not add up with each other, and the sums worked out (checks.ts).
export type Proposal={entry:CatalogueRow;page:number;evidence:string;unverified:CatalogueKey[];include:boolean;boxes?:Box[];note?:string;typeGuess?:boolean;doubt?:{keys:string[];why:string}};
const takes=(t:EquipmentType)=>new Set(t.params.map(p=>p.feeds).filter(Boolean));
// Rows read from a catalogue the user said covers these equipment types, each holding only its ticked parameters. Every row
// takes the type whose load list columns best match the values found on it: a value the type takes counts for it, one it
// does not take counts against it. A tie is flagged, and the first type picked is kept until the engineer chooses.
export function applyPick(rows:readonly Proposal[],types:readonly EquipmentType[]):Proposal[] {
 if(!types.length)return [...rows];
 return rows.map(p=>{
  // A reader that read the row for each picked type has already chosen.
  if(p.entry.type&&types.some(t=>t.id===p.entry.type))return p;
  const found=FROM_CATALOGUE.filter(k=>p.entry[k].trim()),score=types.map(t=>{const s=takes(t);return found.reduce((n,k)=>n+(s.has(k)?1:-1),0);});
  const top=Math.max(...score);
  return {...p,entry:{...p.entry,type:types[score.indexOf(top)]!.id},typeGuess:score.filter(s=>s===top).length>1};
 });
}
// What an entry added under an equipment type keeps: the load list values its ticked parameters fill, and the values of its
// ticked catalogue-only parameters. Everything else the reader found is dropped, as the user asked for it to stay empty.
export function keepPicked(e:CatalogueRow,t:EquipmentType|undefined):CatalogueRow {
 if(!t)return e;
 const s=takes(t),out:CatalogueRow={...e,type:t.id};for(const k of FROM_CATALOGUE)if(!s.has(k))out[k]='';
 const extra=Object.fromEntries(t.params.flatMap(p=>{const v=e.extra?.[p.key]?.trim();return !p.feeds&&v?[[p.key,clip(v)]]:[];}));
 if(Object.keys(extra).length)out.extra=extra;else delete out.extra;
 return out;
}
const N='(\\d+(?:[.,]\\d+)?)';
// Between a label and its value: words, or the load point the value is at ("at 3/4 load", "at 100 % load").
const Q=`(?:[^\\n\\d]|[1-8]\\s*\\/\\s*[1-8](?![\\d.,])|\\d{2,3}\\s*%\\s*(?:of\\s+)?(?:rated\\s+|full\\s+)?(?:${LOAD_NOUNS}))`;
const LABELLED:[CatalogueKey,RegExp][]=[
 ['ratedKw',new RegExp(`power\\b${Q}{0,30}${N}\\s*kW\\b`,'giu')],
 ['inA',new RegExp(`(?:rated|nominal|full[\\s-]*load|input)\\s*current\\b${Q}{0,30}${N}\\s*A\\b`,'giu')],
 ['protA',new RegExp(`(?:breaker|fuse|protection|mccb|mcb)\\b${Q}{0,30}${N}\\s*A\\b`,'giu')],
 ['un',new RegExp(`voltage\\b${Q}{0,30}(\\d{2,4})\\s*V`,'giu')],
 ['efficiency',new RegExp(`efficiency\\b${Q}{0,30}${N}`,'giu')],
 ['pf',new RegExp(`(?:power\\s*factor|cos\\s*(?:φ|ϕ|phi|ф)?)${Q}{0,20}(0[.,]\\d+|1(?:[.,]0+)?)(?!\\d)`,'giu')],
];
// The value a label gives at full load: one said to be at full load, else the first that says no load point. Never one at
// part load, nor one whose words between label and value name another parameter ("Efficiency class IE3", "at no load").
function atFullLoad(text:string,re:RegExp):RegExpMatchArray|undefined {
 let first:RegExpMatchArray|undefined;
 for(const m of text.matchAll(re)){
  const between=m[0].slice(0,m[0].lastIndexOf(m[1]!)),f=fieldsIn(between),loads=loadsIn(between);
  if(f.has('skip')||f.has('hz')||f.has('mass')||f.has('ip')||f.has('ie')||loads.length===1&&loads[0]!==1)continue;
  if(loads.length===1)return m;first??=m;
 }
 return first;
}
// Labels that head a model, type, part or order number in running text ("Motor type: …", "Model number …", "Part No. …"),
// from the vocabulary's name and code headings. A label ending in a number word ("Part no", "Article number") may go
// without a colon; a bare one ("Type", "Series") needs one. Words that also head other numbers (an ID, a reference, a
// list's item number) are left out, so a plant tag (KKS) is never taken for a model, and a model holds a digit.
const NUMBERED=/(?:(?:^|\s)(?:no|nr)|number|nummer|numer|code|kod|код|номер|号)$/u;
const PROSE_OFF=new Set(['id','ident','ident no','reference','référence','referencia','referência','item no']);
const altsOf=(ws:readonly string[])=>[...ws].sort((a,b)=>b.length-a.length).map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'[\\s.-]*')).join('|');
const IDS=ID_WORDS.filter(w=>!PROSE_OFF.has(w)),NUMBERED_IDS=altsOf(IDS.filter(w=>NUMBERED.test(w))),PLAIN_IDS=altsOf(IDS.filter(w=>!NUMBERED.test(w)));
const CODE='((?=[A-Z0-9./-]*\\d)[A-Z0-9][A-Z0-9./-]{2,40})';
const MODEL=new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:${NUMBERED_IDS})\\.?|(?:${PLAIN_IDS})\\s*(?:no\\.?|nr\\.?|number|code|#))\\s*[:#.]?\\s*${CODE}|(?<![\\p{L}\\p{N}])(?:${PLAIN_IDS})\\s*[:#：]\\s*${CODE}`,'giu');
export const dot=(v:string)=>v.replace(',','.');
// Decimals throughout: an efficiency of 94.2 (%) is kept as 0.942.
export const asFraction=(v:string)=>{const n=num(dot(v));return n!==null&&n>1&&n<=100?String(+(n/100).toFixed(4)):dot(v);};
// Numbers as written: ranges and dual ratings (19.8-22.5, 115/230) are kept for the engineer to choose.
export const group=(v:string)=>dot(v.replace(/(\d),(\d)/g,'$1.$2')).match(/\d+(?:\.\d+)?(?:\s*(?:[-–/]|\.{2,3}|…)\s*\d+(?:\.\d+)?)*/)?.[0].replace(/\s+/g,'').replace(/–|…|\.{2,3}/g,'-')??'';
// The unit each load list column holds, so a parameter printed in W, kW or hp fills Rated Input Power in kW.
const COLUMN_UNIT:Partial<Record<CatalogueKey,string>>={ratedKw:'kW',inA:'A',protA:'A',un:'V'};
// A parameter as it is read: in the unit of the load list column it fills, else in its own.
export const reading=(p:Param)=>({label:p.label,unit:(p.feeds&&COLUMN_UNIT[p.feeds])||p.unit});
// A value read for a load list column, as the column holds it: the figures as printed, a voltage with V, an efficiency
// or power factor as a fraction of at most 1.
export function inColumn(feed:CatalogueKey,value:string):string {
 const n=group(value);if(!n)return '';
 if(feed==='un')return `${n} V`;
 if(feed!=='efficiency'&&feed!=='pf')return n;
 const f=asFraction(n),x=num(f);return x===null||x>0&&x<=1?f:'';
}
export function catalogueFromPages(pages:readonly PageEvidence[],file:string):Proposal[] {
 const out:Proposal[]=[];
 for(const page of pages){
  const marks=[...page.text.matchAll(MODEL)],starts=marks.length?marks.map(m=>m.index):[0];
  starts.forEach((s,i)=>{
   const block=page.text.slice(s,starts[i+1]??page.text.length),e=emptyEntry(),lines=new Set<string>();
   e.model=clip((marks[i]?.[1]??marks[i]?.[2]??'').trim());
   for(const [k,re] of LABELLED){const m=atFullLoad(block,re);if(!m?.[1])continue;e[k]=k==='efficiency'||k==='pf'?asFraction(m[1]):k==='un'?`${m[1]} V`:dot(m[1]);
    const at=block.lastIndexOf('\n',m.index)+1,end=block.indexOf('\n',m.index);lines.add(block.slice(at,end<0?undefined:end).trim());}
   const found=FROM_CATALOGUE.filter(k=>e[k]).length;if(!found||!e.model&&found<2)return;
   const hz=block.match(/\b(50|60)\s*Hz/i)?.[1],ph=/\b3\s*(?:~|ph\b|phase|AC\b)|three[\s-]*phase/i.test(block)?'3-phase':/\b1\s*(?:~|ph\b|phase)|single[\s-]*phase/i.test(block)?'1-phase':'';
   e.config=clip([e.un,ph,hz?`${hz} Hz`:''].filter(Boolean).join(', '));e.source=clip(`${file}, page ${page.page}${page.mode==='ocr'?' (OCR)':''}`);
   if(out.length>=500)throw Error('The document has more than 500 entries. Split the file.');
   out.push({entry:e,page:page.page,evidence:[...lines].join(' · ').slice(0,300),unverified:verify(e,block),include:true});
  });
 }
 return out;
}
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// The values not written on the page they are said to come from (a misread or a model's guess), for the engineer to check.
export function verify(e:CatalogueRow,text:string):CatalogueKey[] {
 // Numbers on the page are compared as numbers: "0.80" and "13.50" there are the 0.8 and 13.5 stored.
 const t=text.replace(/(\d),(\d)/g,'$1.$2'),nums=t.replace(/\d+(?:\.\d+)?/g,m=>String(Number(m))),has=(v:string)=>new RegExp(`(?<![\\d.])${esc(v)}(?![\\d.]*\\d)`).test(nums),bad:CatalogueKey[]=[];
 if(e.model&&!t.toLowerCase().includes(e.model.toLowerCase()))bad.push('model');
 for(const k of ['ratedKw','protA','inA','efficiency','pf'] as const){const v=e[k].trim();if(!v)continue;const n=num(v);
  const forms=n===null?[v]:[String(n),...(n<1?[String(+(n*100).toFixed(4))]:[])];if(!forms.some(has))bad.push(k);}
 // A configuration led by a code ("310126, 690 V…", "80M, 400 V…") is found when that code is printed.
 for(const k of ['un','config'] as const){const lead=e[k].split(',')[0]!.trim().toLowerCase(),v=e[k].match(/\d{2,5}/)?.[0];if(v&&!has(v)&&!(lead&&t.toLowerCase().includes(lead)))bad.push(k);}
 return bad;
}
// Where a row's values are printed when its reader kept no positions (single datasheets): every text
// item that holds one of them, matched as verify matches them, so a value printed twice is boxed twice.
export function locate(e:CatalogueRow,lines:readonly PositionedLine[]):Box[] {
 const keys=(['model','ratedKw','protA','inA','efficiency','pf','un','config'] as const).filter(k=>k==='un'||k==='config'?/\d{2,5}/.test(e[k]):e[k].trim());
 return lines.flatMap(l=>l.cells.flatMap(c=>{const miss=verify(e,c.text);return keys.filter(k=>!miss.includes(k)).map(k=>({key:k,x0:c.x,x1:c.x+(c.w??0),y:c.y??l.y??0,h:c.h||8}));}));
}
