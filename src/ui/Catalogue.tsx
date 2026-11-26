import {useEffect,useRef,useState} from 'preact/hooks';
import {Upload,Plus,FileSpreadsheet,Trash2,ScanText,X,Check,Search,Network,ClipboardPaste,ExternalLink} from 'lucide-preact';
import {project,setLoads,notify} from './state';
import {CATALOGUE_KEYS,emptyEntry,unique,sameText,type CatalogueKey} from '../engine/loads';
import {clip,MAX_CELL} from '../engine/sheet';
import {readTables} from '../import/load-list';
import {readCatalogue,renderPage,closePage,pageCount,pageList,rangesOf} from '../import/document';
import {readEquipment,mergeCatalogue,locate,reading,inColumn,type Box,type Proposal} from '../import/equipment';
import {catalogueFromDatasheet,catalogueFromWeb,pageText,pickAt,redirectTarget,MAX_PAGE} from '../import/webpage';
import {valueIn} from '../import/vocabulary';
import {exportCatalogue} from '../export/equipment';
import type {PageEvidence} from '../store/schema';
import type {PositionedLine} from '../import/parse';
import {Fragment} from 'preact';
import {signal} from '@preact/signals';
import {TypePicker} from './TypePicker';
import {applyPick,keepPicked} from '../import/equipment';
import {checkAll,withCheck} from '../import/checks';
import {GROUPS,MAX_LEARNED,allTypes,withLearned,type EquipmentType,type Learned,type Param,type Pick} from '../engine/equipment-types';
import type {CatalogueRow} from '../engine/loads';

const HEADS:Record<CatalogueKey,string>={brand:'Brand',model:'Model / Part Number',config:'Configuration',ratedKw:'Rated Input Power (kW)',protA:'Protection Device Rating (A)',inA:'In (A)',un:'Un',efficiency:'Efficiency',pf:'Power Factor',source:'Source'};
const REVIEW=['model','config','ratedKw','protA','inA','un','efficiency','pf'] as const;
// shortcut: shows the first 300 matching entries only; add paging if catalogues grow past a few thousand.
const SHOWN=300;
const message=(e:unknown,fallback:string)=>e instanceof Error?e.message:fallback;
// pdf and layout: the PDF read and its text positions, kept while reviewing so a row can be shown on its page.
// types: the equipment types picked for this read, each holding only its ticked parameters.
type Read={file:string;pages:PageEvidence[];ocr:number;proposals:Proposal[];brand:string;types:EquipmentType[];pdf?:File;layout?:Map<number,PositionedLine[]>};
// The last equipment types and parameters picked, offered again on the next read this session.
const lastPick=signal<Pick>({types:['motor'],on:{}});
const MARK:Record<CatalogueKey,string>={brand:'Brand',model:'Model',config:'Config',ratedKw:'kW',protA:'Prot. A',inA:'In',un:'Un',efficiency:'η',pf:'PF',source:'Source'};

