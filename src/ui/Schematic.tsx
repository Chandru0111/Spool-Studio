import {useEffect,useState} from 'preact/hooks';
import {X,Check,Network,AlertTriangle,Sparkles} from 'lucide-preact';
import {project,setList,notify,listPanel,listFilter,listSearch,selection,inspecting} from './state';
import {clip,isBlankRow,type InputCol} from '../engine/sheet';
import type {SchematicRead} from '../import/schematic-read';
import {askAi} from '../import/ai';
import {useAi} from './AiPicker';

// Review step between the drawing and the sheet: tick the circuits to keep. Worked-out values are italic with their reason.
const COLS:[InputCol,string][]=[['C','From'],['D','To'],['E','Ph'],['F','V'],['G','kW'],['I','PF'],['N','In A'],['O','Cable type'],['P','Cores'],['AC','mm²'],['AD','No.'],['AH','Run m']];
const KIND={circuit:'Circuit',feeder:'Feeder',table:'Schedule',block:'CAD block'} as const;
// Also reviews workbooks holding one load list per panel (workbook): same ticks and italics, "sheet" instead of "page".
export function SchematicReview({read,onClose,workbook=false}:{read:SchematicRead&{columns?:string[]};onClose:()=>void;workbook?:boolean}) {
 const [cands,setCands]=useState(read.candidates),[picked,setPicked]=useState(()=>read.candidates.map(c=>c.include)),count=picked.filter(Boolean).length;
 const {ready,picker}=useAi(),[aiBusy,setAiBusy]=useState(false),[aiNote,setAiNote]=useState('');
 const rows=cands.filter((_,i)=>picked[i]).map(c=>c.row),existing=project.value.list.rows.filter(r=>!isBlankRow(r)).length;
 const worked=cands.reduce((n,c,i)=>n+(picked[i]?Object.keys(c.inferred).length:0),0);
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',esc);return ()=>window.removeEventListener('keydown',esc);},[onClose]);
 const finish=(append:boolean)=>{const next=append?[...project.value.list.rows.filter(r=>!isBlankRow(r)),...rows]:rows;if(next.length>2000){notify('A load list supports at most 2,000 rows.');return;}
  listPanel.value=null;listFilter.value='all';listSearch.value='';selection.value=new Set();inspecting.value=null;setList({rows:next,source:clip(`${read.file} (${workbook?'panels':'schematic'})`)});
  notify(`${rows.length} circuit${rows.length===1?'':'s'} from ${read.file} are on the sheet. Blank cells now show sizing suggestions; review the flagged rows.`);onClose();};
 async function readWithAi(){setAiBusy(true);setAiNote('');try{
  const s=await ready();if(typeof s==='string'){setAiNote(s);return;}
  setAiNote(`Reading with ${s.model} on this computer…`);const r=await askAi(s,read.text);setCands(r.candidates);setPicked(r.candidates.map(c=>c.include));
  setAiNote(`${r.candidates.length} circuit${r.candidates.length===1?'':'s'} read by ${s.model} (local).${r.dropped?` ${r.dropped} value${r.dropped===1?' was':'s were'} dropped: not found in the drawing text.`:''} Every AI value is italic; check each one.`);
 }catch(e){setAiNote(e instanceof Error?e.message:'AI reading failed.');}finally{setAiBusy(false);}}
 return <div class="modal-backdrop"><section class="modal import-modal schematic-modal" role="dialog" aria-modal="true" aria-label="Review circuits from schematic">
  <div class="panel-heading"><div><div class="eyebrow"><Network size={13}/>{workbook?'LOAD LISTS BY PANEL':'LOAD LIST FROM SCHEMATIC'}</div><h2>{read.file}</h2><p>{cands.length} circuits on {read.pages} {workbook?'sheet':'page'}{read.pages===1?'':'s'}{read.ocrPages?` (${read.ocrPages} read by OCR: check numbers carefully)`:''}{read.boards.length?` · boards: ${read.boards.slice(0,12).join(', ')}${read.boards.length>12?'…':''}`:''}</p></div><button class="icon-button" aria-label="Close review" onClick={onClose}><X size={18}/></button></div>
  {read.text.length>0&&<div class="inline-actions">{picker}
   <button class="button secondary small" disabled={aiBusy} onClick={()=>void readWithAi()}><Sparkles size={14}/>{aiBusy?'Reading…':'Read with AI'}</button><span class="muted" role="status">{aiNote||`Read with AI sends the extracted ${workbook?'file':'drawing'} text to your selected model server on this device.`}</span></div>}
  {(read.notes.length>0||worked>0)&&<ul class="schematic-notes">{worked>0&&<li><AlertTriangle size={13}/>{worked} value{worked===1?' was':'s were'} worked out rather than read (italic). Hover a value for its reason.</li>}{read.notes.slice(0,8).map((n,k)=><li key={k}><AlertTriangle size={13}/>{n}</li>)}</ul>}
  {!!read.columns?.length&&<details class="schematic-text"><summary>How the load list's columns were read ({read.columns.length})</summary><pre>{read.columns.join('\n')}</pre></details>}
  {!cands.length&&<div class="schematic-empty"><b>No circuits were recognised.</b> The drawing was read (text below), but no outgoing circuits could be put together from it. Circuits are found from busbars with feeders hanging from them, breaker ratings beside each way, circuit schedule tables, or CAD block attributes. A clearer image (at least 1,500 px wide, dark text) or a PDF exported from CAD reads best.</div>}
  {cands.length>0&&<div class="table-scroll schematic-table"><table><thead><tr><th><input type="checkbox" aria-label="Include all circuits" checked={count===cands.length} onChange={e=>{const v=e.currentTarget.checked;setPicked(cands.map(()=>v));}}/></th><th>{workbook?'Sheet':'Pg'}</th><th>Found as</th>{COLS.map(([c,l])=><th key={c}>{l}</th>)}<th>Read from</th></tr></thead>
   <tbody>{cands.map((c,i)=><tr key={i} class={picked[i]?'':'off'}><td><input type="checkbox" aria-label={`Include ${c.row.C} to ${c.row.D}`} checked={picked[i]} onChange={e=>{const v=e.currentTarget.checked;setPicked(p=>p.map((x,k)=>k===i?v:x));}}/></td><td>{c.page}</td><td><span class={`badge ${c.kind==='feeder'?'feeder':''}`}>{KIND[c.kind]}</span></td>
    {COLS.map(([col])=>{const why=c.inferred[col];return <td key={col} class={why?'inferred':''} title={why?`Worked out: ${why}`:undefined}>{c.row[col]||<span class="muted">—</span>}</td>;})}
    <td class="evidence" title={c.evidence}>{c.evidence}</td></tr>)}</tbody></table></div>}
  {read.text.length>0&&<details class="schematic-text" open={!cands.length}><summary>Text read from the {workbook?'file':'drawing'} ({read.text.length} line{read.text.length===1?'':'s'})</summary><pre>{read.text.join('\n')}</pre></details>}
  <div class="modal-actions"><span class="muted">{count} of {cands.length} ticked. Anything not in the {workbook?'file':'drawing'} stays blank for you or the suggestions; cable runs are never guessed.</span><button class="button secondary small" onClick={onClose}>Cancel</button>{existing>0&&<button class="button secondary small" disabled={!count} onClick={()=>finish(true)}>Add to current list</button>}<button class="button primary small" disabled={!count} onClick={()=>finish(false)}><Check size={15}/>{existing?'Replace list':`Create load list (${count})`}</button></div>
 </section></div>;
}
