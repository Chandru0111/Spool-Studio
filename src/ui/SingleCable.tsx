import {Eraser,FileSpreadsheet,ArrowRight,BookOpen,Calculator,Printer} from 'lucide-preact';
import {Calculation} from './Calculation';
import {printReport} from './Report';
import {project,single,setSingle,updateProject,exportExcel,exporting} from './state';
import {Sheet,Legend,pasteGrid,focusCell,show} from './Sheet';
import {cleanValue} from '../import/load-list';
import {COLUMNS,emptyRow,isBlankRow,TABLES,type Cell,type InputCol} from '../engine/sheet';

// Fill order from the workbook's Settings sheet (note 2): what is still needed before every check can run.
const ORDER:InputCol[]=['C','D','E','F','G','I','N','O','P','Q','AC','AH','AM'];
const head=(col:string)=>COLUMNS.find(c=>c.col===col)?.header.split('\n')[0]??col;
function Pill({value}:{value:Cell}){return value===''?<span class="pill">—</span>:<span class={`pill ${value==='PASS'?'pass':value==='FAIL'?'fail':'warn'}`}>{value}</span>;}
export function SingleCable() {
 const row=project.value.single,res=single.value,c=res.cells,f=res.helpers.fault,missing=ORDER.filter(col=>!row[col].trim());
 const useSuggested=typeof c.AB==='number'&&String(c.AB)!==row.AC.trim();
 const vdNeedsFrom=c.AK!==''&&c.AL===''&&!row.C.trim();
 return <div class="sheet-page">
  <div class="page-head"><div><h1>Single cable</h1><p>Fill the row left to right, exactly as in the Cable Sizing sheet. Dropdowns narrow as you go and the grey cells calculate instantly.</p></div>
   <div class="page-actions"><button class="button secondary small" onClick={()=>updateProject({single:emptyRow()})}><Eraser size={15}/>Clear row</button><button class="button secondary small" disabled={isBlankRow(row)} onClick={()=>printReport('single')}><Printer size={15}/>Print / PDF</button><button class="button primary small" disabled={exporting.value||isBlankRow(row)} onClick={()=>void exportExcel([row],'single cable')}><FileSpreadsheet size={15}/>Export to Excel</button></div></div>
  <Legend/>
  <Sheet rows={[row]} effective={[row]} results={[res]} onChange={(_,col,v)=>setSingle(col,v)} onPaste={(i,col,grid)=>updateProject({single:pasteGrid([row],i,col,grid,cleanValue,1)[0]!})}/>
  <section class="result-strip" aria-label="Result">
   <div><span>Design current Ib</span><b>{c.M===''?'—':show('M',c.M)}<small> A</small></b><em>In {row.N.trim()||'—'} A</em></div>
   <div><span>Suggested cable size</span><b>{c.AB===''?'—':c.AB}{typeof c.AB==='number'&&<small> mm²</small>}</b>{useSuggested?<button class="text-button" onClick={()=>{setSingle('AC',String(c.AB));focusCell(0,'AD');}}>Use {c.AB} mm² <ArrowRight size={13}/></button>:<em>{c.AB===''?'Needs type, cores, method and load':'Selected'}</em>}</div>
   <div><span>Derated capacity Iz</span><b>{c.AF===''?'—':show('AF',c.AF)}<small> A</small></b><em>{row.AC.trim()?`${row.AC} mm² × ${row.AD.trim()||1}`:'Pick a cable size'}</em></div>
   <div><span>Design check</span><Pill value={c.AG}/><em>Ib ≤ In ≤ Iz</em></div>
   <div><span>Total voltage drop</span><b>{c.AL===''?(c.AK===''?'—':show('AK',c.AK)):show('AL',c.AL)}<small> %</small></b><em>{vdNeedsFrom?'Enter From to get the total':`Limit ${row.AM.trim()||'—'} %`}</em></div>
   <div><span>Voltage drop check</span><Pill value={c.AN}/><em>{row.AM.trim()?'Total VD ≤ permissible':'Enter Permissible VD'}</em></div>
   <div><span>Earth fault loop Zs · {f.system||'invalid system'}</span><b>{typeof c.BB==='number'?show('BB',c.BB):'—'}<small> Ω</small></b><em>{typeof c.BB!=='number'?(c.BB||c.BA||'Needs a cable size and run'):typeof c.BC==='number'?`Max ${f.system==='TT'?'Ra ':''}${show('BC',c.BC)} Ω${c.AV!==''?` · ${c.AV} s`:''}`:(c.BC||'Pick a protective device or enter IΔn')}</em></div>
   <div><span>Earth loop check</span><Pill value={c.BE}/><em>CPC {c.BG||c.BF||'—'}{c.BG&&c.BF?` (${c.BF})`:''}</em></div>
   <div><span>Short circuit</span><Pill value={c.BO}/><em>{c.BJ==='Enter breaking capacity'?c.BJ:`Breaking capacity ${c.BJ||'—'}`}{typeof c.BN==='number'?` · min ${show('BN',c.BN)} mm²`:''}</em></div>
  </section>
  {missing.length>0&&<div class="still-needed"><span>Still to fill</span>{missing.map(col=><button key={col} onClick={()=>focusCell(0,col)}>{head(col)}</button>)}</div>}
  <section class="panel calc-panel" aria-label="Calculation"><div class="calc-title"><Calculator size={16}/><h2>Calculation</h2><span>Every figure is a cell of the Cable Sizing sheet.</span></div><Calculation row={row} result={res} onPickSize={size=>setSingle('AC',size)}/></section>
  <details class="workbook-notes"><summary><BookOpen size={15}/>How the sheet works</summary><ol>{TABLES.notes.map(n=><li key={n}>{n.replace(/^\d+\.\s*/,'')}</li>)}</ol></details>
 </div>;
}
