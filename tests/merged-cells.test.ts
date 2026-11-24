import {describe,expect,it} from 'vitest';
import ExcelJS from 'exceljs';
import {bestHeader,itemRows,mappingAt,readTables,toSheetRows} from '../src/import/load-list';
import {readEquipment} from '../src/import/equipment';
import {readPanels} from '../src/import/panels';

// Made-up workbooks laid out the way many organisations draw load lists: titles and section headings merged across the
// table, headings merged over two rows or two columns, a brand or duty merged down several items, and an item on two lines.
const read=async(fill:(s:ExcelJS.Worksheet)=>void,name:string)=>{
 const book=new ExcelJS.Workbook();fill(book.addWorksheet(name));
 return readTables(new File([await book.xlsx.writeBuffer() as BlobPart],'merged.xlsx'));
};
const put=(s:ExcelJS.Worksheet,at:string,rows:(string|number)[][])=>{const start=s.getCell(at);rows.forEach((r,i)=>r.forEach((v,j)=>{if(v!=='')s.getCell(Number(start.row)+i,Number(start.col)+j).value=v;}));};

describe('reading merged cells',()=>{
 it('reads an equipment list with merged titles, headings, shared cells and a two-line item',async()=>{
  const tables=await read(s=>{
   s.getCell('A1').value='EQUIPMENT LIST';s.mergeCells('A1:H1');
   put(s,'A2',[['KKS','Description','Brand','Model','Duty','Consumed Load (kW)','','Rated Input Power (kW)']]);
   for(const c of ['A','B','C','D','E','H'])s.mergeCells(`${c}2:${c}3`);
   s.mergeCells('F2:G3');// the consumed load heading covers two columns; the values sit in the second
   s.getCell('A4').value='PUMPS';s.mergeCells('A4:H4');
   put(s,'A5',[['P-101','Fire pump','ACME','X1','C','',7.5,11],['P-102','Jockey pump','','X2','','',1.1,1.5],['P-103','Booster pump','ACME','X3','S','',3,4],['','','','','','','',''],['P-104','Sump pump with float switch','','','I','',0.75,1.1]]);
   s.mergeCells('C5:C6');s.mergeCells('E5:E6');// one brand and duty for both pumps
   s.mergeCells('B7:B8');// the booster pump's description runs over two lines
   s.mergeCells('B9:C9');// a long description merged into the brand column
  },'Pump House');
  const rows=readEquipment(tables,'merged.xlsx').panels[0]!.rows;
  expect(rows.map(r=>[r.kks,r.description,r.brand,r.model,r.cis,r.consumedKw,r.ratedKw])).toEqual([
   ['P-101','Fire pump','ACME','X1','C','7.5','11'],
   ['P-102','Jockey pump','ACME','X2','C','1.1','1.5'],
   ['P-103','Booster pump','ACME','X3','S','3','4'],
   ['P-104','Sump pump with float switch','','','I','0.75','1.1'],
  ]);
 });
 it('reads a panel load list with a merged title, section heading, two-column heading and a shared voltage',async()=>{
  const tables=await read(s=>{
   s.getCell('A1').value='DB-L1 fed from MSB-01';s.mergeCells('A1:F1');
   put(s,'A2',[['Description','Rated Input Power (kW)','','Voltage (V)','PF','Protection Device Rating (A)']]);s.mergeCells('B2:C2');
   s.getCell('A3').value='LIGHTING';s.mergeCells('A3:F3');
   put(s,'A4',[['Lighting circuit 1','',2,230,0.9,16],['Socket outlets','',3,230,0.85,20],['Water heater','',1.5,'',1,16]]);s.mergeCells('D5:D6');
  },'Panels');
  const [table]=tables,header=bestHeader(table!.rows),mapping=mappingAt(table!,header);
  expect([header,mapping.D,mapping.G,mapping.F]).toEqual([1,0,2,3]);
  const want=[['Lighting circuit 1','2','230'],['Socket outlets','3','230'],['Water heater','1.5','230']];
  expect(toSheetRows(itemRows(table!),header,mapping).map(r=>[r.D,r.G,r.F])).toEqual(want);
  const loads=readPanels(tables).candidates.filter(c=>c.kind==='table');
  expect(loads.map(c=>[c.row.D,c.row.G,c.row.F])).toEqual(want);
  expect(loads.every(c=>c.row.C==='DB-L1')).toBe(true);
 });
 it('leaves a sheet without merges as it is',()=>{
  const t={name:'Plain',formulaCells:0,rows:[['Description','kW'],['Pump','5']]};
  expect(itemRows(t)).toBe(t.rows);
 });
});
