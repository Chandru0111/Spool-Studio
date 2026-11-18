import {createWorker,type Worker} from 'tesseract.js';
import {dxfTokens,extractLoadList,SCHEMATIC_LIMITS,type SchematicResult,type Token} from './schematic';
import {readDrawingImage,traceLines,tokenBox,scaleGeometry,type Word} from './drawing-ocr';
import type {Geometry,Rgba} from './raster';
import {checkImage,MAX_IMAGE_SIDE as MAX_SIDE,MAX_IMAGE_PIXELS as MAX_PIXELS} from './guard';
import type {Progress} from './document';

// Reads a schematic in the browser. PDF: the text layer, with the page rendered to trace busbars and feeders (scanned
// pages are read with OCR). Images: cleaned up, read with OCR in three orientations and traced. DXF: text and attributes.
export const SCHEMATIC_ACCEPT='.pdf,.dxf,.png,.jpg,.jpeg,.webp';
export const isSchematic=(name:string)=>/\.(pdf|dxf|dwg|png|jpe?g|webp)$/i.test(name);
export type SchematicRead=SchematicResult&{file:string;pages:number;ocrPages:number;text:string[]};
const MAX_BYTES=25*1024*1024,OCR_SIDE=3200,TRACE_SIDE=2600,WORK_PIXELS=24e6;
// Scanned drawings: decide by how little real text a page has.
const sparse=(tokens:Token[])=>tokens.reduce((n,t)=>n+t.text.replace(/\s/g,'').length,0)<40;
const pixels=(canvas:HTMLCanvasElement):Rgba=>{const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('This browser cannot prepare the drawing for reading.');const d=ctx.getImageData(0,0,canvas.width,canvas.height);return {width:d.width,height:d.height,data:d.data};};
const textLines=(tokens:Token[])=>{const rows=[...tokens].sort((a,b)=>a.y-b.y||a.x-b.x),out:string[]=[];let y=-1e9;for(const t of rows){if(out.length&&Math.abs(t.y-y)<t.h*.6)out[out.length-1]+=` ${t.text}`;else{out.push(t.text);y=t.y;}}return out;};

