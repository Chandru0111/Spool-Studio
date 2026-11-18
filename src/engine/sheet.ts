import tables from '../data/sizing-tables.json';

// A row of the "Cable Sizing" sheet. Every calculated column below copies the matching Excel formula in the
// supplied workbook (row 2), including its blank-cell rules, so the app and the exported file always agree.
export const INPUT_COLS=['B','C','D','E','F','G','H','I','L','N','O','P','Q','R','S','U','W','Y','Z','AC','AD','AH','AM','AP','AQ','AR','AS','AT','AU','AW','AX','AY','BH','BI','BK','BL','BP','BQ','BS'] as const;
export const CALC_COLS=['A','J','K','M','T','V','X','AA','AB','AE','AF','AG','AI','AJ','AK','AL','AN','AO','AV','AZ','BA','BB','BC','BD','BE','BF','BG','BJ','BM','BN','BO','BR','BT'] as const;
export type InputCol=typeof INPUT_COLS[number];export type CalcCol=typeof CALC_COLS[number];export type Col=InputCol|CalcCol;
export type ListCol='B'|'E'|'F'|'O'|'P'|'Q'|'AC'|'AD'|'AP'|'AS'|'AW'|'BP';
// The Item column (A) counts only the sizing inputs, exactly like the workbook's COUNTA; the earth loop / short-circuit inputs are not in it.
const ITEM_COLS:readonly InputCol[]=['B','C','D','E','F','G','H','I','L','N','O','P','Q','R','S','U','W','Y','Z','AC','AD','AH','AM'];
export type SheetRow=Record<InputCol,string>;
export type Cell=number|string;type Num=number|'';
export type Column={col:Col;header:string;kind:'input'|'list'|'calc';note:string;width:number};
// helpers mirrors the workbook's hidden helper columns. The names are the step05 letters (AT upstream VD, AU insulation, AV total
// factor k, AW/AX/AY factor tables), which sit in BY–CD since step09; fault holds the step08 helpers, CE–CU since step09.
export type FaultHelpers={system:Earthing;U0:Cell;txZ:Cell;Ze:Cell;Ia:Cell;IdN:Cell;cpcType:string;k:Cell;kCpc:Cell;cpcMultiplier:Cell;cpc:Cell;rCpc:Cell;Ik:Cell;t:Cell;energy:Cell;cpcTime:Cell;cpcEnergy:Cell;final:boolean};
export type Helpers={AT:Cell;AU:string;AV:Cell;AW:string;AX:string;AY:string;fault:FaultHelpers};
// What the feeding row passes down: its total VD (AL), its Zs (BB), its fault level at To (BM) and its earthing system.
export type Upstream={AL:Cell;BB:Cell;BM:Cell;system:Earthing};
// '' is an earthing system typed outside the list: the earth loop checks then stay blank, as in the workbook.
export type Earthing='TN-S'|'TT'|'';
export type RowResult={cells:Record<Col,Cell>;invalid:Partial<Record<InputCol,string>>;source:string;helpers:Helpers};
export const COLUMNS=tables.columns as Column[];
export const TABLES=tables;
const TEXT_COLS:readonly InputCol[]=['C','D','O','P','Q','AP','AS','AW','BP'];
const LIST_ERROR=tables.listError;
// A saved cell holds at most 300 characters (see SheetRowData); longer text is cut without splitting a surrogate pair.
export const MAX_CELL=300;
export const clip=(s:string)=>s.length>MAX_CELL?s.slice(0,MAX_CELL).replace(/[\uD800-\uDBFF]$/,''):s;
export const emptyRow=():SheetRow=>Object.fromEntries(INPUT_COLS.map(c=>[c,''])) as SheetRow;
export const isBlankRow=(r:SheetRow)=>INPUT_COLS.every(c=>!r[c].trim());

