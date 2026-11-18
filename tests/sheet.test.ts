import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import JSZip from 'jszip';
import {calculateSheet,calculateRow,emptyRow,listOptions,ratingBlock,CALC_COLS,type SheetRow} from '../src/engine/sheet';
import {suggestSheet,acceptSuggestions,defaultSuggestions,STANDARD_RATINGS} from '../src/engine/suggest';
import {fillTemplate,panelSheets,sheetNames} from '../src/export/template';
import {readTables} from '../src/import/load-list';
import fixture from './fixtures/excel-crosscheck.json';
import faultFixture from './fixtures/excel-fault-crosscheck.json';

const row=(v:Partial<SheetRow>={}):SheetRow=>({...emptyRow(),...v});
const feeder=(v:Partial<SheetRow>={})=>row({C:'MSB',D:'PDB-1',E:'3',F:'400',G:'30',I:'0.85',N:'63',O:'Cu/XLPE/SWA/PVC',P:'4C',Q:'E - Free air / perforated tray / ladder',AC:'16',AH:'120',AM:'4',...v});
const close=(a:unknown,b:number)=>{expect(typeof a).toBe('number');expect(a as number).toBeCloseTo(b,9);};

describe('Cable Sizing sheet formulas',()=>{
 it('matches the values Microsoft Excel calculated for 260 rows of the supplied workbook',()=>{
  const rows=fixture.rows.map(r=>row(r as Partial<SheetRow>)),results=calculateSheet(rows);
  // The step05 fixture predates columns AP–BE; those are covered by the step06 fixture below.
  results.forEach((r,i)=>{for(const c of CALC_COLS){const excel=(fixture.excel[i] as Record<string,unknown>)[c],app=r.cells[c];if(excel===undefined)continue;if(typeof excel==='number')close(app,excel);else expect(app,`${c}${i+2}`).toBe(excel);}});
 });
 it('matches Excel for 165 TN-S and TT circuits of the step08 earth fault loop, RCD, CPC, breaking capacity and short-circuit columns',()=>{
  const rows=faultFixture.rows.map(r=>row(r as Partial<SheetRow>)),results=calculateSheet(rows);
  // The step08 fixture predates the starting VD columns BR and BT; their test is below.
  results.forEach((r,i)=>{for(const c of CALC_COLS){const excel=(faultFixture.excel[i] as Record<string,unknown>)[c],app=r.cells[c];if(c==='BR'||c==='BT')continue;if(typeof excel==='number'){expect(typeof app,`${c}${i+2}`).toBe('number');expect(Math.abs((app as number)-excel),`${c}${i+2}`).toBeLessThanOrEqual(Math.abs(excel)*1e-9+1e-12);}else expect(app,`${c}${i+2}`).toBe(excel);}});
 });
 it('applies the workbook blank rules: diversity 1, THD 0, factors 1 and one cable',()=>{
  const c=calculateRow(feeder()).cells,ib=30000/(Math.sqrt(3)*400*.85),block=ratingBlock('3','Cu/XLPE/SWA/PVC','4C','E - Free air / perforated tray / ladder')!,r16=block.rows.find(r=>r[0]===16)!;
  close(c.J,30/.85);close(c.K,ib);close(c.M,ib);expect([c.T,c.V,c.X]).toEqual([1,1,1]);close(c.AE,r16[1]);close(c.AF,r16[1]);close(c.AI,r16[2]);close(c.AJ,ib*120*r16[2]/1000);close(c.AK,ib*120*r16[2]/4000);close(c.AO,ib);
  expect(c.AG).toBe(r16[1]>=63?'PASS':'FAIL');
 });
 it('suggests the smallest size meeting Ib ≤ In ≤ Iz and the VD limit',()=>{
  const c=calculateRow(feeder({C:'TX-1'})).cells,block=ratingBlock('3','Cu/XLPE/SWA/PVC','4C','E - Free air / perforated tray / ladder')!,ib=c.M as number;
  const first=block.rows.find(([,it,mv])=>it>=63&&ib*120*mv/4000<=4);expect(c.AB).toBe(first?.[0]);
  expect(calculateRow(feeder({G:'900',C:'TX-1'})).cells.AB).toBe('None passes');
 });
 it('adds the upstream feeder total VD only when From is filled, as the workbook does',()=>{
  const [up,down,noFrom,orphan]=calculateSheet([feeder({C:'TX-1'}),feeder({C:'PDB-1',D:'L-1',AH:'40'}),feeder({C:'',D:'L-2'}),feeder({C:'NOWHERE',D:'L-3'})]).map(r=>r.cells);
  close(up!.AL,up!.AK as number);close(down!.AL,(down!.AK as number)+(up!.AL as number));expect(noFrom!.AL).toBe('');expect(noFrom!.AN).toBe('');close(orphan!.AL,orphan!.AK as number);
 });
 it('checks motor starting VD: total VD at From plus the cable VD at the starting current, as the step09 workbook does',()=>{
  const [up,dol,typed,limit,none,odd,noFrom]=calculateSheet([feeder({C:'TX-1'}),feeder({C:'PDB-1',D:'M-1',AH:'40',BP:'DOL'}),feeder({C:'PDB-1',D:'M-2',BP:'Star-delta',BQ:'7.2'}),feeder({C:'PDB-1',D:'M-3',BP:'VFD',BS:'0.5'}),feeder({C:'PDB-1',D:'M-4'}),feeder({C:'PDB-1',D:'M-5',BP:'Air start'}),feeder({C:'',D:'M-6',BP:'DOL'})]);
  const c=dol!.cells;close(c.BR,(c.AL as number)+5*(c.AK as number));close(c.BR,(up!.cells.AL as number)+6*(c.AK as number));expect(c.BT).toBe((c.BR as number)<=15?'PASS':'FAIL');
  close(typed!.cells.BR,(typed!.cells.AL as number)+6.2*(typed!.cells.AK as number));
  close(limit!.cells.BR,limit!.cells.AL as number);expect(limit!.cells.BT).toBe('FAIL');
  expect([none!.cells.BR,none!.cells.BT]).toEqual(['','']);expect([odd!.cells.BR,odd!.cells.BT]).toEqual(['','']);expect(odd!.invalid.BP).toBeTruthy();
  expect([noFrom!.cells.BR,noFrom!.cells.BT]).toEqual(['','']);
  expect(calculateRow(feeder({C:'TX-1',G:'90',AH:'300',BP:'DOL'})).cells.BT).toBe('FAIL');
 });
 it('narrows dropdowns left to right and turns stale picks red',()=>{
  expect(listOptions(row({E:'3'})).P).toEqual([]);expect(listOptions(row({E:'3',O:'Cu/XLPE/SWA/PVC'})).P).toContain('4C');expect(listOptions(row({E:'1',O:'Cu/XLPE/SWA/PVC'})).P).not.toContain('4C');
  const stale=calculateRow(feeder({E:'1',F:'400'}));expect(Object.keys(stale.invalid).sort()).toEqual(['AC','F','N','P','Q']);expect(stale.cells.AE).toBe('');
  expect(calculateRow(feeder({N:'40'})).invalid.N).toMatch(/below the design current/);expect(calculateRow(feeder({I:'1.2'})).invalid.I).toMatch(/Power factor/);
 });
 it('reports temperatures and soil beyond the catalogue tables as out of range',()=>{
  const pvc=calculateRow(feeder({O:'Cu/PVC/SWA/PVC',P:'4C',R:'65'}));expect(pvc.cells.T).toBe('Out of range');expect(pvc.cells.AF).toBe('');
  expect(calculateRow(feeder({Q:'D - Direct in ground',W:'3.2',AC:''})).cells.X).toBe('Out of range');
 });
});

