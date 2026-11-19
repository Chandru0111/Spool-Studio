import type {PageEvidence,DrumOption} from '../store/schema';
import {Drum,defaultDrum} from '../store/schema';
import {readCatalogue,type Progress} from './document';
import {readTables,parseDrumOptions} from './load-list';

// Read only explicitly labelled, unit-qualified specifications. Never assign loose table numbers.
export function extractDrumSpecifications(pages:PageEvidence[],name:string):DrumOption[] {
 const results:DrumOption[]=[];
 for(const page of pages) {
  const blocks=page.text.split(/(?=\b(?:Drum\s+(?:code|model|type)|Model\s*(?:code|number))\s*[:#])/i);
  for(const text of blocks) {
   const code=text.match(/(?:Drum\s+(?:code|model|type)|Model\s*(?:code|number))\s*[:#]\s*([^\n\r]+)/i)?.[1]?.trim();
   if(!code)continue;
   const number=(label:string,unit:string)=>{const m=text.match(new RegExp(`(?:${label})\\s*(?:\\([^)]*\\)\\s*)?(?:[:=]\\s*)?(\\d+(?:\\.\\d+)?)\\s*${unit}\\b`,'i'));return m?.[1]?+m[1]:null;};
   const flangeMm=number('Flange (?:diameter|dia\\.?)','mm'),barrelMm=number('(?:Barrel|Hub) (?:diameter|dia\\.?)','mm'),widthMm=number('(?:Winding|Traverse|Internal) width','mm'),maxLoadKg=number('(?:Max(?:imum)?\\.? (?:cable )?(?:load|payload)|Cable payload)','kg'),tareKg=number('(?:Tare(?: weight)?|Empty drum weight)','kg');
   if(flangeMm===null||barrelMm===null||widthMm===null||maxLoadKg===null||tareKg===null)continue;
   const capacity=number('(?:Cable |Winding )?capacity','m')??0,od=number('(?:Rated cable OD|Cable (?:OD|diameter))','mm');
   const drum={...defaultDrum,flangeMm,barrelMm,widthMm,maxLoadKg,tareKg,overrideM:od?capacity:0};
   if(!Drum.safeParse(drum).success||flangeMm<=barrelMm)continue;
   results.push({id:`supplier-${crypto.randomUUID()}`,code,manufacturer:text.match(/(?:Manufacturer|Supplier)\s*:\s*([^\n\r]+)/i)?.[1]?.trim()??'Supplier to confirm',basis:'supplier',source:`${name}, page ${page.page} (${page.mode}${page.mode==='ocr'?'; OCR requires numerical review':''})${capacity&&!od?'; unqualified length capacity excluded':''}`,drum,ratedCableOdMm:od});
  }
 }
 if(results.length>100)throw Error('The document contains more than 100 drum candidates. Split the file.');
 return results;
}
export async function readDrumCatalogue(file:File,progress:(p:Progress)=>void,signal:AbortSignal):Promise<DrumOption[]> {
 if(/\.(xlsx|csv)$/i.test(file.name)){const tables=await readTables(file);const table=tables[0];if(!table)throw Error('Workbook has no worksheets.');return parseDrumOptions(table);}
 const document=await readCatalogue(file,progress,signal);
 const rows=extractDrumSpecifications(document.pages,file.name);
 if(!rows.length)throw Error('No complete, labelled drum specifications found. Use the CSV template or enter manufacturer dimensions in the size adaptor. Required: drum code, flange, barrel, winding width, payload and tare with units.');
 return rows;
}
