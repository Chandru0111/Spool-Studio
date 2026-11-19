import {useEffect,useState} from 'preact/hooks';
import {aiModels,AI_DEFAULT,type AiSettings} from '../import/ai';

// One local-model choice (server and model) for the whole app, kept in this browser only.
const SERVERS=[['http://127.0.0.1:11434/v1','Ollama'],['http://127.0.0.1:1234/v1','LM Studio']] as const;
const load=():AiSettings=>{try{const s=JSON.parse(localStorage.getItem('spool.ai')??'{}') as Partial<AiSettings>;return {url:SERVERS.some(([u])=>u===s.url)?s.url!:AI_DEFAULT.url,model:typeof s.model==='string'?s.model:''};}catch{return AI_DEFAULT;}};
export function useAi() {
 const [ai,setAi]=useState(load),[models,setModels]=useState<string[]>([]),[lmLinkOff,setLmLinkOff]=useState(false);
 useEffect(()=>{try{localStorage.setItem('spool.ai',JSON.stringify(ai));}catch{/* storage unavailable: settings last for this visit */}},[ai]);
 // The settings to use, picking the only installed model; a string is the message to show instead.
 async function ready():Promise<AiSettings|string>{if(ai.model)return {...ai,lmLinkOff};const found=await aiModels(ai);setModels(found);
  if(found.length!==1)return found.length?'Pick a model, then try again.':'No models are installed in the local server.';const s={...ai,model:found[0]!};setAi(s);return {...s,lmLinkOff};}
 const picker=<>{ai.url===SERVERS[1][0]&&<label><input type="checkbox" checked={lmLinkOff} onChange={e=>setLmLinkOff(e.currentTarget.checked)}/> LM Link is off and my model runs on this device</label>}
  <select aria-label="Local model server" value={ai.url} onChange={e=>{setAi({url:e.currentTarget.value,model:''});setModels([]);setLmLinkOff(false);}}>{SERVERS.map(([u,l])=><option key={u} value={u}>{l}</option>)}</select>
  {(models.length>0||ai.model)&&<select aria-label="Local model" value={ai.model} onChange={e=>setAi({...ai,model:e.currentTarget.value})}>{!models.includes(ai.model)&&<option value={ai.model}>{ai.model||'Pick a model'}</option>}{models.map(m=><option key={m} value={m}>{m}</option>)}</select>}</>;
 return {ready,picker};
}
