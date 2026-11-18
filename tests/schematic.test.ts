import {describe,it,expect} from 'vitest';
import {readFacts,mergeTokens,dxfTokens,extractLoadList,SCHEMATIC_LIMITS,type Token} from '../src/import/schematic';
import {calculateSheet,type SheetRow} from '../src/engine/sheet';
import {suggestSheet,defaultSuggestions} from '../src/engine/suggest';

// Synthetic drawings in page units (y down). h = text height; angle 90 = text reading upwards.
const T=(text:string,x:number,y:number,o:Partial<Token>={}):Token=>({text,x,y,h:3,w:.55*3*text.length,angle:0,page:1,...o});
const byTo=(rows:{row:SheetRow}[],to:string)=>rows.find(r=>r.row.D===to)?.row;

// Page 1: MSB-01 single-line diagram, circuits hanging from a busbar. Page 2: DB-L1 circuit schedule table.
const msb:Token[]=[
 T('MSB-01',20,20,{h:5,w:30}),T('400/230V 3PH 4W 50HZ',20,30),T('FED FROM TX-1',20,38),
 T('100A TPN MCCB',90,70),T('63A TPN MCCB',150,70),T('32A SPN MCB',210,70),T('63A TPN MCCB',270,70),
 T('4C x 35mm² Cu/XLPE/SWA/PVC',101,150,{angle:90}),T('4C x 16mm² Cu/XLPE/SWA/PVC',161,150,{angle:90}),T('2C x 6mm² Cu/XLPE/SWA/PVC',221,150,{angle:90}),
 T('L=45m',92,160),T('L=60m',152,160),T('L=30m',212,160),
 T('DB-L1',92,185),T('AHU-01 15kW',148,185),T('PF 0.85',150,192),T('LIGHTING',206,185),T('2.5kW',210,192),T('SPARE',270,185),
 T('DRAWING TITLE: MSB SCHEMATIC',300,280),T('DWG NO E-101 REV A',300,288),
];
const dbl1:Token[]=[
 T('DB-L1',20,20,{h:5,w:25,page:2}),T('FED FROM MSB-01',20,28,{page:2}),
 ...['CKT','DESCRIPTION','LOAD (kW)','PF','MCB (A)','CABLE','LENGTH (m)'].map((t,k)=>T(t,[20,50,110,150,175,210,290][k]!,40,{page:2})),
 ...[['1','LIGHTING L1','1.2','0.9','10','2C x 2.5mm² Cu/PVC/PVC','25'],['2','SSO L1','2.0','0.85','20','2C x 4mm² Cu/PVC/PVC','30'],['3','SPARE','','','20','','']].flatMap((r,k)=>r.map((t,c)=>T(t,[20,50,110,150,175,210,290][c]!,48+8*k,{page:2}))).filter(t=>t.text),
];

describe('reading one piece of drawing text',()=>{
 it('recognises protection, phases, cable and load annotations',()=>{
  expect(readFacts('63A TPN MCCB')).toMatchObject({amps:63,phase:'3',device:true});
  expect(readFacts('4C x 35mm² Cu/XLPE/SWA/PVC')).toMatchObject({cores:'4C',size:'35',type:'Cu/XLPE/SWA/PVC'});
  expect(readFacts('XLPE/SWA/PVC 4CX16')).toMatchObject({type:'Cu/XLPE/SWA/PVC',typeNote:expect.stringContaining('copper assumed'),cores:'4C',size:'16'});
  expect(readFacts('2x(4x1Cx240mm²) Cu/XLPE/PVC')).toMatchObject({sets:2,cores:'1C',size:'240'});
  expect(readFacts('4Cx35+E16mm²')).toMatchObject({size:'35'});expect(readFacts('3x95+1x50mm2').size).toBe('95');
  expect(readFacts('C16 MCB').amps).toBe(16);expect(readFacts('FLC 28A').amps).toBeUndefined();expect(readFacts('36kA').amps).toBeUndefined();
  expect(readFacts('20 HP')).toMatchObject({kw:14.914,fromHp:true});expect(readFacts('L=45m').length).toBe(45);expect(readFacts('PF=0.86').pf).toBe(.86);
 });
 it('does not mistake ratings, wiring or titles for loads and voltages',()=>{
  const f=readFacts('400/230V 3PH 4W 50Hz');expect(f.volts).toEqual([400,230]);expect(f.phase).toBe('3');expect(f.kw).toBeUndefined();
  expect(readFacts('Cu/PVC 0.6/1kV').volts).toEqual([]);expect(readFacts('Cu/PVC 0.6/1kV').type).toBe('Cu/PVC (0.6/1kV)');
  expect(readFacts('TOTAL CONNECTED LOAD 45 kW').total).toBe(45);expect(readFacts('TOTAL CONNECTED LOAD 45 kW').kw).toBeUndefined();
  expect(readFacts('DP-1 DISTRIBUTION PANEL').phase).toBeUndefined();expect(readFacts('20A DP MCB').phase).toBe('1');
  expect(readFacts('CB-1 C101 Q1 IP65').tags).toEqual([]);expect(readFacts('UPS- 1 5kW').tags).toEqual(['UPS-1']);expect(readFacts('[J100a TPN MCCB')).toMatchObject({amps:100,phase:'3'});expect(readFacts('AHU-01 15kW').tags).toEqual(['AHU-01']);
 });
});

