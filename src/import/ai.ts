import {emptyRow,clip,INPUT_COLS,type InputCol,type RowResult,type SheetRow} from '../engine/sheet';
import type {Issue} from '../engine/issues';
import {cleanValue} from './load-list';
import type {Candidate} from './schematic';

// Optional AI reading of drawing text by a model running on the user's own computer (Ollama or LM Studio, OpenAI-style API).
// Nothing leaves the machine. The AI only proposes values: a value is kept only when its quote is found in the drawing text
// and the value itself appears in that quote, so nothing the drawing does not say (cable length included) reaches the sheet.
// The sheet engine still does every calculation.
export type AiSettings={url:string;model:string};
export const AI_DEFAULT:AiSettings={url:'http://127.0.0.1:11434/v1',model:''};
export const AI_MAX_CHARS=60000;
const FIELDS:[string,InputCol][]=[['from','C'],['to','D'],['phases','E'],['voltage','F'],['kw','G'],['pf','I'],['breakerA','N'],['cores','P'],['sizeMm2','AC'],['cables','AD'],['lengthM','AH']];
// Only the local machine: the CSP allows exactly these hosts, so a typed remote URL cannot leak drawing text.
export const isLocalUrl=(url:string)=>/^http:\/\/(127\.0\.0\.1|localhost):(11434|1234)\/v1\/?$/.test(url.trim());

export const aiPrompt=(text:readonly string[])=>`You read text taken from an electrical single-line diagram, DB schematic or circuit schedule.
List every outgoing cable circuit as JSON: {"circuits":[{"from":"","to":"","phases":"","voltage":"","kw":"","pf":"","breakerA":"","cores":"","sizeMm2":"","cables":"","lengthM":"","quote":""}]}.
Rules: copy values exactly as printed; leave a field "" when the text does not state it; never estimate or calculate (especially lengthM);
"quote" is the shortest exact span of the text below that contains every value you filled for that circuit. Reply with the JSON only.
TEXT:
${text.join('\n').slice(0,AI_MAX_CHARS)}`;

const flat=(s:string)=>s.toLowerCase().replace(/\s+/g,'');
export function aiCandidates(content:string,text:readonly string[]):{candidates:Candidate[];dropped:number} {
 let data:unknown;
 try{data=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1));}catch{throw Error('The AI reply was not valid JSON. Try again or pick a larger model.');}
 const list=(data as {circuits?:unknown}|null)?.circuits;if(!Array.isArray(list))throw Error('The AI reply had no circuit list.');
 const source=flat(text.join('\n').slice(0,AI_MAX_CHARS));let dropped=0;const candidates:Candidate[]=[];
 for(const item of list.slice(0,2000)){
  if(!item||typeof item!=='object')continue;
  const get=(k:string)=>{const v=(item as Record<string,unknown>)[k];return typeof v==='string'||typeof v==='number'?String(v).trim():'';};
  const quote=get('quote'),q=flat(quote),found=q.length>0&&source.includes(q),row=emptyRow(),inferred:Candidate['inferred']={};
  for(const [key,col] of FIELDS){const raw=get(key);if(!raw)continue;
   if(!found||!q.includes(flat(raw))){dropped++;continue;}
   row[col]=cleanValue(col,raw,row);inferred[col]=clip(`AI read from "${quote}"`);}
  if(row.D||row.G)candidates.push({row,page:1,kind:'circuit',evidence:clip(quote),inferred,include:true});
 }
 return {candidates,dropped};
}

