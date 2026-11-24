import {useEffect,useRef,useState} from 'preact/hooks';
import type {ComponentChildren} from 'preact';
import {Upload,Plus,FileSpreadsheet,Sparkles,X,Check,Table2,Printer,Search,AlertTriangle,Trash2,Network,ChevronDown,MoreHorizontal,Columns3,BookOpen,ClipboardList} from 'lucide-preact';
import {project,listSheet,cableGroups,setListCell,setListRows,setList,setDefaults,acceptAll,exportExcel,exporting,notify,updateProject,tab,listPanel,listFilter,listSearch,selection,inspecting,type ListFilter} from './state';
import {Sheet,Legend,pasteGrid,focusCell,GROUPS} from './Sheet';
import {Calculation} from './Calculation';
import {printReport} from './Report';
import {findIssues} from '../engine/issues';
import {readTables,bestHeader,detectColumns,toSheetRows,cleanValue,type InputTable,type Mapping} from '../import/load-list';
import {COLUMNS,INPUT_COLS,failsCheck,MAX_CELL,emptyRow,isBlankRow,listOptions,TABLES,type Col,type InputCol,type ListCol,type RowResult,type SheetRow} from '../engine/sheet';
import {suggestionCount} from '../engine/suggest';
import {readSchematic,isSchematic,SCHEMATIC_ACCEPT,type SchematicRead} from '../import/schematic-read';
import {SchematicReview} from './Schematic';
import {readPanels} from '../import/panels';

const unique=(v:string[])=>[...new Set(v)];
const head=(col:InputCol)=>COLUMNS.find(c=>c.col===col)?.header.split('\n')[0]??col;
type Draft={file:string;tables:InputTable[];sheet:number;header:number;mapping:Mapping};
const draftFor=(file:string,tables:InputTable[],sheet:number):Draft=>{const rows=tables[sheet]?.rows??[],header=bestHeader(rows);return {file,tables,sheet,header,mapping:detectColumns(rows[header]??[])};};

function ImportDialog({draft,setDraft,onClose}:{draft:Draft;setDraft:(d:Draft)=>void;onClose:()=>void}) {
 const table=draft.tables[draft.sheet],headers=(table?.rows[draft.header]??[]).map((h,i)=>h.trim()||`Column ${i+1}`);
 let rows:ReturnType<typeof toSheetRows>=[],error='';try{rows=table?toSheetRows(table.rows,draft.header,draft.mapping):[];}catch(e){error=e instanceof Error?e.message:'Could not read rows.';}
 const existing=project.value.list.rows.filter(r=>!isBlankRow(r)).length,found=INPUT_COLS.filter(c=>draft.mapping[c]!==undefined);
 const finish=(append:boolean)=>{if(append&&existing+rows.length>2000){notify('A load list supports at most 2,000 rows.');return;}setList({rows:append?[...project.value.list.rows.filter(r=>!isBlankRow(r)),...rows]:rows,source:draft.file});notify(`Imported ${rows.length} rows from ${draft.file}. Blank cells now show suggestions.`);onClose();};
 return <div class="modal-backdrop"><section class="modal import-modal" role="dialog" aria-modal="true" aria-label="Import load list">
  <div class="panel-heading"><div><div class="eyebrow">IMPORT LOAD LIST</div><h2>{draft.file}</h2><p>{found.length} of the sheet's input columns found. Check the matches, then import.</p></div><button class="icon-button" aria-label="Close import" onClick={onClose}><X size={18}/></button></div>
  <div class="import-source">{draft.tables.length>1&&<label class="field"><span>Worksheet</span><select value={draft.sheet} onChange={e=>setDraft(draftFor(draft.file,draft.tables,+e.currentTarget.value))}>{draft.tables.map((t,i)=><option key={t.name} value={i}>{t.name}</option>)}</select></label>}
   <label class="field"><span>Header row</span><select value={draft.header} onChange={e=>{const header=+e.currentTarget.value;setDraft({...draft,header,mapping:detectColumns(table?.rows[header]??[])});}}>{(table?.rows??[]).slice(0,25).map((r,i)=><option key={i} value={i}>Row {i+1}: {r.filter(Boolean).slice(0,4).join(' · ').slice(0,60)||'(empty)'}</option>)}</select></label></div>
  <div class="mapping-list">{INPUT_COLS.map(col=><label key={col} class={draft.mapping[col]!==undefined?'found':''}><span><b>{col}</b>{head(col)}</span><select value={draft.mapping[col]??''} onChange={e=>{const v=e.currentTarget.value,mapping={...draft.mapping};if(v==='')delete mapping[col];else mapping[col]=+v;setDraft({...draft,mapping});}}><option value="">Not in file</option>{headers.map((h,i)=><option key={i} value={i}>{h}</option>)}</select></label>)}</div>
  {error&&<p class="import-error">{error}</p>}{!!table?.formulaCells&&<p class="import-cache-note">This worksheet contains {table.formulaCells} formula cells. Import uses their saved values, not recalculated formulas. Recalculate and save the source in Excel first; review mapped values before importing.</p>}
  <div class="modal-actions"><span class="muted">{rows.length} rows to import. Anything not in the file is left blank for you or the suggestions to fill.</span><button class="button secondary small" onClick={onClose}>Cancel</button>{existing>0&&<button class="button secondary small" disabled={!rows.length} onClick={()=>finish(true)}>Add to current list</button>}<button class="button primary small" disabled={!rows.length} onClick={()=>finish(false)}><Check size={15}/>{existing?'Replace list':`Import ${rows.length} rows`}</button></div>
 </section></div>;
}

