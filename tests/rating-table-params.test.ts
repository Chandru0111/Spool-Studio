import {describe,expect,it} from 'vitest';
import {catalogueFromTables} from '../src/import/rating-table';
import {BUILT_IN} from '../src/engine/equipment-types';
import type {PositionedLine} from '../src/import/parse';

// Made-up catalogue pages: each line at a height on the page, [x, text, width] per item, as the PDF text layer places them.
const at=(y:number,...cells:[number,string,number?][]):PositionedLine=>({y,cells:cells.map(([x,text,w])=>({x,y,text,w:w??text.length*5}))});
const motor=[BUILT_IN.find(t=>t.id==='motor')!];
const table=(rows:PositionedLine[])=>[
 at(700,[40,'AX1 IE3 4-POLE | 1500 RPM',120]),at(688,[40,'400 V 50 Hz',60]),
 at(670,[40,'Frame',30],[100,'Output',30],[150,'Speed',30],[200,'Current',40],[250,'Eff.',30],[300,'P.F.',30],[350,'Locked current',50],[420,'Weight',30]),
 at(660,[40,'size',20],[100,'kW',12],[150,'rpm',16],[200,'A',6],[250,'%',8],[300,'cos φ',20],[350,'Is/In',20],[420,'kg',10]),
 ...rows];
const r1=at(640,[40,'80M4',20],[100,'0.75',16],[150,'1420',20],[200,'1.85',16],[250,'84',10],[300,'0.70',16],[350,'7.3',12],[420,'20',10]);
const r2=at(628,[40,'90S4',20],[100,'1.1',12],[150,'1420',20],[200,'2.66',16],[250,'85.3',16],[300,'0.70',16],[350,'7.5',12],[420,'24',10]);
const r3=at(616,[40,'90L4',20],[100,'1.5',12],[150,'1420',20],[200,'3.53',16],[250,'86.3',16],[300,'0.72',16],[350,'7.6',12],[420,'30',10]);

describe('reading the ticked parameters of a rating table',()=>{
 it('fills each catalogue-only parameter from its column, the row, or the title, and keeps the efficiency class in the series name',()=>{
  const rows=catalogueFromTables(new Map([[5,table([r1,r2,r3])]]),'made-up.pdf',new Map(),motor);
  expect(rows).toHaveLength(3);
  expect(rows[0]!.entry).toMatchObject({model:'AX1 IE3',ratedKw:'0.75',inA:'1.85',efficiency:'0.84',pf:'0.7',un:'400 V',config:'80M4, 400 V, 50 Hz, 4-pole'});
  // Frequency from the table's supply, speed and frame from their columns, poles from the speed, Ia/In from the Is/In
  // column, weight by its heading and unit, the IE class from the title. No IP rating is printed, so none is made up.
  expect(rows[0]!.entry.extra).toEqual({frequency:'50',speed:'1420',poles:'4','frame-size':'80M4','efficiency-class-ie':'IE3','starting-current-ia-in':'7.3',weight:'20'});
  expect(rows.map(r=>r.entry.extra?.weight)).toEqual(['20','24','30']);
 });
 it('reads nothing extra when no parameter is ticked',()=>{
  expect(catalogueFromTables(new Map([[5,table([r1,r2])]]),'made-up.pdf').every(r=>!r.entry.extra)).toBe(true);
 });
 it('does not take a section heading in capitals for the model',()=>{
  const fans=[at(700,[40,'AUXILIARY FANS',80]),at(680,[40,'Frame size',40],[100,'Input power',40],[150,'Current',30],[200,'Voltage',30],[250,'Speed',30]),
   at(670,[100,'W',6],[150,'A',6],[200,'V',6],[250,'rpm',16]),
   at(650,[40,'63A',16],[100,'30',10],[150,'0.08',16],[200,'3×400',24],[250,'2300',20]),at(638,[40,'71A',16],[100,'30',10],[150,'0.08',16],[200,'3×400',24],[250,'2700',20])];
  expect(catalogueFromTables(new Map([[2,fans]]),'made-up.pdf').map(r=>r.entry.model)).toEqual(['63A','71A']);
 });
});

it('recognises PDF ratio subscripts on a second line and distinguishes starting current from torque',async()=>{
 const {ratioOf}=await import('../src/import/vocabulary');
 expect(ratioOf('I /I\nS N')).toBe(ratioOf('Starting current Ia/In'));
 for(const printed of ['Il/In','IL/IN','Ist/In','II/IN','I s/I n'])expect(ratioOf(printed)).toBe(ratioOf('Starting current Ia/In'));
 expect(ratioOf('T /T\nL N')).not.toBe(ratioOf('T /T\nB N'));
});