describe('text clean-up',()=>{
 it('joins characters a PDF split on one baseline and keeps separate columns apart',()=>{
  expect(mergeTokens([...'UPS-1'].map((c,k)=>T(c,10+k*4.6,10,{w:c==='-'?2.7:4.4}))).map(t=>t.text)).toEqual(['UPS-1']);
  const chars=[...'TPN'].map((c,k)=>T(c,10+k*1.7,10,{w:1.6}));
  expect(mergeTokens([...chars,T('63A',80,10)]).map(t=>t.text).sort()).toEqual(['63A','TPN']);
 });
 it('drops empty or non-finite items',()=>{expect(mergeTokens([T('',1,1),T('X',NaN,1),T('Y',1,Infinity),T('ok',1,1)]).map(t=>t.text)).toEqual(['ok']);});
});

describe('load list from a single-line diagram and a schedule',()=>{
 const result=extractLoadList([...msb,...dbl1]),rows=result.candidates;
 it('finds each outgoing circuit with its board, load, protection, cable and run',()=>{
  expect(byTo(rows,'AHU-01')).toMatchObject({C:'MSB-01',E:'3',F:'400',G:'15',I:'0.85',N:'63',O:'Cu/XLPE/SWA/PVC',P:'4C',AC:'16',AH:'60'});
  expect(byTo(rows,'LIGHTING')).toMatchObject({C:'MSB-01',E:'1',F:'230',G:'2.5',N:'32',P:'2C',AC:'6',AH:'30'});
  expect(rows.some(r=>/SPARE/.test(r.row.D))).toBe(false);expect(result.notes.join(' ')).toMatch(/spare/i);
  expect(rows.some(r=>/E-101|DRAWING/.test(r.row.D+r.row.C))).toBe(false);
 });
 it('reads a circuit schedule table and its board name',()=>{
  expect(byTo(rows,'LIGHTING L1')).toMatchObject({C:'DB-L1',G:'1.2',I:'0.9',N:'10',O:'Cu/PVC/PVC',P:'2C',AC:'2.5',AH:'25',E:'1',F:'230'});
  expect(byTo(rows,'SSO L1')).toMatchObject({C:'DB-L1',G:'2',N:'20',AC:'4'});
 });
 it('links feeders so total voltage drop chains from the source',()=>{
  const feeder=byTo(rows,'DB-L1')!,c=rows.find(r=>r.row.D==='DB-L1')!;
  expect(feeder).toMatchObject({C:'MSB-01',N:'100',P:'4C',AC:'35',AH:'45',G:'3.2',E:'3'});expect(c.inferred.G).toMatch(/sum of the circuits/);expect(c.inferred.I).toMatch(/combined PF/);
  const top=rows.find(r=>r.row.D==='MSB-01')!;expect(top.row.C).toBe('TX-1');expect(top.kind).toBe('feeder');expect(top.include).toBe(false);expect(Number(top.row.G)).toBeCloseTo(15+2.5+3.2,6);
  expect(rows.filter(r=>r.row.D==='DB-L1')).toHaveLength(1);
 });
 it('marks every value that was worked out rather than read',()=>{
  const light=rows.find(r=>r.row.D==='LIGHTING L1')!;expect(light.inferred.E).toMatch(/2-core/);expect(light.inferred.F).toMatch(/system voltage of MSB-01/);
  expect(extractLoadList([...msb,...dbl1,T('400/230V',20,34,{page:2})]).candidates.find(r=>r.row.D==='LIGHTING L1')!.inferred.F).toMatch(/system voltage of DB-L1/);
  expect(rows.find(r=>r.row.D==='AHU-01')!.inferred.G).toBeUndefined();
 });
 it('hands rows to the Cable Sizing sheet, which sizes every circuit',()=>{
  const picked=rows.filter(r=>r.include),sheet=suggestSheet(picked.map(r=>r.row),defaultSuggestions),res=sheet.results.filter(r=>r.cells.A!=='');
  expect(res).toHaveLength(picked.length);
  for(const [i,r] of sheet.results.entries())expect(r.invalid,`${picked[i]!.row.D}`).toEqual({});
  const i=picked.findIndex(r=>r.row.D==='LIGHTING L1');expect(typeof sheet.results[i]!.cells.AL).toBe('number');
  expect(sheet.results[i]!.cells.AL as number).toBeGreaterThan(sheet.results[i]!.cells.AK as number);
 });
});

