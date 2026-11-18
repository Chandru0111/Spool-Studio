import type { Rating, PageEvidence } from '../store/schema';

export const blankRating=(id:string,page=1):Rating=>({id,cableType:'',cores:'',material:'Unknown',insulation:'Unknown',phases:null,method:'',sizeMm2:null,itA:null,mvAm:null,odMm:null,kgKm:null,minBendRadiusXOd:null,ratedV:null,source:`Page ${page}`,page,evidence:'',reviewed:false});
// Same limits as a worksheet, so a crafted CSV cannot build millions of cells or dropdown options.
export const MAX_ROWS=10000,MAX_COLS=200;
export function parseDelimited(text:string):string[][] {
  const first=text.indexOf('\n'),delimiter=(first<0?text:text.slice(0,first)).includes('\t')?'\t':',';
  const rows:string[][]=[]; let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(ch==='"') {if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(ch===delimiter&&!quoted){row.push(cell.trim());cell='';if(row.length>=MAX_COLS)throw Error(`A row has more than ${MAX_COLS} columns. Remove unused columns and try again.`);}
    else if(ch==='\n'&&!quoted){row.push(cell.trim());if(row.some(Boolean))rows.push(row);if(rows.length>MAX_ROWS)throw Error(`The file has more than ${MAX_ROWS.toLocaleString('en')} rows. Split it and try again.`);row=[];cell='';}
    else if(ch!=='\r') cell+=ch;
  }
  if(quoted)throw Error('Unclosed quote in CSV. Correct the file before importing.');
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length>MAX_ROWS)throw Error(`The file has more than ${MAX_ROWS.toLocaleString('en')} rows. Split it and try again.`);
  return rows;
}
const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases:Record<string,keyof Rating>={cabletype:'cableType',construction:'cableType',type:'cableType',cores:'cores',corecount:'cores',material:'material',conductor:'material',insulation:'insulation',phases:'phases',phase:'phases',method:'method',referencemethod:'method',installationmethod:'method',sizemm2:'sizeMm2',size:'sizeMm2',crosssectionmm2:'sizeMm2',nominalarea:'sizeMm2',ita:'itA',ampacity:'itA',currenta:'itA',currentratinga:'itA',mvam:'mvAm',voltagedropmvam:'mvAm',odmm:'odMm',overallDiametermm:'odMm',overalldiametermm:'odMm',diametermm:'odMm',kgkm:'kgKm',weightkgkm:'kgKm',minbendradiusxod:'minBendRadiusXOd',bendradiusxod:'minBendRadiusXOd',ratedv:'ratedV',voltagev:'ratedV',source:'source'};
const numeric=new Set(['sizeMm2','itA','mvAm','odMm','kgKm','minBendRadiusXOd','ratedV']);
export function parseTable(cells:string[][],name:string):Rating[] {
  if(cells.length<2)throw Error('The table needs a header and at least one cable row.');
  if(cells.length>5001)throw Error('A catalogue is limited to 5,000 extracted rows.');
  const fields=(cells[0]??[]).map(s=>aliases[normalize(s)]);
  if(!fields.includes('sizeMm2')||!fields.includes('cableType')) throw Error('Include cableType and sizeMm2 headers. Download the example CSV for supported columns.');
  const result:Rating[]=[];
  for(const [index,cellsRow] of cells.slice(1).entries()) {
    const r=blankRating(`row-${index+1}`);r.source=`${name} • row ${index+2}`;r.evidence=cellsRow.join(' | ');
    for(const [col,field] of fields.entries()) {
      if(!field)continue;const v=cellsRow[col]?.trim()??'';
      if(numeric.has(field)) {
        if(v && (!Number.isFinite(Number(v)) || Number(v)<=0))throw Error(`Row ${index+2}, ${field}: enter a positive number or leave blank.`);
        Object.assign(r,{[field]:v?Number(v):null});
      } else if(field==='phases') {
        if(v&&!['1','3'].includes(v))throw Error(`Row ${index+2}: phases must be 1 or 3.`);
        r.phases=v?Number(v) as 1|3:null;
      } else if(field==='material') {r.material=/^(cu|copper)$/i.test(v)?'Cu':/^(al|alumini?um)$/i.test(v)?'Al':'Unknown';}
      else if(field==='insulation') {r.insulation=['PVC','XLPE','EPR'].includes(v.toUpperCase())?v.toUpperCase() as 'PVC'|'XLPE'|'EPR':'Unknown';}
      else Object.assign(r,{[field]:v});
    }
    result.push(r);
  }
  return result;
}
const readNumber=(text:string,re:RegExp):number|null=>{const match=text.match(re);return match?.[1]?Number(match[1].replace(',','.')):null;};
export function extractCandidates(pages:PageEvidence[],name:string):Rating[] {
  const rows:Rating[]=[];
  for(const page of pages) {
    const lines=page.text.split('\n').filter(x=>x.trim());
    let construction='';let cores='';
    for(let index=0;index<lines.length;index++) {
      const line=lines[index]??'';
      const type=line.match(/\b(?:Cu|Al)(?:\s*\/\s*(?:XLPE|PVC|SWA|AWA|LSZH|LSOH|EPR|PE)){1,5}\b/i);
      if(type)construction=type[0].replace(/\s/g,'');
      const core=line.match(/\b(\d{1,2})\s*(?:C\b|cores?\b)/i);if(core)cores=`${core[1]}C`;
      const size=readNumber(line,/(\d+(?:[.,]\d+)?)\s*(?:mm[²2]|sq\.?\s*mm)/i)??readNumber(line,/\b\d{1,2}\s*[x×]\s*(\d+(?:[.,]\d+)?)\b/i);
      const labelled=/overall\s*diameter|current\s*(?:rating|capacity)|ampacity|cross[ -]?section/i.test(line);
      if(size===null&&!type&&!labelled)continue;
      if(size===null&&!type&&rows.some(r=>r.page===page.page))continue;
      let end=Math.min(lines.length,index+22);
      for(let next=index+1;next<end;next++)if(/\b\d+(?:[.,]\d+)?\s*mm[²2]\b/i.test(lines[next]??'')){end=next;break;}
      const context=lines.slice(Math.max(0,index-1),end).join('\n');
      const r=blankRating(`p${page.page}-${index}`,page.page);
      r.cableType=construction;r.cores=cores;r.sizeMm2=size;
      r.material=/\b(?:Cu|copper)\b/i.test(context)?'Cu':/\b(?:Al|alumini?um)\b/i.test(context)?'Al':'Unknown';
      r.insulation=/XLPE/i.test(context)?'XLPE':/EPR/i.test(context)?'EPR':/PVC/i.test(context)?'PVC':'Unknown';
      r.itA=readNumber(context,/(?:current(?:\s+(?:rating|capacity|carrying capacity))?|ampacity)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*A\b/i);
      r.mvAm=readNumber(context,/(\d+(?:[.,]\d+)?)\s*mV\s*\/\s*A\s*\/\s*m\b/i);
      r.odMm=readNumber(context,/(?:overall\s*diameter|O\.?D\.?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*mm/i);
      r.kgKm=readNumber(context,/(\d+(?:[.,]\d+)?)\s*kg\s*\/\s*km/i);
      r.minBendRadiusXOd=readNumber(context,/(?:bend(?:ing)?\s*radius)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:x|×)/i);
      const voltage=readNumber(context,/(?:rated\s*voltage|voltage\s*rating)\s*[:=]?\s*(?:\d+(?:[.,]\d+)?\s*\/\s*)?(\d+(?:[.,]\d+)?)\s*kV/i);
      r.ratedV=voltage!==null?voltage*1000:readNumber(context,/(?:rated\s*voltage|voltage\s*rating)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*V\b/i);
      r.method=context.match(/(?:reference\s*method|installation\s*method)\s*[:=]?\s*([A-G][12]?)(?:\s|$)/i)?.[1]?.toUpperCase()??'';
      const phases=readNumber(context,/(?:phases?)\s*[:=]?\s*([13])\b/i);r.phases=phases===1||phases===3?phases:null;
      r.source=`${name} • PDF p. ${page.page}`;r.evidence=context;
      if(!rows.some(x=>x.page===r.page && x.sizeMm2===r.sizeMm2 && x.cableType===r.cableType && x.cores===r.cores))rows.push(r);
      if(rows.length>=5000)throw Error('Extraction exceeds 5,000 candidate rows. Split the catalogue into smaller files.');
    }
  }
  return rows;
}

