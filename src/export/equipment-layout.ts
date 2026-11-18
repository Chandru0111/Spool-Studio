import type ExcelJS from 'exceljs';
import {balance,emptyLoad,fraction,num,panelTotals,type LoadRow,type Factors} from '../engine/loads';

// One panel sheet, cell for cell as the engineer's own layout ("Panel 1" of their designed workbook):
// header rows 1-6, at least 32 item rows from row 7, then the load summary. Change it only against that workbook.
export const MIN_ROWS=32;
const WIDTHS=[4.1640625,20.83203125,51.5,14,24,22,12,8.5,13.5,9.83203125,11.33203125,4.33203125,12.33203125,17.33203125,6.1640625,7.5,11.83203125,12.5,13,10,10.33203125,9.5,9.33203125,9.1640625,8.6640625];
const HEIGHTS=[16.5,12,29,12,12,12];
const LAST='Y',BLACK={argb:'FF000000'};

type Style={font?:Partial<ExcelJS.Font>;fill?:string;border?:string;align?:Partial<ExcelJS.Alignment>;numFmt?:string};
const arial=(size:number,bold=false):Partial<ExcelJS.Font>=>({name:'Arial',size,family:2,...bold?{bold}:{}});
const HEAD:Style={font:arial(9,true),fill:'FFD6D4CA',border:'lrtb',align:{horizontal:'center',vertical:'middle',wrapText:true}};
const ITEM:Style={font:arial(10),border:'lrtb',align:{horizontal:'center',vertical:'middle'}};
const BOX:Style={font:arial(9),border:'lrtb',align:{horizontal:'center',vertical:'middle',wrapText:true}};
const SUM:Style={...BOX,numFmt:'0.00'};
const LABEL:Style={font:{...arial(10,true),color:BLACK},align:{horizontal:'center',vertical:'middle'}};
const TOTAL:Style={font:{name:'Calibri',size:11,bold:true,color:{theme:1},family:2,scheme:'minor'},numFmt:'0.00'};

const SIDE={l:'left',r:'right',t:'top',b:'bottom'} as const;
const borders=(sides:string):Partial<ExcelJS.Borders>=>Object.fromEntries([...sides].map(s=>[SIDE[s as keyof typeof SIDE],{style:'thin',color:BLACK}]));
function put(ws:ExcelJS.Worksheet,address:string,value:ExcelJS.CellValue|undefined,s:Style={}):void {
 const c=ws.getCell(address);if(value!==undefined)c.value=value;
 if(s.font)c.font=s.font;if(s.fill)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:s.fill}};
 if(s.border)c.border=borders(s.border);if(s.align)c.alignment=s.align;if(s.numFmt)c.numFmt=s.numFmt;
}
// As Excel stores a bordered merge: the top-left cell keeps its style; every other cell carries only the outer edges it sits on.
function merge(ws:ExcelJS.Worksheet,range:string):void {
 ws.mergeCellsWithoutStyle(range);
 const [a,b]=range.split(':'),top=ws.getCell(a!),end=ws.getCell(b!),own=top.border??{};
 for(let r=Number(top.row);r<=Number(end.row);r++)for(let c=Number(top.col);c<=Number(end.col);c++){
  if(r===Number(top.row)&&c===Number(top.col))continue;
  const edge={left:c===Number(top.col),right:c===Number(end.col),top:r===Number(top.row),bottom:r===Number(end.row)};
  const kept=Object.fromEntries(Object.entries(own).filter(([k,v])=>v&&edge[k as keyof typeof edge]));
  if(Object.keys(kept).length)ws.getCell(r,c).border=kept;
 }
}
const cols=(from:string,to:string)=>Array.from({length:to.charCodeAt(0)-from.charCodeAt(0)+1},(_,i)=>String.fromCharCode(from.charCodeAt(0)+i));

const HEADINGS:[string,string,string?][]=[
 ['A1','EQUIPMENT','A1:M1'],['A2','No.','A2:A6'],['B2','KKS No.','B2:B6'],['C2','Description','C2:C6'],['D2','Brand','D2:D6'],['E2','Model','E2:E6'],
 ['F2','Configuration','F2:F6'],['G2','Starter Type','G2:G6'],['H2','Vital','H2:H6'],['I2','Essential','I2:I6'],['J2','Non-Essential','J2:J6'],['K2','Re-starting','K2:K6'],['L2','C/I/S','L2:L6'],
 ['M2','CONSUMED LOAD\nA','M2:M5'],['M6','kW'],['N1','FEEDER RATING \nB','N1:N5'],['N6','kW'],['O1','In\n(A)','O1:O6'],['P1','Un','P1:P6'],
 ['Q1','LOAD FACTOR\nA/B','Q1:Q4'],['Q5','C'],['Q6','in decimals'],['R1','EFFICIENCY\nat load factor C','R1:R4'],['R5','D'],['R6','in decimals'],
 ['S1','POWER FACTOR\nat load','S1:S4'],['S5','factor C'],['S6','cos φ'],
 ['T1','kW = A/D.                                CONSUMED LOAD\nkVAr = kW.tg φ\nkVAr = kW.tg φ\nkVA = sqrt(kW² + kVAr²)','T1:Y3'],
 ['T4','Continuous','T4:U4'],['T5','E','T5:U5'],['V4','Intermittent','V4:W4'],['V5','F','V5:W5'],['X4','Stand-by','X4:Y4'],['X5','G','X5:Y5'],
 ['T6','kW'],['U6','kVAr'],['V6','kW'],['W6','kVAr'],['X6','kW'],['Y6','kVAr'],
];

