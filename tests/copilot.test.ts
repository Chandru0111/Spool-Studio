import {describe,expect,it} from 'vitest';
import {MAX_AI_ROWS,checkAnswer,copilotPrompt,pagesOf,readAnswer} from '../src/import/copilot';
import {BUILT_IN} from '../src/engine/equipment-types';
import type {PageEvidence} from '../src/store/schema';

// Made-up datasheet pages and made-up answers, as an AI chat would give them.
const type=(id:string)=>BUILT_IN.find(t=>t.id===id)!;
const page=(n:number,text:string):PageEvidence=>({page:n,text,mode:'text',confidence:null});
const motors=page(5,['AX1 IE3 motors, 4 poles, 400 V 50 Hz','Type Output kW Speed rpm Current A Eff. % P.F. Frame',
 'AX1-80M4 0.75 1420 1.85 84 0.70 80M','AX1-90S4 1.1 1420 2.66 85.3 0.70 90S'].join('\n'));

describe('reading a datasheet through an AI chat answer',()=>{
 it('asks for each picked type by its id, with the keys and units to give and the pages to read',()=>{
  const prompt=copilotPrompt([type('motor'),type('lighting')],'12-14');
  expect(prompt).toContain('type "motor" (Motor):');
  expect(prompt).toContain('"rated-output": Rated output, in kW');
  expect(prompt).toContain('"power-factor": Power factor\n');
  expect(prompt).toContain('type "lighting" (Lighting):');
  expect(prompt).toContain('Read only these pages of the PDF: 12-14.');
  expect(copilotPrompt([type('motor')])).not.toContain('Read only these pages');
 });
 it('takes the values in the catalogue form and marks red each one not printed on the page it names',()=>{
  const answer='Here is the data:\n```json\n'+JSON.stringify({brand:'Acme',rows:[
   {page:5,type:'motor',model:'AX1-80M4',config:'400 V, 50 Hz',values:{'rated-output':'0.75 kW','rated-voltage':'400 V','rated-current':'1.85 A',efficiency:'84 %','power-factor':'0.70','frame-size':'80M'}},
   // A current and a frame that are not on the page, a value under its label instead of its key, and one never asked for.
   {page:5,type:'motor',model:'AX1-90S4',config:'400 V, 50 Hz',values:{'rated-output':'1.1','rated-voltage':'400','rated-current':'2.2',efficiency:'85.3','Power factor':'0.70','frame-size':'100L',colour:'blue'}},
  ]}).replace(/]}$/,',]}')+'\n```\nLet me know if you need more.';
  const read=readAnswer(answer,[type('motor')]);
  expect(read.brand).toBe('Acme');expect(read.ignored).toBe(1);expect(pagesOf(read)).toEqual([5]);
  const rows=checkAnswer(read,[motors],'made-up.pdf');
  expect(rows.map(r=>[r.entry.model,r.entry.ratedKw,r.entry.inA,r.entry.un,r.entry.efficiency,r.entry.pf,r.entry.extra?.['frame-size']])).toEqual([
   ['AX1-80M4','0.75','1.85','400 V','0.84','0.7','80M'],['AX1-90S4','1.1','2.2','400 V','0.853','0.7','100L']]);
  expect(rows[0]).toMatchObject({page:5,unverified:[],entry:{type:'motor',source:'made-up.pdf, page 5 (Copilot)'}});
  expect(rows[0]!.unverifiedExtra).toBeUndefined();
  expect(rows[1]).toMatchObject({unverified:['inA'],unverifiedExtra:['frame-size']});
 });
 it('reads a bare figure in the unit asked for, and an efficiency given in % against one printed as a fraction',()=>{
  const lamp=page(1,'LX-36 LED panel 36 W 230 V'),load=page(2,'GL-500 heater set 5 kW 400 V efficiency 0.942');
  const read=readAnswer(JSON.stringify({rows:[{page:1,type:'lighting',model:'LX-36',values:{power:'36','rated-voltage':'230'}},
   {page:2,type:'generic',model:'GL-500',values:{'rated-power':'5','rated-voltage':'400 V',efficiency:'94.2 %'}}]}),[type('lighting'),type('generic')]);
  const rows=checkAnswer(read,[lamp,load],'made-up.pdf');
  expect(rows.map(r=>[r.entry.ratedKw,r.entry.un,r.entry.efficiency,r.unverified])).toEqual([['0.036','230 V','',[]],['5','400 V','0.942',[]]]);
 });
 it('names the type by the values when the answer leaves it out, and marks a row red whose page the file does not have',()=>{
  const read=readAnswer('[{"page":99,"model":"AX1-80M4","values":{"rated-output":"0.75","__proto__":{"polluted":true},"rated-current":"1.85"}}]',[type('lighting'),type('motor')]);
  expect(read.rows[0]).toMatchObject({entry:{type:'motor'},typeGuess:false});expect(({} as Record<string,unknown>).polluted).toBeUndefined();
  const [row]=checkAnswer(read,[motors],'made-up.pdf');
  expect(row).toMatchObject({page:0,unverified:['model','ratedKw','inA']});expect(row!.evidence).toContain('page 99, which the file does not have');
  // Values that fit two picked types equally leave the type for the engineer to choose.
  expect(readAnswer('{"rows":[{"page":5,"model":"AX1-80M4","values":{"rated-voltage":"400"}}]}',[type('lighting'),type('motor')]).rows[0]!.typeGuess).toBe(true);
 });
 it('refuses an answer it cannot read, saying what to do',()=>{
  expect(()=>readAnswer('Sorry, I cannot open the file.',[type('motor')])).toThrow(/no JSON/);
  expect(()=>readAnswer('{"rows":[{"page":1,"model":"A1",}',[type('motor')])).toThrow(/not valid JSON/);
  expect(()=>readAnswer('{"data":[]}',[type('motor')])).toThrow(/no "rows" list/);
  expect(()=>readAnswer(JSON.stringify({rows:Array.from({length:MAX_AI_ROWS+1},()=>({page:1,model:'A1'}))}),[type('motor')])).toThrow(/more than 1000 rows/);
  expect(()=>readAnswer('{"rows":[{"page":1,"colour":"blue"}]}',[type('motor')])).toThrow(/no rows of the picked/);
 });
});