type Block={key:string;source:string;rows:[number,number,number][]};
const blocks=new Map((tables.ratings as Block[]).map(b=>[b.key,b]));
const insulation=new Map<string,string>();for(const t of tables.cableTypes)if(!insulation.has(t.type))insulation.set(t.type,t.insulation);
const temperature=new Map(tables.temperature.map(t=>[t.key,t]));
const grouping=tables.grouping as Record<string,number>;
const methodFactors=tables.methodFactors as Record<string,{temp:string;group:string;soil:string}>;
const validation=tables.validation as Record<string,{type:string;op:string;min:number|null;max:number|null;error:string}>;
const voltages=tables.voltages as Record<string,number[]>;
type CpcType={name:string;k:number;kLarge:number;kXlpe:number;multiplier:number;multiplierXlpe:number;sameMaterial:boolean;copperTable:boolean};
const fault=tables.fault as unknown as {resistance:[number,number][];insulation:Record<string,{k:number;kLarge:number;multiplier:number}>;devices:{name:string;multiple:number|null}[];transformers:{upTo:number;uz:number}[];cpcTypes:CpcType[];disconnection:{upTo:number;seconds:number;tt:number}[];earthing:string[]};
const defaults=tables.defaults as {diversity:number;thd:number;cables:number;ze:number|null;faultLevel:number|null;faultTime:number|null;cmin:number|null;earthing:string;startVd:number|null};
const resistance=new Map(fault.resistance),faultSizes=fault.resistance.map(r=>r[0]),devices=new Map(fault.devices.map(d=>[d.name,d.multiple]));
// Excel's MATCH and = ignore case, so a CPC type typed in another case still finds its FaultData row.
const cpcTypes=new Map(fault.cpcTypes.map(c=>[c.name.toLowerCase(),c])),starters=new Map(tables.starters.map(s=>[s.name.toLowerCase(),s.multiple]));
export const CORE_CPC='Earth core in cable',SEPARATE_CPC='Separate copper conductor';
// Excel compares numbers at 15 significant digits.
const xl=(n:number)=>+n.toPrecision(15);
// Excel reads only plain decimal numbers; JavaScript would also take 0x1A, 0b11 or Infinity.
export const DECIMAL=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const roundUp=(n:number)=>{const v=xl(n);return v<0?Math.floor(v):Math.ceil(v);};

// Dropdown contents, narrowed exactly like the workbook's data validation lists (indexed once; the sheet asks on every keystroke).
const index=(pairs:[string,string][])=>{const m=new Map<string,string[]>();for(const [k,v] of pairs){const list=m.get(k);if(list)list.push(v);else m.set(k,[v]);}return m;};
const typesBy=index(tables.cableTypes.map(t=>[String(t.phases),t.type])),coresBy=index(tables.cores.map(c=>[`${c.phases}|${c.type}`,c.cores])),methodsBy=index(tables.methods.map(m=>[`${m[0]}|${m[1]}|${m[2]}`,String(m[3])]));
const sizesBy=new Map([...blocks].map(([k,b])=>[k,b.rows.map(r=>String(r[0]))])),fixed={B:tables.transformers.map(String),E:['1','3'],AD:tables.cableCounts.map(String),AP:fault.earthing,AS:fault.devices.map(d=>d.name),AW:fault.cpcTypes.map(c=>c.name),BP:tables.starters.map(s=>s.name)},none:string[]=[];
const voltagesBy=new Map(Object.entries(voltages).map(([k,v])=>[k,v.map(String)]));
export function listOptions(row:SheetRow):Record<ListCol,string[]> {
 const e=row.E.trim(),o=row.O.trim(),p=row.P.trim(),q=row.Q.trim();
 return {...fixed,F:voltagesBy.get(e)??none,O:typesBy.get(e)??none,P:coresBy.get(`${e}|${o}`)??none,Q:methodsBy.get(`${e}|${o}|${p}`)??none,AC:sizesBy.get(`${e}|${o}|${p}|${q}`)??none};
}
export const ratingBlock=(e:string,o:string,p:string,q:string)=>blocks.get(`${e}|${o}|${p}|${q}`);

