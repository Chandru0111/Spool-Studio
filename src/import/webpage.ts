import {clip} from '../engine/sheet';
import {emptyEntry,type CatalogueKey,type CatalogueRow} from '../engine/loads';
import type {PageEvidence} from '../store/schema';
import {asFraction,catalogueFromPages,dot,verify,type Proposal} from './equipment';
import type {PositionedLine,Rule} from './parse';
import {catalogueFromTables} from './rating-table';

// Vendor product pages. A browser will not let one website read another, and vendors block bots, so the page comes in through
// the user's own browser: copied and pasted, or saved as .html. The HTML is only turned into text here, never shown or run.
// Table cells stay apart (tab-separated), so label/value pairs survive, unlike a page printed to PDF.
// Datasheet PDFs laid out as "label    value" rows are read the same way (catalogueFromDatasheet).
export const MAX_PAGE=5*1024*1024;
const ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',deg:'°',micro:'µ',phi:'φ',ndash:'–',mdash:'—',frac12:'½'};
const entity=(m:string,e:string)=>{
 if(e[0]!=='#')return ENTITIES[e.toLowerCase()]??m;
 const hex=e[1]==='x'||e[1]==='X',n=parseInt(e.slice(hex?2:1),hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):m;
};
export function pageText(html:string):string {
 if(html.length>MAX_PAGE)throw Error('The page is larger than 5 MB. Copy only the product part of the page.');
 const chunks:string[]=[],tag=/<(\/?)([a-z][\w:-]*)/iy;
 for(let pos=0;pos<html.length;){
  const open=html.indexOf('<',pos);
  if(open<0){chunks.push(html.slice(pos));break;}
  chunks.push(html.slice(pos,open));
  if(html.startsWith('<!--',open)){const end=html.indexOf('-->',open+4);pos=end<0?html.length:end+3;continue;}
  tag.lastIndex=open;const m=tag.exec(html);
  if(!m&&!html.startsWith('<!',open)){chunks.push('<');pos=open+1;continue;}
  let end=m?tag.lastIndex:open+2,quote='';
  for(;end<html.length;end++){const c=html[end]!;if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
  pos=end+1;if(!m)continue;
  const name=m[2]!.toLowerCase();
  if(!m[1]&&/^(script|style|noscript|template|svg|head)$/.test(name)&&html[end-1]!=='/'){
   const close=new RegExp(`</${name}\\s*>`,'ig');close.lastIndex=pos;pos=close.exec(html)?close.lastIndex:html.length;
  }else if(m[1]&&(name==='td'||name==='th'))chunks.push('\t');
  else if(/^(br|p|div|li|tr|h[1-6]|dt|dd|dl|ul|ol|section|article|table|tbody|thead|header|footer|main|nav)$/.test(name))chunks.push('\n');
 }
 return chunks.join('').replace(/&(#x[\da-f]+|#\d+|[a-z]\w*);/gi,entity)
  .split('\n').map(l=>l.replace(/[  ]+/g,' ').replace(/ *\t */g,'\t').replace(/^\t+|\t+$/g,'').trim()).filter(Boolean).join('\n');
}

// A file saved from a search result or shortcut that only forwards to the real document (<meta http-equiv="refresh" content="0;url=…">)
// holds no product data. Only the start of the file is checked, with bounded patterns, so a large page costs nothing.
export function redirectTarget(html:string):string|null {
 for(const [tag] of html.slice(0,20000).matchAll(/<meta\b[^>]{0,1000}>/gi)){
  if(!/http-equiv\s*=\s*["']?refresh/i.test(tag))continue;
  const url=tag.match(/url\s*=\s*['"]?([^"'\s>]{1,2000})/i)?.[1]?.replace(/&amp;/g,'&');
  if(url&&/^https?:\/\//i.test(url)&&!pageText(html).trim())return url;
 }
 return null;
}

type Field=CatalogueKey|'hp'|'phase'|'hz';
// Labels as vendors write them, best first: when a page has two (Efficiency and Nominal Efficiency), the earlier one wins.
const LABELS:[Field,string[]][]=[
 ['model',['model','model no','model number','mfr model','mfr part no','mfr part number','manufacturer part number','part no','part number','catalog no','catalog number','catalogue number','article no','article number','order no','order code','order number','product code','product id','product number','type designation','data sheet','datasheet','product type designation']],
 ['brand',['brand','manufacturer','make']],
 ['ratedKw',['rated power','rated output','output power','motor power','nominal power','power','kw','output']],
 ['hp',['hp','horsepower','rated hp','motor hp','output hp']],
 ['inA',['full load amps','full load current','full load amperage','fla','rated current','rated operational current','operational current','nominal current','rated input current','input current','current','amps','amperage']],
 ['un',['voltage','rated voltage','rated operational voltage','nominal voltage','input voltage','supply voltage','volts']],
 ['efficiency',['efficiency','full load efficiency','efficiency at full load','nominal efficiency','motor efficiency']],
 ['pf',['power factor','full load power factor','pf','cos phi','cos φ','cosφ']],
 ['protA',['protection device rating','breaker rating','fuse rating','max fuse','maximum fuse','recommended fuse','mcb rating','mccb rating']],
 ['phase',['phase','phases','no of phases','number of phases']],
 ['hz',['frequency','hz','rated frequency']],
];
const label=(s:string)=>s.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g,' ').replace(/[^a-z0-9φ]+/g,' ').trim();
const FIELDS=new Map(LABELS.flatMap(([field,names])=>names.map((n,rank)=>[n,{field,rank}] as const)));
type Pair={field:Field;rank:number;label:string;value:string;line:string};
const NUMERIC=new Set<Field>(['ratedKw','hp','inA','un','efficiency','pf','protA','hz']);
// Datasheets write long labels ("supply voltage at AC", "efficiency at 4/4 load"). Those count by their longest known start,
// only with a value in the field's unit, and never for signal inputs or losses ("input voltage at digital input", "power loss").
const UNIT:Partial<Record<Field,RegExp>>={ratedKw:/\d\s*(?:k?w|hp)\b/i,hp:/\d\s*hp\b/i,inA:/\d\s*a\b/i,protA:/\d\s*a\b/i,un:/\d\s*k?v\b/i,hz:/\d\s*hz\b/i,
 efficiency:/\d\s*%|\b0[.,]\d+|\b\d{2}(?:[.,]\d+)?\b/,pf:/\b0[.,]\d+|\b1(?:[.,]0+)?\b/};
const OFF=/\b(?:digital|analog|analogue|signal|pulse|loss|losses|dissipation)\b/;
function fieldOf(name:string,value:string):{field:Field;rank:number}|undefined {
 const l=label(name),exact=FIELDS.get(l);if(exact)return exact;
 let best:{field:Field;rank:number;n:number}|undefined;
 for(const [n,f] of FIELDS)if(l.startsWith(`${n} `)&&n.length>(best?.n??0))best={...f,n:n.length};
 return best&&!OFF.test(l)&&UNIT[best.field]?.test(value)?best:undefined;
}
const pairOf=(name:string,value:string,line:string):Pair|null=>{
 const v=value.trim(),f=fieldOf(name,v);
 return f&&v&&!FIELDS.has(label(v))&&(!NUMERIC.has(f.field)||/\d/.test(v))?{field:f.field,rank:f.rank,label:name.trim(),value:v,line}:null;
};

// Numbers as written: ranges and dual ratings (19.8-22.5, 115/230) are kept for the engineer to choose.
const group=(v:string)=>dot(v.replace(/(\d),(\d)/g,'$1.$2')).match(/\d+(?:\.\d+)?(?:\s*(?:[-–/]|\.{2,3}|…)\s*\d+(?:\.\d+)?)*/)?.[0].replace(/\s+/g,'').replace(/–|…|\.{2,3}/g,'-')??'';
const horsepower=(v:string)=>{const t=dot(v);let m=t.match(/(\d+)\s+(\d+)\/(\d+)/);if(m&&+m[3]!)return +m[1]!+ +m[2]!/+m[3]!;m=t.match(/(\d+)\/(\d+)/);if(m&&+m[2]!)return +m[1]!/+m[2]!;m=t.match(/\d+(?:\.\d+)?/);return m?+m[0]:null;};
const HP_KW=0.7457;

function entryOf(pairs:readonly Pair[],source:string):{entry:CatalogueRow;evidence:string[];converted:boolean;brand:string}|null {
 const best=new Map<Field,Pair>();for(const p of pairs){const b=best.get(p.field);if(!b||p.rank<b.rank)best.set(p.field,p);}
 const e=emptyEntry(),get=(f:Field)=>best.get(f)?.value??'',evidence=new Set<string>();let converted=false;
 e.model=clip(get('model').split(/\s{2,}|\s\|\s/)[0]!.trim());
 const power=best.get('ratedKw')??best.get('hp');
 if(power){
  // The unit written with the value wins over the column heading ("Hp" column holding "5.5 kW").
  const v=power.value,unit=/\bkw\b/i.test(v)?'kw':/\bhp\b/i.test(v)?'hp':/\d\s*w\b/i.test(v)?'w':power.field==='hp'||/\bhp\b/i.test(power.label)?'hp':'kw';
  const hp=unit==='hp',watts=unit==='w';
  const n=hp?horsepower(power.value):Number(group(power.value).split(/[-/]/)[0]);
  if(n!==null&&Number.isFinite(n)&&n>0){e.ratedKw=String(+(hp?n*HP_KW:watts?n/1000:n).toFixed(3));converted=hp||watts;}
  if(hp)evidence.add(`${power.value} = ${e.ratedKw} kW (shaft output, 1 hp = ${HP_KW} kW)`);
 }
 e.inA=group(get('inA'));e.protA=group(get('protA'));
 const volts=group(get('un'));e.un=volts?`${volts} V`:'';
 e.efficiency=asFraction(group(get('efficiency')));e.pf=asFraction(group(get('pf')));
 const ph=get('phase'),hz=group(get('hz'));
 const phase=/\b3\b|three|3\s*ph/i.test(ph)?'3-phase':/\b1\b|single|1\s*ph/i.test(ph)?'1-phase':'';
 e.config=clip([e.un,phase,hz?`${hz} Hz`:''].filter(Boolean).join(', '));
 const values=(['ratedKw','inA','protA','un','efficiency','pf'] as const).filter(k=>e[k]).length;
 if(!values&&!e.model)return null;
 e.source=clip(source);
 for(const p of best.values())evidence.add(p.line);
 return {entry:e,evidence:[...evidence],converted,brand:get('brand')};
}

// A comparison table (a heading row such as Model | Voltage | Hp | Full Load Amps, then one row per model).
function tables(lines:readonly string[]):{rows:Pair[][];used:Set<number>} {
 const rows:Pair[][]=[],used=new Set<number>();
 for(let i=0;i<lines.length;i++){
  const head=lines[i]!.split('\t');if(head.length<3)continue;
  const fields=head.map(h=>FIELDS.get(label(h)));if(fields.filter(Boolean).length<3||!fields.some(f=>f&&['model','ratedKw','hp','inA'].includes(f.field)))continue;
  let j=i+1;
  for(;j<lines.length;j++){const cells=lines[j]!.split('\t');if(cells.length!==head.length)break;
   if(rows.length>=500)throw Error('The page has more than 500 entries. Copy a smaller part of it.');
   rows.push(cells.flatMap((c,k)=>{const f=fields[k];return f&&c.trim()?[{...f,label:head[k]!,value:c.trim(),line:`${head[k]}: ${c.trim()}`}]:[];}));used.add(j);}
  if(j>i+1){used.add(i);i=j-1;}
 }
 return {rows,used};
}

// Label/value pairs: table cells side by side (two or more pairs per row), "Label: value", or a label line with its value on the next line.
function pairsOf(lines:readonly string[],skip:ReadonlySet<number>):Pair[] {
 const out:Pair[]=[],push=(p:Pair|null)=>{if(p)out.push(p);};
 lines.forEach((line,i)=>{
  if(skip.has(i))return;
  const cells=line.split('\t');
  if(cells.length>=2){
   // A label wrapped onto the next line in a narrow column ("Full Load" above "Amps").
   const below=lines[i+1]?.split('\t')[0],head=below&&!fieldOf(cells[0]!,cells[1]!)&&fieldOf(`${cells[0]} ${below}`,cells[1]!)?`${cells[0]} ${below}`:cells[0]!;
   push(pairOf(head,cells[1]!,head===cells[0]?line:`${line} ${below}`));for(let j=2;j+1<cells.length;j+=2)push(pairOf(cells[j]!,cells[j+1]!,line));return;
  }
  const parts=line.split(/\s+\|\s+/).map(s=>s.match(/^([^:]{1,40}):\s*(.+)$/)).filter(m=>m!==null);
  if(parts.length){for(const m of parts)push(pairOf(m[1]!,m[2]!,line));return;}
  // A label alone on its line takes the next line only when that is a lone value, not another label/value row.
  const next=lines[i+1];if(next!==undefined&&!next.includes('\t')&&!skip.has(i+1)&&FIELDS.has(label(line)))push(pairOf(line,next,`${line} ${next}`));
 });
 return out;
}

const COPYRIGHT=/(?:©|\([Cc]\)|[Cc]opyright)\s*(?:[Cc]opyright|©)?\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?\s*)?([A-Z][\w&.-]*(?: [A-Z][\w&.-]*)?)/;
const HZ=/\b(50\/60|60\/50|50|60)\s*Hz\b/i;
export const catalogueFromWeb=(text:string,source:string)=>catalogueFromText(text,`${source} (web page)`);
export function catalogueFromText(text:string,source:string):{proposals:Proposal[];brand:string} {
 if(text.length>MAX_PAGE)throw Error('The page is larger than 5 MB. Copy only the product part of the page.');
 const lines=text.split('\n'),{rows,used}=tables(lines),pairs=pairsOf(lines,used),proposals:Proposal[]=[];
 const hz=lines.find(l=>HZ.test(l));
 // A frequency written only in the product description ("Ue 230/400 V, 50 Hz") still belongs to the entry.
 if(hz)pairs.push({field:'hz',rank:99,label:'',value:hz.match(HZ)![1]!,line:hz});
 const main=entryOf(pairs,source);
 const add=(r:ReturnType<typeof entryOf>,include:boolean)=>{
  if(!r)return;const unverified=verify(r.entry,r.evidence.join('\n')).filter(k=>!(k==='ratedKw'&&r.converted));
  proposals.push({entry:r.entry,page:1,evidence:r.evidence.join(' · ').slice(0,300),unverified,include});
 };
 add(main,true);
 // Other models listed on a product page start unticked; on a page that is only a table, every row is ticked.
 for(const r of rows)add(entryOf(r,source),!main);
 if(proposals.length>500)throw Error('The page has more than 500 entries. Copy a smaller part of it.');
 // No Brand label: the maker named before the model in a title ("Marathon Motors 184TBFW7701 | ..."), then the copyright holder ("© Copyright Siemens").
 const model=main?.entry.model??'',at=model?lines.find(l=>l.includes(model)&&!/https?:/i.test(l)):undefined,before=at?.slice(0,at.indexOf(model)).trim()??'';
 const titled=/^[A-Z][\w&.-]*(?: [A-Z][\w&.-]*){0,2}$/.test(before)&&!FIELDS.has(label(before))?before:'';
 return {proposals,brand:clip(main?.brand||titled||text.match(COPYRIGHT)?.[1]?.split(/\.\s/)[0]?.replace(/\.$/,'')||'')};
}

// PDF text items split at ligature glyphs ("E  ffi  ciency"); a lone "|" between pairs is a separator, not a cell.
const cellsOf=(line:string)=>line.trim().replace(/([A-Za-z])\s+(ffi|ffl|ff|fi|fl)\s+([a-z])/g,'$1$2$3').split(/\s{2,}/).filter(c=>c!=='|');
// A PDF is either one product's datasheet or a catalogue of many. Catalogues list their models in rating tables
// (catalogueFromTables, by column position). One-product sheets are "label    value" rows (Siemens, ABB, WEG): the PDF text keeps
// two or more spaces between columns, so those become cells and the whole file is read as one product. Prose sheets go through
// catalogueFromPages; the fuller of those two wins.
export function catalogueFromDatasheet(pages:readonly PageEvidence[],file:string,layout:ReadonlyMap<number,readonly PositionedLine[]>=new Map(),rules:ReadonlyMap<number,readonly Rule[]>=new Map()):{proposals:Proposal[];brand:string} {
 const none={proposals:[] as Proposal[],brand:''},attempt=<T,>(read:()=>T,fallback:T)=>{try{return read();}catch{return fallback;}};
 // The one-product readers only need the start of a long catalogue (for its brand); their entry limits are not the catalogue's.
 const text=pages.map(p=>p.text.split('\n').map(l=>cellsOf(l).join('\t')).join('\n')).join('\n').slice(0,MAX_PAGE);
 // shortcut: a file over 12 pages is taken to be a catalogue, never one product; a long single-product manual reads only its tables.
 const one=pages.length<=12,specs=attempt(()=>catalogueFromText(text,file),none),prose=one?attempt(()=>catalogueFromPages(pages,file),[]):[];
 for(const p of specs.proposals){
  const pg=pages.find(x=>p.entry.model&&x.text.includes(p.entry.model))??pages[0];
  if(pg){p.page=pg.page;p.entry.source=clip(`${file}, page ${pg.page}${pg.mode==='ocr'?' (OCR)':''}`);}
 }
 const filled=(ps:readonly Proposal[])=>ps.reduce((n,p)=>n+(['model','ratedKw','protA','inA','un','efficiency','pf'] as const).filter(k=>p.entry[k]).length,0);
 const single=!one?{proposals:[] as Proposal[],brand:specs.brand}:filled(specs.proposals)>=filled(prose)?specs:{proposals:prose,brand:specs.brand};
 // A table whose rows carry their own model numbers is a catalogue. Rows named only by rating ("5.5 kW") may be load points
 // in a one-product sheet, so they win only when that sheet names no model.
 const rows=catalogueFromTables(layout,file,rules),named=rows.some(r=>!r.unverified.includes('model'));
 return rows.length>=2&&(named||!single.proposals.some(p=>p.entry.model))?{proposals:rows,brand:specs.brand}:single;
}
