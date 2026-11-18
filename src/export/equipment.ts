import ExcelJS from 'exceljs';
import {downloadFile} from '../store/project';
import {fillRow,indexCatalogue,num,type CatalogueRow} from '../engine/loads';
import {equipmentLayout,writeEquipmentRows,writeEquipmentSummary} from './equipment-layout';
import type {LoadPanel} from '../store/schema';

// Live formulas with cached results, so the sheet opens with numbers and recalculates when edited. Reads back in through Import (readEquipment).
const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CAT_HEAD=['Brand','Model /\nPart Number','Configuration','Rated Input Power\n(kW)','Protection Device\nRating (A)','In\n(A)','Un','Efficiency','Power Factor','Remarks / source'];
const value=(v:string)=>{const n=num(v);return n===null?v:n;};
const head=(r:ExcelJS.Row)=>{r.font={bold:true};r.alignment={wrapText:true,vertical:'middle',horizontal:'center'};r.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE8EDF2'}};c.border={bottom:{style:'thin'}};});};
function sheetName(name:string,taken:Set<string>):string {
 const base=name.replace(/[\\/?*[\]:]/g,' ').replace(/^'+|'+$/g,'').trim().slice(0,31)||'Panel';let n=base,i=2;
 while(taken.has(n.toLowerCase())){const tail=` (${i++})`;n=base.slice(0,31-tail.length)+tail;}
 taken.add(n.toLowerCase());return n;
}
function catalogueSheet(book:ExcelJS.Workbook,catalogue:readonly CatalogueRow[]):void {
 const ws=book.addWorksheet('Catalogue');ws.addRow(CAT_HEAD);head(ws.getRow(1));
 for(const e of catalogue)ws.addRow([e.brand,e.model,e.config,value(e.ratedKw),value(e.protA),value(e.inA),e.un,value(e.efficiency),value(e.pf),e.source]);
 ws.columns.forEach((c,i)=>{c.width=[14,26,24,12,12,10,22,11,11,40][i]??12;});ws.views=[{state:'frozen',ySplit:1}];
}
const bytesOf=async(book:ExcelJS.Workbook)=>await book.xlsx.writeBuffer() as BlobPart;
const fileName=(name:string,suffix:string)=>`${name.replace(/[^\w.-]+/g,'-').replace(/^-|-$/g,'')||'project'}-${suffix}.xlsx`;

// Cover page cell for cell as the engineer's own cover ("Cover page" of their saved export): grey title box, one empty block above and
// below it, the revision block and the file name. Blank boxes are for the user to fill in. Change it only against that workbook.
function coverSheet(book:ExcelJS.Workbook,title:string,file:string):void {
 const ws=book.addWorksheet('Cover page'),edge={style:'thin' as const,color:{argb:'FF000000'}};
 const box=(sides:string)=>Object.fromEntries([...sides].map(x=>[{l:'left',r:'right',t:'top',b:'bottom'}[x]!,edge]));
 [5.6640625,10.6640625,20.33203125,6.5,32.6640625,10.6640625,15.6640625,16.33203125,12.6640625,8.83203125].forEach((w,i)=>{ws.getColumn(i+1).width=w;});
 const heights:Record<number,number>={2:13.75,5:40,6:40,7:40,20:24,21:24,28:13.5,29:13.5,30:13.5,31:13.5,32:10.25,33:15,34:13,35:15,36:15,37:10,38:10,39:10};
 for(let r=1;r<=45;r++){const h=heights[r]??(r>=8&&r<=27?12.75:null);if(h)ws.getRow(r).height=h;for(let c=1;c<=10;c++)ws.getCell(r,c).font={name:'Arial',size:10,family:2};}
 const set=(a:string,v:ExcelJS.CellValue,font:Partial<ExcelJS.Font>,sides='',align:Partial<ExcelJS.Alignment>={},range?:string)=>{
  const c=ws.getCell(a);if(v!==null)c.value=v;c.font={name:'Arial',family:2,...font};if(sides)c.border=box(sides);c.alignment=align;
  if(range){ws.mergeCellsWithoutStyle(range);const [,end]=range.split(':'),last=ws.getCell(end!);
   for(let r=Number(c.row);r<=Number(last.row);r++)for(let k=Number(c.col);k<=Number(last.col);k++){if(r===Number(c.row)&&k===Number(c.col))continue;
    const keep=[...sides].filter(x=>(x==='l'&&k===Number(c.col))||(x==='r'&&k===Number(last.col))||(x==='t'&&r===Number(c.row))||(x==='b'&&r===Number(last.row))).join('');if(keep)ws.getCell(r,k).border=box(keep);}}
 };
 const middle={horizontal:'center',vertical:'middle'} as const,centre={horizontal:'center'} as const;
 set('A1',null,{size:10},'',centre,'A1:J4');
 set('A5',title,{size:16,bold:true},'lrt',middle,'A5:J5');set('A6','LOAD LIST',{size:16,bold:true},'lr',{...middle,wrapText:true},'A6:J6');set('A7',null,{size:16,bold:true},'lrb',middle,'A7:J7');
 for(let r=5;r<=7;r++)for(let c=1;c<=10;c++)ws.getCell(r,c).fill={type:'pattern',pattern:'solid',fgColor:{theme:0,tint:-0.249977111117893},bgColor:{indexed:64}} as ExcelJS.Fill;// ExcelJS writes tint/indexed; its types omit them
 set('A8',null,{size:10},'tb',centre,'A8:J19');
 // Revision block, newest at the top, headings on row 30.
 for(let r=20;r<=30;r++){
  const align:Partial<ExcelJS.Alignment>=r<=21?middle:centre,font={size:9,...r===30?{bold:true}:{}},drop=(s:string)=>r===29?s.replace('b',''):s;
  for(const [col,sides,extra] of [['A','lrtb',{}],['B','lrtb',{wrapText:r<30}],['C','rtb',{wrapText:r<30}],['G','lrtb',{}],['H','lrtb',{wrapText:r<=21}],['I','lrtb',{}],['J','lrtb',{}]] as const)
   set(`${col}${r}`,null,font,drop(col==='C'&&r===30?'lrtb':sides),{...align,...extra},col==='C'?`C${r}:F${r}`:undefined);
  if(r<30){ws.getCell(`G${r}`).numFmt='yyyy\\-mm\\-dd;@';ws.getCell(`I${r}`).numFmt='mm-dd-yy';ws.getCell(`J${r}`).numFmt='mm-dd-yy';}
 }
 set('A31',null,{size:9,bold:true},'',centre,'A31:J31');set('A32',null,{size:10},'',centre,'A32:J32');
 set('A33','File name',{size:10,bold:true},'lrtb',{horizontal:'left',vertical:'middle'},'A33:B33');
 set('C33',{formula:'IFERROR(MID(CELL("filename",A1),FIND("[",CELL("filename",A1),1)+1,FIND("]",CELL("filename",A1),1)-FIND("[",CELL("filename",A1),1)-1),"")',result:file},{size:10},'lrtb',{horizontal:'left',vertical:'middle'},'C33:J33');
 set('A34',null,{size:9,bold:true},'lrb',{vertical:'middle'},'A34:B34');set('C34',null,{size:9},'lrb',{vertical:'middle'},'C34:J34');
 set('A35',null,{size:10},'t',centre,'A35:J45');
 ws.views=[{style:'pageBreakPreview'}];
 ws.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:1,scale:86,horizontalCentered:true,printArea:'A1:J35',
  margins:{left:0.78740157480315,right:0.78740157480315,top:0.590551181102362,bottom:0.393700787401575,header:0.590551181102362,footer:0.393700787401575}};
}