type Parsed={n:Partial<Record<InputCol,number>>;t:Partial<Record<InputCol,string>>;invalid:Partial<Record<InputCol,string>>;filled:boolean};
function parse(row:SheetRow):Parsed {
 const out:Parsed={n:{},t:{},invalid:{},filled:false};
 for(const c of INPUT_COLS){const raw=row[c].trim();if(!raw)continue;
  if(TEXT_COLS.includes(c)){out.t[c]=raw;out.filled=true;continue;}
  const v=DECIMAL.test(raw)?Number(raw):NaN,rule=validation[c];
  // Excel's data validation would refuse these entries, so they never reach a formula.
  if(!Number.isFinite(v)){out.invalid[c]=rule?.error||LIST_ERROR;continue;}
  if(rule&&(rule.type==='whole'&&!Number.isInteger(v)||rule.op==='between'&&(v<(rule.min??-Infinity)||v>(rule.max??Infinity))||rule.op==='greaterThan'&&v<=(rule.min??0)||rule.op==='greaterThanOrEqual'&&v<(rule.min??0))){out.invalid[c]=rule.error;continue;}
  out.n[c]=v;out.filled=true;}
 return out;
}

// Excel's = ignores case: "tt" is TT. A blank cell takes the Settings default (anything but TT counts as TN-S).
const earthing=(raw:string|undefined):Earthing=>{const u=(raw??defaults.earthing).toUpperCase();return u==='TT'?'TT':u==='TN-S'||raw===undefined?'TN-S':'';};
// Earth fault loop (AP–BG) and short circuit (BH–BO), copied from the step08 formulas and their helpers (CE–CU since step09).
// up is the feeding row (null when From is blank, unmatched or loops), AU the insulation helper, cables the parallel count,
// feeds whether another row's From names this row's To (then it is not a final circuit).
function faultCells(v:Parsed['n'],t:Parsed['t'],AU:string,cables:number,up:Upstream|null,feeds:boolean,letThroughBlank:boolean){
 const E=v.E,F=v.F,N=v.N,AC=v.AC,AH=v.AH,P=t.P??'',num=(c:Cell):c is number=>typeof c==='number',fin=(n:number):Num=>Number.isFinite(n)?n:'';
 const system=earthing(t.AP),tt=system==='TT';
 // Nominal U0: the voltage for 1-phase, voltage / √3 rounded to 10 V for 3-phase (400 V gives 230 V).
 const U0:Num=E===undefined||F===undefined||F<=0?'':E===3?Math.round(xl(F/Math.sqrt(3))/10)*10:F;
 const B=v.B,uz=fault.transformers[Math.min(fault.transformers.length,fault.transformers.filter(x=>x.upTo<(B??0)).length+1)-1]?.uz;
 const txZ:Num=B===undefined||U0===''||B<=0||uz===undefined?'':3*U0**2*uz/(100*B*1000);
 // TT: typed, or a TT feeding row's Zs; the transformer and the Settings default say nothing about the electrode and earth return.
 const Ze:Num=v.AQ!==undefined?v.AQ:tt?(up&&up.system==='TT'&&num(up.BB)?up.BB:''):up?(num(up.BB)?up.BB:''):txZ!==''?txZ:defaults.ze??'';
 const AS=t.AS??'',multiple=AS?devices.get(AS):undefined;
 const Ia:Num=v.AT!==undefined?v.AT:!AS||N===undefined||multiple===undefined||multiple===null?'':multiple*N;
 const IdN:Num=v.AU!==undefined?v.AU/1000:'';
 const final=N!==undefined&&N<=32&&(!t.D||!feeds);
 const band=U0===''?undefined:fault.disconnection[Math.min(fault.disconnection.length,fault.disconnection.filter(d=>d.upTo<U0).length+1)-1];
 const AV:Num=N===undefined||U0===''||!system?'':final?(U0<=50?'':(tt?band?.tt:band?.seconds)??''):tt?1:5;
 // CPC: typed type, else an earth core for 5C 3-phase, 3C 1-phase (both full size) and 3C+3E cables, else a separate copper conductor.
 const fullCore=E===3&&P==='5C'||E===1&&P==='3C';
 const typed=t.AW??'',cpcType=typed||(!t.O||!P?'':fullCore||P==='3C+3E'?CORE_CPC:SEPARATE_CPC),cpcRow=cpcTypes.get(cpcType.toLowerCase()),isType=(name:string)=>cpcType.toLowerCase()===name.toLowerCase();
 const ins=AU?fault.insulation[AU]:undefined;
 const k:Num=ins?((AC??0)>300?ins.kLarge:ins.k):'';
 const kCpc:Num=!cpcType||!AU||!cpcRow||!ins?'':AU==='XLPE'?cpcRow.kXlpe:(AC??0)>300?cpcRow.kLarge:cpcRow.k;
 const cpcMultiplier:Num=!cpcType||!AU||!cpcRow||!ins?'':AU==='XLPE'?cpcRow.multiplierXlpe:cpcRow.multiplier;
 const base=AC===undefined?0:AC<=16?AC:AC<=35?16:AC/2;
 const AZ:Num=AC===undefined||k===''||kCpc===''||!cpcRow?'':cpcRow.sameMaterial?Math.max(isType(SEPARATE_CPC)?2.5:0,faultSizes[Math.min(faultSizes.length,faultSizes.filter(s=>s<xl(base)).length+1)-1]??0):fin(base*k/kCpc);
 const cpc:Num=v.AX!==undefined?v.AX:!cpcType||AZ===''||!cpcRow?'':cpcRow.copperTable?(isType(CORE_CPC)&&fullCore?AC??'':AZ):'';
 const rCpc:Num=v.AY!==undefined?v.AY:cpc===''||!cpcType||!cpcRow?'':cpcRow.copperTable?resistance.get(cpc)??'':'';
 const rPhase=AC===undefined?undefined:resistance.get(AC);
 const BA:Cell=AC===undefined||AH===undefined||!ins||!cpcType?'':rCpc===''||cpcMultiplier===''?'Enter CPC data':rPhase===undefined?'':fin((rPhase*ins.multiplier+rCpc*cpcMultiplier)*AH/(1000*cables));
 const BB:Cell=!num(BA)?'':Ze===''?'Enter Ze':Ze+BA;
 // The larger of the overcurrent limit (TN-S Cmin x U0 / Ia, 411.4.5L; TT 50 / Ia, 411.5.4L) and the RCD limit 50 / IΔn.
 const BC:Cell=U0===''||!system?'':Ia===''&&IdN===''?(v.AT===undefined&&multiple===null?'Enter Ia':''):fin(Math.max(Ia===''?0:(tt?50:(defaults.cmin??1)*U0)/Ia,IdN===''?0:50/IdN));
 const BD:Num=!num(BB)||U0===''||BB<=0?'':fin(U0/BB);
 // TT checks Ra when typed (411.5.3L), else Zs (its Note 2); TN-S always checks Zs.
 const BE:Cell=!num(BC)?'':tt&&v.AR!==undefined?(xl(v.AR)<=xl(BC)?'PASS':'FAIL'):num(BB)?xl(BB)<=xl(BC)?'PASS':'FAIL':'';
 const BF:Cell=AZ===''?'':cpc===''?'Enter CPC size':xl(cpc)>=xl(AZ)?'Table 54.2':'Adiabatic';
 const cpcTime:Num=v.BK!==undefined?v.BK:AV;
 const cpcEnergy:Num=BD===''||cpcTime===''?'':v.BL!==undefined&&v.BL>0?Math.min(v.BL,BD**2*cpcTime):BD**2*cpcTime;
 const BG:Cell=BF===''||BF==='Enter CPC size'?'':BF==='Table 54.2'?'PASS':kCpc===''||cpcEnergy===''||cpc===''?'':xl((kCpc*cpc*cables)**2)>=xl(cpcEnergy)?'PASS':'FAIL';
 const Ik:Num=v.BH!==undefined?v.BH:up?(num(up.BM)?up.BM:''):txZ!==''&&U0!==''?U0/txZ/1000:defaults.faultLevel??'';
 const BJ:Cell=Ik===''?'':v.BI===undefined?'Enter breaking capacity':xl(v.BI)>=xl(Ik)?'PASS':'FAIL';
 const time:Num=v.BK!==undefined?v.BK:defaults.faultTime??'';
 const energy:Num=v.BL!==undefined?v.BL:Ik===''||time===''?'':(Ik*1000)**2*time;
 const BM:Num=Ik===''||U0===''||AC===undefined||AH===undefined||Ik<=0||rPhase===undefined?'':fin(Ik/Math.sqrt(1+((E===3?1:2)*rPhase*AH/(1000*cables)*Ik*1000/U0)**2));
 const BN:Cell=k===''?'':energy===''?'Enter fault level':fin(Math.sqrt(energy)/(k*cables));
 const BO:Cell=!num(BN)||AC===undefined?'':xl(AC)>=xl(BN)?'PASS':letThroughBlank&&AS.slice(0,3).toUpperCase()==='MCB'?'Check let-through':'FAIL';
 return {cells:{AP:t.AP??'',AQ:v.AQ??'',AR:v.AR??'',AS,AT:v.AT??'',AU:v.AU??'',AV,AW:typed,AX:v.AX??'',AY:v.AY??'',AZ,BA,BB,BC,BD,BE,BF,BG,BH:v.BH??'',BI:v.BI??'',BJ,BK:v.BK??'',BL:v.BL??'',BM,BN,BO},
  helpers:{system,U0,txZ,Ze,Ia,IdN,cpcType,k,kCpc,cpcMultiplier,cpc,rCpc,Ik,t:time,energy,cpcTime,cpcEnergy,final} as FaultHelpers};
}

