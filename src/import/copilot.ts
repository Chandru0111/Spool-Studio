import {clip} from '../engine/sheet';
import {emptyEntry,type CatalogueKey,type CatalogueRow} from '../engine/loads';
import type {EquipmentType,Param} from '../engine/equipment-types';
import type {PageEvidence} from '../store/schema';
import {inColumn,onPage,reading,verify,type Proposal} from './equipment';
import {valueIn} from './vocabulary';

// A datasheet read by the organisation's own AI chat (Copilot or another it allows): the engineer gives it the PDF with the
// prompt below and pastes back the JSON it answers. The answer is never trusted. Only the picked types' ticked parameters
// are taken, each value must be printed on the page the answer names or it is red in the review, and the review's sums are
// worked out as for any other read. This website runs no AI and sends nothing anywhere.
export const MAX_ANSWER=1_000_000,MAX_AI_ROWS=1000;
const MAX_PAGE_NO=10_000;

// Keys and labels compared without case, spaces or signs: "rated-output", "Rated output" and "rated_output" are one.
const plain=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'');
const str=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):'';
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

// pages: the pages the engineer wants read, as "12, 40-45", or empty for the whole file.
export function copilotPrompt(types:readonly EquipmentType[],pages=''):string {
 const first=types[0],keys=first?.params.slice(0,2).map(p=>`"${p.key}":"…${p.unit?` ${p.unit}`:''}"`).join(',')??'';
 return [
  'Read the attached datasheet and give me its ratings as JSON. Reply with the JSON only, with no other text.',
  '',
  `{"brand":"…","rows":[{"page":1,"type":"${first?.id??'…'}","model":"…","config":"…","values":{${keys}}}]}`,
  '',
  'Rules:',
  '1. Make one row for each product and rating. A table of 20 models gives 20 rows. Never skip, merge or summarise rows.',
  '2. Copy each value exactly as it is printed, with its unit. Never calculate, convert, round or guess a value. Leave out a value that is not printed for that row.',
  '3. "page" is the page of the PDF file that the row\'s values are printed on. The first page of the file is 1. Do not use the page number printed on the page.',
  '4. "model" is the model, type or part number exactly as printed.',
  '5. "config" tells apart rows of the same model: the voltage, frequency, poles or duty its values are for, for example "400 V, 50 Hz, 4-pole". When a table gives values for several voltages or duties, make one row for each.',
  '6. "type" is the id of the equipment type below that the row is.',
  '7. In "values", use only the keys listed below.',
  ...pages?[`8. Read only these pages of the PDF: ${pages}.`]:[],
  '',
  'Equipment types and the values to read:',
  ...types.flatMap(t=>[`type "${t.id}" (${t.name.trim()||'unnamed'}):`,...t.params.filter(p=>p.label.trim()).map(p=>`  "${p.key}": ${p.label.trim()}${p.unit?`, in ${p.unit}`:''}`)]),
 ].join('\n');
}

// One row of the answer, as the answer gives it: the page, and each value as printed with the parameter it is for.
// value: the value as the catalogue holds it, or '' when it is not a value of that parameter ("n/a", hp for a voltage).
export type AiValue={p:Param;printed:string;value:string};
export type AiRow={page:number;entry:CatalogueRow;values:AiValue[];typeGuess:boolean};
// ignored: values in the answer that are not one of the picked types' ticked parameters, and rows with nothing to take.
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

// A value in the unit the catalogue holds it in. A bare figure is in the unit the prompt asked for.
function inUnit(p:Param,printed:string):string {
 const asked=p.unit.trim(),text=asked&&/^[<>~≤≥±]?\s*\d[\d.,\s/–-]*$/.test(printed)?`${printed} ${asked}`:printed;
 const got=valueIn(reading(p),text);if(!got)return '';
 return p.feeds?inColumn(p.feeds,got.value):clip(got.value);
}

// Reads a pasted answer into rows of the picked types. Throws, with what to do, when it cannot be read at all.
export function readAnswer(text:string,types:readonly EquipmentType[]):AiRead {
 if(!types.length)throw Error('Pick the equipment types first.');
 const data=jsonIn(text),list=Array.isArray(data)?data:isObject(data)&&Array.isArray(data.rows)?data.rows:null;
 if(!list)throw Error('The answer has no "rows" list. Copy the prompt again and give it to Copilot unchanged.');
 if(list.length>MAX_AI_ROWS)throw Error(`The answer has more than ${MAX_AI_ROWS} rows. Ask Copilot for fewer pages at a time.`);
 const brand=isObject(data)?clip(str(data.brand)):'',rows:AiRow[]=[];let ignored=0;
 const paramOf=(t:EquipmentType,k:string)=>t.params.find(p=>plain(p.key)===k)??t.params.find(p=>p.label.trim()&&plain(p.label)===k);
 for(const r of list){
  if(!isObject(r)){ignored++;continue;}
  // The values, under "values" as asked, or beside the row's own fields when the answer flattened them.
  const given=Object.entries(isObject(r.values)?r.values:Object.fromEntries(Object.entries(r).filter(([k])=>!['page','type','model','config','brand'].includes(k))))
   .map(([k,v])=>[plain(k),clip(str(v))] as const).filter(([k,v])=>k&&v);
  // The type the answer names, else the picked type most of its values are parameters of.
  let t=types.find(x=>x.id===str(r.type)),typeGuess=false;
  if(!t){const score=types.map(x=>given.filter(([k])=>paramOf(x,k)).length),top=Math.max(...score);t=types[score.indexOf(top)]!;typeGuess=types.length>1&&score.filter(s=>s===top).length>1;}
  const e={...emptyEntry(),type:t.id},values:AiValue[]=[];
  e.model=clip(str(r.model));e.config=clip(str(r.config));
  for(const [k,printed] of given){
   const p=paramOf(t,k);if(!p){ignored++;continue;}
   const value=inUnit(p,printed);values.push({p,printed,value});
   // A value that is not one of the parameter is kept as printed, so the engineer sees it (red) and can type it.
   if(p.feeds)e[p.feeds]=value||printed;else e.extra={...e.extra,[p.key]:value||printed};
  }
  if(!e.model&&!values.length){ignored++;continue;}
  const n=typeof r.page==='number'?r.page:Number.parseInt(str(r.page),10);
  rows.push({page:Number.isInteger(n)&&n>=1&&n<=MAX_PAGE_NO?n:0,entry:e,values,typeGuess});
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
  const text=pages.find(p=>p.page===r.page)?.text??'',has=onPage(text),words=text.toLowerCase().replace(/\s+/g,' ');
  const printed=(v:AiValue)=>{
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
   evidence:`Copilot, ${said}: ${r.values.map(v=>`${v.p.label} ${v.printed}`).join(' · ')}`.slice(0,300),unverified,include:true,
   ...extra.length?{unverifiedExtra:extra}:{},...r.typeGuess?{typeGuess:true}:{}};
 });
}
