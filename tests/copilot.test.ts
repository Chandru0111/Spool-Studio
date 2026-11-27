import {describe,expect,it} from 'vitest';
import {MAX_AI_ROWS,checkAnswer,copilotPrompt,pagesOf,readAnswer} from '../src/import/copilot';
import {BUILT_IN,withLearned} from '../src/engine/equipment-types';
import type {PageEvidence} from '../src/store/schema';

// Made-up datasheet pages and made-up answers, as an AI chat would give them: every value under its printed heading.
const type=(id:string)=>BUILT_IN.find(t=>t.id===id)!;
const page=(n:number,text:string):PageEvidence=>({page:n,text,mode:'text',confidence:null});
const motors=page(5,['AX1 IE3 motors, 4 poles, 400 V 50 Hz','Type Output kW Speed rpm Current A Eff. % 100% 75% P.F. Frame Weight kg',
 'AX1-80M4 0.75 1420 1.85 84 83 0.70 80M 9.5','AX1-90S4 1.1 1420 2.66 85.3 84.1 0.70 90S 12'].join('\n'));

describe('reading a datasheet through an AI chat answer',()=>{
 it('asks for every value under its printed heading, with the pages to read',()=>{
  const prompt=copilotPrompt('12-14');
  expect(prompt).toContain('give every technical value printed for that row, each under its heading exactly as printed');
  expect(prompt).toContain('Read only these pages of the PDF: 12-14.');
  expect(copilotPrompt()).not.toContain('Read only these pages');
 });
 it('picks the ticked parameters out of every value copied, and marks red each one not printed on the page it names',()=>{
  const answer='Here is the data:\n```json\n'+JSON.stringify({brand:'Acme',rows:[
   {page:5,model:'AX1-80M4',config:'400 V, 50 Hz',values:{'Voltage (V)':'400','Frequency (Hz)':'50','Output kW':'0.75','Speed (rpm)':'1420','Current (A)':'1.85',
    'Eff. (%) / 100%':'84','Eff. (%) / 75%':'83','P.F.':'0.70','Frame':'80M','Weight (kg)':'9.5'}},
   // A current and a frame that are not on the page.
   {page:5,model:'AX1-90S4',config:'400 V, 50 Hz',values:{'Voltage (V)':'400','Output kW':'1.1','Current (A)':'2.2','Eff. (%) / 75%':'84.1','Eff. (%) / 100%':'85.3','P.F.':'0.70','Frame':'100L','Colour':'blue'}},
  ]}).replace(/]}$/,',]}')+'\n```\nLet me know if you need more.';
  const read=readAnswer(answer,[type('motor')]);
  expect(read.brand).toBe('Acme');expect(read.ignored).toBe(0);expect(pagesOf(read)).toEqual([5]);
  const rows=checkAnswer(read,[motors],'made-up.pdf');
  expect(rows.map(r=>[r.entry.model,r.entry.ratedKw,r.entry.inA,r.entry.un,r.entry.efficiency,r.entry.pf,r.entry.extra?.['frame-size'],r.entry.extra?.speed,r.entry.extra?.weight])).toEqual([
   ['AX1-80M4','0.75','1.85','400 V','0.84','0.7','80M','1420','9.5'],['AX1-90S4','1.1','2.2','400 V','0.853','0.7','100L',undefined,undefined]]);
  expect(rows[0]).toMatchObject({page:5,unverified:[],entry:{type:'motor',source:'made-up.pdf, page 5 (Copilot)'}});
  expect(rows[0]!.unverifiedExtra).toBeUndefined();expect(rows[0]!.evidence).toContain('Rated current 1.85 ("Current (A)")');
  expect(rows[1]).toMatchObject({unverified:['inA'],unverifiedExtra:['frame-size']});
 });
 it('reads a bare figure in the parameter\'s unit, a unit in the heading, and a label the engineer taught',()=>{
  const lamp=page(1,'LX-36 LED panel 36 W 230 V'),load=page(2,'GL-500 heater set 5 kW 400 V efficiency 0.942');
  const read=readAnswer(JSON.stringify({rows:[{page:1,model:'LX-36',values:{Power:'36','Rated voltage':'230'}},
   {page:2,model:'GL-500',values:{'Nennleistung':'5 kW','Spannung':'400 V','Efficiency (%)':'94.2'}}]}),
   withLearned([type('lighting'),type('generic')],[{type:'generic',key:'rated-power',label:'Nennleistung'},{type:'generic',key:'rated-voltage',label:'Spannung'}]));
  const rows=checkAnswer(read,[lamp,load],'made-up.pdf');
  expect(rows.map(r=>[r.entry.type,r.entry.ratedKw,r.entry.un,r.entry.efficiency,r.unverified])).toEqual([['lighting','0.036','230 V','',[]],['generic','5','400 V','0.942',[]]]);
 });
 it('reads a thousands comma by the answer\'s decimals, and leaves a parameter two headings give differently for the engineer',()=>{
  const read=readAnswer(JSON.stringify({rows:[{page:5,model:'AX1-80M4',values:{'Output (kW)':'0.75','Speed (rpm)':'1,420','Rated current (A)':'1.85'}}]}),[type('motor')]);
  expect(read.rows[0]!.entry.extra?.speed).toBe('1420');expect(read.rows[0]!.entry.inA).toBe('1.85');
  const tie=readAnswer(JSON.stringify({rows:[{page:5,model:'AX1-80M4',values:{'Output (kW)':'0.75','Current (A)':'1.85','Current (A) ':'1.9'}}]}),[type('motor')]);
  expect(tie.rows[0]!.entry.inA).toBe('');
 });
 it('names the type by the values, and marks a row red whose page the file does not have',()=>{
  const read=readAnswer('[{"page":99,"model":"AX1-80M4","values":{"Output (kW)":"0.75","__proto__":{"polluted":true},"Speed (rpm)":"1420"}}]',[type('lighting'),type('motor')]);
  expect(read.rows[0]).toMatchObject({entry:{type:'motor'},typeGuess:false});expect(({} as Record<string,unknown>).polluted).toBeUndefined();
  const [row]=checkAnswer(read,[motors],'made-up.pdf');
  expect(row).toMatchObject({page:0,unverified:['model','ratedKw']});expect(row!.evidence).toContain('page 99, which the file does not have');
  // Values that fit two picked types equally leave the type for the engineer to choose.
  expect(readAnswer('{"rows":[{"page":5,"model":"AX1-80M4","values":{"Rated voltage (V)":"400"}}]}',[type('lighting'),type('motor')]).rows[0]!.typeGuess).toBe(true);
 });
 it('refuses an answer it cannot read, saying what to do',()=>{
  expect(()=>readAnswer('Sorry, I cannot open the file.',[type('motor')])).toThrow(/no JSON/);
  expect(()=>readAnswer('{"rows":[{"page":1,"model":"A1",}',[type('motor')])).toThrow(/not valid JSON/);
  expect(()=>readAnswer('{"data":[]}',[type('motor')])).toThrow(/no "rows" list/);
  expect(()=>readAnswer(JSON.stringify({rows:Array.from({length:MAX_AI_ROWS+1},()=>({page:1,model:'A1'}))}),[type('motor')])).toThrow(/more than 1000 rows/);
  expect(()=>readAnswer('{"rows":[{"page":1,"values":{"Colour":"blue"}}]}',[type('motor')])).toThrow(/no rows of the picked/);
 });
});
