import {useEffect,useRef,useState} from 'preact/hooks';
import {Upload,Plus,FileSpreadsheet,Trash2,ScanText,X,Check,Sparkles,Search,Network,ClipboardPaste,ExternalLink} from 'lucide-preact';
import {project,setLoads,notify} from './state';
import {useAi} from './AiPicker';
import {CATALOGUE_KEYS,emptyEntry,unique,sameText,type CatalogueKey} from '../engine/loads';
import {clip,MAX_CELL} from '../engine/sheet';
import {readTables} from '../import/load-list';
import {readCatalogue,renderPage,closePage} from '../import/document';
import {askEquipment} from '../import/ai';
import {readEquipment,mergeCatalogue,parseEquipmentReply,locate,type Proposal} from '../import/equipment';
import {catalogueFromDatasheet,catalogueFromWeb,pageText,redirectTarget,MAX_PAGE} from '../import/webpage';
import {exportCatalogue} from '../export/equipment';
import type {PageEvidence} from '../store/schema';
import type {PositionedLine} from '../import/parse';

const HEADS:Record<CatalogueKey,string>={brand:'Brand',model:'Model / Part Number',config:'Configuration',ratedKw:'Rated Input Power (kW)',protA:'Protection Device Rating (A)',inA:'In (A)',un:'Un',efficiency:'Efficiency',pf:'Power Factor',source:'Source'};
const REVIEW=['model','config','ratedKw','protA','inA','un','efficiency','pf'] as const;
// shortcut: shows the first 300 matching entries only; add paging if catalogues grow past a few thousand.
const SHOWN=300;
const message=(e:unknown,fallback:string)=>e instanceof Error?e.message:fallback;
// pdf and layout: the PDF read and its text positions, kept while reviewing so a row can be shown on its page.
type Read={file:string;pages:PageEvidence[];ocr:number;proposals:Proposal[];brand:string;pdf?:File;layout?:Map<number,PositionedLine[]>};
const MARK:Record<CatalogueKey,string>={brand:'Brand',model:'Model',config:'Config',ratedKw:'kW',protA:'Prot. A',inA:'In',un:'Un',efficiency:'η',pf:'PF',source:'Source'};

// The page a row was read from with a box round each value taken from it, so the engineer sees exactly where it came from.
function PageView({file,p,lines,onClose}:{file:File;p:Proposal;lines:readonly PositionedLine[]|undefined;onClose:()=>void}) {
 const canvas=useRef<HTMLCanvasElement>(null),wrap=useRef<HTMLDivElement>(null),[marks,setMarks]=useState<{key:CatalogueKey;style:string}[]|null>(null),[error,setError]=useState('');
 const exact=!!p.boxes?.length;
 useEffect(()=>{
  const c=canvas.current;if(!c)return;let live=true;setMarks(null);setError('');
  const boxes=p.boxes?.length?p.boxes:locate(p.entry,lines??[]);
  // Rendered at up to twice screen size for sharp text; boxes are placed in percent so they follow the canvas as it scales.
  renderPage(file,p.page,c,Math.min(2400,Math.round(1000*devicePixelRatio))).then(map=>{if(!live)return;
   setMarks(boxes.map(b=>{const [x0=0,y0=0,x1=0,y1=0]=map([b.x0-1,b.y-b.h*0.3,b.x1+1,b.y+b.h*0.95]),pc=(v:number,of:number)=>`${(v/of*100).toFixed(3)}%`;
    return {key:b.key,style:`left:${pc(Math.min(x0,x1),c.width)};top:${pc(Math.min(y0,y1),c.height)};width:${pc(Math.abs(x1-x0),c.width)};height:${pc(Math.abs(y1-y0),c.height)}`};}));
  },(e:unknown)=>{if(live)setError(message(e,'Could not show the page.'));});
  return ()=>{live=false;};
 },[file,p,lines]);
 // Only the page scrolls to the first box; scrollIntoView would also scroll the dialog and hide its heading.
 useEffect(()=>{const w=wrap.current,m=w?.querySelector<HTMLElement>('.page-mark');if(w&&m)w.scrollTop=m.offsetTop-w.clientHeight/2;},[marks]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();onClose();}};addEventListener('keydown',key,true);return ()=>removeEventListener('keydown',key,true);},[onClose]);
 return <div class="modal-backdrop"><section class="modal schematic-modal page-view" role="dialog" aria-modal="true" aria-label={`Page ${p.page} of the datasheet`}>
  <div class="panel-heading"><div><div class="eyebrow">PAGE {p.page}</div><h2>{p.entry.model||'Row without a model'}</h2>
   <p>{exact?'Each box is where a value in this row was printed.':'This row was read without positions, so every place its values are printed on the page is boxed. Some boxes may belong to other rows.'}{marks&&!marks.length?' None of its values were found on the page.':''}</p>
   {p.note&&<p class="page-note">{p.note}</p>}</div><button class="icon-button" aria-label="Close page" onClick={onClose}><X size={18}/></button></div>
  {error&&<p class="sheet-empty">{error}</p>}
  <div class="page-scroll" ref={wrap}><div class="page-canvas"><canvas ref={canvas}/>{marks?.map((m,k)=><span key={k} class="page-mark" style={m.style}><b>{MARK[m.key]}</b></span>)}</div></div>
 </section></div>;
}

