import {describe,it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {balance,emptyEntry,emptyLoad,entryAt,fillRow,indexCatalogue,panelTotals,plantTotals,scenario,type LoadRow} from '../src/engine/loads';
import {readTables} from '../src/import/load-list';
import {catalogueFromPages,locate,mergeSizing,readEquipment,toSizing,verify} from '../src/import/equipment';
import {emptyRow} from '../src/engine/sheet';
import {Project} from '../src/store/schema';
import {fresh} from '../src/ui/state';
import {loadsBook} from '../src/export/equipment';
import {catalogueFromDatasheet,catalogueFromWeb,pageText,redirectTarget} from '../src/import/webpage';
import {catalogueFromTables} from '../src/import/rating-table';
import {ocrLines,rulesOf} from '../src/import/parse';
import {charList,ctcDecode,inkParts,shareOut,textBoxes} from '../src/import/ocr';
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
 it('runs two catalogue entries at the same consumed load, on a panel or not',()=>{
  const a=entryAt(cat[0]!,'40'),d=entryAt(cat[2]!,'40');
  expect(a.kw).toBeCloseTo(40/0.94);expect(a.kvar).toBeCloseTo(40/0.94*Math.tan(Math.acos(0.85)));expect(a.kva).toBeCloseTo(40/0.94/0.85);expect(a.loadFactor).toBeCloseTo(40/45);
  expect(d.kw).toBeCloseTo(40/0.91);expect(d.loadFactor).toBeCloseTo(40/15);
  expect(entryAt({...cat[2]!,pf:''},'40').kva).toBeNull();expect(entryAt(cat[0]!,'').kw).toBeNull();
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
  expect(Project.parse(old).loads).toEqual({panels:[],catalogue:[],source:'',types:[]});
 });
});

describe('reading a pasted vendor web page',()=>{
 // Made-up page in the usual shapes: a "Label: value" header, a spec grid with two pairs per row, a label line above its value, a comparison table.
 const html=`<head><title>t</title></head><script>alert(1)</script><div>Item: ZX99 | Model: M-100 | Cross Ref: Q-7</div><div>Brand</div><div>Acme &amp; Co</div>
 <table><tr><th>Hp</th><td>7 1/2 hp</td><th>Frequency</th><td>60 Hz</td></tr><tr><th>Full Load Amps</th><td>19.8-22.5A</td><th>Phase</th><td>1</td></tr>
 <tr><th>Efficiency</th><td>82.5%</td><th>Nominal Efficiency</th><td>88.5%</td></tr></table><div>Voltage</div><div>208-230V AC</div>
 <table><tr><th>Model</th><th>Voltage</th><th>Hp</th><th>Full Load Amps</th></tr><tr><td>M-200</td><td>400V</td><td>5.5 kW</td><td>11 A</td></tr></table>`;
 it('keeps table cells apart and drops scripts',()=>{
  const t=pageText(html);expect(t).not.toContain('alert');expect(t).toContain('Hp\t7 1/2 hp\tFrequency\t60 Hz');expect(t).toContain('Acme & Co');
 });
 it('reads label/value pairs, converts horsepower and keeps ranges as written',()=>{
  const {proposals,brand}=catalogueFromWeb(pageText(html),'https://vendor.example/m-100');
  expect(brand).toBe('Acme & Co');expect(proposals).toHaveLength(2);
  const [main,other]=proposals;
  expect(main!.entry).toMatchObject({model:'M-100',ratedKw:'5.593',inA:'19.8-22.5',un:'208-230 V',efficiency:'0.825',config:'208-230 V, 1-phase, 60 Hz',source:'https://vendor.example/m-100 (web page)'});
  expect(main!.include).toBe(true);expect(main!.unverified).toEqual([]);expect(main!.evidence).toContain('7 1/2 hp = 5.593 kW');
  // The unit written with the value wins over an "Hp" heading; other models on a product page start unticked.
  expect(other!.entry).toMatchObject({model:'M-200',ratedKw:'5.5',inA:'11',un:'400 V'});expect(other!.include).toBe(false);
 });
});

