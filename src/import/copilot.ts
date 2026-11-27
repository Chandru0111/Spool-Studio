import {clip} from '../engine/sheet';
import {emptyEntry,type CatalogueKey,type CatalogueRow} from '../engine/loads';
import type {EquipmentType,Param} from '../engine/equipment-types';
import type {PageEvidence} from '../store/schema';
import {inColumn,onPage,reading,verify,type Proposal} from './equipment';
import {loadsIn,nameScore,unitOf,unitsIn,valueIn} from './vocabulary';

// A datasheet read by the organisation's own AI chat (Copilot or another it allows): the engineer gives it the PDF with the
// prompt below and pastes back the JSON it answers. Copilot only copies: every value the datasheet prints, under its own
// heading. The picked types' ticked parameters are found among them here, by the same rules the PDF reader uses (nameScore,
// and the labels the engineer taught), and each value taken must be printed on the page the answer names or it is red in
// the review. The answer is never trusted. This website runs no AI and sends nothing anywhere.
export const MAX_ANSWER=1_000_000,MAX_AI_ROWS=1000;
const MAX_PAGE_NO=10_000;

const str=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):'';
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

// pages: the pages the engineer wants read, as "12, 40-45", or empty for the whole file.
export function copilotPrompt(pages=''):string {
 return [
  'Read the attached datasheet and copy all of its technical data into JSON. Reply with the JSON only, with no other text.',
  '',
  '{"brand":"…","rows":[{"page":1,"model":"…","config":"…","values":{"Rated current In (A)":"1.85","Efficiency (%) / 100 % load":"84"}}]}',
  '',
  'Rules:',
  '1. Make one row for each product and rating. A table of 20 models gives 20 rows. Never skip, merge or summarise rows.',
  '2. In "values", give every technical value printed for that row, each under its heading exactly as printed. Put the heading\'s unit in brackets at its end, for example "Rated current In (A)".',
  '3. When a heading sits under a wider heading, write both, the wider one first, joined by " / ": "Efficiency (%) / 75 % load", "Current at 400 V / In (A)".',
  '4. Values printed once for the whole table or page (voltage, frequency, poles, duty) go in every row they apply to, under their own heading.',
  '5. Copy each value exactly as it is printed, with its unit. Never calculate, convert, round or guess a value. When a value is not printed for a row, leave it out.',
  '6. "page" is the page of the PDF file that the row\'s values are printed on. The first page of the file is 1. Do not use the page number printed on the page.',
  '7. "model" is the model, type or part number exactly as printed.',
  '8. "config" tells apart rows of the same model: the voltage, frequency, poles or duty its values are for, for example "400 V, 50 Hz, 4-pole". When a table gives values for several voltages or duties, make one row for each.',
  ...pages?[`9. Read only these pages of the PDF: ${pages}.`]:[],
 ].join('\n');
}

// A value of the answer as it gives it. heading: as printed; own: its last part (the column's own heading); head: every
// part, wider first, one per line, as the PDF reader has a table column's headings.
type Printed={heading:string;own:string;head:string;printed:string};
// One ticked parameter's value in a row: the heading and value it was read from, and the value as the catalogue holds it.
export type AiValue={p:Param;heading:string;printed:string;value:string};
export type AiRow={page:number;entry:CatalogueRow;values:AiValue[];typeGuess:boolean};
// ignored: rows of the answer with no model and none of the picked types' ticked parameters.
export type AiRead={brand:string;rows:AiRow[];ignored:number};

