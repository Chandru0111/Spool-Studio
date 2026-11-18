import {evaluateRow,ratingBlock,COLUMNS,type Cell,type Col,type RowResult,type SheetRow} from './sheet';

// Explains a row without new maths: every number comes from the workbook formulas in sheet.ts.
const xl=(n:number)=>+n.toPrecision(15);
export type LadderStep={size:number;it:number;mvAm:number;iz:Cell;vdPct:Cell;totalVdPct:number;current:boolean;vd:boolean;suggested:boolean;chosen:boolean};
// Every size of the chosen type/cores/method with the same tests the Suggested Cable Size column (AB) applies.
export function sizeLadder(row:SheetRow,result:RowResult):LadderStep[] {
 const block=ratingBlock(row.E.trim(),row.O.trim(),row.P.trim(),row.Q.trim()),c=result.cells,at=result.helpers.AT;if(!block||typeof c.M!=='number')return [];
 const limit=Number(row.AM)>0?Number(row.AM):Infinity,upstream=typeof at==='number'?at:0;
 return block.rows.map(([size,it,mvAm])=>{const t=evaluateRow({...row,AC:String(size)},at,c.A).cells,vd=typeof t.AK==='number'?t.AK:0,iz=t.AF;
  return {size,it,mvAm,iz,vdPct:t.AK,totalVdPct:upstream+vd,current:typeof iz==='number'&&xl(iz)>=xl(Math.max(c.M as number,typeof c.N==='number'?c.N:0)),vd:xl(upstream+vd)<=xl(limit),suggested:c.AB===size,chosen:c.AC===size};});
}
export type ChainLink={index:number;tag:string;from:string;vdPct:Cell;totalVdPct:Cell};
// Feeders from the source down to this row, following the workbook's first-match From → To rule.
export function feederChain(rows:readonly SheetRow[],results:readonly RowResult[],i:number):ChainLink[] {
 const byTo=new Map<string,number>();rows.forEach((r,j)=>{const k=r.D.trim().toLowerCase();if(k&&!byTo.has(k))byTo.set(k,j);});
 const out:ChainLink[]=[],seen=new Set<number>();let j:number|undefined=i;
 while(j!==undefined&&!seen.has(j)){seen.add(j);const r:SheetRow=rows[j]!,c=results[j]?.cells;out.unshift({index:j,tag:r.D.trim()||`Row ${j+1}`,from:r.C.trim(),vdPct:c?.AK??'',totalVdPct:c?.AL??''});const from:string=r.C.trim().toLowerCase();j=from?byTo.get(from):undefined;}
 return out;
}
export const header=(col:Col)=>COLUMNS.find(c=>c.col===col)?.header.split('\n')[0]??col;
