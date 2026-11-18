import {describe,it,expect} from 'vitest';
import {toGray,otsu,inkMask,lineMask,findLines,findBoxes,eraseOutlines,rotate,fromRotated,traceFeeders,type Rgba,type Mask,type Seg} from '../src/import/raster';
import {readDrawingImage,useful,tokenBox,scaleGeometry,type Word} from '../src/import/drawing-ocr';
import {extractLoadList,readFacts,type Token} from '../src/import/schematic';

// Synthetic drawings: white paper, black (or coloured) strokes drawn as filled rectangles.
const paper=(w:number,h:number):Rgba=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)});
const fill=(img:Rgba,x0:number,y0:number,x1:number,y1:number,rgb:[number,number,number]=[0,0,0])=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*img.width+x)*4;img.data[i]=rgb[0];img.data[i+1]=rgb[1];img.data[i+2]=rgb[2];}};
const outline=(img:Rgba,x0:number,y0:number,s:number,t=3)=>{fill(img,x0,y0,x0+s,y0+t);fill(img,x0,y0+s-t,x0+s,y0+s);fill(img,x0,y0,x0+t,y0+s);fill(img,x0+s-t,y0,x0+s,y0+s);};
// A busbar with three feeders, each interrupted by a breaker box and a small fuse (two short strokes either side).
function board():Rgba {
 const img=paper(420,300);fill(img,20,47,400,55);
 for(const x of [80,180,280]){fill(img,x-1,55,x+2,90);outline(img,x-10,90,20);fill(img,x-1,110,x+2,150);fill(img,x-5,150,x-3,175);fill(img,x+4,150,x+6,175);fill(img,x-1,175,x+2,240);}
 return img;
}

describe('raster helpers',()=>{
 it('separates ink from paper, and leaves coloured mark-ups out of the line work',()=>{
  const img=paper(60,20);fill(img,0,0,30,20,[30,30,30]);fill(img,40,0,60,20,[220,20,20]);
  const t=otsu(toGray(img));expect(t).toBeGreaterThanOrEqual(30);expect(t).toBeLessThan(200);
  expect(inkMask(img).data[5]).toBe(1);expect(inkMask(img).data[45]).toBe(1);expect(lineMask(img).data[45]).toBe(0);expect(lineMask(img).data[5]).toBe(1);
 });
 it('finds straight strokes with their thickness',()=>{
  const {h,v}=findLines(inkMask(board()),30);
  expect(h.find(s=>s.x1-s.x0>300)).toMatchObject({x0:20,x1:399,t:8});expect(v.filter(s=>s.y1-s.y0>=60).length).toBeGreaterThanOrEqual(3);
 });
 it('traces each feeder from the busbar through breaker and fuse symbols to its end',()=>{
  const g=traceFeeders(findLines(lineMask(board()),12),14,420);
  expect(g.buses).toHaveLength(1);expect(g.feeders.map(f=>[f.dir,Math.round(f.points[0]![0]),Math.round(f.end[1])])).toEqual([['down',80,239],['down',180,239],['down',280,239]]);
 });
 it('does not take a cable route that bends twice for a busbar',()=>{
  const img=paper(400,300);fill(img,50,100,350,103);fill(img,50,20,53,103);fill(img,347,100,350,250);
  expect(traceFeeders(findLines(lineMask(img),12),14,400).buses).toHaveLength(0);
 });
 it('finds breaker boxes even with a feeder through them, but not open letters',()=>{
  const img=board(),boxes=findBoxes(inkMask(img),14);expect(boxes).toHaveLength(3);
  const u=paper(100,100);fill(u,20,20,24,60);fill(u,50,20,54,60);fill(u,20,56,54,60);expect(findBoxes(inkMask(u),14)).toHaveLength(0);
  eraseOutlines(img,boxes,2);expect(findBoxes(inkMask(img),14)).toHaveLength(0);
 });
 it('maps words read on a turned copy back onto the sheet',()=>{
  const img=paper(30,10);fill(img,2,3,6,5);
  const cw=rotate(img,'cw'),ccw=rotate(img,'ccw');expect([cw.width,cw.height]).toEqual([10,30]);
  expect(rotate(rotate(rotate(cw,'cw'),'cw'),'cw').data).toEqual(img.data);
  // Original box x 5-7, y 2-6 on a 30 x 10 sheet lies at x 3-7, y 5-7 on the cw copy and x 2-6, y 22-24 on the ccw copy.
  expect(fromRotated({x0:3,y0:5,x1:7,y1:7},'cw',30,10)).toMatchObject({angle:90,box:{x0:5,y0:2,x1:7,y1:6}});
  expect(fromRotated({x0:2,y0:22,x1:6,y1:24},'ccw',30,10)).toMatchObject({angle:-90,box:{x0:5,y0:2,x1:7,y1:6}});expect(ccw.width).toBe(10);
 });
});

