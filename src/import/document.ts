import { createWorker, type Worker } from 'tesseract.js';
import ExcelJS from 'exceljs';
import { checkZip,checkImage } from './guard';
import { parseTable,parseDelimited,extractCandidates,extractPositionedTable,ocrLines,type PositionedLine } from './parse';
import type { Catalogue,PageEvidence } from '../store/schema';

export type Progress={message:string;percent:number};
async function loadPdf(bytes:ArrayBuffer) {
  const pdfjs:typeof import('pdfjs-dist')=await import(/* @vite-ignore */new URL('vendor/pdf.mjs',location.href).href);
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf.worker.mjs',location.href).href;
  return pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,maxImageSize:60e6,wasmUrl:new URL('vendor/pdf-wasm/',location.href).href,standardFontDataUrl:new URL('vendor/pdf-fonts/',location.href).href,cMapUrl:new URL('vendor/pdf-cmaps/',location.href).href,cMapPacked:true}).promise;
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
export const MAX_DOCUMENT=100*1024*1024,MAX_PAGES=1500;
// layout: each text page's lines with item positions, for reading rating tables by column (not stored with the project).
// Cable-rating extraction (rows) runs only for cable catalogues; equipment datasheets have their own readers.
export async function readCatalogue(file:File,onProgress:(p:Progress)=>void,signal:AbortSignal,kind:'cables'|'equipment'='cables'):Promise<Catalogue&{layout:Map<number,PositionedLine[]>}> {
  if(file.size>MAX_DOCUMENT)throw Error('File exceeds 100 MB. Split the catalogue before uploading.');
  if(file.size===0)throw Error('This file is empty.');
  const ext=file.name.split('.').pop()?.toLowerCase();
  if(!ext||!['pdf','png','jpg','jpeg','webp','csv','txt','xlsx'].includes(ext))throw Error('Supported files: PDF, PNG, JPG, WebP, TXT, CSV and XLSX.');
  const bytes=await file.arrayBuffer();
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const sha256=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
  const result:Catalogue&{layout:Map<number,PositionedLine[]>}={layout:new Map(),id:crypto.randomUUID(),name:file.name,sha256,pages:[],rows:[],preparer:'',reviewer:'',verified:false,demo:false,sourceKind:'manufacturer',factorData:null};
  const check=()=>{if(signal.aborted)throw Error('Import cancelled.');};check();
  let worker:Worker|undefined;
  // toPoint turns the image's pixels into page points, so a scanned table keeps word positions for the table reader and the page view.
  const ocr=async(image:HTMLCanvasElement|File,page:number,total:number,toPoint?:(x:number,y:number)=>number[]):Promise<PageEvidence>=>{
    onProgress({message:`Reading image · page ${page} of ${total}`,percent:(page-1)/total*100});
    worker??=await createWorker('eng',1,{workerPath:new URL('vendor/ocr/worker.min.js',location.href).href,corePath:new URL('vendor/ocr/',location.href).href,langPath:new URL('vendor/ocr/',location.href).href,workerBlobURL:false,logger:(m:{status:string;progress:number})=>{onProgress({message:`OCR · ${m.status} · page ${page}/${total}`,percent:((page-1)+(m.progress||0))/total*100});}});
    check();const {data}=await worker.recognize(image,{},{text:true,blocks:true});check();
    const words=(data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)));
    const height=Math.max(0,...words.map(w=>w.bbox.y1)),lines=ocrLines(words,toPoint??((x,y)=>[x,height-y]));
    if(lines.length)result.layout.set(page,lines);
    return {page,text:data.text,mode:'ocr',confidence:data.confidence};
  };
  const abort=()=>{void worker?.terminate();};signal.addEventListener('abort',abort);
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
      const doc=await loadPdf(bytes);
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
          else {result.pages.push({page:number,text,mode:'text',confidence:null});result.layout.set(number,positioned);if(kind==='cables')result.rows.push(...extractPositionedTable(positioned,number,file.name));}
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
  } finally {signal.removeEventListener('abort',abort);await worker?.terminate();}
}
