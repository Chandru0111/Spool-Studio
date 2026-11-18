import {basicDrums,type Project,type DrumOption} from '../store/schema';
import type {RowResult,SheetRow} from './sheet';
// Cable runs from the load list, grouped by product so the drum studio can plan each one.
export type CableGroup={key:string;label:string;runsM:number[];items:number;perSet:number;sizeMm2:number;uncheckedItems:number};
export function loadListGroups(rows:readonly SheetRow[],results:readonly RowResult[]):CableGroup[] {
 const groups=new Map<string,CableGroup>();
 rows.forEach((r,i)=>{
  const c=results[i]?.cells,size=c?.AC,run=Number(r.AH);if(!c||c.AE===''||typeof size!=='number'||!Number.isFinite(run)||!(run>0)||Object.keys(results[i]?.invalid??{}).length)return;
  // Single cores are ordered per conductor: three per three-phase set, two per single-phase set (neutral and earth excluded).
  const perSet=r.P==='1C'?(r.E==='3'?3:2):1,cables=Number(r.AD||1)*perSet,key=`${r.O}|${r.P}|${size}`;
  let g=groups.get(key);if(!g){g={key,label:`${r.O} · ${r.P} × ${size} mm²`,runsM:[],items:0,perSet,sizeMm2:size,uncheckedItems:0};groups.set(key,g);}
  g.items++;if(c.AG!=='PASS'||c.AN!=='PASS')g.uncheckedItems++;for(let k=0;k<cables;k++)g.runsM.push(run);
 });
 return [...groups.values()].sort((a,b)=>a.key.split('|').slice(0,2).join().localeCompare(b.key.split('|').slice(0,2).join())||a.sizeMm2-b.sizeMm2);
}
export function availableDrums(p:Project):DrumOption[] {return p.drumOptions.length?p.drumOptions:basicDrums;}
export function selectedDrumOption(p:Project):DrumOption {const source=availableDrums(p).find(d=>d.id===p.selectedDrumId);return source?{...source,drum:{...p.drum}}:{id:'custom',code:'CUSTOM',manufacturer:'Engineer-defined dimensions',source:'Custom geometry — confirm with supplier',basis:'basic',drum:{...p.drum},ratedCableOdMm:p.drum.overrideM>0?p.cable.odMm:null};}