export async function readSchematic(file:File,onProgress:(p:Progress)=>void,signal:AbortSignal):Promise<SchematicRead> {
 if(!file.size)throw Error('This file is empty.');if(file.size>MAX_BYTES)throw Error('Drawing exceeds 25 MB. Split the set or export fewer sheets.');
 const ext=file.name.split('.').pop()?.toLowerCase()??'';
 if(ext==='dwg')throw Error('DWG is a closed CAD format. Save the drawing as DXF (ASCII) or plot it to PDF, then import that.');
 if(!['pdf','dxf','png','jpg','jpeg','webp'].includes(ext))throw Error('Use a PDF, DXF, PNG, JPG or WebP schematic.');
 const check=()=>{if(signal.aborted)throw Error('Import cancelled.');};
 let worker:Worker|undefined,ocrPages=0,percent=0;
 const stop=()=>{void worker?.terminate();};signal.addEventListener('abort',stop);
 const say=(message:string)=>onProgress({message,percent});
 const scratch=document.createElement('canvas');
 // Tesseract in sparse-text mode suits drawings: labels are scattered, not paragraphs.
 const recognise=async(img:Rgba,label:string):Promise<Word[]>=>{
  worker??=await createWorker('eng',1,{workerPath:new URL('vendor/ocr/worker.min.js',location.href).href,corePath:new URL('vendor/ocr/',location.href).href,langPath:new URL('vendor/ocr/',location.href).href,workerBlobURL:false});
  await worker.setParameters({tessedit_pageseg_mode:'11' as never});check();
  scratch.width=img.width;scratch.height=img.height;const ctx=scratch.getContext('2d');if(!ctx)throw Error('This browser cannot prepare the drawing for reading.');const frame=ctx.createImageData(img.width,img.height);frame.data.set(img.data);ctx.putImageData(frame,0,0);
  say(`Reading ${label}`);const {data}=await worker.recognize(scratch,{},{blocks:true});check();
  return (data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words))).slice(0,8000).map(w=>({text:w.text,confidence:w.confidence,bbox:w.bbox}));
 };
 const draw=(source:CanvasImageSource,w:number,h:number,scale:number)=>{const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('This browser cannot prepare the drawing for reading.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);return canvas;};
 try {
  const bytes=await file.arrayBuffer();check();let tokens:Token[]=[],pages=1;const geometry=new Map<number,Geometry>(),text:string[]=[];
  if(ext==='dxf'){
   // R2007+ DXF is UTF-8; older files use the Windows code page.
   let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{raw=new TextDecoder('windows-1252').decode(bytes);}
   say('Reading DXF text and block attributes');tokens=dxfTokens(raw);pages=new Set(tokens.map(t=>t.page)).size||1;text.push(...textLines(tokens));
  } else if(ext==='pdf'){
   if(new TextDecoder().decode(bytes.slice(0,1024)).indexOf('%PDF-')<0)throw Error('The file is not a valid PDF.');
   const pdfjs:typeof import('pdfjs-dist')=await import(/* @vite-ignore */new URL('vendor/pdf.mjs',location.href).href);
   pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf.worker.mjs',location.href).href;
   const doc=await pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,maxImageSize:MAX_PIXELS,wasmUrl:new URL('vendor/pdf-wasm/',location.href).href,standardFontDataUrl:new URL('vendor/pdf-fonts/',location.href).href,cMapUrl:new URL('vendor/pdf-cmaps/',location.href).href,cMapPacked:true}).promise.catch((e:unknown)=>{const name=(e as {name?:string})?.name;throw Error(name==='PasswordException'?'This PDF is password-protected. Remove the password and import it again.':`This PDF could not be read (${e instanceof Error?e.message.replace(/\.$/,''):'damaged file'}). Re-export it from CAD or print it to a new PDF.`);});
   const abortPdf=()=>{void doc.destroy();};signal.addEventListener('abort',abortPdf);
   try {
    pages=doc.numPages;if(pages>SCHEMATIC_LIMITS.pages)throw Error(`PDF exceeds ${SCHEMATIC_LIMITS.pages} pages. Split the drawing set.`);
    for(let n=1;n<=pages;n++){
     check();percent=(n-1)/pages*100;say(`Reading drawing text · page ${n} of ${pages}`);
     const page=await doc.getPage(n),viewport=page.getViewport({scale:1}),content=await page.getTextContent();let found:Token[]=[];
     for(const item of content.items){if(!('str' in item)||!item.str.trim())continue;
      // Page rotation and the text matrix together give position, direction and height on the sheet as seen.
      const m=pdfjs.Util.transform(viewport.transform,item.transform) as number[],[a=1,b=0,c=0,d=1,e=0,f=0]=m;
      found.push({text:item.str,x:e,y:f,h:Math.hypot(c,d)||1,w:Math.abs(item.width)*viewport.scale,angle:Math.atan2(-b,a)*180/Math.PI,page:n});
      if(found.length>SCHEMATIC_LIMITS.pageTokens)throw Error(`Page ${n} has more than ${SCHEMATIC_LIMITS.pageTokens.toLocaleString('en')} text items. Split the drawing.`);}
     const ocr=sparse(found),scale=Math.min(ocr?3:2,(ocr?OCR_SIDE:TRACE_SIDE)/Math.max(viewport.width,viewport.height,1)),view=page.getViewport({scale}),canvas=document.createElement('canvas');
     canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);await page.render({canvas,viewport:view}).promise;check();
     if(ocr){
      // No text layer (scanned, or CAD text drawn as lines): read the rendered page with OCR and trace it.
      const read=await readDrawingImage(pixels(canvas),n,recognise,say,check);found=read.tokens;geometry.set(n,read.geometry);text.push(...read.lines);ocrPages++;
     } else {
      // Vector text: trace the rendered line work, then bring it back to the text layer's units.
      say(`Tracing busbars and feeders · page ${n} of ${pages}`);const hs=found.map(t=>t.h).sort((p,q)=>p-q),th=(hs[Math.floor(hs.length/2)]??8)*scale;
      geometry.set(n,scaleGeometry(traceLines(pixels(canvas),found.map(t=>tokenBox(t,scale)),th),1/scale));text.push(...textLines(found));
     }
     canvas.width=0;canvas.height=0;for(const t of found)tokens.push(t);page.cleanup();
     if(tokens.length>SCHEMATIC_LIMITS.tokens)throw Error(`The drawing set has more than ${SCHEMATIC_LIMITS.tokens.toLocaleString('en')} text items. Import fewer sheets at a time.`);
    }
   } finally {signal.removeEventListener('abort',abortPdf);await doc.destroy();}
  } else {
   const type=checkImage(new Uint8Array(bytes));
   const bitmap=await createImageBitmap(new Blob([bytes],{type})).catch(()=>{throw Error('The image could not be decoded.');});
   try {
    if(bitmap.width>MAX_SIDE||bitmap.height>MAX_SIDE||bitmap.width*bitmap.height>MAX_PIXELS)throw Error(`The image is larger than ${MAX_SIDE.toLocaleString('en')} px or 60 megapixels. Scale it down first.`);
    // Small screenshots are enlarged for OCR; large scans keep their resolution within the working budget.
    const scale=Math.min(2,Math.max(TRACE_SIDE/Math.max(bitmap.width,bitmap.height),1),Math.sqrt(WORK_PIXELS/(bitmap.width*bitmap.height))),canvas=draw(bitmap,bitmap.width,bitmap.height,scale);
    const read=await readDrawingImage(pixels(canvas),1,recognise,say,check);tokens=read.tokens;geometry.set(1,read.geometry);text.push(...read.lines);ocrPages=1;canvas.width=0;canvas.height=0;
   } finally {bitmap.close();}
  }
  check();percent=96;say('Grouping circuits');
  if(!tokens.length)throw Error('No readable text was found in this drawing. Try a clearer scan or a PDF exported from CAD.');
  const result=extractLoadList(tokens,geometry);percent=100;say(`${result.candidates.length} circuits found`);
  return {...result,file:file.name,pages,ocrPages,text:text.slice(0,400)};
 } finally {signal.removeEventListener('abort',stop);scratch.width=0;scratch.height=0;await worker?.terminate();}
}
