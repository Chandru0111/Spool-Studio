import {describe,it,expect} from 'vitest';
import {cleanValue,parseDrumOptions,readTables} from '../src/import/load-list';
import {emptyRow,calculateSheet,type SheetRow} from '../src/engine/sheet';
import {extractDrumSpecifications} from '../src/import/drum-catalogue';
import {loadListGroups} from '../src/engine/procurement';
import {planDrums,parseRuns} from '../src/engine/drums';
import {defaultDrum,Project} from '../src/store/schema';
import {openProject} from '../src/store/project';
import {defaultSuggestions} from '../src/engine/suggest';
import ExcelJS from 'exceljs';
const cable={odMm:29.2,kgKm:1850,minBendRadiusXOd:6};
const row=(v:Partial<SheetRow>={}):SheetRow=>({...emptyRow(),C:'MSB',D:'PDB-1',E:'3',F:'400',G:'30',I:'.85',N:'63',O:'Cu/XLPE/SWA/PVC',P:'4C',Q:'E - Free air / perforated tray / ladder',AC:'16',AH:'120',AM:'4',...v});

describe('import boundary checks',()=>{
 it('converts explicit units and scientific notation without truncating ambiguous values',()=>{
  expect(cleanValue('G','3e1',emptyRow())).toBe('30');expect(cleanValue('G','30000 W',emptyRow())).toBe('30');expect(cleanValue('F','0.4 kV',emptyRow())).toBe('400');expect(cleanValue('AH','0.12 km',emptyRow())).toBe('120');
  for(const raw of ['230/400 V','400 + 15','1.2.3','about 400','400foo'])expect(cleanValue('F',raw,emptyRow())).toBe(raw);
  expect(cleanValue('AC','4 × 25 mm²',emptyRow())).toBe('4 × 25 mm²');
 });
 it('uses saved XLSX formula values and leaves missing results blank',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Loads');sheet.addRow(['Tag','kW','PF']);sheet.addRow(['A',{formula:'15*2',result:30},{formula:'0.8+0.05'}]);const bytes=await book.xlsx.writeBuffer();
  const [table]=await readTables(new File([bytes as BlobPart],'loads.xlsx'));expect(table?.formulaCells).toBe(2);expect(table?.rows[1]).toEqual(['A','30','']);
 });
 it('accepts only complete supplier drum inputs and binds capacity to cable diameter',()=>{
  const table={name:'Synthetic supplier',formulaCells:0,rows:[['Code','Flange mm','Barrel mm','Width mm','Payload kg','Tare kg','Capacity m','Rated cable OD mm'],['S1','1250','500','750','1800','95','500','29.2']]};
  expect(parseDrumOptions(table)[0]?.drum.overrideM).toBe(500);expect(()=>parseDrumOptions({...table,rows:[table.rows[0]??[],['S1','1250','500','750','1800','95','500','']]})).toThrow('rated cable OD');
 });
 it('does not infer drum geometry from unlabeled OCR numbers',()=>{
  expect(extractDrumSpecifications([{page:1,mode:'ocr',confidence:95,text:'Drum code: TEST\n1250 500 750 1800 95'}],'Synthetic.png')).toHaveLength(0);
  const rows=extractDrumSpecifications([{page:2,mode:'text',confidence:null,text:'Drum code: TEST\nFlange diameter: 1250 mm\nBarrel diameter: 500 mm\nWinding width: 750 mm\nMax cable payload: 1800 kg\nTare weight: 95 kg'}],'Synthetic.pdf');expect(rows[0]?.drum).toMatchObject({flangeMm:1250,barrelMm:500,widthMm:750,maxLoadKg:1800,tareKg:95});
 });
});
describe('drum delivery calculations',()=>{
 it('conserves whole runs and responds to the lower lifting limit',()=>{
  const normal=planDrums(defaultDrum,cable,[120,95,160,210,75,140]),low=planDrums({...defaultDrum,liftLimitKg:400},cable,[120,95,160,210,75,140]);
  if(!normal.ok||!low.ok)throw Error('Expected valid plans');expect(normal.value.totalM).toBeCloseTo(840);expect(normal.value.drums.flatMap(d=>d.runsM)).toHaveLength(6);expect(low.value.drums.length).toBeGreaterThan(normal.value.drums.length);expect(low.value.drums.every(d=>d.grossKg<=400)).toBe(true);expect(low.value.unplacedM).toEqual([220.5,168]);
 });
 it('reports overlong runs and rejects bending, invalid geometry and excessive counts',()=>{
  const r=planDrums(defaultDrum,cable,[10000,100]);if(!r.ok)throw Error(r.message);expect(r.value.unplacedM).toEqual([10500]);expect(r.value.drums.flatMap(d=>d.runsM)).toEqual([105]);
  expect(planDrums({...defaultDrum,barrelMm:100},cable,[100]).ok).toBe(false);expect(planDrums({...defaultDrum,liftLimitKg:90},cable,[100]).ok).toBe(false);expect(parseRuns(Array(2001).fill('10').join(','))).toMatchObject({ok:false});
 });
 it('marks incomplete electrical designs as preliminary quantities and omits invalid inputs',()=>{
  const rows=[row({AM:''}),row({D:'BAD',AD:'2.5'})],groups=loadListGroups(rows,calculateSheet(rows));expect(groups).toHaveLength(1);expect(groups[0]?.uncheckedItems).toBe(1);expect(groups[0]?.runsM).toHaveLength(1);
 });
});
describe('portable project backups',()=>{
 it('restores v2 input state, recomputes results and rejects incompatible or invalid geometry',async()=>{
  const p=Project.parse({schemaVersion:2,name:'Synthetic',single:row(),list:{rows:[row()],source:'Test',defaults:defaultSuggestions},drum:defaultDrum,cable,runs:'120',demoGeometry:true});const file=(v:unknown)=>new File([JSON.stringify(v)],'test.spool.json');
  expect(await openProject(file({...p,calculated:{pass:true}}))).toEqual(p);await expect(openProject(file({...p,schemaVersion:1}))).rejects.toThrow('version 2');await expect(openProject(file({...p,cable:{...cable,odMm:0}}))).rejects.toThrow();
 });
});