describe('other layouts',()=>{
 it('reads a DB drawn with circuits running across the sheet',()=>{
  const db:Token[]=[T('DB-2',10,20,{h:5,w:20}),T('230V',10,28),...[0,1,2].flatMap(k=>[T('20A SPN MCB',50,50+20*k),T('2C x 4mm²',110,50+20*k),T(`FCU-0${k+1} 1.5kW`,170,50+20*k),T(`${20+k*5}m`,230,50+20*k)])];
  const rows=extractLoadList(db).candidates;
  expect(rows.map(r=>[r.row.C,r.row.D,r.row.N,r.row.AC,r.row.AH])).toEqual([['DB-2','FCU-01','20','4','20'],['DB-2','FCU-02','20','4','25'],['DB-2','FCU-03','20','4','30']]);
 });
 it('reads schedule headers that wrap onto a second line, ignoring a note just above',()=>{
  const x=[20,80,140,190],rows=extractLoadList([T('DB-5',10,10,{h:5,w:20}),T('415V',20,24),...['DESCRIPTION','LOAD','MCB','LENGTH'].map((t,k)=>T(t,x[k]!,30)),...['(kW)','(A)','(m)'].map((t,k)=>T(t,x[k+1]!,35)),...['PUMP P-7','7.5','20','42'].map((t,k)=>T(t,x[k]!,44))]).candidates;
  expect(rows.map(r=>[r.row.C,r.row.D,r.row.G,r.row.N,r.row.AH])).toEqual([['DB-5','PUMP P-7','7.5','20','42']]);
 });
 it('falls back to proximity when there is only one breaker',()=>{
  const rows=extractLoadList([T('MCC-1',10,10,{h:5,w:20}),T('P-101 22kW',100,100),T('50A TPN MCCB',100,106),T('4Cx16mm² Cu/XLPE/SWA/PVC 85m',100,112)]).candidates;
  expect(rows[0]!.row).toMatchObject({C:'MCC-1',D:'P-101',G:'22',N:'50',P:'4C',AC:'16',AH:'85'});
 });
});

const dxf=(entities:string[])=>['0','SECTION','2','HEADER','0','ENDSEC','0','SECTION','2','ENTITIES',...entities,'0','ENDSEC','0','EOF'].join('\r\n');
const text=(s:string,x:number,y:number,extra:string[]=[])=>['0','TEXT','8','0','10',String(x),'20',String(y),'40','2.5','1',s,...extra];
const attrib=(tag:string,value:string,x:number,y:number)=>['0','ATTRIB','10',String(x),'20',String(y),'40','2.5','1',value,'2',tag,'70','0'];
describe('DXF drawings',()=>{
 it('reads text, MTEXT formatting and block attributes',()=>{
  const tokens=dxfTokens(dxf([...text('MCC-1',0,100),'0','MTEXT','10','0','20','90','40','2.5','1','{\\fArial|b1;400V}\\P3%%c 50Hz',
   '0','INSERT','2','MOTOR','10','50','20','50','66','1',...attrib('TAG','P-101',50,50),...attrib('FROM','MCC-1',50,47),...attrib('KW','22',50,44),...attrib('VOLTAGE','415',50,41),...attrib('PHASE','3',50,38),...attrib('BREAKER','50',50,35),...attrib('CABLE','4C x 16mm2 Cu/XLPE/SWA/PVC',50,32),...attrib('LENGTH','85',50,29),'0','SEQEND']));
  expect(tokens.filter(t=>!t.group).map(t=>t.text)).toEqual(['MCC-1','400V','3Ø 50Hz']);expect(tokens.filter(t=>t.group)).toHaveLength(8);
  const read=extractLoadList(tokens),[row]=read.candidates;expect(row!.kind).toBe('block');expect(read.notes.join(' ')).not.toMatch(/no circuits/);
  expect(row!.row).toMatchObject({C:'MCC-1',D:'P-101',E:'3',F:'415',G:'22',N:'50',O:'Cu/XLPE/SWA/PVC',P:'4C',AC:'16',AH:'85'});
 });
 it('gives bare attribute numbers the unit their name implies',()=>{
  const tokens=dxfTokens(dxf([...text('DB-3',0,100),...text('20A SPN MCB',40,80),...text('16A SPN MCB',80,80),'0','INSERT','2','LOAD','10','40','20','60','66','1',...attrib('TAG','WH-1',40,60),...attrib('KW','3',40,57),'0','SEQEND']));
  expect(extractLoadList(tokens).candidates.find(c=>c.row.D==='WH-1')?.row).toMatchObject({C:'DB-3',G:'3',N:'20'});
 });
 it('rejects binary, foreign or damaged files with a clear message',()=>{
  expect(()=>dxfTokens('AutoCAD Binary DXF\r\n\u001a\u0000')).toThrow(/binary DXF/);
  expect(()=>dxfTokens('hello world')).toThrow(/not a DXF/);
  expect(()=>dxfTokens('0\nSECTION\nxx\nENTITIES')).toThrow(/damaged/);
 });
});