describe('saved links are not documents',()=>{
 it('finds where a saved search-result page forwards to, and leaves real pages alone',()=>{
  const stub=`<html><head><script>var redirectUrl='https://maker.example/cat.pdf';</script><noscript><meta content="0;url=https://maker.example/dl.aspx?id=9&amp;lang=en" http-equiv="refresh"></noscript></head></html>`;
  expect(redirectTarget(stub)).toBe('https://maker.example/dl.aspx?id=9&lang=en');
  expect(redirectTarget('<meta http-equiv="refresh" content="5;url=/next"><p>Rated power 5.5 kW</p>')).toBeNull();
  expect(redirectTarget('<meta http-equiv="refresh" content="0;url=javascript:alert(1)">')).toBeNull();
 });
});

describe('reading two-column datasheet PDFs',()=>{
 // Made-up pages in the "label    value" layout PDF text keeps (two or more spaces between columns), with the traps real sheets have.
 const page=(page:number,lines:string[])=>({page,text:lines.join('\n'),mode:'text' as const,confidence:null});
 it('reads a maker\'s sheet: model heading, supply voltage range, copyright brand; skips signal inputs, classes and losses',()=>{
  const {proposals:[p],brand}=catalogueFromDatasheet([page(1,['Data sheet     AB1234-5CD67-8EF9','  Acme MX20 monitoring device, Ue 230/400 V, 50 Hz','  Model','  product brand name     ACMELINE',
   '  voltage curve     Sinusoidal','  Supply voltage','  input voltage at digital input at DC maximum     30 V','  supply voltage at AC     100 ... 250 V','  efficiency class     IE3',
   '  power loss total typical     2 W']),page(2,['  height     96 mm','  Page 2/2     © Copyright Acme'])],'acme.pdf');
  expect(brand).toBe('Acme');
  expect(p!.entry).toMatchObject({model:'AB1234-5CD67-8EF9',un:'100-250 V',config:'100-250 V, 50 Hz',ratedKw:'',inA:'',efficiency:'',source:'acme.pdf, page 1'});
  expect(p!.unverified).toEqual([]);
 });
 it('reads a printed shop page: split ligatures, wrapped labels, "|" separators, maker from the title',()=>{
  const {proposals:[p],brand}=catalogueFromDatasheet([page(1,['Acme Motors QX-100 | General Purpose Motor | Shop Ltd','  Item:     Z9     |     Model:     QX-100',
   '  Full Load    11.5A','  Amps    No. Of Speed     1','  E  ffi  ciency     91%','  Hp     5 hp','  ©     Shop Ltd.     All Rights Reserved'])],'shop.pdf');
  expect(brand).toBe('Acme Motors');
  expect(p!.entry).toMatchObject({model:'QX-100',inA:'11.5',efficiency:'0.91',ratedKw:'3.729'});expect(p!.unverified).toEqual([]);
 });
});

