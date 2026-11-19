// Reading scanned pages with PaddleOCR's PP-OCRv5 mobile models (Apache-2.0) on ONNX Runtime Web, all in the browser:
// one model finds the lines of text on the page, then a reader turns each line into characters. There are readers for
// Latin-script languages (English, German, French, Spanish, Italian, Portuguese, Dutch, Polish, Turkish…), Cyrillic
// and Chinese; each page goes to the reader that is most confident on it. Steps follow PaddleOCR's own pipeline
// (DB text detection, CTC decoding) with its published settings.
import type * as Ort from 'onnxruntime-web';

export type Image={data:Uint8ClampedArray|Uint8Array;width:number;height:number};
type Box={x0:number;y0:number;x1:number;y1:number};
export type OcrWord={text:string;score:number;bbox:{x0:number;y0:number;x1:number;y1:number}};
export const READERS=['latin','cyrillic','chinese'] as const;
type Reader=typeof READERS[number];

// The characters a reader writes, from the character_dict list in its inference.yml; index 0 is CTC's blank.
export function charList(yml:string):string[] {
 const out:string[]=[];let on=false;
 for(const line of yml.split('\n')){
  if(!on){on=/^\s*character_dict:\s*$/.test(line);continue;}
  const m=/^\s*-\s(.*)$/.exec(line);if(!m)break;
  const v=m[1]!;out.push(v.startsWith("'")?v.slice(1,-1).replace(/''/g,"'"):v.startsWith('"')?JSON.parse(v) as string:v);
 }
 return out;
}

// Text regions from the detector's probability map (DB post-processing): pixels above thresh joined into regions, kept
// when the region's box averages at least boxThresh, then grown by area × unclip / perimeter as the model was trained to.
export function textBoxes(prob:ArrayLike<number>,w:number,h:number,{thresh=0.3,boxThresh=0.6,unclip=1.5,minSize=3}={}):{x0:number;y0:number;x1:number;y1:number;score:number}[] {
 const seen=new Uint8Array(w*h),stack=new Int32Array(w*h),out:{x0:number;y0:number;x1:number;y1:number;score:number}[]=[];
 for(let i=0;i<w*h&&out.length<3000;i++){
  if(seen[i]||prob[i]!<=thresh)continue;
  let top=0,x0=w,x1=0,y0=h,y1=0;stack[top++]=i;seen[i]=1;
  while(top){
   const j=stack[--top]!,x=j%w,y=(j-x)/w;
   if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
   for(const k of [x>0?j-1:-1,x<w-1?j+1:-1,y>0?j-w:-1,y<h-1?j+w:-1])if(k>=0&&!seen[k]&&prob[k]!>thresh){seen[k]=1;stack[top++]=k;}
  }
  const bw=x1-x0+1,bh=y1-y0+1;if(Math.min(bw,bh)<minSize)continue;
  let sum=0;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)sum+=prob[y*w+x]!;
  const score=sum/(bw*bh);if(score<boxThresh)continue;
  const d=bw*bh*unclip/(2*(bw+bh));
  out.push({x0:Math.max(0,x0-d),y0:Math.max(0,y0-d),x1:Math.min(w,x1+1+d),y1:Math.min(h,y1+1+d),score});
 }
 return out;
}