describe('hostile drawings cannot hang or crash the import',()=>{
 it('enforces the text-item limits',()=>{
  expect(()=>extractLoadList(Array.from({length:SCHEMATIC_LIMITS.tokens+1},(_,k)=>T('x',k,0)))).toThrow(/100,000/);
  expect(()=>extractLoadList(Array.from({length:SCHEMATIC_LIMITS.pageTokens+1},(_,k)=>T(`A${k}`,k*40,0)))).toThrow(/Page 1/);
 });
 it('stays fast on stacked, random and very long text',()=>{
  const start=Date.now();
  extractLoadList(Array.from({length:15000},()=>T('63 kW',5,5)));
  const rnd=(n:number)=>{let s='';for(let k=0;k<n;k++)s+=String.fromCharCode(32+Math.floor(Math.random()*95));return s;};
  expect(()=>extractLoadList(Array.from({length:4000},(_,k)=>T(rnd(40),Math.random()*1000,Math.random()*1000,{angle:[0,90,-90,33][k%4]!,page:1+k%3})))).not.toThrow();
  for(let k=0;k<200;k++)readFacts('9'.repeat(150)+'A'.repeat(150));readFacts('4C'.repeat(150));readFacts(' X('.repeat(100));
  expect(Date.now()-start).toBeLessThan(8000);
 });
 it('keeps MTEXT clean-up linear and survives huge paragraph counts',()=>{
  const head='0\nSECTION\n2\nENTITIES\n0\nMTEXT\n1\n',start=Date.now();
  for(const v of ['\\S'.repeat(200000),'\\P'.repeat(200000)+'DB-1','{'.repeat(400000)])expect(()=>dxfTokens(head+v+'\n0\nENDSEC\n0\nEOF')).not.toThrow();
  expect(Date.now()-start).toBeLessThan(3000);
 });
 it('handles DXF text that tries to break the parser',()=>{
  expect(()=>dxfTokens(dxf([...text('\\U+0000%%999{\\S1^;}\\P'.repeat(50),0,0),'0','MTEXT','1','\\'.repeat(5000),'10','x','20','NaN']))).not.toThrow();
 });
});

describe('image headers are checked before decoding',()=>{
 it('reads PNG, JPEG and WebP dimensions from the header alone',async()=>{
  const {imageSize,checkImage}=await import('../src/import/guard');
  const png=new Uint8Array(33);png.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52,0,0,0xc3,0x50,0,0,0xc3,0x50]);
  expect(imageSize(png)).toEqual({type:'image/png',width:50000,height:50000});
  const jpg=new Uint8Array([0xff,0xd8,0xff,0xe0,0,4,0,0,0xff,0xc0,0,17,8,0x01,0x2c,0x01,0x90,3,0,0,0,0,0,0,0,0]);
  expect(imageSize(jpg)).toEqual({type:'image/jpeg',width:400,height:300});
  const webp=new Uint8Array(30);webp.set([...'RIFF'].map(c=>c.charCodeAt(0)),0);webp.set([...'WEBPVP8X'].map(c=>c.charCodeAt(0)),8);webp.set([0x0f,0x27,0,0x9f,0x86,0x01],24);
  expect(imageSize(webp)).toEqual({type:'image/webp',width:10000,height:100000});
  expect(imageSize(new TextEncoder().encode('not an image at all, honest'))).toBeNull();
  expect(imageSize(new Uint8Array([0xff,0xd8,0xff,0xe0,0,0]))).toBeNull();
  expect(()=>checkImage(png)).toThrow(/12,000 px/);expect(checkImage(jpg)).toBe('image/jpeg');
 });
});