function evaluate(p:Parsed,A:Cell,AT:Cell,up:Upstream|null=null,feeds=false):RowResult {
 const {n:v,t}=p,invalid={...p.invalid};
 const E=v.E,F=v.F,G=v.G,I=v.I,N=v.N,O=t.O??'',P=t.P??'',Q=t.Q??'',AC=v.AC,AH=v.AH,AM=v.AM;
 const cables=v.AD??defaults.cables,div=v.H??defaults.diversity,thd=v.L??defaults.thd;
 const J:Num=G===undefined||I===undefined||I<=0?'':G*div/I;
 const K:Num=G===undefined||I===undefined||I<=0||F===undefined||E===undefined?'':E===3?G*div*1000/(Math.sqrt(3)*F*I):G*div*1000/(F*I);
 const M:Num=K===''?'':K*Math.sqrt(1+thd**2);
 const AU=O?insulation.get(O)??'':'',mf=Q?methodFactors[Q]:undefined,AW=mf?.temp??'',AX=mf?.group??'',AY=mf?.soil??'';
 let T:Cell='';
 if(A!==''){if(v.R===undefined&&v.S===undefined)T=1;else if(AW&&AU){const temp=AW==='GROUND'?v.S:v.R;if(temp===undefined)T=1;else{const row=temperature.get(`${AW}|${Math.max(AW==='GROUND'?10:25,roundUp(temp/5)*5)}`),f=row?(AU==='PVC'?row.PVC:row.XLPE):null;T=typeof f==='number'?f:'Out of range';}}}
 const V:Cell=A===''?'':v.U===undefined?1:!AX?'':grouping[`${AX}|${Math.min(20,Math.max(1,roundUp(v.U)))}`]??'';
 let X:Cell='';
 if(A!==''){const W=v.W;if(W===undefined)X=1;else if(AY==='-')X=1;else if(AY){const s=tables.soil[tables.soil.filter(s=>s.rho<W).length];X=s?(AY==='DUCT'?s.duct:s.direct):'Out of range';}}
 const AV:Num=typeof T==='number'&&typeof V==='number'&&typeof X==='number'?T*V*X*(v.Y??1)*(v.Z??1):'';
 const block=E!==undefined&&O&&P&&Q?blocks.get(`${E}|${O}|${P}|${Q}`):undefined;
 const rating=block&&AC!==undefined?block.rows.find(r=>r[0]===AC):undefined;
 const AA:Num=N===undefined||AV===''||AV<=0?'':N/AV;
 let AB:Cell='';
 if(block&&M!==''&&AV!==''&&F!==undefined&&F!==0){
  const limit=AM??1e99,upstream=typeof AT==='number'?AT:0;
  const fails=block.rows.filter(([,it,mv])=>xl(it*cables*AV)<xl(Math.max(M,N??0))||xl(upstream+M*(AH??0)*mv/(10*cables*F))>xl(limit)).length;
  AB=fails>=block.rows.length?'None passes':block.rows[fails]?.[0]??'';
 }
 const AE:Num=rating?rating[1]:'',AF:Num=AE===''||AV===''?'':AE*cables*AV;
 const AG:Cell=N===undefined||M===''||AF===''?'':xl(M)<=xl(N)&&xl(N)<=xl(AF)?'PASS':'FAIL';
 const AI:Num=rating?rating[2]:'',AJ:Num=M===''||AH===undefined||AI===''?'':M*AH*AI/(1000*cables);
 const AK:Num=AJ===''||F===undefined||F<=0?'':AJ/F*100,AL:Num=AK===''||AT===''?'':AK+Number(AT);
 const AN:Cell=AL===''||AM===undefined?'':xl(AL)<=xl(AM)?'PASS':'FAIL',AO:Num=M===''?'':M/cables;
 // Motor starting (step09): total VD at From + this cable's VD at the starting current, i.e. AL + (multiple − 1) × AK.
 const starter=t.BP??'',multiple=v.BQ??starters.get(starter.toLowerCase()),startLimit=v.BS??defaults.startVd??undefined;
 const BR:Num=!starter||AL===''||AK===''||multiple===undefined?'':AL+(multiple-1)*AK,BT:Cell=BR===''||startLimit===undefined?'':xl(BR)<=xl(startLimit)?'PASS':'FAIL';
 // The workbook turns these cells red through conditional formatting.
 const shown=(c:InputCol)=>t[c]??(v[c]===undefined?'':String(v[c])),lists=listOptions({E:shown('E'),O:O,P:P,Q:Q} as SheetRow);
 for(const c of ['B','E','F','O','P','Q','AD'] as const){const raw=shown(c);if(raw&&!lists[c].includes(raw))invalid[c]=LIST_ERROR;}
 if(AC!==undefined&&!rating)invalid.AC=LIST_ERROR;
 if(N!==undefined&&M!==''&&N<M)invalid.N='Protection rating In is below the design current Ib.';
 for(const c of ['AS','AW','BP'] as const){const raw=shown(c);if(raw&&!fixed[c].includes(raw))invalid[c]=LIST_ERROR;}
 if(t.AP&&!earthing(t.AP))invalid.AP=LIST_ERROR;
 const f=faultCells(v,t,AU,cables,up,feeds,v.BL===undefined&&p.invalid.BL===undefined);
 return {cells:{...f.cells,A,B:v.B??'',C:t.C??'',D:t.D??'',E:E??'',F:F??'',G:G??'',H:v.H??'',I:I??'',J,K,L:v.L??'',M,N:N??'',O,P,Q,R:v.R??'',S:v.S??'',T,U:v.U??'',V,W:v.W??'',X,Y:v.Y??'',Z:v.Z??'',AA,AB,AC:AC??'',AD:v.AD??'',AE,AF,AG,AH:AH??'',AI,AJ,AK,AL,AM:AM??'',AN,AO,BP:starter,BQ:v.BQ??'',BR,BS:v.BS??'',BT},invalid,source:block?.source??'',helpers:{AT,AU,AV,AW,AX,AY,fault:f.helpers}};
}