describe('load list suggestions',()=>{
 const load=(v:Partial<SheetRow>={})=>row({C:'PDB-1',D:'P-101',E:'3',F:'400',G:'22',I:'0.86',AH:'85',...v});
 it('fills blanks with a standard protection rating, the list defaults and a passing size',()=>{
  const s=suggestSheet([load()],defaultSuggestions),sug=s.suggested[0]!,c=s.results[0]!.cells,ib=c.M as number;
  expect(sug).toMatchObject({O:'Cu/XLPE/SWA/PVC',P:'4C',Q:defaultSuggestions.method,AM:'4',AD:'1'});
  expect(Number(sug.N)).toBe(STANDARD_RATINGS.find(r=>r>=ib));expect(sug.AC).toBe(String(c.AB));expect(c.AG).toBe('PASS');
 });
 it('never overwrites a typed value and adds parallel cables when one cable cannot carry the load',()=>{
  const typed=suggestSheet([load({N:'100',Q:'C - Clipped direct'})],defaultSuggestions).suggested[0]!;expect(typed.N).toBeUndefined();expect(typed.Q).toBeUndefined();
  const big=suggestSheet([load({G:'900',I:'0.9',AH:'60'})],defaultSuggestions),r=big.results[0]!.cells;
  expect(Number(big.suggested[0]!.AD)).toBeGreaterThan(1);expect(r.AG).toBe('PASS');expect(r.AN).not.toBe('FAIL');
 });
 it('sizes feeders before the circuits they supply so total VD is respected',()=>{
  const rows=[load({C:'MSB',D:'PDB-1',G:'120',AH:'150'}),load({AH:'140'})],s=suggestSheet(rows,defaultSuggestions);
  expect(s.results.map(r=>r.cells.AN)).toEqual(['PASS','PASS']);expect(acceptSuggestions(rows,s)[1]).toMatchObject({AC:s.suggested[1]!.AC,D:'P-101'});
 });
 it('re-sizes a circuit from its cache only when its feeder is unchanged',()=>{
  const sheet=(ah:string)=>suggestSheet([load({C:'MSB',D:'PDB-1',G:'120',AH:ah,AC:'70'}),load({AH:'140'})],defaultSuggestions);
  const short=sheet('20'),long=sheet('300');
  // A longer feeder leaves less VD for the circuit it supplies, so the circuit needs a bigger cable.
  expect([short.suggested[1]!.AC,long.suggested[1]!.AC]).toEqual(['16','70']);expect(long.results[1]!.cells.AN).toBe('PASS');
  expect(long.results[1]!.cells.AL).not.toBe(short.results[1]!.cells.AL);// calculateSheet's cache follows the feeder too, never a stale total VD
  expect(sheet('20')).toEqual(short);
 });
});

