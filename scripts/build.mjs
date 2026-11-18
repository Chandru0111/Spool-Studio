import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {updateKnowledge,watchKnowledge} from './dkg.mjs';
await updateKnowledge({quiet:true});
const root=process.cwd(),out=path.join(root,'dist');
await fs.mkdir(out,{recursive:true});await fs.cp('public',out,{recursive:true});
const copiedVendor=new Set();
const copy=async(from,to)=>{const info=await fs.stat(from);if(info.isDirectory()){for(const entry of await fs.readdir(from))await copy(path.join(from,entry),path.join(to,entry));return;}await fs.mkdir(path.dirname(path.join(out,to)),{recursive:true});await fs.copyFile(from,path.join(out,to));if(to.startsWith('vendor/'))copiedVendor.add(to);};
await copy('node_modules/pdfjs-dist/build/pdf.min.mjs','vendor/pdf.mjs');
await copy('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','vendor/pdf.worker.mjs');
for(const [source,target] of [['wasm','pdf-wasm'],['cmaps','pdf-cmaps'],['standard_fonts','pdf-fonts']])await copy(`node_modules/pdfjs-dist/${source}`,`vendor/${target}`);
await copy('node_modules/tesseract.js/dist/worker.min.js','vendor/ocr/worker.min.js');
for(const f of await fs.readdir('node_modules/tesseract.js-core'))if(f.endsWith('.wasm.js')||f.endsWith('.wasm'))await copy(`node_modules/tesseract.js-core/${f}`,`vendor/ocr/${f}`);
await copy('node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz','vendor/ocr/eng.traineddata.gz');
for(const face of ['sans','mono'])for(const weight of [400,500,600])await copy(`node_modules/@fontsource/ibm-plex-${face}/files/ibm-plex-${face}-latin-${weight}-normal.woff2`,`fonts/plex-${face}-${weight}.woff2`);
const options={entryPoints:['src/main.tsx'],bundle:true,outdir:out,format:'iife',target:'es2022',sourcemap:true,jsx:'automatic',jsxImportSource:'preact',external:['./fonts/*'],logLevel:'info'};
await esbuild.build(options);
const sums=[];
// Hash only assets copied from the installed packages; unrelated sync-conflict copies in dist are not build inputs.
for(const file of [...copiedVendor].sort())sums.push(`${crypto.createHash('sha256').update(await fs.readFile(path.join(out,file))).digest('hex')}  ${file}`);
await fs.writeFile(path.join(out,'CHECKSUMS.txt'),sums.join('\n'));
if(process.argv.includes('--serve')){
 watchKnowledge();
 const ctx=await esbuild.context(options);await ctx.watch();
 const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.pdf':'application/pdf','.woff2':'font/woff2','.gz':'application/gzip','.svg':'image/svg+xml'};
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const requested=decodeURIComponent(url.pathname);const full=path.resolve(out,'.'+(requested==='/'?'/index.html':requested));if(!full.startsWith(out+path.sep)){res.writeHead(403);res.end();return;}const data=await fs.readFile(full);res.writeHead(200,{'Content-Type':mime[path.extname(full)]??'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'",'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}});
 server.listen(5173,'127.0.0.1',()=>console.log('Spool Studio running at http://127.0.0.1:5173'));
}

if(!process.argv.includes('--serve'))esbuild.stop();
