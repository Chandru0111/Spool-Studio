import {describe,expect,it} from 'vitest';
import {checkRow} from '../src/import/checks';
import {catalogueFromDatasheet} from '../src/import/webpage';
import {emptyEntry,type CatalogueRow} from '../src/engine/loads';
import {BUILT_IN} from '../src/engine/equipment-types';

// Made-up ratings only: no maker's sheet is copied here.
const type=(id:string)=>BUILT_IN.find(t=>t.id===id)!;
const row=(v:Partial<CatalogueRow>):CatalogueRow=>({...emptyEntry(),...v});
const hv=(lv:string,eff='0.987')=>row({un:'415 V',inA:lv,efficiency:eff,extra:{'rated-power':'1600','hv-voltage':'11','hv-current':'84','no-load-losses':'2.1','load-losses':'17.5'}});

describe('checking that a row adds up, as an engineer would',()=>{
 it('passes a transformer whose currents, voltages, kVA, losses and efficiency agree',()=>{
  const c=checkRow(hv('2225.9'),type('hv-transformer'));
  expect(c.keys).toEqual([]);
  expect(c.held).toEqual(expect.arrayContaining(['rated-power','lv-voltage','lv-current','hv-voltage','hv-current','efficiency','no-load-losses','load-losses']));
 });
 it('flags the HV current read as the LV current, and an efficiency the losses do not give',()=>{
  const c=checkRow(hv('84'),type('hv-transformer'));
  expect(c.keys).toEqual(expect.arrayContaining(['lv-current','lv-voltage','rated-power']));
  expect(c.why.join(' ')).toMatch(/1600 kVA at 415 V works out to about 2226 A, not 84 A/);
  expect(checkRow(hv('2225.9','0.95'),type('hv-transformer')).why.join(' ')).toMatch(/efficiency of about 0\.988 at power factor 1 \(0\.985 at 0\.8\), not 0\.95/);
 });
 it('checks a motor by kW, voltage, current, power factor and efficiency, on one or three phases',()=>{
  const motor=type('motor');
  expect(checkRow(row({ratedKw:'11',un:'400 V',inA:'21.5',pf:'0.84',efficiency:'0.914'}),motor).keys).toEqual([]);
  expect(checkRow(row({ratedKw:'2.2',un:'230 V',inA:'13.4',pf:'0.8',efficiency:'0.89',config:'230 V, 1-phase'}),motor).keys).toEqual([]);
  // At 400 V a current that would only fit one phase is no excuse: the supply is three-phase.
  const off=checkRow(row({ratedKw:'11',un:'400 V',inA:'35',pf:'0.84',efficiency:'0.914'}),motor);
  expect(off.keys).toEqual(['rated-output','rated-voltage','rated-current']);expect(off.why[0]).toMatch(/about 20\.7 A, not 35 A/);
 });
 it('flags protection rated below the running current, and leaves ranges and missing values unchecked',()=>{
  expect(checkRow(row({ratedKw:'30',un:'400 V',inA:'60',protA:'40'}),type('generic')).why[0]).toMatch(/Protection 40 A is below the running current 60 A/);
  expect(checkRow(row({ratedKw:'11',un:'380-415 V',inA:'35',pf:'0.84'}),type('motor')).keys).toEqual([]);
  expect(checkRow(row({ratedKw:'11',inA:'35'}),type('motor')).keys).toEqual([]);
 });
});

describe('choosing between two values printed for one parameter',()=>{
 const page=(lines:string[])=>[{page:1,text:lines.join('\n'),mode:'text' as const,confidence:null}];
 it('takes the one that adds up with the row, and none when neither does',()=>{
  const sheet=(a:string,b:string)=>catalogueFromDatasheet(page(['Motor data','  Motor type     QX-160M4','  Rated output     11 kW','  Rated voltage     400 V',
   `  Current     ${a} A`,`  Current     ${b} A`,'  Power factor     0.84','  Efficiency     91.4 %']),'made-up.pdf',new Map(),new Map(),[type('motor')]).proposals[0]!;
  const r=sheet('35','21.5');
  expect(r.entry.inA).toBe('21.5');expect(r.evidence).toMatch(/the one that adds up/);
  expect(sheet('35','50').entry.inA).toBe('');
 });
});
