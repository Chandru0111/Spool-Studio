import {emptyRow,clip,calculateSheet,COLUMNS,type InputCol} from '../engine/sheet';
import {detectColumns,itemRows,mappingAt,toSheetRows,normalize,type InputTable,type Mapping} from './load-list';
import {readFacts,isBoardTag,type Candidate,type SchematicResult} from './schematic';

// One workbook often holds several load lists, one per MCC/DB panel: a worksheet each, or blocks stacked down one sheet,
// each under a title row naming the panel ("DB-L1 fed from MSB-01"). Loads take their panel as From when the list leaves it
// blank, and a "fed from" title gives the panel's own feeder, so total VD chains load → DB → switchboard.
export type PanelRead=SchematicResult&{panels:number;sheets:number;columns:string[]};
// The load list's own nominal current: checked against the sheet's design current Ib, never used in its place.
const IN_HEAD=['ina','in','nominalcurrenta','nominalcurrent','ratedcurrenta','ratedcurrent','fullloadcurrenta','flca','flc'];
// Load-list columns the sizing sheet has no input for, and why they are not used.
const UNUSED:[RegExp,string][]=[[/^loadfactor/,'load balance only; not used to size one cable'],[/^eff/,'not used: the rated input power already includes it'],
 [/^(cis|duty|operatingmode)$/,'duty (C/I/S): load balance only'],[/^consumed/,'not used: the rated input power sizes the cable'],[/starter|restart/,'not used for sizing'],
 [/^(vital|essential|nonessential)$/,'load category: not used for sizing'],[/(kw|kvar|kva)$|load$/,'load balance only']];
