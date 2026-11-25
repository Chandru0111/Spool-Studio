import {describe,expect,it} from 'vitest';
import {loadsIn,nameScore,valueIn} from '../src/import/vocabulary';
import {catalogueFromTables} from '../src/import/rating-table';
import {catalogueFromDatasheet} from '../src/import/webpage';
import {catalogueFromPages} from '../src/import/equipment';
import {BUILT_IN} from '../src/engine/equipment-types';
import type {PositionedLine} from '../src/import/parse';

// Made-up catalogue pages and labels only: no maker's sheet is copied here.
const motor=BUILT_IN.find(t=>t.id==='motor')!.params;
const page=(n:number,lines:string[])=>({page:n,text:lines.join('\n'),mode:'text' as const,confidence:null});

describe('load points',()=>{
 it('reads full load however it is written, and part loads as fractions',()=>{
  for(const t of ['4/4','1/1','FL','F.L.','Full-load','full load','100 %','at 100% load'])expect(loadsIn(t),t).toEqual([1]);
  expect(loadsIn('3/4 load')).toEqual([0.75]);
  expect(loadsIn('three quarter load')).toEqual([0.75]);
  expect(loadsIn('half load')).toEqual([0.5]);
  expect(loadsIn('Efficiency 100 / 75 / 50 %')).toEqual([1,0.75,0.5]);
  // A lone number is a load point only in a heading cell.
  expect(loadsIn('100',true)).toEqual([1]);expect(loadsIn('100')).toEqual([]);
 });
 it('does not take ratios, dual ratings or units for load points',()=>{
  for(const t of ['Ia/In','230/400 V','Power factor','FLA','Efficiency class'])expect(loadsIn(t),t).toEqual([]);
 });
});

describe('naming a parameter from a printed label',()=>{
 const p=(label:string,unit='')=>({label,unit});
 it('finds frequency, weight, IP code and efficiency class by their names, abbreviations and units',()=>{
  expect(nameScore(p('Frequency','Hz'),'Freq.','Freq.','60 Hz')).toBeGreaterThan(0);
  expect(nameScore(p('Frequency','Hz'),'f','f','50 Hz')).toBeGreaterThan(0);
  expect(nameScore(p('Weight','kg'),'Mass','Mass','84 lb')).toBeGreaterThan(0);
  expect(nameScore(p('IP rating'),'Degree of protection','Degree of protection','IP 55')).toBeGreaterThan(0);
  expect(nameScore(p('Efficiency class (IE)'),'IE-CL','IE-CL','IE3')).toBeGreaterThan(0);
  // A word misread by one letter still counts.
  expect(nameScore(p('Efficiency class (IE)'),'Effciency class','Effciency class','IE3')).toBeGreaterThan(0);
 });
 it('refuses a label for another quantity or another value',()=>{
  expect(nameScore(p('Weight','kg'),'Height','Height','96 mm')).toBe(0);
  expect(nameScore(p('Efficiency class (IE)'),'Efficiency','Efficiency','94.5 %')).toBe(0);
  expect(nameScore(p('Output current','A'),'Input current','Input current','10 A')).toBe(0);
  expect(nameScore(p('Heavy-duty power','kW'),'Rated power (normal duty)','Rated power (normal duty)','5.5 kW')).toBe(0);
  expect(nameScore(p('Starting current Ia/In'),'Starting current','Starting current','85 A')).toBe(0);
 });
 it('gives the value in the parameter\'s unit and shape',()=>{
  expect(valueIn(p('Weight','kg'),'84 lb')).toEqual({value:'38.102',was:'84 lb'});
  expect(valueIn(p('Weight','kg'),'38,5')).toEqual({value:'38.5'});
  expect(valueIn(p('Frequency','Hz'),'50/60 Hz')).toEqual({value:'50/60'});
  expect(valueIn(p('IP rating'),'IP 55 (IEC 60034-5)')).toEqual({value:'IP55'});
  expect(valueIn(p('Efficiency class (IE)'),'IE 3')).toEqual({value:'IE3'});
  expect(valueIn(p('Starting current Ia/In'),'85 A')).toBeNull();
 });
});