// Lays out the sheet for this many items; returns the first summary row.
export function equipmentLayout(ws:ExcelJS.Worksheet,items:number):number {
 const summary=7+Math.max(MIN_ROWS,items);
 WIDTHS.forEach((w,i)=>{ws.getColumn(i+1).width=w;});
 for(const c of [26,27,28]){ws.getColumn(c).width=9;ws.getColumn(c).hidden=true;}
 HEIGHTS.forEach((h,i)=>{ws.getRow(i+1).height=h;});
 for(const [address,label] of HEADINGS)put(ws,address,label,address==='T1'?{...HEAD,align:{...HEAD.align,horizontal:'left'}}:HEAD);
 for(const [,,range] of HEADINGS)if(range)merge(ws,range);
 for(let r=7;r<summary;r++)for(const c of cols('A',LAST))put(ws,`${c}${r}`,undefined,c>='T'?{...ITEM,numFmt:'0.00'}:ITEM);
 ws.views=[{state:'frozen',xSplit:0,ySplit:6,topLeftCell:'A7',activeCell:'A7',style:'pageBreakPreview',zoomScale:84}];
 ws.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,scale:36,printArea:`A1:${LAST}${summary+14}`,printTitlesRow:'1:6',
  margins:{left:0.7086614173228347,right:0.7086614173228347,top:0.7480314960629921,bottom:0.7480314960629921,header:0.3149606299212598,footer:0.3149606299212598}};
 return summary;
}

export function writeEquipmentRows(ws:ExcelJS.Worksheet,rows:readonly LoadRow[]):void {
 ws.getCell('Z4').value='Protection Device Rating (A)';
 const keys=['kks','description','brand','model','config','starter','vital','essential','nonEssential','restart','cis','consumedKw','ratedKw','inA','un'] as const;
 Array.from({length:Math.max(MIN_ROWS,rows.length)},(_,index)=>rows[index]??emptyLoad()).forEach((item,index)=>{
  const row=index+7,consumed=num(item.consumedKw),rated=num(item.ratedKw),efficiency=fraction(item.efficiency),pf=fraction(item.pf);
  // Excel reads a blank load factor as 0, so a rated item with no consumed load shows 0 kW; the cached results say the same.
  const bal=balance(consumed===null&&rated!==null&&!item.consumedKw.trim()?{...item,consumedKw:'0'}:item);
  if(index<rows.length)ws.getCell(`A${row}`).value=index+1;
  ws.getCell(`Z${row}`).value=num(item.protA)??(item.protA.trim()||null);
  keys.forEach((key,i)=>{
   const raw=item[key].trim(),n=['consumedKw','ratedKw','inA'].includes(key)?num(raw):null;
   ws.getCell(row,i+2).value=n===null?(raw||null):n;
  });
  // As in the template, consumed load = feeder rating × load factor; without a rating the typed consumed load stays as a value.
  // M, R and S feed the kW/kVAr formulas, so text there ("TBC") is left out: it would turn the whole summary into #VALUE!.
  if(consumed!==null&&rated){
   ws.getCell(`Q${row}`).value=consumed/rated;
   ws.getCell(`M${row}`).value={formula:`IFERROR(IF(N${row}="","",N${row}*Q${row}),"")`,result:consumed};
  }else if(consumed===null){
   ws.getCell(`M${row}`).value=item.consumedKw.trim()?null:{formula:`IFERROR(IF(N${row}="","",N${row}*Q${row}),"")`,result:rated===null?'':0};
  }
  ws.getCell(`R${row}`).value=efficiency;
  ws.getCell(`S${row}`).value=pf;
  for(const [duty,kwCol,kvarCol] of [['C','T','U'],['I','V','W'],['S','X','Y']] as const){
   const kw=bal.duty===duty?bal.kw:null,kvar=bal.duty===duty?bal.kvar:null;
   ws.getCell(`${kwCol}${row}`).value={formula:`IF(OR(ISBLANK($L${row}),ISBLANK($M${row})),"",IF($L${row}="${duty}",$M${row}/IF($R${row}="",1,$R${row}),""))`,result:kw??''};
   ws.getCell(`${kvarCol}${row}`).value={formula:`IF(OR(ISBLANK($L${row}),ISBLANK($M${row}),ISBLANK($S${row})),"",IF($L${row}="${duty}",TAN(ACOS($S${row}))*${kwCol}${row},""))`,result:kvar??''};
  }
 });
}

