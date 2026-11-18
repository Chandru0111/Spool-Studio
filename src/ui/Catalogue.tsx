import {useRef,useState} from 'preact/hooks';
import {Upload,Plus,FileSpreadsheet,Trash2,ScanText,X,Check,Sparkles,Search,Network} from 'lucide-preact';
import {project,setLoads,notify} from './state';
import {useAi} from './AiPicker';
import {CATALOGUE_KEYS,emptyEntry,unique,sameText,type CatalogueKey} from '../engine/loads';
import {clip,MAX_CELL} from '../engine/sheet';
import {readTables} from '../import/load-list';
import {readCatalogue} from '../import/document';
import {askEquipment} from '../import/ai';
import {readEquipment,mergeCatalogue,catalogueFromPages,parseEquipmentReply,type Proposal} from '../import/equipment';
import {exportCatalogue} from '../export/equipment';
import type {PageEvidence} from '../store/schema';

const HEADS:Record<CatalogueKey,string>={brand:'Brand',model:'Model / Part Number',config:'Configuration',ratedKw:'Rated Input Power (kW)',protA:'Protection Device Rating (A)',inA:'In (A)',un:'Un',efficiency:'Efficiency',pf:'Power Factor',source:'Source'};
const REVIEW=['model','config','ratedKw','protA','inA','un','efficiency','pf'] as const;
// shortcut: shows the first 300 matching entries only; add paging if catalogues grow past a few thousand.
const SHOWN=300;
const message=(e:unknown,fallback:string)=>e instanceof Error?e.message:fallback;
type Read={file:string;pages:PageEvidence[];ocr:number;proposals:Proposal[];brand:string};

// Every value read from a PDF is shown with the line it came from; nothing reaches the catalogue until it is ticked and added.
function Review({read,setRead,onClose}:{read:Read;setRead:(r:Read)=>void;onClose:()=>void}) {
 const {ready,picker}=useAi(),[busy,setBusy]=useState(false),stop=useRef<AbortController|null>(null);
 const rows=read.proposals,picked=rows.filter(p=>p.include),unchecked=picked.reduce((a,p)=>a+p.unverified.length,0);
 // A value the engineer typed is theirs: it is no longer flagged as unchecked.
 const edit=(i:number,k:CatalogueKey,v:string)=>setRead({...read,proposals:rows.map((p,j)=>j===i?{...p,entry:{...p.entry,[k]:clip(v)},unverified:p.unverified.filter(x=>x!==k)}:p)});
 async function ai(){
  const s=await ready();if(typeof s==='string'){notify(s);return;}
  const ctl=new AbortController();stop.current=ctl;setBusy(true);
  try{const found=parseEquipmentReply(await askEquipment(s,read.pages,ctl.signal),read.pages,read.file);setRead({...read,proposals:found});notify(`The local model read ${found.length} entries. Values not found on their page are marked red.`);}
  catch(e){notify(message(e,'The local model could not read the file.'));}finally{setBusy(false);stop.current=null;}
 }
 function add(){
  const brand=clip(read.brand.trim());if(!brand){notify('Enter the brand for these entries.');return;}
  try{const m=mergeCatalogue(project.value.loads.catalogue,picked.map(p=>({...p.entry,brand})));setLoads({catalogue:m.catalogue});notify(`Added ${m.added} catalogue entries${m.replaced?` and replaced ${m.replaced}`:''} from ${read.file}.`);onClose();}
  catch(e){notify(message(e,'Could not add the entries.'));}
 }
 return <div class="modal-backdrop"><section class="modal schematic-modal" role="dialog" aria-modal="true" aria-label="Review datasheet entries">
  <div class="panel-heading"><div><div class="eyebrow">READ DATASHEET</div><h2>{read.file}</h2><p>{read.pages.length} page{read.pages.length===1?'':'s'} read{read.ocr?`, ${read.ocr} by OCR (check numbers carefully)`:''}. Tick the rows to add and fix anything misread. Red values were not found on the page they came from.</p></div><button class="icon-button" aria-label="Close" onClick={onClose}><X size={18}/></button></div>
  <div class="import-source"><label class="field"><span>Brand</span><input value={read.brand} maxLength={MAX_CELL} placeholder="Manufacturer name" onInput={e=>setRead({...read,brand:e.currentTarget.value})}/></label>
   <div class="ai-read">{picker}<button class="button secondary small" disabled={busy} onClick={()=>void ai()}><Sparkles size={14}/>{busy?'Reading…':'Read with local AI'}</button>{busy&&<button class="button ghost small" onClick={()=>stop.current?.abort()}>Cancel</button>}</div></div>
  <div class="schematic-table"><table><thead><tr><th><span class="visually-hidden">Add</span></th>{REVIEW.map(k=><th key={k}>{HEADS[k]}</th>)}<th>Page</th><th>Read from</th></tr></thead>
   <tbody>{rows.map((p,i)=><tr key={i} class={p.include?'':'off'}><td><input type="checkbox" checked={p.include} aria-label={`Add row ${i+1}`} onChange={e=>{const on=e.currentTarget.checked;setRead({...read,proposals:rows.map((x,j)=>j===i?{...x,include:on}:x)});}}/></td>
    {REVIEW.map(k=><td key={k} class={`cell ${p.unverified.includes(k)?'bad':''}`} title={p.unverified.includes(k)?`Not found on page ${p.page||'?'}. Check the PDF.`:undefined}><input value={p.entry[k]} aria-label={`${HEADS[k]}, row ${i+1}`} maxLength={MAX_CELL} onInput={e=>edit(i,k,e.currentTarget.value)}/></td>)}
    <td>{p.page||'—'}</td><td class="evidence" title={p.evidence}>{p.evidence}</td></tr>)}</tbody></table>
   {!rows.length&&<p class="sheet-empty">No labelled values found (rated power in kW, current in A, voltage, efficiency or power factor next to a model or article number). Try Read with local AI, or add a row and type the values from the PDF.</p>}</div>
  <div class="modal-actions"><span class="muted">{picked.length} to add{unchecked?` · ${unchecked} values to check`:''}</span>
   <button class="button secondary small" onClick={()=>setRead({...read,proposals:[...rows,{entry:{...emptyEntry(),source:clip(`${read.file} (typed)`)},page:0,evidence:'',unverified:[],include:true}]})}><Plus size={14}/>Add row</button>
   <button class="button secondary small" onClick={onClose}>Cancel</button><button class="button primary small" disabled={!picked.length||!read.brand.trim()} onClick={add}><Check size={15}/>Add to catalogue</button></div>
 </section></div>;
}

