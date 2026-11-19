import ExcelJS from 'exceljs';
import { checkZip,checkImage } from './guard';
import { parseTable,parseDelimited,extractCandidates,extractPositionedTable,ocrLines,rulesOf,type PositionedLine,type Rule } from './parse';
import type { Catalogue,PageEvidence } from '../store/schema';
import { paddleOcr,type Image } from './ocr';

export type Progress={message:string;percent:number};
async function pdfModule() {
  const pdfjs:typeof import('pdfjs-dist')=await import(/* @vite-ignore */new URL('vendor/pdf.mjs',location.href).href);
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf.worker.mjs',location.href).href;
  return pdfjs;
}
async function loadPdf(bytes:ArrayBuffer) {
  return (await pdfModule()).getDocument({data:new Uint8Array(bytes),isEvalSupported:false,maxImageSize:60e6,wasmUrl:new URL('vendor/pdf-wasm/',location.href).href,standardFontDataUrl:new URL('vendor/pdf-fonts/',location.href).href,cMapUrl:new URL('vendor/pdf-cmaps/',location.href).href,cMapPacked:true}).promise;
}
// The PDF being reviewed stays open so its pages can be shown with the values read from them; closePage releases it.
let shown:{file:File;doc:ReturnType<typeof loadPdf>}|null=null;
export function closePage(){void shown?.doc.then(d=>d.destroy(),()=>undefined);shown=null;}
// Draws one page onto the canvas and returns a mapper from PDF points to canvas pixels.
export async function renderPage(file:File,number:number,canvas:HTMLCanvasElement,width:number):Promise<(r:[number,number,number,number])=>number[]> {
  if(shown?.file!==file){closePage();shown={file,doc:file.arrayBuffer().then(loadPdf)};}
  const page=await (await shown.doc).getPage(number),viewport=page.getViewport({scale:width/page.getViewport({scale:1}).width});
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  try{await page.render({canvas,viewport}).promise;}finally{page.cleanup();}
  return r=>viewport.convertToViewportRectangle(r);
}
// The OCR reader (PaddleOCR on ONNX Runtime), loaded from the site's own files on first use. Inference runs in ONNX
// Runtime's worker so the page stays responsive, on several threads where the site is cross-origin isolated (the
// Cross-Origin-Opener/Embedder-Policy headers).
export async function ocrReader() {
  const base=new URL('vendor/ocr/',location.href).href;
  const ort:typeof import('onnxruntime-web')=await import(/* @vite-ignore */base+'ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths=base;ort.env.wasm.proxy=true;ort.env.logLevel='error';
  return paddleOcr(ort,async name=>{const r=await fetch(base+name);if(!r.ok)throw Error(`The OCR model ${name} could not be loaded.`);return r.arrayBuffer();});
}
// A canvas or an image file as RGBA pixels.
export async function imagePixels(source:HTMLCanvasElement|Blob):Promise<Image> {
  let canvas=source as HTMLCanvasElement;
  if(source instanceof Blob){const bitmap=await createImageBitmap(source);canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d')?.drawImage(bitmap,0,0);bitmap.close();}
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('This browser cannot prepare the image for reading.');
  return ctx.getImageData(0,0,canvas.width,canvas.height);
}
export const MAX_DOCUMENT=100*1024*1024,MAX_PAGES=1500;
// layout: each text page's lines with item positions, for reading rating tables by column (not stored with the project).
// rules: for equipment datasheets, the table borders and shaded cells drawn on each page that holds a table.
// Cable-rating extraction (rows) runs only for cable catalogues; equipment datasheets have their own readers.
type Read=Catalogue&{layout:Map<number,PositionedLine[]>;rules:Map<number,Rule[]>};
export async function readCatalogue(file:File,onProgress:(p:Progress)=>void,signal:AbortSignal,kind:'cables'|'equipment'='cables'):Promise<Read> {
  if(file.size>MAX_DOCUMENT)throw Error('File exceeds 100 MB. Split the catalogue before uploading.');
  if(file.size===0)throw Error('This file is empty.');
  const ext=file.name.split('.').pop()?.toLowerCase();
  if(!ext||!['pdf','png','jpg','jpeg','webp','csv','txt','xlsx'].includes(ext))throw Error('Supported files: PDF, PNG, JPG, WebP, TXT, CSV and XLSX.');
  const bytes=await file.arrayBuffer();
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const sha256=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
  const result:Read={layout:new Map(),rules:new Map(),id:crypto.randomUUID(),name:file.name,sha256,pages:[],rows:[],preparer:'',reviewer:'',verified:false,demo:false,sourceKind:'manufacturer',factorData:null};
  const check=()=>{if(signal.aborted)throw Error('Import cancelled.');};check();
  let reader:Awaited<ReturnType<typeof ocrReader>>|undefined;
  // toPoint turns the image's pixels into page points, so a scanned table keeps word positions for the table reader and the page view.
  const ocr=async(image:HTMLCanvasElement|File,page:number,total:number,toPoint?:(x:number,y:number)=>number[]):Promise<PageEvidence>=>{
    onProgress({message:`Reading image · page ${page} of ${total}`,percent:(page-1)/total*100});
    reader??=await ocrReader();check();
    const img=await imagePixels(image);
    const {words,confidence}=await reader.read(img,check,(done,all)=>onProgress({message:`OCR · page ${page} of ${total} · line ${done} of ${all}`,percent:((page-1)+done/all)/total*100}));
    const lines=ocrLines(words,toPoint??((x,y)=>[x,img.height-y]));
    if(lines.length)result.layout.set(page,lines);
    return {page,text:lines.map(l=>l.cells.map(c=>c.text).join('  ')).join('\n'),mode:'ocr',confidence};
  };
  try {
    if(ext==='csv'||ext==='txt') {
      const text=new TextDecoder().decode(bytes);check();
      if(ext==='csv')result.rows=parseTable(parseDelimited(text),file.name);
      result.pages=[{page:1,text,mode:ext==='csv'?'table':'text',confidence:null}];
    } else if(ext==='xlsx') {
      checkZip(bytes);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
      const sheet=workbook.worksheets[0];if(!sheet)throw Error('Workbook has no worksheets.');
      const cells:string[][]=[];
      if(sheet.rowCount>5001)throw Error('Workbook exceeds 5,000 data rows.');
      sheet.eachRow(row=>{const values:string[]=[];row.eachCell({includeEmpty:true},cell=>{const v=cell.value;values.push(typeof v==='string'||typeof v==='number'?String(v):'');});cells.push(values);});
      result.rows=parseTable(cells,file.name);result.pages=[{page:1,text:cells.map(r=>r.join(' | ')).join('\n'),mode:'table',confidence:null}];
    } else if(ext==='pdf') {
      if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('The file is not a valid PDF.');
      const doc=await loadPdf(bytes),{OPS}=await pdfModule();
      const abortPdf=()=>{void doc.destroy();};signal.addEventListener('abort',abortPdf);
      try {
        // shortcut: pages are read one at a time and only their text is kept; past MAX_PAGES split the file.
        if(doc.numPages>MAX_PAGES)throw Error(`PDF exceeds ${MAX_PAGES.toLocaleString('en')} pages. Split it into smaller sections.`);
        const sparse:number[]=[];
        for(let number=1;number<=doc.numPages;number++) {
          check();onProgress({message:`Text reader · page ${number} of ${doc.numPages}`,percent:(number-1)/doc.numPages*100});
          const page=await doc.getPage(number);const content=await page.getTextContent();
          const lines=new Map<number,{x:number;w:number;h:number;y:number;text:string}[]>();
          for(const item of content.items) if('str' in item&&item.str.trim()) {const y=Math.round((item.transform[5]??0)/3)*3;const line=lines.get(y)??[];line.push({x:item.transform[4]??0,w:item.width||0,h:item.height||0,y:item.transform[5]??0,text:item.str});lines.set(y,line);}
          const positioned=[...lines.entries()].sort((a,b)=>b[0]-a[0]).map(([,line])=>({cells:line.sort((a,b)=>a.x-b.x)}));
          const text=positioned.map(line=>line.cells.map(x=>x.text).join('  ')).join('\n');
          if(number<=3 && /(?:COMMITTEE DRAFT|Draft for Public Comment|INTERNATIONAL STANDARD)/i.test(text)&&/60364/.test(text))throw Error('This is an IEC reference document, not a manufacturer catalogue. Use the separate IEC reference library.');
          if(text.replace(/\s/g,'').length<60)sparse.push(number);
          else {result.pages.push({page:number,text,mode:'text',confidence:null});result.layout.set(number,positioned);if(kind==='cables')result.rows.push(...extractPositionedTable(positioned,number,file.name));
            // Drawn borders mark where a table's columns start and end; only pages with rows of figures are worth the drawing pass.
            else if(positioned.filter(l=>l.cells.filter(c=>/^\s*-?\d+(?:[.,]\d+)?\s*$/.test(c.text)).length>=3).length>=2){const ops=await page.getOperatorList();result.rules.set(number,rulesOf(ops.fnArray,ops.argsArray,OPS));}}
          page.cleanup();
        }
        // Pages without a text layer are scans when most of the file is (or there are only a few); in a long typed catalogue they are photos and drawings, not worth minutes of OCR.
        if(sparse.length<=5||sparse.length*2>doc.numPages)for(const number of sparse) {
          check();const page=await doc.getPage(number);
          const viewport=page.getViewport({scale:Math.min(2,2200/Math.max(page.view[2]??600,page.view[3]??800))});
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          await page.render({canvas,viewport}).promise;result.pages.push(await ocr(canvas,number,doc.numPages,(x,y)=>viewport.convertToPdfPoint(x,y)));canvas.width=0;canvas.height=0;
          page.cleanup();
        }
        result.pages.sort((a,b)=>a.page-b.page);
      } finally {signal.removeEventListener('abort',abortPdf);await doc.destroy();}
    } else {checkImage(new Uint8Array(bytes));result.pages=[await ocr(file,1,1)];}
    check();const tablePages=new Set(result.rows.map(r=>r.page));
    if(kind==='cables')result.rows.push(...extractCandidates(result.pages.filter(p=>!tablePages.has(p.page)),file.name));
    if(result.pages.every(p=>!p.text.trim()))throw Error('No readable text was found. Try a clearer scan or a structured CSV.');
    onProgress({message:`${result.rows.length} candidates ready for review`,percent:100});return result;
  } finally {await reader?.close();}
}
