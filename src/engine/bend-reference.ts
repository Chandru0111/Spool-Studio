// Keystone's supplied bending-radius table: these are installation/fixed references, not dispatch drum limits.
export const BEND_TYPES=[['','Custom / no reference'],['single','PVC / XLPE power — single core'],['multi','PVC / XLPE power — multicore'],['armoured','PVC / XLPE power — armoured circular conductor'],['fire','Fire-resistant — single or multicore'],['fire-armoured','Fire-resistant — armoured']] as const;
export type BendType=typeof BEND_TYPES[number][0];
export function bendReference(type:BendType,od:number):{installation:number;fixed:number}|null {
 if(!Number.isFinite(od)||od<=0)return null;
 if(type==='single')return {installation:od<=25?6:10,fixed:od<=25?4:6};
 if(type==='multi')return {installation:10,fixed:od<=25?4:6};
 if(type==='armoured'||type==='fire')return {installation:10,fixed:6};
 if(type==='fire-armoured')return {installation:12,fixed:8};
 return null;
}
