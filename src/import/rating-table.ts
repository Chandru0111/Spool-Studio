import {clip} from '../engine/sheet';
import {emptyEntry,num,type CatalogueKey} from '../engine/loads';
import {asFraction,dot,verify,type Box,type Proposal} from './equipment';
import {fieldsIn,type Field} from './vocabulary';
import type {PositionedLine,Rule} from './parse';

// Catalogue rating tables: one row per motor, pump or fan, with headings stacked over a few lines above the rows
// ("Output / kW", "Current / In at 400 V / A", "Efficiency % / 100% 75%"). Columns are found from where the numbers
// sit on the page, so a heading that spans sub-columns or wraps onto two lines still lands on the right column. Each
// column is named from the words, symbols and units over it in any language the vocabulary knows (vocabulary.ts),
// checked against its values, and, where no heading names it, found from P = √3·U·I·η·cosφ holding on every row.
// Where the page draws the table's borders or shades its cells, those edges decide which column a heading or value sits
// in. Every value keeps the box it was printed in, so the review can show it on the page.
type Cell={x0:number;x1:number;y:number;h:number;text:string};
type Kind='name'|'code'|'frame'|'kw'|'w'|'hp'|'in'|'un'|'eff'|'pf'|'poles'|'speed';
// head: every heading line over the column, top to bottom; own: only the words printed over this column alone.
// skip: its own heading says it is not load data (starting current, torque, weight…).
type Column={x0:number;x1:number;head:string[];own:string[];text:number;numbers:number;kind?:Kind|undefined;skip?:boolean};
const NUM=/^[-+]?\d+(?:[.,]\d+)?%?$/;
// A load point printed under an efficiency or power-factor heading: "100", "75 %", "4/4", "3/4".
const LOAD_POINT=/^\s*(?:\d{2,3}\s*%?|[1-4]\s*\/\s*4)\s*$/;
const HP_KW=0.7457;
// Supply voltages motors are rated for, to recognise kW, In, efficiency and power factor columns by their values alone.
const VOLTAGES=[110,115,120,200,208,220,230,240,380,400,415,440,460,480,500,525,550,575,600,660,690,1000,2300,3000,3300,4160,6000,6600,10000,11000,13800];
const SYNC_RPM=[3600,3000,1800,1500,1200,1000,900,750,600,500];

// A run of numbers written as one text item ("0.75 2850 1.9") is split into cells at estimated positions.
function cellsOf(line:PositionedLine):Cell[] {
 return line.cells.flatMap(c=>{
  const w=c.w||c.text.length*4.5,y=c.y??line.y??0,h=c.h||8,parts=c.text.trim().split(/\s+/);
  if(parts.length<2||!parts.every(p=>NUM.test(p)))return [{x0:c.x,x1:c.x+w,y,h,text:c.text.trim()}];
  let at=0;
  return parts.map(p=>{const i=c.text.indexOf(p,at);at=i+p.length;return {x0:c.x+w*i/c.text.length,x1:c.x+w*(i+p.length)/c.text.length,y,h,text:p};});
 });
}
// Three or more numbers, and no fewer numbers than words, make a data row; heading rows of load points ("100%  75%  50%",
// "P n  I n  cos φ  100  75  50") or poles ("2  4  6  8") do not.
const isData=(cells:readonly Cell[])=>{const n=cells.filter(c=>NUM.test(c.text));return n.length>=3&&n.length*2>=cells.length&&!n.every(c=>c.text.endsWith('%'))&&!n.every(c=>/^\d{1,2}$/.test(c.text)&&+c.text<=16);};
// Sentences above a table (notes, regulations, the last line of a paragraph) are not headings: headings are a few words.
const isProse=(cells:readonly Cell[])=>cells.some(c=>{const w=c.text.split(/\s+/).length;return c.text.length>40||w>=7||w>=3&&/[a-z]\.$/.test(c.text);});

