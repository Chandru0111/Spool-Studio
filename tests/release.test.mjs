import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {it,expect} from 'vitest';
import {checkOutputTree} from '../scripts/verify-vendor.mjs';

it('keeps unlisted documents and linked files out of the static release',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spool-release-'));
 try{
  await fs.writeFile(path.join(dir,'index.html'),'sample');
  await expect(checkOutputTree(dir,[])).resolves.toBeUndefined();
  await fs.writeFile(path.join(dir,'sample-notes.txt'),'test');
  await expect(checkOutputTree(dir,[])).rejects.toThrow(/Unexpected/);
  await fs.rename(path.join(dir,'sample-notes.txt'),path.join(dir,'_headers'));
  await fs.symlink('_headers',path.join(dir,'main.js'));
  await expect(checkOutputTree(dir,[])).rejects.toThrow(/Unexpected/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