function Defaults() {
 const d=project.value.list.defaults,types=unique(TABLES.cableTypes.map(t=>t.type));
 const cores=(p:number)=>TABLES.cores.filter(c=>c.phases===p&&c.type===d.cableType).map(c=>c.cores);
 const methods=unique(TABLES.methods.filter(m=>m[1]===d.cableType&&(m[0]===3&&m[2]===d.cores3||m[0]===1&&m[2]===d.cores1)).map(m=>String(m[3])));
 const sel=(label:string,value:string,options:string[],set:(v:string)=>void,wide=false)=><label class={`field ${wide?'wide':''}`}><span>{label}</span><select value={value} onChange={e=>set(e.currentTarget.value)}><option value="">No suggestion</option>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>;
 return <section class="defaults-bar" aria-label="Suggestion settings"><div class="defaults-title"><Sparkles size={15}/><div><b>Suggestions for blank cells</b><small>Protection, cable size and no. of cables are worked out per row.</small></div></div>
  {sel('Cable type',d.cableType,types,v=>setDefaults({cableType:v,cores3:TABLES.cores.some(c=>c.phases===3&&c.type===v&&c.cores===d.cores3)?d.cores3:'',cores1:TABLES.cores.some(c=>c.phases===1&&c.type===v&&c.cores===d.cores1)?d.cores1:''}),true)}
  {sel('Cores, 3-phase',d.cores3,cores(3),v=>setDefaults({cores3:v}))}{sel('Cores, 1-phase',d.cores1,cores(1),v=>setDefaults({cores1:v}))}
  {sel('Installation method',d.method,methods.includes(d.method)||!d.method?methods:[d.method,...methods],v=>setDefaults({method:v}),true)}
  <label class="field narrow"><span>Permissible VD (%)</span><input value={d.vdPct} maxLength={12} inputMode="decimal" onInput={e=>setDefaults({vdPct:e.currentTarget.value})}/></label>
 </section>;
}

type Status='pass'|'fail'|'incomplete'|'blank';
const statusOf=(r:RowResult):Status=>r.cells.A===''?'blank':failsCheck(r)?'fail':r.cells.AG==='PASS'&&r.cells.AN==='PASS'?'pass':'incomplete';
const fmt=(v:number,d=0)=>v.toLocaleString('en-SG',{maximumFractionDigits:d,minimumFractionDigits:d});
// Column views hide groups on screen only; export always writes every column.
const VIEWS:Record<string,readonly string[]>={'All columns':GROUPS.map(g=>g.name),Sizing:['Circuit','Load','Protection and cable','Voltage drop'],'Earth fault':['Circuit','Earth fault'],'Short circuit':['Circuit','Short circuit'],'Motor starting':['Circuit','Motor starting']};

