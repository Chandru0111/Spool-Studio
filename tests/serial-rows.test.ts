import {describe,expect,it} from 'vitest';
import ExcelJS from 'exceljs';
import {readTables} from '../src/import/load-list';
import {readEquipment} from '../src/import/equipment';

// A made-up consumer list laid out as organisations often draw them: an S/N column, headings over two rows with merges,
// a row of column numbers, a section title, an item on two lines, a numbered group with sub-items, a total and a note.
async function upsList() {
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('UPS DB-1');
 const put=(row:number,values:(string|number)[])=>values.forEach((v,i)=>{if(v!=='')s.getCell(row,i+1).value=v;});
 put(1,['MADE-UP CONSUMER LIST']);s.mergeCells('A1:K1');
 put(2,['S/N','KKS No.','Consumer Description','Rating','','Eff.','PF (cos φ)','Load (kW)','','','Rated Power (kW)']);
 put(3,['','','','In(A)','Un','','','Continuous','Intermittent','Standby','']);
 for(const c of ['A','B','C','F','G','K'])s.mergeCells(`${c}2:${c}3`);
 s.mergeCells('D2:E2');s.mergeCells('H2:J2');
 put(4,[1,2,3,4,5,6,7,8,9,10,11]);
 put(5,['SERVER ROOM']);s.mergeCells('A5:K5');
 put(6,[1,'10CBA01','Server panel 1',32,'220Vac',0.95,0.9,5,'','',6]);
 put(7,[2,'10CBA02','Server panel 2',32,'220Vac',0.94,0.85,'',3,'','']);
 put(8,['','','','','','','','','','',8]);s.mergeCells('A7:A8');// the rated power is written on the item's second line
 put(10,[3,'10CBA03','Spare',40,'220Vac']);
 put(11,[4,'','CCTV system']);
 put(12,['4.1','10CCT01','Camera A',16,'220Vac','','','',0.5,'','']);
 put(13,['4.2','10CCT01','Camera B',16,'220Vac','','','','',0.5,'']);
 put(14,['','','TOTAL','','','','',5,3.5,0.5,14]);
 put(15,['Note: every consumer here is fed from the UPS.']);s.mergeCells('A15:K15');
 return readTables(new File([await book.xlsx.writeBuffer() as BlobPart],'made-up.xlsx'));
}

describe('reading a load list by its S/N column',()=>{
 it('takes the numbered rows as the items and reads each value from its column',async()=>{
  const read=readEquipment(await upsList(),'made-up.xlsx'),rows=read.panels[0]!.rows;
  expect(rows.map(r=>[r.kks,r.description,r.inA,r.un,r.efficiency,r.pf,r.cis,r.consumedKw,r.ratedKw])).toEqual([
   ['10CBA01','Server panel 1','32','220Vac','0.95','0.9','C','5','6'],
   ['10CBA02','Server panel 2','32','220Vac','0.94','0.85','I','3','8'],
   ['10CBA03','Spare','40','220Vac','','','','',''],
   ['10CCT01','Camera A','16','220Vac','','','I','0.5',''],
   ['10CCT01','Camera B','16','220Vac','','','S','0.5',''],
  ]);
  // Each KKS names one item, so a repeat is pointed out rather than guessed at.
  expect(read.notes.join(' ')).toMatch(/10CCT01/);
 });
});
