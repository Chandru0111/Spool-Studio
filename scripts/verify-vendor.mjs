import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const workbook='templates/cable-sizing.xlsx';
export const publicFiles=['index.html','icon.svg','_headers',workbook];
const pinned='scripts/vendor-checksums.txt';
const generated=['main.js','main.css','CHECKSUMS.txt'];

// Reject leftovers and links before writing into or releasing a previously used output folder.
export async function checkOutputTree(dir,assets) {
 const allowed=new Set([...publicFiles,...generated,...assets]);
 const directories=new Set(['']);
 for(const file of allowed){let parent=path.dirname(file);while(parent!=='.'){directories.add(parent);parent=path.dirname(parent);}}
 async function walk(relative){
  const full=path.join(dir,relative),stat=await fs.lstat(full);
  if(stat.isFile()&&path.basename(relative)==='.DS_Store'){await fs.unlink(full);return;}
  if(stat.isFile()&&allowed.has(relative))return;
  if(!stat.isDirectory()||!directories.has(relative))throw Error('Unexpected file, directory or link in the release output. Move the existing dist folder outside the published directory and rebuild.');
  for(const entry of await fs.readdir(full))await walk(path.join(relative,entry));
 }
 await walk('');
}

export async function verifyRelease(dir='dist',update=false){
 const lines=(await fs.readFile(path.join(dir,'CHECKSUMS.txt'),'utf8')).trim().split('\n');
 const files=lines.map(line=>{
  const match=/^[a-f0-9]{64}  ((?:vendor|fonts)\/[\w./-]+|templates\/cable-sizing\.xlsx)$/.exec(line);
  if(!match||match[1].split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid vendor checksum record.');
  return match[1];
 });
 if(!files.includes(workbook)||new Set(files).size!==files.length)throw Error('Missing template or duplicate checksum record.');
 await checkOutputTree(dir,files);
 for(const file of [...publicFiles,...generated])await fs.access(path.join(dir,file));
 for(const [i,file] of files.entries()){
  const bytes=await fs.readFile(path.join(dir,file));
  if(!lines[i].startsWith(crypto.createHash('sha256').update(bytes).digest('hex')+'  '))throw Error(`Checksum mismatch: ${file}`);
 }
 const manifest=lines.join('\n')+'\n';
 if(update)await fs.writeFile(pinned,manifest);
 else if(manifest!==await fs.readFile(pinned,'utf8'))throw Error('Runtime assets or the workbook template differ from the reviewed pins. Review the changed files before updating scripts/vendor-checksums.txt.');
 console.log(`${update?'Pinned':'Verified'} ${files.length} asset hashes (PDF, OCR, fonts and blank workbook) and the release file list.`);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await verifyRelease('dist',process.argv.includes('--update'));