// Every value read from a PDF is shown with the line it came from; nothing reaches the catalogue until it is ticked and added.
function Review({read,setRead,onClose}:{read:Read;setRead:(r:Read)=>void;onClose:()=>void}) {
 const {ready,picker}=useAi(),[busy,setBusy]=useState(false),[from,setFrom]=useState(0),[view,setView]=useState<number|null>(null),[only,setOnly]=useState(false),stop=useRef<AbortController|null>(null);
 const rows=read.proposals,picked=rows.filter(p=>p.include),unchecked=picked.reduce((a,p)=>a+p.unverified.length,0);
 // A catalogue can give thousands of rows: show them a page at a time so typing stays quick.
 // "Only rows to check" lists the rows with a red value (a model missing, a value not on its page, values that do not add up).
 const list=rows.map((p,i)=>({p,i})).filter(x=>!only||x.p.unverified.length);
 const PAGE=200,last=Math.min(from+PAGE,list.length),all=rows.length>0&&picked.length===rows.length;
 // A value the engineer typed is theirs: it is no longer flagged as unchecked.
 const edit=(i:number,k:CatalogueKey,v:string)=>setRead({...read,proposals:rows.map((p,j)=>j===i?{...p,entry:{...p.entry,[k]:clip(v)},unverified:p.unverified.filter(x=>x!==k)}:p)});
 async function ai(){
  const ctl=new AbortController();stop.current=ctl;setBusy(true);
  try{const s=await ready();if(typeof s==='string'){notify(s);return;}
   const found=parseEquipmentReply(await askEquipment(s,read.pages,ctl.signal),read.pages,read.file);setRead({...read,proposals:found});notify(`The local model read ${found.length} entries. Values not found on their page are marked red.`);}
  catch(e){notify(message(e,'The local model could not read the file.'));}finally{setBusy(false);stop.current=null;}
 }
 function add(){
  const brand=clip(read.brand.trim());if(!brand){notify('Enter the brand for these entries.');return;}
  // The catalogue is looked up by brand, model and configuration: a row without a model can never be picked, and two
  // ticked rows with the same model and configuration would replace each other.
  const blank=picked.filter(p=>!p.entry.model.trim()).length;
  if(blank){notify(`${blank} ticked row${blank===1?' has':'s have'} no model or part number. Type it from the PDF (click the page number to see the page) or untick ${blank===1?'it':'them'}.`);return;}
  const keys=picked.map(p=>`${p.entry.model.trim()}\u0000${p.entry.config.trim()}`.toLowerCase()),twice=keys.length-new Set(keys).size;
  if(twice){notify(`${twice} ticked row${twice===1?' has':'s have'} the same model and configuration as another ticked row, so one would replace the other. Make their configurations differ (for example add the series) or untick the repeats.`);return;}
  try{const m=mergeCatalogue(project.value.loads.catalogue,picked.map(p=>({...p.entry,brand})));setLoads({catalogue:m.catalogue});notify(`Added ${m.added} catalogue entries${m.replaced?` and replaced ${m.replaced}`:''} from ${read.file}.`);onClose();}
  catch(e){notify(message(e,'Could not add the entries.'));}
 }
 return <div class="modal-backdrop"><section class="modal schematic-modal" role="dialog" aria-modal="true" aria-label="Review datasheet entries">
  <div class="panel-heading"><div><div class="eyebrow">READ DATASHEET</div><h2>{read.file}</h2><p>{read.pages.length} page{read.pages.length===1?'':'s'} read{read.ocr?`, ${read.ocr} by OCR (check numbers carefully)`:''}. Tick the rows to add and fix anything misread. Red values were not found on the page they came from, or a row's kW, In, efficiency and power factor do not work out to its voltage.{read.pdf?' Click a page number to see where each value was printed.':''}</p></div><button class="icon-button" aria-label="Close" onClick={onClose}><X size={18}/></button></div>
  <div class="import-source"><label class="field"><span>Brand</span><input value={read.brand} maxLength={MAX_CELL} placeholder="Manufacturer name" onInput={e=>setRead({...read,brand:e.currentTarget.value})}/></label>
   <div class="ai-read">{picker}<button class="button secondary small" disabled={busy} onClick={()=>void ai()}><Sparkles size={14}/>{busy?'Reading…':'Read with local AI'}</button>{busy&&<button class="button ghost small" onClick={()=>stop.current?.abort()}>Cancel</button>}</div></div>
  <div class="schematic-table"><table><thead><tr><th><input type="checkbox" checked={all} aria-label="Add all rows" onChange={()=>setRead({...read,proposals:rows.map(x=>({...x,include:!all}))})}/></th>{REVIEW.map(k=><th key={k}>{HEADS[k]}</th>)}<th>Page</th><th>Read from</th></tr></thead>
   <tbody>{list.slice(from,last).map(({p,i})=>{return <tr key={i} class={p.include?'':'off'}><td><input type="checkbox" checked={p.include} aria-label={`Add row ${i+1}`} onChange={e=>{const on=e.currentTarget.checked;setRead({...read,proposals:rows.map((x,j)=>j===i?{...x,include:on}:x)});}}/></td>
    {REVIEW.map(k=><td key={k} class={`cell ${p.unverified.includes(k)?'bad':''}`} title={p.unverified.includes(k)?p.note&&(k==='inA'||k==='un')?p.note:`Not found on page ${p.page||'?'}. Check the PDF.`:undefined}><input value={p.entry[k]} aria-label={`${HEADS[k]}, row ${i+1}`} maxLength={MAX_CELL} onInput={e=>edit(i,k,e.currentTarget.value)}/></td>)}
    <td>{p.page&&read.pdf?<button class="text-button" title="Show where these values are on the page" onClick={()=>setView(i)}>p. {p.page}</button>:p.page||'—'}</td><td class="evidence" title={p.note?`${p.note} ${p.evidence}`:p.evidence}>{p.note?`⚠ ${p.note} `:''}{p.evidence}</td></tr>;})}</tbody></table>
   {!rows.length&&<p class="sheet-empty">No labelled values found (rated power in kW, current in A, voltage, efficiency or power factor next to a model or article number). Try Read with local AI, or add a row and type the values from the PDF.</p>}</div>
  <div class="modal-actions"><span class="muted">{picked.length} to add{unchecked?` · ${unchecked} values to check`:''}</span>
   <label class="check-inline muted"><input type="checkbox" checked={only} onChange={e=>{setOnly(e.currentTarget.checked);setFrom(0);}}/>Only rows to check</label>
   {list.length>PAGE&&<span class="pager"><button class="button ghost small" disabled={!from} onClick={()=>setFrom(Math.max(0,from-PAGE))}>Previous</button><span class="muted">Rows {from+1}–{last} of {list.length}</span><button class="button ghost small" disabled={last>=list.length} onClick={()=>setFrom(from+PAGE)}>Next</button></span>}
   <button class="button secondary small" onClick={()=>setRead({...read,proposals:[...rows,{entry:{...emptyEntry(),source:clip(`${read.file} (typed)`)},page:0,evidence:'',unverified:[],include:true}]})}><Plus size={14}/>Add row</button>
   <button class="button secondary small" onClick={onClose}>Cancel</button><button class="button primary small" disabled={!picked.length||!read.brand.trim()} onClick={add}><Check size={15}/>Add to catalogue</button></div>
 </section>{view!==null&&read.pdf&&rows[view]&&<PageView file={read.pdf} p={rows[view]} lines={read.layout?.get(rows[view].page)} onClose={()=>setView(null)}/>}</div>;
}