// Calculates the whole sheet. Total VD follows the workbook: the first row whose "To" matches this row's "From" is upstream.
// Cache key part for cells: strings quoted, numbers via String so NaN and Infinity stay distinct (JSON writes both as null).
export const keyOf=(...v:unknown[])=>v.map(x=>typeof x==='string'?JSON.stringify(x):String(x)).join('|');
// A row's result depends only on its inputs, item number, upstream feed and whether it feeds others, so results are cached:
// a keystroke re-evaluates only the edited row and the rows downstream of it (≈50 ms per key at 2,000 rows before).
const sheetMemo=new Map<string,RowResult>();
export function calculateSheet(rows:readonly SheetRow[]):RowResult[] {
 const results:RowResult[]=new Array(rows.length),state:number[]=new Array(rows.length).fill(0),items:Cell[]=[];
 let item=0;for(const r of rows)items.push(ITEM_COLS.some(c=>r[c].trim())?++item:'');
 const upstream=new Map<string,number>(),fed=new Set<string>();rows.forEach((r,i)=>{const d=r.D.trim().toLowerCase(),c=r.C.trim().toLowerCase();if(d&&!upstream.has(d))upstream.set(d,i);if(c)fed.add(c);});
 const resolve=(i:number):RowResult|null=>{
  if(state[i]===2)return results[i]??null;if(state[i]===1)return null;state[i]=1;
  const row=rows[i]!,from=row.C.trim().toLowerCase();let at:Cell='',loop=false,feed:Upstream|null=null;
  if(from){const u=upstream.get(from);if(u===undefined)at=0;else{const up=u===i?null:resolve(u);if(up){at=up.cells.AL;feed={AL:up.cells.AL,BB:up.cells.BB,BM:up.cells.BM,system:up.helpers.fault.system};}else loop=true;}}
  const feeds=fed.has(row.D.trim().toLowerCase()),key=`${JSON.stringify(row)}|${keyOf(items[i]??'',at,feed?.AL,feed?.BB,feed?.BM,feed?.system,feeds,loop)}`;
  let r=sheetMemo.get(key);
  if(!r){r=evaluate(parse(row),items[i]??'',at,feed,feeds);if(loop)r.invalid.C='This From/To chain loops back on itself, so total VD cannot be found.';if(sheetMemo.size>20000)sheetMemo.clear();sheetMemo.set(key,r);}
  state[i]=2;results[i]=r;return r;
 };
 rows.forEach((_,i)=>resolve(i));
 return results;
}
// Any FAIL among the workbook's checks: current, voltage drop, earth loop, CPC, breaking capacity, short circuit, motor starting VD.
export const CHECK_COLS=['AG','AN','BE','BG','BJ','BO','BT'] as const;
export const failsCheck=(r:RowResult)=>CHECK_COLS.some(c=>r.cells[c]==='FAIL');
export const calculateRow=(row:SheetRow):RowResult=>calculateSheet([row])[0]!;
// One row with a known upstream total VD (the AT helper column); used when the rest of the sheet is already settled.
export const evaluateRow=(row:SheetRow,upstreamVd:Cell,item:Cell=1,up:Upstream|null=null,feeds=false):RowResult=>evaluate(parse(row),item,upstreamVd,up,feeds);
