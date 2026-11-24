import {clip,emptyRow,type SheetRow} from '../engine/sheet';
import {DUTIES,FROM_CATALOGUE,LOAD_KEYS,TICK,TICK_KEYS,emptyEntry,emptyLoad,fillRow,indexCatalogue,isTick,num,sameText,
 DEFAULT_FACTORS,DEFAULT_MARGIN,type CatalogueIndex,type CatalogueKey,type CatalogueRow,type Duty,type Factors,type LoadKey} from '../engine/loads';
import type {LoadPanel,PageEvidence} from '../store/schema';
import type {EquipmentType} from '../engine/equipment-types';
import {cleanValue,itemRows,normalize,valueColumns,type InputTable} from './load-list';
import type {PositionedLine} from './parse';

// Header words for each equipment-list and catalogue column, tried in this order; each column takes the first unused match.
// Remarks are read only as a catalogue entry's source note.
type HeadKey=LoadKey|'remarks';
const HEADS:[HeadKey,RegExp][]=[
 ['kks',/kks|kss|^tag|tagno/],['description',/description|^(equipment|item|load|loadname|name)$/],['brand',/brand|^make$|manufacturer/],
 ['model',/model|partn(o|umber)|articleno|ordercode/],['config',/config|variant/],['nonEssential',/nonessential/],['essential',/essential/],
 ['vital',/vital/],['restart',/restart/],['starter',/starter/],['cis',/cis$|^ci$|equipmentci$|^duty/],['consumedKw',/consumed/],
 ['ratedKw',/rated(input)?power|inputpower|ratedkw|feederrating/],['protA',/protection|breaker|fuse/],['inA',/^ina?$|nominalcurrent|ratedcurrent|fullloadcurrent|^flc/],
 ['un',/^un$|^un[^a-z]|nominalvoltage|ratedvoltage|^voltage/],['efficiency',/efficien/],['pf',/powerfactor|cosphi|^pf$/],
 ['remarks',/remark|comment|note/],
];
type Columns=Partial<Record<HeadKey,number>>;
// Workbook headings often stack over a few rows ("CONSUMED" / "LOAD" / "(kW)"); long sentences above them are notes, not headings.
function columnsAt(rows:readonly string[][],h:number,stacked:boolean):Columns {
 const map:Columns={},width=rows[h]?.length??0;
 for(let c=0;c<width;c++){
  const own=normalize(rows[h]?.[c]??''),parts:string[]=[];
  if(stacked)for(let i=Math.max(0,h-4);i<=h;i++){const t=(rows[i]?.[c]??'').trim();if(t&&t.length<=40&&!parts.includes(t))parts.push(t);}
  const tall=normalize(parts.join(' ')),free=HEADS.filter(([k])=>map[k]===undefined);
  const hit=(own&&free.find(([,re])=>re.test(own)))||(tall&&free.find(([,re])=>re.test(tall)));if(hit)map[hit[0]]=c;
 }
 return map;
}
function bestHeader(rows:readonly string[][]):number {let best=-1,score=0;for(let i=0;i<Math.min(40,rows.length);i++){const n=Object.keys(columnsAt(rows,i,false)).length;if(n>score){score=n;best=i;}}return best;}
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
export function readEquipment(tables:readonly InputTable[],file:string):EquipmentRead {
 const panels:LoadPanel[]=[],catalogue:CatalogueRow[]=[],notes:string[]=[];
 for(const t of tables){
  const h=bestHeader(t.rows);if(h<0)continue;
  const body=itemRows(t),cols=valueColumns(columnsAt(t.rows,h,true),t,h,body),cell=(r:readonly string[],k:HeadKey)=>{const i=cols[k];return i===undefined?'':clip((r[i]??'').trim());};
  // Headings merged over two rows, or repeated for printing, come back as rows that repeat the heading: not items.
  const heading=(r:readonly string[],k:HeadKey)=>normalize(cell(r,k))===normalize(cell(t.rows[h]!,k));
  const brandSheet=/^brand\s*\((.+)\)\s*$/i.exec(t.name)?.[1]?.trim();
  if(brandSheet!==undefined||cols.model!==undefined&&(cols.description===undefined||/catalog/i.test(t.name))){
   body.slice(h+1).forEach((r,j)=>{const model=cell(r,'model');if(!model||heading(r,'model'))return;const e=emptyEntry(),remarks=cell(r,'remarks');
    e.brand=clip(brandSheet??cell(r,'brand'));e.model=model;for(const k of ['config',...FROM_CATALOGUE] as const)e[k]=cell(r,k);
    // A model with no brand and nothing to fill is a label on a summary sheet, not a catalogue entry.
    if(!e.brand&&!e.config&&FROM_CATALOGUE.every(k=>!e[k]))return;
    // The sheet's remarks name the data source; otherwise the file and row do.
    e.source=remarks||clip(`${file} · ${t.name} row ${h+j+2}`);catalogue.push(e);});
   continue;
  }
  // The template's panel summary lists boards, not equipment.
  if(cols.description===undefined||Object.keys(cols).length<4||/distribution\s*boards?/i.test(t.rows[h]![cols.description]??''))continue;
  // Everything from the panel's "Normal Running Plant Load" summary down is totals and notes.
  const end=t.rows.findIndex((r,j)=>j>h&&/normal\s+running/i.test(r.join(' ')));
  const rows=body.slice(h+1,end<0?undefined:end).flatMap(r=>{const d=cell(r,'description');if(!d||TOTAL.test(d)||heading(r,'description'))return [];const row=emptyLoad();
   for(const k of LOAD_KEYS)row[k]=cell(r,k);for(const k of TICK_KEYS)row[k]=isTick(row[k])?TICK:'';if(/^[cis]$/i.test(row.cis))row.cis=row.cis.toUpperCase();return [row];});
  if(!rows.length)continue;
  if(rows.length>500)throw Error(`${t.name} lists more than 500 items. Split it over two sheets.`);
  panels.push({name:t.name.trim().slice(0,60)||`Panel ${panels.length+1}`,rows,...readFactors(t.rows)});
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
export type Proposal={entry:CatalogueRow;page:number;evidence:string;unverified:CatalogueKey[];include:boolean;boxes?:Box[];note?:string;typeGuess?:boolean};
const takes=(t:EquipmentType)=>new Set(t.params.map(p=>p.feeds).filter(Boolean));
// Rows read from a catalogue the user said covers these equipment types, each holding only its ticked parameters. Every row
// takes the type whose load list columns best match the values found on it: a value the type takes counts for it, one it
// does not take counts against it. A tie is flagged, and the first type picked is kept until the engineer chooses.
export function applyPick(rows:readonly Proposal[],types:readonly EquipmentType[]):Proposal[] {
 if(!types.length)return [...rows];
 return rows.map(p=>{
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
const LABELLED:[CatalogueKey,RegExp][]=[
 ['ratedKw',new RegExp(`power\\b[^\\n\\d]{0,30}${N}\\s*kW\\b`,'i')],
 ['inA',new RegExp(`(?:rated|nominal|full[\\s-]*load|input)\\s*current\\b[^\\n\\d]{0,30}${N}\\s*A\\b`,'i')],
 ['protA',new RegExp(`(?:breaker|fuse|protection|mccb|mcb)\\b[^\\n\\d]{0,30}${N}\\s*A\\b`,'i')],
 ['un',/voltage\b[^\n\d]{0,30}(\d{2,4})\s*V/i],
 ['efficiency',new RegExp(`efficiency\\b[^\\n\\d]{0,30}${N}`,'i')],
 ['pf',/(?:power\s*factor|cos\s*(?:φ|ϕ|phi|ф)?)[^\n\d]{0,20}(0[.,]\d+|1(?:[.,]0+)?)(?!\d)/i],
];
const MODEL=/(?:article|order|part|catalog(?:ue)?|product)\s*(?:no\.?|number|code)\s*[:#.]?\s*([A-Z0-9][A-Z0-9./-]{3,40})|\b(?:model|type)\s*[:#]\s*([A-Z0-9][A-Z0-9./-]{2,40})/gi;
export const dot=(v:string)=>v.replace(',','.');
// Decimals throughout: an efficiency of 94.2 (%) is kept as 0.942.
export const asFraction=(v:string)=>{const n=num(dot(v));return n!==null&&n>1&&n<=100?String(+(n/100).toFixed(4)):dot(v);};
export function catalogueFromPages(pages:readonly PageEvidence[],file:string):Proposal[] {
 const out:Proposal[]=[];
 for(const page of pages){
  const marks=[...page.text.matchAll(MODEL)],starts=marks.length?marks.map(m=>m.index):[0];
  starts.forEach((s,i)=>{
   const block=page.text.slice(s,starts[i+1]??page.text.length),e=emptyEntry(),lines=new Set<string>();
   e.model=clip((marks[i]?.[1]??marks[i]?.[2]??'').trim());
   for(const [k,re] of LABELLED){const m=block.match(re);if(!m?.[1])continue;e[k]=k==='efficiency'||k==='pf'?asFraction(m[1]):k==='un'?`${m[1]} V`:dot(m[1]);
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
