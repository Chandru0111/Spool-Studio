import {describe,expect,it} from 'vitest';
import {catalogueFromDatasheet,catalogueFromWeb} from '../src/import/webpage';
import {catalogueFromTables} from '../src/import/rating-table';
import {BUILT_IN,CUSTOM_GROUP,type EquipmentType,type Param} from '../src/engine/equipment-types';
import type {CatalogueRow} from '../src/engine/loads';
import type {PositionedLine} from '../src/import/parse';

// Made-up datasheets only: no maker's sheet is copied here.
const page=(lines:string[])=>[{page:1,text:lines.join('\n'),mode:'text' as const,confidence:null}];
const type=(id:string)=>BUILT_IN.find(t=>t.id===id)!;
const read=(lines:string[],types:EquipmentType[])=>catalogueFromDatasheet(page(lines),'made-up.pdf',new Map(),new Map(),types).proposals;
const valueOf=(e:CatalogueRow,p:Param)=>p.feeds?e[p.feeds]:e.extra?.[p.key]??'';

// A value for each parameter in its own unit, different for every parameter so a value read under the wrong label shows.
function sample(p:Param,i:number):{printed:string;stored:string} {
 const n=(base:number)=>String(base+i);
 if(/\(IE\)$/.test(p.label))return {printed:'IE3',stored:'IE3'};
 if(/^ip /i.test(p.label))return {printed:'IP55',stored:'IP55'};
 switch(p.unit){
  case 'kW':return {printed:`${n(10)} kW`,stored:n(10)};
  case 'W':return p.feeds?{printed:`${n(100)} W`,stored:String((100+i)/1000)}:{printed:`${n(100)} W`,stored:n(100)};
  case 'V':return {printed:`${n(400)} V`,stored:p.feeds?`${n(400)} V`:n(400)};
  case '%':return p.feeds?{printed:`${n(90)} %`,stored:String((90+i)/100)}:{printed:`${n(4)} %`,stored:n(4)};
  case 'Hz':return {printed:'50 Hz',stored:'50'};
  case '':return p.feeds==='pf'?{printed:`0.8${i%10}`,stored:`0.8${i%10}`}:{printed:n(2),stored:n(2)};
  default:return {printed:`${n(20)} ${p.unit}`,stored:n(20)};
 }
}

