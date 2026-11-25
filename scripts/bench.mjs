#!/usr/bin/env node
// Accuracy bench for the catalogue reader. It reads every datasheet PDF in a private folder the way the app does
// (same text lines, same readers, same sums) and scores what it reads against the values the engineer confirmed, so a
// change that fixes one maker's sheet cannot quietly break another's. Real datasheets stay on this computer: the default
// folder, samples/bench, is ignored by git and by deployment, and nothing here goes online.
//
//   npm run bench                                   score every confirmed sheet in samples/bench
//   npm run bench -- <folder>                       another folder
//   npm run bench -- <folder> --draft <type,type>   for each PDF without a <name>.json, write one with the values read
//                                                   for those equipment types, for the engineer to correct and confirm
//
// <name>.json beside <name>.pdf:
//   {"types":["hv-transformer"],"pages":[1],"confirmed":true,"rows":[{"model":"","un":"400 V","inA":"3608.44","rated-power":"2500"}]}
// Row keys are load list columns (model, config, ratedKw, protA, inA, un, efficiency, pf) or a type's parameter keys; a
// value of "" means the reader must leave it empty. A row with a model is matched by it; otherwise rows go in order.
// Scanned pages need the browser's OCR and are not benched.
import {build} from 'esbuild';
import {mkdirSync,readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),args=process.argv.slice(2);
const draftAt=args.indexOf('--draft'),draft=draftAt>=0?(args[draftAt+1]??'').split(',').filter(Boolean):null;
const folder=resolve(args.find((a,i)=>!a.startsWith('--')&&(draftAt<0||i!==draftAt+1))??join(root,'samples/bench'));
if(!existsSync(folder)){console.error(`No folder ${folder}. Make it, put datasheet PDFs in it, then run with --draft <types>.`);process.exit(2);}
if(draft&&!draft.length){console.error('--draft needs the equipment types, for example --draft hv-transformer,motor');process.exit(2);}