const base=(s:AiSettings)=>s.url.trim().replace(/\/$/,'');
const call=async(url:string,init:RequestInit)=>{
 if(!isLocalUrl(url.replace(/\/(models|chat\/completions)$/,'')))throw Error('AI reading only talks to a model on this computer: Ollama (http://127.0.0.1:11434/v1) or LM Studio (http://127.0.0.1:1234/v1).');
 try{return await fetch(url,init);}catch{throw Error('No local model answered. Start Ollama (or LM Studio\'s server) and allow this site in its settings.');}
};
export async function aiModels(s:AiSettings):Promise<string[]> {
 const res=await call(`${base(s)}/models`,{});if(!res.ok)throw Error(`The local model server answered ${res.status}.`);
 const body=await res.json() as {data?:{id?:unknown}[]};return (body.data??[]).map(m=>m.id).filter((id):id is string=>typeof id==='string');
}
export type ChatTurn={role:'system'|'user'|'assistant';content:string};
async function chat(s:AiSettings,messages:readonly ChatTurn[],signal?:AbortSignal):Promise<string> {
 if(!s.model)throw Error('Pick a local model first.');
 const res=await call(`${base(s)}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},...(signal?{signal}:{}),
  body:JSON.stringify({model:s.model,temperature:0,messages})});
 if(!res.ok)throw Error(`The local model answered ${res.status}. Check the model name.`);
 const content=(await res.json() as {choices?:{message?:{content?:unknown}}[]}).choices?.[0]?.message?.content;
 if(typeof content!=='string')throw Error('The local model sent an empty reply.');
 return content;
}
export async function askAi(s:AiSettings,text:readonly string[],signal?:AbortSignal):Promise<{candidates:Candidate[];dropped:number}> {
 return aiCandidates(await chat(s,[{role:'user',content:aiPrompt(text)}],signal),text);
}

// The load-list assistant: the model reads a plain-text brief of the sheet (every number in it comes from the engine)
// and answers questions. It may propose fixes, which the engineer ticks before anything changes. Never a cable run (AH).
const num=(v:unknown)=>typeof v==='number'?String(+v.toFixed(2)):String(v??'');
export function listBrief(rows:readonly SheetRow[],results:readonly RowResult[],issues:readonly Issue[]):string {
 const used=rows.map((r,i)=>i).filter(i=>results[i]?.cells.A!==''),key=(s:string)=>s.trim().toLowerCase();
 const feeder=new Map<string,number>();used.forEach(i=>{const d=key(rows[i]!.D);if(d&&!feeder.has(d))feeder.set(d,i);});
 const panels=new Map<string,number[]>();used.forEach(i=>{const c=rows[i]!.C.trim();if(c)panels.set(c,[...(panels.get(c)??[]),i]);});
 const tree=[...panels].map(([p,ids])=>{const f=feeder.get(key(p)),kw=ids.reduce((a,i)=>a+(typeof results[i]?.cells.G==='number'?results[i]!.cells.G as number:0),0);
  return `${p}: ${ids.length} outgoing cable${ids.length===1?'':'s'} (rows ${ids.map(i=>i+1).join(', ').slice(0,200)}), ${num(kw)} kW; ${f===undefined?'its own feeder is not on the sheet':`fed by row ${f+1} from ${rows[f]!.C.trim()||'(no From)'}`}`;});
 const line=(i:number)=>{const r=rows[i]!,c=results[i]!.cells;
  return `row ${i+1}: ${r.C||'(no From)'} → ${r.D||'(no To)'} | ${r.E||'?'}ph ${r.F||'?'}V ${r.G||'?'}kW div ${r.H||'1'} PF ${r.I||'?'} | breaker ${r.N||'?'}A | ${r.O||'?'} ${r.P||''} ${r.Q.split(' ')[0]||'?'} ${r.AC||'?'}mm² x${r.AD||'?'} | run ${r.AH||'MISSING'}m | Ib ${num(c.M)}A Iz ${num(c.AF)}A ${num(c.AG)} | VD ${num(c.AK)}% total ${num(c.AL)}% limit ${r.AM||'?'}% ${num(c.AN)}`;};
 const flagged=new Set(issues.filter(x=>x.level!=='info').map(x=>x.row)),order=[...used.filter(i=>flagged.has(i)),...used.filter(i=>!flagged.has(i))];
 const head=`SPOOL STUDIO LOAD LIST BRIEF
Each row is one cable. From (C) is the panel the cable leaves (switchboard, MCC or DB); To (D) is the load or downstream panel it feeds.
Loads hang off DBs/MCCs, which hang off switchboards: a row whose To names a panel is that panel's feeder, and a circuit's total voltage drop adds its feeder's total.
The app sizes every row like the engineer's Excel workbook (SS 638 / IEC 60364): Ib design current, Iz cable rating after factors, current check Ib ≤ In ≤ Iz, VD = this cable's voltage drop, total = VD plus everything upstream, checked against the limit. "?" means blank; blank inputs may show the app's suggestions.
PANELS:
${tree.join('\n')||'(no From values yet)'}
ISSUES:
${issues.filter(x=>x.level!=='info').slice(0,150).map(x=>`row ${x.row+1} ${x.col}: ${x.text}`).join('\n')||'(none)'}
ROWS (${used.length} circuits${flagged.size?', flagged rows first':''}):
`;
 let body='',shown=0;for(const i of order){const l=line(i)+'\n';if(head.length+body.length+l.length>AI_MAX_CHARS)break;body+=l;shown++;}
 return head+body+(shown<order.length?`(${order.length-shown} more rows not shown: ask about a panel or row to see them)\n`:'');
}
export type Fix={row:number;col:InputCol;value:string;why:string;to:string};
const FIXABLE:readonly InputCol[]=INPUT_COLS.filter(c=>c!=='AH');// cable runs are measured by the engineer, never proposed
export const advicePrompt=(brief:string)=>`You help an electrical engineer understand and complete the load list below before cable sizing.
Use only this brief. Every number in it was calculated by the app; never calculate cable sizes yourself and never invent values.
Never propose a cable run length (AH): only the engineer measures runs.
Reply with JSON only: {"answer":"plain-English reply","fixes":[{"row":12,"col":"C","value":"DB-L1","why":"short reason from the brief"}]}
Columns you may fix: ${FIXABLE.join(', ')}. Propose a fix only when the brief gives a clear reason (for example a From that names no panel on the sheet, or phases the voltage implies); otherwise "fixes" is [].
${brief}`;
export function parseAdvice(content:string,rows:readonly SheetRow[]):{answer:string;fixes:Fix[];dropped:number} {
 let data:{answer?:unknown;fixes?:unknown};
 try{data=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1)) as typeof data;}catch{return {answer:content.trim(),fixes:[],dropped:0};}
 const fixes:Fix[]=[];let dropped=0;
 for(const f of Array.isArray(data.fixes)?data.fixes.slice(0,200):[]){
  const o=(f??{}) as Record<string,unknown>,row=Number(o.row),col=String(o.col??'').toUpperCase() as InputCol,target=rows[row-1],raw=typeof o.value==='string'||typeof o.value==='number'?String(o.value).trim():'';
  if(!Number.isInteger(row)||!target||!FIXABLE.includes(col)||!raw){dropped++;continue;}
  const value=cleanValue(col,raw,target);if(value===target[col])continue;
  fixes.push({row,col,value:clip(value),why:clip(typeof o.why==='string'?o.why:''),to:target.D});
 }
 return {answer:typeof data.answer==='string'?data.answer.trim():'',fixes,dropped};
}
export async function askAdvice(s:AiSettings,brief:string,history:readonly ChatTurn[],question:string,rows:readonly SheetRow[],signal?:AbortSignal) {
 return parseAdvice(await chat(s,[{role:'system',content:advicePrompt(brief)},...history.slice(-6),{role:'user',content:question}],signal),rows);
}