function ColumnPicker({columns,visible,onChange}:{columns:readonly Col[];visible:readonly Col[];onChange:(v:Col[])=>void}) {
 return <div class="column-picker">{columns.map(col=><label key={col}><input type="checkbox" checked={visible.includes(col)} disabled={visible.length===1&&visible.includes(col)} onChange={e=>onChange(e.currentTarget.checked?[...visible,col]:visible.filter(c=>c!==col))}/><span>{col} · {COLUMNS.find(c=>c.col===col)?.header.replace(/\n/g,' ')}</span></label>)}</div>;
}

// Dropdown on <details>: closes on a click outside, Escape, or (item menus) picking an item.
export function Menu({label,title,children,end=false,panel=false}:{label:ComponentChildren;title?:string;children:ComponentChildren;end?:boolean;panel?:boolean}) {
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const close=(e:Event)=>{const d=ref.current;if(!d?.open)return;if(e instanceof KeyboardEvent){if(e.key!=='Escape')return;d.open=false;d.querySelector('summary')?.focus();}else if(!d.contains(e.target as Node))d.open=false;};
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);return ()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};},[]);
 return <details ref={ref} class={`menu ${end?'end':''}`}><summary class="button ghost small" title={title} aria-label={title}>{label}</summary>
  <div class={panel?'menu-panel':'menu-list'} onClick={e=>{if(!panel&&(e.target as Element).closest('button')&&ref.current)ref.current.open=false;}}>{children}</div></details>;
}