describe('reading a drawing image',()=>{
 // A fake OCR engine: words for the upright pass, then for the turned copies (upward text, downward text).
 const engine=(passes:Word[][])=>{let n=0;return async()=>passes[n++]??[];};
 const W=(text:string,x0:number,y0:number,x1:number,y1:number,confidence=95):Word=>({text,confidence,bbox:{x0,y0,x1,y1}});
 it('keeps upright and vertical words, drops symbol noise and lone letters that follow nothing',async()=>{
  const img=board();
  const up=[W('Bus',20,30,50,44),W('B',56,30,66,44,90),W('C',300,120,316,140,92),W('<a',200,10,215,22,80),W('63A',92,92,120,106),W('TPN',124,92,150,106)];
  // Upward text at x 60-74 near the first feeder's end reads, on the cw copy (300 wide), from x = 300-1-y.
  const turned=[W('Compressor',300-1-262,60,300-1-182,74,96)];
  const read=await readDrawingImage(img,1,engine([up,turned,[]]),()=>{},()=>{});
  const texts=read.tokens.map(t=>t.text);
  expect(texts).toEqual(expect.arrayContaining(['Bus','B','63A','TPN','Compressor']));expect(texts).not.toContain('C');expect(texts).not.toContain('<a');
  expect(read.tokens.find(t=>t.text==='Compressor')).toMatchObject({angle:90,x:74});expect(read.geometry.feeders).toHaveLength(3);
 });
 it('treats short words as noise unless they are drawing abbreviations or carry a digit',()=>{
  for(const t of ['kV','TPN','MCB','Bus','63A','3/0','C4','Oil','&'])expect(useful(t,80),t).toBe(true);
  for(const t of ['Ql','<a','=20','~Z','om','we','[]','—'])expect(useful(t,80),t).toBe(false);
 });
 it('boxes rotated text and scales geometry consistently',()=>{
  const b=tokenBox({text:'x',x:10,y:50,w:20,h:5,angle:90,page:1});expect([b.x0,b.y0,b.x1,b.y1].map(v=>Math.round(v))).toEqual([5,30,10,50]);
  const g=scaleGeometry({buses:[{x0:1,y0:2,x1:3,y1:2,t:1}],feeders:[{bus:0,dir:'down',points:[[1,2],[1,4]],end:[1,4]}]},2);expect(g.feeders[0]!.end).toEqual([2,8]);expect(g.buses[0]!.t).toBe(2);
 });
});

describe('circuits from traced line work',()=>{
 const T=(text:string,x:number,y:number,o:Partial<Token>={}):Token=>({text,x,y,h:14,w:.6*14*text.length,angle:0,page:1,...o});
 const seg=(x0:number,y0:number,x1:number,y1:number,t=2):Seg=>({x0,y0,x1,y1,t});
 it('reads an LV board: busbar name and voltage, breaker beside each drop, load at the end',()=>{
  const geometry={buses:[seg(200,200,1200,200,8)],feeders:[300,600,900].map(x=>({bus:0,dir:'down' as const,points:[[x,200],[x,700]] as [number,number][],end:[x,700] as [number,number]}))};
  const tokens=[T('MSB-01',80,150,{h:22,w:120}),T('400/230V 3PH',80,175),T('63A TPN MCCB',316,268),T('32A SPN MCB',616,268),T('40A TPN MCCB',916,268),
   T('4C x 16mm2 Cu/XLPE/SWA/PVC',290,640,{angle:90,w:300}),T('L=60m',310,420),T('AHU-01',280,740),T('15kW PF 0.85',280,760),T('LIGHTING',580,740),T('2.5kW PF 0.9',580,760),T('P-101',880,740),T('15kW PF 0.86',880,760)];
  const rows=extractLoadList(tokens,new Map([[1,geometry]])).candidates.map(c=>c.row);
  expect(rows.map(r=>[r.C,r.D,r.E,r.F,r.G,r.I,r.N])).toEqual([['MSB-01','AHU-01','3','400','15','0.85','63'],['MSB-01','LIGHTING','1','230','2.5','0.9','32'],['MSB-01','P-101','3','400','15','0.86','40']]);
  expect(rows[0]).toMatchObject({O:'Cu/XLPE/SWA/PVC',P:'4C',AC:'16',AH:'60'});
 });
 it('reads an MV network in US notation, naming incomers after their source',()=>{
  const geometry={buses:[seg(200,800,900,800,8)],feeders:[{bus:0,dir:'down' as const,points:[[300,800],[300,900]] as [number,number][],end:[300,900] as [number,number]},{bus:0,dir:'down' as const,points:[[500,800],[500,900]] as [number,number][],end:[500,900] as [number,number]},{bus:0,dir:'up' as const,points:[[700,800],[700,650]] as [number,number][],end:[700,650] as [number,number]}]};
  const tokens=[T('Bus A',190,770),T('13.8 kV',190,790),T('7500 HP',292,1010,{angle:90,w:70}),T('Compressor A',312,1050,{angle:90,w:120}),T('1800 kW',492,1010,{angle:90,w:70}),T('Injection Pump',512,1060,{angle:90,w:130}),
   T('C4',712,760),T('850 ft',712,780),T('6-1/C 1000',712,795),T('TR:2',712,690),T('3 MVA',712,705),T('MVA',730,660),T('Wind Turbine',712,640),T('1500 kW',712,655)];
  const read=extractLoadList(tokens,new Map([[1,geometry]])),by=(d:string)=>read.candidates.find(c=>c.row.D===d||c.row.C===d)!;
  expect(by('Compressor A').row).toMatchObject({C:'Bus A',G:'5592.75',F:'13800',E:'3'});expect(by('Compressor A').inferred.G).toMatch(/HP/);
  expect(by('Injection Pump').row).toMatchObject({C:'Bus A',G:'1800'});
  const inc=by('Wind Turbine');expect(inc.row).toMatchObject({C:'Wind Turbine',D:'Bus A',B:'3000',P:'1C',AC:'1000 kcmil',AD:'2',AH:'259.08'});expect(inc.kind).toBe('feeder');expect(inc.inferred.AH).toMatch(/850 ft/);
  expect(read.notes.join(' ')).toMatch(/LV cables up to 690 V/);expect(read.notes.join(' ')).toMatch(/AWG\/kcmil/);
 });
});