describe('reading a one-product datasheet',()=>{
 it('takes efficiency and power factor at full load, the model by its heading, and the ticked parameters by name',()=>{
  const {proposals:[r]}=catalogueFromDatasheet([page(1,['Data sheet for three-phase motor','  Motor type     QX-160M4','  Rated output     11 kW',
   '  Rated voltage     400 V','  Rated frequency f     50 Hz','  Rated current     21.5 A','  Load     50 %     75 %     100 %',
   '  Efficiency     90.1 %     91.2 %     91.4 %','  Power factor cos φ     0.70     0.79     0.84','  Rated speed     1460 rpm',
   '  Degree of protection     IP55','  IE-CL     IE3','  Net weight     84 lb'])],'made-up.pdf',new Map(),new Map(),motor);
  expect(r!.entry).toMatchObject({model:'QX-160M4',ratedKw:'11',inA:'21.5',un:'400 V',efficiency:'0.914',pf:'0.84',config:'400 V, 50 Hz'});
  expect(r!.entry.extra).toEqual({frequency:'50',speed:'1460','efficiency-class-ie':'IE3','ip-rating':'IP55',weight:'38.102'});
  expect(r!.evidence).toContain('84 lb = 38.102 kg');
 });
 it('takes the full-load value of a label listing several loads, and never a part-load one',()=>{
  const {proposals:[r]}=catalogueFromDatasheet([page(1,['Motor data','  Model number     QX-90L4','  Rated power     1.5 kW','  Rated current     3.4 A',
   '  Efficiency at 100 / 75 / 50 % load     85.3 / 85.9 / 84.1','  Power factor at 3/4 load     0.72','  Power factor FL     0.79'])],'made-up.pdf');
  expect(r!.entry).toMatchObject({model:'QX-90L4',efficiency:'0.853',pf:'0.79'});
  const {proposals:[part]}=catalogueFromDatasheet([page(1,['  Model number     QX-90L4','  Rated power     1.5 kW','  Rated current     3.4 A',
   '  Power factor at 3/4 load     0.72'])],'made-up.pdf');
  expect(part!.entry.pf).toBe('');
 });
});

describe('reading running text',()=>{
 it('finds the model by the words that head it, never a plant tag, and values at full load',()=>{
  const text='Equipment ID: 10CBA01\nModel number: QX-200\nRated power 7.5 kW\nRated current 14.2 A\nPower factor at 3/4 load 0.80\n'+
   'Power factor at full load 0.85\nEfficiency class IE3\nEfficiency 91.5 %';
  const [r]=catalogueFromPages([{page:1,text,mode:'text',confidence:null}],'made-up.pdf');
  expect(r!.entry).toMatchObject({model:'QX-200',ratedKw:'7.5',inA:'14.2',pf:'0.85',efficiency:'0.915'});
  expect(catalogueFromPages([{page:1,text:'Motor type: QX-132S\nRated power 5.5 kW',mode:'text',confidence:null}],'made-up.pdf')[0]!.entry.model).toBe('QX-132S');
 });
});

describe('reading a rating table',()=>{
 const at=(y:number,...cells:[number,string,number?][]):PositionedLine=>({y,cells:cells.map(([x,text,w])=>({x,y,text,w:w??text.length*5}))});
 const lines=[at(700,[40,'QX MOTORS 400 V',80]),
  at(680,[40,'Type',20],[100,'Output',30],[150,'f',5],[200,'Current',35],[250,'Eff.',20],[350,'cos φ',25],[450,'Mass',20]),
  at(670,[100,'kW',10],[150,'Hz',10],[200,'A',5],[250,'3/4',15],[300,'FL',10],[350,'3/4',15],[400,'1/1',15],[450,'kg',10]),
  at(650,[40,'QX80-4',30],[100,'0.75',16],[150,'50',10],[200,'1.9',12],[250,'80.5',16],[300,'82.0',16],[350,'0.65',16],[400,'0.72',16],[450,'9',6]),
  at(638,[40,'QX80-4',30],[100,'0.9',12],[150,'60',10],[200,'2.2',12],[250,'81.0',16],[300,'83.0',16],[350,'0.66',16],[400,'0.74',16],[450,'9',6])];
 it('takes the full-load columns, each row\'s own frequency, and the weight by its unit',()=>{
  const rows=catalogueFromTables(new Map([[3,lines]]),'made-up.pdf',new Map(),motor);
  expect(rows.map(r=>[r.entry.efficiency,r.entry.pf])).toEqual([['0.82','0.72'],['0.83','0.74']]);
  expect(rows.map(r=>r.entry.extra)).toEqual([{frequency:'50',weight:'9'},{frequency:'60',weight:'9'}]);
  expect(rows[1]!.entry.config).toContain('60 Hz');
 });
});
