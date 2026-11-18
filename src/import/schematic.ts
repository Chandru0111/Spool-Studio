import {INPUT_COLS,TABLES,clip,emptyRow,isBlankRow,type InputCol,type SheetRow} from '../engine/sheet';
import {cleanValue,detectColumns,normalize,toSheetRows,type Mapping} from './load-list';
import type {Geometry} from './raster';

// Builds a load list from the text on electrical schematics: single-line diagrams, DB schematics and circuit schedules.
// Deterministic (no AI model): every value is read from drawing text. Values worked out rather than read (a voltage taken
// from the board, kW from HP, a feeder's summed load) are listed in `inferred` so the engineer reviews them first.
// Coordinates are page units with y pointing down; angle is degrees anticlockwise as seen on the sheet.
export type Token={text:string;x:number;y:number;h:number;w:number;angle:number;page:number;group?:string;attr?:string};
export type Inferred=Partial<Record<InputCol,string>>;
export type Candidate={row:SheetRow;page:number;kind:'circuit'|'feeder'|'table'|'block';evidence:string;inferred:Inferred;include:boolean};
export type SchematicResult={candidates:Candidate[];boards:string[];notes:string[]};
export const SCHEMATIC_LIMITS={tokens:100000,pageTokens:20000,pages:200,candidates:2000,dxfLines:12000000};

// Min/max without spreading (a crafted drawing can hold hundreds of thousands of values).
const least=(v:readonly number[],d=Infinity)=>v.reduce((m,x)=>x<m?x:m,d),most=(v:readonly number[],d=-Infinity)=>v.reduce((m,x)=>x>m?x:m,d);

