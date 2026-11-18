import {useEffect,useRef,useState} from 'preact/hooks';
import {Trash2,Calculator} from 'lucide-preact';
import {COLUMNS,MAX_CELL,emptyRow,listOptions,TABLES,type Cell,type Col,type Column,type InputCol,type ListCol,type RowResult,type SheetRow} from '../engine/sheet';
import type {Suggested} from '../engine/suggest';

// The Cable Sizing sheet on screen: same columns, headings, colours and dropdowns as the workbook.
const ROW=33,LETTERS=22,FROZEN=4;
const widths=COLUMNS.map(c=>c.width*7+14),lefts=widths.map((_,i)=>widths.slice(0,i).reduce((a,b)=>a+b,0)),GROUP_ROW=24;
// Screen-only column groups (the workbook has no such row); each runs from its first column to the next group's.
const STARTS:[string,Col][]=[['Circuit','A'],['Load','E'],['Protection and cable','N'],['Voltage drop','AH'],['Earth fault','AP'],['Short circuit','BH'],['Motor starting','BP']];
const at=(col:Col)=>COLUMNS.findIndex(c=>c.col===col);
export const GROUPS=STARTS.map(([name,col],k)=>({name,cols:COLUMNS.slice(at(col),k+1<STARTS.length?at(STARTS[k+1]![1]):undefined).map(c=>c.col)}));
const DIGITS:Partial<Record<Col,number>>={J:2,K:2,M:2,AA:2,AF:2,AJ:2,AK:2,AL:2,AO:2,BR:2,AZ:1,BA:3,BB:3,BC:3,BD:0,BM:2,BN:1};
const validation=TABLES.validation as Record<string,{error:string}|undefined>;
export const editable=COLUMNS.filter(c=>c.kind!=='calc').map(c=>c.col as InputCol);
export function show(col:Col,v:Cell):string {if(typeof v!=='number')return v;const d=DIGITS[col];return d!==undefined?v.toFixed(d):col==='T'||col==='V'||col==='X'?String(+v.toFixed(3)):String(+v.toPrecision(12));}
const tone=(v:Cell)=>v==='PASS'?'pass':v==='FAIL'?'fail':v==='Out of range'||v==='None passes'||v==='NO RATING DATA'||v==='Enter Ze'||v==='Enter Ia'||v==='Enter fault level'||v==='Enter CPC data'||v==='Enter CPC size'||v==='Enter breaking capacity'||v==='Check let-through'?'warn':'';
const tip=(c:Column)=>[c.note,validation[c.col]?.error].filter(Boolean).join('\n');
const cellAt=(row:number,col:string)=>document.querySelector<HTMLElement>(`[data-r="${row}"][data-c="${col}"]`);
export const focusCell=(row:number,col:string)=>{const el=cellAt(row,col);el?.focus();el?.scrollIntoView({block:'nearest',inline:'nearest'});};

