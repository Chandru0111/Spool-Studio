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