// The JSON in a chat answer: inside a ```json fence if there is one, else from the first brace to the last.
function jsonIn(text:string):unknown {
 if(text.length>MAX_ANSWER)throw Error('The answer is larger than 1 MB. Ask Copilot for fewer pages at a time.');
 const t=(/```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1]??text).replace(/^﻿/,'').trim();
 const body=t.startsWith('[')?t.slice(0,t.lastIndexOf(']')+1):t.slice(t.indexOf('{'),t.lastIndexOf('}')+1);
 if(!body||!t.includes('{'))throw Error('There is no JSON in the answer. Ask Copilot to reply with the JSON only, then paste it again.');
 try{return JSON.parse(body);}catch{/* repaired below */}
 // Chat answers often leave a comma before a closing bracket; nothing else is repaired.
 try{return JSON.parse(body.replace(/,\s*([}\]])/g,'$1'));}
 catch(e){throw Error(`The answer is not valid JSON (${e instanceof Error?e.message:'it cannot be read'}). Ask Copilot to reply with valid JSON only, then paste it again.`);}
}

// "Output kW" is "Output (kW)": a unit after a heading's words is its unit. A one-letter unit (A, V, W) counts only in
// brackets, as the prompt asks, so "Type A" is no current; "100 %" stays a load.
const unitLast=(s:string)=>s.replace(/(\p{L}\S*)\s+(\S{2,}|%)$/u,(m,w:string,u:string)=>unitOf(u)?`${w} (${u})`:m);
function printedOf(heading:string,printed:string):Printed {
 const parts=heading.split(/\s+\/\s+/).map(s=>unitLast(s.trim())).filter(Boolean);
 return {heading:clip(heading),own:parts[parts.length-1]??'',head:parts.join('\n'),printed};
}
// The one load a heading is for (1 at full load), or none when it gives none or several.
const loadOf=(x:Printed)=>{const own=loadsIn(x.own,true),all=own.length?own:loadsIn(x.head);return all.length===1?all[0]:undefined;};
// A value at part load is taken only for a parameter named at that load ("Efficiency at 3/4 load").
const at=(p:Param,x:Printed)=>{const want=loadsIn(p.label),got=loadOf(x);return want.length===1?got===want[0]:got===undefined||got===1;};

// A comma between groups of three figures ("1,450 rpm") is a thousands separator when the answer writes decimals with
// points, a decimal comma when it writes them with commas, and not read when it writes both or neither.
const GROUPED=/(?<![\d.,])[1-9]\d{0,2}(?:,\d{3})+(?![.,\d])/,POINT=/(?:^|[^\d.,])\d+\.\d{1,2}(?![\d.,])\s*(?:$|[a-zA-Z%])/,COMMA=/(?:^|[^\d.,])\d+,\d{1,2}(?![\d.,])\s*(?:$|[a-zA-Z%])/;
// A value in the form the catalogue holds it, or '' when it is not a value of the parameter. A bare figure under a
// heading with no unit is in the parameter's own unit.
function valueOf(p:Param,x:Printed,points:boolean|null):string {
 let v=x.printed;
 if(p.unit&&GROUPED.test(v)){if(points===null)return '';if(points)v=v.replace(new RegExp(GROUPED.source,'g'),m=>m.replace(/,/g,''));}
 const asked=p.unit.trim(),text=asked&&/^[<>~≤≥±]?\s*\d[\d.,\s/–-]*$/.test(v)&&!unitsIn(x.head,true).length?`${v} ${asked}`:v;
 const got=valueIn(reading(p),text,x.head);if(!got)return '';
 return p.feeds?inColumn(p.feeds,got.value):clip(got.value);
}
// Each ticked parameter's value in a row: the heading that names it best, each value going to one parameter, best match
// first; a value at full load beats one that does not say. Two headings naming a parameter equally with different values
// give it none, for the engineer to read from the page.
function match(params:readonly Param[],row:readonly Printed[],points:boolean|null):AiValue[] {
 const fits=params.flatMap(p=>p.label.trim()?row.flatMap((x,i)=>{
  if(!at(p,x))return [];
  const s=nameScore(p,x.own,x.head,x.printed),value=s>0?valueOf(p,x,points):'';
  return value?[{p,i,s:s+(loadOf(x)===1?0.5:0),value,x}]:[];
 }):[]).sort((a,b)=>b.s-a.s);
 const out:AiValue[]=[],taken=new Set<number>(),settled=new Set<Param>();
 for(const f of fits){
  if(settled.has(f.p)||taken.has(f.i))continue;
  settled.add(f.p);
  if(fits.some(y=>y.p===f.p&&y.s===f.s&&!taken.has(y.i)&&y.value!==f.value))continue;
  taken.add(f.i);out.push({p:f.p,heading:f.x.heading,printed:f.x.printed,value:f.value});
 }
 return out;
}

// Reads a pasted answer into rows of the picked types. Throws, with what to do, when it cannot be read at all.
export function readAnswer(text:string,types:readonly EquipmentType[]):AiRead {
 if(!types.length)throw Error('Pick the equipment types first.');
 const data=jsonIn(text),list=Array.isArray(data)?data:isObject(data)&&Array.isArray(data.rows)?data.rows:null;
 if(!list)throw Error('The answer has no "rows" list. Copy the prompt again and give it to Copilot unchanged.');
 if(list.length>MAX_AI_ROWS)throw Error(`The answer has more than ${MAX_AI_ROWS} rows. Ask Copilot for fewer pages at a time.`);
 const brand=isObject(data)?clip(str(data.brand)):'',own=new Set(['page','model','config','brand']);
 // The values, under "values" as asked, or beside the row's own fields when the answer flattened them.
 const given=list.map(r=>isObject(r)?{r,values:Object.entries(isObject(r.values)?r.values:Object.fromEntries(Object.entries(r).filter(([k])=>!own.has(k))))
  .flatMap(([k,v])=>{const h=k.trim(),s=clip(str(v));return h&&s?[printedOf(h,s)]:[];})}:null);
 const all=given.flatMap(g=>g?g.values.map(v=>v.printed):[]),point=all.some(v=>POINT.test(v)),comma=all.some(v=>COMMA.test(v));
 const points=point===comma?null:point,rows:AiRow[]=[];let ignored=0;
 for(const g of given){
  if(!g){ignored++;continue;}
  // The picked type whose ticked parameters the row gives most, required ones counting twice; a tie is for the engineer.
  const reads=types.map(t=>{const values=match(t.params,g.values,points);return {t,values,score:values.reduce((n,v)=>n+(v.p.required?2:1),0)};});
  const top=Math.max(...reads.map(x=>x.score)),best=reads.find(x=>x.score===top)!,typeGuess=reads.filter(x=>x.score===top).length>1;
  const e={...emptyEntry(),type:best.t.id};e.model=clip(str(g.r.model));e.config=clip(str(g.r.config));
  for(const v of best.values){if(v.p.feeds)e[v.p.feeds]=v.value;else e.extra={...e.extra,[v.p.key]:v.value};}
  if(!e.model&&!best.values.length){ignored++;continue;}
  const n=typeof g.r.page==='number'?g.r.page:Number.parseInt(str(g.r.page),10);
  rows.push({page:Number.isInteger(n)&&n>=1&&n<=MAX_PAGE_NO?n:0,entry:e,values:best.values,typeGuess});
 }
 if(!rows.length)throw Error('The answer has no rows of the picked equipment types. Check the types picked, copy the prompt again and give it to Copilot.');
 return {brand,rows,ignored};
}

// The pages the rows say they come from, to be read from the datasheet.
export const pagesOf=(read:AiRead)=>[...new Set(read.rows.map(r=>r.page).filter(n=>n>0))].sort((a,b)=>a-b);

// Each row checked against the text of the page it names: a value whose figures (or, with none, its words) are not printed
// there is red, as is a model not printed there. A row with no page, or a page the file does not have, is all red.
export function checkAnswer(read:AiRead,pages:readonly PageEvidence[],file:string):Proposal[] {
 return read.rows.map(r=>{
  const text=pages.find(p=>p.page===r.page)?.text??'',has=onPage(text),words=text.toLowerCase().replace(/\s+/g,' '),compact=words.replace(/ /g,'');
  const printed=(v:AiValue)=>{
   // A code of figures and letters (a frame 100L, IP55) is looked for whole: "100" printed elsewhere is not it.
   const unit=v.printed.replace(/\s*\([^)]*\)/g,'').match(/\d\s*([a-z%°/]{1,4})$/i)?.[1];
   if(/\d[a-z]|[a-z]\d/i.test(v.printed)&&!(unit&&unitOf(unit)))return compact.includes(v.printed.toLowerCase().replace(/\s+/g,''));
   const figures=v.printed.replace(/(\d),(\d)/g,'$1.$2').match(/\d+(?:\.\d+)?/g);
   if(!figures)return words.includes(v.printed.toLowerCase().replace(/\s+/g,' '));
   // An efficiency may be printed as 94.2 % and given as 0.942, or the other way round.
   const pct=v.p.feeds==='efficiency'||v.p.unit.trim()==='%';
   return figures.every(x=>{const n=Number(x);return [String(n),...n<1?[String(+(n*100).toFixed(4))]:[],...pct&&n>1&&n<=100?[String(+(n/100).toFixed(4))]:[]].some(has);});
  };
  const bad=r.values.filter(v=>!v.value||!text||!printed(v));
  const unverified=[...new Set<CatalogueKey>([...verify(r.entry,text).filter(k=>k==='model'||k==='config'),...r.entry.model?[]:['model' as const],...bad.flatMap(v=>v.p.feeds?[v.p.feeds]:[])])];
  const extra=bad.filter(v=>!v.p.feeds).map(v=>v.p.key);
  const said=r.page?pages.some(p=>p.page===r.page)?`page ${r.page}`:`page ${r.page}, which the file does not have`:'no page given';
  return {entry:{...r.entry,source:clip(`${file}, ${r.page?`page ${r.page}`:'no page'} (Copilot)`)},page:pages.some(p=>p.page===r.page)?r.page:0,
   evidence:`Copilot, ${said}: ${r.values.map(v=>`${v.p.label} ${v.printed} ("${v.heading}")`).join(' · ')}`.slice(0,300),unverified,include:true,
   ...extra.length?{unverifiedExtra:extra}:{},...r.typeGuess?{typeGuess:true}:{}};
 });
}
