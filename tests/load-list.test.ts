import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {detectColumns,bestHeader,toSheetRows,readTables} from '../src/import/load-list';
import {COLUMNS,INPUT_COLS,emptyRow,calculateSheet,type SheetRow} from '../src/engine/sheet';
import {fillTemplate} from '../src/export/template';
import {loadListGroups} from '../src/engine/procurement';

const row=(v:Partial<SheetRow>):SheetRow=>({...emptyRow(),...v});
describe('load list import',()=>{
 it('finds the sizing inputs in a typical load list',()=>{
  const rows=[['Project load list'],[],['Tag No.','Description','Fed From','Phase','Voltage (V)','Rated kW','PF','Diversity','Breaker (A)','Length (m)']];
  expect(bestHeader(rows)).toBe(2);expect(detectColumns(rows[2]!)).toEqual({C:2,D:0,E:3,F:4,G:5,H:7,I:6,N:8,AH:9});
 });
 it('recognises every input column of the Cable Sizing sheet by its own header',()=>{
  const mapping=detectColumns(COLUMNS.map(c=>c.header));for(const col of INPUT_COLS)expect(mapping[col],col).toBe(COLUMNS.findIndex(c=>c.col===col));
 });
 it('cleans units, percentages and dropdown names, and skips spacer rows',()=>{
  const header=['Tag','From','Phase','Voltage','kW','PF','Diversity','Cable type','Cores','Method','Length'];
  const [r,...rest]=toSheetRows([header,['P-1','MCC-1','3P','415V','1,250','86%','80%','cu/xlpe/swa/pvc','4 core','e','85 m'],['','','','','','','','','','',''],['','Spare','','','','','','','','','']],0,detectColumns(header));
  expect(r).toMatchObject({D:'P-1',C:'MCC-1',E:'3',F:'415',G:'1250',I:'0.86',H:'0.8',O:'Cu/XLPE/SWA/PVC',P:'4C',Q:'E - Free air / perforated tray / ladder',AH:'85'});expect(rest).toHaveLength(0);
 });
 // The Excel round trip is I/O heavy; next to the image tests it can pass 5 s on a busy machine.
 it('re-imports an exported workbook with the same inputs',async()=>{
  const rows=[row({C:'TX-1',D:'MSB',E:'3',F:'400',G:'300',H:'0.8',I:'0.85',N:'630',O:'Cu/XLPE/SWA/PVC',P:'4C',Q:'C - Clipped direct',AC:'240',AD:'2',AH:'40',AM:'4'}),row({C:'MSB',D:'DB-1',E:'1',F:'230',G:'5',I:'0.9',AH:'30'})];
  const bytes=await fillTemplate(fs.readFileSync('public/templates/cable-sizing.xlsx'),rows),[table]=await readTables(new File([bytes as BlobPart],'export.xlsx'));
  const back=toSheetRows(table!.rows,bestHeader(table!.rows),detectColumns(table!.rows[bestHeader(table!.rows)]!));expect(back).toEqual(rows);
 },20000);
});
describe('drum runs from the load list',()=>{
 it('groups runs by product and counts each single core and parallel cable',()=>{
  const rows=[row({C:'TX-1',D:'MSB',E:'3',F:'400',G:'300',I:'0.85',N:'630',O:'Cu/XLPE/AWA/PVC',P:'1C',Q:'C - Clipped direct',AC:'240',AD:'2',AH:'40'}),row({C:'MSB',D:'P-1',E:'3',F:'400',G:'22',I:'0.86',N:'50',O:'Cu/XLPE/SWA/PVC',P:'4C',Q:'E - Free air / perforated tray / ladder',AC:'10',AH:'85'})];
  const groups=loadListGroups(rows,calculateSheet(rows));
  expect(groups.map(g=>[g.label,g.runsM])).toEqual([['Cu/XLPE/AWA/PVC · 1C × 240 mm²',[40,40,40,40,40,40]],['Cu/XLPE/SWA/PVC · 4C × 10 mm²',[85]]]);
 });
});

describe('earth fault loop and short-circuit inputs import',()=>{
 it('maps the step08 headings and keeps earthing system, device and CPC type names as text',()=>{
  const g=[['From','To','Design Load (kW)','Earthing System','Ze at From (Ω)','Earth Electrode Resistance Ra (Ω)','Protective Device Type','RCD Rated Residual Current IΔn (mA)','CPC Type','CPC Size (mm²)','CPC Resistance at 20°C (mΩ/m)','Fault Level at From (kA)','Breaking Capacity (kA)','Fault Clearance Time (s)','Let-through Energy I²t (A²s)','Disconnection Current Ia (A)'],['MSB','DB','10','TT','0.35','40','MCB / RCBO Type C','30','Steel armour','62','1.2','25','36','0.2','1e6','300']];
  const r=toSheetRows(g,0,detectColumns(g[0]!))[0]!;
  expect({AP:r.AP,AQ:r.AQ,AR:r.AR,AS:r.AS,AT:r.AT,AU:r.AU,AW:r.AW,AX:r.AX,AY:r.AY,BH:r.BH,BI:r.BI,BK:r.BK,BL:r.BL}).toEqual({AP:'TT',AQ:'0.35',AR:'40',AS:'MCB / RCBO Type C',AT:'300',AU:'30',AW:'Steel armour',AX:'62',AY:'1.2',BH:'25',BI:'36',BK:'0.2',BL:'1000000'});
 });
 it('reads the starter type into the sheet\'s list names and blanks non-motors',()=>{
  const g=[['Description','Rated Input Power (kW)','Starter Type'],['Pump A','15','D.O.L'],['Fan B','30','Star / Delta'],['Comp C','55','VSD'],['Heater D','12','-'],['Mixer E','5.5','Soft Start'],['Hoist F','7.5','Air motor']];
  expect(detectColumns(g[0]!).BP).toBe(2);expect(toSheetRows(g,0,detectColumns(g[0]!)).map(r=>r.BP)).toEqual(['DOL','Star-delta','VFD','','Soft starter','Air motor']);
 });
});
