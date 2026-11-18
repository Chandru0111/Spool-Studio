import { Project } from './schema';
// Work is kept in this tab only (sessionStorage): it survives a reload, and a new tab or browser starts blank.
const KEY='spool-project';
export async function restoreProject():Promise<Project|null> {const raw=sessionStorage.getItem(KEY);return raw?Project.parse(JSON.parse(raw)):null;}
export async function autosaveProject(p:Project):Promise<void> {sessionStorage.setItem(KEY,JSON.stringify(Project.parse(p)));}
// Earlier versions kept the project on the device (IndexedDB); delete that copy so nothing lingers.
export function forgetDeviceCopy():void {try{indexedDB.deleteDatabase('keyval-store');}catch{/* storage unavailable */}}
export function downloadFile(name:string,data:BlobPart,type='application/json'):void {const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}

export function saveProject(p:Project):void {downloadFile('spool-project.spool.json',JSON.stringify(Project.parse(p),null,2));}
export async function openProject(file:File):Promise<Project> {if(file.size>25*1024*1024)throw Error('Project exceeds 25 MB.');let raw:unknown;try{raw=JSON.parse(await file.text());}catch{throw Error('This is not a readable project backup (the JSON is damaged).');}
 const parsed=raw&&typeof raw==='object'&&!Array.isArray(raw)&&(raw as {schemaVersion?:unknown}).schemaVersion===2?Project.safeParse(raw):null;
 if(parsed&&!parsed.success)throw Error(`This backup has an invalid value at ${parsed.error.issues[0]?.path.join(' › ')||'its top level'}. It was not opened.`);
 if(!parsed)throw Error('Use a workbook-based version 2 project backup. Earlier circuit projects can be re-imported through their Excel load list.');
 return parsed.data;}
