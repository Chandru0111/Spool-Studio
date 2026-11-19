import {lineMask,findLines,rotate,fromRotated,overlap,clearBoxes,traceFeeders,toGray,type Rgba,type Box,type Geometry} from './raster';
import type {Token} from './schematic';

// Reads a drawing image (scan, screenshot, or a PDF page without a text layer): reads words in three orientations (labels
// along vertical drops are common) on the page as drawn, since PaddleOCR finds text among line work and erasing lines
// would cut letters (B, D and R look like boxes), then traces busbars and feeders on the line work with the words masked out. The OCR engine is passed in, so tests can run it in Node.
export type Word={text:string;confidence:number;bbox:Box};
export type Recognise=(img:Rgba,label:string)=>Promise<Word[]>;
export type DrawingRead={tokens:Token[];geometry:Geometry;textHeight:number;lines:string[]};
const TILE=3000,OVERLAP=160;
const crop=(img:Rgba,x:number,y:number,w:number,h:number):Rgba=>{const data=new Uint8ClampedArray(w*h*4);for(let r=0;r<h;r++)data.set(img.data.subarray(((y+r)*img.width+x)*4,((y+r)*img.width+x+w)*4),r*w*4);return {width:w,height:h,data};};
// Large sheets are read in overlapping tiles so small text is not lost to downscaling. Each word is kept from the tile
// that owns its centre (tiles meet halfway across their overlap), so a word clipped at a tile edge is not read twice.
async function tiled(img:Rgba,label:string,recognise:Recognise,check:()=>void):Promise<Word[]> {
 if(img.width<=TILE&&img.height<=TILE)return recognise(img,label);
 const out:Word[]=[],step=TILE-OVERLAP,xs=Math.ceil((img.width-OVERLAP)/step),ys=Math.ceil((img.height-OVERLAP)/step);
 const at=(t:number,size:number)=>Math.min(t*step,Math.max(0,size-TILE)),from=(t:number,size:number)=>t?(at(t,size)+at(t-1,size)+TILE)/2:-Infinity,to=(t:number,n:number,size:number)=>t<n-1?from(t+1,size):Infinity;
 for(let ty=0;ty<ys;ty++)for(let tx=0;tx<xs;tx++){check();const x=at(tx,img.width),y=at(ty,img.height),w=Math.min(TILE,img.width-x),h=Math.min(TILE,img.height-y);
  for(const word of await recognise(crop(img,x,y,w,h),`${label}, part ${ty*xs+tx+1} of ${xs*ys}`)){const b={x0:word.bbox.x0+x,y0:word.bbox.y0+y,x1:word.bbox.x1+x,y1:word.bbox.y1+y},cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2;
   if(cx>=from(tx,img.width)&&cx<to(tx,xs,img.width)&&cy>=from(ty,img.height)&&cy<to(ty,ys,img.height))out.push({...word,bbox:b});}}
 return out;
}
// OCR noise from symbols ("Ql", "<a", "=20"): short words count only when they are known drawing abbreviations,
// carry a digit, or read as a clean capitalised word with good confidence.
const SHORT=new Set(['kv','kw','hp','ft','hz','mm','mm2','pf','va','kva','mva','mw','cu','al','db','lp','pp','tp','sp','dp','tpn','spn','mcb','acb','rcd','swa','awa','pvc','sub','aux','bus','oil','gas','arc','fan','ups','ats','gen','mcc','msb','pdb','ldb','smdb','to','of','no','and','&','km','pe','ac','dc','vfd','vsd','dol','pump','unit']);
export function useful(text:string,confidence:number):boolean {
 if(text==='&')return true;
 const t=text.replace(/^[^A-Za-z0-9(]+|[^A-Za-z0-9%)."']+$/g,'');if(!t||!/[A-Za-z0-9]/.test(t))return false;
 const letters=t.replace(/[^A-Za-z]/g,''),core=t.toLowerCase().replace(/[^a-z0-9&]/g,'');
 if(/\d/.test(t))return !/^[^A-Za-z0-9]*\d?[^A-Za-z0-9]+$/.test(t)&&!(/^[=<>~_\-]/.test(text)&&t.length<=3);
 if(SHORT.has(core))return true;
 if(letters.length<=2)return false;
 return letters.length>=4?confidence>=50:/^[A-Z][a-z]+$|^[A-Z]+$/.test(t)&&confidence>=75;
}
const score=(w:{text:string;confidence:number})=>w.confidence*Math.min(w.text.replace(/[^A-Za-z0-9]/g,'').length,6);
export async function readDrawingImage(img:Rgba,page:number,recognise:Recognise,progress:(m:string)=>void,check:()=>void):Promise<DrawingRead> {
 const gray=toGray(img);
 type Found={text:string;confidence:number;box:Box;token:Token;single?:boolean};
 const found:Found[]=[];
 // A lone capital letter is kept only when it follows a word on the same line ("Compressor B", "63 A"); symbols read
 // as letters ("C" for a motor circle) stand apart and are dropped below.
 const single=(text:string,confidence:number)=>/^[A-Z]$/.test(text)&&confidence>=55;
 progress('Reading horizontal text');
 for(const w of await tiled(img,'horizontal text',recognise,check)){const text=w.text.trim(),one=single(text,w.confidence);if(one||w.confidence>=45&&useful(text,w.confidence))found.push({text,confidence:w.confidence,box:w.bbox,single:one,token:{text,x:w.bbox.x0,y:w.bbox.y1,w:w.bbox.x1-w.bbox.x0,h:Math.max(1,w.bbox.y1-w.bbox.y0),angle:0,page}});}
 for(const dir of ['cw','ccw'] as const){
  check();progress(dir==='cw'?'Reading text that runs upwards':'Reading text that runs downwards');
  for(const w of await tiled(rotate(img,dir),'vertical text',recognise,check)){const text=w.text.trim(),one=single(text,w.confidence);if(!one&&(w.confidence<70||!useful(text,w.confidence)))continue;
   const r=fromRotated(w.bbox,dir,img.width,img.height),cand={text,confidence:w.confidence,box:r.box,single:one,token:{text,x:r.x,y:r.y,w:r.w,h:Math.max(1,r.h),angle:r.angle,page}};
   // The same ink read twice (once upright, once turned): keep the better reading.
   const clash=found.findIndex(f=>overlap(f.box,r.box)>=.5);if(clash<0)found.push(cand);else if(score(cand)>score(found[clash]!))found[clash]=cand;}
 }
 const along=(k:Token)=>{const a=k.angle*Math.PI/180;return k.x*Math.cos(a)-k.y*Math.sin(a);},across=(k:Token)=>{const a=k.angle*Math.PI/180;return k.x*Math.sin(a)+k.y*Math.cos(a);};
 for(let i=found.length-1;i>=0;i--){const f=found[i]!;if(!f.single)continue;const k=f.token;
  if(!found.some(o=>!o.single&&o.token.angle===k.angle&&k.h<=1.2*o.token.h&&Math.abs(across(o.token)-across(k))<=.4*o.token.h&&along(k)-(along(o.token)+o.token.w)>=-.3*k.h&&along(k)-(along(o.token)+o.token.w)<=1.05*o.token.h))found.splice(i,1);}
 const heights=found.filter(f=>f.token.angle===0).map(f=>f.token.h).sort((a,b)=>a-b),textHeight=heights[Math.floor(heights.length/2)]??Math.max(10,img.height/80);
 // Line work without the words: busbars and the feeders that hang from them.
 check();progress('Tracing busbars and feeders');
 const geometry=traceLines(img,found.map(f=>f.box),textHeight,gray);
 // The text panel: upright words grouped into lines by their centre height, each line read left to right.
 const lines:Found[][]=[];
 for(const f of found.filter(f=>f.token.angle===0).sort((a,b)=>(a.box.y0+a.box.y1)-(b.box.y0+b.box.y1))){const line=lines[lines.length-1],mid=(f.box.y0+f.box.y1)/2;if(line&&Math.abs(mid-(line[0]!.box.y0+line[0]!.box.y1)/2)<textHeight*.5)line.push(f);else lines.push([f]);}
 const text=[...lines.map(l=>l.sort((a,b)=>a.box.x0-b.box.x0).map(f=>f.text).join(' ')),...found.filter(f=>f.token.angle!==0).map(f=>f.text)];
 return {tokens:found.map(f=>f.token),geometry,textHeight,lines:text.slice(0,400)};
}

// Busbars and feeders from a rendered page or image, with the text areas blanked so letters are not taken for lines.
export function traceLines(img:Rgba,textBoxes:readonly Box[],textHeight:number,gray=toGray(img)):Geometry {
 return traceFeeders(findLines(clearBoxes(lineMask(img,gray),textBoxes,3),Math.max(10,Math.round(textHeight*.9))),textHeight,img.width);
}
// The box a text item covers on the sheet (rotated text included).
export function tokenBox(t:Token,k=1):Box {
 const a=t.angle*Math.PI/180,ux=Math.cos(a),uy=-Math.sin(a),nx=Math.sin(a),ny=Math.cos(a),xs=[t.x,t.x+ux*t.w,t.x-nx*t.h,t.x+ux*t.w-nx*t.h],ys=[t.y,t.y+uy*t.w,t.y-ny*t.h,t.y+uy*t.w-ny*t.h];
 return {x0:Math.min(...xs)*k,y0:Math.min(...ys)*k,x1:Math.max(...xs)*k,y1:Math.max(...ys)*k};
}
export const scaleGeometry=(g:Geometry,k:number):Geometry=>({buses:g.buses.map(s=>({x0:s.x0*k,y0:s.y0*k,x1:s.x1*k,y1:s.y1*k,t:s.t*k})),feeders:g.feeders.map(f=>({...f,points:f.points.map(([x,y])=>[x*k,y*k] as [number,number]),end:[f.end[0]*k,f.end[1]*k] as [number,number]}))});