// Greedy CTC decoding: the likeliest character per step, repeats merged, blanks dropped; the score is their mean probability.
export function ctcDecode(probs:ArrayLike<number>,steps:number,classes:number,chars:readonly string[],from=0):{text:string;score:number} {
 let text='',sum=0,n=0,last=-1;
 for(let t=0;t<steps;t++){
  let best=0,p=-Infinity;for(let c=0;c<classes;c++){const v=probs[from+t*classes+c]!;if(v>p){p=v;best=c;}}
  if(best!==0&&best!==last){text+=chars[best]??'';sum+=p;n++;}
  last=best;
 }
 return {text,score:n?sum/n:0};
}
// The printed parts of a detected line, split at blank gaps wider than half its letters' height: the detector joins
// column headings and cells printed close together ("Frame Size   Rated Power", "OMT2   80K2"), and each column's
// words need a box of their own. Boxes are the printed extent (the detector's carry a margin that would make
// neighbouring cells touch). Ink is any pixel well off the commonest shade (the background), so dark-on-light,
// light-on-dark and shaded cells all work; rows and columns that are nearly all ink are grid lines or cell edges.
export function inkParts(img:Image,box:Box):(Box&{bg:number})[] {
 const x0=Math.max(0,Math.floor(box.x0)),x1=Math.min(img.width,Math.ceil(box.x1)),ya=Math.max(0,Math.floor(box.y0)),yb=Math.min(img.height,Math.ceil(box.y1));
 const w=x1-x0,h=yb-ya;if(w<4||h<4)return [];
 const shade=new Float32Array(w*h),counts=new Uint32Array(32);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=((ya+y)*img.width+x0+x)*4,g=(img.data[i]!+img.data[i+1]!+img.data[i+2]!)/3;shade[y*w+x]=g;const k=Math.min(31,g>>3);counts[k]=counts[k]!+1;}
 const bg=counts.indexOf(Math.max(...counts))*8+4,off=(x:number,y:number)=>Math.abs(shade[y*w+x]!-bg)>48;
 const lineRow=new Uint8Array(h),lineCol=new Uint8Array(w);
 for(let y=0;y<h;y++){let n=0;for(let x=0;x<w;x++)if(off(x,y))n++;lineRow[y]=n>0.8*w?1:0;}
 const rows=h-lineRow.reduce((a,b)=>a+b,0);
 for(let x=0;x<w;x++){let n=0;for(let y=0;y<h;y++)if(!lineRow[y]&&off(x,y))n++;lineCol[x]=rows&&n>0.8*rows?1:0;}
 const ink=(x:number,y:number)=>!lineRow[y]&&!lineCol[x]&&off(x,y);
 // The letters' rows: those carrying a fair share of the ink (a neighbouring line's tips carry little).
 const band=(a:number,b:number)=>{
  const per:number[]=[];for(let y=0;y<h;y++){let n=0;for(let x=a;x<b;x++)if(ink(x,y))n++;per.push(n);}
  const peak=Math.max(...per),rows=per.flatMap((n,y)=>n>0&&n>=peak*0.2?[y]:[]);
  return rows.length?[rows[0]!,rows.at(-1)!+1] as const:undefined;
 };
 const letters=band(0,w);if(!letters)return [];
 const inked:boolean[]=[];for(let x=0;x<w;x++){let on=false;for(let y=letters[0];y<letters[1]&&!on;y++)on=ink(x,y);inked.push(on);}
 const parts:[number,number][]=[];let start=-1,gap=0;
 for(let i=0;i<=w;i++){
  if(i<w&&inked[i]){if(start<0)start=i;gap=0;continue;}
  if(start<0)continue;
  if(++gap>(letters[1]-letters[0])*0.5||i===w){parts.push([start,i-gap]);start=-1;gap=0;}
 }
 return parts.map(([a,b])=>{const r=band(a,b+1)??letters;return {x0:x0+a,x1:x0+b+1,y0:ya+r[0],y1:ya+r[1],bg};});
}
// A line's words shared out over its printed parts, in order, so that each part's share of the letters matches its
// share of the width. Undefined when there are fewer words than parts.
export function shareOut(text:string,widths:readonly number[]):string[]|undefined {
 const words=text.trim().split(/\s+/).filter(Boolean),k=widths.length;
 if(words.length<k||!k)return undefined;
 const len=words.map(w=>w.length+1),chars=len.reduce((a,b)=>a+b,0),width=widths.reduce((a,b)=>a+b,0);
 // best[j][i]: the least squared mismatch putting the first i words into the first j parts.
 const best=Array.from({length:k+1},()=>new Array<number>(words.length+1).fill(Infinity)),from=best.map(r=>r.map(()=>0));best[0]![0]=0;
 for(let j=1;j<=k;j++)for(let i=j;i<=words.length-(k-j);i++)for(let a=j-1;a<i;a++){
  const share=len.slice(a,i).reduce((x,y)=>x+y,0)/chars-widths[j-1]!/width,cost=best[j-1]![a]!+share*share;
  if(cost<best[j]![i]!){best[j]![i]=cost;from[j]![i]=a;}
 }
 const out:string[]=[];for(let j=k,i=words.length;j>0;j--){const a=from[j]![i]!;out.unshift(words.slice(a,i).join(' '));i=a;}
 return out;
}

