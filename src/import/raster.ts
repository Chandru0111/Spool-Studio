// Pure image helpers for reading drawings: grey levels, an ink mask, straight-line detection, busbar and feeder paths,
// and the coordinate bookkeeping for reading vertical text on a rotated copy. Works on plain RGBA arrays, so the same
// code runs on a browser canvas and in tests. Every loop is linear in the pixel count (callers cap the image size).
export type Rgba={width:number;height:number;data:Uint8ClampedArray};
export type Mask={width:number;height:number;data:Uint8Array};
export type Box={x0:number;y0:number;x1:number;y1:number};
// A straight run of ink: horizontal when y0 = y1 (centre line), vertical when x0 = x1. t is the stroke thickness.
export type Seg={x0:number;y0:number;x1:number;y1:number;t:number};
export type Feeder={bus:number;dir:'down'|'up';points:[number,number][];end:[number,number]};
export type Geometry={buses:Seg[];feeders:Feeder[]};

// Luminance over a white background (transparent screenshots stay white).
export function toGray(img:Rgba):Uint8Array {
 const {data}=img,out=new Uint8Array(img.width*img.height);
 for(let i=0,p=0;p<out.length;i+=4,p++){const a=data[i+3]!/255,l=.2126*data[i]!+.7152*data[i+1]!+.0722*data[i+2]!;out[p]=Math.round(l*a+255*(1-a));}
 return out;
}
// Otsu's threshold: the grey level that best separates ink from paper (yellow highlights land on the paper side).
export function otsu(gray:Uint8Array):number {
 const hist=new Float64Array(256);for(const v of gray)hist[v]!++;
 let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i]!;
 let wB=0,sB=0,best=0,at=127;
 for(let t=0;t<256;t++){wB+=hist[t]!;if(!wB)continue;const wF=gray.length-wB;if(!wF)break;sB+=t*hist[t]!;const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)**2;if(v>best){best=v;at=t;}}
 return at;
}
export function inkMask(img:Rgba,gray=toGray(img)):Mask {
 const t=Math.min(otsu(gray),200),data=new Uint8Array(gray.length);for(let i=0;i<gray.length;i++)data[i]=gray[i]!<=t?1:0;
 return {width:img.width,height:img.height,data};
}
// Line work is black or grey: strongly coloured ink (red mark-ups, highlights, coloured text) is left out.
export function lineMask(img:Rgba,gray=toGray(img)):Mask {
 const t=Math.min(otsu(gray),200),{data:px}=img,data=new Uint8Array(gray.length);
 for(let p=0,i=0;p<gray.length;p++,i+=4){const r=px[i]!,g=px[i+1]!,b=px[i+2]!,sat=Math.max(r,g,b)-Math.min(r,g,b);data[p]=gray[p]!<=t&&sat<70?1:0;}
 return {width:img.width,height:img.height,data};
}
export function clearBoxes(mask:Mask,boxes:readonly Box[],pad=2):Mask {
 const data=mask.data.slice(),{width:w,height:h}=mask;
 for(const b of boxes){const x0=Math.max(0,Math.floor(b.x0-pad)),x1=Math.min(w-1,Math.ceil(b.x1+pad)),y0=Math.max(0,Math.floor(b.y0-pad)),y1=Math.min(h-1,Math.ceil(b.y1+pad));for(let y=y0;y<=y1;y++)data.fill(0,y*w+x0,y*w+x1+1);}
 return {width:w,height:h,data};
}