// A vendor's product page. Browsers do not let one website read another (and vendors block bots), so the user copies the page
// in their own browser and pastes it here; the HTML is only converted to text, never shown.
function PastePage({onRead,onClose}:{onRead:(text:string,source:string)=>void;onClose:()=>void}) {
 const [link,setLink]=useState(''),url=/^https?:\/\/\S+$/i.test(link.trim())?link.trim():'';
 function paste(e:ClipboardEvent){
  e.preventDefault();const html=e.clipboardData?.getData('text/html')??'',plain=(e.clipboardData?.getData('text/plain')??'').trim();
  try{
   if(!html&&/^https?:\/\/\S+$/i.test(plain)){setLink(plain);notify('That is the link. Open it, select the whole page (Ctrl+A or ⌘A), copy it (Ctrl+C or ⌘C) and paste here.');return;}
   if(plain.length>MAX_PAGE)throw Error('The page is larger than 5 MB. Copy only the product part of the page.');
   const text=html?pageText(html):plain;if(!text)throw Error('Nothing was pasted. Copy the product page first.');
   onRead(text,url?new URL(url).origin:'Pasted web page');
  }catch(err){notify(message(err,'Could not read the pasted page.'));}
 }
 return <div class="modal-backdrop"><section class="modal small-modal paste-page" role="dialog" aria-modal="true" aria-label="Paste a vendor web page">
  <div class="panel-heading"><div><div class="eyebrow">VENDOR WEB PAGE</div><h2>Paste a product page</h2></div><button class="icon-button" aria-label="Close" onClick={onClose}><X size={18}/></button></div>
  <ol class="muted"><li>Open the vendor's page in your browser{url&&<> (<a href={url} target="_blank" rel="noopener noreferrer">open it <ExternalLink size={12}/></a>)</>}.</li><li>Select the whole page (Ctrl+A or ⌘A) and copy it (Ctrl+C or ⌘C).</li><li>Click the box below and paste (Ctrl+V or ⌘V).</li></ol>
  <label class="field"><span>Page link (optional, kept as the source)</span><input value={link} maxLength={MAX_CELL} placeholder="https://" onInput={e=>setLink(e.currentTarget.value)}/></label>
  <textarea aria-label="Paste the copied page here" placeholder="Paste the copied page here" value="" onPaste={paste}/>
  <p class="muted">Tables and label/value lists are read on this computer, without AI. You check every value before it is added. Saved pages (.html) can also go through Read datasheet.</p>
 </section></div>;
}

