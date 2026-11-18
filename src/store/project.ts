import { get,set } from 'idb-keyval';
import { Project } from './schema';
// Version 1 projects held the retired circuit and catalogue model; only their drum settings carry over.
export async function restoreProject(fresh:Project):Promise<Project|null> {
 const raw=await get('spool-project-v2');if(raw)return Project.parse(raw);
 const old=await get('spool-project-v1') as Partial<Project>|undefined;if(!old)return null;
 const keep=Project.safeParse({...fresh,name:old.name??fresh.name,drum:old.drum,cable:old.cable,runs:old.runs,demoGeometry:old.demoGeometry,drumOptions:old.drumOptions??[],selectedDrumId:old.selectedDrumId??fresh.selectedDrumId});
 return keep.success?keep.data:null;
}
export async function autosaveProject(p:Project):Promise<void> {await set('spool-project-v2',Project.parse(p));}
export function downloadFile(name:string,data:BlobPart,type='application/json'):void {const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}

export function saveProject(p:Project):void {downloadFile('spool-project.spool.json',JSON.stringify(Project.parse(p),null,2));}
export async function openProject(file:File):Promise<Project> {if(file.size>25*1024*1024)throw Error('Project exceeds 25 MB.');let raw:unknown;try{raw=JSON.parse(await file.text());}catch{throw Error('This is not a readable project backup (the JSON is damaged).');}
 const parsed=raw&&typeof raw==='object'&&!Array.isArray(raw)&&(raw as {schemaVersion?:unknown}).schemaVersion===2?Project.safeParse(raw):null;
 if(parsed&&!parsed.success)throw Error(`This backup has an invalid value at ${parsed.error.issues[0]?.path.join(' › ')||'its top level'}. It was not opened.`);
 if(!parsed)throw Error('Use a workbook-based version 2 project backup. Earlier circuit projects can be re-imported through their Excel load list.');
 return parsed.data;}