// The summary block under the items (row s = first summary row). Keeps the template's intermittent kVAr line, W = largest × factor.
export function writeEquipmentSummary(ws:ExcelJS.Worksheet,s:number,rows:readonly LoadRow[],factors:Factors,margin:string):void {
 const t=panelTotals(rows.map(balance),factors,margin),last=s-1,m=t.margin;
 const loaded={T:t.total.C.kw*t.factors.C,U:t.total.C.kvar*t.factors.C,V:t.total.I.kw*t.factors.I,W:t.largest.I.kvar*t.factors.I,X:t.total.S.kw*t.factors.S,Y:t.total.S.kvar*t.factors.S};
 const largest={T:t.largest.C.kw,U:t.largest.C.kvar,V:t.largest.I.kw,W:t.largest.I.kvar,X:t.largest.S.kw,Y:t.largest.S.kvar};
 const total={T:t.total.C.kw,U:t.total.C.kvar,V:t.total.I.kw,W:t.total.I.kvar,X:t.total.S.kw,Y:t.total.S.kvar};
 const kw=Math.max(largest.T,loaded.T)+Math.max(largest.V,loaded.V)+Math.max(largest.X,loaded.X);
 const kvar=Math.max(largest.U,loaded.U)+Math.max(largest.W,loaded.W)+Math.max(largest.Y,loaded.Y),kva=Math.hypot(kw,kvar);
 const f=(formula:string,result:number)=>({formula,result});
 // Running load and its margin, left of the factors.
 put(ws,`C${s}`,'Normal Running Plant Load:',LABEL);merge(ws,`C${s}:L${s}`);
 put(ws,`C${s+2}`,'With Design Margin',LABEL);merge(ws,`C${s+2}:L${s+2}`);
 put(ws,`C${s+1}`,f(`MAX(T${s+2}:T${s+3})+MAX(V${s+2}:V${s+3})+MAX(X${s+2}:X${s+3})`,kw),{...TOTAL,align:{horizontal:'right'}});merge(ws,`C${s+1}:G${s+1}`);
 put(ws,`I${s+1}`,f(`MAX(U${s+2}:U${s+3})+MAX(W${s+2}:W${s+3})+MAX(Y${s+2}:Y${s+3})`,kvar),TOTAL);
 put(ws,`K${s+1}`,f(`SQRT(C${s+1}^2+I${s+1}^2)`,kva),TOTAL);
 put(ws,`C${s+3}`,f(`C${s+1}*(1+${m})`,kw*(1+m)),{...TOTAL,align:{horizontal:'right'}});merge(ws,`C${s+3}:G${s+3}`);
 put(ws,`I${s+3}`,f(`I${s+1}*(1+${m})`,kvar*(1+m)),TOTAL);put(ws,`K${s+3}`,f(`K${s+1}*(1+${m})`,kva*(1+m)),TOTAL);
 for(const r of [s+1,s+3]){put(ws,`H${r}`,'kW');put(ws,`J${r}`,'kVAr');put(ws,`L${r}`,'kVA');}
 put(ws,`N${s}`,undefined,{numFmt:'0.00'});
 // Operating factors.
 put(ws,`P${s}`,'Operating Factors',BOX);put(ws,`Q${s}`,undefined,BOX);merge(ws,`P${s}:Q${s}`);
 (['C','I','S'] as const).forEach((d,i)=>{put(ws,`P${s+1+i}`,d,BOX);put(ws,`Q${s+1+i}`,t.factors[d],BOX);});
 // Load basis per duty.
 put(ws,`R${s}`,'TOTAL',BOX);merge(ws,`R${s}:S${s+1}`);
 put(ws,`R${s+2}`,'Largest Load',BOX);merge(ws,`R${s+2}:S${s+2}`);
 put(ws,`R${s+3}`,'Loading with Operating Factor',{...BOX,border:'lrt'});merge(ws,`R${s+3}:S${s+3}`);
 put(ws,`R${s+4}`,'Total Base kVA without Diversity Factors',{font:{...TOTAL.font},border:'lrtb',align:{horizontal:'center',wrapText:true}});merge(ws,`R${s+4}:S${s+5}`);
 const factorRow={T:s+1,U:s+1,V:s+2,W:s+2,X:s+3,Y:s+3} as const;
 for(const c of cols('T','Y') as (keyof typeof total)[]){
  put(ws,`${c}${s}`,f(`SUM(${c}7:${c}${last})`,total[c]),SUM);merge(ws,`${c}${s}:${c}${s+1}`);
  put(ws,`${c}${s+2}`,f(`MAX(${c}7:${c}${last})`,largest[c]),SUM);
  put(ws,`${c}${s+3}`,f(`${c}${c==='W'?s+2:s}*Q${factorRow[c]}`,loaded[c]),SUM);
 }
 for(const [c,o,d,sides] of [['T','U','C','rtb'],['V','W','I','lrtb'],['X','Y','S','lrtb']] as const){
  put(ws,`${c}${s+4}`,f(`SQRT(${c}${s}^2+${o}${s}^2)`,t.baseKva[d]),{...SUM,font:arial(9,true),border:sides});merge(ws,`${c}${s+4}:${o}${s+5}`);
 }
 put(ws,`B${s+6}`,'NOTES');
 // Hidden columns: read back by Import (readEquipment).
 put(ws,`AA${s+7}`,'Design margin');put(ws,`AB${s+7}`,m);
}