// The page a row was read from with a box round each value taken from it, so the engineer sees exactly where it came from.
// To correct a value, the engineer picks the parameter and clicks the value on the page: the row takes it, and the label
// printed before it is learned for the next sheet of this equipment type (onTeach says what happened).
type Map4=(r:[number,number,number,number])=>number[];
function PageView({file,p,lines,params,onTeach,onClose}:{file:File;p:Proposal;lines:readonly PositionedLine[]|undefined;params:readonly Param[];onTeach:(key:string,picked:{text:string;label:string},box:Omit<Box,'key'>)=>string;onClose:()=>void}) {
 const canvas=useRef<HTMLCanvasElement>(null),wrap=useRef<HTMLDivElement>(null),[marks,setMarks]=useState<{key:CatalogueKey;style:string}[]|null>(null),[error,setError]=useState('');
 const [map,setMap]=useState<Map4|null>(null),[teach,setTeach]=useState(''),[said,setSaid]=useState('');
 const exact=!!p.boxes?.length;
 // Boxes are placed in percent of the canvas so they follow it as it scales.
 const styleOf=(m:Map4,x0:number,x1:number,y:number,h:number)=>{const c=canvas.current;if(!c)return '';const [a=0,b=0,d=0,e=0]=m([x0-1,y-h*0.3,x1+1,y+h*0.95]),pc=(v:number,of:number)=>`${(v/of*100).toFixed(3)}%`;
  return `left:${pc(Math.min(a,d),c.width)};top:${pc(Math.min(b,e),c.height)};width:${pc(Math.abs(d-a),c.width)};height:${pc(Math.abs(e-b),c.height)}`;};
 useEffect(()=>{
  const c=canvas.current;if(!c)return;let live=true;setMarks(null);setError('');
  const boxes=p.boxes?.length?p.boxes:locate(p.entry,lines??[]);
  // Rendered at up to twice screen size for sharp text.
  renderPage(file,p.page,c,Math.min(2400,Math.round(1000*devicePixelRatio))).then(m=>{if(!live)return;setMap(()=>m);
   setMarks(boxes.map(b=>({key:b.key,style:styleOf(m,b.x0,b.x1,b.y,b.h)})));
  },(e:unknown)=>{if(live)setError(message(e,'Could not show the page.'));});
  return ()=>{live=false;};
 },[file,p,lines]);
 // Only the page scrolls to the first box; scrollIntoView would also scroll the dialog and hide its heading.
 useEffect(()=>{const w=wrap.current,m=w?.querySelector<HTMLElement>('.page-mark');if(w&&m)w.scrollTop=m.offsetTop-w.clientHeight/2;},[marks]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();if(teach)setTeach('');else onClose();}};addEventListener('keydown',key,true);return ()=>removeEventListener('keydown',key,true);},[onClose,teach]);
 return <div class="modal-backdrop"><section class="modal schematic-modal page-view" role="dialog" aria-modal="true" aria-label={`Page ${p.page} of the datasheet`}>
  <div class="panel-heading"><div><div class="eyebrow">PAGE {p.page}</div><h2>{p.entry.model||'Row without a model'}</h2>
   <p>{exact?'Each box is where a value in this row was printed.':'This row was read without positions, so every place its values are printed on the page is boxed. Some boxes may belong to other rows.'}{marks&&!marks.length?' None of its values were found on the page.':''}</p>
   {p.note&&<p class="page-note">{p.note}</p>}{p.doubt&&<p class="page-note">{p.doubt.why}</p>}
   {params.length>0&&!!lines?.length&&<div class="teach-bar"><label class="field"><span>Correct a value</span><select value={teach} onChange={e=>{setTeach(e.currentTarget.value);setSaid('');}}>
     <option value="">Pick a parameter…</option>{params.map(x=><option key={x.key} value={x.key}>{x.label}{x.unit?` (${x.unit})`:''}</option>)}</select></label>
    <span class={said?'page-note':'muted'} role="status">{teach?'Now click its value on the page (Esc to stop).':said||'Pick a parameter, then click its value on the page. The label printed before it is remembered for the next sheet of this type.'}</span></div>}</div>
   <button class="icon-button" aria-label="Close page" onClick={onClose}><X size={18}/></button></div>
  {error&&<p class="sheet-empty">{error}</p>}
  <div class="page-scroll" ref={wrap}><div class="page-canvas"><canvas ref={canvas}/>{marks?.map((m,k)=><span key={k} class="page-mark" style={m.style}><b>{MARK[m.key]}</b></span>)}
   {teach&&map&&lines?.flatMap((l,li)=>l.cells.map((c,ci)=>{const y=c.y??l.y??0,h=c.h||8;
    return <button key={`${li}:${ci}`} type="button" class="page-item" style={styleOf(map,c.x,c.x+(c.w??0),y,h)} aria-label={`Take ${c.text.trim()}`} title={c.text.trim()}
     onClick={()=>{setSaid(onTeach(teach,pickAt(l,ci),{x0:c.x,x1:c.x+(c.w??0),y,h}));setTeach('');}}/>;}))}</div></div>
 </section></div>;
}