type Props={rows:readonly SheetRow[];effective:readonly SheetRow[];results:readonly RowResult[];suggested?:readonly Suggested[];order?:readonly number[]|undefined;selected?:ReadonlySet<number>;active?:number|null;onSelect?:(i:number,range:boolean)=>void;onInspect?:(i:number)=>void;onChange:(i:number,col:InputCol,v:string)=>void;onPaste:(i:number,col:InputCol,grid:string[][])=>void;onDelete?:(i:number)=>void;onAddRow?:()=>void;freeze?:boolean;tall?:boolean;groups?:readonly string[];columns?:readonly Col[];marks?:readonly string[]};
export function Sheet({rows,effective,results,suggested,order,selected,active=null,onSelect,onInspect,onChange,onPaste,onDelete,onAddRow,freeze=false,tall=false,groups,columns,marks}:Props) {
 // groups: the column groups shown (with a group row above the letters); undefined shows every column without one.
 const shown=groups&&GROUPS.filter(g=>groups.includes(g.name)).map(g=>({...g,cols:g.cols.filter(c=>!columns||columns.includes(c))})).filter(g=>g.cols.length),vis=COLUMNS.filter(c=>(!shown||shown.some(g=>g.cols.includes(c.col)))&&(!columns||columns.includes(c.col))),edit=editable.filter(c=>vis.some(v=>v.col===c)),top=shown?GROUP_ROW:0;
 const scroller=useRef<HTMLDivElement>(null),[view,setView]=useState({top:0,height:600}),pending=useRef<[number,string]|null>(null);
 const localCell=(row:number,col:string)=>scroller.current?.querySelector<HTMLElement>(`[data-r="${row}"][data-c="${col}"]`);
 const focusLocal=(row:number,col:string)=>{const el=localCell(row,col);el?.focus();el?.scrollIntoView({block:'nearest',inline:'nearest'});};
 const ids=order??rows.map((_,i)=>i),virtual=ids.length>60,start=virtual?Math.max(0,Math.floor(view.top/ROW)-10):0,end=virtual?Math.min(ids.length,start+Math.ceil(view.height/ROW)+20):ids.length,tools=!!(onDelete||onInspect);
 useEffect(()=>{const el=scroller.current;if(!el)return;const measure=()=>setView({top:el.scrollTop,height:el.clientHeight});measure();const ro=new ResizeObserver(measure);ro.observe(el);return ()=>ro.disconnect();},[]);
 useEffect(()=>{const target=pending.current;if(target&&localCell(...target)){pending.current=null;focusLocal(...target);}});
 const frozen=(i:number)=>freeze&&i<FROZEN?{class:'frozen',style:{left:`${vis.slice(0,i).reduce((n,c)=>n+c.width*7+14,0)}px`}}:{};
 function move(row:number,col:InputCol,dRow:number,dCol:number) {
  let pos=ids.indexOf(row)+dRow,ci=edit.indexOf(col)+dCol;
  if(ci>=edit.length){ci=0;pos++;}if(ci<0){ci=edit.length-1;pos--;}
  const target=edit[ci]!;let r=ids[pos];
  if(r===undefined&&dRow>0&&onAddRow&&pos===ids.length){onAddRow();r=rows.length;}
  if(r===undefined||pos<0)return;
  const el=scroller.current;if(el&&virtual&&(pos<start+2||pos>end-3))el.scrollTop=Math.max(0,pos*ROW-el.clientHeight/2);
  pending.current=[r,target];if(localCell(r,target)){pending.current=null;focusLocal(r,target);}
 }
 // Excel keys: Enter goes down (right on a single-row sheet), arrows leave a cell at its edges, Ctrl+D fills from above.
 const keys=(i:number,col:InputCol)=>(e:KeyboardEvent)=>{
  const el=e.currentTarget as HTMLInputElement|HTMLSelectElement,select=el instanceof HTMLSelectElement,single=ids.length===1&&!onAddRow,mod=e.metaKey||e.ctrlKey;
  const atStart=select||(el as HTMLInputElement).selectionStart===0&&(el as HTMLInputElement).selectionEnd===0,atEnd=select||(el as HTMLInputElement).selectionStart===el.value.length;
  if(e.key==='Enter'){e.preventDefault();if(single)move(i,col,0,e.shiftKey?-1:1);else move(i,col,e.shiftKey?-1:1,0);}
  else if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!e.altKey&&!mod&&!single){e.preventDefault();move(i,col,e.key==='ArrowDown'?1:-1,0);}
  else if(e.key==='ArrowLeft'&&atStart&&!e.shiftKey){e.preventDefault();move(i,col,0,-1);}
  else if(e.key==='ArrowRight'&&atEnd&&!e.shiftKey){e.preventDefault();move(i,col,0,1);}
  else if(mod&&e.key.toLowerCase()==='d'){e.preventDefault();const above=ids[ids.indexOf(i)-1];if(above!==undefined)onChange(i,col,(effective[above]??rows[above])?.[col]??'');}
  else if(select&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();onChange(i,col,'');}
  else if(e.key==='Escape')el.blur();
 };
 const paste=(i:number,col:InputCol)=>(e:ClipboardEvent)=>{const text=e.clipboardData?.getData('text/plain')??'';if(!/[\t\n]/.test(text.replace(/\r?\n$/,'')))return;e.preventDefault();onPaste(i,col,text.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(l=>l.split('\t')));};
 return <div ref={scroller} class={`sheet-scroll ${tall?'tall':''}`} onScroll={e=>{const el=e.currentTarget;if(virtual)setView({top:el.scrollTop,height:el.clientHeight});}}>
  <table class={`sheet ${freeze?'freeze':''}`} role="grid" aria-rowcount={ids.length+1}>
   <colgroup>{vis.map(c=><col key={c.col} style={{width:`${c.width*7+14}px`}}/>)}{tools&&<col style={{width:onInspect&&onDelete?'64px':'36px'}}/>}</colgroup>
   <thead>
    {shown&&<tr class="groups">{shown.map((g,k)=><th key={g.name} colSpan={g.cols.length} {...(k===0?frozen(0):{})}>{k===0?g.name:<span style={{left:`${freeze?lefts[FROZEN]:0}px`}}>{g.name}</span>}</th>)}{tools&&<th aria-hidden="true"/>}</tr>}
    <tr class="letters">{vis.map((c,i)=>{const f=frozen(i);return <th key={c.col} class={f.class} style={{...f.style,top:`${top}px`}}>{c.col}</th>;})}{tools&&<th aria-hidden="true" style={{top:`${top}px`}}/>}</tr>
    <tr class="heads">{vis.map((c,i)=>{const [main,...rest]=c.header.split('\n'),f=frozen(i);return <th key={c.col} scope="col" title={tip(c)||undefined} class={`${c.kind} ${f.class??''}`} style={{...f.style,top:`${top+LETTERS}px`}}><span>{main}</span>{rest.length>0&&<small>{rest.join(' ')}</small>}{c.note&&<i class="note-mark" aria-hidden="true"/>}</th>;})}{tools&&<th class="calc" style={{top:`${top+LETTERS}px`}}><span class="visually-hidden">Row tools</span></th>}</tr>
   </thead>
   <tbody>
    {start>0&&<tr class="spacer" style={{height:`${start*ROW}px`}} aria-hidden="true"/>}
    {ids.slice(start,end).map(i=>{const row=rows[i],res=results[i],sug=suggested?.[i]??{};if(!row||!res)return null;const eff=effective[i]??row,lists=listOptions(eff),picked=selected?.has(i);
     return <tr key={i} class={`${res.cells.A===''?'empty':''} ${picked?'picked':''} ${active===i?'active':''} ${marks?.[i]?`st-${marks[i]}`:''}`}>{vis.map((c,ci)=>{
      const f=frozen(ci),label=`${c.header.split('\n')[0]}, row ${i+1}`;
      if(c.col==='A'&&onSelect)return <td key="A" {...f} class={`calc num item ${f.class??''}`}><button class="item-button" aria-pressed={picked} aria-label={`Select row ${i+1}`} title="Select row (Shift-click for a range)" onClick={e=>onSelect(i,e.shiftKey)}>{res.cells.A===''?<span class="row-no">{i+1}</span>:res.cells.A}</button></td>;
      if(c.kind==='calc'){const v=res.cells[c.col],text=show(c.col,v);return <td key={c.col} {...f} class={`calc ${typeof v==='number'?'num':''} ${tone(v)} ${f.class??''}`} title={typeof v==='number'&&text!==String(v)?String(v):undefined}>{text}</td>;}
      const col=c.col as InputCol,raw=row[col],s=raw.trim()?'':sug[col]??'',bad=res.invalid[col],cls=`${c.kind} ${bad?'bad':''} ${s?'sug':''} ${f.class??''}`;
      if(c.kind==='list'){const value=raw||s,opts=lists[col as ListCol],all=value&&!opts.includes(value)?[value,...opts]:opts;
       return <td key={c.col} {...f} class={cls} title={bad??(s?`Suggested: ${s}. Pick a value to set it.`:undefined)}><select data-r={i} data-c={col} aria-label={label} aria-invalid={bad?true:undefined} value={value} onChange={e=>onChange(i,col,e.currentTarget.value)} onKeyDown={keys(i,col)}><option value=""></option>{all.map(o=><option key={o} value={o}>{o}</option>)}</select></td>;}
      return <td key={c.col} {...f} class={`${cls} ${col==='C'||col==='D'?'':'num'}`} title={bad??(s?`Suggested: ${s}. Type a value to set it.`:undefined)}><input data-r={i} data-c={col} aria-label={label} aria-invalid={bad?true:undefined} value={raw} maxLength={MAX_CELL} placeholder={s} inputMode={col==='C'||col==='D'?'text':'decimal'} autoComplete="off" spellcheck={false} onInput={e=>onChange(i,col,e.currentTarget.value)} onKeyDown={keys(i,col)} onPaste={paste(i,col)}/></td>;
     })}{tools&&<td class="row-tools">{onInspect&&<button class="icon-button" aria-label={`Show calculation for row ${i+1}`} title="Show calculation" onClick={()=>onInspect(i)}><Calculator size={13}/></button>}{onDelete&&<button class="icon-button danger" aria-label={`Delete row ${i+1}`} title="Delete row" onClick={()=>onDelete(i)}><Trash2 size={13}/></button>}</td>}</tr>;})}
    {end<ids.length&&<tr class="spacer" style={{height:`${(ids.length-end)*ROW}px`}} aria-hidden="true"/>}
   </tbody>
  </table>
  {ids.length===0&&<p class="sheet-empty">No rows match this view.</p>}
 </div>;
}
// Maps a pasted block onto the sheet like Excel does: columns line up from the cell pasted into, formula columns are skipped.
export function pasteGrid(rows:readonly SheetRow[],i:number,col:InputCol,grid:string[][],clean:(c:InputCol,v:string,r:SheetRow)=>string,maxRows:number,visible?:readonly Col[]):SheetRow[] {
 const columns=visible?COLUMNS.filter(c=>visible.includes(c.col)):COLUMNS,out=rows.map(r=>({...r})),from=columns.findIndex(c=>c.col===col);
 grid.forEach((cells,k)=>{const r=i+k;if(r>=maxRows)return;const row=out[r]??emptyRow();out[r]=row;
  cells.forEach((v,j)=>{const c=columns[from+j];if(c&&c.kind!=='calc'){const key=c.col as InputCol;row[key]=clean(key,v,row);}});});
 return out;
}
export function Legend() {return <div class="sheet-legend" aria-label="Column colours"><span><i class="input"/>You type the value</span><span><i class="list"/>Pick from dropdown</span><span><i class="calc"/>Calculated</span></div>;}