// Set one column on every selected row in a single undoable step.
function BulkBar({count,rows,effective}:{count:number;rows:readonly SheetRow[];effective:readonly SheetRow[]}) {
 const [col,setCol]=useState<InputCol>('O'),[value,setValue]=useState(''),sel=[...selection.value].sort((a,b)=>a-b);
 const kind=COLUMNS.find(c=>c.col===col)?.kind,options=kind==='list'?[...new Set(sel.flatMap(i=>listOptions(effective[i]??emptyRow())[col as ListCol]))]:[];
 const apply=()=>{const next=rows.map((r,i)=>selection.value.has(i)?{...r,[col]:value}:r);setListRows(next);notify(`${head(col)} set on ${count} row${count===1?'':'s'}. Undo with Ctrl+Z.`);};
 return <div class="bulk-bar" role="region" aria-label="Edit selected rows"><b>{count} selected</b><label><span>Set</span><select value={col} onChange={e=>{setCol(e.currentTarget.value as InputCol);setValue('');}}>{INPUT_COLS.map(c=><option key={c} value={c}>{c} · {head(c)}</option>)}</select></label>
  <label><span>to</span>{kind==='list'?<select value={value} onChange={e=>setValue(e.currentTarget.value)}><option value="">(blank)</option>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>:<input value={value} maxLength={MAX_CELL} placeholder="(blank)" onInput={e=>setValue(e.currentTarget.value)}/>}</label>
  <button class="button primary small" onClick={apply}><Check size={14}/>Apply</button><button class="button secondary small" onClick={()=>{const s=listSheet.value;setListRows(rows.map((r,i)=>selection.value.has(i)?{...r,...s.suggested[i]}:r));notify('Suggestions accepted for the selected rows.');}}><Sparkles size={14}/>Accept suggestions</button>
  <button class="button ghost small" onClick={()=>{setListRows(rows.filter((_,i)=>!selection.value.has(i)));selection.value=new Set();notify(`${count} row${count===1?'':'s'} deleted. Undo with Ctrl+Z.`);}}><Trash2 size={14}/>Delete</button><button class="icon-button" aria-label="Clear selection" onClick={()=>selection.value=new Set()}><X size={15}/></button></div>;
}
function Drawer({index}:{index:number}) {
 const s=listSheet.value,row=s.effective[index],res=s.results[index];
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')inspecting.value=null;};window.addEventListener('keydown',esc);return ()=>window.removeEventListener('keydown',esc);},[]);
 if(!row||!res)return null;
 return <aside class="drawer" aria-label={`Calculation for row ${index+1}`}><div class="drawer-head"><div><small>ROW {index+1}{res.cells.A!==''?` · ITEM ${res.cells.A}`:''}</small><h2>{row.C.trim()||'—'} → {row.D.trim()||'—'}</h2></div><button class="icon-button" aria-label="Close calculation" onClick={()=>inspecting.value=null}><X size={18}/></button></div>
  <Calculation row={row} result={res} index={index} rows={s.effective} results={s.results} onPickSize={size=>{setListCell(index,'AC',size);notify(`Row ${index+1}: cable size set to ${size} mm².`);}}/></aside>;
}
export function LoadList() {
 const list=project.value.list,s=listSheet.value,ref=useRef<HTMLInputElement>(null),drawing=useRef<HTMLInputElement>(null),stop=useRef<AbortController|null>(null),anchor=useRef<number|null>(null),[draft,setDraft]=useState<Draft|null>(null),[schematic,setSchematic]=useState<(SchematicRead&{columns?:string[]})|null>(null),[book,setBook]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[showIssues,setShowIssues]=useState(false),[showQty,setShowQty]=useState(false),[view,setView]=useState('All columns');
 const [sizingColumns,setSizingColumns]=useState<Col[]>(COLUMNS.map(c=>c.col));
 // Schematics (PDF, DXF, images) go through the drawing reader and a review step; tables go through column mapping.
 async function openDrawing(file:File){if(stop.current)return;const ctl=new AbortController();stop.current=ctl;setBusy(true);setProgress('Reading the drawing…');try{const read=await readSchematic(file,p=>setProgress(p.message),ctl.signal);setBook(false);setSchematic(read);}catch(e){notify(e instanceof Error?e.message:'Could not read the drawing.');}finally{stop.current=null;setBusy(false);setProgress('');if(drawing.current)drawing.current.value='';}}
 async function open(file:File){if(isSchematic(file.name)){await openDrawing(file);return;}setBusy(true);try{const tables=(await readTables(file)).filter(t=>t.rows.some(r=>r.some(Boolean)));if(!tables.length)throw Error('The file has no rows.');
  // Several MCC/DB panels in one workbook: review them together so each load keeps its panel as From.
  const panels=readPanels(tables);if(panels.panels>1){setBook(true);setSchematic({...panels,file:file.name,pages:panels.sheets,ocrPages:0,text:[...panels.boards.map(b=>`Panel ${b}`),...panels.candidates.map(c=>c.evidence)]});return;}
  const scores=tables.map(t=>Object.keys(detectColumns(t.rows[bestHeader(t.rows)]??[])).length);setDraft(draftFor(file.name,tables,scores.indexOf(scores.reduce((a,b)=>b>a?b:a,0))));}catch(e){notify(e instanceof Error?e.message:'Could not read the file.');}finally{setBusy(false);if(ref.current)ref.current.value='';}}
 const input=<><input ref={ref} class="visually-hidden" type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label="Choose load list file" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void open(f);}}/><input ref={drawing} class="visually-hidden" type="file" accept={SCHEMATIC_ACCEPT} aria-label="Choose schematic drawing" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void openDrawing(f);}}/></>;
 const dialog=<>{draft&&<ImportDialog draft={draft} setDraft={setDraft} onClose={()=>setDraft(null)}/>}{schematic&&<SchematicReview read={schematic} workbook={book} onClose={()=>setSchematic(null)}/>}{busy&&progress&&<div class="reading-bar" role="status"><Network size={15}/><span>{progress}</span><button class="button secondary small" onClick={()=>stop.current?.abort()}>Cancel</button></div>}</>;
 if(!list.rows.length)return <div class="sheet-page">{input}{dialog}
  <div class="page-head"><div><h1>Cable sizing</h1><p>Size every circuit on one Cable Sizing sheet. Send equipment here from the Load list tab, import a list, or type circuits in. Sizing here never changes the Load list.</p></div></div>
  <section class={`panel list-empty ${busy?'busy':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer?.files[0];if(f)void open(f);}}>
   <Upload size={26}/><h2>Drop a load list or a schematic here</h2><p>XLSX or CSV load lists: From, To, phases, voltage, kW, PF, diversity, protection and cable length are picked up when present. A Cable Sizing workbook exported from this app imports as it is.</p><p>Schematics (PDF, DXF, PNG/JPG): single-line diagrams, DB schematics and circuit schedules become a load list you review before it reaches the sheet.</p>
   <div class="inline-actions"><button class="button primary" disabled={busy} onClick={()=>ref.current?.click()}><Upload size={16}/>{busy?'Reading…':'Choose load list'}</button><button class="button secondary" disabled={busy} onClick={()=>drawing.current?.click()}><Network size={16}/>From schematic</button><button class="button secondary" onClick={()=>setList({rows:Array.from({length:12},emptyRow),source:'Typed in'})}><Table2 size={16}/>Start an empty sheet</button><button class="button secondary" onClick={()=>tab.value='loads'}><ClipboardList size={16}/>From the Load list tab</button></div>
   <small>You can also paste rows copied from Excel straight into the sheet.</small>
  </section></div>;
 const statuses=s.results.map(statusOf),filled=statuses.filter(x=>x!=='blank').length,pass=statuses.filter(x=>x==='pass').length,fail=statuses.filter(x=>x==='fail').length,pending=suggestionCount(s);
 const issues=findIssues(s.effective,s.results),flagged=new Set(issues.filter(x=>x.level!=='info').map(x=>x.row)),q=listSearch.value.trim().toLowerCase(),f=listFilter.value;
 // One tab per panel, as the load list had one worksheet per MCC/DB: a load's panel is its From.
 const panelOf=(i:number)=>list.rows[i]!.C.trim(),panels=unique(list.rows.flatMap((r,i)=>isBlankRow(r)?[]:[panelOf(i)])),p=listPanel.value!==null&&panels.includes(listPanel.value)?listPanel.value:null;
 // Boards already carry their downstream load, so only final circuits (nothing fed from them) are summed.
 const feeds=new Set(list.rows.map(r=>r.C.trim().toLowerCase()).filter(Boolean)),finals=s.results.filter((r,i)=>r.cells.A!==''&&!feeds.has(list.rows[i]!.D.trim().toLowerCase()));
 const kw=finals.reduce((a,r)=>a+(typeof r.cells.G==='number'?r.cells.G:0),0),kva=finals.reduce((a,r)=>a+(typeof r.cells.J==='number'?r.cells.J:0),0);
 const worst=s.results.reduce<{i:number;v:number}|null>((w,r,i)=>typeof r.cells.AL==='number'&&(!w||r.cells.AL>w.v)?{i,v:r.cells.AL}:w,null),groups=cableGroups.value,km=groups.reduce((a,g)=>a+g.runsM.reduce((x,y)=>x+y,0),0)/1000;
 const match=(i:number)=>{const st=statuses[i];if(p!==null&&panelOf(i)!==p)return false;if(f==='issues'&&!flagged.has(i)||f==='fail'&&st!=='fail'||f==='pass'&&st!=='pass'||f==='incomplete'&&st!=='incomplete'||f==='suggested'&&!Object.keys(s.suggested[i]??{}).length)return false;if(!q)return true;const r=list.rows[i]!;return [r.C,r.D,String(s.results[i]?.cells.A??'')].some(v=>v.toLowerCase().includes(q));};
 const order=f==='all'&&!q&&p===null?undefined:list.rows.map((_,i)=>i).filter(match);
 const counts:Record<ListFilter,number>={all:filled,issues:flagged.size,fail,incomplete:filled-pass-fail,suggested:s.suggested.filter(x=>Object.keys(x).length).length,pass};
 const select=(i:number,range:boolean)=>{const cur=new Set(selection.value),ids=order??list.rows.map((_,k)=>k);if(range&&anchor.current!==null){const a=ids.indexOf(anchor.current),b=ids.indexOf(i);for(const k of ids.slice(Math.min(a,b),Math.max(a,b)+1))cur.add(k);}else{if(cur.has(i))cur.delete(i);else cur.add(i);anchor.current=i;}selection.value=cur;};
 const goto=(row:number,col:string)=>{if(!GROUPS.some(g=>VIEWS[view]!.includes(g.name)&&g.cols.includes(col as never)))setView('All columns');if(!sizingColumns.includes(col as Col))setSizingColumns(COLUMNS.map(c=>c.col));listPanel.value=null;listFilter.value='all';listSearch.value='';setTimeout(()=>{const el=document.querySelector('.sheet-scroll');if(el)el.scrollTop=Math.max(0,row*33-120);setTimeout(()=>focusCell(row,col),60);},0);};
 return <div class={`sheet-page ${inspecting.value!==null?'with-drawer':''}`}>{input}{dialog}
  <div class="page-head"><div><h1>Cable sizing</h1><p>{list.source||'Load list'} · {filled} circuits{panels.length>1?` on ${panels.length} panels`:''}</p></div>
   <div class="page-actions"><Menu label={<><Upload size={15}/>Import<ChevronDown size={14}/></>}><button disabled={busy} onClick={()=>ref.current?.click()}><Upload size={15}/>Import load list…</button><button disabled={busy} onClick={()=>drawing.current?.click()}><Network size={15}/>From schematic…</button></Menu>
    <button class="button secondary small" onClick={()=>{listFilter.value='all';listSearch.value='';setListRows([...list.rows,{...emptyRow(),C:p??''}]);}}><Plus size={15}/>Add row</button>
    <Menu title="More actions" end label={<MoreHorizontal size={17}/>}><button disabled={!filled} onClick={()=>printReport('list')}><Printer size={15}/>Print / PDF</button></Menu>
    <button class="button primary small" disabled={exporting.value||!filled} onClick={()=>void exportExcel(s.effective,'cable sizing')}><FileSpreadsheet size={15}/>Export to Excel</button></div></div>
  <p class="list-summary" aria-label="Summary"><span><b>{filled}</b> circuits</span><em class="ok">{pass} pass</em><em class="bad">{fail} fail</em><em class="warn">{filled-pass-fail} incomplete</em><i/>
   <span title={`${finals.length} final circuits · ${fmt(kva,1)} kVA`}><b>{fmt(kw,1)}</b> kW</span><i/>
   <span>Worst VD {worst?<button class="text-button" title={`Show the calculation for ${s.effective[worst.i]?.D||`row ${worst.i+1}`}`} onClick={()=>inspecting.value=worst.i}><b class={Number(list.rows[worst.i]?.AM||s.effective[worst.i]?.AM)<worst.v?'bad':''}>{worst.v.toFixed(2)} %</b>{s.effective[worst.i]?.D||`Row ${worst.i+1}`}</button>:'—'}</span><i/>
   <button class="text-button" aria-expanded={showQty} title={`${groups.length} cable products`} onClick={()=>setShowQty(!showQty)}><b>{km.toFixed(2)}</b> km cable</button><i/>
   <span><b>{pending}</b> suggestions</span>{pending>0&&<button class="text-button" onClick={acceptAll}>Accept all</button>}</p>
  {showQty&&<section class="panel qty-panel"><table><thead><tr><th>Cable</th><th>Circuits</th><th>Runs</th><th>Total m</th><th/></tr></thead><tbody>{groups.map(g=><tr key={g.key}><td>{g.label}{g.perSet>1&&<small> · {g.perSet} cores per set</small>}</td><td>{g.items}{g.uncheckedItems>0&&<small class="warn"> ({g.uncheckedItems} not passing)</small>}</td><td>{g.runsM.length}</td><td>{fmt(g.runsM.reduce((a,b)=>a+b,0))}</td><td><button class="text-button" onClick={()=>{updateProject({runsFrom:g.key});tab.value='drums';}}>Plan drums →</button></td></tr>)}</tbody></table>{!groups.length&&<p class="muted">Sized circuits with a cable run appear here.</p>}</section>}
  <div class="toolbar filter-bar">{panels.length>1&&<label class="panel-pick"><span class="visually-hidden">Panel</span><select value={p===null?'all':String(panels.indexOf(p))} onChange={e=>{const v=e.currentTarget.value;listPanel.value=v==='all'?null:panels[+v]??null;}}><option value="all">All panels ({panels.length})</option>{panels.map((name,k)=><option key={name} value={k}>{name||'No panel'} ({list.rows.filter((r,i)=>!isBlankRow(r)&&panelOf(i)===name).length})</option>)}</select></label>}
   <div class="segmented" role="tablist" aria-label="Filter rows">{(['all','issues','fail','incomplete','suggested','pass'] as const).map(k=><button key={k} role="tab" aria-selected={f===k} class={f===k?'active':''} onClick={()=>listFilter.value=k}>{k==='all'?'All':k==='issues'?'Flagged':k[0]!.toUpperCase()+k.slice(1)}<b class={k==='fail'||k==='issues'?'bad':k==='pass'?'ok':k==='incomplete'?'warn':''}>{counts[k]}</b></button>)}</div>
   <label class="search"><Search size={14}/><input value={listSearch.value} placeholder="Find From / To / item" aria-label="Find rows" onInput={e=>listSearch.value=e.currentTarget.value}/></label>
   <div class="filter-end"><button class={`button small ${showIssues?'secondary':'ghost'}`} aria-expanded={showIssues} onClick={()=>setShowIssues(!showIssues)}><AlertTriangle size={14}/>Issues {issues.filter(x=>x.level!=='info').length}</button>
    <Menu panel end label={<><Sparkles size={14}/>Defaults<ChevronDown size={13}/></>}><Defaults/></Menu>
    <Menu end label={<><Columns3 size={14}/>View: {view}<ChevronDown size={13}/></>}>{Object.keys(VIEWS).map(k=><button key={k} role="menuitemradio" aria-checked={view===k} onClick={()=>setView(k)}><Check size={14} class={view===k?'':'off'}/>{k}</button>)}<div class="menu-note"><Legend/><span class="sug-key"><i/>Suggested (blue italic)</span><small>Views hide columns on screen only. Export writes every column.</small></div></Menu></div></div>
  {showIssues&&<section class="panel issues-panel" aria-label="Issues">{issues.length?<ul>{issues.slice(0,200).map((x,k)=><li key={k} class={x.level}><button onClick={()=>goto(x.row,x.col)}><b>{s.effective[x.row]?.D||`Row ${x.row+1}`}</b><span>{x.text}</span><small>{x.col}{x.row+2}</small></button></li>)}</ul>:<p class="muted">No issues. Every complete row passes both checks.</p>}</section>}
  {selection.value.size>0&&<BulkBar count={selection.value.size} rows={list.rows} effective={s.effective}/>}
  <div class="sheet-section-head"><div><h2>Cable sizing data</h2><p>Calculated results and workbook inputs for each circuit.</p></div><Menu panel end label={<><Columns3 size={14}/>Columns<ChevronDown size={13}/></>}><ColumnPicker columns={COLUMNS.map(c=>c.col)} visible={sizingColumns} onChange={setSizingColumns}/></Menu></div>
  <Sheet tall groups={VIEWS[view]!} columns={sizingColumns} marks={statuses} rows={list.rows} effective={s.effective} results={s.results} suggested={s.suggested} order={order} selected={selection.value} active={inspecting.value} onSelect={select} onInspect={i=>inspecting.value=i} onChange={setListCell} onAddRow={()=>setListRows([...project.value.list.rows,emptyRow()])} onDelete={i=>{setListRows(list.rows.filter((_,j)=>j!==i));selection.value=new Set();if(inspecting.value===i)inspecting.value=null;}} onPaste={(i,col,grid)=>setListRows(pasteGrid(list.rows,i,col,grid,cleanValue,2000,sizingColumns.filter(c=>GROUPS.some(g=>VIEWS[view]!.includes(g.name)&&g.cols.includes(c)))))}/>
  <details class="workbook-notes"><summary><BookOpen size={15}/>How the sheet works</summary><p>Blue italic values are suggestions; type or pick a value to override them. Suggestions are preliminary: smallest table size meeting Ib ≤ In ≤ Iz and the permissible VD, using the workbook's ratings ({TABLES.source.catalogue.split(' - ')[0]}). Export includes suggested values as entered values. Excel cell references in the issues list (for example AG12) match the exported workbook.</p><ol>{TABLES.notes.map(n=><li key={n}>{n.replace(/^\d+\.\s*/,'')}</li>)}</ol></details>
  {inspecting.value!==null&&<Drawer index={inspecting.value}/>}
 </div>;
}
