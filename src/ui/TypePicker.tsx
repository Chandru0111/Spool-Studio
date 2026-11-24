import {useState} from 'preact/hooks';
import {X,Plus,Copy,Trash2,ArrowRight} from 'lucide-preact';
import {project,setLoads,notify} from './state';
import {sameText,FROM_CATALOGUE} from '../engine/loads';
import {BUILT_IN,CUSTOM_GROUP,GROUPS,MAX_PARAMS,MAX_TYPES,defaultOn,doubleFeeds,pickedTypes,type EquipmentType,type Feed,type Param,type Pick} from '../engine/equipment-types';

export const FEED_NAME:Record<Feed,string>={'':'Catalogue only',ratedKw:'Rated input power (kW)',protA:'Protection device rating (A)',inA:'In (A)',un:'Un',efficiency:'Efficiency',pf:'Power factor'};
// Ids only need to be unique within the project.
const fresh=()=>`${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;

// Asked before a catalogue is read: which kinds of equipment it covers and which of their parameters to read. Built-in types
// are locked (copy one to change it); the user's own types are saved with the project. The choice is kept for the next read.
export function TypePicker({pick,setPick,action,onContinue,onClose}:{pick:Pick;setPick:(p:Pick)=>void;action:string;onContinue:(types:EquipmentType[])=>void;onClose:()=>void}) {
 const own=project.value.loads.types,all=[...BUILT_IN,...own],[name,setName]=useState(''),[addError,setAddError]=useState(''),[error,setError]=useState('');
 const on=(t:EquipmentType)=>pick.on[t.id]??defaultOn(t);
 const shown=pick.types.map(id=>all.find(t=>t.id===id)).filter((t):t is EquipmentType=>!!t);
 const save=(types:EquipmentType[],key='')=>{setLoads({types},key);setError('');};
 const editType=(id:string,patch:Partial<EquipmentType>,key='')=>save(own.map(t=>t.id===id?{...t,...patch}:t),key);
 const editParam=(t:EquipmentType,i:number,patch:Partial<Param>,key='')=>editType(t.id,{params:t.params.map((p,j)=>j===i?{...p,...patch}:p)},key);
 const tick=(t:EquipmentType,key:string,yes:boolean)=>{setPick({...pick,on:{...pick.on,[t.id]:yes?[...on(t),key]:on(t).filter(k=>k!==key)}});setError('');};
 const toggle=(t:EquipmentType)=>{const has=pick.types.includes(t.id);setPick({types:has?pick.types.filter(x=>x!==t.id):[...pick.types,t.id],on:{...pick.on,[t.id]:on(t)}});setError('');};
 const free=(base:string)=>{let n=base.slice(0,60),i=2;while(all.some(t=>sameText(t.name,n)))n=`${base.slice(0,55)} ${i++}`;return n;};
 const room=()=>{if(own.length<MAX_TYPES)return true;notify(`A project holds at most ${MAX_TYPES} equipment types of your own.`);return false;};
 function add(){
  const v=name.trim();if(!v){setAddError('Enter a name first.');return;}
  if(all.some(t=>sameText(t.name,v))){setAddError('That equipment type already exists.');return;}
  if(!room())return;
  const key=`p-${fresh()}`,t:EquipmentType={id:`c-${fresh()}`,name:v.slice(0,60),group:CUSTOM_GROUP,builtIn:false,params:[{key,label:'',unit:'',feeds:'',required:false}]};
  save([...own,t]);setPick({types:[...pick.types,t.id],on:{...pick.on,[t.id]:[key]}});setName('');setAddError('');
 }
 function copy(t:EquipmentType){
  if(!room())return;
  const c:EquipmentType={...t,id:`c-${fresh()}`,name:free(`${t.name} (copy)`),group:CUSTOM_GROUP,builtIn:false,params:t.params.map(p=>({...p}))};
  save([...own,c]);setPick({types:pick.types.map(x=>x===t.id?c.id:x),on:{...pick.on,[c.id]:on(t)}});
 }
 function remove(t:EquipmentType){
  const used=project.value.loads.catalogue.filter(e=>e.type===t.id).length;
  if(used){notify(`${used} catalogue entr${used===1?'y is':'ies are'} ${t.name||'this type'}. Change their equipment type first.`);return;}
  save(own.filter(x=>x.id!==t.id));setPick({...pick,types:pick.types.filter(x=>x!==t.id)});
 }
 function addParam(t:EquipmentType){
  if(t.params.length>=MAX_PARAMS){notify(`An equipment type holds at most ${MAX_PARAMS} parameters.`);return;}
  const key=`p-${fresh()}`;editType(t.id,{params:[...t.params,{key,label:'',unit:'',feeds:'',required:false}]});setPick({...pick,on:{...pick.on,[t.id]:[...on(t),key]}});
 }
 function go(){
  if(!shown.length){setError('Pick at least one equipment type.');return;}
  for(const t of shown){
   const ticked=t.params.filter(p=>on(t).includes(p.key));
   if(!t.name.trim()){setError('Name every equipment type.');return;}
   if(all.filter(x=>sameText(x.name,t.name)).length>1){setError(`Two equipment types are called ${t.name.trim()}. Rename one.`);return;}
   if(!ticked.length){setError(`Tick at least one parameter of ${t.name.trim()}, or unpick it.`);return;}
   if(ticked.some(p=>!p.label.trim())){setError(`Name every ticked parameter of ${t.name.trim()}.`);return;}
   if(doubleFeeds(ticked).length){setError(`Two ticked parameters of ${t.name.trim()} fill the same load list column.`);return;}
  }
  onContinue(pickedTypes(pick,own));
 }
 return <div class="modal-backdrop"><section class="modal schematic-modal type-picker" role="dialog" aria-modal="true" aria-label="Equipment in this catalogue">
  <div class="panel-heading"><div><div class="eyebrow">EQUIPMENT IN THIS CATALOGUE</div><h2>What does this catalogue cover?</h2>
   <p>Pick every type of equipment it lists; one catalogue can hold several. Tick the parameters to read for each type. The rest stay empty. Brand, model and configuration are always read.</p></div>
   <button class="icon-button" aria-label="Close" onClick={onClose}><X size={18}/></button></div>
  <div class="type-picker-body">
   {GROUPS.map((g,gi)=>{const ts=all.filter(t=>t.group===gi);if(!ts.length&&gi!==CUSTOM_GROUP)return null;
    return <div key={g}><div class="type-group">{g}</div><div class="type-chips">
     {ts.map(t=><button key={t.id} type="button" class="type-chip" aria-pressed={pick.types.includes(t.id)} onClick={()=>toggle(t)}>{t.name.trim()||'Unnamed type'}</button>)}
     {gi===CUSTOM_GROUP&&<><input class="type-name" value={name} maxLength={60} placeholder="Busduct" aria-label="Name of a new equipment type" onInput={e=>{setName(e.currentTarget.value);setAddError('');}} onKeyDown={e=>{if(e.key==='Enter')add();}}/>
      <button class="button secondary small" onClick={add}><Plus size={14}/>Add equipment type</button>{addError&&<span class="form-error" role="alert">{addError}</span>}</>}
    </div></div>;})}
   {shown.map(t=>{const ticked=on(t),twice=doubleFeeds(t.params.filter(p=>ticked.includes(p.key)));
    return <div key={t.id} class="type-card">
     <div class="type-card-head">{t.builtIn?<strong>{t.name}</strong>:<input value={t.name} maxLength={60} placeholder="Name this type" aria-label="Equipment type name" onInput={e=>editType(t.id,{name:e.currentTarget.value},`type:${t.id}:name`)}/>}
      <span class="type-tag">{t.builtIn?'Built-in, locked':'Your type'}</span>
      {t.builtIn?<button class="button ghost small" onClick={()=>copy(t)}><Copy size={14}/>Copy to edit</button>:<button class="button ghost small" onClick={()=>remove(t)}><Trash2 size={14}/>Delete type</button>}</div>
     <table><colgroup><col style={{width:'52px'}}/><col/><col style={{width:'84px'}}/><col style={{width:'210px'}}/><col style={{width:t.builtIn?'80px':'112px'}}/></colgroup>
      <thead><tr><th>Read</th><th>Parameter</th><th>Unit</th><th>Fills load list column</th><th>Required</th></tr></thead>
      <tbody><tr class="always"><td><input type="checkbox" checked disabled aria-label="Brand, model and configuration are always read"/></td><td>Brand, model, configuration</td><td/><td>Catalogue lookup</td><td>Always</td></tr>
       {t.params.map((p,i)=><tr key={p.key}>
        <td><input type="checkbox" checked={ticked.includes(p.key)} aria-label={`Read ${p.label||`parameter ${i+1}`}`} onChange={e=>tick(t,p.key,e.currentTarget.checked)}/></td>
        {t.builtIn?<><td>{p.label}</td><td>{p.unit}</td><td class={p.feeds?'':'muted'}>{FEED_NAME[p.feeds]}</td><td>{p.required?<span class="type-tag warn">Required</span>:''}</td></>
        :<><td><input value={p.label} maxLength={60} placeholder="Rated current" aria-label={`Parameter ${i+1} name`} onInput={e=>editParam(t,i,{label:e.currentTarget.value},`type:${t.id}:${p.key}:label`)}/></td>
         <td><input value={p.unit} maxLength={20} placeholder="A" aria-label={`Parameter ${i+1} unit`} onInput={e=>editParam(t,i,{unit:e.currentTarget.value},`type:${t.id}:${p.key}:unit`)}/></td>
         <td><select value={p.feeds} aria-label={`Load list column parameter ${i+1} fills`} onChange={e=>editParam(t,i,{feeds:e.currentTarget.value as Feed})}>{(['',...FROM_CATALOGUE] as Feed[]).map(f=><option key={f} value={f}>{FEED_NAME[f]}</option>)}</select></td>
         <td class="type-row-tools"><input type="checkbox" checked={p.required} aria-label={`Parameter ${i+1} is required`} onChange={e=>editParam(t,i,{required:e.currentTarget.checked})}/>
          <button class="icon-button" aria-label={`Remove parameter ${i+1}`} onClick={()=>{editType(t.id,{params:t.params.filter((_,j)=>j!==i)});setPick({...pick,on:{...pick.on,[t.id]:ticked.filter(k=>k!==p.key)}});}}><X size={13}/></button></td></>}
       </tr>)}</tbody></table>
     {!t.builtIn&&<button class="button ghost small" onClick={()=>addParam(t)}><Plus size={14}/>Add parameter</button>}
     {twice.length>0&&<p class="form-error">Two ticked parameters fill {twice.map(f=>FEED_NAME[f]).join(', ')}. Each load list column takes one value.</p>}
    </div>;})}
  </div>
  <div class="modal-actions">{error&&<span class="form-error" role="alert">{error}</span>}<button class="button secondary small" onClick={onClose}>Cancel</button><button class="button primary small" onClick={go}>{action}<ArrowRight size={14}/></button></div>
 </section></div>;
}