// Runs of ink at least minLen long, merged across neighbouring rows (or columns) into one stroke with a thickness.
function runs(mask:Mask,minLen:number,vertical:boolean):Seg[] {
 const {width:w,height:h,data}=mask,lines=vertical?w:h,len=vertical?h:w,at=(a:number,b:number)=>vertical?data[b*w+a]!:data[a*w+b]!;
 type Open={from:number;to:number;first:number;last:number;sum:number};
 const out:Seg[]=[];let open:Open[]=[];
 const close=(o:Open)=>{const t=o.last-o.first+1,c=(o.first+o.last)/2;out.push(vertical?{x0:c,y0:o.from,x1:c,y1:o.to,t}:{x0:o.from,y0:c,x1:o.to,y1:c,t});};
 for(let a=0;a<lines;a++){
  const found:[number,number][]=[];let s=-1;
  for(let b=0;b<=len;b++){const ink=b<len&&at(a,b)===1;if(ink&&s<0)s=b;else if(!ink&&s>=0){if(b-s>=minLen)found.push([s,b-1]);s=-1;}}
  const next:Open[]=[];
  for(const [from,to] of found){const o=open.find(p=>Math.min(p.to,to)-Math.max(p.from,from)>=.8*Math.min(p.to-p.from,to-from));
   if(o&&o.last===a-1&&a-o.first<40){o.from=Math.min(o.from,from);o.to=Math.max(o.to,to);o.last=a;next.push(o);open=open.filter(p=>p!==o);}else next.push({from,to,first:a,last:a,sum:0});}
  for(const o of open)close(o);open=next;
 }
 for(const o of open)close(o);
 return out;
}
export const findLines=(mask:Mask,minLen:number)=>({h:runs(mask,minLen,false),v:runs(mask,minLen,true)});
// Typical letter stem height, measured before OCR. Columns crossing a horizontal stroke give runs as long as the pen is
// thick; columns along a letter stem give runs as tall as the letters. The commonest run clearly longer than the pen
// thickness is the stem, so it tracks the drawing's text size (screenshot or 600 dpi scan alike).
export function stemHeight(mask:Mask):number {
 const {width:w,height:h,data}=mask,hist=new Uint32Array(301);
 for(let x=0;x<w;x++){let run=0;for(let y=0;y<=h;y++){if(y<h&&data[y*w+x]){run++;continue;}if(run>=1&&run<=300)hist[run]!++;run=0;}}
 const mode=(from:number,to:number)=>{let best=0,at=0;for(let n=Math.max(1,from);n<=Math.min(300,to);n++){const s=hist[n-1]!+hist[n]!+(n<300?hist[n+1]!:0);if(s>best){best=s;at=n;}}return at;};
 const pen=mode(1,40)||2,stem=mode(Math.max(8,pen*3),300);
 return stem||Math.max(10,Math.round(Math.min(w,h)/80));
}

// Black text on white for OCR: everything darker than the threshold becomes black, long straight lines are erased so
// labels touching a busbar or feeder still read as words.
export function ocrImage(img:Rgba,mask:Mask,lines:{h:Seg[];v:Seg[]}):Rgba {
 const {width:w,height:h}=img,data=new Uint8ClampedArray(w*h*4).fill(255),m=mask.data.slice();
 for(const s of lines.h){const y0=Math.max(0,Math.floor(s.y0-s.t/2-1)),y1=Math.min(h-1,Math.ceil(s.y0+s.t/2+1));for(let y=y0;y<=y1;y++)m.fill(0,y*w+Math.max(0,Math.floor(s.x0)),y*w+Math.min(w,Math.ceil(s.x1)+1));}
 for(const s of lines.v){const x0=Math.max(0,Math.floor(s.x0-s.t/2-1)),x1=Math.min(w-1,Math.ceil(s.x0+s.t/2+1));for(let y=Math.max(0,Math.floor(s.y0));y<=Math.min(h-1,Math.ceil(s.y1));y++)m.fill(0,y*w+x0,y*w+x1+1);}
 for(let p=0;p<m.length;p++)if(m[p]){const i=p*4;data[i]=data[i+1]=data[i+2]=0;}
 return {width:w,height:h,data};
}

