// Turns the supplied cable sizing workbook into the app's built-in tables and Excel template.
// Usage: node scripts/extract-workbook.mjs path/to/cable_sizing.xlsx
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
const file=process.argv[2];if(!file)throw Error('Pass the workbook path.');
const bytes=await fs.readFile(file),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
const sheet=name=>{const s=book.getWorksheet(name);if(!s)throw Error(`Missing sheet ${name}`);return s;};
const text=v=>v===null||v===undefined?'':typeof v==='object'&&'richText' in v?v.richText.map(t=>t.text).join(''):typeof v==='object'&&'result' in v?String(v.result??''):String(v);
const rows=(name,from=2)=>{const s=sheet(name),out=[];for(let r=from;r<=s.rowCount;r++){const row=s.getRow(r),vals=[];for(let c=1;c<=s.columnCount;c++)vals.push(row.getCell(c).value);if(vals.some(v=>text(v).trim()))out.push(vals);}return out;};
const num=v=>typeof v==='number'?v:null;
// Each lookup the workbook does with OFFSET/COUNTIF assumes contiguous blocks; fail loudly if that ever stops being true.
function contiguous(list,key,label){const seen=new Set();let last;for(const item of list){const k=key(item);if(k!==last&&seen.has(k))throw Error(`${label}: block ${k} is not contiguous`);seen.add(k);last=k;}}

const sizing=sheet('Cable Sizing'),fills={FFFFF2CC:'input',FFDDEBF7:'list',FFE7E6E6:'calc'},columns=[];
for(let c=1;c<=72;c++){const cell=sizing.getRow(1).getCell(c),kind=fills[cell.fill?.fgColor?.argb];if(!kind)throw Error(`Header ${cell.address} has no legend colour`);const note=cell.note?(typeof cell.note==='string'?cell.note:cell.note.texts.map(t=>t.text).join('')):'';columns.push({col:cell.address.replace(/\d+/,''),header:text(cell.value),kind,note:note.trim(),width:Math.round(sizing.getColumn(c).width??8.68)});}
const validation={};let listError='';
// The visible columns A–BT; hidden helpers are recomputed by the engine.
const shown=new Set(columns.map(c=>c.col));
for(const [ref,v] of Object.entries(sizing.dataValidations.model)){const col=ref.replace(/\d+/,'');if(!shown.has(col))continue;if(v.type==='list'&&!listError)listError=v.error??'';if(validation[col]||!['decimal','whole'].includes(v.type))continue;const f=(v.formulae??[]).map(Number);validation[col]={type:v.type,op:v.operator??'between',min:f[0]??null,max:v.operator==='between'||!v.operator?f[1]??null:null,error:v.error??''};}