// ---------- DXF (ASCII) ----------
const DXF_CODES:Record<string,string>={C:'Ø',D:'°',P:'±','%':'%'};
const dxfText=(s:string)=>s.replace(/\\U\+([0-9a-fA-F]{4})/g,(_,h:string)=>String.fromCodePoint(parseInt(h,16))).replace(/%%(\d{3})/g,(_,n:string)=>String.fromCharCode(+n)).replace(/%%([cdpCDP%])/g,(_,c:string)=>DXF_CODES[c.toUpperCase()]??'').replace(/%%[uUoOkK]/g,'');
// MTEXT inline formatting: \P paragraph, \S stacked fraction, \f font, \H height, {…} groups and the like.
const mtext=(s:string)=>dxfText(s.slice(0,20000)).replace(/\\\\/g,'\u0001').replace(/\\[{}]/g,m=>m===String.raw`\{`?'\u0002':'\u0003').replace(/\\P/g,'\n').replace(/\\S([^;^#/\\\n]{0,40})[\^#/]([^;\\\n]{0,40});/g,'$1/$2').replace(/\\[ACcFfHhQTWp][^;\n]*;/g,'').replace(/\\~/g,' ').replace(/\\[LlOoKkNX]/g,'').replace(/[{}]/g,'').replace(/\u0001/g,'\\').replace(/\u0002/g,'{').replace(/\u0003/g,'}');
export function dxfTokens(text:string):Token[] {
 if(/^AutoCAD Binary DXF/.test(text))throw Error('This is a binary DXF. Save it from CAD as an ASCII DXF, or print the drawing to PDF.');
 if(!/(^|\n)\s*0\s*\r?\n\s*SECTION\b/.test(text.slice(0,4096)))throw Error('This is not a DXF drawing (no SECTION header).');
 const out:Token[]=[],pages=new Map<string,number>(),WANT=new Set(['TEXT','MTEXT','ATTRIB','INSERT','SECTION','ENDSEC','SEQEND']);
 let at=0,lines=0,section='',insert='',insertPage=1,inserts=0,type='',codes:[number,string][]=[];
 const readLine=()=>{if(at>=text.length)return null;let end=text.indexOf('\n',at);if(end<0)end=text.length;const line=text.slice(at,end).replace(/\r$/,'');at=end+1;if(++lines>SCHEMATIC_LIMITS.dxfLines)throw Error('This DXF is too large to read safely. Purge unused content or export a PDF.');return line;};
 const num=(c:number,fallback=0)=>{const v=Number(codes.find(([k])=>k===c)?.[1]);return Number.isFinite(v)?v:fallback;};
 const str=(c:number)=>codes.find(([k])=>k===c)?.[1]??'';
 const pageOf=()=>{const key=str(410).trim()||(num(67)===1?'Paper space':'Model space');let p=pages.get(key);if(p===undefined){p=pages.size+1;pages.set(key,p);}return p;};
 const push=(t:Token)=>{if(out.length>=SCHEMATIC_LIMITS.tokens)throw Error(`The drawing has more than ${SCHEMATIC_LIMITS.tokens.toLocaleString('en')} text items. Split it into smaller drawings.`);out.push(t);};
 const flush=()=>{
  if(type==='SECTION'){section=str(2).trim();return;}if(type==='ENDSEC'){section='';return;}
  if(section!=='ENTITIES')return;
  if(type==='INSERT'){insert=num(66)===1?`dxf-${++inserts}`:'';insertPage=pageOf();return;}
  if(type==='SEQEND'){insert='';return;}
  if(type!=='ATTRIB')insert='';
  const h=Math.abs(num(40,2.5))||2.5,page=type==='ATTRIB'&&insert?insertPage:pageOf();
  if(type==='TEXT'||type==='ATTRIB'){
   const t=dxfText(str(1).slice(0,2000)).trim();if(!t)return;const angle=num(50),w=.6*h*t.length*(num(41,1)||1),just=num(72),r=angle*Math.PI/180;
   // Centred or right-justified text is placed by its second alignment point.
   let x=num(10),y=-num(20);if(just===1||just===2||just===4){const f=just===2?1:.5;x=num(11,x)-Math.cos(r)*w*f;y=-num(21,-y)+Math.sin(r)*w*f;}
   push({text:clip(t),x,y,h,w,angle,page,...(type==='ATTRIB'&&insert?{group:insert,attr:str(2).trim().toUpperCase()}:{})});return;
  }
  if(type==='MTEXT'){
   const raw=codes.filter(([k])=>k===3).map(([,v])=>v).join('')+str(1),dx=num(11,NaN),dy=num(21,NaN),angle=Number.isFinite(dx)&&Number.isFinite(dy)&&(dx||dy)?Math.atan2(dy,dx)*180/Math.PI:num(50),r=angle*Math.PI/180;
   const parts=mtext(raw).split('\n').slice(0,2000).map(s=>s.trim()),attach=num(71,1),wide=most(parts.map(s=>s.length),1)*.6*h,col=(attach-1)%3,rowPos=Math.floor((attach-1)/3);
   const gap=1.67*h,height=parts.length*gap,ox=-col*wide/2,oy=-rowPos*height/2;
   parts.forEach((s,k)=>{if(!s)return;const lx=ox,ly=oy+h+k*gap;push({text:clip(s),x:num(10)+lx*Math.cos(r)+ly*Math.sin(r),y:-num(20)-lx*Math.sin(r)+ly*Math.cos(r),h,w:.6*h*s.length,angle,page});});
  }
 };
 for(;;){
  const c=readLine();if(c===null)break;const v=readLine();if(v===null)break;const code=Number(c.trim());
  if(!Number.isInteger(code))throw Error(`This DXF file is damaged near line ${lines-1}.`);
  if(code===0){if(WANT.has(type))flush();type=v.trim();codes=[];continue;}
  if(WANT.has(type)&&codes.length<4000)codes.push([code,v]);
 }
 if(WANT.has(type))flush();
 return out;
}

// ---------- Text clean-up ----------
const rad=(a:number)=>a*Math.PI/180;
const finite=(t:Token)=>[t.x,t.y,t.h,t.w,t.angle].every(Number.isFinite);
// Joins characters or words that PDF/OCR/CAD split on the same baseline into one phrase. Attribute values stay separate.
export function mergeTokens(tokens:readonly Token[]):Token[] {
 const out:Token[]=[],groups=new Map<string,Token[]>();
 for(const raw of tokens){const text=raw.text.replace(/\s+/g,' ').trim();if(!text||!finite(raw))continue;const t={...raw,text:clip(text),h:raw.h>0?raw.h:1,w:raw.w>0?raw.w:.55*(raw.h>0?raw.h:1)*text.length};
  if(t.attr!==undefined){out.push(t);continue;}const k=`${t.page}|${Math.round(t.angle/5)*5}`;const g=groups.get(k);if(g)g.push(t);else groups.set(k,[t]);}
 for(const [key,list] of groups){
  const a=rad(Number(key.split('|')[1])),ux=Math.cos(a),uy=-Math.sin(a),nx=Math.sin(a),ny=Math.cos(a);
  const along=(t:Token)=>t.x*ux+t.y*uy,across=(t:Token)=>t.x*nx+t.y*ny;
  let line:Token[]=[];
  const flush=()=>{line.sort((p,q)=>along(p)-along(q));let cur:Token|null=null;
   for(const t of line){if(cur){const c:Token=cur,gap:number=along(t)-(along(c)+c.w),h:number=Math.max(c.h,t.h);if(gap<=.7*h&&gap>=-.6*h&&h<=1.6*Math.min(c.h,t.h)&&c.text.length<300){cur={...c,text:clip(c.text+(gap>.2*h&&!/[-/.]$/.test(c.text)&&!/^[-/.]/.test(t.text)?' ':'')+t.text),w:along(t)+t.w-along(c),h};continue;}out.push(c);}cur=t;}
   if(cur)out.push(cur);line=[];};
  for(const t of [...list].sort((p,q)=>across(p)-across(q))){if(line.length&&Math.abs(across(t)-across(line[0]!))>.4*Math.max(t.h,line[0]!.h))flush();line.push(t);}
  flush();
 }
 return out;
}

// ---------- What one piece of text says ----------
type Facts={curve?:number|undefined;lengthNote?:string|undefined;imperial?:boolean|undefined;threePhaseSets?:boolean|undefined;src?:boolean|undefined;kw?:number|undefined;fromHp?:boolean|undefined;kva?:number|undefined;amps?:number|undefined;device?:boolean|undefined;phase?:'1'|'3'|undefined;volts:number[];dc?:boolean|undefined;cores?:string|undefined;size?:string|undefined;sets?:number|undefined;type?:string|undefined;typeNote?:string|undefined;length?:number|undefined;pf?:number|undefined;div?:number|undefined;tx?:boolean|undefined;tags:string[];fedFrom?:string|undefined;feedsTo?:string|undefined;spare?:boolean|undefined;total?:number|undefined;circuit?:string|undefined;title?:boolean|undefined;words:number};
const BOARDS=new Set(['BUS','BUSBAR','SWGR','SWITCHGEAR','MSB','SMSB','EMSB','ESMSB','MDB','SMDB','EMDB','ESMDB','SDB','EDB','LDB','PDB','LPDB','PPDB','FDB','ACDB','DCDB','DB','MCC','EMCC','PCC','LP','PP','DP','PB','SSB','ESB','LVSB','LVP','SWB','SWBD','SB','PNL','PANEL','BOARD','CP','MCP','LCP','MDP','DSB','UPS','ATS','AMF','BD','MLDB','MPDB','LDP','PDP','TX','TR','XFMR','TRAFO','GEN','GENSET','DG']);
const SOURCES=new Set(['TX','TR','XFMR','TRAFO','XFR','TRF','WTR','GSU','UAT','GEN','GENSET','DG','GTG','STG','WTG']);
const ALONE=new Set(['MSB','SMSB','EMSB','MDB','SMDB','EMDB','MCC','PCC','LVSB','SWBD','ATS','AMF','GENSET']);
const STOP=/^(?:L[1-3]|N\d?|PE\d*|E\d{1,3}|[QFKXSTHUW]\d{1,3}|[BCDKZ]\d{1,3}|IP\d{2}|IK\d{2}|AC\d{1,2}|DC\d{1,2}|CAT\d|MM2|SQMM|M\d{2}|PH\d|[RYB]\d|KW|KVA|HP|NO\d*|REV[A-Z0-9]*|DWG\d*)$/;
const lead=(tag:string)=>tag.match(/^\d?([A-Z]+)/)?.[1]??'';
const NOT_LOAD=new Set(['CBL','CAB','CABLE','CB','W','WL','CCT','CKT','WAY','QF','QS','QM','FU','KM','DWG','DRG','REF','FIG','SHT','PG','REV','ITEM']);
export const isBoardTag=(tag:string)=>BOARDS.has(lead(tag))||/^(?:PANEL|BOARD|BUS|BUSBAR|SWGR|SWITCHGEAR) /i.test(tag)||/^BUS[A-Z0-9]{1,2}$/i.test(tag);
const isSource=(tag:string)=>SOURCES.has(lead(tag));
function tagsIn(U:string):string[] {
 const out:string[]=[];for(const m of U.matchAll(/\b(PANEL|BOARD|BUS|BUSBAR|SWGR|SWITCHGEAR)\s+([A-Z]{1,2}\d{0,3}|\d{1,3})\b/g))out.push(`${m[1]} ${m[2]}`);
 for(const raw of U.split(/[\s,;()[\]]+/)){const w=raw.replace(/[.:]+$/,'');if(!w||w.length>24||STOP.test(w)||NOT_LOAD.has(lead(w)))continue;
  // ETAP/SKM style tags use a colon (TR:4, 3WTR:1); OCR can drop the space in "Bus A".
  const sep=/^\d?[A-Z][A-Z0-9]{0,7}(?:[-_.:][A-Z0-9]{1,8}){1,4}$/.test(w),plain=/^[A-Z]{1,6}\d{1,4}[A-Z]?$/.test(w)||/^BUS[A-Z0-9]{1,2}$/.test(w);
  if(sep&&(/\d/.test(w)||BOARDS.has(lead(w)))||plain||ALONE.has(w))out.push(w);}
 return [...new Set(out)];
}
const TYPES=[...new Set(TABLES.cableTypes.map(t=>t.type))],CORES=new Set(TABLES.cores.map(c=>c.cores));
const typeKey=(s:string)=>s.toLowerCase().replace(/\s+/g,'');
const PART:Record<string,string>={CU:'Cu',AL:'Al',LS0H:'LSOH',LSZH:'LSOH'};
const TITLE=/\b(?:DRAWING|DRG|TITLE|SCALE|CHECKED|APPROVED|DRAWN|DESIGNED|CLIENT|CONSULTANT|CONTRACTOR|PROJECT|SHEET|REVISION|DATE|N\.?T\.?S|LEGEND|NOTES?)\b/;
export function readFacts(raw:string):Facts {
 // PDF readers sometimes put a space after a hyphen inside a tag ("UPS- 1"); close it up. OCR reads a breaker square
 // drawn against its rating as brackets and a stray letter ("[J100A"); drop them.
 const U=raw.toUpperCase().replace(/²/g,'2').replace(/[×✕]/g,'X').replace(/[ΦφØø]/g,'PH').replace(/\s+/g,' ').replace(/([A-Z0-9])-\s+(?=[A-Z0-9])/g,'$1-').replace(/(^|\s)[[\](){}|!]+[A-Z]?(?=\d)/g,'$1').trim(),f:Facts={volts:[],tags:[],words:(raw.match(/[A-Za-z]{3,}/g)??[]).length};
 const n=(s:string|undefined)=>s===undefined?undefined:Number(s);
 f.title=TITLE.test(U);f.spare=/\b(?:SPARE|SPACE|RESERVED?|FUTURE|VACANT)\b/.test(U);
 const total=U.match(/\b(?:TOTAL|CONNECTED|MAX(?:IMUM)?\.?\s*DEMAND|DEMAND)\b[^0-9]{0,20}(\d+(?:\.\d+)?)\s*KW\b/);
 if(total)f.total=n(total[1]);
 else{const kw=U.match(/(?<![\w.])(\d+(?:\.\d+)?)\s*KW\b/),hp=U.match(/(?<![\w.])(\d+(?:\.\d+)?)\s*B?HP\b/),w=U.match(/(?<![\w.])(\d+(?:\.\d+)?)\s*W\b/);
  const mw=U.match(/(?<![\w.])(\d+(?:\.\d+)?)\s*MW\b/);
  if(kw)f.kw=n(kw[1]);else if(mw)f.kw=Number(mw[1])*1000;else if(hp){f.kw=+(Number(hp[1])*.7457).toPrecision(6);f.fromHp=true;}else if(w&&Number(w[1])>=10&&!/PH|WIRE|HZ/.test(U))f.kw=Number(w[1])/1000;}
 const kva=U.match(/(?<![\w.])(\d+(?:\.\d+)?)\s*KVA\b/),mva=U.match(/(?<![\w.])(\d+(?:\.\d+)?)\s*MVA\b/);if(kva)f.kva=n(kva[1]);else if(mva)f.kva=Number(mva[1])*1000;
 f.src=/\b(?:GENERATOR|GEN|GTG|STG|WTG|WIND TURBINE|SOLAR|PV ARRAY|PHOTOVOLTAIC|GRID|UTILITY|MAINS SUPPLY)\b/.test(U);
 f.tx=/\b(?:TX|TR|TRANSFORMER|XFMR|TRAFO)\b|\b\d?(?:TX|TR|WTR|GSU|UAT|XFR)[-_.:]?\d/.test(U);
 for(const m of U.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)\s*(?:AMPS?|AT?)\b/g)){if(/(?:FLC|FLA|IB|IZ|LRA|ISC|ICU|ICS|IK|IFL|IR|IST)\s*[=:]?\s*$/.test(U.slice(Math.max(0,(m.index??0)-6),m.index)))continue;f.amps=n(m[1]);break;}
 f.device=/\b(?:MCCB|MCB|ACB|RCBO|RCCB|ELCB|VCB|HRC|FUSES?|FUSED|BREAKER|CB|MPCB|SFU|FSU)\b/.test(U);
 if(f.amps===undefined){const keyed=/\b(?:MCB|RCBO)\b/.test(U)?U.match(/\b[BCDKZ]\s?(\d{1,3})\b/):null,bare=U.match(/^[BCDKZ]\s?(\d{1,3})(?:\s*A)?$/);if(keyed){f.amps=n(keyed[1]);f.device=true;}else if(bare)f.curve=n(bare[1]);}
 const end='(?![-_\\w]|\\.\\d)';
 if(new RegExp(`\\b(?:TPN|TP&N|TPNE|TP|3P(?:\\+N)?|4P|3 ?PH(?:ASE)?|THREE PHASE)${end}`).test(U))f.phase='3';
 else if(new RegExp(`\\b(?:SPN|SP&N|SPNE|SP|1P(?:\\+N)?|2P|DP|1 ?PH(?:ASE)?|SINGLE PHASE)${end}`).test(U))f.phase='1';
 // Cable insulation ratings such as 0.6/1 kV or 450/750 V are not system voltages.
 const V=U.replace(/\b0\.6\s*\/\s*1(?:\.0)?\s*KV\b|\b(?:450\s*\/\s*750|300\s*\/\s*500|600\s*\/\s*1000)\s*V\b/g,' ');
 const pair=V.match(/(?<![\w.])(\d{2,3})\s*V?\s*\/\s*(\d{2,3})\s*V\b/);
 if(pair)f.volts.push(Number(pair[1]),Number(pair[2]));else for(const m of V.matchAll(/(?<![\w./])(\d+(?:\.\d+)?)\s*(K?)V(?:AC|DC)?\b/g))if(f.volts.length<4)f.volts.push(Number(m[1])*(m[2]?1000:1));
 f.dc=/\d\s*V\s*DC\b|\bVDC\b|\bDC\s+(?:SUPPLY|SYSTEM|BOARD)\b/.test(U);
 const ct=U.match(/\b(?:(CU|AL)\s*\/\s*)?(XLPE|PVC|EPR|LSZH|LSOH|LS0H)((?:\s*\/\s*(?:SWA|AWA|STA|PVC|LSOH|LSZH|LS0H|PE|MDPE|CT|XLPE))*)/);
 if(ct&&(ct[1]||ct[3])){
  const parts=[ct[1],ct[2],...(ct[3]??'').split('/').map(s=>s.trim()).filter(Boolean)].filter((p):p is string=>!!p).map(p=>PART[p]??p);let name=parts.join('/');
  if(name==='Cu/PVC'||name==='PVC'){if(/450\s*\/\s*750/.test(U))name=`${name} (450/750V)`;else if(/0\.6\s*\/\s*1(?:\.0)?\s*KV/.test(U))name=`${name} (0.6/1kV)`;}
  const exact=TYPES.find(t=>typeKey(t)===typeKey(name)),cu=ct[1]?undefined:TYPES.find(t=>typeKey(t)===typeKey(`Cu/${name}`));
  if(exact)f.type=exact;else if(cu){f.type=cu;f.typeNote='conductor not stated; copper assumed';}else f.type=name;
  if(/LSZH/.test(ct[0]))f.typeNote=[f.typeNote,'LSZH read as LSOH'].filter(Boolean).join('; ');
 }
 // US notation: "6-1/C 500" is six single-conductor 500 kcmil cables (two sets of three); "3/0" is AWG.
 const us=U.match(/(?<![\w.])(\d{1,2})\s*[-–—_]\s*([13])\s*\/\s*C\s+(\d{1,4}(?:\/0)?)(?:\s*(KCMIL|MCM|AWG))?/);
 if(us){const count=Number(us[1]),per=Number(us[2]),size=us[3]!,unit=us[4]==='AWG'||size.includes('/')||Number(size)<=40?'AWG':'kcmil';f.cores=`${per}C`;f.size=`${size} ${unit}`;f.imperial=true;
  if(per===1&&count%3===0){f.sets=count/3;f.threePhaseSets=true;}else if(per===3)f.sets=count;}
 const set=us?null:U.match(/(?<![\w.])(\d{1,2})\s*X\s*\(/)??U.match(/(?<![\w.])(\d{1,2})\s*(?:SETS?|RUNS?|NOS?\.?)\b/)??U.match(/(?<![\w.])(\d{1,2})\s*X\s*([2-9]|\d{2})\s*C\b/);if(set&&Number(set[1])>=1&&Number(set[1])<=10)f.sets=Number(set[1]);
 const single=U.match(/(?<![\w.])\d{1,2}\s*X\s*1\s*C\s*X?\s*(\d{1,4}(?:\.\d+)?)/),cs=U.match(/(?<![\w.])(\d{1,2})\s*(?:C|CORES?|\/C)\s*(?:X\s*)?(\d{1,4}(?:\.\d+)?)\s*(?:MM2|SQ\.?\s?MM|SQMM|MM)?(?![\w.])/),nx=U.match(/(?<![\w.(+])([1-5])\s*X\s*(\d{1,4}(?:\.\d+)?)\s*(?:MM2|SQ\.?\s?MM|SQMM)(?!\w)/),reduced=U.match(/(?<![\w.(+])[1-4]\s*X\s*(\d{1,4}(?:\.\d+)?)(?=\s*(?:MM2|SQMM)?\s*\+\s*\d)/);
 if(us){/* read above */}else if(single){f.cores='1C';f.size=single[1];}else if(cs&&CORES.has(`${cs[1]}C`)){f.cores=`${cs[1]}C`;f.size=cs[2];}else if(nx){f.cores=`${nx[1]}C`;f.size=nx[2];}else if(reduced)f.size=reduced[1];
 else{const c=U.match(/(?<![\w.])(\d{1,2})\s*(?:C|CORES?)(?![\w])/);if(c&&CORES.has(`${c[1]}C`))f.cores=`${c[1]}C`;
  for(const m of U.matchAll(/(?<![\w.+])(\d{1,4}(?:\.\d+)?)\s*(?:MM2|SQ\.?\s?MM|SQMM)(?!\w)/g)){const i=m.index??0,before=U.slice(Math.max(0,i-6),i),after=U.slice(i+m[0].length,i+m[0].length+5);if(/(?:\bE|CPC|ECC|PE|EARTH|\bG)\s*[:=]?\s*$/.test(before)||/^\s*(?:E\b|CPC|ECC|EARTH)/.test(after))continue;f.size=m[1];break;}}
 const L=U.match(/(?:\bL\s*[=:]|\bLENGTH\b\s*[=:]?|\bRUN\b\s*[=:]?|\bAPPROX\.?)\s*(\d+(?:\.\d+)?)\s*(KM|M|FT|FEET|MILES?)\b/)??U.match(/(?<![\w.])(\d+(?:\.\d+)?)\s*(M|METRES?|METERS?|MTRS?|KM|FT|FEET|MILES?)\b/);
 // Feet and miles become metres; the review shows the drawing's own figure.
 if(L){const unit=L[2]!,v=Number(L[1]),k=unit==='KM'?1000:/^F/.test(unit)?.3048:/^MILE/.test(unit)?1609.344:1;f.length=+(v*k).toPrecision(6);if(k!==1&&k!==1000)f.lengthNote=`converted from ${v} ${/^F/.test(unit)?'ft':'mile'}`;}
 const pf=U.match(/(?:\bPF|\bP\.F\.?|\bCOS\s*(?:PHI?)?)\s*[=:]?\s*(0?\.\d+|1(?:\.0+)?)(?!\d)/);if(pf)f.pf=Number(pf[1]);
 const df=U.match(/(?:\bDF|\bDIVERSITY(?:\s*FACTOR)?|\bDEMAND\s*FACTOR|\bUF)\s*[=:]?\s*(0?\.\d+|1(?:\.0+)?|\d{1,3}\s*%)/);if(df)f.div=df[1]!.includes('%')?parseFloat(df[1]!)/100:Number(df[1]);
 const ckt=U.match(/\b(?:CKT|CCT|CIRCUIT|WAY)\s*(?:NO\.?)?\s*[:#.]?\s*([A-Z]?\d{1,3}[A-Z]?)\b/);if(ckt)f.circuit=ckt[1];
 const fed=U.match(/\b(?:FED|SUPPLIED|SUPPLY|INCOMING|FEED)\s+(?:FROM|FRM|EX)\b\s*[:-]?\s*(.*)$/);
 const own=fed?U.slice(0,fed.index):U;if(fed)f.fedFrom=tagsIn(fed[1]??'')[0];
 const to=own.match(/\b(?:FEEDER\s+TO|FEEDS|SUPPLY\s+TO|TO)\s+(.*)$/);if(to){const t=tagsIn(to[1]??'')[0];if(t&&isBoardTag(t))f.feedsTo=t;}
 f.tags=tagsIn(own).map(t=>{const at=raw.toUpperCase().indexOf(t);return at>=0?raw.slice(at,at+t.length):t;});
 return f;
}

// ---------- Circuit schedules drawn as tables ----------
type Placed=Token&{cx:number;cy:number;f:Facts;used:boolean};
const median=(v:readonly number[])=>{const s=[...v].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]!:1;};
const place=(t:Token):Placed=>{const r=rad(t.angle),c=Math.cos(r),s=Math.sin(r);return {...t,cx:t.x+c*t.w/2-s*t.h/2,cy:t.y-s*t.w/2-c*t.h/2,f:readFacts(t.text),used:false};};
type Draft={raw:Partial<Record<InputCol,string>>;inferred:Inferred;page:number;kind:Candidate['kind'];evidence:string;fromSet:boolean;start:[number,number];circuit?:string;optional?:boolean};
const CABLE_HEAD=/cable|conductor|wiring|feeder/,NOT_CABLE=/length|run|size|type|core|no|qty|ref/;
const NUMERIC=/^[+-]?\d+(?:\.\d+)?$/;
// Cable descriptions like "4C x 35mm² Cu/XLPE/SWA/PVC" in one cell become cable type, cores, size and parallel sets.
function cableCells(text:string,raw:Draft['raw'],inferred:Inferred):void {
 const f=readFacts(text);if(f.type&&!raw.O){raw.O=f.type;if(f.typeNote)inferred.O=f.typeNote;}if(f.cores&&!raw.P)raw.P=f.cores;if(f.size)raw.AC=f.size;if(f.sets&&!raw.AD)raw.AD=String(f.sets);
}
// Schedule cells often carry units or device text ("63A TPN MCCB", "20 HP"): keep the number the column asks for.
function rescue(col:InputCol,text:string,raw:Draft['raw'],inferred:Inferred):void {
 const f=readFacts(text),set=(c:InputCol,v:number|string|undefined)=>{if(v!==undefined&&(!raw[c]||!NUMERIC.test(raw[c]!)))raw[c]=String(v);};
 if(col==='N'){set('N',f.amps);if(f.phase&&!raw.E)raw.E=f.phase;}else if(col==='G'){set('G',f.kw);if(f.fromHp&&raw.G===String(f.kw))inferred.G='converted from HP (1 HP = 0.7457 kW)';}
 else if(col==='AH')set('AH',f.length);else if(col==='F')set('F',f.volts.length===1?f.volts[0]:undefined);else if(col==='I')set('I',f.pf);else if(col==='H')set('H',f.div);else if(col==='E'&&f.phase)raw.E=f.phase;
}
const flat=(t:Placed)=>{const a=((t.angle%360)+360)%360;return a<5||a>355;};
function lineGroups(items:Placed[]):Placed[][] {
 const out:Placed[][]=[];
 for(const t of items.filter(flat).sort((a,b)=>a.cy-b.cy)){const line=out[out.length-1];if(line&&Math.abs(t.cy-line[0]!.cy)<=.6*Math.max(t.h,line[0]!.h))line.push(t);else out.push([t]);}
 return out.map(l=>l.sort((a,b)=>a.cx-b.cx));
}
type Head={x:number;w:number;text:string;cells:Placed[]};
function tables(items:Placed[],page:number):Draft[] {
 const lines=lineGroups(items),drafts:Draft[]=[];let i=0;
 const score=(m:Mapping)=>{const k=Object.keys(m);return (m.D!==undefined||m.C!==undefined)&&k.some(c=>['G','N','AC','AH','I','E','F'].includes(c))?k.length:0;};
 while(i<lines.length){
  const one=lines[i]!,next=lines[i+1],two=next&&Math.abs(next[0]!.cy-one[0]!.cy)<=2.6*median(one.map(t=>t.h))?next:null;
  // Headers may wrap onto a second line ("Load" over "(kW)"): join cells that sit above one another.
  const joined=two?[...one,...two].sort((a,b)=>a.cx-b.cx).reduce<Head[]>((acc,t)=>{const last=acc[acc.length-1];if(last&&Math.abs(t.cx-last.x)<=Math.max(last.w,t.w)/2){last.cells.push(t);last.text=[...last.cells].sort((p,q)=>p.cy-q.cy||p.cx-q.cx).map(c=>c.text).join(' ');}else acc.push({x:t.cx,w:t.w,text:t.text,cells:[t]});return acc;},[]):null;
  const head1:Head[]=one.map(t=>({x:t.cx,w:t.w,text:t.text,cells:[t]})),m1=detectColumns(head1.map(h=>h.text)),m2=joined?detectColumns(joined.map(h=>h.text)):{},use2=!!joined&&!!two&&score(m2)>Math.max(score(m1),score(detectColumns(two.map(t=>t.text))));
  const head=use2&&joined?joined:head1,mapping=use2?m2:m1;
  if(score(mapping)<3){i++;continue;}
  const cols=head.map(h=>h.x),hh=median(head.flatMap(h=>h.cells.map(c=>c.h))),minGap=least(cols.slice(1).map((x,k)=>x-cols[k]!)),reach=Math.max(Math.min(minGap*.6,12*hh),2*hh);
  const cableCol=head.findIndex(h=>CABLE_HEAD.test(normalize(h.text))&&!NOT_CABLE.test(normalize(h.text))),headerCells=head.map(h=>h.text),found:Draft[]=[],used:Placed[]=head.flatMap(h=>h.cells);
  let j=i+(use2?2:1),last=(use2&&two?two:one)[0]!.cy,pitch=0;
  while(j<lines.length){
   const line=lines[j]!,gap=line[0]!.cy-last;if(gap>Math.max(4*hh,pitch?3*pitch:0))break;
   const cells=head.map(()=>[] as Placed[]);let hits=0;
   for(const t of line){let best=-1,d=Infinity;cols.forEach((x,k)=>{const e=Math.abs(t.cx-x);if(e<d){d=e;best=k;}});if(best>=0&&d<=Math.max(reach,(t.w+head[best]!.w)/2)){cells[best]!.push(t);hits++;}}
   if(hits<2||score(detectColumns(line.map(t=>t.text)))>=3)break;
   for(const t of line)used.push(t);pitch=pitch?Math.min(pitch,gap):gap;last=line[0]!.cy;j++;
   const texts=cells.map(c=>c.map(t=>t.text).join(' ')),[row]=toSheetRows([headerCells,texts],0,mapping);
   if(!row||line.some(t=>t.f.spare)&&!row.G)continue;
   const raw:Draft['raw']={},inferred:Inferred={};for(const c of INPUT_COLS)if(row[c])raw[c]=row[c];
   for(const [c,k] of Object.entries(mapping) as [InputCol,number][])rescue(c,texts[k]??'',raw,inferred);
   if(cableCol>=0)cableCells(texts[cableCol]??'',raw,inferred);if(mapping.AC!==undefined&&raw.AC&&!NUMERIC.test(raw.AC))cableCells(texts[mapping.AC]??'',raw,inferred);
   found.push({raw,inferred,page,kind:'table',evidence:clip(texts.filter(Boolean).join(' | ')),fromSet:!!raw.C,start:[head[0]!.x,head[0]!.cells[0]!.cy]});
  }
  if(found.length){for(const t of used)t.used=true;for(const d of found)drafts.push(d);i=j;}else i++;
 }
 return drafts;
}

// ---------- Single-line diagrams: annotations grouped around each outgoing breaker ----------
type Band={members:Placed[];anchor:Placed|null;start:[number,number];col:boolean|null};
const MAX_ANCHORS=4000,MAX_TITLES=500;
function bands(items:Placed[],page:number):{bands:Band[];loose:Placed[]} {
 const free=items.filter(t=>!t.used&&!t.f.title),h=median(free.map(t=>t.h))||1,anchors=free.filter(t=>t.f.amps!==undefined&&!t.f.tx);
 if(anchors.length>MAX_ANCHORS)throw Error(`Page ${page} has more than ${MAX_ANCHORS.toLocaleString('en')} breaker ratings. Split the drawing.`);
 if(anchors.length>=2){
  const group=(key:(t:Placed)=>number)=>{const out:Placed[][]=[];for(const a of [...anchors].sort((p,q)=>key(p)-key(q))){const g=out[out.length-1];if(g&&key(a)-key(g[g.length-1]!)<=1.5*h)g.push(a);else out.push([a]);}return out;};
  const byRow=group(t=>t.cy),byCol=group(t=>t.cx),score=(gs:Placed[][])=>gs.filter(g=>g.length>1).reduce((s,g)=>s+g.length,0),col=score(byRow)>=score(byCol);
  // col: circuits hang below a horizontal busbar, one band per breaker across x. row: the same turned through 90°.
  const along=(t:Placed)=>col?t.cx:t.cy,across=(t:Placed)=>col?t.cy:t.cx;
  const lines=(col?byRow:byCol).map(g=>{const kept:Placed[]=[];for(const a of [...g].sort((p,q)=>along(p)-along(q))){const prev=kept[kept.length-1];if(prev&&along(a)-along(prev)<2.5*h){if(a.f.device&&!prev.f.device)kept[kept.length-1]=a;continue;}kept.push(a);}
   const pos=kept.reduce((n,a)=>n+across(a),0)/kept.length,edges=kept.map((a,k)=>{const prev=kept[k-1],next=kept[k+1],half=next?(along(next)-along(a))/2:prev?(along(a)-along(prev))/2:6*h;return [prev?(along(prev)+along(a))/2:along(a)-half,next?(along(a)+along(next))/2:along(a)+half] as [number,number];});
   return {kept,pos,edges,lo:edges[0]![0],hi:edges[edges.length-1]![1],up:3*h,bottom:Infinity};}).sort((a,b)=>a.pos-b.pos);
  for(const [k,l] of lines.entries()){const above=lines.slice(0,k).filter(m=>m.hi>l.lo&&m.lo<l.hi).pop();if(above)l.up=Math.min(l.up,(l.pos-above.pos)/2);}
  for(const [k,l] of lines.entries()){const below=lines.slice(k+1).find(m=>m.hi>l.lo&&m.lo<l.hi);l.bottom=Math.min(below?below.pos-below.up:Infinity,l.pos+(col?60:150)*h);}
  const out:Band[]=lines.flatMap(l=>l.kept.map(a=>({members:[a],anchor:a,start:(col?[l.lo,l.pos]:[l.pos,l.lo]) as [number,number],col})));
  const index=new Map<Placed,Band>(out.map(b=>[b.anchor!,b])),loose:Placed[]=[];
  for(const t of free){if(index.has(t))continue;let best:Band|undefined,depth=Infinity;
   for(const l of lines){const d=across(t)-l.pos;if(d<-l.up||across(t)>=l.bottom||along(t)<l.lo||along(t)>=l.hi||d>=depth)continue;
    // Board names above the busbar (left of it when turned) are titles, not loads.
    if(d<-.5*h&&t.f.tags.some(isBoardTag)&&t.f.kw===undefined&&t.f.amps===undefined)continue;
    const k=l.edges.findIndex(([lo,hi])=>along(t)>=lo&&along(t)<hi),a=l.kept[k];if(a){best=index.get(a);depth=d;}}
   if(best)best.members.push(t);else loose.push(t);}
  return {bands:out,loose};
 }
 // Fewer than two breaker ratings: group annotations that sit close together (each grid cell checks a bounded number of neighbours).
 const parent=free.map((_,k)=>k),find=(k:number):number=>{while(parent[k]!==k){parent[k]=parent[parent[k]!]!;k=parent[k]!;}return k;},cell=new Map<string,number[]>(),size=4*h;
 free.forEach((t,k)=>{const gx=Math.floor(t.cx/size),gy=Math.floor(t.cy/size);for(let dx=-2;dx<=2;dx++)for(let dy=-1;dy<=1;dy++)for(const o of (cell.get(`${gx+dx},${gy+dy}`)??[]).slice(0,64)){const u=free[o]!;if(Math.abs(u.cx-t.cx)<=6*h&&Math.abs(u.cy-t.cy)<=2.5*h)parent[find(o)]=find(k);}const key=`${gx},${gy}`,c=cell.get(key);if(c)c.push(k);else cell.set(key,[k]);});
 const clusters=new Map<number,Placed[]>();free.forEach((t,k)=>{const r=find(k),c=clusters.get(r);if(c)c.push(t);else clusters.set(r,[t]);});
 const out:Band[]=[],loose:Placed[]=[];
 for(const members of clusters.values()){if(members.some(t=>t.f.kw!==undefined||t.f.amps!==undefined||t.f.size!==undefined)){out.push({members,anchor:members.find(t=>t.f.amps!==undefined)??null,start:[least(members.map(t=>t.cx)),least(members.map(t=>t.cy))],col:null});}else loose.push(...members);}
 return {bands:out,loose};
}
const dist=(a:readonly [number,number],t:Placed)=>Math.hypot(a[0]-t.cx,a[1]-t.cy);
function circuit(b:Band,page:number,traced:'down'|'up'|false=false):Draft|null {
 const a=b.anchor,origin:[number,number]=a?[a.cx,a.cy]:b.start,m=[...b.members].sort((p,q)=>dist(origin,p)-dist(origin,q)),first=<K extends keyof Facts>(k:K)=>m.find(t=>t.f[k]!==undefined)?.f[k];
 const raw:Draft['raw']={},inferred:Inferred={},kw=first('kw'),kva=first('kva'),pf=first('pf');
 if(m.some(t=>t.f.spare)&&kw===undefined)return null;
 const amps=(m.find(t=>t.f.device&&t.f.amps!==undefined)??a??m.find(t=>t.f.amps!==undefined))?.f.amps;
 if(kw!==undefined){raw.G=String(kw);if(m.find(t=>t.f.kw!==undefined)?.f.fromHp)inferred.G='converted from HP (1 HP = 0.7457 kW)';}
 else if(kva!==undefined&&pf!==undefined&&!m.some(t=>t.f.tx)){raw.G=String(+(kva*pf).toPrecision(6));inferred.G='kVA × PF from the drawing';}
 if(amps!==undefined)raw.N=String(amps);if(pf!==undefined)raw.I=String(pf);const div=first('div');if(div!==undefined)raw.H=String(div);
 const phase=first('phase'),volts=m.find(t=>t.f.volts.length)?.f.volts;if(phase)raw.E=phase;if(volts?.length===1)raw.F=String(volts[0]);
 const type=m.find(t=>t.f.type),cores=first('cores'),size=first('size'),sets=first('sets'),length=first('length');
 if(type?.f.type){raw.O=type.f.type;if(type.f.typeNote)inferred.O=type.f.typeNote;}if(cores)raw.P=cores;if(size)raw.AC=size;if(sets!==undefined)raw.AD=String(sets);
 if(length!==undefined){raw.AH=String(length);const note=m.find(t=>t.f.length!==undefined)?.f.lengthNote;if(note)inferred.AH=note;}
 if(!raw.E&&m.some(t=>t.f.threePhaseSets)){raw.E='3';inferred.E='single-core cables drawn in sets of three';}
 // Destination: an explicit "TO …", the tag beside the load, a downstream board, the last tag, else a description.
 const fedFrom=m.map(t=>t.f.fedFrom).filter((x):x is string=>!!x),tags=m.flatMap(t=>t.f.tags).filter(t=>!fedFrom.includes(t)&&!isSource(t)),loadTok=m.find(t=>t.f.kw!==undefined);
 const to=first('feedsTo')??loadTok?.f.tags.find(t=>!fedFrom.includes(t)&&!isSource(t))??tags.find(isBoardTag)??tags[tags.length-1];
 // On a traced feeder the label nearest the far end names it (a load, or the source of an incomer); elsewhere the tag
 // beside the load or the longest description wins.
 const unit=/^(?:M?VA(?:SC)?|K[VW]A?|[KM]W|HP|KV|FT|MM2?|SQMM|AMPS?|VOLTS?|HZ|MILES?)$/i,label=(t:Placed)=>t.f.words>0&&!t.text.includes('%')&&!unit.test(t.text.trim())&&t.f.kw===undefined&&t.f.kva===undefined&&t.f.amps===undefined&&t.f.length===undefined&&t.f.size===undefined&&!t.f.volts.length&&t.f.pf===undefined&&!t.f.cores;
 // An incomer is named after its source (generator, grid, solar) when one is labelled, else the nearest tag or label.
 // A label written along the feeder line (vertical text centred on it) is the strongest sign of which load it names.
 const along=(t:Placed)=>Math.abs(Math.abs(t.angle)-90)<5&&Math.abs(t.cx-origin[0])<=1.5*t.h,ranked=traced?[...m].sort((p,q)=>dist(origin,p)-(along(p)?3*p.h:0)-dist(origin,q)+(along(q)?3*q.h:0)):m;
 const named=traced==='up'&&ranked.find(t=>t.f.src&&label(t))||(traced?ranked.find(t=>t.f.tags.some(x=>traced==='up'||!isSource(x))||label(t)):undefined);
 if(named)raw.D=named.f.tags.find(x=>traced==='up'||!isSource(x))??clip(named.text.replace(/^[\s&]+|[\s&]+$/g,'').slice(0,60));
 else if(to)raw.D=to;else{const desc=m.filter(t=>!t.f.tags.length&&t.f.words>0&&!/\d/.test(t.text)).sort((p,q)=>q.f.words-p.f.words)[0];if(desc)raw.D=clip(desc.text.slice(0,60));}
 if(!traced&&!raw.G&&!(raw.N&&(raw.D||raw.AC))&&!(raw.D&&raw.AC))return null;
 // An incomer drawn with its board ("DB-1 fed from MSB") is the feeder MSB → DB-1.
 const feeder=!!raw.D&&isBoardTag(raw.D),ckt=first('circuit');if(feeder&&fedFrom[0]&&fedFrom[0]!==raw.D)raw.C=fedFrom[0];
 return {raw,inferred,page,kind:feeder?'feeder':'circuit',evidence:clip(m.map(t=>t.text).join(' · ')),fromSet:!!raw.C,start:b.start,...(ckt?{circuit:ckt}:{})};
}

// ---------- Traced line work: one row per feeder hanging from a busbar ----------
const segDist=(p:[number,number],a:[number,number],b:[number,number])=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
type TracedBus={name:string;volts:number[];named:boolean};
function tracedRows(items:Placed[],g:Geometry,page:number):{drafts:Draft[];buses:TracedBus[]} {
 const free=items.filter(t=>!t.used&&!t.f.title),h=median(free.map(t=>t.h))||1,taken=new Set<Placed>();
 // Each busbar's name: the label just above it or left of its start (a board tag first), with the voltage beside it.
 const buses:TracedBus[]=g.buses.map((b,i)=>{
  const near=free.filter(t=>!taken.has(t)&&t.cy<=b.y0+.6*h&&t.cy>=b.y0-7*h&&t.cx>=b.x0-15*h&&t.cx<=b.x1&&t.f.kw===undefined&&t.f.amps===undefined&&t.f.length===undefined&&t.f.size===undefined);
  const tagged=near.filter(t=>t.f.tags.some(isBoardTag)),pool=tagged.length?tagged:near.filter(t=>t.f.words>0&&!t.f.volts.length);
  const label=[...pool].sort((p,q)=>Math.hypot(p.cx-b.x0,p.cy-b.y0)-Math.hypot(q.cx-b.x0,q.cy-b.y0))[0];
  const volts=label?near.filter(t=>t.f.volts.length&&Math.hypot(t.cx-label.cx,t.cy-label.cy)<=4*h):[];
  if(label)taken.add(label);for(const v of volts)taken.add(v);
  return {name:label?(label.f.tags.find(isBoardTag)??clip(label.text.slice(0,40))):`Bus ${i+1} (page ${page})`,volts:[...(label?.f.volts??[]),...volts.flatMap(t=>t.f.volts)],named:!!label};
 });
 const onBus=(p:[number,number])=>g.buses.findIndex(b=>p[0]>=b.x0-h&&p[0]<=b.x1+h&&Math.abs(p[1]-b.y0)<=b.t/2+.5*h);
 // A tie between two busbars is traced from both ends; keep one.
 const seen=new Set<string>(),feeders=g.feeders.filter(f=>{const other=onBus(f.end);if(other<0||other===f.bus)return true;const k=`${Math.min(f.bus,other)}|${Math.max(f.bus,other)}|${Math.round(f.points[0]![0]/h)}`;if(seen.has(k))return false;seen.add(k);return true;});
 // Labels go to the nearest feeder; text near a feeder's far end (the load or source label) counts as 4 text heights closer.
 const boxes=feeders.map(f=>{const xs=f.points.map(q=>q[0]),ys=f.points.map(q=>q[1]),r=9*h;return [least(xs)-r,least(ys)-r,most(xs)+r,most(ys)+r] as const;}),members=feeders.map(()=>[] as Placed[]);
 // Distance is measured from the nearest part of the text, so a long label beside a drop ("63A TPN MCCB") still counts.
 const along=(t:Placed):[number,number][]=>{const a=rad(t.angle),ux=Math.cos(a),uy=-Math.sin(a),mx=-Math.sin(a)*t.h/2,my=-Math.cos(a)*t.h/2;return [0,.25,.5,.75,1].map(k=>[t.x+ux*t.w*k+mx,t.y+uy*t.w*k+my]);};
 for(const t of free){if(taken.has(t))continue;let best=-1,d=5*h;const pts=along(t);
  // Not clamped at zero: two feeders ending near one label must still be told apart by which end is closer.
  feeders.forEach((f,k)=>{const b=boxes[k]!;if(pts.every(q=>q[0]<b[0]||q[0]>b[2]||q[1]<b[1]||q[1]>b[3]))return;let e=Math.hypot(t.cx-f.end[0],t.cy-f.end[1])-4*h;
   for(let i=1;i<f.points.length;i++)for(const q of pts)e=Math.min(e,segDist(q,f.points[i-1]!,f.points[i]!));if(e<d){d=e;best=k;}});
  if(best>=0){members[best]!.push(t);taken.add(t);}}
 const drafts:Draft[]=[];let unnamed=0;
 feeders.forEach((f,k)=>{
  const m=members[k]!,other=onBus(f.end),bus=buses[f.bus]!,to=other>=0&&other!==f.bus?buses[other]:undefined;
  if(!m.length)return;
  const d=circuit({members:m,anchor:null,start:f.end,col:null},page,f.dir);if(!d)return;
  // Only OCR noise along this line (no name, rating, cable or length): not a circuit.
  if(!to&&!d.raw.D&&!d.raw.G&&!d.raw.AC&&!d.raw.AH&&!d.raw.N&&!m.some(t=>t.f.tx))return;
  const label=d.raw.D;
  const far=to?.name??label;
  if(f.dir==='down'){d.raw.C=bus.name;if(far)d.raw.D=far;else{d.raw.D=`${bus.name}/W${++unnamed}`;d.inferred.D='no label at the end of this feeder';}}
  else{d.raw.D=bus.name;if(far)d.raw.C=far;else{d.raw.C=`Source of ${bus.name}`;d.inferred.C='no label at the top of this incomer';}}
  if(!bus.named)d.inferred[f.dir==='down'?'C':'D']='no label found beside this busbar';
  // Transformer rating: the kVA/MVA figure nearest a transformer tag on this feeder (often on the next line, "TR:2" / "3 MVA").
  const tx=m.find(t=>t.f.tx),rating=tx?[...m].filter(t=>t.f.kva!==undefined&&!t.f.src).sort((p,q)=>Math.hypot(p.cx-tx.cx,p.cy-tx.cy)-Math.hypot(q.cx-tx.cx,q.cy-tx.cy))[0]:undefined;
  if(tx&&rating&&!d.raw.B&&Math.hypot(rating.cx-tx.cx,rating.cy-tx.cy)<=4*h){d.raw.B=String(rating.f.kva);d.inferred.B=`${tx.f.tags[0]??'transformer'} rating on this feeder`;}
  d.fromSet=true;d.kind=to||f.dir==='up'||!!far&&isBoardTag(far)?'feeder':'circuit';
  drafts.push(d);
 });
 return {drafts,buses};
}

// ---------- Boards, feeders and the From → To chain ----------
const LN:Record<number,number>={400:230,415:240,380:220,690:400,208:120,480:277,600:347};
type Board={name:string;page:number;volts:number[];fedFrom?:string;kva?:number;total?:number};
const boardOf=(t:Placed)=>t.f.tags.find(isBoardTag);
export function extractLoadList(input:readonly Token[],geometry?:ReadonlyMap<number,Geometry>):SchematicResult {
 if(input.length>SCHEMATIC_LIMITS.tokens)throw Error(`The drawing has more than ${SCHEMATIC_LIMITS.tokens.toLocaleString('en')} text items. Split it into smaller drawings.`);
 const notes:string[]=[],drafts:Draft[]=[],blocks:Draft[]=[],boards=new Map<string,Board>(),byPage=new Map<number,Token[]>(),pageVolts=new Map<number,number[]>();
 // Block attributes that already describe a whole circuit (TAG, FROM, KW, …) become rows directly.
 const groups=new Map<string,Token[]>(),loose:Token[]=[];
 for(const t of input){if(t.group!==undefined&&t.attr){const g=groups.get(t.group);if(g)g.push(t);else groups.set(t.group,[t]);}else loose.push(t);}
 for(const g of groups.values()){
  const heads=g.map(t=>t.attr!),values=g.map(t=>t.text),mapping=detectColumns(heads);
  if((mapping.D!==undefined||mapping.C!==undefined)&&Object.keys(mapping).length>=3){const [row]=toSheetRows([heads,values],0,mapping);if(row){
   const raw:Draft['raw']={},inferred:Inferred={};for(const c of INPUT_COLS)if(row[c])raw[c]=row[c];for(const [c,k] of Object.entries(mapping) as [InputCol,number][])rescue(c,values[k]??'',raw,inferred);
   const cable=heads.findIndex(x=>CABLE_HEAD.test(normalize(x))&&!NOT_CABLE.test(normalize(x)));if(cable>=0)cableCells(values[cable]??'',raw,inferred);
   blocks.push({raw,inferred,page:g[0]!.page,kind:'block',evidence:clip(g.map(t=>`${t.attr}=${t.text}`).join(' · ')),fromSet:!!raw.C,start:[g[0]!.x,g[0]!.y]});continue;}}
  // Otherwise the attribute name gives the unit of a bare number (KW = 15 → "15 kW").
  for(const t of g){const col=Object.keys(detectColumns([t.attr!]))[0],v=t.text.trim(),bare=NUMERIC.test(v);
   const text=col==='C'?`FED FROM ${v}`:!bare?v:col==='G'?`${v} kW`:col==='N'?`${v}A`:col==='AH'?`${v} m`:col==='AC'?`${v} mm2`:col==='F'?`${v}V`:col==='E'?`${v}PH`:col==='I'?`PF ${v}`:col==='H'?`DF ${v}`:v;
   const {group:_g,attr:_a,...plain}=t;loose.push({...plain,text});}
 }
 for(const t of mergeTokens(loose)){const p=byPage.get(t.page);if(p)p.push(t);else byPage.set(t.page,[t]);}
 if(byPage.size>SCHEMATIC_LIMITS.pages)throw Error(`Limit a drawing set to ${SCHEMATIC_LIMITS.pages} pages.`);
 let spares=0,unnamed=0;
 for(const [page,tokens] of [...byPage].sort((a,b)=>a[0]-b[0])){
  if(tokens.length>SCHEMATIC_LIMITS.pageTokens)throw Error(`Page ${page} has more than ${SCHEMATIC_LIMITS.pageTokens.toLocaleString('en')} text items. Split the drawing.`);
  const items=tokens.map(place),tableRows=tables(items,page),hh=median(items.map(t=>t.h));
  // A bare "C16" is an MCB rating only where the drawing talks about MCBs or amps; otherwise it is a cable or circuit name.
  if(items.some(t=>/\b(?:MCB|RCBO)\b/i.test(t.text)||t.f.amps!==undefined))for(const t of items)if(t.f.curve!==undefined&&t.f.amps===undefined){t.f.amps=t.f.curve;t.f.device=true;}
  // Line work traced from an image gives each feeder its own row; otherwise annotations are grouped around breakers.
  const lines=geometry?.get(page),traced=lines&&lines.feeders.length?tracedRows(items,lines,page):null;
  for(const b of traced?.buses??[])if(!boards.has(b.name))boards.set(b.name,{name:b.name,page,volts:b.volts.filter(v=>v>0)});
  const {bands:found,loose:rest}=traced?.drafts.length?{bands:[] as Band[],loose:items.filter(t=>!t.used)}:bands(items,page);
  if(traced)for(const d of traced.drafts)drafts.push(d);
  const titles=rest.filter(t=>boardOf(t)&&t.f.amps===undefined&&t.f.kw===undefined).sort((p,q)=>q.h-p.h).slice(0,MAX_TITLES),main=titles[0]?boardOf(titles[0]):undefined;
  pageVolts.set(page,rest.flatMap(t=>t.f.volts).filter(v=>v>0&&v<=1000));
  for(const t of titles){const name=boardOf(t)!,known=boards.get(name);if(known&&known.volts.length&&known.fedFrom)continue;const around=rest.filter(o=>Math.hypot(o.cx-t.cx,o.cy-t.cy)<=15*hh),volts=[...t.f.volts,...around.flatMap(o=>o.f.volts)].filter(v=>v>0),fed=t.f.fedFrom??around.find(o=>o.f.fedFrom)?.f.fedFrom;
   const kva=t.f.tx||isSource(name)?t.f.kva??around.find(o=>o.f.kva!==undefined)?.f.kva:undefined,total=around.find(o=>o.f.total!==undefined)?.f.total;
   const b:Board=known??{name,page,volts:[]};if(!b.volts.length)b.volts=volts;if(!b.fedFrom&&fed&&fed!==name)b.fedFrom=fed;if(b.kva===undefined&&kva!==undefined)b.kva=kva;if(b.total===undefined&&total!==undefined)b.total=total;boards.set(name,b);}
  const pageFed=rest.find(t=>t.f.fedFrom)?.f.fedFrom,mb=main?boards.get(main):undefined;if(mb&&pageFed&&!mb.fedFrom&&pageFed!==main)mb.fedFrom=pageFed;
  const circuits=found.map(b=>({b,d:circuit(b,page)}));spares+=circuits.filter(c=>!c.d&&c.b.members.some(t=>t.f.spare)).length;
  // A board labelled at the end of its feeder on this page also owns the circuits drawn below (or right of) it.
  const pool=[...titles,...circuits.flatMap(({b,d})=>d?.kind==='feeder'?b.members.filter(t=>t.f.tags.includes(d.raw.D!)):[])];
  for(const {d} of circuits)if(d?.kind==='feeder'&&!boards.has(d.raw.D!))boards.set(d.raw.D!,{name:d.raw.D!,page,volts:[]});
  const ownerOf=(start:readonly [number,number],col:boolean|null,not?:string)=>[...pool].filter(t=>boardOf(t)!==not&&(col===null||(col?t.cy<=start[1]+2*hh:t.cx<=start[0]+2*hh))).sort((p,q)=>dist(start,p)-dist(start,q))[0];
  const own=(d:Draft,col:boolean|null,why:string)=>{if(d.fromSet&&d.raw.C)return;const o=ownerOf(d.start,col,d.raw.D),name=o?boardOf(o):main!==d.raw.D?main:undefined;if(name)d.raw.C=name;else{d.raw.C=`Board p${page}`;d.inferred.C=why;}};
  for(const d of tableRows){own(d,true,'no board name found above this schedule');drafts.push(d);}
  for(const d of blocks)if(d.page===page&&!d.raw.C)own(d,null,'no board name found near this block');
  for(const {b,d} of circuits){if(!d)continue;own(d,b.col,'no board name found near this circuit');
   if(!d.raw.D){d.raw.D=`${d.raw.C}/${d.circuit??`W${++unnamed}`}`;d.inferred.D=d.circuit?'circuit number used as the name':'no tag or description found';}
   drafts.push(d);}
  if(!circuits.some(c=>c.d)&&!tableRows.length&&!traced?.drafts.length&&!blocks.some(d=>d.page===page))notes.push(`Page ${page}: no circuits recognised.`);
 }
 for(const d of blocks){if(!d.raw.C){const b=[...boards.values()].find(x=>x.page===d.page);if(b)d.raw.C=b.name;else{d.raw.C=`Board p${d.page}`;d.inferred.C='no board name found on the page';}}drafts.push(d);}
 // Same From → To on two drawings (a feeder on the parent drawing, the incomer on the board's own) is one row.
 const merged=new Map<string,Draft>();
 for(const d of drafts){const key=`${(d.raw.C??'').toLowerCase()}|${(d.raw.D??'').toLowerCase()}`,prev=merged.get(key);
  if(!prev){merged.set(key,d);continue;}
  for(const c of INPUT_COLS)if(!prev.raw[c]&&d.raw[c]){prev.raw[c]=d.raw[c];if(d.inferred[c])prev.inferred[c]=d.inferred[c];}prev.evidence=clip(`${prev.evidence} ‖ p${d.page}: ${d.evidence}`);}
 const rows=[...merged.values()],low=(s:string|undefined)=>(s??'').toLowerCase(),feeders=new Map<string,Draft>();for(const r of rows){const k=low(r.raw.D);if(k&&!feeders.has(k))feeders.set(k,r);}const feederOf=(name:string)=>feeders.get(low(name));
 // A "fed from" note with no matching feeder on these drawings gives a feeder row, so total VD can chain upstream.
 for(const b of boards.values())if(b.fedFrom&&!feederOf(b.name)&&rows.length<SCHEMATIC_LIMITS.candidates){const r:Draft={raw:{C:b.fedFrom,D:b.name},inferred:{D:`added from the "fed from ${b.fedFrom}" note on page ${b.page}`},page:b.page,kind:'feeder',evidence:`${b.name} fed from ${b.fedFrom} (page ${b.page})`,fromSet:true,start:[0,0],optional:true};rows.push(r);feeders.set(low(b.name),r);}
 const kids=new Map<string,Draft[]>();for(const r of rows){const k=low(r.raw.C);if(k&&low(r.raw.D)!==k){const l=kids.get(k);if(l)l.push(r);else kids.set(k,[r]);}}
 const children=(name:string)=>kids.get(low(name))??[];
 // Board system voltage, inherited down feeders when a sub-board's drawing does not state it.
 const lv=(v:number[])=>{const low=v.filter(x=>x>0&&x<=1000);return low.length?low:v.filter(x=>x>1000).slice(0,1);};
 const system=(name:string|undefined,page:number,fed?:string)=>{let v:number[]=[],at=name,hops=0;while(at&&!v.length&&hops++<50){v=lv(boards.get(at)?.volts??[]);if(!v.length)at=feederOf(at)?.raw.C;}if(!v.length&&fed){v=lv(boards.get(fed)?.volts??[]);if(v.length)at=fed;}if(!v.length)v=pageVolts.get(page)??[];
  const hi=most(v,0),lo=least(v.filter(x=>x>0));return {ll:hi>=380?hi:undefined,ln:Number.isFinite(lo)&&lo<380?lo:hi>=380?LN[hi]:undefined,from:at&&v.length?at:`page ${page}`};};
 const sum=(name:string,seen:Set<string>):{kw:number;kvar:number;all:boolean}=>{if(seen.has(low(name)))return {kw:0,kvar:0,all:false};seen.add(low(name));let kw=0,kvar=0,all=true;
  for(const r of children(name)){let k=r.raw.G&&NUMERIC.test(r.raw.G)?Number(r.raw.G):NaN;if(!r.raw.G&&r.raw.D){const s=sum(r.raw.D,seen);k=s.kw;all&&=s.all;if(s.kw>0){kw+=s.kw;kvar+=s.kvar;}continue;}if(!Number.isFinite(k)){all=false;continue;}kw+=k;const pf=Number(r.raw.I);if(pf>0&&pf<=1)kvar+=k*Math.tan(Math.acos(pf));else all=false;}return {kw,kvar,all};};
 for(const r of rows){
  const f=r.raw,phase=(p:string,why:string)=>{f.E=p;r.inferred.E=why;};
  if(!f.E&&f.P){const c=parseInt(f.P,10);if(c===2)phase('1','2-core cable');else if(c===4||c===5)phase('3',`${c}-core cable`);}
  if(!f.E&&f.F&&NUMERIC.test(f.F)){const v=Number(f.F);if(v>=380&&v<=1000)phase('3',`${v} V`);else if(v>=100&&v<=277)phase('1',`${v} V`);}
  if(!f.E&&f.D&&children(f.D).some(c=>c.raw.E==='3'))phase('3','the board it feeds has three-phase circuits');
  if(!f.E){const s=system(f.C,r.page,f.D);if((s.ll??0)>1000)phase('3',`${s.from} is a ${(s.ll??0)/1000} kV system`);}
  if(!f.F&&f.E){const s=system(f.C,r.page,f.D),v=f.E==='3'?s.ll:s.ln;if(v){f.F=String(v);r.inferred.F=`system voltage of ${s.from}`;}}
  if(!f.B&&f.C&&isSource(f.C)){const b=boards.get(f.C);if(b?.kva!==undefined){f.B=String(b.kva);r.inferred.B=`${f.C} rating`;}}
  if(!f.G&&f.D&&children(f.D).length){const b=boards.get(f.D),s=sum(f.D,new Set());if(b?.total!==undefined){f.G=String(b.total);r.inferred.G=`total load stated on the ${f.D} drawing`;}else if(s.kw>0){f.G=String(+s.kw.toPrecision(6));r.inferred.G=`sum of the circuits fed from ${f.D}, no diversity applied`;if(!f.I&&s.all){f.I=String(+(s.kw/Math.hypot(s.kw,s.kvar)).toFixed(3));r.inferred.I=`combined PF of the circuits fed from ${f.D}`;}}}
 }
 const listed=new Set([...TABLES.voltages['1'],...TABLES.voltages['3']].map(Number));
 for(const b of boards.values()){const odd=b.volts.filter(v=>v<=1000&&!listed.has(v));if(odd.length)notes.push(`${b.name}: ${odd.join('/')} V is not in the workbook's voltage list (1-phase ${TABLES.voltages['1'].join('/')} V, 3-phase ${TABLES.voltages['3'].join('/')} V). Rows keep the value and show it as invalid.`);}
 const mv=[...boards.values()].filter(b=>!isSource(b.name)&&b.volts.some(v=>v>1000));
 if(mv.length)notes.push(`${mv.slice(0,6).map(b=>`${b.name} (${most(b.volts)/1000} kV)`).join(', ')}: the workbook's cable ratings are for LV cables up to 690 V, so rows at these voltages keep the drawing voltage and show as invalid. Medium-voltage cables need MV rating tables.`);
 if(input.some(t=>/\b\d{1,2}\s*[-–—_]\s*[13]\s*\/\s*C\b|\bKCMIL\b|\bAWG\b|\bMCM\b/i.test(t.text)))notes.push('Cable sizes in AWG/kcmil are kept as drawn and show as invalid: the workbook\'s tables are metric (mm²). Lengths in feet or miles were converted to metres.');
 if(input.some(t=>/\d\s*V\s*DC\b|\bVDC\b/i.test(t.text)))notes.push('DC circuits were found. The workbook sizes AC circuits only; DC rows keep their values for review.');
 if(rows.some(r=>r.optional))notes.push('Feeders known only from a "fed from" note are listed unticked: without a cable run they would stop total VD for every circuit below them. Tick them once you can enter the run.');
 if(spares)notes.push(`${spares} spare or space way${spares===1?'':'s'} skipped.`);
 if(rows.length>SCHEMATIC_LIMITS.candidates){notes.push(`Only the first ${SCHEMATIC_LIMITS.candidates} circuits are listed.`);rows.length=SCHEMATIC_LIMITS.candidates;}
 const candidates=rows.map(r=>{const row=emptyRow();for(const c of INPUT_COLS){const v=r.raw[c];if(v)row[c]=cleanValue(c,v,row);}return {row,page:r.page,kind:r.kind,evidence:r.evidence,inferred:r.inferred,include:!r.optional};}).filter(c=>!isBlankRow(c.row));
 return {candidates,boards:[...boards.keys()],notes};
}
