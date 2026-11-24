import {Fragment} from 'preact';
import {useState} from 'preact/hooks';
import {Search,GitCompare,ArrowUpRight,X,RotateCcw} from 'lucide-preact';
import {project,loadSheets,plantLoad,catalogueIndex,scenarioPick,loadPanel,loadView} from './state';
import {scenario,modelsOf,configsOf,num,fraction,isBlankLoad,fillRow,emptyLoad,entryAt,type ScenarioKey,type Side,type Load,type CatalogueKey,type CatalogueRow} from '../engine/loads';
import {allTypes} from '../engine/equipment-types';

const fmt=(n:number|null|undefined,d=2)=>n==null||!Number.isFinite(n)?'—':n.toLocaleString(undefined,{maximumFractionDigits:d});
// shortcut: lists the first 200 matches only; add paging if plants grow past a few thousand items.
const SHOWN=200;
const INPUTS:[ScenarioKey,string,string?][]=[['brand','Brand','sc-brands'],['model','Model / Part Number','sc-models'],['config','Configuration','sc-configs'],['consumedKw','Consumed load (kW)'],['ratedKw','Rated input power (kW)'],['inA','In (A)'],['un','Un'],['efficiency','Efficiency'],['pf','Power factor']];
type Input=Partial<Record<ScenarioKey,string>>;