describe('reading a datasheet for each equipment type',()=>{
 // Every built-in type, from a sheet printing its own parameter names: nothing is left for motors only.
 for(const t of BUILT_IN)it(`reads every parameter of ${t.name}`,()=>{
  const values=t.params.map(sample);
  const lines=['Product data sheet',`  Model number     QX-${t.id.toUpperCase()}-1`,...t.params.map((p,i)=>`  ${p.label}     ${values[i]!.printed}`)];
  const [r,...more]=read(lines,[t]);
  expect(more).toHaveLength(0);
  expect(r!.entry.type).toBe(t.id);
  expect(r!.entry.model).toBe(`QX-${t.id.toUpperCase()}-1`);
  expect(Object.fromEntries(t.params.map(p=>[p.label,valueOf(r!.entry,p)]))).toEqual(Object.fromEntries(t.params.map((p,i)=>[p.label,values[i]!.stored])));
 });

 it('reads a breaker by its symbols and fills the protection rating, not the current',()=>{
  const [r]=read(['Miniature circuit breaker','  Order no.     BX-C63-3P','  Rated operational voltage Ue     415 V','  Rated insulation voltage Ui     690 V',
   '  Rated current In     63 A','  Rated ultimate short-circuit breaking capacity Icu     10 kA','  Service short-circuit breaking capacity Ics     7.5 kA','  Number of poles     3'],[type('breaker')]);
  expect(r!.entry).toMatchObject({model:'BX-C63-3P',protA:'63',un:'415 V',type:'breaker'});
  expect(r!.entry.extra).toMatchObject({'breaking-capacity-icu':'10','service-breaking-ics':'7.5',poles:'3'});
 });

 it('reads lighting power in W into kW, and a capacitor bank\'s kvar by its unit',()=>{
  const [lamp]=read(['LED panel','  Article number     LP-36-840','  Power consumption     36 W','  Rated voltage     220-240 V','  Power factor     0.95',
   '  Luminous flux     3600 lm','  Degree of protection     IP65'],[type('lighting')]);
  expect(lamp!.entry).toMatchObject({ratedKw:'0.036',un:'220-240 V',pf:'0.95'});
  expect(lamp!.entry.extra).toMatchObject({'luminous-flux':'3600','ip-rating':'IP65'});
  expect(lamp!.evidence).toContain('36 W = 0.036 kW');
  const [bank]=read(['Power factor correction','  Type     CB-50-7','  Rated output     50 kvar','  Rated voltage     415 V','  Rated current     69.6 A','  Steps     6'],[type('capacitor')]);
  expect(bank!.entry).toMatchObject({un:'415 V',inA:'69.6'});
  expect(bank!.entry.extra).toMatchObject({'reactive-power':'50',steps:'6'});
 });

 it('tells input from output, normal from heavy duty, and primary from secondary',()=>{
  const [drive]=read(['Frequency converter','  Product code     FC-7K5','  Rated power (normal duty)     7.5 kW','  Rated power (heavy duty)     5.5 kW',
   '  Input voltage     380-480 V','  Input current     14.6 A','  Output current     16.5 A'],[type('vsd')]);
  expect(drive!.entry).toMatchObject({ratedKw:'7.5',un:'380-480 V',inA:'14.6'});
  expect(drive!.entry.extra).toMatchObject({'heavy-duty-power':'5.5','output-current':'16.5'});
  const [tx]=read(['Isolation transformer','  Model     TX-100','  Rated power     100 kVA','  Primary voltage     415 V','  Secondary voltage     230 V','  Primary current     139 A',
   '  Primary protection     160 A'],[type('lv-transformer')]);
  expect(tx!.entry).toMatchObject({un:'415 V',inA:'139',protA:'160'});
  expect(tx!.entry.extra).toMatchObject({'rated-power':'100','secondary-voltage':'230'});
 });

 it('reads a distribution board from its own wording',()=>{
  const [db]=read(['Distribution board','  Catalogue number     DB-12W-TPN','  Incomer rating     250 A','  Rated busbar current     400 A','  Rated operational voltage Ue     415 V',
   '  Number of ways     12','  Short-circuit rating     36 kA'],[type('db')]);
  expect(db!.entry).toMatchObject({protA:'250',inA:'400',un:'415 V'});
  expect(db!.entry.extra).toMatchObject({ways:'12','short-circuit-rating':'36'});
 });

 it('picks the type whose parameters the sheet gives, of several picked',()=>{
  const types=[type('motor'),type('breaker'),type('capacitor')];
  expect(read(['  Order no.     BX-C63-3P','  Rated operational voltage Ue     415 V','  Rated current In     63 A','  Breaking capacity Icu     10 kA'],types)[0]!.entry.type).toBe('breaker');
  expect(read(['  Type     CB-50-7','  Reactive power     50 kvar','  Rated voltage     415 V','  Rated current     69.6 A'],types)[0]!.entry.type).toBe('capacitor');
  expect(read(['  Motor type     QX-160M4','  Rated output     11 kW','  Rated voltage     400 V','  Rated current     21.5 A','  Efficiency     91.4 %','  Power factor     0.84'],types)[0]!.entry.type).toBe('motor');
 });

 it('searches for the parameters the engineer added to their own type, from a pasted web page',()=>{
  const pump:EquipmentType={id:'c-pump',name:'Pump set',group:CUSTOM_GROUP,builtIn:false,params:[
   {key:'p-1',label:'Motor rating',unit:'kW',feeds:'ratedKw',required:true},{key:'p-2',label:'Supply voltage',unit:'V',feeds:'un',required:true},
   {key:'p-3',label:'Full load current',unit:'A',feeds:'inA',required:false},{key:'p-4',label:'Duty flow',unit:'m³/h',feeds:'',required:true},
   {key:'p-5',label:'Head',unit:'m',feeds:'',required:false},{key:'p-6',label:'Impeller diameter',unit:'mm',feeds:'',required:false}]};
  const {proposals:[r]}=catalogueFromWeb(['End-suction pump PX-80-250','Model\tPX-80-250','Duty flow\t120 m³/h','Head\t32 m','Motor rating\t15 kW','Supply voltage\t400 V',
   'Full load current\t28 A','Impeller dia.\t250 mm'].join('\n'),'https://vendor.example/px',[pump]);
  expect(r!.entry).toMatchObject({model:'PX-80-250',ratedKw:'15',un:'400 V',inA:'28',type:'c-pump'});
  expect(r!.entry.extra).toEqual({'p-4':'120','p-5':'32','p-6':'250'});
 });
});

describe('reading a rating table for any equipment type',()=>{
 const at=(y:number,...cells:[number,string,number?][]):PositionedLine=>({y,cells:cells.map(([x,text,w])=>({x,y,text,w:w??text.length*5}))});
 const lines=[at(700,[40,'BX MCCB 415 V AC',80]),
  at(680,[40,'Type',20],[120,'In (A)',30],[200,'Icu (kA)',30],[280,'Poles',25]),
  at(660,[40,'BX160-63',40],[120,'63',10],[200,'25',10],[280,'3',5]),
  at(648,[40,'BX160-100',45],[120,'100',15],[200,'25',10],[280,'3',5]),
  at(636,[40,'BX250-200',45],[120,'200',15],[200,'36',10],[280,'4',5])];
 it('reads a breaker table into the protection rating, its voltage and breaking capacity',()=>{
  const rows=catalogueFromTables(new Map([[4,lines]]),'made-up.pdf',new Map(),[type('motor'),type('breaker')]);
  expect(rows.map(r=>[r.entry.type,r.entry.model,r.entry.protA,r.entry.un,r.entry.extra?.['breaking-capacity-icu'],r.entry.extra?.poles])).toEqual([
   ['breaker','BX160-63','63','415 V','25','3'],['breaker','BX160-100','100','415 V','25','3'],['breaker','BX250-200','200','415 V','36','4']]);
 });
 it('reads no table without equipment types unless it lists motors',()=>{
  expect(catalogueFromTables(new Map([[4,lines]]),'made-up.pdf')).toHaveLength(0);
 });
});
