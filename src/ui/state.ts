import { signal,computed,effect } from '@preact/signals';
import { ZodError } from 'zod';
import { defaultDrum,Project,type LoadPanel,type Loads } from '../store/schema';
import { balance,emptyLoad,fillRow,indexCatalogue,panelTotals,plantTotals,type LoadKey,type LoadRow } from '../engine/loads';
import { selectedDrumOption,loadListGroups } from '../engine/procurement';
import { planDrums,parseRuns } from '../engine/drums';
import { calculateRow,clip,emptyRow,type InputCol,type SheetRow } from '../engine/sheet';
import { suggestSheet,acceptSuggestions,defaultSuggestions,type SuggestDefaults } from '../engine/suggest';
import { autosaveProject,forgetDeviceCopy,restoreProject } from '../store/project';
import { exportSheet,panelSheets } from '../export/template';
// A neutral starting workspace; reference workbooks are examples, not the user's project.
export const fresh=():Project=>Project.parse({schemaVersion:2,sheetLayout:8,name:'Untitled project',single:emptyRow(),list:{rows:[],source:'',defaults:{...defaultSuggestions}},drum:{...defaultDrum},cable:{odMm:29.2,kgKm:1850,minBendRadiusXOd:6},runs:'',demoGeometry:true,loads:{panels:[],catalogue:[],source:''}});
export const project=signal<Project>(fresh());
export type Tab='single'|'loads'|'list'|'drums';
export const tab=signal<Tab>('single');
export const toast=signal('');export const saveStatus=signal('Local workspace');export const exporting=signal(false);
// The single-cable sheet behaves exactly like the workbook; the load list adds suggestions for blank cells.
export const single=computed(()=>calculateRow(project.value.single));
export const listSheet=computed(()=>suggestSheet(project.value.list.rows,project.value.list.defaults));
export const cableGroups=computed(()=>loadListGroups(listSheet.value.effective,listSheet.value.results));
// Runs taken from the load list stay linked, so a resized circuit updates the drum plan.
export const drumPlan=computed(()=>{const p=project.value,linked=cableGroups.value.find(g=>g.key===p.runsFrom);if(p.runsFrom&&!linked)return {ok:false as const,message:'The selected load-list cable no longer exists or has no valid run. Choose a current product or switch to typed runs.'};if(linked&&p.geometryFor!==linked.key)return {ok:false as const,message:'Enter and confirm physical dimensions for this exact cable product before calculating drums.'};const runs=linked?{ok:true as const,value:linked.runsM}:parseRuns(p.runs),source=selectedDrumOption(p);if(p.drum.overrideM>0&&source.ratedCableOdMm!==null&&Math.abs(source.ratedCableOdMm-p.cable.odMm)>.01)return {ok:false as const,message:'Supplier capacity applies to a different cable OD. Confirm capacity for this cable or clear the override.'};return runs.ok?planDrums(p.drum,p.cable,runs.value):runs;});
// Undo history: whole-project snapshots (cheap, the state is immutable). Typing in one cell within a second is one step.
const past:Project[]=[],future:Project[]=[];let lastKey='',lastAt=0;
export const history=signal({undo:0,redo:0});
const syncHistory=()=>{history.value={undo:past.length,redo:future.length};};
export function updateProject(p:Partial<Project>,key=''):void {const now=Date.now();if(!(key&&key===lastKey&&now-lastAt<1000)){past.push(project.value);if(past.length>300)past.shift();}future.length=0;lastKey=key;lastAt=now;const changedProduct=p.runsFrom!==undefined&&p.runsFrom!==project.value.runsFrom;project.value={...project.value,...(changedProduct?{bendGuidance:{type:'',installation:'',fixed:'',source:''} as Project['bendGuidance']}:{}),...p};syncHistory();}
export function undo():void {const prev=past.pop();if(!prev)return;future.push(project.value);project.value=prev;lastKey='';syncHistory();}
export function redo():void {const next=future.pop();if(!next)return;past.push(project.value);project.value=next;lastKey='';syncHistory();}
// Load-list view state (not saved): filter, search, selected rows and the row open in the calculation panel.
export type ListFilter='all'|'issues'|'fail'|'incomplete'|'suggested'|'pass';
// listPanel: the panel tab shown (a From value, '' = rows with no From); null shows every panel.
export const listPanel=signal<string|null>(null);export const listFilter=signal<ListFilter>('all');export const listSearch=signal('');export const selection=signal<ReadonlySet<number>>(new Set());export const inspecting=signal<number|null>(null);
// Clears every sheet and drum setting in one undoable step (Ctrl+Z brings the previous project back until reload).
export function newProject():void {loadPanel.value=0;loadView.value='panels';scenarioPick.value=null;listPanel.value=null;listFilter.value='all';listSearch.value='';selection.value=new Set();inspecting.value=null;updateProject(fresh());notify('New project started. Undo with Ctrl+Z if you need the previous one back.');}
// Light is the default look; the choice is a per-viewer convenience kept in this browser only.
const storedTheme=():'light'|'dark'=>{try{return localStorage.getItem('spool-theme')==='dark'?'dark':'light';}catch{return 'light';}};
export const theme=signal(storedTheme());
effect(()=>{const t=theme.value;if(typeof document!=='undefined')document.documentElement.dataset.theme=t;try{localStorage.setItem('spool-theme',t);}catch{/* storage unavailable: theme still applies for this visit */}});
export const setSingle=(col:InputCol,value:string)=>updateProject({single:{...project.value.single,[col]:clip(value)}},`single:${col}`);
export const setList=(p:Partial<Project['list']>,key='')=>updateProject({list:{...project.value.list,...p}},key);
export const setListRows=(rows:SheetRow[],key='')=>{if(rows.length>2000){notify('A load list supports at most 2,000 rows.');return;}setList({rows},key);};
// Equipment load list (Load list tab). Each panel's rows are shown with catalogue values filled in; totals follow the workbook.
export const setLoads=(p:Partial<Loads>,key='')=>updateProject({loads:{...project.value.loads,...p}},key);
export const catalogueIndex=computed(()=>indexCatalogue(project.value.loads.catalogue));
export const loadSheets=computed(()=>{const idx=catalogueIndex.value;return project.value.loads.panels.map(p=>{const filled=p.rows.map(r=>fillRow(r,idx)),bal=filled.map(f=>balance(f.row));return {filled,bal,totals:panelTotals(bal,p.factors,p.margin)};});});
export const plantLoad=computed(()=>plantTotals(loadSheets.value.map(s=>s.totals)));
export const setPanel=(i:number,patch:Partial<LoadPanel>,key='')=>{const panels=[...project.value.loads.panels],p=panels[i];if(!p)return;panels[i]={...p,...patch};setLoads({panels},key);};
export const setLoadRows=(i:number,rows:LoadRow[],key='')=>{if(rows.length>500){notify('A panel holds at most 500 items. Add another panel for the rest.');return;}setPanel(i,{rows},key);};
export const setLoadCell=(i:number,r:number,k:LoadKey,value:string)=>{const p=project.value.loads.panels[i];if(!p)return;const rows=[...p.rows];rows[r]={...(rows[r]??emptyLoad()),[k]:clip(value)};setLoadRows(i,rows,`load:${i}:${r}:${k}`);};
export const loadPanel=signal(0);export const loadView=signal<'panels'|'catalogue'|'scenario'>('panels');export const scenarioPick=signal<{panel:number;row:number}|null>(null);
export const setListCell=(i:number,col:InputCol,value:string)=>{const rows=[...project.value.list.rows];rows[i]={...(rows[i]??emptyRow()),[col]:clip(value)};setListRows(rows,`list:${i}:${col}`);};
export const setDefaults=(d:Partial<SuggestDefaults>)=>setList({defaults:{...project.value.list.defaults,...d}},`defaults:${Object.keys(d).join()}`);
export function acceptAll():void {setListRows(acceptSuggestions(project.value.list.rows,listSheet.value));notify('Suggestions accepted. They are now ordinary values you can edit.');}
let timer:ReturnType<typeof setTimeout>;
export function notify(message:string):void {toast.value=message;clearTimeout(timer);timer=setTimeout(()=>toast.value='',6000);}
export async function exportExcel(rows:readonly SheetRow[],suffix:string):Promise<void> {if(exporting.value)return;exporting.value=true;try{await exportSheet(rows,`${project.value.name} ${suffix}`);const {panels,chained}=panelSheets(rows);notify(panels.length?`Exported ${panels.length} panels, one Cable Sizing sheet each. Formulas and dropdowns stay live in Excel.`:chained?`Exported on one sheet: ${chained} row${chained===1?' feeds':'s feed'} another panel in the list, and Excel chains total VD within one sheet only.`:'Exported into the Cable Sizing workbook. Formulas and dropdowns stay live in Excel.');}catch(e){notify(e instanceof Error?e.message:'Export failed.');}finally{exporting.value=false;}}
// Names the part of the project that failed validation, so the message points at the right input.
export function saveProblem(e:unknown):string {const path=e instanceof ZodError?e.issues[0]?.path??[]:[];return path[0]==='drum'||path[0]==='cable'?'check drum inputs':path[0]==='list'||path[0]==='single'?'a sheet cell is too long':path[0]==='name'?'check the project name':path[0]==='runs'?'the typed cable runs are too long':path.length?`check ${path.join(' › ')}`:'browser storage unavailable';}
export async function initializeStore():Promise<void> {
  forgetDeviceCopy();
  try {const saved=await restoreProject();if(saved){project.value=saved;saveStatus.value='Saved in this tab';}}catch{saveStatus.value='Autosave unavailable';}
  let restored=true;
  let debounce:ReturnType<typeof setTimeout>;effect(()=>{const snapshot=project.value;if(restored){restored=false;return;}saveStatus.value='Saving…';clearTimeout(debounce);debounce=setTimeout(()=>{void autosaveProject(snapshot).then(()=>{saveStatus.value='Saved in this tab';}).catch((e:unknown)=>saveStatus.value=`Not saved: ${saveProblem(e)}`);},450);});
}
