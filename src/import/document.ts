import ExcelJS from 'exceljs';
import { checkZip,checkImage } from './guard';
import { parseTable,parseDelimited,extractCandidates,extractPositionedTable,ocrLines,rulesOf,pdfLines,phrases,hasFigureRows,type PositionedLine,type Rule } from './parse';
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
const opened=(file:File)=>{if(shown?.file!==file){closePage();shown={file,doc:file.arrayBuffer().then(loadPdf)};}return shown.doc;};
// How many pages a PDF has, opened for choosing which to read; the pages shown while choosing reuse it.
export async function pageCount(file:File):Promise<number> {
  if(file.size>MAX_DOCUMENT)throw Error('File exceeds 100 MB. Split the catalogue before uploading.');
  if(new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw Error('The file is not a valid PDF.');
  return (await opened(file)).numPages;
}
// "3, 12-14, 40–45" as page numbers in order; a word or a page outside the document is an error.
export function pageList(text:string,total:number):number[] {
  const out=new Set<number>();
  for(const part of text.split(/[,;]/).map(s=>s.trim()).filter(Boolean)){
    const m=/^(\d+)(?:\s*[-–—]\s*(\d+))?$/.exec(part);if(!m)throw Error(`"${part}" is not a page or a range like 12-14.`);
    const a=Number(m[1]),b=Number(m[2]??m[1]);if(a<1||a>b||b>total)throw Error(`"${part}" is outside pages 1 to ${total}.`);
    for(let n=a;n<=b;n++)out.add(n);
  }
  return [...out].sort((x,y)=>x-y);
}
// Page numbers written back as ranges: [3, 12, 13, 14] gives "3, 12-14".
export function rangesOf(pages:readonly number[]):string {
  const sorted=[...new Set(pages)].sort((x,y)=>x-y),out:string[]=[];
  for(let i=0;i<sorted.length;){let j=i;while(sorted[j+1]===sorted[j]!+1)j++;out.push(j>i?`${sorted[i]}-${sorted[j]}`:`${sorted[i]}`);i=j+1;}
  return out.join(', ');
}
// Draws one page onto the canvas and returns a mapper from PDF points to canvas pixels.
export async function renderPage(file:File,number:number,canvas:HTMLCanvasElement,width:number):Promise<(r:[number,number,number,number])=>number[]> {
  const page=await (await opened(file)).getPage(number),viewport=page.getViewport({scale:width/page.getViewport({scale:1}).width});
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
// pages: only these PDF pages are read (the engineer picked them); their scanned pages are always OCR'd.
type Read=Catalogue&{layout:Map<number,PositionedLine[]>;rules:Map<number,Rule[]>};
export async function readCatalogue(file:File,onProgress:(p:Progress)=>void,signal:AbortSignal,kind:'cables'|'equipment'='cables',pages?:readonly number[]):Promise<Read> {
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
        const list=pages?pages.filter(n=>n>=1&&n<=doc.numPages):Array.from({length:doc.numPages},(_,i)=>i+1);
        if(list.length>MAX_PAGES)throw Error(`PDF exceeds ${MAX_PAGES.toLocaleString('en')} pages. Split it into smaller sections.`);
        const sparse:number[]=[];
        for(const [k,number] of list.entries()) {
          check();onProgress({message:`Text reader · page ${number}${pages?` (${k+1} of ${list.length})`:` of ${doc.numPages}`}`,percent:k/list.length*100});
          const page=await doc.getPage(number),{lines:positioned,text:items}=pdfLines((await page.getTextContent()).items);
          if(number<=3 && /(?:COMMITTEE DRAFT|Draft for Public Comment|INTERNATIONAL STANDARD)/i.test(items)&&/60364/.test(items))throw Error('This is an IEC reference document, not a manufacturer catalogue. Use the separate IEC reference library.');
          if(items.replace(/\s/g,'').length<60)sparse.push(number);
          else {
            if(kind==='cables')result.rows.push(...extractPositionedTable(positioned,number,file.name));
            // Drawn borders mark where a table's columns start and end; only pages with rows of figures are worth the drawing pass.
            else if(hasFigureRows(positioned)){const ops=await page.getOperatorList();result.rules.set(number,rulesOf(ops.fnArray,ops.argsArray,OPS));}
            // An equipment datasheet's text is read in phrases, as the page sets them out; a cable catalogue's item by item.
            result.pages.push({page:number,text:kind==='cables'?items:phrases(positioned,result.rules.get(number)),mode:'text',confidence:null});result.layout.set(number,positioned);
          }
          page.cleanup();
        }
        // Pages without a text layer are scans when most of the file is (or there are only a few); in a long typed catalogue they are photos and drawings, not worth minutes of OCR.
        if(pages||sparse.length<=5||sparse.length*2>doc.numPages)for(const number of sparse) {
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
