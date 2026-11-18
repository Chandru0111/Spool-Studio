import {describe,it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {balance,emptyEntry,emptyLoad,fillRow,indexCatalogue,panelTotals,plantTotals,scenario,type LoadRow} from '../src/engine/loads';
import {readTables} from '../src/import/load-list';
import {catalogueFromPages,mergeSizing,parseEquipmentReply,readEquipment,toSizing,verify} from '../src/import/equipment';
import {emptyRow} from '../src/engine/sheet';
import {Project} from '../src/store/schema';
import {fresh} from '../src/ui/state';
import {loadsBook} from '../src/export/equipment';
import {equipmentLayout,writeEquipmentRows,writeEquipmentSummary} from '../src/export/equipment-layout';

// Made-up equipment and brands only.
const row=(p:Partial<LoadRow>):LoadRow=>({...emptyLoad(),...p});
const cat=[{...emptyEntry(),brand:'Acme',model:'M-100',config:'400 V, 3-phase, 50 Hz',ratedKw:'45',inA:'81',un:'400 V, 3-phase, 50 Hz',efficiency:'0.94',pf:'0.85'},
 {...emptyEntry(),brand:'Acme',model:'M-100',config:'690 V, 3-phase, 50 Hz',ratedKw:'45',inA:'47',un:'690 V, 3-phase, 50 Hz',efficiency:'0.94',pf:'0.85'},
 {...emptyEntry(),brand:'Bolt',model:'D-7',config:'NA',ratedKw:'15',inA:'29',un:'400',efficiency:'0.91',pf:'0.8'}];
const idx=indexCatalogue(cat);

describe('equipment load list',()=>{
 it('lays out the panel sheet as the engineer designed it, 32 item rows then the summary',()=>{
  const ws=new ExcelJS.Workbook().addWorksheet('Panel'),summary=equipmentLayout(ws,1);
  const rows=[row({kks:'0001',description:'Pump',brand:'A',model:'B',config:'C',starter:'DOL',cis:'I',consumedKw:'10',ratedKw:'20',efficiency:'0.8',pf:'0.8'})];
  writeEquipmentRows(ws,rows);writeEquipmentSummary(ws,summary,rows,{C:'1',I:'0.3',S:'0.1'},'0.1');
  expect(summary).toBe(39);expect(ws.getCell('B2').value).toBe('KKS No.');expect(ws.getCell('D2').value).toBe('Brand');expect(ws.getCell('G2').value).toBe('Starter Type');
  // Heading boxes: each basic column spans rows 2-6, the units sit on row 6, the formula box spans T1:Y3.
  expect(ws.getCell('B6').master.address).toBe('B2');expect(ws.getCell('M5').master.address).toBe('M2');expect(ws.getCell('M6').value).toBe('kW');
  expect(ws.getCell('Y3').master.address).toBe('T1');expect(ws.getCell('U4').master.address).toBe('T4');expect(ws.getCell('Q5').value).toBe('C');
  expect(ws.getCell('B2').fill).toMatchObject({fgColor:{argb:'FFD6D4CA'}});expect(ws.getCell('B2').font).toMatchObject({name:'Arial',size:9,bold:true});
  expect(ws.getCell('D7').value).toBe('A');expect(ws.getCell('L7').value).toBe('I');expect(ws.getCell('Q7').value).toBe(0.5);
  expect(ws.getCell('M7').formula).toContain('N7*Q7');expect(ws.getCell('V7').formula).toContain('$M7/IF($R7');expect(ws.getCell('W7').formula).toContain('V7');
  // Summary: running load on the left, operating factors, then the load basis rows.
  expect(ws.getCell('C39').value).toBe('Normal Running Plant Load:');expect(ws.getCell('P39').value).toBe('Operating Factors');expect(ws.getCell('Q41').value).toBe(0.3);
  expect(ws.getCell('R41').value).toBe('Largest Load');expect(ws.getCell('R43').value).toBe('Total Base kVA without Diversity Factors');
  expect(ws.pageSetup.printArea).toBe('A1:Y53');
 });
 it('keeps text out of the cells the kW formulas read, so the summary never shows #VALUE!',()=>{
  const ws=new ExcelJS.Workbook().addWorksheet('Panel');equipmentLayout(ws,2);
  writeEquipmentRows(ws,[row({description:'Spare',cis:'S',ratedKw:'5'}),row({description:'Pump',cis:'C',consumedKw:'TBC',ratedKw:'4',efficiency:'TBC',pf:'n/a'})]);
  // Excel reads the blank load factor as 0: rating × 0 = 0 kW, and the cached result agrees.
  expect(ws.getCell('M7').result).toBe(0);expect(ws.getCell('X7').result).toBe(0);
  expect(ws.getCell('M8').value).toBeNull();expect(ws.getCell('R8').value).toBeNull();expect(ws.getCell('S8').value).toBeNull();
 });
 it('fills blanks from the catalogue and keeps typed values',()=>{
  const f=fillRow(row({brand:'acme',model:'M-100',config:'690 V, 3-phase, 50 Hz',pf:'0.9'}),idx);
  expect(f.row.inA).toBe('47');expect(f.row.pf).toBe('0.9');expect(f.from.has('pf')).toBe(false);expect(f.from.has('inA')).toBe(true);
  // One brand sells D-7 and it has one configuration, so both fill in.
  const one=fillRow(row({model:'D-7'}),idx);expect(one.row.brand).toBe('Bolt');expect(one.row.config).toBe('NA');expect(one.row.ratedKw).toBe('15');
  expect(fillRow(row({brand:'Acme',model:'M-100'}),idx).row.ratedKw).toBe('');
 });
 it('works out kW and kVAr like the workbook',()=>{
  const b=balance(row({cis:'C',consumedKw:'40',ratedKw:'50',efficiency:'0.8',pf:'0.8'}));
  expect(b.kw).toBeCloseTo(50);expect(b.kvar).toBeCloseTo(37.5);expect(b.loadFactor).toBeCloseTo(0.8);
  expect(balance(row({cis:'I',consumedKw:'10'})).kw).toBe(10);expect(balance(row({cis:'I',consumedKw:'10'})).kvar).toBeNull();
  expect(balance(row({consumedKw:'10'})).kw).toBeNull();expect(balance(row({cis:'S',consumedKw:'10',efficiency:'95 %'})).kw).toBeCloseTo(10/0.95);
 });
 it('sums a panel with operating factors and design margin',()=>{
  const rows=[row({cis:'C',consumedKw:'30',pf:'1'}),row({cis:'C',consumedKw:'10',pf:'1'}),row({cis:'I',consumedKw:'20',pf:'1'}),row({cis:'I',consumedKw:'10',pf:'1'}),row({cis:'S',consumedKw:'50',pf:'1'})].map(balance);
  const t=panelTotals(rows,{C:'1',I:'0.3',S:'0.1'},'0.1');
  expect(t.operating.C.kw).toBe(40);expect(t.operating.I.kw).toBeCloseTo(9);expect(t.operating.S.kw).toBe(5);
  expect(t.overall.kw).toBeCloseTo(110);expect(t.withMargin.kw).toBeCloseTo(121);expect(plantTotals([t,t]).overall.kw).toBeCloseTo(220);
 });
 it('compares a candidate model and its effect on the plant',()=>{
  const base=row({brand:'Bolt',model:'D-7',config:'NA',cis:'I',consumedKw:'10',ratedKw:'15',efficiency:'0.5',pf:'1'}),t=panelTotals([balance(base)],{C:'1',I:'0.3',S:'0.1'},'0');
  const factors={C:'1',I:'0.3',S:'0.1'},s=scenario([base],0,{brand:'Acme',model:'M-100',config:'400 V, 3-phase, 50 Hz'},idx,factors,'0',plantTotals([t]));
  expect(s.candidate.row.ratedKw).toBe('45');expect(s.candidate.balance.kw).toBeCloseTo(10/0.94);
  expect(s.base.plant!.kw).toBeCloseTo(20);expect(s.candidate.plant!.kw).toBeCloseTo(10/0.94);
  // A new model alone finds its brand and only configuration; a model with two keeps the item's one.
  expect(scenario([base],0,{model:'D-7'},idx,factors,'0',plantTotals([t])).candidate.row).toMatchObject({brand:'Bolt',config:'NA',ratedKw:'15'});
  const on690=row({...base,brand:'Bolt',model:'D-7',config:'690 V, 3-phase, 50 Hz'});
  expect(scenario([on690],0,{model:'M-100'},idx,factors,'0',plantTotals([t])).candidate.row).toMatchObject({brand:'Acme',inA:'47'});
 });
});

describe('send to cable sizing',()=>{
 const panels=[{name:'MCC-9',factors:{C:'1',I:'0.3',S:'0.1'},margin:'0.1',rows:[row({description:'Pump',model:'M-100',brand:'Acme',config:'400 V, 3-phase, 50 Hz',starter:'SD',protA:'100'}),row({description:'Pump',model:'D-7',starter:'VSD/VFD'}),row({description:'Socket',un:'230Vac',ratedKw:'2',starter:'PWR FDR'}),row({description:'IO rack',un:'24VDC',ratedKw:'0.2'})]}];
 it('maps panel to From, description to To and rated input power to Design Load',()=>{
  const r=toSizing(panels,idx);
  expect(r.map(x=>[x.C,x.D,x.E,x.F,x.G,x.I,x.N,x.BP])).toEqual([['MCC-9','Pump','3','400','45','0.85','100','Star-delta'],['MCC-9','Pump','3','400','15','0.8','','VFD'],['MCC-9','Socket','1','230','2','','',''],['MCC-9','IO rack','','','0.2','','','']]);
 });
 it('keeps two items with the same name as two rows and re-sends without losing cable inputs',()=>{
  const first=mergeSizing([],toSizing(panels,idx));expect(first.added).toBe(4);
  const sized=first.rows.map((r,i)=>i===1?{...r,AH:'120',G:'99'}:r);
  const again=mergeSizing(sized,toSizing(panels,idx));
  expect(again.added).toBe(0);expect(again.rows).toHaveLength(4);expect(again.rows[1]!.AH).toBe('120');expect(again.rows[1]!.G).toBe('15');expect(again.updated).toBe(1);
  expect(mergeSizing([{...emptyRow(),C:'MCC-9',D:'Pump'}],toSizing(panels,idx)).rows).toHaveLength(4);
 });
});

describe('importing an equipment workbook',()=>{
 it('reads room sheets, brand sheets and totals, and skips a search copy',async()=>{
  const book=new ExcelJS.Workbook();
  const room=(name:string,items:(string|number)[][])=>{const ws=book.addWorksheet(name);ws.getCell('A1').value='EQUIPMENT LIST';ws.getCell('C2').value='This room register lists every item fed from the board, with its duty and catalogue data.';
   ws.getRow(7).values=['No.','KKS No.','Description','Brand','Model /\nPart Number','Configuration','Vital','Essential','Non-Essential','Re-starting','Starter Type','C/I/S','Consumed Load\n(kW)','Rated Input Power\n(kW)','Protection Device\nRating (A)','In\n(A)','Un','Load Factor','Efficiency','Power Factor','Continuous Load','','Intermittent Load','','Standby Load','','PIC','Remarks'];
   // Headings merged over rows 7 and 8 read back on both rows.
   ws.getRow(8).values=ws.getRow(7).values;ws.getRow(9).values=['','','','','','','','','','','','','','','','','','','','','kW','kVAr','kW','kVAr','kW','kVAr'];
   items.forEach((it,i)=>{ws.getRow(11+i).values=it;});
   ws.getRow(40).values=['','','','','','','','','','','','Load basis','C kW','C kVAr','I kW','I kVAr','S kW','S kVAr','Duty','Factor'];
   ws.getRow(41).values=['','','','','','','','','','','','Total connected load','','','','','','','C',1];ws.getRow(42).values=['','','','','','','','','','','','Largest single load','','','','','','','I',0.5];
   ws.getRow(43).values=['','','','','','','','','','','','Load with operating factor','','','','','','','S',0.2];ws.getRow(45).values=['','','','','','','','','','','','Design margin',0.15];return ws;};
  const a=[1,'K-01','Fan','Acme','M-100','400 V, 3-phase, 50 Hz','✔','','','','DOL','c',30,45,'',81,'400 V, 3-phase, 50 Hz','',0.94,0.85],b=[1,'K-02','Lamp','','','','','','✔','','','I',0.1,'','','','230Vac','','','',''];
  room('Panel North',[a,[2],b]);room('Panel South',[[1,'K-03','Fan','Acme','M-100','690 V, 3-phase, 50 Hz','','','','','DOL','C',30,45,'',47]]);
  room('Searchbar',[a,b,[1,'K-03','Fan','Acme','M-100','690 V, 3-phase, 50 Hz','','','','','DOL','C',30,45,'',47]]);
  const br=book.addWorksheet('Brand (Acme)');br.getCell('M5').value='RATED INPUT POWER\n(kW)';br.getCell('O5').value='In\n(A)';br.getCell('P5').value='Un';br.getCell('R5').value='EFFICIENCY';br.getCell('S5').value='POWER\nFACTOR';
  br.getCell('L6').value='CONSUMED';br.getCell('R7').value='at load';br.getCell('R8').value='factor C';br.getCell('S8').value='at load';
  br.getRow(8).values=['','No.','Description','Brand','Model /\nPart Number','Configuration','Vital','Essential','Non-Essential','Re-starting','C/I/S','CONSUMED LOAD\n(kW)'];
  br.getRow(9).values=br.getRow(8).values;br.getRow(11).values=[1,'','','ACME CO','M-100','400 V, 3-phase, 50 Hz','','','','','C','',45,'',81,'400 V, 3-phase, 50 Hz','',0.94,0.85];
  br.getRow(12).values=[2,'','','ACME CO','M-100','690 V, 3-phase, 50 Hz','','','','','C','',45,'',47,'690 V, 3-phase, 50 Hz','',0.94,0.85];
  const tables=await readTables(new File([await book.xlsx.writeBuffer() as BlobPart],'equipment.xlsx'));
  const read=readEquipment(tables,'equipment.xlsx');
  expect(read.panels.map(p=>p.name)).toEqual(['Panel North','Panel South']);expect(read.notes.join()).toMatch(/Searchbar/);
  const north=read.panels[0]!;expect(north.rows.map(r=>r.description)).toEqual(['Fan','Lamp']);
  expect(north.rows[0]).toMatchObject({kks:'K-01',vital:'✔',cis:'C',consumedKw:'30',ratedKw:'',inA:'',un:''});expect(north.rows[1]!.nonEssential).toBe('✔');
  expect(north.factors).toEqual({C:'1',I:'0.5',S:'0.2'});expect(north.margin).toBe('0.15');
  expect(read.catalogue).toHaveLength(2);expect(read.catalogue[0]).toMatchObject({brand:'Acme',model:'M-100',ratedKw:'45',inA:'81',efficiency:'0.94',pf:'0.85'});
  // The catalogue now supplies what the workbook looked up.
  expect(fillRow(north.rows[0]!,indexCatalogue(read.catalogue)).row.inA).toBe('81');
 });
 it('exports a workbook that imports back the same',async()=>{
  const panels=[{name:'MCC/1',factors:{C:'1',I:'0.4',S:'0.1'},margin:'0.05',rows:[row({kks:'K-1',description:'Fan',model:'M-100',brand:'Acme',config:'400 V, 3-phase, 50 Hz',cis:'C',consumedKw:'30',vital:'✔'}),row({description:'Heater',cis:'S',consumedKw:'3',pf:'1'})]}];
  // Only the cover page and one sheet per panel: no plant load or catalogue sheets.
  const book=loadsBook(panels,cat,'Test project','Test-project-load-list.xlsx');expect(book.worksheets.map(w=>w.name)).toEqual(['Cover page','MCC 1']);
  const cover=book.worksheets[0]!;expect(cover.getCell('A5').value).toBe('Test project');expect(cover.getCell('A6').value).toBe('LOAD LIST');expect(cover.getCell('J7').fill).toMatchObject({fgColor:{theme:0}});expect(cover.getCell('C33').formula).toContain('CELL("filename",A1)');expect(cover.pageSetup.printArea).toBe('A1:J35');
  const panel=book.worksheets[1]!;expect(panel.getCell('B2').value).toBe('KKS No.');expect(panel.pageSetup.orientation).toBe('landscape');expect(panel.pageSetup.fitToWidth).toBe(1);expect(panel.pageSetup.printTitlesRow).toBe('1:6');expect(panel.getCell('W42').formula).toBe('W41*Q41');
  const buffer=await book.xlsx.writeBuffer(),reopened=new ExcelJS.Workbook();await reopened.xlsx.load(buffer);
  const exported=reopened.worksheets[1]!;
  expect(exported.getCell('C39').value).toBe('Normal Running Plant Load:');expect(exported.getCell('C41').value).toBe('With Design Margin');
  expect(exported.getCell('D39').master.address).toBe('C39');expect(exported.getCell('D41').master.address).toBe('C41');expect(reopened.worksheets[0]!.getCell('J5').master.address).toBe('A5');expect(reopened.worksheets[0]!.getCell('J45').master.address).toBe('A35');
  expect(exported.getCell('B6').master.address).toBe('B2');expect(exported.getCell('C6').master.address).toBe('C2');expect(exported.getCell('L6').master.address).toBe('L2');
  expect(exported.getCell('C40').formula).toBe('MAX(T41:T42)+MAX(V41:V42)+MAX(X41:X42)');expect(exported.getCell('W42').formula).toBe('W41*Q41');
  const read=readEquipment(await readTables(new File([buffer as BlobPart],'out.xlsx')),'out.xlsx');
  // No catalogue sheet any more, so catalogue-filled values come back as typed values, exactly as the sheet shows them.
  expect(read.panels).toHaveLength(1);expect(read.panels[0]!.rows).toEqual(panels[0]!.rows.map(r=>fillRow(r,idx).row));expect(read.panels[0]!.factors).toEqual(panels[0]!.factors);expect(read.panels[0]!.margin).toBe('0.05');
  expect(read.catalogue).toEqual([]);
 });
 it('retains template reactive formula and expands the summary past longer panels',()=>{
  const rows=Array.from({length:34},(_,i)=>row({description:`Load ${i+1}`,cis:'I',consumedKw:'10',pf:'0.8'}));
  const sheet=loadsBook([{name:'Panel',rows,factors:{C:'1',I:'0.5',S:'0.1'},margin:'0.1'}],[]).worksheets[1]!;
  expect(sheet.getCell('W44').formula).toBe('W43*Q43');
  expect(sheet.getCell('W41').formula).toBe('SUM(W7:W40)');
  expect(sheet.getCell('I42').formula).toContain('MAX(W43:W44)');
  expect(sheet.getCell('W44').result).toBeCloseTo(3.75);
  expect(sheet.getCell('I42').result).toBeCloseTo(7.5);
  expect(sheet.pageSetup.printArea).toBe('A1:Y55');
 });
 it('lets old projects open with an empty load list',()=>{
  const old=JSON.parse(JSON.stringify(fresh()));delete old.loads;
  expect(Project.parse(old).loads).toEqual({panels:[],catalogue:[],source:''});
 });
});

describe('reading datasheets',()=>{
 const text='Three-phase motor\nArticle No. M-200-4P\nRated power 55 kW\nRated voltage 400 V 50 Hz 3~\nRated current 98,5 A\nEfficiency 95.1 %\nPower factor cos φ 0.86';
 it('finds labelled values and checks them against the page',()=>{
  const [p]=catalogueFromPages([{page:2,text,mode:'text',confidence:null}],'sheet.pdf');
  expect(p!.entry).toMatchObject({model:'M-200-4P',ratedKw:'55',inA:'98.5',un:'400 V',efficiency:'0.951',pf:'0.86',config:'400 V, 3-phase, 50 Hz'});
  expect(p!.unverified).toEqual([]);expect(p!.entry.source).toBe('sheet.pdf, page 2');
 });
 it('flags values from the local model that are not on the page',()=>{
  const reply='Here: {"rows":[{"model":"M-200-4P","configuration":"400 V, 3-phase, 50 Hz","ratedKw":"55","inA":"99","un":"400 V","efficiency":"95.1","pf":"0.86","page":2,"evidence":"Rated power 55 kW"}]}';
  const [p]=parseEquipmentReply(reply,[{page:2,text,mode:'text',confidence:null}],'sheet.pdf');
  expect(p!.entry.efficiency).toBe('0.951');expect(p!.unverified).toEqual(['inA']);
  expect(verify({...emptyEntry(),model:'X-9'},text)).toEqual(['model']);
 });
});