describe('reading catalogue rating tables by column position',()=>{
 // Made-up catalogue pages: [x, text, width] per item, the way the PDF text layer places them.
 const line=(...cells:[number,string,number?][])=>({cells:cells.map(([x,text,w])=>({x,text,w:w??text.length*5}))});
 const stacked=[line([40,'IE3 cast iron motors, 400 V 50 Hz',150]),line([40,'3000 r/min = 2 poles',100]),
  line([40,'Output',30],[80,'Motor type',50],[150,'Product code',60],[220,'Efficiency',50],[285,'Power factor',30],[320,'Current',40],[380,'Torque',20]),
  line([40,'kW',10],[220,'Full load',25],[250,'3/4 load',25],[285,'cos φ',20],[320,'IN',10],[350,'Is/IN',15],[380,'TN Nm',20]),
  line([220,'100%',20],[250,'75%',15],[320,'A',5]),
  line([40,'0.75'],[80,'M3BP 80MLA 2'],[150,'3GBP081321-B'],[220,'80.7'],[250,'79.2'],[285,'0.80'],[320,'1.65'],[350,'6.0'],[380,'2.5']),
  line([40,'1.1'],[80,'M3BP 80MLB 2'],[150,'3GBP081322-B'],[220,'82.7'],[250,'82.1'],[285,'0.82'],[320,'2.35'],[350,'6.5'],[380,'3.7']),
  line([40,'1500 r/min = 4 poles',100]),
  line([40,'0.75'],[80,'M3BP 80MLB 4'],[150,'3GBP082322-B'],[220,'82.5'],[250,'81.9'],[285,'0.74'],[320,'1.8'],[350,'5.4'],[380,'5.0']),
  line([40,'1.1'],[80,'M3BP 90SLA 4'],[150,'3GBP092321-B'],[220,'84.1'],[250,'84.0'],[285,'0.77'],[320,'2.45'],[350,'6.0'],[380,'7.4']),
  line([40,'© Acme Drives 2026',80])];
 it('reads stacked headings: model column, full-load efficiency, In not Is/In, poles from sub-headings',()=>{
  const rows=catalogueFromTables(new Map([[7,stacked]]),'cat.pdf');
  expect(rows.map(r=>r.entry)).toEqual([
   expect.objectContaining({model:'M3BP 80MLA 2',ratedKw:'0.75',inA:'1.65',efficiency:'0.807',pf:'0.8',un:'400 V',config:'3GBP081321-B, 400 V, 50 Hz, 2-pole',source:'cat.pdf, page 7'}),
   expect.objectContaining({model:'M3BP 80MLB 2',ratedKw:'1.1',inA:'2.35',efficiency:'0.827'}),
   expect.objectContaining({model:'M3BP 80MLB 4',inA:'1.8',config:'3GBP082322-B, 400 V, 50 Hz, 4-pole'}),
   expect.objectContaining({model:'M3BP 90SLA 4',ratedKw:'1.1',pf:'0.77'})]);
  expect(rows.every(r=>r.unverified.length===0)).toBe(true);
 });
 it('reads kW and hp, current per voltage, percent power factor; the series over a frame-only table is the model',()=>{
  const rows=catalogueFromTables(new Map([[3,[line([40,'AX series, 3~ 50 Hz',100]),
   line([40,'Output',50],[100,'Frame',30],[150,'Speed',30],[200,'Current (A)',110],[330,'Eff. (%)',40],[390,'P.F. (%)',40]),
   line([42,'kW',12],[66,'HP',12],[152,'rpm',16],[200,'380V',24],[240,'400V',24],[280,'415V',24]),
   line([40,'0.75',16],[68,'1',6],[100,'80M',18],[150,'2850',20],[202,'1.9',12],[242,'1.8',12],[282,'1.75',16],[332,'80.7',16],[392,'82',10]),
   line([40,'5.5',12],[66,'7.5',12],[100,'132S',22],[150,'1450',20],[202,'11.6',16],[242,'11.0',16],[282,'10.7',16],[332,'89.6',16],[392,'83',10])]]]),'ax.pdf');
  expect(rows.map(r=>r.entry)).toEqual([
   expect.objectContaining({model:'AX',ratedKw:'0.75',inA:'1.8',efficiency:'0.807',pf:'0.82',un:'400 V',config:'80M, 400 V, 3-phase, 50 Hz, 2-pole'}),
   expect.objectContaining({model:'AX',ratedKw:'5.5',inA:'11',efficiency:'0.896',pf:'0.83',config:'132S, 400 V, 3-phase, 50 Hz, 4-pole'})]);
  // With no name column the series printed over the table is the model and the frame size the configuration; nothing is made up.
  expect(rows.every(r=>r.unverified.length===0)).toBe(true);
 });
 it('prefers catalogue rows over one product read from the whole file',()=>{
  const pages=[{page:7,text:stacked.map(l=>l.cells.map(c=>c.text).join('  ')).join('\n'),mode:'text' as const,confidence:null}];
  const {proposals,brand}=catalogueFromDatasheet(pages,'cat.pdf',new Map([[7,stacked]]));
  expect(proposals).toHaveLength(4);expect(brand).toBe('Acme Drives');
 });
 // kW, In, efficiency and power factor must work out to the voltage: P = √3·U·I·η·cosφ.
 it('takes the printed voltage the rows work out to, skips no-load current and flags rows that do not add up',()=>{
  const rows=catalogueFromTables(new Map([[31,[line([40,'ZX motors, 3000 V, 50 Hz',120]),line([40,'1500 r/min = 4 poles 690 V 50 Hz',150]),
   line([40,'Output',30],[100,'Motor type',50],[200,'Current',40],[260,'Efficiency',50],[330,'Power factor',40]),
   line([40,'kW',10],[200,'I nl',15],[230,'IN',10],[260,'100%',20],[330,'cos φ',20]),
   line([40,'250'],[100,'ZX 400L4'],[200,'20'],[230,'56'],[260,'95.5'],[330,'0.90']),
   line([40,'315'],[100,'ZX 400M4'],[200,'25'],[230,'70'],[260,'95.9'],[330,'0.90']),
   line([40,'355'],[100,'ZX 400N4'],[200,'27'],[230,'40'],[260,'96.0'],[330,'0.90'])]]]),'zx.pdf');
  expect(rows.map(r=>[r.entry.inA,r.entry.config])).toEqual([['56','3000 V, 50 Hz, 4-pole'],['70','3000 V, 50 Hz, 4-pole'],['40','3000 V, 50 Hz, 4-pole']]);
  expect(rows.slice(0,2).every(r=>!r.unverified.length&&!r.note)).toBe(true);
  expect(rows[2]!.unverified).toEqual(expect.arrayContaining(['inA','un']));expect(rows[2]!.note).toMatch(/about 5931 V, not 3000 V/);
 });
 it('reads a single-phase table from its values when no phase is printed',()=>{
  const rows=catalogueFromTables(new Map([[2,[line([40,'Capacitor motors 230 V 50 Hz',140]),
   line([40,'kW',10],[100,'Type',20],[200,'In (A)',25],[260,'η %',15],[330,'cos φ',20]),
   line([40,'0.37'],[100,'C71B4'],[200,'2.8'],[260,'61'],[330,'0.95']),
   line([40,'0.55'],[100,'C80A4'],[200,'3.8'],[260,'64'],[330,'0.98'])]]]),'c.pdf');
  expect(rows.map(r=>r.entry.config)).toEqual(['230 V, 1-phase, 50 Hz','230 V, 1-phase, 50 Hz']);
  expect(rows.every(r=>!r.unverified.length)).toBe(true);
 });
 it('tells apart one model printed with other values on two pages, and drops a row printed twice',()=>{
  const page=(a:string)=>[line([40,'400 V 50 Hz',60]),line([40,'kW',10],[100,'Frame',25],[200,'In (A)',25],[260,'η %',15],[330,'cos φ',20]),
   line([40,'1.5'],[100,'90L4'],[200,a],[260,'79'],[330,'0.8']),line([40,'2.2'],[100,'100L4'],[200,'4.8'],[260,'84'],[330,'0.8'])];
  const rows=catalogueFromTables(new Map([[1,page('3.4')],[2,page('3.2')]]),'f.pdf');
  expect(rows.map(r=>[r.entry.model,r.entry.config])).toEqual([['90L4','400 V, 50 Hz, page 1'],['100L4','400 V, 50 Hz'],['90L4','400 V, 50 Hz, page 2']]);
 });
 it('tells apart one frame at several outputs by its kW; a type is the model and a numeric part number the configuration',()=>{
  const rows=catalogueFromTables(new Map([[4,[line([40,'400 V 50 Hz',60]),line([40,'kW',10],[100,'Frame',25],[220,'In (A)',25],[280,'η %',15],[340,'cos φ',20]),
   line([40,'45'],[100,'280M8'],[220,'89'],[280,'92'],[340,'0.79']),line([40,'55'],[100,'280M8'],[220,'107'],[280,'92.8'],[340,'0.8'])]],
   [5,[line([40,'400 V 50 Hz',60]),line([40,'kW',10],[100,'Motor type',40],[160,'Product ID',40],[220,'In (A)',25],[280,'η %',15],[340,'cos φ',20]),
   line([40,'45'],[100,'ZX 280'],[160,'310126'],[220,'89'],[280,'92'],[340,'0.79']),line([40,'55'],[100,'ZX 280'],[160,'310125'],[220,'107'],[280,'92.8'],[340,'0.8'])]]]),'f.pdf');
  expect(rows.map(r=>[r.entry.model,r.entry.config])).toEqual([['280M8','400 V, 50 Hz, 45 kW'],['280M8','400 V, 50 Hz, 55 kW'],['ZX 280','310126, 400 V, 50 Hz'],['ZX 280','310125, 400 V, 50 Hz']]);
 });
 it('reads headings in other languages and takes the product name printed over a size-only table',()=>{
  const rows=catalogueFromTables(new Map([[9,[line([40,'QX7 4-POLIG | 1500 1/min',140]),
   line([40,'Baugröße',40],[100,'Nennleistung',50],[160,'Nennstrom',40],[220,'Wirkungsgrad',50],[290,'Leistungsfaktor',60],[360,'Gewicht',30]),
   line([100,'kW',10],[160,'400 V',20],[220,'%',8],[360,'kg',10]),
   line([40,'90L-4'],[100,'1,5'],[160,'3,3'],[220,'82,8'],[290,'0,80'],[360,'21']),
   line([40,'100L-4'],[100,'2,2'],[160,'4,7'],[220,'84,3'],[290,'0,80'],[360,'28'])]]]),'de.pdf');
  expect(rows.map(r=>[r.entry.model,r.entry.config,r.entry.ratedKw,r.entry.inA,r.entry.efficiency,r.entry.pf])).toEqual([
   ['QX7','90L-4, 400 V, 4-pole','1.5','3.3','0.828','0.8'],['QX7','100L-4, 400 V, 4-pole','2.2','4.7','0.843','0.8']]);
  expect(rows[0]!.boxes!.map(b=>b.key)).toEqual(expect.arrayContaining(['model','config','ratedKw','inA','efficiency','pf']));
 });
 it('finds kW, In, efficiency and power factor by the values alone when no heading is understood',()=>{
  const rows=catalogueFromTables(new Map([[3,[line([40,'Typ',20],[100,'Xa',10],[160,'Xb',10],[220,'Xc',10],[290,'Xd',10]),
   line([40,'ZQ 90'],[100,'1.5'],[160,'3.3'],[220,'82.8'],[290,'0.80']),
   line([40,'ZQ 100'],[100,'2.2'],[160,'4.7'],[220,'84.3'],[290,'0.80']),
   line([40,'ZQ 112'],[100,'4'],[160,'8.1'],[220,'86.6'],[290,'0.82'])]]]),'x.pdf');
  expect(rows.map(r=>[r.entry.model,r.entry.ratedKw,r.entry.inA,r.entry.efficiency,r.entry.pf])).toEqual([
   ['ZQ 90','1.5','3.3','0.828','0.8'],['ZQ 100','2.2','4.7','0.843','0.8'],['ZQ 112','4','8.1','0.866','0.82']]);
 });
 // A ruled grid: headings at the left of each cell and figures at the right, so "In" sits nearer the kW figures than its own.
 const grid=[line([42,'Type',20],[92,'kW',10],[132,'In',8],[172,'η %',12],[212,'cos φ',20]),
  ...[['ZQ 90','1.5','3.3','82.8','0.80'],['ZQ 100','2.2','4.7','84.3','0.80'],['ZQ 112','4','8.1','86.6','0.82']].map(([t,p,i,e,f])=>
   line([42,t!,25],[128-p!.length*5,p!],[168-i!.length*5,i!],[208-e!.length*5,e!],[248-f!.length*5,f!]))];
 const borders=[40,90,130,170,210,250].map(x=>({x0:x-0.25,y0:-20,x1:x+0.25,y1:20}));
 it('reads borders and shaded cells from the PDF drawing, in page points',()=>{
  const OPS={save:10,restore:11,transform:12,endPath:28,paintFormXObjectBegin:74,paintFormXObjectEnd:75,beginGroup:76,endGroup:77,constructPath:91},fill=22;
  const path=(...p:number[])=>[OPS.constructPath,[fill,[new Float32Array(p)],null]] as const;
  const ops=[[OPS.save,null],[OPS.transform,[2,0,0,2,10,20]],path(0,0,0, 1,10,0, 1,10,5, 1,0,5, 3),path(0,0,0, 2,1,1,2,2,3,3),[OPS.restore,null],
   path(0,50,0, 1,50,100),[OPS.constructPath,[OPS.endPath,[new Float32Array([0,0,0,1,600,0,1,600,800,1,0,800,3])],null]]] as const;
  expect(rulesOf(ops.map(o=>o[0]),ops.map(o=>o[1]),OPS)).toEqual([{x0:10,y0:20,x1:30,y1:30},{x0:50,y0:0,x1:50,y1:100}]);
 });
 it('gives each heading the column inside its drawn cell',()=>{
  const read=(rules?:Map<number,typeof borders>)=>catalogueFromTables(new Map([[1,grid]]),'grid.pdf',rules).map(r=>[r.entry.model,r.entry.ratedKw,r.entry.inA,r.entry.efficiency,r.entry.pf]);
  const want=[['ZQ 90','1.5','3.3','0.828','0.8'],['ZQ 100','2.2','4.7','0.843','0.8'],['ZQ 112','4','8.1','0.866','0.82']];
  expect(read(new Map([[1,borders]]))).toEqual(want);
  expect(read()).not.toEqual(want);
 });
 it('takes efficiency at full load when the heading sits over the 75 % column only',()=>{
  const rows=catalogueFromTables(new Map([[2,[line([40,'Type',20],[100,'kW',10],[160,'In (A)',25],[258,'η %',15],[340,'cos φ',20]),
   line([220,'100 %',20],[260,'75 %',15],[300,'50 %',15]),
   ...[['ZQ 90','1.5','3.3','82.8','83.0','81.0','0.80'],['ZQ 100','2.2','4.7','84.3','84.5','82.6','0.80'],['ZQ 112','4','8.1','86.6','86.9','85.1','0.82']].map(([t,p,i,a,b,c,f])=>
    line([40,t!],[100,p!],[160,i!],[220,a!],[260,b!],[300,c!],[340,f!]))]]]),'eff.pdf');
  expect(rows.map(r=>[r.entry.efficiency,r.entry.pf])).toEqual([['0.828','0.8'],['0.843','0.8'],['0.866','0.82']]);
 });
 it('reads a scanned table from OCR word boxes',()=>{
  // Word boxes as OCR gives them: pixels from the top left of a page drawn at 2 pixels per point.
  const word=(text:string,x:number,y:number)=>({text,bbox:{x0:x,y0:y,x1:x+text.length*12,y1:y+20}});
  const words=[word('ZX',80,100),word('series',112,100),word('400',260,100),word('V',300,100),
   word('Type',80,160),word('Rated',240,160),word('power',308,160),word('Current',440,160),word('Efficiency',560,160),word('cos',720,160),word('φ',760,160),
   word('kW',240,190),word('A',440,190),word('%',560,190),
   ...[['ZX','90','1.5','3.3','82.8','0.80'],['ZX','100','2.2','4.7','84.3','0.80'],['ZX','112','4','8.1','86.6','0.82']].flatMap(([a,b,p,i,e,f],k)=>
    [word(a!,80,240+k*30),word(b!,110,240+k*30),word(p!,240,240+k*30),word(i!,440,240+k*30),word(e!,560,240+k*30),word(f!,720,240+k*30)])];
  const rows=catalogueFromTables(new Map([[1,ocrLines(words,(x,y)=>[x/2,1000-y/2])]]),'scan.pdf');
  expect(rows.map(r=>[r.entry.model,r.entry.ratedKw,r.entry.inA,r.entry.efficiency,r.entry.pf,r.entry.un])).toEqual([
   ['ZX 90','1.5','3.3','0.828','0.8','400 V'],['ZX 100','2.2','4.7','0.843','0.8','400 V'],['ZX 112','4','8.1','0.866','0.82','400 V']]);
  expect(rows[0]!.boxes!.find(b=>b.key==='inA')).toEqual(expect.objectContaining({x0:220,y:870}));
 });
 it('finds where values are printed when a reader kept no positions',()=>{
  const e={...emptyEntry(),model:'ZX 400L4',ratedKw:'250',inA:'56',un:'3000 V'};
  const boxes=locate(e,[{cells:[{x:10,w:30,h:8,y:500,text:'ZX 400L4'},{x:50,w:15,h:8,y:500,text:'250 kW'},{x:80,w:10,h:8,y:500,text:'56'}]},{cells:[{x:10,w:60,h:8,y:700,text:'3000 V, 50 Hz'}]}]);
  expect(boxes.map(b=>b.key)).toEqual(['model','ratedKw','inA','un']);expect(boxes[0]).toEqual({key:'model',x0:10,x1:40,y:500,h:8});
 });
});

