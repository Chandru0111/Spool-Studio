import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {updateKnowledge,watchKnowledge} from './dkg.mjs';
import {publicFiles,workbook,checkOutputTree,verifyRelease} from './verify-vendor.mjs';
await updateKnowledge({quiet:true});
const root=process.cwd(),out=path.join(root,'dist');
await fs.mkdir(out,{recursive:true});
const assets=new Map();
const collect=async(from,to)=>{const info=await fs.lstat(from);if(info.isDirectory()){for(const entry of await fs.readdir(from))await collect(path.join(from,entry),path.join(to,entry));return;}if(!info.isFile())throw Error('Expected a regular build input.');assets.set(to,from);};
await collect('node_modules/pdfjs-dist/build/pdf.min.mjs','vendor/pdf.mjs');
await collect('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','vendor/pdf.worker.mjs');
for(const [source,target] of [['wasm','pdf-wasm'],['cmaps','pdf-cmaps'],['standard_fonts','pdf-fonts']])await collect(`node_modules/pdfjs-dist/${source}`,`vendor/${target}`);
// OCR: ONNX Runtime's WebAssembly build and the PaddleOCR models (models/paddleocr/README.md).
for(const f of ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])await collect(`node_modules/onnxruntime-web/dist/${f}`,`vendor/ocr/${f}`);
await collect('models/paddleocr/det/inference.onnx','vendor/ocr/det.onnx');
for(const m of ['latin','cyrillic','chinese']){await collect(`models/paddleocr/${m}/inference.onnx`,`vendor/ocr/${m}.onnx`);await collect(`models/paddleocr/${m}/inference.yml`,`vendor/ocr/${m}.yml`);}
for(const face of ['sans','mono'])for(const weight of [400,500,600])await collect(`node_modules/@fontsource/ibm-plex-${face}/files/ibm-plex-${face}-latin-${weight}-normal.woff2`,`fonts/plex-${face}-${weight}.woff2`);
await checkOutputTree(out,assets.keys());
for(const [to,from] of [...publicFiles.map(file=>[file,path.join('public',file)]),...assets]){
 if(!(await fs.lstat(from)).isFile()||await fs.realpath(from)!==path.join(await fs.realpath(root),from))throw Error('Expected an approved regular build input.');
 const dest=path.join(out,to);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(from,dest);
}
const options={entryPoints:['src/main.tsx'],bundle:true,outdir:out,format:'iife',target:'es2022',jsx:'automatic',jsxImportSource:'preact',external:['./fonts/*'],logLevel:'info'};
await esbuild.build(options);
const sums=[];
for(const file of [...assets.keys(),workbook].sort())sums.push(`${crypto.createHash('sha256').update(await fs.readFile(path.join(out,file))).digest('hex')}  ${file}`);
await fs.writeFile(path.join(out,'CHECKSUMS.txt'),sums.join('\n'));
await verifyRelease(out);
if(process.argv.includes('--serve')){
 watchKnowledge();
 const ctx=await esbuild.context(options);await ctx.watch();
 const served=new Set([...publicFiles,...assets.keys(),'main.js','main.css','CHECKSUMS.txt']);
 const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.pdf':'application/pdf','.woff2':'font/woff2','.gz':'application/gzip','.onnx':'application/octet-stream','.yml':'text/plain','.svg':'image/svg+xml'};
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const requested=decodeURIComponent(url.pathname);const full=path.resolve(out,'.'+(requested==='/'?'/index.html':requested));if(!served.has(path.relative(out,full))||await fs.realpath(full)!==path.join(await fs.realpath(out),path.relative(out,full))){res.writeHead(404);res.end();return;}const data=await fs.readFile(full);res.writeHead(200,{'Content-Type':mime[path.extname(full)]??'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'",'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}});
 server.listen(5173,'127.0.0.1',()=>console.log('Spool Studio running at http://127.0.0.1:5173'));
}

if(!process.argv.includes('--serve'))esbuild.stop();
