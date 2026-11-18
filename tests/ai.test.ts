import {describe,it,expect} from 'vitest';
import {aiCandidates,askAi,isLocalUrl,listBrief,parseAdvice,askAdvice} from '../src/import/ai';
import {readPanels} from '../src/import/panels';
import {suggestSheet,defaultSuggestions} from '../src/engine/suggest';
import {findIssues} from '../src/engine/issues';

// Synthetic drawing text and scripted AI replies: no model runs in tests.
const text=['MSB-01 400/230V 3PH','OUTGOING TO DB-L1 63A TPN MCCB 4C x 16mm2 Cu/XLPE/SWA/PVC L=60m','TO PUMP P-101 40A TPN 7.5kW'];
const reply=(circuits:unknown[])=>`Here you go: ${JSON.stringify({circuits})}`;

describe('AI reading of drawing text',()=>{
 it('keeps only values found in a quote that is really in the drawing',()=>{
  const r=aiCandidates(reply([
   {from:'MSB-01',to:'DB-L1',breakerA:'63A',sizeMm2:'16mm2',lengthM:'60m',quote:'TO DB-L1 63A TPN MCCB 4C x 16mm2 Cu/XLPE/SWA/PVC L=60m'},
   {to:'P-101',breakerA:'40A',kw:'7.5kW',lengthM:'35',quote:'TO PUMP P-101 40A TPN 7.5kW'},
   {to:'DB-X',kw:'99',quote:'TO DB-X 99kW'},
  ]),text);
  const [db,pump]=r.candidates;
  expect(r.candidates).toHaveLength(2);
  expect(db!.row).toMatchObject({D:'DB-L1',N:'63',AC:'16',AH:'60',C:''});// From is not in the quote, so it is dropped
  expect(pump!.row).toMatchObject({D:'P-101',N:'40',G:'7.5',AH:''});// a length the drawing does not print never reaches the sheet
  expect(db!.inferred.N).toContain('AI read from');
  expect(r.dropped).toBe(4);// MSB-01, the invented 35 m, and both DB-X values
 });
 it('rejects replies that are not a circuit list',()=>{
  expect(()=>aiCandidates('no json here',text)).toThrow(/not valid JSON/);
  expect(()=>aiCandidates('{"rows":[]}',text)).toThrow(/no circuit list/);
 });
 it('only talks to a model on this computer',async()=>{
  expect(isLocalUrl('http://127.0.0.1:11434/v1')).toBe(true);
  expect(isLocalUrl('http://localhost:1234/v1')).toBe(true);
  expect(isLocalUrl('https://integrate.api.nvidia.com/v1')).toBe(false);
  expect(isLocalUrl('http://127.0.0.1:8080/v1')).toBe(false);
  await expect(askAi({url:'https://integrate.api.nvidia.com/v1',model:'x'},text)).rejects.toThrow(/only talks to a model on this computer/);
 });
});

describe('load-list assistant',()=>{
 const header=['To','Phases','Voltage','kW','PF','Breaker A','Length m'];
 // As imported: the unticked "fed from" feeder row is left out.
 const rows=readPanels([{name:'Load List',formulaCells:0,rows:[['DB-L1 FED FROM MSB-01'],header,['LTG-1','1','230','1.2','0.9','10','25'],['MCC-1'],header,['P-101','3','400','22','0.86','50','']]}]).candidates.filter(c=>c.include).map(c=>c.row);
 it('briefs the model with the panel tree, every row and its issues, all from the engine',()=>{
  const fed=[...rows,{...rows[0]!,C:'MSB-01',D:'DB-L1',E:'1',G:'1.2',AH:''}],s=suggestSheet(fed,defaultSuggestions),brief=listBrief(s.effective,s.results,findIssues(s.effective,s.results));
  expect(brief).toContain('DB-L1: 1 outgoing cable (rows 1), 1.2 kW; fed by row 3 from MSB-01');expect(brief).toContain('MCC-1: 1 outgoing cable (rows 2), 22 kW; its own feeder is not on the sheet');
  expect(brief).toMatch(/row 1: DB-L1 → LTG-1 \| 1ph 230V 1\.2kW .* Ib 5\.8A Iz \d+(\.\d+)?A PASS/);expect(brief).toContain('row 2: MCC-1 → P-101');expect(brief).toContain('run MISSINGm');
  expect(brief.indexOf('row 3: MSB-01 → DB-L1')).toBeLessThan(brief.indexOf('row 1: DB-L1'));// flagged rows (the run-less feeder) first
 });
 it('keeps only fixes for real rows and input columns, cleaned like an import, never a cable run',()=>{
  const reply=JSON.stringify({answer:'DB-L1 is fed from MSB-01.',fixes:[
   {row:2,col:'E',value:'3 phase',why:'400 V'},{row:2,col:'AH',value:'40',why:'typical'},{row:9,col:'C',value:'X'},{row:1,col:'AL',value:'2'},{row:1,col:'C',value:'DB-L1'}]});
  const a=parseAdvice(`Sure: ${reply}`,rows);
  expect(a.answer).toBe('DB-L1 is fed from MSB-01.');
  expect(a.fixes).toEqual([]);// row 2 already says 3 phases and row 1 already has From DB-L1, so nothing changes
  expect(a.dropped).toBe(3);// the cable run, the row that does not exist and the calculated column
  expect(parseAdvice(JSON.stringify({answer:'',fixes:[{row:2,col:'H',value:'0.8',why:'standby pump'}]}),rows).fixes).toEqual([{row:2,col:'H',value:'0.8',why:'standby pump',to:'P-101'}]);
  expect(parseAdvice('plain text answer',rows)).toEqual({answer:'plain text answer',fixes:[],dropped:0});
 });
 it('asks only a model on this computer',async()=>{
  await expect(askAdvice({url:'https://api.example.com/v1',model:'x'},'brief',[],'hi',rows)).rejects.toThrow(/only talks to a model on this computer/);
 });
});