describe('reading datasheets',()=>{
 const text='Three-phase motor\nArticle No. M-200-4P\nRated power 55 kW\nRated voltage 400 V 50 Hz 3~\nRated current 98,5 A\nEfficiency 95.1 %\nPower factor cos φ 0.86';
 it('finds labelled values and checks them against the page',()=>{
  const [p]=catalogueFromPages([{page:2,text,mode:'text',confidence:null}],'sheet.pdf');
  expect(p!.entry).toMatchObject({model:'M-200-4P',ratedKw:'55',inA:'98.5',un:'400 V',efficiency:'0.951',pf:'0.86',config:'400 V, 3-phase, 50 Hz'});
  expect(p!.unverified).toEqual([]);expect(p!.entry.source).toBe('sheet.pdf, page 2');
 });
 it('flags values that are not on the page',()=>{
  expect(verify({...emptyEntry(),model:'X-9'},text)).toEqual(['model']);
  // Trailing zeros on the page are the same number; a longer number is not.
  expect(verify({...emptyEntry(),pf:'0.8',inA:'13.5',efficiency:'0.9'},'cos φ 0.80, In 13.50 A, η 90.0 %')).toEqual([]);
  expect(verify({...emptyEntry(),inA:'1.5'},'In 1.55 A')).toEqual(['inA']);
 });
});

