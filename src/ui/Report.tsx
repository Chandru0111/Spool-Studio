import {signal} from '@preact/signals';
import {useEffect} from 'preact/hooks';
import {project,single,listSheet,cableGroups} from './state';
import {Calculation} from './Calculation';
import {show} from './Sheet';
import {findIssues} from '../engine/issues';
import {TABLES,failsCheck,type Cell,type Col,type RowResult,type SheetRow} from '../engine/sheet';
import type {Suggested} from '../engine/suggest';

// Print view (A3 landscape). The browser's print dialog saves it as PDF; nothing leaves the device.
export const report=signal<'single'|'list'|null>(null);
export function printReport(kind:'single'|'list'):void {report.value=kind;}
const COLS:[Col,string][]=[['A','Item'],['C','From'],['D','To'],['E','Ph'],['F','V'],['G','kW'],['I','PF'],['M','Ib A'],['N','In A'],['O','Cable type'],['P','Cores'],['Q','Method'],['AC','Size mm²'],['AD','No.'],['AE','It A'],['AF','Iz A'],['AG','Ib ≤ In ≤ Iz'],['AH','Run m'],['AK','VD %'],['AL','Total VD %'],['AM','Limit %'],['AN','VD check'],['AP','Earthing'],['BB','Zs Ω'],['BC','Max Zs Ω'],['BE','Earth loop'],['BG','CPC'],['BM','kA at To'],['BJ','Breaking'],['BO','Short circuit']];
function cell(col:Col,row:SheetRow,res:RowResult,sug:Suggested):{text:string;suggested:boolean} {
 const s=sug[col as keyof Suggested],raw=(row as Record<string,string>)[col];
 if(raw!==undefined){const v=raw.trim()||s||'';return {text:col==='Q'?v.split(' - ')[0]??v:v,suggested:!raw.trim()&&!!s};}
 const v:Cell=res.cells[col];return {text:show(col,v),suggested:false};
}
function Schedule({rows,results,suggested}:{rows:readonly SheetRow[];results:readonly RowResult[];suggested:readonly Suggested[]}) {
 return <table class="report-table"><thead><tr>{COLS.map(([c,l])=><th key={c}>{l}</th>)}</tr></thead><tbody>{rows.map((row,i)=>{const res=results[i];if(!res||res.cells.A==='')return null;return <tr key={i}>{COLS.map(([c])=>{const v=cell(c,row,res,suggested[i]??{});return <td key={c} class={`${v.text==='PASS'?'pass':v.text==='FAIL'?'fail':''} ${v.suggested?'sug':''}`}>{v.text}{v.suggested&&<sup>*</sup>}</td>;})}</tr>;})}</tbody></table>;
}
export function Report() {
 const kind=report.value;
 useEffect(()=>{if(!kind)return;const done=()=>{report.value=null;};window.addEventListener('afterprint',done,{once:true});const t=setTimeout(()=>window.print(),60);return ()=>{clearTimeout(t);window.removeEventListener('afterprint',done);};},[kind]);
 if(!kind)return null;
 const p=project.value,date=new Date().toLocaleDateString('en-SG',{day:'2-digit',month:'short',year:'numeric'});
 const list=listSheet.value,rows=kind==='list'?list.effective:[p.single],results=kind==='list'?list.results:[single.value],suggested=kind==='list'?list.suggested:[{}];
 const filled=results.filter(r=>r.cells.A!==''),fail=filled.filter(failsCheck).length,pass=filled.filter(r=>!failsCheck(r)&&r.cells.AG==='PASS'&&r.cells.AN==='PASS').length;
 const feeds=new Set(rows.map(r=>r.C.trim().toLowerCase()).filter(Boolean)),kw=results.reduce((s,r,i)=>s+(r.cells.A!==''&&!feeds.has(rows[i]!.D.trim().toLowerCase())&&typeof r.cells.G==='number'?r.cells.G:0),0),issues=kind==='list'?findIssues(rows,results).filter(x=>x.level!=='info'):[],groups=kind==='list'?cableGroups.value:[],pending=suggested.some(s=>Object.keys(s).length);
 return <div class="print-report">
  <header><div><small>CABLE SIZING {kind==='list'?'SCHEDULE':'CALCULATION'}</small><h1>{p.name}</h1><p>{kind==='list'?`${p.list.source||'Load list'} · ${filled.length} circuits`:`${p.single.C||'—'} → ${p.single.D||'—'}`}</p></div><dl><dt>Date</dt><dd>{date}</dd><dt>Method</dt><dd>Cable Sizing workbook ({TABLES.source.file})</dd><dt>Ratings</dt><dd>{TABLES.source.catalogue.split(' - ')[0]}</dd></dl></header>
  {kind==='list'&&<section class="report-kpis"><div><b>{filled.length}</b>circuits</div><div><b>{pass}</b>pass both checks</div><div><b>{fail}</b>fail a check</div><div><b>{filled.length-pass-fail}</b>incomplete</div><div><b>{kw.toLocaleString('en-SG',{maximumFractionDigits:1})}</b>kW on final circuits</div><div><b>{(groups.reduce((s,g)=>s+g.runsM.reduce((a,b)=>a+b,0),0)/1000).toFixed(2)}</b>km of cable</div></section>}
  {kind==='list'?<Schedule rows={p.list.rows} results={results} suggested={suggested}/>:<><Schedule rows={rows} results={results} suggested={suggested}/><Calculation row={p.single} result={single.value}/></>}
  {pending&&<p class="report-note"><sup>*</sup> Preliminary suggestion, not yet accepted by the engineer.</p>}
  {groups.length>0&&<section class="report-block"><h2>Cable quantities</h2><table class="report-table compact"><thead><tr><th>Cable</th><th>Circuits</th><th>Cable runs</th><th>Total cable m</th></tr></thead><tbody>{groups.map(g=><tr key={g.key}><td>{g.label}{g.perSet>1?` (${g.perSet} single cores per set)`:''}</td><td>{g.items}</td><td>{g.runsM.length}</td><td>{g.runsM.reduce((a,b)=>a+b,0).toFixed(0)}</td></tr>)}</tbody></table><p class="report-note">Route lengths without cutting allowance. Neutral and earth single cores are not included.</p></section>}
  {issues.length>0&&<section class="report-block"><h2>Open issues ({issues.length})</h2><ul class="report-issues">{issues.slice(0,60).map((x,k)=><li key={k}><b>{rows[x.row]?.D||`Row ${x.row+1}`}</b> {x.text}</li>)}</ul></section>}
  <footer><p>Calculated with the formulas of the supplied Cable Sizing workbook. A PASS covers the current-capacity (Ib ≤ In ≤ Iz) and voltage-drop checks only, not a complete installation design.</p><div class="signoff">{['Prepared','Checked','Approved'].map(r=><div key={r}><span>{r}</span><i/><small>Name / date</small></div>)}</div></footer>
 </div>;
}