// The image region as a 1×3×H×W tensor in the models' BGR channel order, resized by bilinear sampling and normalised;
// written into `out` from index `base`, starting `at` columns in, when given.
function tensorOf(img:Image,box:Box,outW:number,outH:number,padW:number,mean:readonly number[],std:readonly number[],out=new Float32Array(3*outH*padW),base=0,at=0):Float32Array {
 const sx=(box.x1-box.x0)/outW,sy=(box.y1-box.y0)/outH,plane=outH*padW,d=img.data,W=img.width;
 const xa=new Int32Array(outW),xb=new Int32Array(outW),xf=new Float32Array(outW);
 for(let x=0;x<outW;x++){const fx=Math.min(W-1,Math.max(0,box.x0+(x+0.5)*sx-0.5));xa[x]=Math.floor(fx);xb[x]=Math.min(W-1,xa[x]!+1);xf[x]=fx-xa[x]!;}
 // Pixel value v becomes (v/255 − mean)/std, per channel, with blue first.
 const k=[0,1,2].map(c=>1/(255*std[c]!)),m=[0,1,2].map(c=>mean[c]!/std[c]!);
 for(let y=0;y<outH;y++){
  const fy=Math.min(img.height-1,Math.max(0,box.y0+(y+0.5)*sy-0.5)),ya=Math.floor(fy),dy=fy-ya,ra=ya*W,rb=Math.min(img.height-1,ya+1)*W;
  for(let x=0;x<outW;x++){
   const dx=xf[x]!,a=(ra+xa[x]!)*4,b=(ra+xb[x]!)*4,c=(rb+xa[x]!)*4,e=(rb+xb[x]!)*4,w00=(1-dx)*(1-dy),w01=dx*(1-dy),w10=(1-dx)*dy,w11=dx*dy,o=base+y*padW+at+x;
   for(let ch=0;ch<3;ch++){const s=2-ch;out[ch*plane+o]=(d[a+s]!*w00+d[b+s]!*w01+d[c+s]!*w10+d[e+s]!*w11)*k[ch]!-m[ch]!;}
  }
 }
 return out;
}

