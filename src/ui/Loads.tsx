import {useRef,useState} from 'preact/hooks';
import {Upload,Plus,FileSpreadsheet,Trash2,Send,ClipboardList,BookOpen} from 'lucide-preact';
import {project,loadSheets,plantLoad,catalogueIndex,setLoads,setPanel,setLoadRows,setLoadCell,loadPanel,loadView,notify,tab,setList} from './state';
import {Catalogue} from './Catalogue';
import {Scenario} from './Scenario';
import {fmt} from './components';
import {DUTIES,STARTERS,TICK,TICK_KEYS,isTick,emptyLoad,configsOf,modelsOf,num,sameText,DEFAULT_FACTORS,DEFAULT_MARGIN,type Balance,type Duty,type LoadKey,type Pair} from '../engine/loads';
import {clip,isBlankRow,MAX_CELL} from '../engine/sheet';
import {readTables} from '../import/load-list';
import {readEquipment,mergePanels,mergeCatalogue,toSizing,mergeSizing} from '../import/equipment';
import {exportLoads} from '../export/equipment';

type Col={key?:LoadKey;head:string;sub?:string;kind:'text'|'num'|'tick'|'list'|'calc';w:number;list?:readonly string[];calc?:(b:Balance)=>number|null;group?:string;duty?:Duty};
const pair=(d:Duty,group:string):Col[]=>[{head:'kW',kind:'calc',w:72,group,duty:d,calc:b=>b.duty===d?b.kw:null},{head:'kVAr',kind:'calc',w:72,group,duty:d,calc:b=>b.duty===d?b.kvar:null}];
// The equipment list's columns, in the workbook's order.
const LAYOUT:Col[]=[
 {key:'kks',head:'KKS No.',kind:'text',w:100},{key:'description',head:'Description',kind:'text',w:200},{key:'brand',head:'Brand',kind:'text',w:112},
 {key:'model',head:'Model /',sub:'Part Number',kind:'text',w:180},{key:'config',head:'Configuration',kind:'text',w:170},
 {key:'vital',head:'Vital',kind:'tick',w:50},{key:'essential',head:'Essential',kind:'tick',w:66},{key:'nonEssential',head:'Non-Essential',kind:'tick',w:72},{key:'restart',head:'Re-starting',kind:'tick',w:70},
 {key:'starter',head:'Starter Type',kind:'list',list:STARTERS,w:96},{key:'cis',head:'C/I/S',kind:'list',list:DUTIES,w:58},
 {key:'consumedKw',head:'Consumed Load',sub:'(kW)',kind:'num',w:86},{key:'ratedKw',head:'Rated Input Power',sub:'(kW)',kind:'num',w:86},{key:'protA',head:'Protection Device',sub:'Rating (A)',kind:'num',w:88},
 {key:'inA',head:'In',sub:'(A)',kind:'num',w:66},{key:'un',head:'Un',kind:'text',w:150},{head:'Load Factor',kind:'calc',w:66,calc:b=>b.loadFactor},
 {key:'efficiency',head:'Efficiency',kind:'num',w:74},{key:'pf',head:'Power Factor',kind:'num',w:70},
 ...pair('C','Continuous Load'),...pair('I','Intermittent Load'),...pair('S','Standby Load'),
];
const KEYS=LAYOUT.flatMap(c=>c.key?[c.key]:[]),NO_W=44,LEFT=[NO_W,NO_W+100];
const NAMES:Record<Duty,string>={C:'Continuous',I:'Intermittent',S:'Standby'};
const n2=(v:number|null)=>v===null?'':fmt(v,2);
const isTickKey=(k:LoadKey)=>(TICK_KEYS as readonly string[]).includes(k);
// Header groups: runs of columns that share a group name (Continuous Load over its kW and kVAr).
// Each duty's kW and kVAr pair wears its own tint, from the group heading down to the cells, so C, I and S read apart.
const GROUPS=LAYOUT.reduce<{name:string;span:number;duty?:Duty}[]>((g,c)=>{const name=c.group??'',last=g[g.length-1];if(last&&last.name===name)last.span++;else g.push(c.duty?{name,span:1,duty:c.duty}:{name,span:1});return g;},[]);
const badFraction=(v:string)=>{if(!v.trim())return false;const n=num(v.replace(/\s*%$/,''));return n===null||n<=0||n>100;};