// Breaker and symbol boxes drawn against a rating ("[]63A") make OCR read junk. Boxes are found on the ink before any
// line is erased (a feeder passing through a box would split it into two brackets): two matching horizontal edges about
// a box-width apart, joined by vertical sides at both ends. Only the outline is returned, so text inside a frame stays.
export function findBoxes(mask:Mask,textHeight:number):Box[] {
 const lo=Math.round(textHeight*1.1),hi=textHeight*3.2,tol=Math.max(3,textHeight*.2);
 const H=runs(mask,lo,false).filter(s=>s.x1-s.x0<=hi&&s.t<=textHeight*.4).sort((a,b)=>a.y0-b.y0),V=runs(mask,lo,true).filter(s=>s.y1-s.y0<=hi+2*tol&&s.t<=textHeight*.4);
 const byX=new Map<number,Seg[]>(),key=(x:number)=>Math.round(x/tol);for(const v of V){const k=key(v.x0),l=byX.get(k);if(l)l.push(v);else byX.set(k,[v]);}
 const side=(x:number,y0:number,y1:number)=>[key(x)-1,key(x),key(x)+1].some(k=>(byX.get(k)??[]).some(v=>Math.abs(v.x0-x)<=tol&&v.y0<=y0+tol&&v.y1>=y1-tol));
 const out:Box[]=[];
 for(let i=0;i<H.length&&out.length<5000;i++){const top=H[i]!,len=top.x1-top.x0;
  for(let j=i+1;j<H.length;j++){const bot=H[j]!,dy=bot.y0-top.y0;if(dy>1.6*len)break;if(dy<.6*len||Math.abs(bot.x0-top.x0)>tol||Math.abs(bot.x1-top.x1)>tol)continue;
   if(side(Math.min(top.x0,bot.x0)+1,top.y0,bot.y0)&&side(Math.max(top.x1,bot.x1)-1,top.y0,bot.y0)){out.push({x0:Math.min(top.x0,bot.x0),y0:top.y0-top.t/2,x1:Math.max(top.x1,bot.x1),y1:bot.y0+bot.t/2});break;}}}
 return out;
}
// White out box outlines (a band as thick as the stroke) in an RGBA image.
export function eraseOutlines(img:Rgba,boxes:readonly Box[],band:number):void {
 const {width:w,height:h,data}=img,paint=(x0:number,y0:number,x1:number,y1:number)=>{for(let y=Math.max(0,Math.floor(y0));y<=Math.min(h-1,Math.ceil(y1));y++)for(let x=Math.max(0,Math.floor(x0));x<=Math.min(w-1,Math.ceil(x1));x++){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=255;}};
 for(const b of boxes){paint(b.x0-band,b.y0-band,b.x1+band,b.y0+band);paint(b.x0-band,b.y1-band,b.x1+band,b.y1+band);paint(b.x0-band,b.y0-band,b.x0+band,b.y1+band);paint(b.x1-band,b.y0-band,b.x1+band,b.y1+band);}
}
// Quarter turns. cw: a word reading upwards in the original reads left to right in the copy; ccw: one reading downwards.
export function rotate(img:Rgba,dir:'cw'|'ccw'):Rgba {
 const {width:w,height:h,data}=img,out=new Uint8ClampedArray(data.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const nx=dir==='cw'?h-1-y:y,ny=dir==='cw'?x:w-1-x,i=(y*w+x)*4,o=(ny*h+nx)*4;out[o]=data[i]!;out[o+1]=data[i+1]!;out[o+2]=data[i+2]!;out[o+3]=data[i+3]!;}
 return {width:h,height:w,data:out};
}
// A word box found on the rotated copy, as a text item on the original: baseline start, size and reading angle.
export function fromRotated(b:Box,dir:'cw'|'ccw',w:number,h:number):{x:number;y:number;w:number;h:number;angle:number;box:Box} {
 const len=b.x1-b.x0,ht=b.y1-b.y0;
 // cw copy pixel (X, Y) came from original (Y, h-1-X); ccw copy pixel (X, Y) from (w-1-Y, X).
 if(dir==='cw')return {x:b.y1,y:h-1-b.x0,w:len,h:ht,angle:90,box:{x0:b.y0,y0:h-1-b.x1,x1:b.y1,y1:h-1-b.x0}};
 return {x:w-1-b.y1,y:b.x0,w:len,h:ht,angle:-90,box:{x0:w-1-b.y1,y0:b.x0,x1:w-1-b.y0,y1:b.x1}};
}
export const overlap=(a:Box,b:Box)=>{const ix=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0)),iy=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)),inter=ix*iy,small=Math.min((a.x1-a.x0)*(a.y1-a.y0),(b.x1-b.x0)*(b.y1-b.y0));return small>0?inter/small:0;};

