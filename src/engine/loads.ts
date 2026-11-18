// Equipment load list: one row per item of equipment on a panel, laid out like the project's equipment-list workbook.
// The sums follow that workbook: input kW = consumed kW ÷ efficiency, kVAr = kW·tan(acos PF), shown only under the row's duty (C/I/S).
export const LOAD_KEYS=['kks','description','brand','model','config','vital','essential','nonEssential','restart','starter','cis','consumedKw','ratedKw','protA','inA','un','efficiency','pf'] as const;
export type LoadKey=typeof LOAD_KEYS[number];
export type LoadRow=Record<LoadKey,string>;
export const emptyLoad=():LoadRow=>Object.fromEntries(LOAD_KEYS.map(k=>[k,''])) as LoadRow;
export const isBlankLoad=(r:LoadRow)=>LOAD_KEYS.every(k=>!r[k].trim());
export const CATALOGUE_KEYS=['brand','model','config','ratedKw','protA','inA','un','efficiency','pf','source'] as const;
export type CatalogueKey=typeof CATALOGUE_KEYS[number];
export type CatalogueRow=Record<CatalogueKey,string>;
export const emptyEntry=():CatalogueRow=>Object.fromEntries(CATALOGUE_KEYS.map(k=>[k,''])) as CatalogueRow;
// What a catalogue entry fills in. A value typed on the load row always wins over the catalogue.
export const FROM_CATALOGUE=['ratedKw','protA','inA','un','efficiency','pf'] as const;
export const TICK_KEYS=['vital','essential','nonEssential','restart'] as const;
export const TICK='✔';
export const STARTERS=['DOL','PWR FDR','SS','SD','VSD/VFD'];
export const DUTIES=['C','I','S'] as const;
export type Duty=typeof DUTIES[number];
export type Factors=Record<Duty,string>;
export const DEFAULT_FACTORS:Factors={C:'1',I:'0.3',S:'0.1'};
export const DEFAULT_MARGIN='0.1';
export type Pair={kw:number;kvar:number};
export type Load=Pair&{kva:number};

const key=(s:string)=>s.trim().toLowerCase();
export const sameText=(a:string,b:string)=>key(a)===key(b);
// Distinct non-blank values, first spelling kept, compared without case.
export function unique(values:readonly string[]):string[] {const seen=new Map<string,string>();for(const v of values){const t=v.trim();if(t&&!seen.has(key(t)))seen.set(key(t),t);}return [...seen.values()];}
// A plain number only: "50.4A" or "<25W" stays text, as the workbook's formulas treat it.
export const num=(v:string):number|null=>{const t=v.trim();return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)?Number(t):null;};
// Efficiency and power factor are decimals (0.95); 95 or 95 % reads as the same.
export const fraction=(v:string):number|null=>{const n=num(v.replace(/\s*%$/,''));if(n===null||n<=0)return null;const f=n>1&&n<=100?n/100:n;return f<=1?f:null;};
export const isTick=(v:string)=>/^(✔|✓|☑|x|y|yes|true|1)$/i.test(v.trim());

export type CatalogueIndex={byModel:Map<string,CatalogueRow[]>;brands:string[];models:string[]};
export function indexCatalogue(cat:readonly CatalogueRow[]):CatalogueIndex {
 const byModel=new Map<string,CatalogueRow[]>();
 for(const c of cat){const m=key(c.model);if(!m)continue;const list=byModel.get(m);if(list)list.push(c);else byModel.set(m,[c]);}
 return {byModel,brands:unique(cat.map(c=>c.brand)),models:unique(cat.map(c=>c.model))};
}
export const modelsOf=(cat:readonly CatalogueRow[],brand:string)=>unique(cat.filter(c=>!brand.trim()||sameText(c.brand,brand)).map(c=>c.model));
export const configsOf=(idx:CatalogueIndex,brand:string,model:string)=>unique((idx.byModel.get(key(model))??[]).filter(c=>sameText(c.brand,brand)).map(c=>c.config));

export type Filled={row:LoadRow;from:ReadonlySet<LoadKey>;entry:CatalogueRow|null};
// The row as the sheet shows it: blanks filled from the catalogue entry for its brand, model and configuration.
// Like the workbook, a model sold by one brand fills the brand, and a model with one configuration fills the configuration.
export function fillRow(row:LoadRow,idx:CatalogueIndex):Filled {
 const out={...row},from=new Set<LoadKey>(),same=idx.byModel.get(key(row.model))??[];
 if(!same.length)return {row:out,from,entry:null};
 if(!out.brand.trim()){const b=unique(same.map(c=>c.brand));if(b.length===1){out.brand=b[0]!;from.add('brand');}}
 const ofBrand=same.filter(c=>sameText(c.brand,out.brand));
 if(!out.config.trim()){const c=unique(ofBrand.map(e=>e.config));if(c.length===1){out.config=c[0]!;from.add('config');}}
 const entry=ofBrand.find(c=>sameText(c.config,out.config))??null;
 if(entry)for(const k of FROM_CATALOGUE)if(!out[k].trim()&&entry[k].trim()){out[k]=entry[k].trim();from.add(k);}
 return {row:out,from,entry};
}

export type Balance={loadFactor:number|null;kw:number|null;kvar:number|null;duty:Duty|null};
export function balance(r:LoadRow):Balance {
 const consumed=num(r.consumedKw),rated=num(r.ratedKw),eff=fraction(r.efficiency),pf=fraction(r.pf),d=r.cis.trim().toUpperCase();
 const duty=(DUTIES as readonly string[]).includes(d)?d as Duty:null,kw=duty&&consumed!==null?consumed/(eff??1):null;
 return {loadFactor:consumed!==null&&rated?consumed/rated:null,kw,kvar:kw!==null&&pf!==null?kw*Math.tan(Math.acos(pf)):null,duty};
}