function Grid({index}:{index:number}) {
 const panel=project.value.loads.panels[index]!,sheet=loadSheets.value[index]!,idx=catalogueIndex.value,[active,setActive]=useState(-1);
 const at=sheet.filled[active]?.row,models=modelsOf(project.value.loads.catalogue,at?.brand??''),configs=at?configsOf(idx,at.brand,at.model):[];
 // A block copied from Excel fills across from the cell and down from the row, adding rows as needed.
 const paste=(r:number,k:LoadKey)=>(e:ClipboardEvent)=>{
  const text=e.clipboardData?.getData('text/plain')??'';if(!/[\t\n]/.test(text.replace(/\r?\n$/,'')))return;e.preventDefault();
  const grid=text.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(l=>l.split('\t')),start=KEYS.indexOf(k),rows=[...panel.rows];
  grid.forEach((cells,y)=>{const row={...(rows[r+y]??emptyLoad())};cells.forEach((v,x)=>{const key=KEYS[start+x];if(!key)return;const t=v.trim();row[key]=clip(isTickKey(key)?isTick(t)?TICK:'':key==='cis'?t.toUpperCase():t);});rows[r+y]=row;});
  setLoadRows(index,rows);
 };
 const frozen=(ci:number)=>ci<2?{cls:'frozen',style:{left:`${LEFT[ci]}px`}}:{cls:'',style:undefined};
 return <div class="sheet-scroll tall"><table class="sheet load-sheet" role="grid" aria-label={`${panel.name} equipment list`}>
  <colgroup><col style={{width:`${NO_W}px`}}/>{LAYOUT.map((c,i)=><col key={i} style={{width:`${c.w}px`}}/>)}<col style={{width:'36px'}}/></colgroup>
  <thead>
   <tr class="groups"><th class="frozen" style={{left:0}} colSpan={3}>EQUIPMENT LIST</th>{GROUPS.map((g,k)=>k===0?(g.span>2?<th key={k} colSpan={g.span-2}/>:null):<th key={k} colSpan={g.span} class={g.duty?`duty-${g.duty}`:''}>{g.name}</th>)}<th aria-hidden="true"/></tr>
   <tr class="heads"><th class="calc frozen" style={{left:0,top:'24px'}}>No.</th>{LAYOUT.map((c,ci)=>{const f=frozen(ci);return <th key={ci} scope="col" class={`${c.kind==='calc'?'calc':c.kind==='list'||c.kind==='tick'?'list':'input'} ${f.cls} ${c.duty?`duty-${c.duty}`:''}`} style={{...f.style,top:'24px'}}><span>{c.head}</span>{c.sub&&<small>{c.sub}</small>}</th>;})}<th class="calc" style={{top:'24px'}}><span class="visually-hidden">Row tools</span></th></tr>
  </thead>
  <tbody>{panel.rows.map((raw,r)=>{const f=sheet.filled[r]!,b=sheet.bal[r]!;return <tr key={r}>
   <td class="calc num frozen" style={{left:0}}>{r+1}</td>
   {LAYOUT.map((c,ci)=>{
    if(c.kind==='calc')return <td key={ci} class={`calc num ${c.duty?`duty-${c.duty}`:''}`}>{n2(c.calc!(b))}</td>;
    const k=c.key!,v=raw[k],label=`${c.head}${c.sub?` ${c.sub}`:''}, row ${r+1}`,fz=frozen(ci);
    if(c.kind==='tick')return <td key={k} class="tick"><input type="checkbox" checked={isTick(v)} aria-label={label} onChange={e=>setLoadCell(index,r,k,e.currentTarget.checked?TICK:'')}/></td>;
    if(c.kind==='list'){const opts=v&&!c.list!.includes(v)?[v,...c.list!]:c.list!;return <td key={k} class={k==='cis'&&b.duty?`duty-${b.duty}`:''}><select aria-label={label} value={v} onChange={e=>setLoadCell(index,r,k,e.currentTarget.value)}><option value=""/>{opts.map(o=><option key={o} value={o}>{o}</option>)}</select></td>;}
    const sug=!v.trim()&&f.from.has(k),bad=(k==='efficiency'||k==='pf')&&badFraction(v);
    return <td key={k} class={`${c.kind==='num'?'num':''} ${sug?'sug':''} ${bad?'bad':''} ${fz.cls}`} style={fz.style} title={sug?`From the catalogue: ${f.row[k]}. Type to override.`:bad?'Enter a decimal such as 0.95 (or 95 %).':undefined}>
     <input aria-label={label} value={v} placeholder={sug?f.row[k]:''} list={k==='brand'?'ll-brands':k==='model'?'ll-models':k==='config'?'ll-configs':undefined} maxLength={MAX_CELL} inputMode={c.kind==='num'?'decimal':'text'} autoComplete="off" spellcheck={false}
      onFocus={()=>setActive(r)} onInput={e=>setLoadCell(index,r,k,e.currentTarget.value)} onPaste={paste(r,k)}/></td>;
   })}
   <td class="row-tools"><button class="icon-button danger" aria-label={`Delete row ${r+1}`} title="Delete row" onClick={()=>setLoadRows(index,panel.rows.filter((_,j)=>j!==r))}><Trash2 size={13}/></button></td>
  </tr>;})}</tbody>
 </table>
 <datalist id="ll-brands">{idx.brands.map(b=><option key={b} value={b}/>)}</datalist>
 <datalist id="ll-models">{models.slice(0,500).map(m=><option key={m} value={m}/>)}</datalist>
 <datalist id="ll-configs">{configs.map(c=><option key={c} value={c}/>)}</datalist>
 {!panel.rows.length&&<p class="sheet-empty">No equipment yet. Add a row or paste rows copied from Excel.</p>}
 </div>;
}

