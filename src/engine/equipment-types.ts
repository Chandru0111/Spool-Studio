import {FROM_CATALOGUE} from './loads';

// The kinds of equipment a catalogue can cover, each with the parameters a user may pick to read from it. Kept as data: a
// new kind is a line in LIST (built in) or one the user adds to the project (their own), never new reading code. A
// parameter either fills one of the load list's catalogue columns (feeds) or stays with the catalogue entry only, so the
// load list export never changes. Brand, model and configuration are always read: they identify the entry.
export type Feed=typeof FROM_CATALOGUE[number]|'';
export type Param={key:string;label:string;unit:string;feeds:Feed;required:boolean};
export type EquipmentType={id:string;name:string;group:number;builtIn:boolean;params:Param[]};
export const GROUPS=['Loads','Distribution','Protection and switching','Supply','Your equipment types'] as const;
export const CUSTOM_GROUP=4;
export const MAX_TYPES=50,MAX_PARAMS=40;

const FEED:Record<string,Feed>={kw:'ratedKw',prot:'protA',in:'inA',un:'un',eff:'efficiency',pf:'pf'};
const slug=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
// id, name, group, then "label|unit|fills|required" per parameter; fills is kw, prot, in, un, eff or pf (that load list
// column) or empty (catalogue only). Drafted from what catalogues usually print; built-in lists are locked, copy to edit.
const LIST:[string,string,number,string][]=[
 ['motor','Motor',0,'Rated output|kW|kw|1;Rated voltage|V|un|1;Rated current|A|in|1;Efficiency|%|eff|1;Power factor||pf|1;Frequency|Hz||0;Speed|rpm||0;Poles|||0;Frame size|||0;Efficiency class (IE)|||0;Starting current Ia/In|||0;IP rating|||0;Weight|kg||0'],
 ['vsd','VSD / VFD',0,'Rated power (normal duty)|kW|kw|1;Input voltage|V|un|1;Input current|A|in|1;Output current|A||0;Efficiency|%|eff|0;Input power factor||pf|0;Recommended fuse / breaker|A|prot|0;Heavy-duty power|kW||0;Frame size|||0;Heat losses|W||0;IP rating|||0'],
 ['soft-starter','Soft starter',0,'Rated power|kW|kw|1;Rated current Ie|A|in|1;Rated voltage|V|un|1;Recommended fuse / MCCB|A|prot|0;Built-in bypass|||0;Starts per hour|||0;Frame size|||0'],
 ['heater','Heater',0,'Rated power|kW|kw|1;Rated voltage|V|un|1;Rated current|A|in|0;Phases|||0;Stages|||0'],
 ['lighting','Lighting',0,'Power|W|kw|1;Rated voltage|V|un|1;Current|A|in|0;Power factor||pf|0;Luminous flux|lm||0;Efficacy|lm/W||0;Inrush current|A||0;Emergency|||0;IP rating|||0'],
 ['socket','Socket outlet / small power',0,'Rated current|A|in|1;Rated voltage|V|un|1;Poles / configuration|||0;Standard|||0;Built-in RCD|||0;IP rating|||0'],
 ['hvac','Packaged unit / HVAC',0,'Rated input power|kW|kw|1;Rated voltage|V|un|1;Running current|A|in|1;Max fuse / breaker (MOP)|A|prot|0;Min circuit ampacity|A||0;Power factor||pf|0;Cooling capacity|kW||0;EER / COP|||0;Locked rotor current|A||0'],
 ['ups','UPS',0,'Input power|kW|kw|1;Input voltage|V|un|1;Max input current|A|in|1;Efficiency|%|eff|0;Input power factor||pf|0;Recommended input breaker|A|prot|0;Rated output|kVA||0;Output power|kW||0;Autonomy|min||0;Heat dissipation|W||0'],
 ['charger','Battery charger / rectifier',0,'Input power|kW|kw|1;Input voltage|V|un|1;Input current|A|in|1;Efficiency|%|eff|0;Power factor||pf|0;Input protection|A|prot|0;DC output voltage|V||0;DC output current|A||0'],
 ['capacitor','Capacitor bank',0,'Reactive power|kvar||1;Rated voltage|V|un|1;Rated current|A|in|1;Recommended protection|A|prot|0;Steps|||0;Detuning|%||0'],
 ['lv-transformer','LV/LV transformer',0,'Rated power|kVA||1;Primary voltage|V|un|1;Secondary voltage|V||1;Primary current|A|in|0;Primary protection|A|prot|0;Impedance uk|%||0;Losses|W||0;Efficiency|%|eff|0;Vector group|||0'],
 ['generic','Generic load',0,'Rated power|kW|kw|1;Rated voltage|V|un|1;Rated current|A|in|0;Power factor||pf|0;Efficiency|%|eff|0;Protection|A|prot|0'],
 ['db','Distribution board',1,'Incomer rating|A|prot|1;Busbar rating|A|in|1;Rated voltage Ue|V|un|1;Phases (SPN / TPN)|||0;Ways|||0;Short-circuit rating|kA||0;Form of separation|||0;IP rating|||0'],
 ['panel','Panel / switchboard (MCC, feeder, SMSB, LVSG)',1,'Busbar rating|A|in|1;Rated voltage Ue|V|un|1;Incomer protection|A|prot|1;Short-time withstand Icw|kA||0;Peak withstand Ipk|kA||0;Form of separation|||0;IP rating|||0;Frequency|Hz||0'],
 ['breaker','Circuit breaker (ACB / MCCB / MCB)',2,'Rated current In|A|prot|1;Rated voltage Ue|V|un|1;Breaking capacity Icu|kA||1;Poles|||0;Curve / trip unit|||0;Frame rating|A||0;Service breaking Ics|kA||0;Setting range Ir|A||0;Standard|||0'],
 ['rcd','RCD / RCBO',2,'Rated current|A|prot|1;Sensitivity IΔn|mA||1;RCD type (AC / A / F / B)|||0;Poles|||0;Breaking capacity|kA||0;Curve|||0;Rated voltage|V|un|0'],
 ['fuse','Fuse / fuse-switch',2,'Rated current|A|prot|1;Fuse class (gG / aM)|||1;Size|||0;Rated voltage|V|un|0;Breaking capacity|kA||0;Poles|||0'],
 ['isolator','Isolator / switch-disconnector',2,'Rated current Ie (AC-23)|A|prot|1;Rated voltage Ue|V|un|1;Thermal current Ith|A||0;Poles|||0;Short-time withstand Icw|kA||0;Making capacity Icm|kA||0;Mounting|||0'],
 ['contactor','Contactor / overload relay',2,'Rated current Ie (AC-3)|A||1;Motor power AC-3|kW||0;Rated voltage Ue|V|un|0;Coil voltage|V||0;Poles|||0;Overload range|A||0;Trip class|||0'],
 ['generator','Generator',3,"Prime power|kW|kw|1;Rated voltage|V|un|1;Rated current|A|in|1;Power factor||pf|0;Output breaker|A|prot|0;Standby power|kW||0;Rated output|kVA||0;Frequency|Hz||0;Subtransient reactance X''d|%||0;Fuel use|l/h||0"],
 ['mv-transformer','MV/LV transformer',3,'Rated power|kVA||1;Secondary voltage|V|un|1;Secondary current|A|in|1;Primary voltage|kV||1;Impedance uk|%||0;Efficiency|%|eff|0;No-load losses|W||0;Load losses|W||0;Vector group|||0;Cooling|||0'],
];
export const BUILT_IN:readonly EquipmentType[]=LIST.map(([id,name,group,spec])=>({id,name,group,builtIn:true,
 params:spec.split(';').map(s=>{const [label='',unit='',feeds='',req='']=s.split('|');return {key:slug(label),label,unit,feeds:FEED[feeds]??'',required:req==='1'};})}));

// What to read from one catalogue: the equipment types it covers and, per type, the keys of the parameters ticked.
// A type not yet in on starts with its required parameters and the ones that fill the load list.
export type Pick={types:string[];on:Record<string,string[]>};
export const defaultOn=(t:EquipmentType)=>t.params.filter(p=>p.required||p.feeds).map(p=>p.key);
export const allTypes=(own:readonly EquipmentType[]):EquipmentType[]=>[...BUILT_IN,...own];
// The picked types holding only their ticked parameters, in the order they were picked.
export function pickedTypes(pick:Pick,own:readonly EquipmentType[]):EquipmentType[] {
 const all=allTypes(own);
 return pick.types.flatMap(id=>{const t=all.find(x=>x.id===id);if(!t)return [];const on=pick.on[t.id]??defaultOn(t);return [{...t,params:t.params.filter(p=>on.includes(p.key))}];});
}
// The load list columns two or more of a type's parameters would fill: each column takes one value.
export const doubleFeeds=(params:readonly Param[]):Feed[]=>{const seen=new Set<Feed>(),twice=new Set<Feed>();for(const p of params)if(p.feeds){if(seen.has(p.feeds))twice.add(p.feeds);seen.add(p.feeds);}return [...twice];};
