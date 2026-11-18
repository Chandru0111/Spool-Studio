import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import JSZip from 'jszip';
import {calculateSheet,calculateRow,emptyRow,type SheetRow} from '../src/engine/sheet';
import {suggestSheet,defaultSuggestions} from '../src/engine/suggest';
import {findIssues} from '../src/engine/issues';
import {fillTemplate} from '../src/export/template';
import {toSheetRows,detectColumns,cleanValue,readTables} from '../src/import/load-list';
import {parseDelimited} from '../src/import/parse';
import {Project,SheetRowData} from '../src/store/schema';
import {openProject} from '../src/store/project';

// Hostile or careless inputs must never crash the page, corrupt an export or silently stop autosave.
const row=(v:Partial<SheetRow>={}):SheetRow=>({...emptyRow(),C:'MSB',D:'P-1',E:'3',F:'400',G:'30',I:'0.85',N:'63',O:'Cu/XLPE/SWA/PVC',P:'4C',Q:'E - Free air / perforated tray / ladder',AC:'16',AH:'120',AM:'4',...v});
const sheetXml=async(bytes:Uint8Array)=>{const zip=await JSZip.loadAsync(bytes);return (await zip.file('xl/worksheets/sheet1.xml')?.async('string'))??(await Promise.all(Object.keys(zip.files).filter(f=>/^xl\/worksheets\/sheet\d+\.xml$/.test(f)).map(f=>zip.file(f)!.async('string')))).join('');};
const template=()=>fs.readFileSync('public/templates/cable-sizing.xlsx');

describe('export cannot be corrupted by extreme inputs',()=>{
 it('never writes Infinity or NaN as a cached Excel number',async()=>{
  const xml=await sheetXml(await fillTemplate(template(),[row({G:'1e308'}),row({D:'P-2',G:'1e-320',AH:'1e308'})]));
  expect(xml).not.toMatch(/<v>(-?Infinity|NaN)<\/v>/);
 });
 it('strips characters XML 1.0 forbids from typed text',async()=>{
  const xml=await sheetXml(await fillTemplate(template(),[row({D:'P￾-\uD800x\u0001y'})]));
  expect(xml).toContain('<t>P-xy</t>');expect(xml).not.toMatch(/[￾￿\uD800-\uDFFF\u0001]/);
 });
});

describe('numbers follow Excel, not JavaScript',()=>{
 it('treats hex, binary and Infinity spellings as invalid entries',()=>{
  for(const G of ['0x1A','0b11','0o7','Infinity','1e999'])expect(calculateRow(row({G})).invalid.G,G).toBeTruthy();
  expect(calculateRow(row({G:'1.5e1'})).cells.G).toBe(15);expect(calculateRow(row({G:'.5'})).cells.G).toBe(.5);expect(calculateRow(row({G:'-0'})).invalid.G).toBeUndefined();
 });
 it('survives extreme magnitudes without throwing',()=>{
  const rows=[row({D:'MSB',C:'TX',G:'1e308',AH:'1e308'}),row({C:'MSB',G:'1e-300'}),row({C:'MSB',D:'Z',G:'0',I:'0.01'})];
  expect(()=>findIssues(rows,calculateSheet(rows))).not.toThrow();expect(()=>suggestSheet(rows.map(r=>({...r,AC:'',N:''})),defaultSuggestions)).not.toThrow();
 });
});

describe('imported and pasted text stays within what a backup can hold',()=>{
 it('caps long imported text so autosave keeps working',()=>{
  const long='x'.repeat(5000),header=['Tag','From','kW'],rows=toSheetRows([header,[long,'MSB','5']],0,detectColumns(header));
  expect(rows[0]!.D.length).toBeLessThanOrEqual(300);
  expect(Project.innerType().shape.list.shape.rows.safeParse(rows).success).toBe(true);
  expect(cleanValue('D','y'.repeat(1000),emptyRow()).length).toBeLessThanOrEqual(300);
 });
 it('limits the size of a delimited file like a workbook',async()=>{
  expect(()=>parseDelimited(Array.from({length:10002},()=>'a,b').join('\n'))).toThrow(/10,000 rows/);
  expect(()=>parseDelimited(','.repeat(300))).toThrow(/200 columns/);
  await expect(readTables(new File([','.repeat(300)],'wide.csv'))).rejects.toThrow(/200 columns/);
 });
});

describe('project backups are validated before use',()=>{
 const file=(text:string)=>new File([text],'p.spool.json');
 it('rejects malformed or hostile JSON with a readable message',async()=>{
  await expect(openProject(file('{not json'))).rejects.toThrow(/not a readable project backup/i);
  await expect(openProject(file('null'))).rejects.toThrow(/version 2/i);
  await expect(openProject(file('[]'))).rejects.toThrow(/version 2/i);
 });
 it('drops prototype keys and unknown columns from rows',async()=>{
  const p=Project.parse({schemaVersion:2,name:'x',single:emptyRow(),list:{rows:[],source:'',defaults:defaultSuggestions},drum:{flangeMm:1250,barrelMm:500,widthMm:750,clearanceMm:25,fillFactor:.9,maxLoadKg:1800,tareKg:95,liftLimitKg:2000,wastagePct:5,overrideM:0},cable:{odMm:29,kgKm:1850,minBendRadiusXOd:6},runs:'1',demoGeometry:true});
  const text=JSON.stringify(p).replace('"list":{"rows":[]','"list":{"rows":[{"__proto__":{"polluted":"yes"},"constructor":"x","D":"A"}]');
  const back=await openProject(file(text));expect(back.list.rows[0]!.D).toBe('A');expect(Object.keys(back.list.rows[0]!)).not.toContain('constructor');
  expect(({} as Record<string,unknown>).polluted).toBeUndefined();
 });
});