function TotalsBlock({index}:{index:number}) {
 const p=project.value.loads.panels[index]!,t=loadSheets.value[index]!.totals,cells=(x:Record<Duty,Pair>)=>DUTIES.flatMap(d=>[<td key={`${d}w`} class={`duty-${d}`}>{n2(x[d].kw)}</td>,<td key={`${d}v`} class={`duty-${d}`}>{n2(x[d].kvar)}</td>]);
 const factor=(d:Duty)=>{const v=p.factors[d];return <td key={d} colSpan={2} class={num(v)===null?'bad':''}><input aria-label={`${NAMES[d]} operating factor`} value={v} inputMode="decimal" onInput={e=>setPanel(index,{factors:{...p.factors,[d]:e.currentTarget.value.slice(0,20)}},`factor:${index}:${d}`)}/></td>;};
 return <section class="panel load-totals" aria-label="Panel load">
  <table><thead><tr><th>Load basis</th>{DUTIES.map(d=><th key={d} colSpan={2} class={`duty-${d}`}>{NAMES[d]} ({d})</th>)}</tr><tr><th/>{DUTIES.flatMap(d=>[<th key={`${d}w`}>kW</th>,<th key={`${d}v`}>kVAr</th>])}</tr></thead>
   <tbody><tr><td>Total connected load</td>{cells(t.total)}</tr><tr><td title="kW and kVAr are each the largest in the duty, as in the template">Largest single load</td>{cells(t.largest)}</tr>
    <tr><td title="The duty total is multiplied by this factor, then compared with the largest single load.">Operating factor</td>{DUTIES.map(factor)}</tr>
    <tr><td>Total × operating factor</td>{cells(t.operating)}</tr>
    <tr class="strong"><td title="Per duty, the larger of the largest single load and the total × operating factor, as the template does">Counted (larger of the two)</td>{cells(t.counted)}</tr>
    <tr><td>kVA before operating factors</td>{DUTIES.map(d=><td key={d} colSpan={2}>{n2(t.baseKva[d])} kVA</td>)}</tr></tbody></table>
  <div class="load-overall">
   <label class={num(p.margin)===null?'bad':''}>Design margin<input aria-label="Design margin" value={p.margin} inputMode="decimal" onInput={e=>setPanel(index,{margin:e.currentTarget.value.slice(0,20)},`margin:${index}`)}/><small>0.1 = 10 %</small></label>
   <span>Overall load <b>{n2(t.overall.kw)}</b> kW · <b>{n2(t.overall.kvar)}</b> kVAr · <b>{n2(t.overall.kva)}</b> kVA</span>
   <span>With design margin <b>{n2(t.withMargin.kw)}</b> kW · <b>{n2(t.withMargin.kvar)}</b> kVAr · <b>{n2(t.withMargin.kva)}</b> kVA</span>
  </div>
 </section>;
}

