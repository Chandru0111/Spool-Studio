import {describe,it,expect} from 'vitest';
import {bendReference} from '../src/engine/bend-reference';
import {Project,defaultDrum} from '../src/store/schema';
import {emptyRow} from '../src/engine/sheet';
import {defaultSuggestions} from '../src/engine/suggest';

describe('bending guidance',()=>{
 it('uses the supplied table boundaries without turning installation guidance into a drum limit',()=>{
  expect(bendReference('single',25)).toEqual({installation:6,fixed:4});
  expect(bendReference('single',25.01)).toEqual({installation:10,fixed:6});
  expect(bendReference('multi',29.2)).toEqual({installation:10,fixed:6});
  expect(bendReference('armoured',29.2)).toEqual({installation:10,fixed:6});
  expect(bendReference('',29.2)).toBeNull();expect(bendReference('single',0)).toBeNull();
 });
 it('opens old project backups and preserves separate user guidance',()=>{
  const input={schemaVersion:2,sheetLayout:8,name:'Test',single:emptyRow(),list:{rows:[],source:'',defaults:defaultSuggestions},drum:defaultDrum,cable:{odMm:29.2,kgKm:1850,minBendRadiusXOd:6},runs:'10',demoGeometry:true};
  expect(Project.parse(input).bendGuidance.type).toBe('');
  const p=Project.parse({...input,bendGuidance:{type:'multi',installation:'12',fixed:'8',source:'Product data'}});
  expect(p.bendGuidance).toEqual({type:'multi',installation:'12',fixed:'8',source:'Product data'});
  expect(p.cable.minBendRadiusXOd).toBe(6);
  expect(Project.safeParse({...input,bendGuidance:{type:'unknown'}}).success).toBe(false);
 });
});