// One heading line: a kind, 'skip' for columns that are not load data, or nothing. Over a column of names the words
// say which name it is: a type or series (the model), a code (part or article number) or a frame size.
function kindOf(line:string,text:boolean):Kind|'skip'|undefined {
 const f=fieldsIn(line),s=(k:Field)=>f.get(k)??0;
 const id=(['name','code','frame'] as const).filter(k=>s(k)>0).sort((a,b)=>s(b)-s(a))[0];
 if(text)return id??(s('un')>0?'un':undefined);
 // Numbers under an ID or frame heading are codes ("Product ID 310126", frame "280").
 if(id==='code'||id==='frame')return id;
 if(s('speed')>0)return 'speed';
 if(s('skip')>0)return 'skip';
 if(s('pf')>0)return 'pf';
 if(s('eff')>0)return 'eff';
 if(/(^|[^A-Za-z])[kK]W($|[^A-Za-z])/.test(line))return 'kw';
 if(s('hp')>0)return 'hp';
 if(s('w')>0)return 'w';
 if(s('kw')>0)return 'kw';
 if(s('in')>0)return 'in';
 if(s('un')>0)return 'un';
 if(s('poles')>0)return 'poles';
 return undefined;
}
// The column's own heading decides: read whole first ("Power" over "factor" is a power factor), then nearest the numbers
// first ("(kW)", "[A]"); a heading spanning several columns only when its own says nothing ("100%" under "Efficiency").
function classify(c:Column):Kind|'skip'|undefined {
 // A qualifier anywhere in the column's own heading ("Rotor" above "voltage (kV)", "Starting" above "current") rules it
 // out, as does a ratio printed as a fraction ("I s" over "I n", "M max" over "M n").
 const own=c.own.join(' ');
 if(fieldsIn(own).has('skip')||/^\s*[IiMmTt]\s?[A-Za-z]{1,3}\s+[IiMmTt]\s?[A-Za-z]{1,3}\s*$/.test(own))return 'skip';
 for(const lines of [[c.own.join(' ')],c.own,c.head])for(const line of [...lines].reverse()){const k=kindOf(line,c.text>c.numbers);if(k)return k;}
 return undefined;
}
// Several columns of one kind (efficiency at 100/75/50 %, current at 380/400/415 V): take full load and 400 V, else the first.
function pick(cols:readonly Column[],kind:Kind):Column|undefined {
 const of=cols.filter(c=>c.kind===kind),head=(c:Column)=>c.head.join(' ');
 const want=kind==='in'?[/(?<!\d)400(?!\d)/,/(?<!\d)415(?!\d)/,/(?<!\d)380(?!\d)/]:kind==='eff'||kind==='pf'?[/100\s*%|(?<![\d.,])100\s*$|4\s*\/\s*4|full|voll|plein|plena|pieno|pleno/i]:[];
 for(const re of want){const hit=of.find(c=>re.test(head(c)));if(hit)return hit;}
 return of[0];
}
// The voltage a table is printed for, in volts: "400 V", "380/415 V", "3000 V" or "3.3 kV".
function voltsIn(s:string):string|undefined {
 const m=s.match(/\b(\d{3,5}(?:\s*\/\s*\d{3,5})?)\s*V\b|\b(\d{1,2}(?:[.,]\d+)?)\s*kV\b/);
 return m?.[1]?.replace(/\s/g,'')??(m?.[2]?String(Math.round(Number(dot(m[2]))*1000)):undefined);
}
const overlap=(c:{x0:number;x1:number},x0:number,x1:number)=>Math.min(c.x1,x1)-Math.max(c.x0,x0);
// apart: a drawn border runs between the cell and the column, so the cell belongs to another column if one is on its side.
function columnOf(cols:readonly Column[],cell:{x0:number;x1:number},apart?:(c:Column)=>boolean):Column|undefined {
 const near=apart?cols.filter(c=>!apart(c)):[];
 let best:Column|undefined,score=-12;// a cell up to 12 pt beside a column still belongs to it
 for(const c of near.length?near:cols){const o=overlap(c,cell.x0,cell.x1);if(o>score){score=o;best=c;}}
 return best;
}
// The vertical edges a page draws: border lines and both sides of each shaded or framed cell, with the height they run over.
type Edge={x:number;y0:number;y1:number};
const edgesOf=(rules:readonly Rule[]):Edge[]=>rules.flatMap(r=>r.y1-r.y0<4?[]:r.x1-r.x0<3?[{x:(r.x0+r.x1)/2,y0:r.y0,y1:r.y1}]:[{x:r.x0,y0:r.y0,y1:r.y1},{x:r.x1,y0:r.y0,y1:r.y1}]);
const polesFrom=(rpm:number)=>rpm>=2000?2:rpm>=1250?4:rpm>=850?6:rpm>=600?8:null;
const SYNC:Record<string,number>={3000:2,3600:2,1500:4,1800:4,1000:6,1200:6,750:8,900:8};
function polesIn(text:string):number|null {
 const m=text.match(/\b(\d{1,2})\s*-?\s*pol(?:e|es|ig|os|i)?\b|\b(\d{1,2})\s*p\b/i);if(m)return Number(m[1]??m[2]);
 const s=text.match(/\b(3000|3600|1500|1800|1000|1200|750|900)\s*(?:rpm|r\/min|min)/i);return s?SYNC[s[1]!]??null:null;
}
// Standards and ratings printed beside a product name, never the name itself.
const NOT_NAME=/^(?:IEC|IE\d?|IP\d+|IC\d+|IM\w*|NEMA|TEFC|TENV|ODP|ATEX|EX|CE|UL|CSA|EN|ISO|DIN|VDE|GB|AC|DC)$/;
// The product name printed over a table ("OMSR 4-POLE | 1500 RPM" gives "OMSR"), for tables whose columns name only
// sizes or codes: the code-like words (capitals with digits or a hyphen, or a short capital word) on the nearest short
// line above that starts at the table's left edge, leaving out ratings, poles, standards and field names. The name is
// taken as printed, from its first such word to its last ("OMT1C IE3 RW 8-POLE" gives "OMT1C IE3 RW").
function titleName(around:readonly Cell[][],left:number,right:number):{text:string;box:Cell}|undefined {
 for(const l of around){
  // A title is a few pieces at the left (a heading row spreads across the table); marks out at the right edge do not count.
  if(!l.length||l.filter(c=>c.x0<left+(right-left)*0.7).length>3||l[0]!.x0>left+30||isProse(l))continue;
  for(const cell of l){
   const words=cell.text.split(/[\s|,;:&()]+/).filter(w=>/^[A-Z0-9][A-Z0-9.\-/]*$/.test(w)&&/[A-Z]/.test(w)&&w.length>=2&&w.length<=20&&
    (/\d/.test(w)||w.replace(/[^A-Z]/g,'').length<=5)&&!/^\d+(?:[.,]\d+)?[A-Z%]{0,3}$/.test(w)&&!/\d\s*-?\s*POL/.test(w)&&!NOT_NAME.test(w)&&!fieldsIn(w).size);
   const first=words[0],last=words.at(-1);if(!first||!last)continue;
   const i=cell.text.indexOf(first),j=cell.text.lastIndexOf(last)+last.length,w=cell.x1-cell.x0,len=cell.text.length||1;
   return {text:cell.text.slice(i,j).replace(/\s*\|\s*$/,''),box:{...cell,x0:cell.x0+w*i/len,x1:cell.x0+w*j/len}};
  }
 }
 return undefined;
}

