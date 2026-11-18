import {COLUMNS,TABLES,type Col,type RowResult,type SheetRow} from './sheet';

// Everything an engineer must resolve before issuing the schedule, in the workbook's own terms.
export type Issue={row:number;col:Col;level:'error'|'warning'|'info';kind:'current'|'vd'|'earth'|'fault'|'invalid'|'range'|'none'|'duplicate'|'chain'|'missing';text:string};
const head=(col:Col)=>COLUMNS.find(c=>c.col===col)?.header.split('\n')[0]??col;
const NEEDED:Col[]=['C','E','F','G','I','N','O','P','Q','AC','AH','AM'];
const f2=(v:unknown)=>typeof v==='number'?v.toFixed(2):String(v),f3=(v:unknown)=>typeof v==='number'?v.toFixed(3):String(v);
export function findIssues(rows:readonly SheetRow[],results:readonly RowResult[]):Issue[] {
 const out:Issue[]=[],byTo=new Map<string,number[]>();
 rows.forEach((r,i)=>{const k=r.D.trim().toLowerCase();if(k)byTo.set(k,[...(byTo.get(k)??[]),i]);});
 rows.forEach((r,i)=>{
  const res=results[i];if(!res||res.cells.A==='')return;const c=res.cells;
  for(const [col,text] of Object.entries(res.invalid))out.push({row:i,col:col as Col,level:'error',kind:'invalid',text:`${head(col as Col)}: ${text}`});
  if(c.AG==='FAIL')out.push({row:i,col:'AG',level:'error',kind:'current',text:typeof c.N==='number'&&typeof c.M==='number'&&c.N<c.M?`In ${c.N} A is below Ib ${f2(c.M)} A.`:`Iz ${f2(c.AF)} A is below In ${c.N} A. Use a larger size or more cables.`});
  if(c.AN==='FAIL')out.push({row:i,col:'AN',level:'error',kind:'vd',text:`Total VD ${f2(c.AL)} % exceeds the permissible ${c.AM} %.`});
  if(c.BT==='FAIL')out.push({row:i,col:'BT',level:'error',kind:'vd',text:`Starting VD ${f2(c.BR)} % (${r.BP.trim()}) exceeds the permissible ${c.BS===''?`${TABLES.defaults.startVd} % (Settings)`:`${c.BS} %`}. Use a larger size, more cables or a softer starter.`});
  const f=res.helpers.fault;
  const ra=f.system==='TT'&&r.AR.trim()&&typeof c.BC==='number',loop=ra?`Ra ${r.AR.trim()} Ω`:`Zs ${f3(c.BB)} Ω`;
  if(c.BE==='FAIL')out.push({row:i,col:'BE',level:'error',kind:'earth',text:`${loop} exceeds the ${f.system} maximum ${f3(c.BC)} Ω, so the device will not disconnect an earth fault within ${c.AV===''?'the required time':`${c.AV} s`}. ${f.system==='TT'?'Add an RCD or use a lower IΔn, or lower the electrode resistance.':'Use a larger cable or CPC, a device with a lower Ia, or an RCD.'}`});
  if(c.BG==='FAIL')out.push({row:i,col:'BG',level:'error',kind:'earth',text:`The ${f.cpc} mm² CPC is below the Table 54.2 minimum ${f2(c.AZ)} mm² and cannot carry the earth fault current ${f2(c.BD)} A for ${f.cpcTime} s (k²S² < I²t). Use a larger CPC.`});
  if(c.BJ==='FAIL')out.push({row:i,col:'BJ',level:'error',kind:'fault',text:`Breaking capacity ${r.BI.trim()} kA is below the ${f2(f.Ik)} kA fault level at From. Use a device rated for it, or back it up with a supply-side device.`});
  if(c.BO==='FAIL')out.push({row:i,col:'BO',level:'error',kind:'fault',text:`${r.AC.trim()} mm² is below the ${f2(c.BN)} mm² needed for ${r.BL.trim()?`the let-through energy ${r.BL.trim()} A²s`:`${f2(f.Ik)} kA for ${f.t} s`}. Use a larger size${r.BL.trim()?'':', or enter the device let-through I²t'}.`});
  if(c.BO==='Check let-through')out.push({row:i,col:'BO',level:'warning',kind:'fault',text:`${r.AC.trim()} mm² fails on ${f2(f.Ik)} kA for ${f.t} s, but an MCB clears faster. Enter its let-through I²t from the manufacturer's data.`});
  if(c.AB==='None passes')out.push({row:i,col:'AB',level:'warning',kind:'none',text:`No single size passes with ${r.AD.trim()||1} cable(s). Add parallel cables or change the method.`});
  for(const col of ['T','X'] as const)if(c[col]==='Out of range')out.push({row:i,col,level:'warning',kind:'range',text:`${head(col)} is outside the catalogue table.`});
  const dupes=byTo.get(r.D.trim().toLowerCase());if(dupes&&dupes.length>1&&dupes[0]===i)out.push({row:i,col:'D',level:'warning',kind:'duplicate',text:`To "${r.D.trim()}" is used on Excel rows ${dupes.map(d=>d+2).join(", ")}. From lookups use the first one.`});
  const missing=NEEDED.filter(col=>!r[col as keyof SheetRow]?.trim());if(missing.length)out.push({row:i,col:missing[0]!,level:'info',kind:'missing',text:`Still to fill: ${missing.map(head).join(', ')}.`});
 });
 // Rows other rows are fed from whose own total VD is blank: the upstream chain stops there.
 const firstTo=new Map([...byTo].map(([k,v])=>[k,v[0]!]));
 rows.forEach((r,i)=>{const c=results[i]?.cells;if(!c||c.AK===''||c.AL!=='')return;let j=firstTo.get(r.C.trim().toLowerCase()),guard=0;
  while(j!==undefined&&guard++<100){const up=rows[j]!,u=results[j]!.cells,next=firstTo.get(up.C.trim().toLowerCase());if(u.AL===''&&(u.AK===''||!up.C.trim()||next===undefined)){if(!out.some(o=>o.kind==='chain'&&o.row===j))out.push({row:j,col:'AL',level:'warning',kind:'chain',text:`Total VD stops at "${up.D.trim()}": it has no voltage drop of its own, so rows fed from it get none either (as in the workbook).`});break;}j=next;}});
 const rank={error:0,warning:1,info:2};
 return out.sort((a,b)=>rank[a.level]-rank[b.level]||a.row-b.row);
}
