import JSZip from 'jszip';
import {calculateSheet,INPUT_COLS,CALC_COLS,DECIMAL,isBlankRow,type SheetRow,type Cell} from '../engine/sheet';
import {downloadFile} from '../store/project';

// Exports into the supplied workbook itself: inputs go into the typed/dropdown cells and every formula, dropdown,
// colour rule and lookup sheet stays live. Calculated cells also carry this app's values so previews show results;
// Excel recalculates them on open.
const TEXT=new Set(['C','D','O','P','Q','AP','AS','AW']),TEMPLATE_ROWS=196;
// XML 1.0 forbids most control characters, U+FFFE/U+FFFF and unpaired surrogates; Excel reports such a file as corrupt.
const esc=(s:string)=>s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const shiftRow=(xml:string,to:number)=>xml.replace(/<row r="2"/,`<row r="${to}"`).replace(/r="([A-Z]{1,3})2"/g,`r="$1${to}"`).replace(/<f([^>]*)>([^<]*)<\/f>/g,(_,a:string,f:string)=>`<f${a}>${f.replace(/(^|[^A-Za-z_$!.\d])(\$?)([A-Z]{1,3})(\d+)(?![\d(A-Za-z_])/g,(m,pre:string,abs:string,col:string,row:string)=>/\$$/.test(abs+col)?m:`${pre}${abs}${col}${+row+to-2}`)}</f>`);
function cellXml(ref:string,style:string,cell:Cell,formula?:string):string {
 let value=cell;
 const f=formula??'';
 // An overflowing result (e.g. 1e308 kW) has no cached value; Excel works it out on open.
 if(typeof value==='number'&&!Number.isFinite(value))value='';
 if(value==='')return formula?`<c r="${ref}" s="${style}" t="str">${f}<v></v></c>`:`<c r="${ref}" s="${style}"/>`;
 return typeof value==='number'?`<c r="${ref}" s="${style}">${f}<v>${value}</v></c>`:formula?`<c r="${ref}" s="${style}" t="str">${f}<v>${esc(value)}</v></c>`:`<c r="${ref}" s="${style}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
}
// Fills one copy of the Cable Sizing sheet XML with rows; returns the XML and its last row.
function fillSheet(sheet:string,rows:readonly SheetRow[],cached:boolean):{xml:string;last:number} {
 const results=calculateSheet(rows),last=Math.max(TEMPLATE_ROWS,rows.length)+1;
 let xml=sheet;
 if(last>TEMPLATE_ROWS+1){
  // Longer lists extend the template: copy row 2's formulas down and stretch every range that ends on row 197.
  const row2=xml.match(/<row r="2"[^>]*>[\s\S]*?<\/row>/)?.[0];if(!row2)throw Error('The Excel template has no formula row to copy.');
  const extra=Array.from({length:last-TEMPLATE_ROWS-1},(_,i)=>shiftRow(row2,TEMPLATE_ROWS+2+i)).join('');
  xml=xml.replace('</sheetData>',`${extra}</sheetData>`).replace(/<f([^>]*)>([^<]*)<\/f>/g,(_,a:string,f:string)=>`<f${a}>${f.replace(/\$197(?!\d)/g,`$${last}`)}</f>`);
  const end=xml.indexOf('</sheetData>');xml=xml.slice(0,end).replace(/<dimension ref="([A-Z]+1:[A-Z]+)197"/,`<dimension ref="$1${last}"`)+xml.slice(end).replace(/([A-Z]{1,3})197(?!\d)/g,`$1${last}`);
 }
 xml=xml.replace(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g,(rowXml,n:string)=>{
  const i=+n-2,row=rows[i],result=results[i];if(!row||!result||isBlankRow(row))return rowXml;
  let out=rowXml;
  for(const col of INPUT_COLS){const raw=row[col].trim();if(!raw)continue;const value:Cell=!TEXT.has(col)&&DECIMAL.test(raw)&&Number.isFinite(Number(raw))?Number(raw):raw;out=out.replace(new RegExp(`<c r="${col}${n}" s="(\\d+)"/>`),(_,s:string)=>cellXml(`${col}${n}`,s,value));}
  if(cached)for(const col of CALC_COLS)out=out.replace(new RegExp(`<c r="${col}${n}" s="(\\d+)"( t="str")?>(<f[^>]*>[^<]*</f>)<v>[^<]*</v></c>`),(_,s:string,_t:string,f:string)=>cellXml(`${col}${n}`,s,result.cells[col],f));
  return out;
 });
 return {xml,last};
}
// A load list from a workbook with one worksheet per MCC/DB exports the same way: one Cable Sizing sheet per panel (From).
// Excel chains total VD within one sheet only, so a list where a row feeds another listed panel stays on one sheet.
export function panelSheets(rows:readonly SheetRow[]):{panels:string[];chained:number} {
 const filled=rows.filter(r=>!isBlankRow(r)),panels=[...new Set(filled.map(r=>r.C.trim()))],names=new Set(panels.map(p=>p.toLowerCase()).filter(Boolean));
 const chained=panels.length>1?filled.filter(r=>names.has(r.D.trim().toLowerCase())).length:0;
 return {panels:panels.length>1&&!chained?panels:[],chained};
}
// Excel sheet names: at most 31 characters, none of []:*?/\, no leading or trailing ', unique ignoring case.
export function sheetNames(panels:readonly string[],taken:readonly string[]):string[] {
 const used=new Set(taken.map(t=>t.toLowerCase()));
 return panels.map(p=>{const base=(p.replace(/[[\]:*?/\\]/g,'-').replace(/^'+|'+$/g,'').trim()||'No panel').slice(0,31);let name=base;
  for(let n=2;used.has(name.toLowerCase());n++)name=`${base.slice(0,27).trim()} (${n})`;used.add(name.toLowerCase());return name;});
}
const quoted=(name:string)=>`&apos;${esc(name).replace(/'/g,'&apos;&apos;')}&apos;`;
const reEsc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export async function fillTemplate(template:ArrayBuffer|Uint8Array,rows:readonly SheetRow[],{cached=true}:{cached?:boolean}={}):Promise<Uint8Array> {
 if(rows.length>2000)throw Error('Limit an export to 2,000 rows.');
 const zip=await JSZip.loadAsync(template),book=await zip.file('xl/workbook.xml')?.async('string'),rels=await zip.file('xl/_rels/workbook.xml.rels')?.async('string'),types=await zip.file('[Content_Types].xml')?.async('string');
 const id=book?.match(/<sheet name="Cable Sizing"[^>]*r:id="([^"]+)"/)?.[1],target=id?rels?.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))?.[1]??rels?.match(new RegExp(`Target="([^"]+)"[^>]*Id="${id}"`))?.[1]:undefined;
 const path=target&&`xl/${target.replace(/^\/?xl\//,'')}`,sheet=path&&await zip.file(path)?.async('string');
 if(!book||!rels||!types||!path||!sheet)throw Error('The Excel template is missing its Cable Sizing sheet.');
 // Ask Excel to recalculate everything when the file opens.
 let wb=book.replace(/<calcPr([^>]*?)\s*\/>/,(m,a:string)=>a.includes('fullCalcOnLoad')?m:`<calcPr${a} fullCalcOnLoad="1"/>`);
 const {panels}=panelSheets(rows);
 if(!panels.length){
  const {xml,last}=fillSheet(sheet,rows,cached);zip.file(path,xml);
  zip.file('xl/workbook.xml',wb.replace(/(&apos;Cable Sizing&apos;!\$A\$1:\$[A-Z]{1,3}\$)197/,`$1${last}`));
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
 }
 // The first panel takes the Cable Sizing sheet; each other panel gets a copy right after it, with its own header-note parts.
 const names=sheetNames(panels,[...wb.matchAll(/<sheet name="([^"]*)"/g)].map(m=>m[1]!).filter(n=>n!=='Cable Sizing'));
 const dir=path.replace(/[^/]+$/,''),sheetRels=await zip.file(path.replace(/([^/]+)$/,'_rels/$1.rels'))?.async('string');
 const abs=(t:string)=>t.startsWith('/')?t.slice(1):(dir+t).split('/').reduce<string[]>((a,p)=>p==='..'?a.slice(0,-1):[...a,p],[]).join('/');
 const filter=wb.match(/<definedName[^>]*localSheetId="0"[^>]*>&apos;Cable Sizing&apos;!\$A\$1:\$[A-Z]{1,3}\$197<\/definedName>/)?.[0];
 const sheetTag=wb.match(/<sheet name="Cable Sizing"[^>]*\/>/)![0],lastSheet=Math.max(0,...Object.keys(zip.files).map(f=>+(f.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1]??0)));
 let newTypes=types,newRels=rels,tags='',filters='';
 for(const [k,name] of names.entries()){
  const {xml,last}=fillSheet(sheet,rows.filter(r=>!isBlankRow(r)&&r.C.trim()===panels[k]),cached);
  if(filter)filters+=filter.replace('localSheetId="0"',`localSheetId="${k}"`).replace(/&apos;Cable Sizing&apos;!(\$A\$1:\$[A-Z]{1,3}\$)197/,(_,range:string)=>`${quoted(name)}!${range}${last}`);
  if(!k){zip.file(path,xml);tags+=sheetTag.replace('name="Cable Sizing"',()=>`name="${esc(name)}"`);continue;}
  // ExcelJS (this app's own import) only reads worksheet parts named sheetN.xml.
  const part=`${dir}sheet${lastSheet+k}.xml`,rid=`rIdPanel${k}`;
  zip.file(part,xml.replace(/tabSelected="(true|1)"/,'tabSelected="false"'));
  newRels=newRels.replace('</Relationships>',`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${part.replace(/^xl\//,'')}"/></Relationships>`);
  newTypes=newTypes.replace('</Types>',`<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  tags+=`<sheet name="${esc(name)}" sheetId="0" state="visible" r:id="${rid}"/>`;
  if(!sheetRels)continue;
  let copyRels=sheetRels;
  for(const t of new Set([...sheetRels.matchAll(/Target="([^"]+)"/g)].map(m=>m[1]!))){
   const from=abs(t),bytes=await zip.file(from)?.async('uint8array');if(!bytes)continue;
   const to=t.replace(/\d*(\.[A-Za-z]+)$/,`${1000+k}$1`),type=types.match(new RegExp(`<Override PartName="/${reEsc(from)}" ContentType="([^"]+)"/>`))?.[1];
   zip.file(abs(to),bytes);copyRels=copyRels.replace(`Target="${t}"`,`Target="${to}"`);
   if(type)newTypes=newTypes.replace('</Types>',`<Override PartName="/${abs(to)}" ContentType="${type}"/></Types>`);
  }
  zip.file(part.replace(/([^/]+)$/,'_rels/$1.rels'),copyRels);
 }
 // Sheets after the copies move along, so their sheet-local names (filters) shift too.
 // Sheet ids follow the tab order, since some readers (ExcelJS) list sheets by id.
 let sid=0;wb=wb.replace(sheetTag,()=>tags).replace(/(<sheet [^>]*sheetId=")\d+"/g,(_,a:string)=>`${a}${++sid}"`).replace(/localSheetId="(\d+)"/g,(m,n:string)=>+n>0?`localSheetId="${+n+names.length-1}"`:m);
 if(filter)wb=wb.replace(filter,()=>filters);
 zip.file('xl/workbook.xml',wb);zip.file('xl/_rels/workbook.xml.rels',newRels);zip.file('[Content_Types].xml',newTypes);
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
export async function exportSheet(rows:readonly SheetRow[],name:string):Promise<void> {
 if(rows.every(isBlankRow))throw Error('Fill in at least one row before exporting.');
 const response=await fetch('templates/cable-sizing.xlsx');if(!response.ok)throw Error('The Excel template could not be loaded.');
 const bytes=await fillTemplate(await response.arrayBuffer(),rows);
 downloadFile(`${name.replace(/[^\w.-]+/g,'-').replace(/^-|-$/g,'')||'cable-sizing'}.xlsx`,bytes as BlobPart,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