describe('reading ratings set out the way starter and transformer catalogues set them',()=>{
 it('reads a starter range at the voltage over its kW column, past a picture label in the margin and a control supply',()=>{
  const starter=[BUILT_IN.find(t=>t.id==='soft-starter')!];
  const page=[
   at(720,[40,'Rated operational voltage U',180],[222,'e, 208-600 V',55]),
   at(708,[40,'Rated control supply voltage U',180],[222,'s, 100-250 V AC, 50/60 Hz',110]),
   at(690,[126,'IEC',14],[250,'UL/CSA',30],[300,'Type',20]),
   at(680,[126,'Rated operational',60],[210,'Rated',20],[250,'Rated operational',60]),
   at(670,[132,'power',24],[210,'current',30],[250,'power',24]),
   at(660,[128,'400 V',22],[168,'500 V',22],[250,'208 V',22]),
   at(650,[132,'Pe',10],[172,'Pe',10],[212,'Ie',8],[252,'Pe',10]),
   at(640,[132,'kW',10],[172,'kW',10],[212,'A',6],[252,'hp',10]),
   at(620,[132,'15',10],[172,'18.5',16],[212,'30',10],[252,'7.5',12],[300,'QS30-600',40]),
   at(608,[96,'FIG0001',34],[132,'18.5',16],[172,'22',10],[212,'37',10],[252,'10',10],[300,'QS37-600',40]),
   at(596,[132,'22',10],[172,'25',10],[212,'45',10],[252,'10',10],[300,'QS45-600',40]),
   // The same starters for another voltage range, printed on under the headings above with a title of their own.
   at(584,[40,'Rated operational voltage U',180],[222,'e, 208-690 V',55]),
   at(576,[40,'Rated control supply voltage U',180],[222,', 100-250 V AC, 50/60 Hz',110]),
   at(570,[188,'s',4]),
   at(556,[132,'15',10],[172,'18.5',16],[212,'30',10],[252,'7.5',12],[300,'QS30-690',40]),
   at(544,[132,'18.5',16],[172,'22',10],[212,'37',10],[252,'10',10],[300,'QS37-690',40]),
  ];
  const rows=catalogueFromTables(new Map([[8,page]]),'made-up.pdf',new Map(),starter);
  // Un is the 400 V the kW column is printed for, not the kW read as volts nor the end of the 208-600 V range; the
  // control supply's 50/60 Hz is no frequency of the table; the kW is read from its own column, so nothing is red.
  expect(rows.map(r=>[r.entry.model,r.entry.ratedKw,r.entry.inA,r.entry.un,r.entry.config])).toEqual([
   ['QS30-600','15','30','400 V','400 V'],['QS37-600','18.5','37','400 V','400 V'],['QS45-600','22','45','400 V','400 V'],
   ['QS30-690','15','30','400 V','400 V'],['QS37-690','18.5','37','400 V','400 V']]);
  expect(rows.flatMap(r=>r.unverified)).toEqual([]);
 });
 it('gives each row the value of a cell drawn across several rows, and takes no section title for a heading or a name',()=>{
  const tx=[BUILT_IN.find(t=>t.id==='mv-transformer')!];
  const title=(y:number,h:number,text:string):PositionedLine=>({y,cells:[{x:40,y,h,text,w:text.length*h*0.5}]});
  const page=[
   title(700,20,'5kV/10kV'),title(684,13,'A. Electrical data'),
   at(650,[40,'Rated',20],[112,'Rated',20],[152,'Rated',20],[195,'No-load',28],[235,'Load',18]),
   at(640,[40,'Power',22],[66,'Frequency',36],[110,'primary',28],[150,'secondary',36],[197,'Loss',16],[237,'Loss',16]),
   at(630,[114,'voltage',26],[154,'voltage',26]),
   at(620,[44,'kVA',14],[118,'kV',9],[158,'kV',9],[199,'kW',11],[239,'kW',11]),
   at(600,[44,'100',13],[197,'0.4',11],[237,'1.6',11]),
   at(588,[44,'160',13],[197,'0.5',11],[237,'2.1',11]),
   // Printed once, between the rows, in cells drawn over all four: the frequency, the primary voltages (one of them
   // on the last row's line) and the secondary voltage.
   at(582,[70,'50/60 Hz',30],[118,'10',9],[160,'0.4',11]),
   at(576,[44,'250',13],[197,'0.7',11],[237,'2.8',11]),
   at(564,[44,'400',13],[116,'11',9],[197,'1.0',11],[237,'4.0',11]),
  ];
  const across=(y:number,x0:number,x1:number)=>({x0,y0:y,x1,y1:y}),down=(x:number)=>({x0:x,y0:558,x1:x,y1:612});
  // Row borders only in the kVA and loss columns; the frequency and voltage cells run from the top border to the bottom.
  const rules=[across(612,38,262),across(558,38,262),...[595,582,569].flatMap(y=>[across(y,38,62),across(y,190,262)]),...[38,62,108,145,190,230,262].map(down)];
  const rows=catalogueFromTables(new Map([[6,page]]),'made-up.pdf',new Map([[6,rules]]),tx);
  expect(rows.map(r=>[r.entry.model,r.entry.un,r.entry.config,r.entry.extra?.['rated-power'],r.entry.extra?.['primary-voltage'],r.entry.extra?.['no-load-losses']])).toEqual([
   ['','400 V','400 V, 50/60 Hz','100','10/11','400'],['','400 V','400 V, 50/60 Hz','160','10/11','500'],
   ['','400 V','400 V, 50/60 Hz','250','10/11','700'],['','400 V','400 V, 50/60 Hz','400','10/11','1000']]);
 });
});
