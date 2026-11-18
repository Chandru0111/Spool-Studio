import {describe,it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {readTables} from '../src/import/load-list';
import {readPanels} from '../src/import/panels';
import {suggestSheet,defaultSuggestions} from '../src/engine/suggest';

// Synthetic workbooks laid out the way load lists arrive: grouped by the MCC/DB panel each load hangs off.
const header=['To','Phases','Voltage','kW','PF','Breaker A','Length m'];
const stacked={name:'Load List',formulaCells:0,rows:[
 ['PROJECT X LOAD SCHEDULE','','','','','',''],
 ['DB-L1 (FED FROM MSB-01)','','','','','',''],header,
 ['LTG-1','1','230','1.2','0.9','10','25'],['SKT-1','1','230','2','0.9','20','30'],['TOTAL','','','3.2','','',''],
 ['','','','','','',''],
 ['MCC-1 FED FROM MSB-01','','','','','',''],header,
 ['P-101','3','400','22','0.86','50','85'],
 header,// page break: the header repeats with no title
 ['P-102','3','400','30','0.86','63','92'],
]};

describe('workbooks with one load list per panel',()=>{
 it('reads stacked panel blocks on one sheet and gives each load its panel as From',()=>{
  const r=readPanels([stacked]),loads=r.candidates.filter(c=>c.kind==='table');
  expect(loads.map(c=>[c.row.C,c.row.D])).toEqual([['DB-L1','LTG-1'],['DB-L1','SKT-1'],['MCC-1','P-101'],['MCC-1','P-102']]);
  expect(loads.every(c=>c.inferred.C?.startsWith('Panel title')&&c.include)).toBe(true);
  expect(r.boards).toEqual(['DB-L1','MCC-1']);
  expect(r.notes.join(' ')).toContain('1 total row was skipped');
 });
 it('adds each panel feeder from its "fed from" title, unticked until it has cable data',()=>{
  const feeders=readPanels([stacked]).candidates.filter(c=>c.kind==='feeder');
  expect(feeders.map(c=>[c.row.C,c.row.D,c.include])).toEqual([['MSB-01','DB-L1',false],['MSB-01','MCC-1',false]]);
  // Already listed in the workbook: no second feeder row.
  const listed=readPanels([{...stacked,rows:[...stacked.rows,header,['DB-L1','3','400','','','63','40']]}]).candidates.filter(c=>c.kind==='feeder');
  expect(listed.map(c=>c.row.D)).toEqual(['MCC-1']);
 });
 it('takes the panel from the worksheet name and keeps a From the list already gives',()=>{
  const r=readPanels([
   {name:'Ratings',formulaCells:0,rows:[['Size','Rating'],['16','87']]},
   {name:'DB-L2',formulaCells:0,rows:[[...header,'From'],['FCU-1','1','230','0.8','0.9','10','40',''],['FCU-2','1','230','0.8','0.9','10','45','DB-L2A']]},
  ]);
  expect(r.candidates.map(c=>[c.row.C,c.inferred.C?.startsWith('Worksheet')??false])).toEqual([['DB-L2',true],['DB-L2A',false]]);
  expect(r.sheets).toBe(1);
 });
 it('flags rows with no panel instead of guessing one',()=>{
  const r=readPanels([{name:'Sheet1',formulaCells:0,rows:[header,['P-201','3','400','5','0.85','16','30']]}]);
  expect(r.candidates[0]!.row.C).toBe('');expect(r.notes.join(' ')).toContain('1 row has no panel');
 });
 it('reads merged title cells from a real XLSX and sizes the loads under their panel',async()=>{
  const book=new ExcelJS.Workbook(),ws=book.addWorksheet('Sheet1');
  ws.addRow(['DB-L3 fed from SMSB-1']);ws.mergeCells('A1:G1');ws.addRow(header);ws.addRow(['AHU-1','3','400','15','0.85','32','60']);
  const [table]=await readTables(new File([await book.xlsx.writeBuffer() as BlobPart],'panels.xlsx'));
  const r=readPanels([table!]),load=r.candidates.find(c=>c.kind==='table')!;
  expect(load.row).toMatchObject({C:'DB-L3',D:'AHU-1',G:'15',AH:'60'});
  expect(r.candidates.find(c=>c.kind==='feeder')!.row).toMatchObject({C:'SMSB-1',D:'DB-L3'});
  const sheet=suggestSheet(r.candidates.map(c=>c.row),defaultSuggestions);
  expect(sheet.results[0]!.cells.AG).toBe('PASS');
 });
 // Equipment-register layout (marine/crane style): a sheet per panel named in words, two header rows, kW split by duty,
 // a load-balance summary under the table, a search sheet repeating the loads and a brand catalogue. Made-up values.
 it('reads an equipment register with a worksheet per panel named in words',()=>{
  const top=['No.','KKS No.','Description','C/I/S','Consumed Load (kW)','Rated Input Power (kW)','Protection Device Rating (A)','In (A)','Un','Load Factor','Power Factor','Continuous Load','Intermittent Load'];
  const sub=[...top.slice(0,11),'kW','kW'];
  const loads=[['1','','Fire pump','C','10','12','32','20','400','0.83','0.85','10.5',''],['2','','Winch','I','30','37','100','70','400','0.81','0.86','','31']];
  const room=(name:string,rows:string[][])=>({name,formulaCells:0,rows:[['EQUIPMENT LIST — ROOM 1'],['How it works','Yellow = user input'],['EQUIPMENT LIST'],top,sub,...rows,
   ['','','','Load basis','C kW','C kVAr','I kW'],['','','','Total connected load','10.5','6','31'],['','','','Largest single load','10.5','6','31']]});
  const r=readPanels([
   {name:'Equipment List Register',formulaCells:0,rows:[['Room','Tab name'],['Room 1','Main LV Switchboard']]},
   room('Main LV Switchboard',loads),room('Hoist-Gantry Panel',[['1','','','','','','','','','','','','']]),
   {name:'Searchbar',formulaCells:0,rows:[sub,...loads]},
   {name:'Brand (Acme)',formulaCells:0,rows:[['Brand','Model','Rated Input Power (kW)','Protection Device Rating (A)','Un'],['ACME','X1','12','32','400']]},
  ]);
  expect(r.candidates.map(c=>c.row)).toMatchObject([
   {C:'Main LV Switchboard',D:'Fire pump',E:'3',F:'400',G:'12',H:'',I:'0.85',N:'32'},
   {C:'Main LV Switchboard',D:'Winch',E:'3',F:'400',G:'37',H:'',I:'0.86',N:'100'}]);
  expect(r.candidates[0]!.inferred.E).toBe('Voltage 400 V: three-phase');
  // In (A) 20 A vs Ib = 12 kW / (√3 × 400 V × 0.85) = 20.4 A: fine. Winch: 37 kW → 62.1 A vs In 70 A: within 20%.
  expect(r.notes.join(' ')).not.toContain('differs from the list');
  expect(r.columns).toEqual(expect.arrayContaining(['Rated Input Power (kW) → G · Design Load (kW)','Protection Device Rating (A) → N · Protection Rating In (A)','Un → F · Operating Voltage (V)',
   'In (A) → checked against the calculated design current Ib','Load Factor → load balance only; not used to size one cable','Description → D · To','Phases: not in the file; worked out from the voltage (italic).']));
  expect(r.columns.join(' ')).toContain('Cable run length: not in the file');
  expect(r.boards).toEqual(['Main LV Switchboard','Hoist-Gantry Panel']);
  const notes=r.notes.join(' ');
  expect(notes).toContain('2 rows on Searchbar repeat loads');expect(notes).toContain('2 total rows were skipped');expect(notes).toContain('with no load name');
  expect(notes).not.toContain('no panel');
 });
 it('keeps identical loads on different panels',()=>{
  const sheet=(name:string)=>({name,formulaCells:0,rows:[header,['Lighting','1','230','2','0.9','16','20']]});
  expect(readPanels([sheet('DB-1'),sheet('DB-2')]).candidates.map(c=>c.row.C)).toEqual(['DB-1','DB-2']);
 });
 it("flags a load whose list In (A) is far from the calculated Ib, and reads 230 V as single-phase",()=>{
  const r=readPanels([{name:'DB-L1',formulaCells:0,rows:[['Description','kW','Un','PF','Protection Device Rating (A)','In (A)'],['Heater','2','230','1','16','8.7'],['Pump','11','400','0.85','63','60']]}]);
  expect(r.candidates.map(c=>c.row.E)).toEqual(['1','3']);
  expect(r.notes.join(' ')).toContain('1 load: the calculated design current Ib differs');expect(r.notes.join(' ')).toContain('Pump (In 60 A, Ib 18.7 A)');
 });
});