describe('earth fault loop and short-circuit inputs',()=>{
 it('marks hostile fault inputs invalid or blank, never non-finite',()=>{
  const hostile=['-1','0','1e308','0x1A','Infinity','abc','1e-320'];
  for(const v of hostile)for(const col of ['AQ','AR','AT','AU','AX','AY','BH','BI','BK','BL'] as const)for(const AW of ['','Steel armour','Copper tape screen'])for(const AP of ['','TT']){
   const r=calculateRow(row({AP,AS:'MCB / RCBO Type B',AW,[col]:v}));
   for(const c of ['AV','AZ','BA','BB','BC','BD','BE','BF','BG','BJ','BM','BN','BO'] as const){const x=r.cells[c];if(typeof x==='number')expect(Number.isFinite(x),`${col}=${v} ${AW} ${AP} ${c}`).toBe(true);}
  }
 });
 it('flags a device or CPC outside the workbook lists',()=>{
  const r=calculateRow(row({AP:'IT',AS:'Type Z',AW:'Lead sheath'}));expect(r.invalid.AP).toBeTruthy();expect(r.invalid.AS).toBeTruthy();expect(r.invalid.AW).toBeTruthy();
  for(const c of ['AV','AZ','BC','BE','BF','BG'] as const)expect(r.cells[c]).toBe('');expect(r.cells.BA).toBe('Enter CPC data');
  expect(calculateRow(row({AP:'tt',AS:'MCB / RCBO Type C'})).invalid.AP).toBeUndefined();
 });
 it('exports fault inputs as entered and keeps device names as text',async()=>{
  const xml=await sheetXml(await fillTemplate(template(),[row({AP:'TT',AQ:'0.35',AR:'40',AS:'MCB / RCBO Type C',AU:'30',AW:'Steel armour',AX:'62',BH:'25'})]));
  expect(xml).toContain('<t>TT</t>');expect(xml).toMatch(/<c r="AQ2"[^>]*><v>0.35<\/v>/);expect(xml).toMatch(/<c r="AR2"[^>]*><v>40<\/v>/);expect(xml).toContain('<t>MCB / RCBO Type C</t>');expect(xml).toMatch(/<c r="AU2"[^>]*><v>30<\/v>/);expect(xml).toContain('<t>Steel armour</t>');expect(xml).toMatch(/<c r="AX2"[^>]*><v>62<\/v>/);expect(xml).toMatch(/<c r="BH2"[^>]*><v>25<\/v>/);
 });
 it('moves step06 and step07 saved fault inputs to their step08 columns once',()=>{
  const base={schemaVersion:2,name:'x',list:{source:'',defaults:defaultSuggestions},drum:{flangeMm:1250,barrelMm:500,widthMm:750,clearanceMm:25,fillFactor:.9,maxLoadKg:1800,tareKg:95,liftLimitKg:2000,wastagePct:5,overrideM:0},cable:{odMm:29,kgKm:1850,minBendRadiusXOd:6},runs:'1',demoGeometry:true};
  const step06={D:'DB-1',AP:'0.3',AQ:'MCB / RCBO Type C',AR:'500',AS:'6',AZ:'25',BA:'0.2',BB:'15000'},step07={D:'DB-2',AP:'0.3',AQ:'MCB / RCBO Type C',AR:'500',AT:'Steel armour',AU:'62',AV:'1.2',BE:'25',BF:'36',BH:'0.2',BI:'15000'};
  const p=Project.parse({...base,single:step07,list:{...base.list,rows:[step06,step07]}}),[a,b]=p.list.rows as [SheetRow,SheetRow];
  expect(p.sheetLayout).toBe(8);expect(p.single).toEqual(b);
  expect({AP:a.AP,AQ:a.AQ,AS:a.AS,AT:a.AT,AX:a.AX,BH:a.BH,BK:a.BK,BL:a.BL}).toEqual({AP:'',AQ:'0.3',AS:'MCB / RCBO Type C',AT:'500',AX:'6',BH:'25',BK:'0.2',BL:'15000'});
  expect({AP:b.AP,AQ:b.AQ,AS:b.AS,AT:b.AT,AW:b.AW,AX:b.AX,AY:b.AY,BH:b.BH,BI:b.BI,BK:b.BK,BL:b.BL}).toEqual({AP:'',AQ:'0.3',AS:'MCB / RCBO Type C',AT:'500',AW:'Steel armour',AX:'62',AY:'1.2',BH:'25',BI:'36',BK:'0.2',BL:'15000'});
  // A step08 save is read as it is: its AS is the device, not an old CPC size.
  expect(Project.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);expect(SheetRowData.parse({AS:'MCB / RCBO Type B'}).AS).toBe('MCB / RCBO Type B');
 });
});