const MISSING:[InputCol,string][]=[['N','protection rating'],['O','cable type'],['P','cores'],['Q','installation method'],['AC','cable size'],['AD','no. of cables'],['AM','permissible VD']];
const colName=(col:InputCol)=>COLUMNS.find(c=>c.col===col)?.header.split('\n')[0]??col;
// One line per load-list column: what the sizing sheet reads it as, or why it is left out.
function describe(heads:{row:string[];mapping:Mapping;inCol:number}[],phases:boolean):string[] {
 const out=new Map<string,string>(),mapped=new Set<InputCol>();
 for(const {row,mapping,inCol} of heads){const by=new Map(Object.entries(mapping).map(([c,i])=>[i,c as InputCol]));
  row.forEach((raw,i)=>{const text=raw.replace(/\s+/g,' ').trim(),key=normalize(text);if(!text||/^[\d.,\s%-]+$/.test(text)||out.has(text))return;const col=by.get(i);if(col)mapped.add(col);
   out.set(text,col?`${col} · ${colName(col)}`:i===inCol?'checked against the calculated design current Ib':UNUSED.find(([re])=>re.test(key))?.[1]??'not used');});}
 const lines=[...out].map(([h,use])=>`${h} → ${use}`);
 if(!mapped.has('E'))lines.push(phases?'Phases: not in the file; worked out from the voltage (italic).':'Phases: not in the file; enter them or use the suggestions.');
 const gaps=MISSING.filter(([c])=>!mapped.has(c)).map(([,n])=>n);if(gaps.length)lines.push(`Not in the file, so the suggestions fill them (blue italic): ${gaps.join(', ')}.`);
 if(!mapped.has('AH'))lines.push('Cable run length: not in the file. You enter it; it is never guessed.');
 return lines;
}
const isHeader=(r:readonly string[])=>{const m=detectColumns(r as string[]);return Object.keys(m).length>=3&&(m.D!==undefined||m.G!==undefined);};
const TOTAL=/^(?:sub[\s-]*)?total\b|\bgrand\s+total\b|\btotal\s+(?:load|connected|demand|kw|kva)\b/i;
// Merged title cells repeat the same value in every cell, so distinct values are counted.
const distinct=(r:readonly string[])=>[...new Set(r.map(v=>v.trim()).filter(Boolean))];
function panelOf(text:string):{name:string;fedFrom?:string}|null {
 const f=readFacts(text),boards=f.tags.filter(t=>isBoardTag(t)&&t!==f.fedFrom),name=boards.find(t=>/\d/.test(t))??boards[0];
 return name?{name,...f.fedFrom&&f.fedFrom!==name?{fedFrom:f.fedFrom}:{}}:null;
}
// Worksheets are often named after their panel in words ("Pump House Panel", "Workshop Panel"), not by tag.
const PANEL_WORD=/\b(?:switch\s*boards?|panels?|boards?|mcc|db|msb|smsb|mdb|sdb|box|kiosk|cubicle|distribution)\b/i;
const sheetPanelOf=(name:string)=>panelOf(name)??(PANEL_WORD.test(name.replace(/[_-]/g,' '))?{name:name.trim()}:null);
// A title is a short row (at most three distinct values) a few rows above the header that names a panel.
function titleAbove(rows:readonly string[][],header:number,floor:number):{at:number;text:string;name:string;fedFrom?:string}|null {
 for(let i=header-1;i>=Math.max(floor,header-4);i--){const cells=distinct(rows[i]??[]);if(!cells.length)continue;if(cells.length>3||isHeader(rows[i]!))return null;
  const text=cells.join(' '),p=panelOf(text);if(p)return {at:i,text,...p};}
 return null;
}
export function readPanels(tables:readonly InputTable[]):PanelRead {
 const candidates:Candidate[]=[],notes:string[]=[],boards:string[]=[],fed=new Map<string,{from:string;text:string;sheet:number}>();let totals=0,sheets=0,unnamed=0,phases=false;
 const nominal=new Map<Candidate,number>(),headOf=new Map<Candidate,{row:string[];mapping:Mapping;inCol:number}>();
 tables.forEach((t,s)=>{
  const heads=t.rows.map((r,i)=>isHeader(r)?i:-1).filter(i=>i>=0);if(!heads.length)return;sheets++;
  const sheetPanel=sheetPanelOf(t.name),body=itemRows(t);let last:{name:string;why:string}|null=null;
  const titles=heads.map((h,k)=>titleAbove(t.rows,h,k?heads[k-1]!+1:0));
  heads.forEach((h,k)=>{
   const title=titles[k],nextHead=heads[k+1],end=nextHead===undefined?t.rows.length:titles[k+1]?.at??nextHead,mapping=mappingAt(t,h,body);
   const inCol=t.rows[h]!.findIndex((v,j)=>j!==mapping.N&&IN_HEAD.includes(normalize(v))),head={row:t.rows[h]!,mapping,inCol};
   // A repeated header with no title of its own (a page break) stays on the panel above it.
   const panel=title?{name:title.name,why:`Panel title "${title.text}" (${t.name} row ${title.at+1})`}:k&&last?last:sheetPanel?{name:sheetPanel.name,why:`Worksheet "${t.name}"`}:null;
   last=panel;if(panel&&!boards.includes(panel.name))boards.push(panel.name);
   if(title?.fedFrom&&!fed.has(title.name.toLowerCase()))fed.set(title.name.toLowerCase(),{from:title.fedFrom,text:title.text,sheet:s});
   for(let i=h+1;i<end;i++){
    const values=body[i]!;if(values.some(v=>TOTAL.test(v.trim()))){totals++;continue;}
    const row=toSheetRows([t.rows[h]!,values],0,mapping)[0];if(!row)continue;
    // Loads on a panel are named; an unnamed row is a sub-heading, a summary line or a catalogue entry (a brand price list).
    if(!row.D.trim()){unnamed++;continue;}
    const inferred:Candidate['inferred']={};if(panel&&!row.C.trim()){row.C=clip(panel.name);inferred.C=panel.why;}
    // LV three-phase systems run at 380–1000 V, single-phase at 220–240 V; anything else is left for the engineer.
    const un=Number(row.F);if(!row.E.trim()&&row.F){if(un>=380&&un<=1000){row.E='3';inferred.E=`Voltage ${row.F} V: three-phase`;phases=true;}else if(un>=220&&un<=240){row.E='1';inferred.E=`Voltage ${row.F} V: single-phase`;phases=true;}}
    const c:Candidate={row,page:s+1,kind:'table',evidence:`${t.name} row ${i+1}: ${distinct(values).join(' · ').slice(0,160)}`,inferred,include:true};candidates.push(c);headOf.set(c,head);
    const inA=inCol<0?NaN:Number((values[inCol]??'').trim()||NaN);if(inA>0)nominal.set(c,inA);
   }
  });
 });
 // A sheet that repeats loads read on another sheet (a search or summary view) adds nothing: drop the copy, keep the panel's own row.
 const keyOf=(c:Candidate)=>JSON.stringify({...c.row,C:''}),pages=new Map<string,Set<number>>(),first=new Map<string,number>();
 for(const c of candidates){const k=keyOf(c);if(c.row.C.trim())pages.set(k,(pages.get(k)??new Set()).add(c.page));if(!first.has(k+c.row.C))first.set(k+c.row.C,c.page);}
 const copies=candidates.filter(c=>{const k=keyOf(c),on=pages.get(k);return first.get(k+c.row.C)!==c.page||!c.row.C.trim()&&on!==undefined&&[...on].some(p=>p!==c.page);});
 if(copies.length){const sheetsOf=[...new Set(copies.map(c=>tables[c.page-1]!.name))].join(', ');candidates.splice(0,candidates.length,...candidates.filter(c=>!copies.includes(c)));
  notes.push(`${copies.length} row${copies.length===1?' on':'s on'} ${sheetsOf} repeat${copies.length===1?'s':''} loads already read from another sheet and ${copies.length===1?'was':'were'} skipped.`);}
 // A panel's own feeder, from its "fed from" title, unless the workbook already lists that cable. Unticked: no cable data yet.
 for(const [key,f] of fed){if(candidates.some(c=>c.row.D.trim().toLowerCase()===key))continue;const name=boards.find(b=>b.toLowerCase()===key)!;
  candidates.push({row:{...emptyRow(),C:clip(f.from),D:clip(name)},page:f.sheet+1,kind:'feeder',evidence:f.text,inferred:{C:`"Fed from" in the panel title "${f.text}"`,D:'Panel named in its title'},include:false});}
 // The list's In (A) against the sheet's Ib: a big gap usually means a wrong kW, PF or voltage in the list.
 const loads=candidates.filter(c=>nominal.has(c)),ib=calculateSheet(loads.map(c=>c.row));
 const off=loads.map((c,k)=>({c,inA:nominal.get(c)!,ib:ib[k]!.cells.M})).filter((x):x is {c:Candidate;inA:number;ib:number}=>typeof x.ib==='number'&&Math.abs(x.ib-x.inA)>.2*x.inA);
 if(off.length)notes.push(`${off.length} load${off.length===1?'':'s'}: the calculated design current Ib differs from the list's In (A) by more than 20%; check kW, PF and voltage. ${off.slice(0,5).map(x=>`${x.c.row.D} (In ${x.inA} A, Ib ${x.ib.toFixed(1)} A)`).join(', ')}${off.length>5?'…':''}`);
 if(unnamed)notes.push(`${unnamed} row${unnamed===1?'':'s'} with no load name ${unnamed===1?'was':'were'} skipped (sub-headings, summary lines or catalogue entries).`);
 if(totals)notes.push(`${totals} total row${totals===1?' was':'s were'} skipped (they are sums, not loads).`);
 const unpanelled=candidates.filter(c=>!c.row.C.trim()).length;if(unpanelled)notes.push(`${unpanelled} row${unpanelled===1?' has':'s have'} no panel: no title row or panel-named worksheet above ${unpanelled===1?'it':'them'}. Fill From before sizing.`);
 if(candidates.length>2000)throw Error('Limit a load list to 2,000 rows.');
 return {candidates,boards,notes,panels:boards.length,sheets:new Set(candidates.map(c=>c.page)).size||sheets,columns:describe([...new Set(candidates.map(c=>headOf.get(c)).filter(h=>h!==undefined))],phases)};
}