export function Loads() {
 const loads=project.value.loads,panels=loads.panels,view=loadView.value,file=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false);
 const i=Math.min(loadPanel.value,Math.max(0,panels.length-1)),panel=panels[i],items=panels.reduce((a,p)=>a+p.rows.filter(r=>r.description.trim()).length,0),plant=plantLoad.value;
 async function open(f:File){
  setBusy(true);
  try{
   const read=readEquipment(await readTables(f),f.name),pm=mergePanels(loads.panels,read.panels),cm=mergeCatalogue(loads.catalogue,read.catalogue),count=read.panels.reduce((a,p)=>a+p.rows.length,0);
   setLoads({panels:pm.panels,catalogue:cm.catalogue,source:f.name});
   if(read.panels[0])loadPanel.value=pm.panels.findIndex(p=>sameText(p.name,read.panels[0]!.name));
   notify([read.panels.length?`Imported ${read.panels.length} panel${read.panels.length===1?'':'s'} (${count} items${pm.replaced?`; ${pm.replaced} replaced panels of the same name`:''})`:'',
    read.catalogue.length?`${read.catalogue.length} catalogue entries (${cm.added} new)`:'',...read.notes].filter(Boolean).map(s=>s.replace(/\.$/,'')).join('. ')+'. Undo with Ctrl/⌘+Z.');
  }catch(e){notify(e instanceof Error?e.message:'Could not read the file.');}
  finally{setBusy(false);if(file.current)file.current.value='';}
 }
 function addPanel(){
  if(panels.length>=50){notify('A load list supports at most 50 panels.');return;}
  const names=new Set(panels.map(p=>p.name.trim().toLowerCase()));let n=panels.length+1;while(names.has(`panel ${n}`))n++;
  setLoads({panels:[...panels,{name:`Panel ${n}`,rows:Array.from({length:10},emptyLoad),factors:{...DEFAULT_FACTORS},margin:DEFAULT_MARGIN}]});loadPanel.value=panels.length;loadView.value='panels';
 }
 // One way only: the load list fills cable sizing; editing cable sizing never changes the load list.
 function send(){
  const rows=toSizing(panels,catalogueIndex.value);if(!rows.length){notify('Give at least one item a Description before sending it to cable sizing.');return;}
  const m=mergeSizing(project.value.list.rows.filter(r=>!isBlankRow(r)),rows);if(m.rows.length>2000){notify('Cable sizing holds at most 2,000 rows.');return;}
  setList({rows:m.rows,source:project.value.list.source||'From the load list'});tab.value='list';
  notify(`Sent ${rows.length} loads to cable sizing: ${m.added} added, ${m.updated} updated. From = panel, To = description, Design Load = rated input power.`);
 }
 const input=<input ref={file} class="visually-hidden" type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label="Choose load list workbook" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void open(f);}}/>;
 const head=<div class="page-head"><div><h1>Load list</h1><p>{panels.length?`${loads.source||'Equipment list'} · ${items} items on ${panels.length} panel${panels.length===1?'':'s'} · plant ${fmt(plant.overall.kva,1)} kVA (${fmt(plant.withMargin.kva,1)} kVA with margin)`:'Equipment per panel, with its load balance. Send it to cable sizing when ready.'}</p></div>
  <div class="page-actions"><button class="button secondary small" disabled={busy} onClick={()=>file.current?.click()}><Upload size={15}/>{busy?'Reading…':'Import'}</button>
   <button class="button secondary small" disabled={!items} onClick={()=>void exportLoads(panels,loads.catalogue,project.value.name).catch((e:unknown)=>notify(e instanceof Error?e.message:'Export failed.'))}><FileSpreadsheet size={15}/>Export to Excel</button>
   <button class="button primary small" disabled={!items} title="From = panel, To = description" onClick={send}><Send size={15}/>Send to cable sizing</button></div></div>;
 const views=<div class="segmented load-views" role="tablist" aria-label="Load list view">{([['panels','Panels'],['catalogue','Catalogue'],['scenario','Search & compare']] as const).map(([k,l])=><button key={k} role="tab" aria-selected={view===k} class={view===k?'active':''} onClick={()=>loadView.value=k}>{l}{k==='catalogue'&&<b>{loads.catalogue.length}</b>}{k==='panels'&&<b>{panels.length}</b>}</button>)}</div>;
 if(view==='catalogue')return <div class="sheet-page">{input}{head}{views}<Catalogue/></div>;
 if(view==='scenario')return <div class="sheet-page">{input}{head}{views}<Scenario/></div>;
 return <div class="sheet-page">{input}{head}{views}
  {panel&&<p class="muted">Export uses the template's intermittent reactive-load formula, which can produce a different panel total from the website.</p>}
  {!panel?<section class="panel list-empty"><ClipboardList size={26}/><h2>Start a load list</h2>
    <p>One tab per panel (MCC, DB, switchboard). List its equipment with KKS, duty and consumed load; pick Brand, Model and Configuration and the catalogue fills in rated power, In, Un, efficiency and power factor.</p>
    <p>Import an equipment-list workbook: each panel sheet becomes a tab and its "Brand (…)" sheets become the catalogue.</p>
    <div class="inline-actions"><button class="button primary" onClick={addPanel}><Plus size={16}/>Add panel</button><button class="button secondary" disabled={busy} onClick={()=>file.current?.click()}><Upload size={16}/>{busy?'Reading…':'Import load list'}</button></div></section>
  :<>
   <div class="load-tabs" role="tablist" aria-label="Panels">{panels.map((p,k)=><button key={k} role="tab" aria-selected={k===i} class={k===i?'active':''} onClick={()=>loadPanel.value=k}>{p.name.trim()||`Panel ${k+1}`}<small>{p.rows.filter(r=>r.description.trim()).length}</small></button>)}
    <button class="add" onClick={addPanel} title="Add panel"><Plus size={14}/>Add panel</button></div>
   <div class="toolbar load-bar"><label class="field inline"><span>Panel name</span><input value={panel.name} maxLength={60} aria-label="Panel name" onInput={e=>setPanel(i,{name:e.currentTarget.value},`panel-name:${i}`)}/></label>
    <span class="muted">Sent to cable sizing as From.</span>
    <button class="button ghost small danger" onClick={()=>{setLoads({panels:panels.filter((_,k)=>k!==i)});loadPanel.value=Math.max(0,i-1);notify(`Deleted ${panel.name||'the panel'}. Undo with Ctrl/⌘+Z.`);}}><Trash2 size={14}/>Delete panel</button></div>
   <Grid index={i}/>
   <div class="inline-actions add-rows"><button class="button secondary small" onClick={()=>setLoadRows(i,[...panel.rows,emptyLoad()])}><Plus size={15}/>Add row</button><span class="sug-key"><i/>From the catalogue (blue italic): type over it to override</span></div>
   <TotalsBlock index={i}/>
   <details class="workbook-notes"><summary><BookOpen size={15}/>How the load list works</summary><p>Input kW = Consumed Load ÷ Efficiency (Consumed Load when efficiency is blank); kVAr = kW × tan(acos Power Factor). Both appear only under the row's duty: C = Continuous, I = Intermittent, S = Standby. Load Factor = Consumed Load ÷ Rated Input Power.</p>
    <p>Panel load, as the equipment-list template: for each duty, the larger of the largest single load and the duty's total × its operating factor (kW and kVAr each on their own). The normal running load adds the three duties; the design margin is added on top. Plant load adds every panel.</p>
    <p>The exported workbook follows the supplied template's intermittent reactive-load formula. Its panel and plant reactive totals can therefore differ from the website's totals when several intermittent loads are present.</p>
    <p>Send to cable sizing adds one cable sizing row per item (two items with the same name stay two rows). Sending again updates those rows and never removes cable data you entered there. Editing cable sizing never changes this list.</p></details>
  </>}
 </div>;
}