describe('drawing notation',()=>{
 it('reads US cable counts, feet and miles, MW and MVA, and ETAP-style tags',()=>{
  expect(readFacts('6-1/C 500')).toMatchObject({cores:'1C',size:'500 kcmil',sets:2,threePhaseSets:true});expect(readFacts('3-1/C 3/0').size).toBe('3/0 AWG');expect(readFacts('3-3/C 4/0').sets).toBe(3);
  expect(readFacts('1100 ft')).toMatchObject({length:335.28,lengthNote:'converted from 1100 ft'});expect(readFacts('7.89 mile').length).toBeCloseTo(12697.8,0);
  expect(readFacts('10 MW').kw).toBe(10000);expect(readFacts('TR:4 1 MVA')).toMatchObject({kva:1000,tx:true});expect(readFacts('1250 MVAsc').kva).toBeUndefined();
  expect(readFacts('3WTR:1 30/15/15 MVA').tags).toEqual(['3WTR:1']);expect(readFacts('Bus A').tags).toEqual(['Bus A']);expect(readFacts('BusA 13.8 kV').volts).toEqual([13800]);
 });
 it('reads a bare C16 as an MCB rating only where the drawing talks about MCBs',()=>{
  expect(readFacts('C16').curve).toBe(16);expect(readFacts('C16').amps).toBeUndefined();expect(readFacts('C16 MCB').amps).toBe(16);
  const T=(text:string,x:number,y:number):Token=>({text,x,y,h:5,w:3*text.length,angle:0,page:1});
  const withMcb=extractLoadList([T('DB-1',0,0),T('MCB TYPE C',200,0),T('C16',50,40),T('C20',90,40),T('FCU-1 1kW',50,60),T('FCU-2 1kW',90,60)]).candidates;
  const without=extractLoadList([T('DB-1',0,0),T('C16',50,40),T('C20',90,40),T('FCU-1 1kW',50,60),T('FCU-2 1kW',90,60)]).candidates;
  expect(withMcb.map(c=>c.row.N)).toEqual(['16','20']);expect(without.every(c=>!c.row.N)).toBe(true);
 });
});

describe('hostile images and geometry stay bounded',()=>{
 it('copes with noise, huge stroke counts and thousands of words quickly',async()=>{
  const start=Date.now(),noise=paper(800,800);for(let i=0;i<noise.data.length;i+=4){const v=Math.random()<.5?0:255;noise.data[i]=noise.data[i+1]=noise.data[i+2]=v;}
  const m:Mask=inkMask(noise);expect(()=>traceFeeders(findLines(m,8),10,800)).not.toThrow();expect(()=>findBoxes(m,10)).not.toThrow();
  const grid=paper(1200,1200);for(let k=0;k<1200;k+=6){fill(grid,0,k,1200,k+2);fill(grid,k,0,k+2,1200);}
  expect(()=>traceFeeders(findLines(lineMask(grid),10),10,1200)).not.toThrow();
  const words:Word[]=Array.from({length:8000},(_,k)=>({text:`W${k}`,confidence:90,bbox:{x0:(k%100)*8,y0:Math.floor(k/100)*10,x1:(k%100)*8+7,y1:Math.floor(k/100)*10+9}}));
  await expect(readDrawingImage(paper(800,800),1,async()=>words,()=>{},()=>{})).resolves.toBeTruthy();
  const T=(text:string,x:number,y:number):Token=>({text,x,y,h:10,w:30,angle:0,page:1});
  const feeders=Array.from({length:1500},(_,k)=>({bus:0,dir:'down' as const,points:[[k*4,100],[k*4,300]] as [number,number][],end:[k*4,300] as [number,number]}));
  expect(()=>extractLoadList(Array.from({length:12000},(_,k)=>T(`L${k} 5kW`,(k%1500)*4,120+Math.floor(k/1500)*20)),new Map([[1,{buses:[{x0:0,y0:100,x1:6000,y1:100,t:6}],feeders}]]))).not.toThrow();
  expect(Date.now()-start).toBeLessThan(20000);
 },30000);
});