const withKva=(p:Pair):Load=>({...p,kva:Math.hypot(p.kw,p.kvar)});
const add=(a:Pair,b:Pair):Pair=>({kw:a.kw+b.kw,kvar:a.kvar+b.kvar});
export type Totals={total:Record<Duty,Pair>;largest:Record<Duty,Pair>;operating:Record<Duty,Pair>;counted:Record<Duty,Pair>;baseKva:Record<Duty,number>;overall:Load;withMargin:Load;factors:Record<Duty,number>;margin:number};
export const factorsOf=(f:Factors):Record<Duty,number>=>Object.fromEntries(DUTIES.map(d=>[d,num(f[d])??num(DEFAULT_FACTORS[d])!])) as Record<Duty,number>;
// The equipment-list template's panel summary: per duty, the larger of the largest single load and the duty's total × its operating factor
// (kW and kVAr each on their own, as the template's MAX formulas do); the normal running load adds the three duties.
export function panelTotals(rows:readonly Balance[],factors:Factors,margin:string):Totals {
 const f=factorsOf(factors),m=num(margin)??0;
 const total={} as Totals['total'],largest={} as Totals['largest'],operating={} as Totals['operating'],counted={} as Totals['counted'],baseKva={} as Totals['baseKva'];
 for(const d of DUTIES){
  const own=rows.filter(r=>r.duty===d&&r.kw!==null);
  const t=own.reduce<Pair>((s,r)=>add(s,{kw:r.kw!,kvar:r.kvar??0}),{kw:0,kvar:0}),l={kw:Math.max(0,...own.map(r=>r.kw!)),kvar:Math.max(0,...own.map(r=>r.kvar??0))};
  total[d]=t;largest[d]=l;operating[d]={kw:t.kw*f[d],kvar:t.kvar*f[d]};counted[d]={kw:Math.max(l.kw,operating[d].kw),kvar:Math.max(l.kvar,operating[d].kvar)};baseKva[d]=Math.hypot(t.kw,t.kvar);
 }
 const overall=DUTIES.reduce<Pair>((s,d)=>add(s,counted[d]),{kw:0,kvar:0});
 return {total,largest,operating,counted,baseKva,overall:withKva(overall),withMargin:withKva({kw:overall.kw*(1+m),kvar:overall.kvar*(1+m)}),factors:f,margin:m};
}
export function plantTotals(panels:readonly {overall:Pair;withMargin:Pair}[]):{overall:Load;withMargin:Load} {
 return {overall:withKva(panels.reduce<Pair>((s,p)=>add(s,p.overall),{kw:0,kvar:0})),withMargin:withKva(panels.reduce<Pair>((s,p)=>add(s,p.withMargin),{kw:0,kvar:0}))};
}

// Scenario: one item swapped for another model or load, as the workbook's Scenario Analysis sheet does.
// The panel is summed again with the candidate in the item's place, and the plant load moves by the panel's change.
export const SCENARIO_KEYS=['brand','model','config','consumedKw','ratedKw','inA','un','efficiency','pf'] as const;
export type ScenarioKey=typeof SCENARIO_KEYS[number];
export type Side={row:LoadRow;balance:Balance;capacity:number|null;panel:Load;panelMargin:Load;plant:Load;plantMargin:Load};
export type Plant={overall:Load;withMargin:Load};
export function scenario(rows:readonly LoadRow[],index:number,input:Partial<Record<ScenarioKey,string>>,idx:CatalogueIndex,factors:Factors,margin:string,plant:Plant):{base:Side;candidate:Side} {
 const pick=(k:ScenarioKey)=>input[k]?.trim()??'',base=rows[index]!;
 // A new brand, model or configuration takes its data from the catalogue; anything typed in overrides it.
 // A new model alone finds its brand and its only configuration, or keeps the item's configuration if the new model has it.
 let row:LoadRow={...base};
 if(pick('brand')||pick('model')||pick('config')){
  const swap={...base,brand:pick('brand')||(pick('model')?'':base.brand),model:pick('model')||base.model,config:pick('config')||(pick('brand')||pick('model')?'':base.config)};
  for(const k of FROM_CATALOGUE)swap[k]='';
  let f=fillRow(swap,idx);if(!f.entry&&!pick('config')&&base.config.trim())f=fillRow({...swap,config:base.config},idx);
  row=f.row;
 }
 for(const k of SCENARIO_KEYS)if(pick(k))row[k]=pick(k);
 const bal=rows.map(balance),before=panelTotals(bal,factors,margin),own=balance(row);
 const after=panelTotals(bal.map((b,i)=>i===index?own:b),factors,margin);
 const moved=(p:Pair,from:Pair,to:Pair)=>withKva({kw:p.kw-from.kw+to.kw,kvar:p.kvar-from.kvar+to.kvar});
 const side=(r:LoadRow,b:Balance,t:Totals):Side=>{const consumed=num(r.consumedKw),rated=num(r.ratedKw);
  return {row:r,balance:b,capacity:consumed!==null&&rated!==null?rated-consumed:null,panel:t.overall,panelMargin:t.withMargin,plant:moved(plant.overall,before.overall,t.overall),plantMargin:moved(plant.withMargin,before.withMargin,t.withMargin)};};
 return {base:side(base,bal[index]!,before),candidate:side(row,own,after)};
}