// Busbars are the thick long horizontal strokes (or, on drawings with one line weight, long ones that feeders hang from).
// Feeders are traced from each busbar along vertical and horizontal strokes, across gaps left by breaker, cable and
// transformer symbols, until the line ends or splits.
const least=(v:readonly number[])=>v.reduce((m,x)=>x<m?x:m,Infinity);
export const LIMITS={segments:8000,buses:60,feeders:1500};
export function traceFeeders(lines:{h:Seg[];v:Seg[]},textHeight:number,width:number):Geometry {
 const tol=Math.max(3,textHeight*.25),gap=Math.max(8,textHeight*3),longest=(a:Seg,b:Seg)=>(b.x1-b.x0+b.y1-b.y0)-(a.x1-a.x0+a.y1-a.y0);
 const H=[...lines.h].sort(longest).slice(0,LIMITS.segments),V=[...lines.v].sort(longest).slice(0,LIMITS.segments);
 const longH=H.filter(s=>s.x1-s.x0>=Math.max(6*textHeight,width*.08)&&s.t<=Math.max(4,textHeight*.9));
 const touches=(bus:Seg,v:Seg)=>v.x0>=bus.x0-tol&&v.x0<=bus.x1+tol&&(Math.abs(v.y0-bus.y0)<=bus.t/2+tol?'down':Math.abs(v.y1-bus.y0)<=bus.t/2+tol?'up':null);
 // A busbar has feeders hanging from it: two if it is drawn heavier than the thinnest long lines, three otherwise.
 // A line with one drop at each end going opposite ways is a cable route bending twice, not a busbar.
 const route=(b:Seg,hits:Seg[])=>hits.length===2&&new Set(hits.map(v=>touches(b,v))).size===2&&hits.every(v=>Math.min(Math.abs(v.x0-b.x0),Math.abs(v.x0-b.x1))<=tol*2);
 const heavy=(b:Seg)=>longH.length===1||b.t>=1.4*least(longH.filter(o=>o!==b).map(o=>o.t));
 const buses=longH.map(b=>{const hits=V.filter(v=>touches(b,v));return {b,hits};}).filter(({b,hits})=>hits.length>=(heavy(b)?2:3)&&!route(b,hits)).map(({b})=>b).sort((a,b)=>a.y0-b.y0||a.x0-b.x0).slice(0,LIMITS.buses);
 const busSet=new Set(buses),strokes=[...V,...H.filter(s=>!busSet.has(s))];
 // Endpoint grid (cell = gap): bends and straight-ahead continuations are both within one cell of the current end.
 const grid=new Map<string,Seg[]>(),key=(x:number,y:number)=>`${Math.floor(x/gap)},${Math.floor(y/gap)}`;
 for(const s of strokes)for(const [x,y] of [[s.x0,s.y0],[s.x1,s.y1]] as const){const k=key(x,y),c=grid.get(k);if(!c)grid.set(k,[s]);else if(c.length<64&&!c.includes(s))c.push(s);}
 const around=(p:[number,number])=>{const out=new Set<Seg>(),gx=Math.floor(p[0]/gap),gy=Math.floor(p[1]/gap);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const s of grid.get(`${gx+dx},${gy+dy}`)??[])out.add(s);return [...out];};
 const ends=(s:Seg):[[number,number],[number,number]]=>[[s.x0,s.y0],[s.x1,s.y1]];
 const near=(p:[number,number],q:[number,number])=>Math.abs(p[0]-q[0])<=tol&&Math.abs(p[1]-q[1])<=tol;
 const onBus=(p:[number,number])=>buses.some(b=>p[0]>=b.x0-tol&&p[0]<=b.x1+tol&&Math.abs(p[1]-b.y0)<=b.t/2+tol);
 const feeders:Feeder[]=[];
 buses.forEach((bus,bi)=>{
  for(const v of V){const dir=touches(bus,v);if(!dir||feeders.length>=LIMITS.feeders)continue;
   const points:[number,number][]=[[v.x0,bus.y0]],used=new Set<Seg>([v]);let at:[number,number]=dir==='down'?[v.x1,v.y1]:[v.x0,v.y0],heading:[number,number]=dir==='down'?[0,1]:[0,-1];
   for(let step=0;step<40;step++){
    points.push(at);if(onBus(at))break;
    // Next stroke: one that starts where this one ends (a bend), else the next one straight ahead across a symbol gap.
    const local=around(at).filter(s=>!used.has(s)),turn=local.filter(s=>ends(s).some(e=>near(e,at)));
    const ahead=local.filter(s=>heading[0]===0?s.x0===s.x1&&Math.abs(s.x0-at[0])<=tol&&(heading[1]>0?s.y0>at[1]&&s.y0-at[1]<=gap:at[1]>s.y1&&at[1]-s.y1<=gap):s.y0===s.y1&&Math.abs(s.y0-at[1])<=tol&&(heading[0]>0?s.x0>at[0]&&s.x0-at[0]<=gap:at[0]>s.x1&&at[0]-s.x1<=gap));
    let options=turn.length?turn:ahead;
    if(options.length>1){const straight=options.filter(o=>heading[0]===0?o.x0===o.x1&&Math.abs(o.x0-at[0])<=1.5:o.y0===o.y1&&Math.abs(o.y0-at[1])<=1.5);if(straight.length===1)options=straight;}
    // A small symbol (fuse, contactor, coil) splits the line into short strokes either side of it: step over it to the
    // stroke that carries on along the same line beyond the symbol.
    if(options.length>1&&options.every(o=>o.x1-o.x0+o.y1-o.y0<=3*textHeight)){
     const reach=Math.max(...options.map(o=>heading[1]>0?o.y1:heading[1]<0?-o.y0:heading[0]>0?o.x1:-o.x0)),past:[number,number]=heading[0]===0?[at[0],heading[1]*reach]:[heading[0]*reach,at[1]];
     options=[...new Set([...around(past),...around(at)])].filter(s=>!used.has(s)&&!options.includes(s)&&(heading[0]===0?s.x0===s.x1&&Math.abs(s.x0-at[0])<=tol/2&&(heading[1]>0?s.y0>=past[1]-tol&&s.y0-past[1]<=gap:past[1]+tol>=s.y1&&past[1]-s.y1<=gap):s.y0===s.y1&&Math.abs(s.y0-at[1])<=tol/2&&(heading[0]>0?s.x0>=past[0]-tol&&s.x0-past[0]<=gap:past[0]+tol>=s.x1&&past[0]-s.x1<=gap)));
    }
    if(options.length!==1)break;
    const next=options[0]!;used.add(next);const [p,q]=ends(next),far=Math.hypot(p[0]-at[0],p[1]-at[1])<=Math.hypot(q[0]-at[0],q[1]-at[1])?q:p;
    heading=[Math.sign(far[0]-at[0]),Math.sign(far[1]-at[1])];at=far;
   }
   feeders.push({bus:bi,dir,points,end:at});
  }
 });
 return {buses,feeders};
}
