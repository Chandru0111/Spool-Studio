import {calculateSheet,evaluateRow,keyOf,listOptions,isBlankRow,DECIMAL,TABLES,type Cell,type SheetRow,type InputCol,type RowResult} from './sheet';

// Load-list sizing: blanks the engineer has not filled get preliminary suggestions. Suggestions never overwrite a typed value.
export type SuggestDefaults={cableType:string;cores3:string;cores1:string;method:string;vdPct:string};
export const defaultSuggestions:SuggestDefaults={cableType:'Cu/XLPE/SWA/PVC',cores3:'4C',cores1:'2C',method:'E - Free air / perforated tray / ladder',vdPct:'4'};
export const STANDARD_RATINGS=[6,10,16,20,25,32,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3200,4000];
export type Suggested=Partial<Record<InputCol,string>>;
export type SuggestedSheet={effective:SheetRow[];suggested:Suggested[];results:RowResult[]};

const pick=(blank:string,value:string,options:string[])=>!blank.trim()&&value&&options.includes(value)?value:'';
// A row's suggestions depend only on its own inputs, the defaults and the upstream total VD, so they are cached:
// a keystroke re-sizes only the edited row and the circuits it feeds instead of every row (≈40 ms per key at 500 rows before).
const memo=new Map<string,{s:Suggested;r:RowResult}>();
export function suggestSheet(rows:readonly SheetRow[],d:SuggestDefaults):SuggestedSheet {
 const suggested:Suggested[]=rows.map(()=>({})),effective=rows.map(r=>({...r})),dKey=JSON.stringify(d);
 // Size and parallel cables need the upstream feeder's total VD, so feeders are settled before the circuits they supply.
 const settled:(RowResult|undefined)[]=[],visiting=new Set<number>(),to=new Map<string,number>();
 rows.forEach((r,i)=>{const k=r.D.trim().toLowerCase();if(k&&!to.has(k))to.set(k,i);});
 const settle=(i:number):RowResult|undefined=>{
  if(settled[i]||visiting.has(i))return settled[i];visiting.add(i);
  const row=rows[i]!,eff=effective[i]!,s=suggested[i]!,from=row.C.trim().toLowerCase(),u=from?to.get(from):undefined;
  // The AT helper column: blank without From, 0 when From matches no To, else the upstream row's total VD.
  const at:Cell=!from?'':u===undefined?0:u===i||visiting.has(u)?'':settle(u)?.cells.AL??'';
  if(isBlankRow(row)){visiting.delete(i);return settled[i]=evaluateRow(eff,at);}
  const key=`${JSON.stringify(row)}|${dKey}|${keyOf(at)}`,hit=memo.get(key);
  if(hit){Object.assign(s,hit.s);Object.assign(eff,hit.s);visiting.delete(i);return settled[i]=hit.r;}
  // Type, cores, method and VD limit come from the list-wide defaults; protection from the design current.
  const set=(c:InputCol,v:string)=>{if(v){s[c]=v;eff[c]=v;}};
  set('O',pick(row.O,d.cableType,listOptions(eff).O));
  set('P',pick(row.P,eff.E.trim()==='3'?d.cores3:eff.E.trim()==='1'?d.cores1:'',listOptions(eff).P));
  set('Q',pick(row.Q,d.method,listOptions(eff).Q));
  const vd=d.vdPct.trim();if(!row.AM.trim()&&DECIMAL.test(vd)&&Number(vd)>0&&Number.isFinite(Number(vd)))set('AM',vd);
  const ib=evaluateRow(eff,'').cells.M;
  if(!row.N.trim()&&typeof ib==='number'){const rating=STANDARD_RATINGS.find(r=>r>=+ib.toPrecision(15));if(rating)set('N',String(rating));}
  const counts=row.AD.trim()?[row.AD.trim()]:TABLES.cableCounts.map(String),trial=(extra:Partial<SheetRow>)=>evaluateRow({...eff,...extra},at).cells;
  if(!row.AC.trim()){for(const n of counts){const size=trial({AD:n,AC:''}).AB;if(typeof size==='number'){s.AC=eff.AC=String(size);if(!row.AD.trim())s.AD=eff.AD=n;break;}}}
  else if(!row.AD.trim()){for(const n of counts){const c=trial({AD:n});if(c.AG==='PASS'&&c.AN!=='FAIL'){s.AD=eff.AD=n;break;}}}
  const r=evaluateRow(eff,at);if(memo.size>20000)memo.clear();memo.set(key,{s:{...s},r});
  visiting.delete(i);return settled[i]=r;
 };
 rows.forEach((_,i)=>settle(i));
 return {effective,suggested,results:calculateSheet(effective)};
}
export const acceptSuggestions=(rows:readonly SheetRow[],s:SuggestedSheet):SheetRow[]=>rows.map((r,i)=>({...r,...s.suggested[i]}));
export const suggestionCount=(s:SuggestedSheet)=>s.suggested.reduce((n,x)=>n+Object.keys(x).length,0);