describe('scanned-page OCR helpers',()=>{
 it('reads the character list from a model settings file',()=>{
  expect(charList("PostProcess:\n  name: CTCLabelDecode\n  character_dict:\n  - '0'\n  - a\n  - ''''\n  - \"\\u00e9\"\nNext: 1\n")).toEqual(['0','a',"'",'é']);
 });
 it('decodes CTC output: repeats merge, a blank separates a repeated letter',()=>{
  const p=(c:number)=>[0,1,2].map(k=>k===c?0.9:0.05);
  expect(ctcDecode([...p(1),...p(1),...p(0),...p(1),...p(2)],5,3,['','a','b'])).toEqual({text:'aab',score:expect.closeTo(0.9,5)});
 });
 it('finds text regions in the probability map and grows them by the unclip margin',()=>{
  const w=20,h=10,map=new Float32Array(w*h);
  for(let y=3;y<=6;y++){for(let x=2;x<=9;x++)map[y*w+x]=0.9;for(let x=13;x<=17;x++)map[y*w+x]=0.9;}
  const boxes=textBoxes(map,w,h);
  expect(boxes).toHaveLength(2);
  expect(boxes[0]!.x0).toBeLessThan(2);expect(boxes[0]!.x1).toBeGreaterThan(10);expect(boxes[0]!.score).toBeCloseTo(0.9);
 });
 it('cuts a detected line into its printed parts, ignoring grid lines',()=>{
  // White page, letters 10 px tall at x 5–20 and 30–40, a vertical grid line at x 60, letters at 65–80, a rule at y 18.
  const width=100,height=20,data=new Uint8ClampedArray(width*height*4).fill(255),ink=(x:number,y:number)=>data.fill(0,(y*width+x)*4,(y*width+x)*4+3);
  for(let y=5;y<15;y++)for(const [a,b] of [[5,20],[30,40],[65,80]])for(let x=a!;x<=b!;x++)ink(x,y);
  for(let y=0;y<height;y++)ink(60,y);for(let x=0;x<width;x++)ink(x,18);
  expect(inkParts({data,width,height},{x0:0,y0:0,x1:width,y1:height}).map(p=>[p.x0,p.x1,p.y0,p.y1])).toEqual([[5,21,5,15],[30,41,5,15],[65,81,5,15]]);
 });
 it('shares a line\'s words out over its parts by length',()=>{
  expect(shareOut('Frame Size Rated Power',[50,55])).toEqual(['Frame Size','Rated Power']);
  expect(shareOut('QX7 90L4',[20,22])).toEqual(['QX7','90L4']);
  expect(shareOut('abc',[10,10])).toBeUndefined();
 });
});
