import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {calculateSheet,calculateRow,evaluateRow,emptyRow,type SheetRow} from '../src/engine/sheet';
import {sizeLadder,feederChain} from '../src/engine/explain';
import {findIssues} from '../src/engine/issues';
import {checkZip} from '../src/import/guard';
import {project,updateProject,undo,redo,history,newProject,fresh} from '../src/ui/state';

const row=(v:Partial<SheetRow>={}):SheetRow=>({...emptyRow(),C:'TX-1',D:'PDB-1',E:'3',F:'400',G:'30',I:'0.85',N:'63',O:'Cu/XLPE/SWA/PVC',P:'4C',Q:'E - Free air / perforated tray / ladder',AC:'16',AH:'120',AM:'4',...v});

describe('calculation explainer',()=>{
 it('ranks every size with the same tests as the Suggested Cable Size column',()=>{
  const r=row(),res=calculateRow(r),ladder=sizeLadder(r,res),first=ladder.find(s=>s.current&&s.vd);
  expect(first?.size).toBe(res.cells.AB);expect(ladder.find(s=>s.chosen)?.size).toBe(16);expect(ladder.filter(s=>s.suggested)).toHaveLength(1);
  for(const s of ladder)expect(s.iz).toBe(evaluateRow({...r,AC:String(s.size)},res.helpers.AT).cells.AF);
 });
 it('includes the upstream total VD in every step and follows the feeder chain from the source',()=>{
  const rows=[row({C:'TX-1',D:'MSB',G:'300',N:'630',AC:'240',AD:'2',AH:'30'}),row({C:'MSB',D:'PDB-1',G:'120',N:'250',AC:'95',AH:'80'}),row({C:'PDB-1',D:'P-1',G:'22',N:'50',AC:'16',AH:'90'})],results=calculateSheet(rows);
  const chain=feederChain(rows,results,2);expect(chain.map(l=>l.tag)).toEqual(['MSB','PDB-1','P-1']);expect(chain[2]!.totalVdPct).toBe(results[2]!.cells.AL);
  const ladder=sizeLadder(rows[2]!,results[2]!),upstream=results[1]!.cells.AL as number;for(const s of ladder)expect(s.totalVdPct).toBeCloseTo(upstream+(typeof s.vdPct==='number'?s.vdPct:0),10);
 });
});
describe('issue finder',()=>{
 it('reports failures, duplicates, chain breaks and missing inputs, errors first',()=>{
  const rows=[row({C:'TX-1',D:'MSB',G:'',N:'',AC:'',AH:''}),row({C:'MSB',D:'PDB-1',N:'40'}),row({C:'MSB',D:'PDB-1',AC:'2.5',N:'63'}),row({C:'MSB',D:'L-1',AH:'400',AC:'16'})];
  const issues=findIssues(rows,calculateSheet(rows)),kinds=issues.map(x=>`${x.row}:${x.kind}`);
  expect(kinds).toEqual(expect.arrayContaining(['1:current','1:invalid','2:current','1:duplicate','0:chain','0:missing']));
  const levels=issues.map(x=>x.level);expect(levels.indexOf('info')).toBeGreaterThan(levels.lastIndexOf('error'));
  const vd=findIssues([row({C:'TX-1',AH:'400'})],calculateSheet([row({C:'TX-1',AH:'400'})]));expect(vd.some(x=>x.kind==='vd'&&/exceeds/.test(x.text))).toBe(true);
 });
});
describe('file safety',()=>{
 it('accepts the workbook template and rejects non-zips and decompression bombs',()=>{
  expect(()=>checkZip(fs.readFileSync('public/templates/cable-sizing.xlsx'))).not.toThrow();
  expect(()=>checkZip(new TextEncoder().encode('Tag,kW\nP-1,30'))).toThrow(/not a valid XLSX/);
  // One central-directory entry claiming 300 MB of uncompressed data.
  const cd=new Uint8Array(46+1),v=new DataView(cd.buffer);v.setUint32(0,0x02014b50,true);v.setUint32(24,300*1024*1024,true);v.setUint16(28,1,true);
  const eocd=new Uint8Array(22),e=new DataView(eocd.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(10,1,true);e.setUint32(16,0,true);
  expect(()=>checkZip(new Uint8Array([...cd,...eocd]))).toThrow(/200 MB/);
 });
});
describe('undo and redo',()=>{
 it('restores whole-project snapshots and groups typing in one cell',()=>{
  const start=project.value;updateProject({name:'A'},'name');updateProject({name:'AB'},'name');updateProject({name:'Other'});
  expect(history.value.undo).toBe(2);undo();expect(project.value.name).toBe('AB');undo();expect(project.value).toBe(start);
  redo();expect(project.value.name).toBe('AB');updateProject({name:'New'});expect(history.value.redo).toBe(0);
 });
});

describe('new project',()=>{
 it('starts from a neutral, empty workspace in one undoable step',()=>{
  expect(fresh().name).toBe('Untitled project');expect(fresh().list.rows).toEqual([]);
  updateProject({name:'Reference job',list:{...project.value.list,rows:[row()],source:'reference.csv'}});const before=project.value;
  newProject();expect(project.value.name).toBe('Untitled project');expect(project.value.list.rows).toEqual([]);expect(project.value.list.source).toBe('');
  undo();expect(project.value).toBe(before);
 });
});