export function Catalogue() {
 const cat=project.value.loads.catalogue,book=useRef<HTMLInputElement>(null),pdf=useRef<HTMLInputElement>(null),stop=useRef<AbortController|null>(null);
 const [busy,setBusy]=useState(''),[read,setRead]=useState<Read|null>(null),[brand,setBrand]=useState(''),[q,setQ]=useState(''),[pasting,setPasting]=useState(false);
 const brands=unique(cat.map(c=>c.brand)),find=q.trim().toLowerCase();
 const shown=cat.map((e,i)=>({e,i})).filter(({e})=>(!brand||sameText(e.brand,brand))&&(!find||CATALOGUE_KEYS.some(k=>e[k].toLowerCase().includes(find))));
 const set=(i:number,k:CatalogueKey,v:string)=>{const next=[...cat];next[i]={...next[i]!,[k]:clip(v)};setLoads({catalogue:next},`cat:${i}:${k}`);};
 async function openBook(f:File){
  setBusy('Reading the catalogue…');
  try{const r=readEquipment(await readTables(f),f.name);if(!r.catalogue.length)throw Error('No catalogue rows found. The sheet needs a Model / Part Number column; sheets named "Brand (Name)" take the brand from their name.');
   const m=mergeCatalogue(cat,r.catalogue);setLoads({catalogue:m.catalogue});notify(`Read ${r.catalogue.length} catalogue entries from ${f.name}: ${m.added} new, ${m.replaced} updated.`);}
  catch(e){notify(message(e,'Could not read the catalogue.'));}finally{setBusy('');if(book.current)book.current.value='';}
 }
 function fromWeb(text:string,source:string){
  const r=catalogueFromWeb(text,source);setPasting(false);
  setRead({file:source,pages:[{page:1,text,mode:'text',confidence:null}],ocr:0,proposals:r.proposals,brand:brand||r.brand});
 }
 async function openPdf(f:File){
  const ctl=new AbortController();stop.current=ctl;setBusy('Reading the datasheet…');
  try{if(/\.html?$/i.test(f.name)){if(f.size>MAX_PAGE)throw Error('The page is larger than 5 MB.');
   const html=await f.text(),to=redirectTarget(html);
   if(to)throw Error(`${f.name} is only a saved link, not the document. Open ${to} in your browser, save the PDF it shows, then read that PDF here.`);
   fromWeb(pageText(html),f.name);return;}
   const doc=await readCatalogue(f,p=>setBusy(p.message),ctl.signal,'equipment'),r=catalogueFromDatasheet(doc.pages,f.name,doc.layout);
   setRead({file:f.name,pages:doc.pages,ocr:doc.pages.filter(p=>p.mode==='ocr').length,proposals:r.proposals,brand:brand||r.brand,...(/\.pdf$/i.test(f.name)?{pdf:f,layout:doc.layout}:{})});}
  catch(e){notify(message(e,'Could not read the datasheet.'));}finally{setBusy('');stop.current=null;if(pdf.current)pdf.current.value='';}
 }
 return <>
  <input ref={book} class="visually-hidden" type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label="Choose catalogue workbook" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void openBook(f);}}/>
  <input ref={pdf} class="visually-hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.html,.htm" aria-label="Choose datasheet" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void openPdf(f);}}/>
  {read&&<Review read={read} setRead={setRead} onClose={()=>{closePage();setRead(null);}}/>}
  {pasting&&<PastePage onRead={fromWeb} onClose={()=>setPasting(false)}/>}
  {busy&&<div class="reading-bar" role="status"><Network size={15}/><span>{busy}</span>{stop.current&&<button class="button secondary small" onClick={()=>stop.current?.abort()}>Cancel</button>}</div>}
  <div class="sheet-section-head"><div><h2>Brand catalogue</h2><p>One row per Brand + Model + Configuration. A load list row that picks them fills in the rest. Saved with the project; export it to reuse in other projects.</p></div>
   <div class="page-actions"><button class="button secondary small" disabled={!!busy} onClick={()=>book.current?.click()}><Upload size={15}/>Import catalogue</button>
    <button class="button secondary small" disabled={!!busy} onClick={()=>pdf.current?.click()} title="PDF, scanned image or saved web page (.html); text is read on this computer"><ScanText size={15}/>Read datasheet</button>
    <button class="button secondary small" disabled={!!busy} onClick={()=>setPasting(true)} title="Copy a vendor's product page and paste it here"><ClipboardPaste size={15}/>Paste web page</button>
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
   <p>PDFs are read on this computer: the text layer first, OCR for scanned pages, and optionally a local AI model. For a vendor's web page, use Paste web page: copy the page in your browser and paste it. You check every value before it is added.</p></section>}
 </>;
}