describe('Excel export',()=>{
 const template=fs.readFileSync('public/templates/cable-sizing.xlsx');
 it('exports one Cable Sizing sheet per panel, each with its own loads, filter and header notes',async()=>{
  const load=(C:string,D:string)=>feeder({C,D,G:'5',N:'16',AC:'2.5',AH:'20'});
  const zip=await JSZip.loadAsync(await fillTemplate(template,[load('MCC-2','P-1'),load('MCC-1','P-2'),load('MCC-2','P-3'),load('Settings','X-1')]));
  const book=await zip.file('xl/workbook.xml')!.async('string'),types=await zip.file('[Content_Types].xml')!.async('string'),rels=await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  expect([...book.matchAll(/<sheet name="([^"]+)"/g)].map(m=>m[1]).slice(0,5)).toEqual(['MCC-2','MCC-1','Settings (2)','Settings','Lists']);
  expect(book).toContain('localSheetId="0" name="_xlnm._FilterDatabase" vbProcedure="false">&apos;MCC-2&apos;!$A$1:$BT$197<');
  expect(book).toContain('localSheetId="2" name="_xlnm._FilterDatabase" vbProcedure="false">&apos;Settings (2)&apos;!$A$1:$BT$197<');
  expect(book).toContain('localSheetId="5" name="_xlnm._FilterDatabase" vbProcedure="false">CableTypes!');// was 3: two sheets were added before it
  const first=await zip.file('xl/worksheets/sheet1.xml')!.async('string'),second=await zip.file('xl/worksheets/sheet10.xml')!.async('string');
  expect(first).toContain('<t>P-1</t>');expect(first).toContain('<t>P-3</t>');expect(first).not.toContain('<t>P-2</t>');
  expect(second).toContain('<t>P-2</t>');expect(second).toContain('<c r="D2"');expect(second).not.toContain('tabSelected="true"');
  expect(rels).toContain('Target="worksheets/sheet10.xml"');expect(types).toContain('PartName="/xl/worksheets/sheet11.xml"');expect(types).toContain('PartName="/xl/comments1001.xml"');
  expect(await zip.file('xl/worksheets/_rels/sheet10.xml.rels')!.async('string')).toContain('Target="../comments1001.xml"');expect(zip.file('xl/comments1001.xml')).not.toBeNull();
  // Each sheet re-imports with its own loads.
  const tables=await readTables(new File([await zip.generateAsync({type:'uint8array'}) as BlobPart],'x.xlsx'));
  const loads=Object.fromEntries(tables.filter(t=>t.name.startsWith('MCC')||t.name==='Settings (2)').map(t=>[t.name,t.rows.slice(1).filter(r=>r[3]).map(r=>r[3])]));
  expect(loads).toEqual({'MCC-2':['P-1','P-3'],'MCC-1':['P-2'],'Settings (2)':['X-1']});
 });
 it('keeps a list where a row feeds another panel on one sheet, so Excel can chain total VD',async()=>{
  const rows=[feeder({C:'MSB',D:'MCC-1'}),feeder({C:'MCC-1',D:'P-1'})];
  expect(panelSheets(rows)).toEqual({panels:[],chained:1});
  const book=await (await JSZip.loadAsync(await fillTemplate(template,rows))).file('xl/workbook.xml')!.async('string');
  expect(book).toContain('<sheet name="Cable Sizing"');expect(book).not.toContain('rIdPanel1');
 });
 it('makes Excel-safe, unique sheet names',()=>{
  expect(sheetNames(['DB/1: [A]','','x'.repeat(40),'Lists','db/1: [a]'],['Lists'])).toEqual(['DB-1- -A-','No panel','x'.repeat(31),'Lists (2)','db-1- -a- (2)']);
 });
 const sheetXml=async(bytes:Uint8Array)=>(await JSZip.loadAsync(bytes)).file('xl/worksheets/sheet1.xml')!.async('string');
 it('types inputs into the template and keeps its formulas live',async()=>{
  const xml=await sheetXml(await fillTemplate(template,[feeder({BP:'DOL'})]));
  expect(xml).toContain('<c r="BP2" s="5" t="inlineStr"><is><t>DOL</t></is></c>');expect(xml).toMatch(/<c r="BR2" s="6"(?: t="str")?><f aca="false">IF\(OR\(BP2=&quot;&quot;,AL2=&quot;&quot;\),&quot;&quot;,IFERROR\(AL2\+\(IF\(BQ2=&quot;&quot;,INDEX\(Lists!\$L\$2:\$L\$5,MATCH\(BP2,Lists!\$K\$2:\$K\$5,0\)\),BQ2\)-1\)\*AK2/);expect(xml).toContain('IF(BR2&lt;=Def_StartVD,&quot;PASS&quot;');
  expect(xml).toContain('<c r="O2" s="5" t="inlineStr"><is><t>Cu/XLPE/SWA/PVC</t></is></c>');expect(xml).toMatch(/<c r="BB2" s="15" t="str"><f aca="false">IF\(NOT\(ISNUMBER\(BA2\)\),&quot;&quot;,IF\(CG2=&quot;&quot;,&quot;Enter Ze&quot;/);expect(xml).toContain('<c r="G2" s="5"><v>30</v></c>');expect(xml).toMatch(/<c r="AG2" s="5" t="str"><f aca="false">IF\(OR\(N2=/);
 });
 it('extends formulas, dropdowns and colour rules past the template rows for long lists',async()=>{
  const xml=await sheetXml(await fillTemplate(template,Array.from({length:250},(_,i)=>feeder({D:`L-${i}`}))));
  expect(xml).toContain('<dimension ref="A1:CU251"');expect(xml).toContain('INDEX($BB$2:$BB$251,MATCH(C251,$D$2:$D$251,0))');expect(xml).toContain('INDEX($CT$2:$CT$251,MATCH(C251,$D$2:$D$251,0))');expect(xml).toContain('SUMPRODUCT(--($C$2:$C$251=D251))');expect(xml).toContain('sqref="BE2:BE251"');expect(xml).toContain('<c r="J251" s="6"><f aca="false">IF(OR(G251=&quot;&quot;');expect(xml).toContain('MATCH(C251,$D$2:$D$251,0)');expect(xml).toContain('sqref="AG2:AG251"');expect(/\$197(?!\d)|2:[A-Z]{1,3}197(?!\d)/.test(xml)).toBe(false);
 });
});