export type PositionedLine={cells:{x:number;text:string}[]};
/** Conservative, explicit single-row headers. Multi-level/ambiguous headers stay manual. */
export function extractPositionedTable(lines:PositionedLine[],page:number,name:string):Rating[] {
  type NumericField='sizeMm2'|'odMm'|'kgKm'|'itA'|'mvAm';
  const columns:{x:number;key:NumericField}[]=[];let headerIndex=-1;
  const headerKey=(text:string):NumericField|null=>{
    if(/^\s*\d/.test(text))return null;
    if(/cross.?section|nominal\s*(?:area|size)|size.*mm|area.*mm|^mm[²2]$/i.test(text.trim()))return 'sizeMm2';
    if(/overall.*diameter|diameter.*mm|\bOD\b/i.test(text))return 'odMm';
    if(/weight|mass|kg\s*\/\s*km/i.test(text))return 'kgKm';
    if(/current.*(?:rating|capacity)|ampacity|^It\s*\(?A\)?$/i.test(text))return 'itA';
    if(/mV.*A.*m|voltage\s*drop/i.test(text))return 'mvAm';return null;
  };
  for(const [i,line] of lines.entries()) {
    const found=line.cells.map(c=>({x:c.x,key:headerKey(c.text)})).filter((c):c is {x:number;key:NumericField}=>c.key!==null);
    if(found.some(c=>c.key==='sizeMm2')&&found.length>=2&&new Set(found.map(c=>c.key)).size===found.length){columns.push(...found);headerIndex=i;break;}
  }
  if(headerIndex<0)return [];
  columns.sort((a,b)=>a.x-b.x);const rows:Rating[]=[];
  const headerText=lines.slice(0,headerIndex+1).map(l=>l.cells.map(c=>c.text).join(' ')).join('\n');
  const type=headerText.match(/\b(?:Cu|Al)(?:\s*\/\s*(?:XLPE|PVC|SWA|AWA|LSZH|LSOH|EPR|PE)){1,5}\b/i)?.[0]?.replace(/\s/g,'')??'';
  for(const [index,line] of lines.slice(headerIndex+1).entries()) {
    const r=blankRating(`table-p${page}-${index}`,page);let matches=0;
    for(const col of columns){const cell=[...line.cells].sort((a,b)=>Math.abs(a.x-col.x)-Math.abs(b.x-col.x))[0];if(!cell||Math.abs(cell.x-col.x)>45||!/^\d+(?:[,.]\d+)?$/.test(cell.text.trim()))continue;const value=Number(cell.text.trim().replace(',','.'));if(value>0){r[col.key]=value;matches++;}}
    if(r.sizeMm2===null||matches<2)continue;
    r.cableType=type;r.cores=headerText.match(/\b(\d{1,2})\s*C\b/i)?.[1]?`${headerText.match(/\b(\d{1,2})\s*C\b/i)?.[1]}C`:'';
    r.insulation=/XLPE/i.test(type)?'XLPE':/PVC/i.test(type)?'PVC':'Unknown';r.material=/^Cu/i.test(type)?'Cu':/^Al/i.test(type)?'Al':'Unknown';
    r.evidence=headerText+'\n'+line.cells.map(c=>c.text).join(' | ');r.source=`${name} • PDF p. ${page} • positioned table`;
    rows.push(r);
  }
  return rows;
}
export function reviewProblems(r:Rating):string[] {
  const missing:string[]=[];
  for(const [key,label] of [['cableType','Cable construction'],['cores','Core count'],['method','Reference method'],['source','Source']] as const)if(!r[key].trim())missing.push(label);
  for(const [key,label] of [['sizeMm2','Cross-section'],['itA','Current rating'],['mvAm','Voltage drop']] as const)if(r[key]===null)missing.push(label);
  if(r.phases===null)missing.push('Phases');
  if(r.material==='Unknown')missing.push('Conductor');if(r.insulation==='Unknown')missing.push('Insulation');
  return missing;
}
