import { Drum, CableGeometry } from '../store/schema';
import { ok,err,type Result } from './result';
export type PackedDrum={runsM:number[];usedM:number;spareM:number;grossKg:number;fillPct:number};
export type DrumPlan={capacityM:number;geometricM:number;layers:number;turns:number;drums:PackedDrum[];unplacedM:number[];totalM:number;totalKg:number;utilizationPct:number;limiting:string;trail:string[]};
export function parseRuns(text:string):Result<number[]> {
  const tokens=text.split(/[,;\s]+/).filter(Boolean);
  if(!tokens.length) return err('Enter at least one continuous cable run in metres.');
  if(tokens.length>2000) return err('Limit a plan to 2,000 runs.');
  const runs=tokens.map(Number);
  if(runs.some(n=>!Number.isFinite(n) || n<=0 || n>100000)) return err('Every run must be a positive length up to 100,000 m. Use commas or new lines.');
  return ok(runs);
}
export function planDrums(d:Drum,c:CableGeometry,runsM:readonly number[]):Result<DrumPlan> {
  if(!Drum.safeParse(d).success || !CableGeometry.safeParse(c).success) return err('Drum dimensions, weights and cable dimensions must be positive. Fill factor must be 0–1.');
  if(d.flangeMm<=d.barrelMm+2*d.clearanceMm) return err('Flange diameter must exceed barrel diameter plus both radial clearances.');
  if(d.barrelMm/2<c.minBendRadiusXOd*c.odMm) return err(`Barrel radius must be at least ${(c.minBendRadiusXOd*c.odMm).toFixed(1)} mm to respect the cable bend radius.`);
  if(d.liftLimitKg<=d.tareKg) return err('Lifting limit must exceed the empty drum weight.');
  if(runsM.some(n=>!Number.isFinite(n)||n<=0) || runsM.length>2000) return err('Run lengths must be positive, with no more than 2,000 runs.');
  const layers=Math.floor((d.flangeMm-2*d.clearanceMm-d.barrelMm)/(2*c.odMm));
  const turns=Math.floor(d.widthMm/c.odMm);
  const geometricM=Math.PI*turns*(layers*d.barrelMm+c.odMm*layers*layers)/1000;
  const windingM=d.overrideM>0?d.overrideM:geometricM*d.fillFactor;
  const weightM=Math.min(d.maxLoadKg,d.liftLimitKg-d.tareKg)*1000/c.kgKm;
  const capacityM=Math.min(windingM,weightM);
  if(layers<1||turns<1||capacityM<=0) return err('These dimensions cannot accommodate one full cable layer.');
  const drums:PackedDrum[]=[],unplacedM:number[]=[];
  const adjusted=runsM.map(n=>n*(1+d.wastagePct/100)).sort((a,b)=>b-a);
  for(const runM of adjusted) {
    if(runM>capacityM+1e-9) {unplacedM.push(runM);continue;}
    let drum=drums.find(x=>x.usedM+runM<=capacityM+1e-9);
    if(!drum) {drum={runsM:[],usedM:0,spareM:capacityM,grossKg:d.tareKg,fillPct:0};drums.push(drum);}
    drum.runsM.push(runM);drum.usedM+=runM;drum.spareM=capacityM-drum.usedM;
    drum.grossKg=d.tareKg+drum.usedM*c.kgKm/1000;drum.fillPct=drum.usedM/capacityM*100;
  }
  const totalM=adjusted.reduce((a,b)=>a+b,0),totalKg=drums.reduce((a,b)=>a+b.grossKg,0);
  return ok({capacityM,geometricM,layers,turns,drums,unplacedM,totalM,totalKg,utilizationPct:drums.length?(totalM-unplacedM.reduce((a,b)=>a+b,0))/(capacityM*drums.length)*100:0,limiting:weightM<windingM?'Payload / lifting limit':d.overrideM>0?'Supplier capacity':'Winding geometry',trail:[`Layers = floor((${d.flangeMm} − 2 × ${d.clearanceMm} − ${d.barrelMm}) / (2 × ${c.odMm})) = ${layers}`,`Turns per layer = floor(${d.widthMm} / ${c.odMm}) = ${turns}`,`Geometric length = π × ${turns} × (${layers} × ${d.barrelMm} + ${c.odMm} × ${layers}²) / 1000 = ${geometricM.toFixed(3)} m`,`Usable capacity = min(${windingM.toFixed(3)} m winding, ${weightM.toFixed(3)} m by weight) = ${capacityM.toFixed(3)} m`,`Each run includes ${d.wastagePct}% allowance. First-fit decreasing; no run is split. This heuristic does not guarantee a minimum drum count.`]});
}