export function Catalogue() {
 const cat=project.value.loads.catalogue,book=useRef<HTMLInputElement>(null),pdf=useRef<HTMLInputElement>(null),stop=useRef<AbortController|null>(null);
 const [busy,setBusy]=useState(''),[read,setRead]=useState<Read|null>(null),[brand,setBrand]=useState(''),[q,setQ]=useState('');
 const brands=unique(cat.map(c=>c.brand)),find=q.trim().toLowerCase();
 const shown=cat.map((e,i)=>({e,i})).filter(({e})=>(!brand||sameText(e.brand,brand))&&(!find||CATALOGUE_KEYS.some(k=>e[k].toLowerCase().includes(find))));
 const set=(i:number,k:CatalogueKey,v:string)=>{const next=[...cat];next[i]={...next[i]!,[k]:clip(v)};setLoads({catalogue:next},`cat:${i}:${k}`);};
 async function openBook(f:File){
  setBusy('Reading the catalogue…');
  try{const r=readEquipment(await readTables(f),f.name);if(!r.catalogue.length)throw Error('No catalogue rows found. The sheet needs a Model / Part Number column; sheets named "Brand (Name)" take the brand from their name.');
   const m=mergeCatalogue(cat,r.catalogue);setLoads({catalogue:m.catalogue});notify(`Read ${r.catalogue.length} catalogue entries from ${f.name}: ${m.added} new, ${m.replaced} updated.`);}
  catch(e){notify(message(e,'Could not read the catalogue.'));}finally{setBusy('');if(book.current)book.current.value='';}
 }
 async function openPdf(f:File){
  const ctl=new AbortController();stop.current=ctl;setBusy('Reading the datasheet…');
  try{const doc=await readCatalogue(f,p=>setBusy(p.message),ctl.signal);setRead({file:f.name,pages:doc.pages,ocr:doc.pages.filter(p=>p.mode==='ocr').length,proposals:catalogueFromPages(doc.pages,f.name),brand});}
  catch(e){notify(message(e,'Could not read the datasheet.'));}finally{setBusy('');stop.current=null;if(pdf.current)pdf.current.value='';}
 }
 return <>
  <input ref={book} class="visually-hidden" type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label="Choose catalogue workbook" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void openBook(f);}}/>
  <input ref={pdf} class="visually-hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" aria-label="Choose datasheet" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void openPdf(f);}}/>
  {read&&<Review read={read} setRead={setRead} onClose={()=>setRead(null)}/>}
  {busy&&<div class="reading-bar" role="status"><Network size={15}/><span>{busy}</span>{stop.current&&<button class="button secondary small" onClick={()=>stop.current?.abort()}>Cancel</button>}</div>}
  <div class="sheet-section-head"><div><h2>Brand catalogue</h2><p>One row per Brand + Model + Configuration. A load list row that picks them fills in the rest. Saved with the project; export it to reuse in other projects.</p></div>
   <div class="page-actions"><button class="button secondary small" disabled={!!busy} onClick={()=>book.current?.click()}><Upload size={15}/>Import catalogue</button>
    <button class="button secondary small" disabled={!!busy} onClick={()=>pdf.current?.click()} title="PDF or scanned image; text is read on this computer"><ScanText size={15}/>Read datasheet</button>
    <button class="button secondary small" onClick={()=>{setLoads({catalogue:[...cat,{...emptyEntry(),brand}]});setQ('');}}><Plus size={15}/>Add entry</button>
    <button class="button secondary small" disabled={!cat.length} onClick={()=>void exportCatalogue(cat,project.value.name).catch((e:unknown)=>notify(message(e,'Export failed.')))}><FileSpreadsheet size={15}/>Export catalogue</button></div></div>
  <div class="toolbar">{brands.length>1&&<label class="panel-pick"><span class="visually-hidden">Brand</span><select value={brand} onChange={e=>setBrand(e.currentTarget.value)}><option value="">All brands ({cat.length})</option>{brands.map(b=><option key={b} value={b}>{b} ({cat.filter(c=>sameText(c.brand,b)).length})</option>)}</select></label>}
   <label class="search"><Search size={14}/><input value={q} placeholder="Find model, configuration…" aria-label="Find catalogue entries" onInput={e=>setQ(e.currentTarget.value)}/></label>
   {shown.length>SHOWN&&<span class="muted">Showing the first {SHOWN} of {shown.length}. Filter by brand or search to see the rest.</span>}</div>
  {cat.length?<div class="sheet-scroll tall"><table class="sheet catalogue-sheet" aria-label="Brand catalogue">
   <colgroup>{CATALOGUE_KEYS.map(k=><col key={k} style={{width:`${({brand:120,model:200,config:180,un:160,source:260} as Partial<Record<CatalogueKey,number>>)[k]??92}px`}}/>)}<col style={{width:'36px'}}/></colgroup>
   <thead><tr class="heads">{CATALOGUE_KEYS.map(k=><th key={k} class="input" scope="col"><span>{HEADS[k]}</span></th>)}<th class="calc"><span class="visually-hidden">Row tools</span></th></tr></thead>
   <tbody>{shown.slice(0,SHOWN).map(({e,i})=><tr key={i}>{CATALOGUE_KEYS.map(k=><td key={k} class={['ratedKw','protA','inA','efficiency','pf'].includes(k)?'num':''}><input value={e[k]} aria-label={`${HEADS[k]}, entry ${i+1}`} maxLength={MAX_CELL} autoComplete="off" spellcheck={false} onInput={ev=>set(i,k,ev.currentTarget.value)}/></td>)}
    <td class="row-tools"><button class="icon-button danger" aria-label={`Delete entry ${i+1}`} title="Delete entry" onClick={()=>setLoads({catalogue:cat.filter((_,j)=>j!==i)})}><Trash2 size={13}/></button></td></tr>)}</tbody>
  </table>{!shown.length&&<p class="sheet-empty">No entries match.</p>}</div>
  :<section class="panel list-empty"><ScanText size={26}/><h2>No catalogue yet</h2><p>Import a catalogue workbook (sheets named "Brand (Name)" or any sheet with a Model / Part Number column), read a manufacturer's PDF datasheet, or add entries by hand.</p>
   <p>PDFs are read on this computer: the text layer first, OCR for scanned pages, and optionally a local AI model. You check every value before it is added.</p></section>}
 </>;
}
