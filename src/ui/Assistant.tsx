import {useRef,useState} from 'preact/hooks';
import {MessageSquare,Send,Check,X} from 'lucide-preact';
import {project,listSheet,setListRows,notify} from './state';
import {findIssues} from '../engine/issues';
import {clip} from '../engine/sheet';
import {listBrief,askAdvice,type ChatTurn,type Fix} from '../import/ai';
import {useAi} from './AiPicker';

const STARTERS=['Explain this load list: the panels, what feeds what, and what each check means','What is still missing before every cable can be sized?','Which circuits fail, and why?'];
// Chat about the current load list with a model on this computer. It reads a brief built from the engine's results,
// answers, and may propose changes; nothing changes until the engineer ticks them and presses Apply.
export function Assistant({onClose}:{onClose:()=>void}) {
 const {ready,picker}=useAi(),[turns,setTurns]=useState<ChatTurn[]>([]),[fixes,setFixes]=useState<(Fix&{on:boolean})[]>([]),[q,setQ]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),stop=useRef<AbortController|null>(null);
 async function ask(question:string){if(!question.trim()||busy)return;setBusy(true);setNote('');try{
  const s=await ready();if(typeof s==='string'){setNote(s);return;}
  const sheet=listSheet.value,brief=listBrief(sheet.effective,sheet.results,findIssues(sheet.effective,sheet.results)),ctl=new AbortController();stop.current=ctl;
  setNote(`${s.model} is reading the list on this computer…`);
  const a=await askAdvice(s,brief,turns,question,project.value.list.rows,ctl.signal);
  setTurns([...turns,{role:'user',content:question},{role:'assistant',content:a.answer||'(no answer)'}]);setFixes(a.fixes.map(f=>({...f,on:false})));setQ('');
  setNote(a.dropped?`${a.dropped} proposed change${a.dropped===1?' was':'s were'} ignored: not a real row or input column, or a cable run (only you measure runs).`:'');
 }catch(e){setNote(e instanceof Error?e.message:'The local model did not answer.');}finally{stop.current=null;setBusy(false);}}
 // A change applies only to the row it was proposed for: if rows moved since the answer, it is skipped.
 function apply(){const rows=[...project.value.list.rows];let n=0;
  for(const f of fixes){const r=rows[f.row-1];if(!f.on||!r||r.D!==f.to)continue;rows[f.row-1]={...r,[f.col]:clip(f.value)};n++;}
  if(!n){notify('Nothing applied: the rows changed since the answer. Ask again.');return;}
  setListRows(rows);setFixes(fixes.filter(f=>!f.on));notify(`${n} change${n===1?'':'s'} applied. Undo with Ctrl+Z.`);}
 return <section class="panel assistant" aria-label="Ask about this load list">
  <div class="assistant-head"><b><MessageSquare size={15}/>Ask about this load list</b><div class="inline-actions">{picker}<button class="icon-button" aria-label="Close assistant" onClick={onClose}><X size={15}/></button></div></div>
  <p class="muted">Asking a question sends the panel connections, row results and issues to your selected model server on this device. Review and apply the changes you want to keep.</p>
  {turns.length>0&&<ol class="assistant-turns">{turns.map((t,k)=><li key={k} class={t.role}>{t.content}</li>)}</ol>}
  {fixes.length>0&&<div class="assistant-fixes"><b>Proposed changes</b><ul>{fixes.map((f,k)=><li key={k}><label><input type="checkbox" checked={f.on} onChange={e=>{const on=e.currentTarget.checked;setFixes(fixes.map((x,j)=>j===k?{...x,on}:x));}}/><span>Row {f.row} ({f.to||'no To'}) · {f.col} → <i>{f.value}</i>{f.why&&<small> · {f.why}</small>}</span></label></li>)}</ul>
   <button class="button primary small" disabled={!fixes.some(f=>f.on)} onClick={apply}><Check size={14}/>Apply ticked</button></div>}
  {!turns.length&&<div class="inline-actions">{STARTERS.map(s=><button key={s} class="button ghost small" disabled={busy} onClick={()=>void ask(s)}>{s}</button>)}</div>}
  <form class="assistant-ask" onSubmit={e=>{e.preventDefault();void ask(q);}}><input value={q} maxLength={500} placeholder="Ask about a panel, a row or a check…" aria-label="Question" onInput={e=>setQ(e.currentTarget.value)}/>
   {busy?<button type="button" class="button secondary small" onClick={()=>stop.current?.abort()}>Stop</button>:<button class="button primary small" disabled={!q.trim()}><Send size={14}/>Ask</button>}</form>
  {note&&<p class="muted" role="status">{note}</p>}
 </section>;
}