// Every value read from a PDF is shown with the line it came from; nothing reaches the catalogue until it is ticked and added.
function Review({read,setRead,onClose}:{read:Read;setRead:(r:Read)=>void;onClose:()=>void}) {
 const [from,setFrom]=useState(0),[view,setView]=useState<number|null>(null),[only,setOnly]=useState(false);
 const rows=read.proposals,picked=rows.filter(p=>p.include);
 // Each row shows the columns its equipment type takes; the others are greyed out and left out when it is added.
 const typeOf=(p:Proposal)=>read.types.find(t=>t.id===p.entry.type);
 const takes=(p:Proposal,k:CatalogueKey)=>{const t=typeOf(p);return !t||k==='model'||k==='config'||t.params.some(x=>x.feeds===k);};
 const cols=REVIEW.filter(k=>k!=='model'&&(!read.types.length||k==='config'||read.types.some(t=>t.params.some(x=>x.feeds===k))));
 const extras=[...new Map(read.types.flatMap(t=>t.params.filter(x=>!x.feeds).map(x=>[x.key,x] as const))).values()];
 const hasExtra=(p:Proposal,key:string)=>!!typeOf(p)?.params.some(x=>x.key===key&&!x.feeds);
 const missing=(p:Proposal,feeds:string,key='')=>{const x=typeOf(p)?.params.find(q=>q.required&&(key?q.key===key:q.feeds===feeds));return !!x&&!(x.feeds?p.entry[x.feeds]:p.entry.extra?.[x.key]??'').trim();};
 const missingRequired=(p:Proposal)=>typeOf(p)?.params.filter(q=>q.required&&!(q.feeds?p.entry[q.feeds]:p.entry.extra?.[q.key])?.trim()).length??0;
 const missingCount=picked.reduce((n,p)=>n+missingRequired(p),0);
 const unchecked=picked.reduce((a,p)=>a+p.unverified.filter(k=>takes(p,k)).length,0),guesses=picked.filter(p=>p.typeGuess).length,doubts=picked.filter(p=>p.doubt).length;
 // A catalogue can give thousands of rows: show them a page at a time so typing stays quick.
 // "Only rows to check" lists the rows with a red value (a model missing, a value not on its page, values that do not add up),
 // an amber one (values that do not work out with each other) or a type that two picked types fit equally.
 const list=rows.map((p,i)=>({p,i})).filter(x=>!only||x.p.unverified.length||x.p.typeGuess||x.p.doubt||missingRequired(x.p));
 const PAGE=200,last=Math.min(from+PAGE,list.length),all=rows.length>0&&picked.length===rows.length;
 // A value the engineer typed is theirs: it is no longer flagged as unchecked. Its row's sums are worked out again.
 const change=(i:number,f:(p:Proposal)=>Proposal)=>setRead({...read,proposals:rows.map((p,j)=>{if(j!==i)return p;const n=f(p);return withCheck(n,typeOf(n));})});
 const edit=(i:number,k:CatalogueKey,v:string)=>change(i,p=>({...p,entry:{...p.entry,[k]:clip(v)},unverified:p.unverified.filter(x=>x!==k)}));
 const editExtra=(i:number,key:string,v:string)=>change(i,p=>({...p,entry:{...p.entry,extra:{...p.entry.extra,[key]:clip(v)}}}));
 const retype=(i:number,id:string)=>change(i,p=>({...p,entry:{...p.entry,type:id},typeGuess:false}));
 // A value the engineer clicked on the page: the row takes it, and the label printed before it is learned for this type.
 function teach(i:number,key:string,picked:{text:string;label:string},box:Omit<Box,'key'>):string {
  const p=rows[i],t=p&&typeOf(p),x=t?.params.find(q=>q.key===key);if(!p||!t||!x)return '';
  const v=valueIn(reading(x),picked.text,picked.label),value=v?x.feeds?inColumn(x.feeds,v.value):clip(v.value):'';
  if(!value)return `"${picked.text}" is not a ${x.label}${x.unit?` in ${x.unit}`:''}. Click the value itself.`;
  change(i,q=>{const n:Proposal={...q,entry:x.feeds?{...q.entry,[x.feeds]:value}:{...q.entry,extra:{...q.entry.extra,[key]:value}},
   unverified:q.unverified.filter(k=>k!==x.feeds),evidence:`${picked.label||x.label}: ${picked.text} (set on the page) · ${q.evidence}`.slice(0,300)};
   if(x.feeds&&q.boxes)n.boxes=[...q.boxes.filter(b=>b.key!==x.feeds),{key:x.feeds,...box}];return n;});
  if(!picked.label)return `${x.label} set to ${value}. No label is printed before it, so nothing was learned.`;
  const learned=project.value.loads.learned,plain=(s:string)=>s.replace(/\s+/g,'').toLowerCase(),same=(l:Learned)=>l.type===t.id&&l.key===key&&plain(l.label)===plain(picked.label);
  if(!learned.some(same))setLoads({learned:[...learned,{type:t.id,key,label:picked.label}].slice(-MAX_LEARNED)});
  return `${x.label} set to ${value}. "${picked.label}" will be read as ${x.label} on the next ${t.name.trim()} sheet.`;
 }
 function add(){
  const brand=clip(read.brand.trim());if(!brand){notify('Enter the brand for these entries.');return;}
  // The catalogue is looked up by brand, model and configuration: a row without a model can never be picked, and two
  // ticked rows with the same model and configuration would replace each other.
  const blank=picked.filter(p=>!p.entry.model.trim()).length;
  if(blank){notify(`${blank} ticked row${blank===1?' has':'s have'} no model or part number. Type it from the PDF (click the page number to see the page) or untick ${blank===1?'it':'them'}.`);return;}
  const keys=picked.map(p=>`${p.entry.model.trim()}\u0000${p.entry.config.trim()}`.toLowerCase()),twice=keys.length-new Set(keys).size;
  if(twice){notify(`${twice} ticked row${twice===1?' has':'s have'} the same model and configuration as another ticked row, so one would replace the other. Make their configurations differ (for example add the series) or untick the repeats.`);return;}
  try{const m=mergeCatalogue(project.value.loads.catalogue,picked.map(p=>keepPicked({...p.entry,brand},typeOf(p))));setLoads({catalogue:m.catalogue});notify(`Added ${m.added} catalogue entries${m.replaced?` and replaced ${m.replaced}`:''} from ${read.file}.`);onClose();}
  catch(e){notify(message(e,'Could not add the entries.'));}
 }
 return <div class="modal-backdrop"><section class="modal schematic-modal" role="dialog" aria-modal="true" aria-label="Review datasheet entries">
  <div class="panel-heading"><div><div class="eyebrow">READ DATASHEET</div><h2>{read.file}</h2><p>{read.pages.length} page{read.pages.length===1?'':'s'} read{read.ocr?`, ${read.ocr} by OCR (check numbers carefully)`:''}. Tick the rows to add and fix anything misread. Red values were not found on the page they came from, or a row's kW, In, efficiency and power factor do not work out to its voltage. Amber values do not add up with the row's other values (a transformer's kVA, voltage and current, a motor's kW, current and power factor, efficiency and losses); point at one for the sum.{read.pdf?' Click a page number to see where each value was printed.':''}</p></div><button class="icon-button" aria-label="Close" onClick={onClose}><X size={18}/></button></div>
  <div class="import-source"><label class="field"><span>Brand</span><input value={read.brand} maxLength={MAX_CELL} placeholder="Manufacturer name" onInput={e=>setRead({...read,brand:e.currentTarget.value})}/></label></div>
  <div class="schematic-table"><table><thead><tr><th><input type="checkbox" checked={all} aria-label="Add all rows" onChange={()=>setRead({...read,proposals:rows.map(x=>({...x,include:!all}))})}/></th><th>{HEADS.model}</th>{read.types.length>0&&<th>Equipment type</th>}
    {cols.map(k=><th key={k}>{HEADS[k]}</th>)}{extras.map(x=><th key={x.key}>{x.label}{x.unit?` (${x.unit})`:''}</th>)}<th>Page</th><th>Read from</th></tr></thead>
   <tbody>{list.slice(from,last).map(({p,i})=>{const t=typeOf(p);return <tr key={i} class={p.include?'':'off'}><td><input type="checkbox" checked={p.include} aria-label={`Add row ${i+1}`} onChange={e=>{const on=e.currentTarget.checked;setRead({...read,proposals:rows.map((x,j)=>j===i?{...x,include:on}:x)});}}/></td>
    {(['model',...cols] as CatalogueKey[]).map(k=>{const off=!takes(p,k),bad=!off&&p.unverified.includes(k),need=!off&&missing(p,k),fed=t?.params.find(x=>x.feeds===k)?.key,doubt=!off&&!!fed&&!!p.doubt?.keys.includes(fed);
     return <Fragment key={k}><td class={`cell ${bad||need?'bad':doubt?'doubt':''} ${off?'off-cell':''}`} title={off?`${t?.name??'This type'} does not take this value, so it is left out.`:bad?p.note&&(k==='inA'||k==='un')?p.note:`Not found on page ${p.page||'?'}. Check the PDF.`:need?'Required for this equipment type, but not read. Type it from the datasheet.':doubt?p.doubt!.why:undefined}>
      <input value={off?'':p.entry[k]} disabled={off} aria-label={`${HEADS[k]}, row ${i+1}`} maxLength={MAX_CELL} onInput={e=>edit(i,k,e.currentTarget.value)}/></td>
      {k==='model'&&read.types.length>0&&<td class={`cell ${p.typeGuess?'bad':''}`} title={p.typeGuess?'Two of the picked types fit this row equally well. Check its type.':undefined}>
       <select value={p.entry.type??''} aria-label={`Equipment type, row ${i+1}`} onChange={e=>retype(i,e.currentTarget.value)}>{read.types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></td>}</Fragment>;})}
    {extras.map(x=>{const off=!hasExtra(p,x.key),need=!off&&missing(p,'',x.key),doubt=!off&&!!p.doubt?.keys.includes(x.key);return <td key={x.key} class={`cell ${need?'bad':doubt?'doubt':''} ${off?'off-cell':''}`} title={off?`${t?.name??'This type'} does not have this parameter.`:need?'Required for this equipment type. Type it from the datasheet.':doubt?p.doubt!.why:undefined}>
     <input value={off?'':p.entry.extra?.[x.key]??''} disabled={off} aria-label={`${x.label}, row ${i+1}`} maxLength={MAX_CELL} onInput={e=>editExtra(i,x.key,e.currentTarget.value)}/></td>;})}
    <td>{p.page&&read.pdf?<button class="text-button" title="Show where these values are on the page" onClick={()=>setView(i)}>p. {p.page}</button>:p.page||'—'}</td><td class="evidence" title={[p.note,p.doubt?.why,p.evidence].filter(Boolean).join(' ')}>{p.note?`⚠ ${p.note} `:''}{p.doubt?`⚠ ${p.doubt.why} `:''}{p.evidence}</td></tr>;})}</tbody></table>
   {!rows.length&&<p class="sheet-empty">No values found for the picked equipment types' parameters. Check the types and parameters picked, or add a row and type the values from the PDF.</p>}</div>
  <div class="modal-actions"><span class="muted">{picked.length} to add{missingCount?` · ${missingCount} required values missing`:''}{unchecked?` · ${unchecked} values to check`:''}{guesses?` · ${guesses} types to check`:''}{doubts?` · ${doubts} row${doubts===1?'':'s'} not adding up`:''}</span>
   <label class="check-inline muted"><input type="checkbox" checked={only} onChange={e=>{setOnly(e.currentTarget.checked);setFrom(0);}}/>Only rows to check</label>
   {list.length>PAGE&&<span class="pager"><button class="button ghost small" disabled={!from} onClick={()=>setFrom(Math.max(0,from-PAGE))}>Previous</button><span class="muted">Rows {from+1}–{last} of {list.length}</span><button class="button ghost small" disabled={last>=list.length} onClick={()=>setFrom(from+PAGE)}>Next</button></span>}
   <button class="button secondary small" onClick={()=>setRead({...read,proposals:[...rows,{entry:{...emptyEntry(),source:clip(`${read.file} (typed)`),...read.types[0]?{type:read.types[0].id}:{}},page:0,evidence:'',unverified:[],include:true}]})}><Plus size={14}/>Add row</button>
   <button class="button secondary small" onClick={onClose}>Cancel</button><button class="button primary small" disabled={!picked.length||!read.brand.trim()} onClick={add}><Check size={15}/>Add to catalogue</button></div>
 </section>{view!==null&&read.pdf&&rows[view]&&<PageView file={read.pdf} p={rows[view]} lines={read.layout?.get(rows[view].page)} params={typeOf(rows[view])?.params??[]} onTeach={(key,picked,box)=>teach(view,key,picked,box)} onClose={()=>setView(null)}/>}</div>;
}

// A long catalogue is read only where the engineer points: they look through the pages and pick the tables or datasheets
// they want, so a few pages are read (and OCR'd if scanned) instead of hundreds.
function PagePicker({file,total,onRead,onClose}:{file:File;total:number;onRead:(pages?:number[])=>void;onClose:()=>void}) {
 const canvas=useRef<HTMLCanvasElement>(null),queue=useRef(Promise.resolve()),[at,setAt]=useState(1),[text,setText]=useState(''),[error,setError]=useState('');
 // One page is drawn at a time: a canvas cannot take a second drawing while the first is under way.
 useEffect(()=>{const c=canvas.current;if(!c)return;let live=true;setError('');
  queue.current=queue.current.then(()=>live?renderPage(file,at,c,Math.min(1800,Math.round(800*devicePixelRatio))).then(()=>undefined):undefined).catch((e:unknown)=>{if(live)setError(message(e,'Could not show the page.'));});
  return ()=>{live=false;};},[file,at]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();onClose();}};addEventListener('keydown',key,true);return ()=>removeEventListener('keydown',key,true);},[onClose]);
 let pages:number[]=[],bad='';try{pages=pageList(text,total);}catch(e){bad=message(e,'Check the pages.');}
 const on=pages.includes(at),go=(n:number)=>setAt(Math.min(total,Math.max(1,Math.round(n)||1)));
 return <div class="modal-backdrop"><section class="modal schematic-modal page-view page-pick" role="dialog" aria-modal="true" aria-label="Choose the pages to read">
  <div class="panel-heading"><div><div class="eyebrow">CHOOSE PAGES</div><h2>{file.name}</h2><p>{total} pages. Look through them and pick the ones with the tables or datasheets you want; only those are read.</p></div><button class="icon-button" aria-label="Close" onClick={onClose}><X size={18}/></button></div>
  <div class="page-pick-bar"><button class="button ghost small" disabled={at<=1} onClick={()=>go(at-1)}>Previous</button>
   <label class="page-jump"><span>Page</span><input type="number" min={1} max={total} value={at} aria-label="Page shown" onChange={e=>go(Number(e.currentTarget.value))}/><span class="muted">of {total}</span></label>
   <button class="button ghost small" disabled={at>=total} onClick={()=>go(at+1)}>Next</button>
   <label class="check-inline"><input type="checkbox" checked={on} onChange={()=>setText(rangesOf(on?pages.filter(p=>p!==at):[...pages,at]))}/>Read this page</label></div>
  {error&&<p class="sheet-empty">{error}</p>}
  <div class="page-scroll"><div class="page-canvas"><canvas ref={canvas}/></div></div>
  <label class="field page-list"><span>Pages to read</span><input value={text} placeholder="For example 12, 40-45" aria-invalid={!!bad} onInput={e=>setText(e.currentTarget.value)}/></label>
  <div class="modal-actions">{bad?<span class="form-error">{bad}</span>:<span class="muted">{pages.length?`${pages.length} page${pages.length===1?'':'s'} chosen: ${rangesOf(pages)}`:'No pages chosen yet.'}</span>}
   <button class="button secondary small" onClick={()=>onRead()}>Read all {total} pages</button>
   <button class="button primary small" disabled={!pages.length||!!bad} onClick={()=>onRead(pages)}><Check size={15}/>Read {pages.length||''} page{pages.length===1?'':'s'}</button></div>
 </section></div>;
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
 const [choosing,setChoosing]=useState<'pdf'|'paste'|null>(null),chosen=useRef<EquipmentType[]>([]),[picking,setPicking]=useState<{file:File;total:number}|null>(null);
 const learned=project.value.loads.learned.length,types=allTypes(project.value.loads.types),typeName=(id?:string)=>types.find(t=>t.id===id)?.name.trim();
 // An entry's catalogue-only values, named by its type's parameters.
 const others=(e:CatalogueRow)=>{const t=types.find(x=>x.id===e.type);return Object.entries(e.extra??{}).map(([k,v])=>{const p=t?.params.find(x=>x.key===k);return `${p?.label||k}: ${v}${p?.unit?` ${p.unit}`:''}`;}).join('; ');};
 const brands=unique(cat.map(c=>c.brand)),find=q.trim().toLowerCase();
 const shown=cat.map((e,i)=>({e,i})).filter(({e})=>(!brand||sameText(e.brand,brand))&&(!find||CATALOGUE_KEYS.some(k=>e[k].toLowerCase().includes(find))||(typeName(e.type)??'').toLowerCase().includes(find)||others(e).toLowerCase().includes(find)));
 const set=(i:number,k:CatalogueKey,v:string)=>{const next=[...cat];next[i]={...next[i]!,[k]:clip(v)};setLoads({catalogue:next},`cat:${i}:${k}`);};
 const setType=(i:number,id:string)=>{const next=[...cat],e={...next[i]!};if(id)e.type=id;else delete e.type;next[i]=e;setLoads({catalogue:next});};
 // The picker comes first; then the file chooser or the paste box, with the types picked.
 function chose(t:EquipmentType[]){chosen.current=withLearned(t,project.value.loads.learned);const c=choosing;setChoosing(null);if(c==='pdf')pdf.current?.click();else setPasting(true);}
 async function openBook(f:File){
  setBusy('Reading the catalogue…');
  try{const r=readEquipment(await readTables(f),f.name);if(!r.catalogue.length)throw Error('No catalogue rows found. The sheet needs a Model / Part Number column; sheets named "Brand (Name)" take the brand from their name.');
   const m=mergeCatalogue(cat,r.catalogue);setLoads({catalogue:m.catalogue});notify(`Read ${r.catalogue.length} catalogue entries from ${f.name}: ${m.added} new, ${m.replaced} updated.`);}
  catch(e){notify(message(e,'Could not read the catalogue.'));}finally{setBusy('');if(book.current)book.current.value='';}
 }
 function fromWeb(text:string,source:string){
  const r=catalogueFromWeb(text,source,chosen.current);setPasting(false);
  setRead({file:source,pages:[{page:1,text,mode:'text',confidence:null}],ocr:0,proposals:checkAll(applyPick(r.proposals,chosen.current),chosen.current),brand:brand||r.brand,types:chosen.current});
 }
 // pages: the pages picked; null when the engineer chose to read them all.
 async function openPdf(f:File,pages?:number[]|null){
  const ctl=new AbortController();stop.current=ctl;setBusy('Reading the datasheet…');
  try{if(/\.html?$/i.test(f.name)){if(f.size>MAX_PAGE)throw Error('The page is larger than 5 MB.');
   const html=await f.text(),to=redirectTarget(html);
   if(to)throw Error(`${f.name} is only a saved link, not the document. Open ${to} in your browser, save the PDF it shows, then read that PDF here.`);
   fromWeb(pageText(html),f.name);return;}
   // A PDF of more than one page: the engineer picks the pages to read first.
   if(/\.pdf$/i.test(f.name)&&pages===undefined){const total=await pageCount(f);if(total>1){setPicking({file:f,total});return;}}
   const doc=await readCatalogue(f,p=>setBusy(p.message),ctl.signal,'equipment',pages??undefined),r=catalogueFromDatasheet(doc.pages,f.name,doc.layout,doc.rules,chosen.current);
   setRead({file:f.name,pages:doc.pages,ocr:doc.pages.filter(p=>p.mode==='ocr').length,proposals:checkAll(applyPick(r.proposals,chosen.current),chosen.current),brand:brand||r.brand,types:chosen.current,...(/\.pdf$/i.test(f.name)?{pdf:f,layout:doc.layout}:{})});}
  catch(e){notify(message(e,'Could not read the datasheet.'));}finally{setBusy('');stop.current=null;if(pdf.current)pdf.current.value='';}
 }
 return <>
  <input ref={book} class="visually-hidden" type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label="Choose catalogue workbook" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void openBook(f);}}/>
  <input ref={pdf} class="visually-hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.html,.htm" aria-label="Choose datasheet" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void openPdf(f);}}/>
  {read&&<Review read={read} setRead={setRead} onClose={()=>{closePage();setRead(null);}}/>}
  {pasting&&<PastePage onRead={fromWeb} onClose={()=>setPasting(false)}/>}
  {picking&&<PagePicker file={picking.file} total={picking.total} onRead={pages=>{setPicking(null);void openPdf(picking.file,pages??null);}} onClose={()=>{setPicking(null);closePage();}}/>}
  {choosing&&<TypePicker pick={lastPick.value} setPick={p=>{lastPick.value=p;}} action={choosing==='pdf'?'Choose file':'Paste the page'} onContinue={chose} onClose={()=>setChoosing(null)}/>}
  {busy&&<div class="reading-bar" role="status"><Network size={15}/><span>{busy}</span>{stop.current&&<button class="button secondary small" onClick={()=>stop.current?.abort()}>Cancel</button>}</div>}
  <div class="sheet-section-head"><div><h2>Brand catalogue</h2><p>One row per Brand + Model + Configuration. A load list row that picks them fills in the rest. Saved with the project; export it to reuse in other projects.</p></div>
   <div class="page-actions"><button class="button secondary small" disabled={!!busy} onClick={()=>book.current?.click()}><Upload size={15}/>Import catalogue</button>
    <button class="button secondary small" disabled={!!busy} onClick={()=>setChoosing('pdf')} title="PDF, scanned image or saved web page (.html); text is read on this computer"><ScanText size={15}/>Read datasheet</button>
    <button class="button secondary small" disabled={!!busy} onClick={()=>setChoosing('paste')} title="Copy a vendor's product page and paste it here"><ClipboardPaste size={15}/>Paste web page</button>
    <button class="button secondary small" onClick={()=>{setLoads({catalogue:[...cat,{...emptyEntry(),brand}]});setQ('');}}><Plus size={15}/>Add entry</button>
    {learned>0&&<button class="button ghost small" title="Labels learned when you corrected a value by clicking it on a datasheet page. Undo brings them back." onClick={()=>{setLoads({learned:[]});notify(`Forgot ${learned} learned label${learned===1?'':'s'}.`);}}>Forget {learned} learned label{learned===1?'':'s'}</button>}
    <button class="button secondary small" disabled={!cat.length} onClick={()=>void exportCatalogue(cat,project.value.name).catch((e:unknown)=>notify(message(e,'Export failed.')))}><FileSpreadsheet size={15}/>Export catalogue</button></div></div>
  <div class="toolbar">{brands.length>1&&<label class="panel-pick"><span class="visually-hidden">Brand</span><select value={brand} onChange={e=>setBrand(e.currentTarget.value)}><option value="">All brands ({cat.length})</option>{brands.map(b=><option key={b} value={b}>{b} ({cat.filter(c=>sameText(c.brand,b)).length})</option>)}</select></label>}
   <label class="search"><Search size={14}/><input value={q} placeholder="Find model, configuration…" aria-label="Find catalogue entries" onInput={e=>setQ(e.currentTarget.value)}/></label>
   {shown.length>SHOWN&&<span class="muted">Showing the first {SHOWN} of {shown.length}. Filter by brand or search to see the rest.</span>}</div>
  {cat.length?<div class="sheet-scroll tall"><table class="sheet catalogue-sheet" aria-label="Brand catalogue">
   <colgroup>{CATALOGUE_KEYS.map(k=><Fragment key={k}><col style={{width:`${({brand:120,model:200,config:180,un:160,source:260} as Partial<Record<CatalogueKey,number>>)[k]??92}px`}}/>{k==='model'&&<col style={{width:'190px'}}/>}</Fragment>)}<col style={{width:'260px'}}/><col style={{width:'36px'}}/></colgroup>
   <thead><tr class="heads">{CATALOGUE_KEYS.map(k=><Fragment key={k}><th class="input" scope="col"><span>{HEADS[k]}</span></th>{k==='model'&&<th class="input" scope="col"><span>Equipment type</span></th>}</Fragment>)}<th class="input" scope="col"><span>Other parameters</span></th><th class="calc"><span class="visually-hidden">Row tools</span></th></tr></thead>
   <tbody>{shown.slice(0,SHOWN).map(({e,i})=>{const other=others(e);return <tr key={i}>{CATALOGUE_KEYS.map(k=><Fragment key={k}><td class={['ratedKw','protA','inA','efficiency','pf'].includes(k)?'num':''}><input value={e[k]} aria-label={`${HEADS[k]}, entry ${i+1}`} maxLength={MAX_CELL} autoComplete="off" spellcheck={false} onInput={ev=>set(i,k,ev.currentTarget.value)}/></td>
     {k==='model'&&<td class="type-cell"><select value={e.type??''} aria-label={`Equipment type, entry ${i+1}`} onChange={ev=>setType(i,ev.currentTarget.value)}><option value="">Not set</option>{e.type&&!typeName(e.type)&&<option value={e.type}>Unknown type</option>}
      {GROUPS.map((g,gi)=>{const ts=types.filter(t=>t.group===gi);return ts.length?<optgroup key={g} label={g}>{ts.map(t=><option key={t.id} value={t.id}>{t.name.trim()||'Unnamed type'}</option>)}</optgroup>:null;})}</select></td>}</Fragment>)}
    <td class="extras-cell" title={other||undefined}>{other}</td>
    <td class="row-tools"><button class="icon-button danger" aria-label={`Delete entry ${i+1}`} title="Delete entry" onClick={()=>setLoads({catalogue:cat.filter((_,j)=>j!==i)})}><Trash2 size={13}/></button></td></tr>;})}</tbody>
  </table>{!shown.length&&<p class="sheet-empty">No entries match.</p>}</div>
  :<section class="panel list-empty"><ScanText size={26}/><h2>No catalogue yet</h2><p>Import a catalogue workbook (sheets named "Brand (Name)" or any sheet with a Model / Part Number column), read a manufacturer's PDF datasheet, or add entries by hand.</p>
   <p>PDFs are read on this computer: the text layer first, and OCR for scanned pages. For a vendor's web page, use Paste web page: copy the page in your browser and paste it. You check every value before it is added.</p></section>}
 </>;
}