// The deliverable: a cover page, then one sheet per panel laid out as the engineer's panel sheet.
export function loadsBook(panels:readonly LoadPanel[],catalogue:readonly CatalogueRow[],title='',file=''):ExcelJS.Workbook {
 if(!panels.some(p=>p.rows.length))throw Error('Add at least one item of equipment before exporting.');
 const book=new ExcelJS.Workbook(),idx=indexCatalogue(catalogue),taken=new Set(['cover page']);
 coverSheet(book,title,file);
 for(const p of panels){
  const ws=book.addWorksheet(sheetName(p.name,taken)),rows=p.rows.map(r=>fillRow(r,idx).row);
  const summary=equipmentLayout(ws,rows.length);
  writeEquipmentRows(ws,rows);
  writeEquipmentSummary(ws,summary,rows,p.factors,p.margin);
 }
 return book;
}
export async function exportLoads(panels:readonly LoadPanel[],catalogue:readonly CatalogueRow[],name:string):Promise<void> {
 const file=fileName(name,'load-list');downloadFile(file,await bytesOf(loadsBook(panels,catalogue,name,file)),XLSX);
}
export async function exportCatalogue(catalogue:readonly CatalogueRow[],name:string):Promise<void> {
 if(!catalogue.length)throw Error('The catalogue is empty.');
 const book=new ExcelJS.Workbook();catalogueSheet(book,catalogue);downloadFile(fileName(name,'catalogue'),await bytesOf(book),XLSX);
}