const settings=rows('Settings',1).map(r=>text(r[0]).trim());
const settingRow=label=>rows('Settings',1).find(r=>text(r[0]).startsWith(label)),setting=label=>num(settingRow(label)?.[2]);
const lists=rows('Lists');
const voltages={1:[],3:[]};for(const r of lists)if(num(r[0])&&num(r[1]))voltages[r[0]].push(r[1]);
const cableTypes=rows('CableTypes').map(r=>({phases:num(r[0]),type:text(r[1]),insulation:text(r[3]),codes:text(r[4]),tables:text(r[5]),construction:text(r[6])}));
const cores=rows('Cores').map(r=>({phases:num(r[1]),type:text(r[2]),cores:text(r[3]),product:text(r[5]),use:text(r[6]),table:text(r[7]),ratingTable:text(r[8]),sizes:text(r[9])}));
const methods=rows('Methods').map(r=>[num(r[1]),text(r[2]),text(r[3]),text(r[4])]);
const ratingRows=rows('Ratings').map(r=>({key:text(r[0]),size:num(r[5]),it:num(r[6]),mv:num(r[7]),source:text(r[8])}));
contiguous(cableTypes,t=>t.phases,'CableTypes');contiguous(cores,c=>`${c.phases}|${c.type}`,'Cores');contiguous(methods,m=>m.slice(0,3).join('|'),'Methods');contiguous(ratingRows,r=>r.key,'Ratings');
if(ratingRows.some(r=>r.size===null||r.it===null||r.mv===null))throw Error('Ratings contain non-numeric values; extend the extractor to keep them as text.');
const ratings=[];for(const r of ratingRows){let block=ratings[ratings.length-1];if(block?.key!==r.key){block={key:r.key,source:r.source,rows:[]};ratings.push(block);}if(block.source!==r.source)block.source=[...new Set([...block.source.split(' · '),r.source])].join(' · ');block.rows.push([r.size,r.it,r.mv]);}
const factors=rows('Factors');
const temperature=factors.filter(r=>text(r[0]).includes('|')).map(r=>({key:text(r[0]),PVC:num(r[2]),XLPE:num(r[3])}));
const grouping=Object.fromEntries(factors.filter(r=>text(r[5]).includes('|')).map(r=>[text(r[5]),num(r[6])]));
const methodFactors=Object.fromEntries(factors.filter(r=>text(r[8])).map(r=>[text(r[8]),{temp:text(r[9]),group:text(r[10]),soil:text(r[11])}]));
const soil=factors.filter(r=>num(r[13])!==null).map(r=>({rho:num(r[13]),duct:num(r[14]),direct:num(r[15])}));
// Earth fault loop and short-circuit lookups (FaultData sheet).
const faultRows=rows('FaultData');
const fault={resistance:faultRows.filter(r=>num(r[0])!==null&&num(r[1])!==null).map(r=>[num(r[0]),num(r[1])]),
 insulation:Object.fromEntries(faultRows.filter(r=>text(r[3])).map(r=>[text(r[3]),{k:num(r[4]),kLarge:num(r[5]),multiplier:num(r[6])}])),
 devices:faultRows.filter(r=>text(r[9])).map(r=>({name:text(r[9]),multiple:num(r[10])})),
 transformers:faultRows.filter(r=>num(r[12])!==null).map(r=>({upTo:num(r[12]),uz:num(r[13])})),
 cpcTypes:faultRows.filter(r=>text(r[17])).map(r=>({name:text(r[17]),k:num(r[18]),kLarge:num(r[19]),kXlpe:num(r[20]),multiplier:num(r[21]),multiplierXlpe:num(r[22]),sameMaterial:num(r[23])===1,copperTable:num(r[24])===1})),
 disconnection:faultRows.filter(r=>num(r[26])!==null).map(r=>({upTo:num(r[26]),seconds:num(r[27]),tt:num(r[28])})),
 earthing:faultRows.map(r=>text(r[30])).filter(Boolean),
 sources:text(sheet('FaultData').getRow(1).getCell(16).value)};
if(fault.resistance.length<10||!fault.insulation.PVC||!fault.insulation.XLPE||fault.devices.length<2||!fault.transformers.length||fault.cpcTypes.length<5||fault.disconnection.length<4||fault.disconnection.some(d=>d.seconds===null||d.tt===null)||fault.earthing.join()!=='TN-S,TT')throw Error('FaultData sheet is incomplete.');
// Starter types and their typical starting current (multiple of Ib) for the starting VD check (Lists K:L).
const starters=lists.filter(r=>text(r[10]).trim()).map(r=>({name:text(r[10]).trim(),multiple:num(r[11])}));
if(!starters.length||starters.some(s=>s.multiple===null||s.multiple<1))throw Error('Lists K:L must hold each starter type with a starting current of 1 × Ib or more.');
const factorSources=text(sheet('Factors').getRow(1).getCell(18).value);

const data={source:{file:path.basename(file),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),catalogue:settings.find(s=>s.startsWith('13.'))?.replace(/^13\.\s*Data source:\s*/,'')??''},columns,validation,listError,defaults:{diversity:setting('Default diversity')??1,thd:setting('Default THD')??0,cables:setting('Default no. of cables')??1,ze:setting('Default Ze'),faultLevel:setting('Default fault level'),faultTime:setting('Default fault clearance time'),cmin:setting('Voltage factor Cmin'),earthing:text(settingRow('Default earthing system')?.[2]).trim()||'TN-S',startVd:setting('Default permissible starting VD')},
 starters,fault,
 voltages,transformers:lists.map(r=>num(r[6])).filter(v=>v!==null),cableCounts:lists.map(r=>num(r[8])).filter(v=>v!==null),cableTypes,cores,methods,ratings,temperature,grouping,methodFactors,soil,factorSources,notes:settings.filter(s=>/^\d+\.\s/.test(s))};
await fs.writeFile('src/data/sizing-tables.json',JSON.stringify(data));
await fs.mkdir('public/templates',{recursive:true});await fs.copyFile(file,'public/templates/cable-sizing.xlsx');
const unrated=methods.filter(m=>!ratings.some(b=>b.key===m.join('|'))).length;
console.log(`Extracted ${columns.length} columns, ${cableTypes.length} cable types, ${cores.length} core options, ${methods.length} methods (${unrated} without ratings), ${ratingRows.length} ratings in ${ratings.length} blocks.`);