// load fetches a model file by name (det.onnx, latin.onnx, latin.yml…) from the site's own vendor folder.
export function paddleOcr(ort:typeof Ort,load:(name:string)=>Promise<ArrayBuffer>) {
 const sessions=new Map<string,Promise<Ort.InferenceSession>>(),lists=new Map<Reader,Promise<string[]>>();
 const session=(name:string)=>{let s=sessions.get(name);if(!s){s=load(`${name}.onnx`).then(b=>ort.InferenceSession.create(b,{executionProviders:['wasm'],logSeverityLevel:3}));sessions.set(name,s);}return s;};
 const list=(r:Reader)=>{let l=lists.get(r);if(!l){l=load(`${r}.yml`).then(b=>charList(new TextDecoder().decode(b)));lists.set(r,l);}return l;};
 let preferred:Reader='latin';
 const run=async(s:Ort.InferenceSession,data:Float32Array,dims:number[])=>{const out=await s.run({[s.inputNames[0]!]:new ort.Tensor('float32',data,dims)});return out[s.outputNames[0]!]!;};
 // Lines are read in batches of up to 16 of one padded width: each is scaled to 48 px high and, as PaddleOCR does,
 // padded to at least 320 px wide (narrower padding misreads more: S as 5).
 const readLines=async(img:Image,boxes:readonly Box[],r:Reader,check:()=>void)=>{
  const s=await session(r),chars=await list(r),out:{text:string;score:number}[]=new Array(boxes.length);
  const sized=boxes.map((b,i)=>{const width=Math.min(3200,Math.max(1,Math.ceil(48*(b.x1-b.x0)/(b.y1-b.y0))));return {b,i,width,pad:Math.max(320,Math.ceil(width/32)*32)};}).sort((a,b)=>a.pad-b.pad);
  for(let k=0;k<sized.length;){
   const pad=sized[k]!.pad,batch=sized.slice(k,k+16).filter(x=>x.pad===pad);k+=batch.length;
   const size=3*48*pad,data=new Float32Array(batch.length*size);
   batch.forEach((x,j)=>tensorOf(img,x.b,x.width,48,pad,[0.5,0.5,0.5],[0.5,0.5,0.5],data,j*size));
   const res=await run(s,data,[batch.length,3,48,pad]);check();
   const [,steps=0,classes=0]=res.dims,table=['',...chars,...(classes===chars.length+2?[' ']:[])];
   batch.forEach((x,j)=>{out[x.i]=ctcDecode(res.data as Float32Array,steps,classes,table,j*steps*classes);});
  }
  return out;
 };
 return {
  // Words in image pixels from the top left, one per printed part of a line. onStep reports progress through the page.
  async read(img:Image,check:()=>void,onStep:(done:number,total:number)=>void):Promise<{words:OcrWord[];confidence:number}> {
   // shortcut: pages are read at up to 2400 px on the long side; larger photos are scaled down (small print may suffer).
   const scale=Math.min(1,2400/Math.max(img.width,img.height)),W=Math.max(32,Math.round(img.width*scale/32)*32),H=Math.max(32,Math.round(img.height*scale/32)*32);
   const map=await run(await session('det'),tensorOf(img,{x0:0,y0:0,x1:img.width,y1:img.height},W,H,W,[0.485,0.456,0.406],[0.229,0.224,0.225]),[1,3,H,W]);check();
   const fx=img.width/W,fy=img.height/H;
   const lines=textBoxes(map.data as Float32Array,W,H).map(b=>({x0:b.x0*fx,y0:b.y0*fy,x1:b.x1*fx,y1:b.y1*fy})).filter(b=>b.x1-b.x0>=2&&b.y1-b.y0>=2);
   // Pick the reader: the one used last if it reads the widest lines confidently, else whichever reads them best.
   const sample=[...lines].sort((a,b)=>(b.x1-b.x0)-(a.x1-a.x0)).slice(0,16);
   const mean=async(r:Reader)=>sample.length?(await readLines(img,sample,r,check)).reduce((s,x)=>s+x.score,0)/sample.length:0;
   let reader=preferred,best=await mean(reader);
   if(best<0.85)for(const r of READERS.filter(r=>r!==preferred)){const s=await mean(r);if(s>best+0.02){best=s;reader=r;}}
   preferred=reader;
   // Each line is read whole (letters read best in context), then its words go to its printed parts, matched by length;
   // the parts of a line whose words cannot be shared out that way are read one by one, with a margin like the detector's.
   const words:OcrWord[]=[],alone:{read:Box;at:Box}[]=[];let sum=0;
   const word=(text:string,score:number,at:Box)=>{if(text.trim())words.push({text:text.trim(),score,bbox:{x0:at.x0,y0:at.y0,x1:at.x1,y1:at.y1}});};
   for(let i=0;i<lines.length;i+=64){
    const chunk=lines.slice(i,i+64),read=await readLines(img,chunk,reader,check);onStep(i+chunk.length,lines.length);
    read.forEach((x,j)=>{
     const line=chunk[j]!,parts=inkParts(img,line),shares=parts.length>1?shareOut(x.text,parts.map(p=>p.x1-p.x0)):[x.text];sum+=x.score;
     if(shares)shares.forEach((text,k)=>word(text,x.score,parts[k]??line));
     else{const m=(line.y1-line.y0)*0.25;alone.push(...parts.map(p=>({read:{...line,x0:Math.max(line.x0,p.x0-m),x1:Math.min(line.x1,p.x1+m)},at:p})));}
    });
   }
   (await readLines(img,alone.map(a=>a.read),reader,check)).forEach((x,j)=>word(x.text,x.score,alone[j]!.at));
   return {words,confidence:lines.length?Math.round(sum/lines.length*100):0};
  },
  async close(){for(const s of sessions.values())await (await s.catch(()=>undefined))?.release();sessions.clear();},
 };
}