export function catalogueFromTables(layout:ReadonlyMap<number,readonly PositionedLine[]>,file:string,rules:ReadonlyMap<number,readonly Rule[]>=new Map()):Proposal[] {
 const out:Proposal[]=[],seen=new Set<string>();
 for(const [page,lines] of layout){
  const cells=lines.map(cellsOf);let i=0;
  // The borders drawn across a text line (at the middle of its letters), and whether one runs between two points on it.
  const edges=edgesOf(rules.get(page)??[]),drawn=new Map<number,number[]>();
  const walls=(cell:Cell)=>{const y=Math.round(cell.y+cell.h*0.3);let w=drawn.get(y);
   if(!w){w=[...new Set(edges.filter(e=>e.y0-1<=y&&y<=e.y1+1).map(e=>Math.round(e.x*2)/2))].sort((a,b)=>a-b);drawn.set(y,w);}return w;};
  const centre=(c:{x0:number;x1:number})=>(c.x0+c.x1)/2;
  const apart=(cell:Cell,c:{x0:number;x1:number})=>{const a=Math.min(centre(c),centre(cell)),b=Math.max(centre(c),centre(cell));return walls(cell).some(x=>x>a+0.5&&x<b-0.5);};
  while(i<lines.length){
   if(!isData(cells[i]!)){i++;continue;}
   // A block of rows; a line or two between rows ("4 poles – 1500 rpm") is a sub-heading for the rows below it.
   const start=i,rows:{cells:Cell[];sub:string}[]=[];let sub='',gap=0;
   for(;i<lines.length;i++){
    const c=cells[i]!;if(isData(c)){rows.push({cells:c,sub});gap=0;continue;}
    if(++gap>2)break;sub=c.map(x=>x.text).join(' ');
   }
   if(rows.length<2)continue;
   // Columns: numbers that overlap across rows are one column; text cells join the column they overlap, or form their own.
   const cols:Column[]=[];
   // text counts cells with letters (names, codes); "–" or "6,3 / 12,5" are neither names nor single numbers.
   const add=(cell:Cell)=>{
    const numeric=NUM.test(cell.text),text=!numeric&&/\p{L}/u.test(cell.text),hit=cols.find(c=>overlap(c,cell.x0,cell.x1)>0&&!apart(cell,c));
    if(hit){hit.x0=Math.min(hit.x0,cell.x0);hit.x1=Math.max(hit.x1,cell.x1);if(numeric)hit.numbers++;if(text)hit.text++;}
    else cols.push({x0:cell.x0,x1:cell.x1,head:[],own:[],text:text?1:0,numbers:numeric?1:0});
   };
   for(const r of rows)for(const c of r.cells)if(NUM.test(c.text))add(c);
   for(const r of rows)for(const c of r.cells)if(!NUM.test(c.text))add(c);
   cols.sort((a,b)=>a.x0-b.x0);
   // Headings: the short lines straight above the block (up to twelve: subscripts and units sit on lines of their own),
   // ending at a sentence or title. A group label ("500 r/min = 12 poles") is not a heading. Everything up to sixteen
   // lines above, nearest first, is context for voltage, frequency, poles and the product name; another table ends both.
   const heads:Cell[][]=[],around:Cell[][]=[];let inHeads=true;
   for(let k=start-1;k>=0&&start-k<=16;k--){
    const c=cells[k]!,text=c.map(x=>x.text).join(' ');if(isData(c))break;
    if(isProse(c)||start-k>12)inHeads=false;
    if(inHeads&&polesIn(text)===null)heads.unshift(c);
    around.push(c);
   }
   const context=around.map(c=>c.map(x=>x.text).join(' '));
   // A heading printed in a drawn cell heads only columns inside that cell, so words wider than their column do not spill
   // across a border. Borders count only where they divide the table (a shaded band behind the whole heading row does
   // not) and the words do not cross one. A heading alone in a cell with one column heads it even when printed far from
   // its figures; a group cell ("Current" over In, Is/In, I0) still lets its sub-headings pick their column by position.
   const left=Math.min(...cols.map(c=>c.x0)),right=Math.max(...cols.map(c=>c.x1));
   const cellOver=(item:Cell)=>{
    const w=walls(item);if(!w.some(x=>x>left+1&&x<right-1)||w.some(x=>x>item.x0+1&&x<item.x1-1))return undefined;
    const l=w.filter(x=>x<=item.x0+1).at(-1),r=w.find(x=>x>=item.x1-1);if(l===undefined||r===undefined)return undefined;
    return (c:Column)=>centre(c)>l&&centre(c)<r;
   };
   for(const l of heads){
    const got=new Map<Column,string[]>(),own=new Map<Column,string[]>();
    for(const item of l){
     const near=cols.filter(c=>overlap(c,item.x0-2,item.x1+2)>0),inCell=cellOver(item),lone=inCell&&cols.filter(inCell);
     const under=!inCell?near:near.some(inCell)?near.filter(inCell):lone&&lone.length===1?lone:[],to=under.length?under:[columnOf(cols,item,c=>apart(item,c))].filter(c=>c!==undefined);
     for(const c of to){got.set(c,[...got.get(c)??[],item.text]);if(to.length===1)own.set(c,[...own.get(c)??[],item.text]);}
    }
    for(const [c,t] of got)c.head.push(t.join(' '));for(const [c,t] of own)c.own.push(t.join(' '));
   }
   const colOf=(x:Cell)=>columnOf(cols,x,c=>apart(x,c));
   const textOf=(r:{cells:Cell[]},c:Column)=>r.cells.filter(x=>colOf(x)===c).map(x=>x.text).join(' ').trim();
   const numsOf=(c:Column)=>rows.map(r=>num(dot(textOf(r,c)).replace(/%$/,''))).filter((n):n is number=>n!==null);
   for(const c of cols){const k=classify(c);c.kind=k==='skip'?undefined:k;c.skip=k==='skip';}
   // Values must fit the field the heading gave: a power factor or efficiency is at most 1 (or 100 %), a speed is in the
   // hundreds or thousands, poles are even. A numeric column no heading names is a speed when every value sits near a
   // motor speed.
   for(const c of cols){
    const v=numsOf(c);if(!v.length||c.text>c.numbers)continue;
    const max=Math.max(...v),min=Math.min(...v);
    if((c.kind==='pf'||c.kind==='eff')&&max>100||c.kind==='speed'&&min<100||c.kind==='poles'&&!v.every(n=>n>=2&&n<=16&&n%2===0))c.kind=undefined;
    if(!c.kind&&!c.skip&&rows.length>=2&&v.length===rows.length&&v.every(n=>SYNC_RPM.some(s=>n<=s&&n>=s*0.9)))c.kind='speed';
   }
   // Efficiency or power factor at several loads (100 %, 75 %, 50 % or 4/4, 3/4, 2/4): the heading is often centred
   // over the middle load only, so a load-point column no heading names takes its neighbour's field.
   const loadPoint=(c:Column|undefined)=>!!c&&c.own.some(t=>LOAD_POINT.test(t));
   for(let pass=0;pass<2;pass++)cols.forEach((c,j)=>{
    if(c.kind||c.skip||!loadPoint(c))return;
    const n=[cols[j-1],cols[j+1]].find(o=>(o?.kind==='eff'||o?.kind==='pf')&&loadPoint(o));
    if(n){c.kind=n.kind;c.head=[...n.head.filter(t=>!LOAD_POINT.test(t)),...c.own];}
   });
   // kW, In, efficiency and power factor that no heading names (a wording or language not in the vocabulary): the free
   // numeric columns whose values work out, by P = √3·U·I·η·cosφ, to one standard supply voltage on every row.
   const need=(['kw','in','eff','pf'] as const).filter(k=>!pick(cols,k)&&!(k==='kw'&&(pick(cols,'w')||pick(cols,'hp'))));
   const free=cols.filter(c=>!c.kind&&!c.skip&&c.numbers>=c.text&&numsOf(c).length>=Math.max(2,rows.length-1));
   if(need.length&&free.length>=need.length&&rows.length>=3){
    const plain=new Map(cols.map(c=>[c,rows.map(r=>num(dot(textOf(r,c)).replace(/%$/,'')))] as const)),frac=(n:number|null|undefined)=>n==null?null:n>1?n/100:n;
    let best:{cols:Column[];spread:number}|undefined;
    const tryOn=(chosen:Column[])=>{
     const of=(k:'kw'|'in'|'eff'|'pf')=>{const c=need.includes(k)?chosen[need.indexOf(k)]:pick(cols,k);return c?plain.get(c)!:[];};
     const P=of('kw'),A=of('in'),E=of('eff'),F=of('pf');
     const us=rows.map((_,j)=>{const p=P[j],a=A[j],e=frac(E[j]),f=frac(F[j]);
      return p&&a&&e&&f&&e>0.3&&e<=1&&f>0.1&&f<=1?p*1000/(Math.sqrt(3)*a*e*f):null;}).filter((u):u is number=>u!==null);
     if(us.length<Math.max(2,rows.length-1))return;
     const mid=[...us].sort((a,b)=>a-b)[us.length>>1]!,spread=Math.max(...us.map(u=>Math.abs(u/mid-1)));
     if(spread<=0.08&&VOLTAGES.some(v=>Math.abs(mid/v-1)<=0.08)&&(!best||spread<best.spread))best={cols:chosen,spread};
    };
    const choose=(chosen:Column[])=>{if(chosen.length===need.length){tryOn(chosen);return;}for(const c of free)if(!chosen.includes(c))choose([...chosen,c]);};
    choose([]);
    if(best)need.forEach((k,j)=>{best!.cols[j]!.kind=k;});
   }
   const kw=pick(cols,'kw')??pick(cols,'w'),watts=!!kw&&kw.kind==='w',hp=pick(cols,'hp'),inA=pick(cols,'in'),eff=pick(cols,'eff'),pf=pick(cols,'pf'),un=pick(cols,'un');
   // Names and codes. A type or series name is the model a load list picks; a code that tells the rows apart (product
   // ID, article number, frame size) is the configuration. A name column printing the same text on every row ("OMT2"
   // beside "80K2", "90S2"…) is the series name. With no name column, the product name printed over the table is the
   // model; with neither, the code is.
   // Punctuation aside: a scan's stray mark ("OMT2 :") does not make a series name vary.
   const distinct=(c:Column)=>new Set(rows.map(r=>textOf(r,c).replace(/[^\p{L}\p{N}]/gu,'')).filter(Boolean)).size;
   const texts=cols.filter(c=>c.text>c.numbers&&!c.kind&&!c.skip&&c.text*2>=rows.length);
   // An unlabelled text column names the rows only when no labelled one does (an efficiency-class column of "IE3" is not a name).
   const labelled=cols.filter(c=>c.kind==='name'||c.kind==='code'||c.kind==='frame'),ids=labelled.length||texts.length!==1?labelled:texts;
   const varies=ids.some(c=>distinct(c)>1);
   const names=ids.filter(c=>c.kind!=='code'&&c.kind!=='frame'||varies&&rows.length>1&&distinct(c)===1&&c.text>c.numbers);
   const nameCol=names.find(c=>distinct(c)>1)??names[0],codes=ids.filter(c=>!names.includes(c));
   const title=nameCol?undefined:titleName(around,left,right);
   const modelCol=nameCol??(title?undefined:codes[0]);
   const configCols=ids.filter(c=>c!==modelCol).sort((a,b)=>a.x0-b.x0);
   const poles=pick(cols,'poles'),speed=pick(cols,'speed');
   // A product table names its rows (a name, code or size column) or gives their current; a table of kW against
   // efficiencies only (the IEC IE-class limits many catalogues reprint) lists no products, whatever its title.
   if(!(kw||hp)||!(inA||eff||pf)||!(ids.length||inA))continue;
   const ctx=[...context,...(inA?[inA.head.join(' ')]:[])].join('\n');
   const hz=ctx.match(/\b(50|60)\s*Hz\b/i)?.[1],three=/3\s*~|three[\s-]*phase|\b3[\s-]*ph/i.test(ctx),one=/1\s*~|single[\s-]*phase|\b1[\s-]*ph/i.test(ctx);
   // A row's printed values, each kept only in a plausible range (kW from W or hp).
   const read=(r:{cells:Cell[]})=>{
    const at=new Map<Column,Cell[]>();
    for(const c of r.cells){const col=colOf(c);if(col)at.set(col,[...at.get(col)??[],c]);}
    const raw=(c?:Column)=>c?(at.get(c)??[]).map(x=>x.text).join(' ').trim():'',val=(c?:Column)=>dot(raw(c)).replace(/%$/,''),n=(c?:Column)=>num(val(c));
    const kwN=n(kw)===null?null:watts?+(n(kw)!/1000).toFixed(4):n(kw),hpN=n(hp),k=kwN??(hpN===null?null:+(hpN*HP_KW).toFixed(3));
    const amps=n(inA),ef=num(asFraction(val(eff))),p=num(asFraction(val(pf)));
    return {at,raw,n,kwN,hpN,kw:k!==null&&k>0&&k<=5000?k:null,amps:amps!==null&&amps>0&&amps<=10000?amps:null,ef:ef!==null&&ef>=0.3&&ef<=1?ef:null,pf:p!==null&&p>=0.1&&p<=1?p:null};
   };
   // The voltage a row's own values work out to: P = √3·U·I·η·cosφ (U·I·η·cosφ on one phase).
   const implied=(v:ReturnType<typeof read>,single:boolean)=>v.kw&&v.amps&&v.ef&&v.pf?v.kw*1000/((single?1:Math.sqrt(3))*v.amps*v.ef*v.pf):null;
   // The voltage over the current column is the one In is given for. Otherwise, of several printed above (a page title
   // and a group label that disagree, or the table above's), the one the rows work out to; else the nearest.
   const printed=[...new Set(context.map(voltsIn).filter((v):v is string=>!!v))];
   const us=rows.map(r=>implied(read(r),one&&!three)).filter((u):u is number=>u!==null).sort((a,b)=>a-b),mid=us[us.length>>1];
   const off=(v:string)=>Math.min(...v.split('/').map(x=>Math.abs(Number(x)-(mid??0))));
   const volts=voltsIn(inA?.head.join(' ')??'')??(mid!==undefined&&printed.length>1?printed.reduce((a,b)=>off(b)<off(a)?b:a):printed[0]);
   const voltLine=volts?ctx.split('\n').find(l=>voltsIn(l)===volts)??'':'';
   const hzLine=hz?ctx.split('\n').find(l=>new RegExp(`\\b${hz}\\s*Hz`,'i').test(l))??'':'';
   const used:[Column|undefined,CatalogueKey][]=[[modelCol,'model'],...configCols.map(c=>[c,'config'] as [Column,CatalogueKey]),[kw,'ratedKw'],[hp,'ratedKw'],[inA,'inA'],[eff,'efficiency'],[pf,'pf'],[un,'un']];
   for(const r of rows){
    const v=read(r),{at,raw,n,kwN,hpN}=v,e=emptyEntry(),evidence:string[]=[];
    if(v.kw!==null)e.ratedKw=String(v.kw);
    if(v.amps!==null)e.inA=String(v.amps);
    if(v.ef!==null)e.efficiency=String(v.ef);
    if(v.pf!==null)e.pf=String(v.pf);
    // A voltage cell may carry the phases too ("3×400", "3~ 400").
    const uText=raw(un),uNum=num(dot(uText))??num(dot(uText.match(/\d{2,4}(?:[.,]\d+)?(?=\D*$)/)?.[0]??'')),u=uNum!==null&&un&&/\bkv\b/i.test(un.head.join(' '))?+(uNum*1000).toFixed(1):uNum;e.un=u!==null&&u>=50&&u<=36000?`${u} V`:volts?`${volts} V`:'';
    // Values that do not work out to the voltage are a misread or the wrong voltage (10 % covers rounding). With no phase
    // printed, values that work out on one phase but not on three are a single-phase motor.
    const rated=e.un.match(/\d+(?:\.\d+)?/g)?.map(Number)??[],fits=(single:boolean)=>{const w=implied(v,single);return w===null||!rated.length||rated.some(x=>Math.abs(w/x-1)<=0.1);};
    const printedPhase=/^3\s*[×x~]/.test(uText)||three?'3-phase':/^1\s*[×x~]/.test(uText)||one?'1-phase':'',worked=!printedPhase&&!fits(false)&&fits(true);
    const phase=worked?'1-phase':printedPhase;
    if(!e.ratedKw||![e.inA,e.efficiency,e.pf].some(Boolean))continue;
    const spd=n(speed),np=n(poles),pl=(np!==null&&np>=2&&np<=16&&np%2===0?np:null)??(spd===null?null:polesFrom(spd))??polesIn(r.sub)??polesIn(ctx);
    // The model is only ever text printed on the page: the row's name or code, or the product name over the table. Never made up.
    e.model=clip(modelCol?raw(modelCol):title?.text??'');
    e.config=clip([...configCols.map(c=>raw(c)),e.un,phase,hz?`${hz} Hz`:'',pl?`${pl}-pole`:''].filter(Boolean).join(', '));
    e.source=clip(`${file}, page ${page}`);
    // The same table printed twice adds nothing; rows that differ are all kept for the engineer to tell apart.
    const key=JSON.stringify({...e,source:''});if(seen.has(key))continue;seen.add(key);
    if(title)evidence.push(title.box.text);
    for(const c of [modelCol,...configCols,kw,hp,inA,eff,pf,un,poles,speed])if(c&&raw(c))evidence.push(`${c.head.slice(-2).join(' ')||'?'}: ${raw(c)}`);// the heading lines nearest the numbers
    if(hpN!==null&&kwN===null)evidence.push(`${raw(hp)} hp = ${e.ratedKw} kW (1 hp = ${HP_KW} kW)`);
    if(watts&&kwN!==null)evidence.push(`${raw(kw)} W = ${e.ratedKw} kW`);
    if(voltLine&&!un)evidence.push(voltLine);if(hzLine&&hzLine!==voltLine)evidence.push(hzLine);if(r.sub)evidence.push(r.sub);
    const boxes:Box[]=[...used.flatMap(([c,key])=>c&&e[key]?(at.get(c)??[]).map(x=>({key,x0:x.x0,x1:x.x1,y:x.y,h:x.h})):[]),...(title?[{key:'model' as const,x0:title.box.x0,x1:title.box.x1,y:title.box.y,h:title.box.h}]:[])];
    if(worked)evidence.push('kW, In, efficiency and power factor work out to single phase');
    const works=implied(v,phase==='1-phase')??0,note=fits(phase==='1-phase')?'':`${e.ratedKw} kW, ${e.inA} A, efficiency ${e.efficiency} and power factor ${e.pf} work out to about ${Math.round(works)} V${phase?` (${phase})`:''}, not ${e.un}. Check In and Un on the page.`;
    const unverified=[...new Set([...verify(e,evidence.join('\n')).filter(x=>!(x==='ratedKw'&&(kwN===null||watts))),...(e.model?[]:['model' as const]),...(note?['inA','un'] as const:[])])];
    if(out.length>=5000)throw Error('The document has more than 5,000 entries. Split the file.');
    out.push({entry:e,page,evidence:evidence.join(' · ').slice(0,300),unverified,include:true,boxes,...(note?{note}:{})});
   }
  }
 }
 // Rows of one model and configuration would replace each other in the catalogue: one frame at several outputs gets its
 // kW, and the same frame in two series or efficiency classes its page, until the engineer names the series.
 const by=new Map<string,Proposal[]>();
 for(const p of out)if(p.entry.model){const k=`${p.entry.model}\u0000${p.entry.config}`.toLowerCase();by.set(k,[...by.get(k)??[],p]);}
 for(const g of by.values()){
  if(g.length<2)continue;
  const kw=new Set(g.map(p=>p.entry.ratedKw)).size>1,same=(p:Proposal,q:Proposal)=>!kw||p.entry.ratedKw===q.entry.ratedKw;
  const paged=g.some(p=>g.some(q=>q!==p&&same(p,q)&&q.page!==p.page));
  for(const p of g)p.entry.config=clip([p.entry.config,kw?`${p.entry.ratedKw} kW`:'',paged?`page ${p.page}`:''].filter(Boolean).join(', '));
 }
 return out;
}
