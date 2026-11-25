import {num,type CatalogueRow} from '../engine/loads';
import type {EquipmentType,Param} from '../engine/equipment-types';
import {reading,type Proposal} from './equipment';
import {unitOf} from './vocabulary';

// An engineer's arithmetic on a datasheet row. The values a maker prints for one product agree with each other: a
// transformer's currents are its kVA over √3 × its voltages, a motor's current is its kW over √3 × U × cos φ (× η for
// shaft output), a transformer's efficiency is its kVA over kVA plus losses, and a load's protection is at least its
// current. A relation that does not hold flags its values (amber in the review) with the sum worked out, for the engineer
// to check on the page; nothing is changed. A relation missing a value is not checked.
// keys: the parameters in a relation that does not hold. held: those in one that does. why: each sum, worked out.
export type Check={keys:string[];held:string[];why:string[]};
type Q={p:Param;n:number;base:string;shown:string;side:string};
const R3=Math.sqrt(3);
// The side of the equipment a voltage, current or kVA is for, by its name: one with no side holds for any side.
const SIDES:[string,RegExp][]=[['hv',/\b(?:hv|high)\b/],['lv',/\b(?:lv|low)\b/],['primary',/\bprimary\b/],['secondary',/\bsecondary\b/],['input',/\binput\b/],['output',/\boutput\b/]];
const sideOf=(label:string)=>SIDES.find(([,re])=>re.test(label.toLowerCase()))?.[0]??'';
// The current a product draws or carries, not a protection rating, a fault or starting current, or a setting.
const RUNNING=/current|amps|amperage|\bfla\b/i,NOT_RUNNING=/start|inrush|locked|short|peak|withstand|making|breaking|leak|no[\s-]*load|setting|overload|ripple|ampacity|protect|fuse|breaker/i;
// The supply voltage, not a coil, control or DC voltage.
const NOT_SUPPLY=/coil|control|aux|\bdc\b/i;
// A value is checked only when it is one figure: a range or dual rating (380-415, 230/400) is for the engineer.
const ONE=/^([+-]?\d+(?:\.\d+)?)\s*[^\d\s]*$/;
function quantities(e:CatalogueRow,t:EquipmentType):Q[] {
 return t.params.flatMap(p=>{
  const raw=(p.feeds?e[p.feeds]:e.extra?.[p.key]??'').trim(),m=ONE.exec(raw),n=m?num(m[1]!):null;if(n===null||n<=0)return [];
  const unit=reading(p).unit.trim(),u=unitOf(unit),scaled=!!u&&u.base!=='%';
  // Efficiency and power factor are fractions; one kept in % (an efficiency of the user's own type) is made one.
  const v=scaled?n*u.size:n>1&&/effic|factor|cos/i.test(p.label)?n/100:n;
  return [{p,n:v,base:scaled?u.base:'',shown:`${m![1]}${scaled?` ${unit}`:''}`,side:sideOf(p.label)}];
 });
}
const round=(x:number)=>x>=100?String(Math.round(x)):String(+x.toPrecision(3));
// The figure of several worked out (three or one phase, input or shaft power) nearest the printed one.
const nearest=(want:readonly number[],got:number)=>want.reduce((a,b)=>Math.abs(b-got)<Math.abs(a-got)?b:a);
export function checkRow(e:CatalogueRow,t:EquipmentType|undefined,power=true):Check {
 const out:Check={keys:[],held:[],why:[]};if(!t)return out;
 const q=quantities(e,t),feed=(k:string)=>q.find(x=>x.p.feeds===k),rel=(ok:boolean,on:readonly Q[],flag:readonly Q[],why:string)=>{
  if(ok)out.held.push(...on.map(x=>x.p.key));else{out.keys.push(...flag.map(x=>x.p.key));out.why.push(why);}
 };
 // Three phases unless the row or its Phases parameter says one; with neither, whichever fits, though a supply above
 // 250 V is taken to be three-phase (single-phase supplies are 110–240 V).
 const phases=t.params.find(p=>!p.feeds&&/phase/i.test(p.label)),said=phases?e.extra?.[phases.key]?.trim()??'':'';
 const one=/1-phase/.test(e.config)||/^(?:1|single)\b/i.test(said),three=/3-phase/.test(e.config)||/^(?:3|three)\b/i.test(said);
 const ks=one&&!three?[1]:three&&!one?[R3]:[R3,1],kOf=(u:Q)=>ks.length>1&&u.n>250?[R3]:ks;
 const volts=q.filter(x=>x.base==='V'&&!NOT_SUPPLY.test(x.p.label)),amps=q.filter(x=>x.base==='A'&&x.p.feeds!=='protA'&&RUNNING.test(x.p.label)&&!NOT_RUNNING.test(x.p.label));
 // I = S / (√3·U) on each side a kVA rating holds for: a transformer's HV and LV sides, a generator's terminals.
 for(const s of q.filter(x=>x.base==='VA'))for(const u of volts)for(const i of amps){
  if(i.side!==u.side||s.side&&u.side&&s.side!==u.side)continue;
  const want=nearest(kOf(u).map(k=>s.n/(k*u.n)),i.n);
  rel(Math.abs(i.n/want-1)<=0.1,[s,u,i],[s,u,i],`${s.shown} at ${u.shown} works out to about ${round(want)} A, not ${i.shown}.`);
 }
 // I = P / (√3·U·cos φ) for input power, or P / (√3·U·cos φ·η) for a motor's shaft output. A table row's voltage
 // check (power false) has already done this sum.
 const P=feed('ratedKw'),U=feed('un'),I=feed('inA'),F=feed('pf'),E=feed('efficiency');
 if(power&&P&&U&&I&&F&&F.n<=1){
  const etas=[1,...(E&&E.n<=1?[E.n]:[])],want=nearest(kOf(U).flatMap(k=>etas.map(eta=>P.n/(k*U.n*F.n*eta))),I.n);
  rel(Math.abs(I.n/want-1)<=0.15,[P,U,I,F,...(E?[E]:[])],[P,U,I],`${P.shown} at ${U.shown} with power factor ${F.shown}${E?` and efficiency ${E.shown}`:''} works out to about ${round(want)} A, not ${I.shown}.`);
 }
 // η = S / (S + no-load losses + load losses), at power factor 1 or 0.8.
 const S=q.find(x=>x.base==='VA'),eff=E??q.find(x=>!x.base&&/effic/i.test(x.p.label)),loss=q.filter(x=>x.base==='W'&&/loss/i.test(x.p.label));
 if(S&&eff&&eff.n<=1&&loss.some(x=>/no[\s-]*load/i.test(x.p.label))&&loss.some(x=>!/no[\s-]*load/i.test(x.p.label))){
  const L=loss.reduce((a,x)=>a+x.n,0),[at1=0,at08=0]=[1,0.8].map(f=>f*S.n/(f*S.n+L));
  rel(Math.min(Math.abs(eff.n-at1),Math.abs(eff.n-at08))<=0.003,[S,eff,...loss],[eff,...loss],`${S.shown} with ${loss.map(x=>x.shown).join(' + ')} losses works out to an efficiency of about ${at1.toFixed(3)} at power factor 1 (${at08.toFixed(3)} at 0.8), not ${eff.shown}.`);
 }
 // A load's protection device is rated at least its running current.
 const A=feed('protA');
 if(A&&I&&t.params.some(p=>p.feeds==='ratedKw'))rel(A.n>=I.n*0.95,[A,I],[A,I],`Protection ${A.shown} is below the running current ${I.shown}.`);
 return {keys:[...new Set(out.keys)],held:[...new Set(out.held)],why:out.why};
}
// A row checked for its equipment type: doubt holds what does not add up, or is left off.
export function withCheck(p:Proposal,t:EquipmentType|undefined):Proposal {
 const {doubt:_,...rest}=p,c=checkRow(p.entry,t,!p.note);
 return c.keys.length?{...rest,doubt:{keys:c.keys,why:c.why.join(' ')}}:rest;
}
export const checkAll=(rows:readonly Proposal[],types:readonly EquipmentType[]):Proposal[]=>rows.map(p=>withCheck(p,types.find(t=>t.id===p.entry.type)));
