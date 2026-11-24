import {describe,it,expect} from 'vitest';
import {BUILT_IN,defaultOn,doubleFeeds,pickedTypes,type EquipmentType} from '../src/engine/equipment-types';
import {emptyEntry,fillRow,indexCatalogue,emptyLoad} from '../src/engine/loads';
import {applyPick,keepPicked,type Proposal} from '../src/import/equipment';
import {Project} from '../src/store/schema';
import {fresh} from '../src/ui/state';

// Made-up entries and brands only.
const row=(e:Partial<ReturnType<typeof emptyEntry>>):Proposal=>({entry:{...emptyEntry(),...e},page:1,evidence:'',unverified:[],include:true});
const own:EquipmentType={id:'c-busduct',name:'Busduct',group:4,builtIn:false,params:[{key:'p-rating',label:'Rated current',unit:'A',feeds:'inA',required:true},{key:'p-icw',label:'Short-time withstand',unit:'kA',feeds:'',required:false}]};

describe('equipment types',()=>{
 it('keeps built-in types well formed',()=>{
  expect(new Set(BUILT_IN.map(t=>t.id)).size).toBe(BUILT_IN.length);
  for(const t of BUILT_IN){
   expect(new Set(t.params.map(p=>p.key)).size,t.name).toBe(t.params.length);
   expect(doubleFeeds(t.params),t.name).toEqual([]);
   expect(t.params.every(p=>p.key&&p.label),t.name).toBe(true);
  }
 });
 it('reads a type defined only here, with no code change',()=>{
  const [t]=pickedTypes({types:['c-busduct'],on:{}},[own]);
  expect(t?.params.map(p=>p.key)).toEqual(['p-rating']);// required by default; the catalogue-only one is not
  const [r]=applyPick([row({model:'BD-1',inA:'800',un:'400'})],[t!]);
  expect(r?.entry.type).toBe('c-busduct');
  expect(keepPicked({...r!.entry,extra:{'p-icw':'50'}},t)).toMatchObject({inA:'800',un:''});
 });
 it('gives each row of a mixed catalogue the type its values fit',()=>{
  const types=pickedTypes({types:['breaker','motor'],on:{}},[]);
  const [motor,breaker,blank]=applyPick([row({model:'M-1',ratedKw:'15',inA:'28',un:'400',efficiency:'0.92',pf:'0.85'}),row({model:'B-63',protA:'63',un:'415'}),row({model:'X'})],types);
  expect(motor?.entry.type).toBe('motor');expect(motor?.typeGuess).toBe(false);
  expect(breaker?.entry.type).toBe('breaker');expect(breaker?.typeGuess).toBe(false);
  // Nothing to go on: the first type picked, flagged for the engineer.
  expect(blank?.entry.type).toBe('breaker');expect(blank?.typeGuess).toBe(true);
 });
 it('keeps only the ticked parameters when an entry is added',()=>{
  const motor=BUILT_IN.find(t=>t.id==='motor')!,on=defaultOn(motor).filter(k=>k!=='power-factor');
  const [t]=pickedTypes({types:['motor'],on:{motor:[...on,'poles']}},[]);
  const e=keepPicked({...emptyEntry(),model:'M-1',config:'400 V',ratedKw:'15',pf:'0.85',extra:{poles:'4',weight:'90'}},t);
  expect(e).toMatchObject({type:'motor',model:'M-1',config:'400 V',ratedKw:'15',pf:'',extra:{poles:'4'}});
  // The load list still fills from the entry as before.
  expect(fillRow({...emptyLoad(),model:'M-1',config:'400 V'},indexCatalogue([e])).row.ratedKw).toBe('15');
 });
 it('saves own types and typed entries with the project, within limits',()=>{
  const p=JSON.parse(JSON.stringify(fresh()));
  p.loads.types=[own];p.loads.catalogue=[{...emptyEntry(),model:'BD-1',type:'c-busduct',extra:{'p-icw':'50'}}];
  const back=Project.parse(p).loads;
  expect(back.types[0]?.name).toBe('Busduct');expect(back.catalogue[0]).toMatchObject({type:'c-busduct',extra:{'p-icw':'50'}});
  p.loads.catalogue[0].extra=Object.fromEntries(Array.from({length:41},(_,i)=>[`k${i}`,'1']));
  expect(Project.safeParse(p).success).toBe(false);
  p.loads.catalogue[0].extra={};p.loads.types=Array.from({length:51},(_,i)=>({...own,id:`c-${i}`}));
  expect(Project.safeParse(p).success).toBe(false);
 });
});