// The reader's own source, bundled for Node beside node_modules so its packages resolve.
const out=join(root,'node_modules/.cache/spool-bench/reader.mjs');mkdirSync(join(out,'..'),{recursive:true});
await build({stdin:{contents:`export {catalogueFromDatasheet} from './src/import/webpage';export {applyPick} from './src/import/equipment';
export {checkAll} from './src/import/checks';export {pdfLines,phrases,hasFigureRows,rulesOf} from './src/import/parse';export {BUILT_IN} from './src/engine/equipment-types';`,
 resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:out,external:['exceljs','pdfjs-dist'],logLevel:'error'});
const reader=await import(pathToFileURL(out).href);
const pdfjs=await import(pathToFileURL(join(root,'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);

const COLUMNS=['model','config','ratedKw','protA','inA','un','efficiency','pf'];
async function read(file,only){
 const doc=await pdfjs.getDocument({data:new Uint8Array(readFileSync(file)),isEvalSupported:false,verbosity:0}).promise;
 const pages=[],layout=new Map(),rules=new Map(),scanned=[];
 try{
  for(const number of only?.length?only:Array.from({length:doc.numPages},(_,i)=>i+1)){
   const page=await doc.getPage(number),{lines,text}=reader.pdfLines((await page.getTextContent()).items);
   if(text.replace(/\s/g,'').length<60){scanned.push(number);continue;}
   if(reader.hasFigureRows(lines)){const ops=await page.getOperatorList();rules.set(number,reader.rulesOf(ops.fnArray,ops.argsArray,pdfjs.OPS));}
   pages.push({page:number,text:reader.phrases(lines,rules.get(number)),mode:'text',confidence:null});layout.set(number,lines);
   page.cleanup();
  }
 }finally{await doc.destroy();}
 return {pages,layout,rules,scanned};
}
const typesOf=(ids)=>ids.map(id=>{const t=reader.BUILT_IN.find(x=>x.id===id);if(!t)throw Error(`No built-in equipment type "${id}".`);return t;});
async function proposals(file,spec){
 const types=typesOf(spec.types),r=await read(file,spec.pages);
 return {...r,rows:reader.checkAll(reader.applyPick(reader.catalogueFromDatasheet(r.pages,basename(file),r.layout,r.rules,types).proposals,types),types),types};
}
const valueOf=(p,k)=>(COLUMNS.includes(k)?p?.entry[k]:p?.entry.extra?.[k])??'';
// Same value: as numbers when both are one figure (units aside: "400 V" is 400), else as text, case and spaces aside.
const figure=(v)=>{const m=/^([+-]?\d+(?:\.\d+)?)\s*[^\d\s]*$/.exec(v.trim());return m?Number(m[1]):null;};
const same=(a,b)=>{const x=figure(a),y=figure(b);return x!==null&&y!==null?Math.abs(x-y)<=1e-9*Math.max(1,Math.abs(x)):a.replace(/\s+/g,'').toLowerCase()===b.replace(/\s+/g,'').toLowerCase();};

const pdfs=readdirSync(folder).filter(f=>/\.pdf$/i.test(f)).sort();
if(!pdfs.length){console.log(`No PDFs in ${folder}.`);process.exit(0);}
let right=0,total=0,wrong=0;const byKey=new Map();
for(const name of pdfs){
 const file=join(folder,name),json=file.replace(/\.pdf$/i,'.json');
 if(!existsSync(json)){
  if(!draft){console.log(`${name}: no ${basename(json)}. Run with --draft <types> to start one.`);continue;}
  const {rows,types,scanned}=await proposals(file,{types:draft});
  const keys=[...new Set(['model','config',...types.flatMap(t=>t.params.map(p=>p.feeds||p.key))])];
  writeFileSync(json,`${JSON.stringify({types:draft,confirmed:false,rows:rows.filter(p=>p.include).map(p=>Object.fromEntries(keys.map(k=>[k,valueOf(p,k)])))},null,1)}\n`);
  console.log(`${name}: wrote ${basename(json)} with the values read${scanned.length?` (pages ${scanned.join(', ')} are scans and were skipped)`:''}. Check every value against the sheet, correct it, then set "confirmed": true.`);
  continue;
 }
 const spec=JSON.parse(readFileSync(json,'utf8'));
 if(!spec.confirmed){console.log(`${name}: ${basename(json)} is not confirmed yet; skipped.`);continue;}
 const {rows,scanned}=await proposals(file,spec),misses=[];let n=0,ok=0;
 (spec.rows??[]).forEach((want,i)=>{
  const p=(want.model?rows.find(r=>same(r.entry.model,want.model)):undefined)??rows[i];
  for(const [k,v] of Object.entries(want)){
   const got=valueOf(p,k),hit=same(got,String(v)),s=byKey.get(k)??{right:0,total:0};
   n++;s.total++;if(hit){ok++;s.right++;}else misses.push(`  ✗ ${want.model||`row ${i+1}`} ${k}: expected "${v}", read "${got}"`);byKey.set(k,s);
  }
 });
 const amber=rows.filter(r=>r.doubt).length,red=rows.reduce((a,r)=>a+r.unverified.length,0);
 console.log(`${name}: ${ok}/${n} right · ${rows.length} row${rows.length===1?'':'s'} read · ${amber} not adding up · ${red} red${scanned.length?` · pages ${scanned.join(', ')} are scans, not benched`:''}`);
 for(const m of misses)console.log(m);
 for(const r of rows.filter(r=>r.doubt))console.log(`  ⚠ ${r.entry.model||'(no model)'}: ${r.doubt.why}`);
 right+=ok;total+=n;wrong+=n-ok;
}
if(total){
 console.log(`\nBy parameter: ${[...byKey].sort((a,b)=>a[1].right/a[1].total-b[1].right/b[1].total).map(([k,s])=>`${k} ${s.right}/${s.total}`).join(' · ')}`);
 console.log(`Total: ${right}/${total} right (${Math.round(right/total*100)} %)`);
}
process.exit(wrong?1:0);
