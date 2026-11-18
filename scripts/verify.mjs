import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {snapshot,updateKnowledge} from './dkg.mjs';
const fingerprint=(await snapshot()).sourceFingerprint,steps=[];
for(const script of ['typecheck','test','build','verify:vendor']){
 const result=await new Promise(resolve=>{const child=spawn('npm',['run',script],{stdio:['ignore','pipe','pipe']});let output='';const record=chunk=>{const text=chunk.toString();output+=text;process.stdout.write(text);};child.stdout.on('data',record);child.stderr.on('data',record);child.on('error',e=>resolve({command:`npm run ${script}`,exitCode:1,summary:e.message}));child.on('close',code=>resolve({command:`npm run ${script}`,exitCode:code??1,summary:output.replace(/\x1b\[[0-9;]*m/g,'').split('\n').filter(l=>/Tests |Test Files|Verified |error TS|FAIL/.test(l)).map(s=>s.trim()).join('; ')||((code??1)===0?'Passed':'Failed')}));});
 steps.push(result);if(result.exitCode!==0)break;
}
const current=(await snapshot()).sourceFingerprint,passed=steps.length===4&&steps.every(s=>s.exitCode===0)&&current===fingerprint;
await fs.writeFile('docs/verification.json',JSON.stringify({checkedAt:new Date().toISOString(),sourceFingerprint:fingerprint,status:passed?'passed':'failed or source changed during verification',steps},null,2)+'\n');await updateKnowledge();if(!passed)process.exitCode=1;else console.log('All checks passed. Verification is recorded in spool-studio.dkg.');
