import {INPUT_COLS,MAX_CELL,type SheetRow} from '../engine/sheet';
import { z } from 'zod';

export const Rating = z.object({
  id: z.string(), cableType: z.string(), cores: z.string(), material: z.enum(['Cu','Al','Unknown']),
  insulation: z.enum(['PVC','XLPE','EPR','Unknown']), phases: z.union([z.literal(1),z.literal(3)]).nullable(),
  method: z.string(), sizeMm2: z.number().finite().positive().nullable(),
  itA: z.number().finite().positive().nullable(), mvAm: z.number().finite().positive().nullable(),
  odMm: z.number().finite().positive().nullable(), kgKm: z.number().finite().positive().nullable(),
  minBendRadiusXOd: z.number().finite().positive().nullable(), ratedV: z.number().finite().positive().nullable(),
  source: z.string(), page: z.number().int().positive(), evidence: z.string(), reviewed: z.boolean(),
});
export type Rating = z.infer<typeof Rating>;
export const PageEvidence = z.object({ page: z.number(), text: z.string(), mode: z.enum(['text','ocr','table']), confidence: z.number().nullable() });
export type PageEvidence = z.infer<typeof PageEvidence>;
export const FactorData=z.object({temperature:z.array(z.object({key:z.string(),tempC:z.number(),PVC:z.number().nullable(),XLPE:z.number().nullable()})),grouping:z.array(z.object({key:z.string(),factor:z.number()})),methods:z.array(z.object({method:z.string(),temperature:z.string(),arrangement:z.string(),soil:z.string()})),soil:z.array(z.object({resistivity:z.number(),duct:z.number(),direct:z.number()})),source:z.string()});
export type FactorData=z.infer<typeof FactorData>;
export const Catalogue = z.object({
  id: z.string(), name: z.string(), sha256: z.string(), pages: z.array(PageEvidence).max(200),
  rows: z.array(Rating).max(5000), preparer: z.string(), reviewer: z.string(), verified: z.boolean(), demo: z.boolean(),
  sourceKind:z.enum(['manufacturer','workbook']).default('manufacturer'),factorData:FactorData.nullable().default(null),
});
export type Catalogue = z.infer<typeof Catalogue>;
export const Drum = z.object({ flangeMm:z.number().finite().positive(), barrelMm:z.number().finite().positive(),widthMm:z.number().finite().positive(),clearanceMm:z.number().finite().min(0),fillFactor:z.number().finite().positive().max(1),maxLoadKg:z.number().finite().positive(),tareKg:z.number().finite().min(0),liftLimitKg:z.number().finite().positive(),wastagePct:z.number().finite().min(0).max(100),overrideM:z.number().finite().min(0) });
export type Drum = z.infer<typeof Drum>;
export const defaultDrum: Drum = {flangeMm:1250,barrelMm:500,widthMm:750,clearanceMm:25,fillFactor:.9,maxLoadKg:1800,tareKg:95,liftLimitKg:2000,wastagePct:5,overrideM:0};
export const CableGeometry = z.object({odMm:z.number().finite().positive(),kgKm:z.number().finite().positive(),minBendRadiusXOd:z.number().finite().positive()});
export type CableGeometry = z.infer<typeof CableGeometry>;
export const DrumOption=z.object({id:z.string(),code:z.string(),manufacturer:z.string(),source:z.string(),basis:z.enum(['basic','supplier']),drum:Drum,ratedCableOdMm:z.number().positive().nullable().default(null)});
export type DrumOption=z.infer<typeof DrumOption>;
export const basicDrums:DrumOption[]=[{id:'basic-1000',code:'BASIC-1000',manufacturer:'Generic planning option',source:'Illustrative dimensions — confirm with supplier',basis:'basic',ratedCableOdMm:null,drum:{...defaultDrum,flangeMm:1000,barrelMm:400,widthMm:600,maxLoadKg:1000,tareKg:65}},{id:'basic-1250',code:'BASIC-1250',manufacturer:'Generic planning option',source:'Illustrative dimensions — confirm with supplier',basis:'basic',ratedCableOdMm:null,drum:{...defaultDrum}},{id:'basic-1600',code:'BASIC-1600',manufacturer:'Generic planning option',source:'Illustrative dimensions — confirm with supplier',basis:'basic',ratedCableOdMm:null,drum:{...defaultDrum,flangeMm:1600,barrelMm:630,widthMm:950,maxLoadKg:3000,tareKg:160}}];
// One row of the Cable Sizing sheet, keyed by its Excel column letter. Unknown columns are dropped on load.
export const SheetRowData=z.object(Object.fromEntries(INPUT_COLS.map(c=>[c,z.string().max(MAX_CELL).default('')]))).transform(r=>Object.fromEntries(INPUT_COLS.map(c=>[c,(r as Record<string,string>)[c]??''])) as SheetRow);
// Projects saved before the step08 layout (no sheetLayout) keep their earth fault inputs under step06 or step07 letters, which step08
// reuses for other columns. Each old letter is an input in only one of those layouts, so one map moves both to step08.
const LEGACY_FAULT:Record<string,string>={AP:'AQ',AQ:'AS',AR:'AT',AS:'AX',AT:'AW',AU:'AX',AV:'AY',AZ:'BH',BA:'BK',BB:'BL',BE:'BH',BF:'BI',BH:'BK',BI:'BL'};
const toStep08=(r:unknown)=>{if(!r||typeof r!=='object'||Array.isArray(r))return r;const o:Record<string,unknown>={};
 for(const [k,v] of Object.entries(r as Record<string,unknown>))if(!(k in LEGACY_FAULT))o[k]=v;
 for(const [k,v] of Object.entries(r as Record<string,unknown>)){const to=LEGACY_FAULT[k];if(to&&typeof v==='string'&&(v.trim()||o[to]===undefined))o[to]=v;}
 return o;};
const migrate=(p:unknown)=>{if(!p||typeof p!=='object'||Array.isArray(p)||(p as {sheetLayout?:unknown}).sheetLayout===8)return p;const o={...(p as Record<string,unknown>)},list=o.list as {rows?:unknown}|undefined;
 o.single=toStep08(o.single);if(list&&typeof list==='object'&&Array.isArray(list.rows))o.list={...list,rows:list.rows.map(toStep08)};o.sheetLayout=8;return o;};
export const SuggestDefaults=z.object({cableType:z.string().max(300),cores3:z.string().max(300),cores1:z.string().max(300),method:z.string().max(300),vdPct:z.string().max(300)});
export const BendGuidance=z.object({type:z.enum(['','single','multi','armoured','fire','fire-armoured']).default(''),installation:z.string().max(30).default(''),fixed:z.string().max(30).default(''),source:z.string().max(500).default('')}).default({type:'',installation:'',fixed:'',source:''});
export const Project = z.preprocess(migrate,z.object({schemaVersion:z.literal(2),sheetLayout:z.literal(8),name:z.string().min(1).max(100),single:SheetRowData,list:z.object({rows:z.array(SheetRowData).max(2000),source:z.string().max(300),defaults:SuggestDefaults}),drum:Drum,cable:CableGeometry,bendGuidance:BendGuidance,runs:z.string().max(20000),demoGeometry:z.boolean(),drumOptions:z.array(DrumOption).max(100).default([]),selectedDrumId:z.string().default('basic-1250'),runsFrom:z.string().default(''),geometryFor:z.string().default(''),geometrySource:z.string().max(500).default('')}));
export type Project = z.infer<typeof Project>;