type Series={label:string;values:readonly [number|null,number|null]};
// Horizontal grouped bars from one zero baseline: two series, value at each tip, the table below holds the same numbers.
function Bars({title,unit,names,groups}:{title:string;unit:string;names:readonly [string,string];groups:readonly Series[]}) {
 const max=Math.max(0,...groups.flatMap(g=>g.values.map(v=>v??0))),p=max>0?10**Math.floor(Math.log10(max/4)):1;
 const step=max>0?[1,2,2.5,5,10].map(m=>m*p).find(s=>max/s<=4)!:1,top=Math.max(step,Math.ceil(max/step-1e-9)*step);
 const W=560,L=170,R=70,BAR=18,GAP=2,ROW=BAR*2+GAP+18,H=groups.length*ROW+28,x=(v:number)=>L+(Math.max(0,v)/top)*(W-L-R);
 const bar=(v:number,y:number)=>{const x1=x(v),w=x1-L,r=Math.min(4,w,BAR/2);return `M${L} ${y}H${x1-r}a${r} ${r} 0 0 1 ${r} ${r}V${y+BAR-r}a${r} ${r} 0 0 1 ${-r} ${r}H${L}Z`;};
 const ticks=Array.from({length:Math.round(top/step)+1},(_,i)=>i*step);
 return <figure class="viz">
  <figcaption><b>{title}</b><span class="viz-legend">{names.map((n,i)=><span key={n}><i class={`viz-key s${i+1}`}/>{n}</span>)}</span></figcaption>
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${groups.map(g=>`${g.label} ${names[0]} ${fmt(g.values[0])}, ${names[1]} ${fmt(g.values[1])} ${unit}`).join('; ')}`}>
   {ticks.map(t=><g key={t}><line class="viz-grid" x1={x(t)} x2={x(t)} y1={4} y2={H-22}/><text class="viz-tick" x={x(t)} y={H-6} text-anchor="middle">{fmt(t)}</text></g>)}
   {groups.map((g,i)=>{const y=8+i*ROW;return <g key={i}>
    <text class="viz-label" x={L-10} y={y+BAR+GAP/2+4} text-anchor="end">{g.label}</text>
    {g.values.map((v,j)=>{const by=y+j*(BAR+GAP);return <g key={j}><title>{`${g.label}, ${names[j]}: ${fmt(v)} ${unit}`}</title>
     <rect class="viz-hit" x={L} y={by} width={W-L} height={BAR}/>{v!==null&&v>0&&<path class={`viz-bar s${j+1}`} d={bar(v,by)}/>}
     <text class="viz-value" x={v!==null&&v>0?x(v)+6:L+6} y={by+BAR/2+4}>{fmt(v)}</text></g>;})}</g>;})}
   <line class="viz-axis" x1={L} x2={L} y1={4} y2={H-22}/>
  </svg></figure>;
}

const changeOf=(x:number|null|undefined,y:number|null|undefined)=>x==null||y==null||!Number.isFinite(x)||!Number.isFinite(y)?null:y-x;
// The change cells of a comparison table: the difference with its sign, and that difference as a share of the first value.
const change=(x:number|null,y:number|null,d=2)=>{const dv=changeOf(x,y);if(dv===null)return [<td key="d">—</td>,<td key="p">—</td>];return [<td key="d">{dv>0?'+':''}{fmt(dv,d)}</td>,<td key="p">{x?`${dv>0?'+':''}${fmt(dv/x*100,1)} %`:'—'}</td>];};
// One headline number per tile: the candidate value, the baseline under it, and the change with its sign (never colour alone).
function Delta({label,unit,base,cand}:{label:string;unit:string;base:number|null|undefined;cand:number|null|undefined}) {
 const dv=changeOf(base,cand),pct=dv!==null&&base?dv/base*100:null,same=dv===null||Math.abs(dv)<1e-9;
 return <div class="delta"><span>{label}</span><b class="mono">{fmt(cand)} <small>{unit}</small></b>
  <small>was {fmt(base)}{same?<em> · no change</em>:<em class={dv!>0?'up':'down'}> · {dv!>0?'▲ +':'▼ '}{fmt(dv)}{pct!==null?` (${pct>0?'+':''}${fmt(pct,1)} %)`:''}</em>}</small></div>;
}

// input and r live in Scenario, so the plant load by panel below can show the same candidate.
function Compare({panel,row,input,setInput,r}:{panel:number;row:number;input:Input;setInput:(v:Input)=>void;r:{base:Side;candidate:Side}}) {
 const sheet=loadSheets.value[panel]!,base=sheet.filled[row]!.row,idx=catalogueIndex.value,cat=project.value.loads.catalogue;
 const panelData=project.value.loads.panels[panel]!;
 const b=r.base,c=r.candidate,brand=input.brand?.trim()||base.brand;
 const lists={'sc-brands':idx.brands,'sc-models':modelsOf(cat,brand).slice(0,500),'sc-configs':configsOf(idx,brand,input.model?.trim()||base.model)};
 const edited=Object.values(input).some(v=>v?.trim());
 const calc=(label:string,get:(s:Side)=>number|null|undefined,d=2,strong=false)=>{const x=get(b)??null,y=get(c)??null;return <tr key={label} class={strong?'strong':''}><td>{label}</td><td>{fmt(x,d)}</td><td>{fmt(y,d)}</td>{change(x,y,d)}</tr>;};
 const load=(label:string,get:(s:Side)=>Load|null,strong=false)=>[calc(`${label} (kW)`,s=>get(s)?.kw),calc(`${label} (kVAr)`,s=>get(s)?.kvar),calc(`${label} (kVA)`,s=>get(s)?.kva,2,strong)];
 const name=[base.kks,base.description].filter(Boolean).join(' · ')||`Item ${row+1}`,margin=fmt(sheet.totals.margin*100,1);
 return <section class="panel compare" id="compare" aria-label={`Compare ${name}`}>
  {Object.entries(lists).map(([id,v])=><datalist key={id} id={id}>{v.map(o=><option key={o} value={o}/>)}</datalist>)}
  <header class="compare-head"><div><div class="eyebrow">{panelData.name}</div><h2>{name}</h2>
   <p>{[base.brand,base.model,base.config].filter(Boolean).join(' · ')||'No brand or model yet'}</p></div>
   <div class="compare-actions"><button class="button ghost small" disabled={!edited} onClick={()=>setInput({})}><RotateCcw size={13}/>Reset</button>
    <button class="button secondary small" onClick={()=>{loadPanel.value=panel;loadView.value='panels';}}><ArrowUpRight size={13}/>Open in panel</button>
    <button class="icon-button" aria-label="Close comparison" onClick={()=>{setInput({});scenarioPick.value=null;}}><X size={18}/></button></div></header>
  <div class="compare-body">
   <p class="compare-hint">Change any value to try it. Picking a brand, model or configuration fills the rest from the catalogue. The panel's other items stay as they are.</p>
   <div class="compare-form">{INPUTS.map(([k,label,list])=><label class="field" key={k}><span>{label}<small>now {b.row[k]||'—'}</small></span>
    <input class={input[k]?'set':''} value={input[k]??''} placeholder={c.row[k]||'—'} list={list} aria-label={`Candidate ${label}`} inputMode={list||k==='un'?undefined:'decimal'} onInput={e=>setInput({...input,[k]:e.currentTarget.value.slice(0,120)})}/></label>)}</div>
   <div class="deltas">
    <Delta label="Item input power" unit="kW" base={b.balance.kw} cand={c.balance.kw}/>
    <Delta label="Item reactive power" unit="kVAr" base={b.balance.kvar} cand={c.balance.kvar}/>
    <Delta label="Panel load" unit="kVA" base={b.panel?.kva} cand={c.panel?.kva}/>
    <Delta label="Plant load" unit="kVA" base={b.plant?.kva} cand={c.plant?.kva}/>
    <Delta label={`Plant + ${margin} % margin`} unit="kVA" base={b.plantMargin?.kva} cand={c.plantMargin?.kva}/>
   </div>
   {!b.balance.duty&&<p class="muted">Set C, I or S on this item to see its effect on the panel and plant load.</p>}
   <div class="viz-row">
    <Bars title="This item" unit="kW / kVAr" names={['Baseline','Candidate']} groups={[{label:'Input power (kW)',values:[b.balance.kw,c.balance.kw]},{label:'Reactive power (kVAr)',values:[b.balance.kvar,c.balance.kvar]}]}/>
    <Bars title="Plant load" unit="kVA" names={['Baseline','Candidate']} groups={[{label:'Overall (kVA)',values:[b.plant?.kva??null,c.plant?.kva??null]},{label:'With margin (kVA)',values:[b.plantMargin?.kva??null,c.plantMargin?.kva??null]}]}/>
   </div>
   <details class="compare-detail"><summary>All values, baseline against candidate</summary>
    <div class="load-totals"><table aria-label="Scenario comparison"><thead><tr><th>Parameter</th><th>Baseline</th><th>Candidate</th><th>Change</th><th>% change</th></tr></thead>
     <tbody>{INPUTS.map(([k,label,list])=><tr key={k}><td>{label}</td><td>{b.row[k]||'—'}</td><td>{c.row[k]||'—'}</td>
      {list||k==='un'?[<td key="d">{c.row[k].trim().toLowerCase()!==b.row[k].trim().toLowerCase()?'changed':''}</td>,<td key="p"/>]:change(num(b.row[k]),num(c.row[k]),3)}</tr>)}
      {calc('Load factor',s=>s.balance.loadFactor,3)}{calc('Spare capacity, rated − consumed (kW)',s=>s.capacity)}
      {calc('Input power (kW)',s=>s.balance.kw)}{calc('Reactive power (kVAr)',s=>s.balance.kvar)}
      {load('Panel load',s=>s.panel)}{load(`Panel load with design margin (${margin} %)`,s=>s.panelMargin)}
      {load('Plant load',s=>s.plant,true)}{load(`Plant load with design margin (${margin} %)`,s=>s.plantMargin,true)}</tbody></table></div></details>
  </div>
 </section>;
}

type Choice={brand:string;model:string;config:string};
const NONE:Choice={brand:'',model:'',config:''};
const CHOICE:[keyof Choice,string][]=[['brand','Brand'],['model','Model / Part Number'],['config','Configuration']];
const SPEC:[CatalogueKey,string][]=[['ratedKw','Rated input power (kW)'],['protA','Protection device rating (A)'],['inA','In (A)'],['un','Un'],['efficiency','Efficiency'],['pf','Power factor']];
// Any two catalogue entries side by side, on a panel or not. Both run the same consumed load as a continuous load, so their
// input and reactive power compare like for like; blank takes entry A's rated input power.
function CatalogueCompare() {
 const idx=catalogueIndex.value,cat=project.value.loads.catalogue,types=allTypes(project.value.loads.types);
 const [pick,setPick]=useState<Choice[]>([NONE,NONE]),[load,setLoad]=useState('');
 const head=<header class="compare-head"><div><h2>Compare catalogue entries</h2><p>Any two entries from the catalogue, whether or not they are used in the load list.</p></div>
  {pick.some(c=>c.brand||c.model||c.config)||load?<div class="compare-actions"><button class="button ghost small" onClick={()=>{setPick([NONE,NONE]);setLoad('');}}><RotateCcw size={13}/>Reset</button></div>:null}</header>;
 if(!cat.length)return <section class="panel plant-load">{head}<div class="compare-body"><p class="compare-hint">The catalogue is empty. Add entries in the Catalogue tab, then compare any two of them here.</p></div></section>;
 const found=pick.map(c=>fillRow({...emptyLoad(),...c},idx)),ea=found[0]!.entry,eb=found[1]!.entry;
 const consumed=load.trim()||(ea??eb)?.ratedKw.trim()||'',ra=ea&&entryAt(ea,consumed),rb=eb&&entryAt(eb,consumed);
 const names=found.map((f,i)=>`${'AB'[i]} · ${[f.row.brand,f.row.model].filter(Boolean).join(' ')||'not picked'}`.slice(0,32));
 const set=(i:number,k:keyof Choice,v:string)=>setPick(pick.map((c,j)=>j===i?{...c,[k]:v.slice(0,120)}:c));
 const typeOf=(e:CatalogueRow|null)=>types.find(t=>t.id===e?.type);
 const paramOf=(k:string)=>typeOf(ea)?.params.find(x=>x.key===k)??typeOf(eb)?.params.find(x=>x.key===k);
 const extras=[...new Set([...Object.keys(ea?.extra??{}),...Object.keys(eb?.extra??{})])];
 // A row of the table: numbers get their change, text is only marked where the two differ.
 const row=(label:string,x:string,y:string,n:(v:string)=>number|null=num)=>{const a=n(x),b=n(y);return <tr key={label}><td>{label}</td><td>{x||'—'}</td><td>{y||'—'}</td>
  {a!==null||b!==null?change(a,b,3):[<td key="d">{x.trim()&&y.trim()&&x.trim().toLowerCase()!==y.trim().toLowerCase()?'differs':''}</td>,<td key="p"/>]}</tr>;};
 const calc=(label:string,get:(r:NonNullable<typeof ra>)=>number|null,d=2)=>{const x=ra?get(ra):null,y=rb?get(rb):null;return <tr key={label}><td>{label}</td><td>{fmt(x,d)}</td><td>{fmt(y,d)}</td>{change(x,y,d)}</tr>;};
 return <section class="panel plant-load" aria-label="Compare catalogue entries">{head}
  <datalist id="cc-brands">{idx.brands.map(o=><option key={o} value={o}/>)}</datalist>
  {found.map((f,i)=><Fragment key={i}><datalist id={`cc-model-${i}`}>{modelsOf(cat,pick[i]!.brand).slice(0,500).map(o=><option key={o} value={o}/>)}</datalist>
   <datalist id={`cc-config-${i}`}>{configsOf(idx,f.row.brand,f.row.model).map(o=><option key={o} value={o}/>)}</datalist></Fragment>)}
  <div class="compare-body">
   <div class="compare-sides">{found.map((f,i)=><fieldset class="compare-side" key={i}><legend>Entry {'AB'[i]}</legend>
    <div class="compare-form">{CHOICE.map(([k,label])=><label class="field" key={k}><span>{label}</span>
     <input class={pick[i]![k]?'set':''} value={pick[i]![k]} placeholder={f.row[k]||'—'} list={k==='brand'?'cc-brands':`cc-${k}-${i}`} aria-label={`Entry ${'AB'[i]} ${label}`} autoComplete="off" onInput={e=>set(i,k,e.currentTarget.value)}/></label>)}</div>
    {f.row.model.trim()&&!f.entry&&<p class="form-error">{configsOf(idx,f.row.brand,f.row.model).length?'Pick a configuration from the list.':'Not in the catalogue.'}</p>}</fieldset>)}</div>
   <div class="compare-form"><label class="field"><span>Consumed load (kW)<small>both entries</small></span>
    <input class={load?'set':''} value={load} placeholder={consumed||'—'} inputMode="decimal" aria-label="Consumed load for both entries (kW)" onInput={e=>setLoad(e.currentTarget.value.slice(0,20))}/></label></div>
   {(ea||eb)&&<>
    <Bars title={`Running ${fmt(num(consumed))} kW continuously`} unit="kW / kVAr / kVA" names={[names[0]!,names[1]!]} groups={[{label:'Input power (kW)',values:[ra?.kw??null,rb?.kw??null]},{label:'Reactive power (kVAr)',values:[ra?.kvar??null,rb?.kvar??null]},{label:'Apparent power (kVA)',values:[ra?.kva??null,rb?.kva??null]}]}/>
    <div class="load-totals"><table aria-label="Catalogue entries compared"><thead><tr><th>Parameter</th><th>{names[0]}</th><th>{names[1]}</th><th>Change, B − A</th><th>% change</th></tr></thead>
     <tbody>{row('Equipment type',typeOf(ea)?.name??'',typeOf(eb)?.name??'',()=>null)}
      {SPEC.map(([k,label])=>row(label,ea?.[k]??'',eb?.[k]??'',k==='efficiency'||k==='pf'?fraction:num))}
      {extras.map(k=>{const p=paramOf(k);return row(p?`${p.label}${p.unit?` (${p.unit})`:''}`:k,ea?.extra?.[k]??'',eb?.extra?.[k]??'');})}
      {calc('Load factor',r=>r.loadFactor,3)}{calc('Input power (kW)',r=>r.kw)}{calc('Reactive power (kVAr)',r=>r.kvar)}{calc('Apparent power (kVA)',r=>r.kva)}</tbody></table></div></>}
  </div>
 </section>;
}

export function Scenario() {
 const sheets=loadSheets.value,panels=project.value.loads.panels,plant=plantLoad.value,pick=scenarioPick.value;
 const [query,setQuery]=useState(''),[only,setOnly]=useState(-1),[tried,setTried]=useState<{at:string;input:Input}>({at:'',input:{}}),q=query.trim().toLowerCase();
 const found=sheets.flatMap((s,p)=>only>=0&&p!==only?[]:s.filled.map((f,i)=>({p,i,r:f.row,b:s.bal[i]!})))
  .filter(({r})=>!isBlankLoad(r)&&(!q||[r.kks,r.description,r.brand,r.model].some(v=>v.toLowerCase().includes(q))));
 const valid=pick&&sheets[pick.panel]?.filled[pick.row]?pick:null;
 // The values tried on the picked item; another item starts from none.
 const at=valid?`${valid.panel}:${valid.row}`:'',input=tried.at===at?tried.input:{};
 const run=valid?scenario(sheets[valid.panel]!.filled.map(f=>f.row),valid.row,input,catalogueIndex.value,panels[valid.panel]!.factors,panels[valid.panel]!.margin,plant):null;
 const open=(p:number)=>{loadPanel.value=p;loadView.value='panels';};
 const choose=(p:number,i:number)=>{scenarioPick.value={panel:p,row:i};requestAnimationFrame(()=>document.getElementById('compare')?.scrollIntoView({block:'nearest',behavior:'smooth'}));};
 if(!panels.length)return <><section class="panel list-empty"><Search size={26}/><h2>Nothing to search yet</h2><p>Add a panel or import a load list first.</p></section><CatalogueCompare/></>;
 // With an item being compared, each panel's load before and after the change; only that item's panel moves.
 const label=(p:number)=>panels[p]!.name.slice(0,26),moved=(p:number,base:Load,get:(s:Side)=>Load)=>run&&valid&&p===valid.panel?get(run.candidate).kva:base.kva;
 return <>
  <div class="compare-layout">
   <aside class="panel finder" aria-label="Find an item">
    <div class="finder-head">
     <label class="search"><Search size={14}/><input value={query} placeholder="KKS, description, brand or model" aria-label="Search items by KKS number, description, brand or model" onInput={e=>setQuery(e.currentTarget.value)}/></label>
     <select class="finder-panel" value={only} aria-label="Panel" onChange={e=>setOnly(Number(e.currentTarget.value))}><option value={-1}>All panels</option>{panels.map((x,p)=><option key={p} value={p}>{x.name}</option>)}</select>
     <span class="finder-count">{found.length} item{found.length===1?'':'s'}{found.length>SHOWN?`, first ${SHOWN} shown`:''}</span></div>
    <ul class="finder-list">{found.slice(0,SHOWN).map(({p,i,r,b})=>{const on=valid?.panel===p&&valid.row===i;return <li key={`${p}:${i}`}>
     <button class={on?'picked':''} aria-current={on?'true':undefined} onClick={()=>choose(p,i)}>
      <span class="finder-top"><span class="mono">{r.kks||'—'}</span><span class={`duty-badge ${b.duty?`duty-${b.duty}`:'none'}`} title={b.duty?`Duty ${b.duty}`:'No duty set'}>{b.duty||'–'}</span><span class="mono finder-kw">{fmt(b.kw)} kW</span></span>
      <span class="finder-name">{r.description||'Unnamed item'}</span>
      <span class="finder-meta">{[panels[p]!.name,r.brand,r.model].filter(Boolean).join(' · ')}</span></button></li>;})}</ul>
    {!found.length&&<p class="finder-empty">No items match.</p>}
   </aside>
   {valid&&run?<Compare key={at} panel={valid.panel} row={valid.row} input={input} setInput={v=>setTried({at,input:v})} r={run}/>
    :<section class="panel compare-empty"><GitCompare size={26}/><h2>Pick an item to compare</h2><p>Choose an item from the list. Try another brand, model or load, and see the change in its panel and the plant total.</p></section>}
  </div>
  <section class="panel plant-load"><header class="compare-head"><div><h2>Plant load by panel</h2><p>Each panel's load after operating factors, and with its design margin.{run?' The charts show the item being compared: baseline against candidate, panel by panel.':''}</p></div></header>
   <div class="compare-body">
    <div class="load-totals"><table aria-label="Plant load by panel"><thead><tr><th>Panel</th><th>kW</th><th>kVAr</th><th>kVA</th><th>With margin kW</th><th>kVAr</th><th>kVA</th></tr></thead>
     <tbody>{sheets.map((s,p)=><tr key={p}><td><button class="link" onClick={()=>open(p)}>{panels[p]!.name}</button></td><td>{fmt(s.totals.overall.kw)}</td><td>{fmt(s.totals.overall.kvar)}</td><td>{fmt(s.totals.overall.kva)}</td><td>{fmt(s.totals.withMargin.kw)}</td><td>{fmt(s.totals.withMargin.kvar)}</td><td>{fmt(s.totals.withMargin.kva)}</td></tr>)}
      <tr class="strong"><td>Plant total</td><td>{fmt(plant.overall.kw)}</td><td>{fmt(plant.overall.kvar)}</td><td>{fmt(plant.overall.kva)}</td><td>{fmt(plant.withMargin.kw)}</td><td>{fmt(plant.withMargin.kvar)}</td><td>{fmt(plant.withMargin.kva)}</td></tr></tbody></table></div>
    {run?<div class="viz-row">
      <Bars title="Load by panel (kVA)" unit="kVA" names={['Baseline','Candidate']} groups={sheets.map((s,p)=>({label:label(p),values:[s.totals.overall.kva,moved(p,s.totals.overall,x=>x.panel)] as const}))}/>
      <Bars title="With design margin (kVA)" unit="kVA" names={['Baseline','Candidate']} groups={sheets.map((s,p)=>({label:label(p),values:[s.totals.withMargin.kva,moved(p,s.totals.withMargin,x=>x.panelMargin)] as const}))}/></div>
     :<Bars title="Load by panel" unit="kVA" names={['Overall','With margin']} groups={sheets.map((s,p)=>({label:label(p),values:[s.totals.overall.kva,s.totals.withMargin.kva] as const}))}/>}
   </div></section>
  <CatalogueCompare/>
 </>;
}
