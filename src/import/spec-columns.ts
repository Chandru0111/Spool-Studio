import type {PositionedLine,Rule} from './parse';
import {loadsIn,unitOf} from './vocabulary';

// Datasheets that set a few products side by side (UPS, drive and softstarter ranges): a heading row names the products,
// one per column, and each row under it prints a parameter's label at the left and its value under each product. A value
// printed once across several columns (a merged cell) holds for every product it spans: the borders the page draws say
// which, else the columns it is centred over. A row's value may sit a little above or below its label's line, or wrap; the
// drawn row borders keep it with its row. Each product comes out as its name and "label <tab> value" lines, with the section
// titles between them ("UPS INPUT", "BATTERY"): the form the label/value reader reads one product's sheet in.
export type SideBySide={name:string;page:number;text:string};
// ln: the text line the item is printed on.
type Item={x0:number;x1:number;y:number;h:number;text:string;ln:number};
const itemsOf=(l:PositionedLine,ln:number):Item[]=>l.cells.map(c=>({x0:c.x,x1:c.x+(c.w||c.text.length*4.5),y:c.y??l.y??0,h:c.h||8,text:c.text.trim(),ln})).filter(i=>i.text);
const mid=(i:{x0:number;x1:number})=>(i.x0+i.x1)/2;
// A product's name in a heading row: a few words starting with a letter or figure, with letters and a figure ("D 1000
// LI-ION", "PSTX30", "B. 500") or a short word in capitals ("NAS"); never a value with its unit ("1000 VA"), a load point,
// a unit alone, a dimension ("438 x 85.5 x 445") or a phrase with brackets, signs or percentages.
const VALUE=/^[<>≤≥±~]?\s*\d+(?:[.,]\d+)?\s*(?:[-–/]\s*\d+(?:[.,]\d+)?\s*)?(\S{1,5})?$/;
function named(t:string):boolean {
 if(t.length>30||!/^[\p{L}\d]/u.test(t)||!/\p{L}/u.test(t)||/[()[\]%<>≤≥±~=:;]|\d\s*[x×]\s*\d/.test(t)||t.split(/\s+/).length>4||unitOf(t)||loadsIn(t,true).length)return false;
 const v=VALUE.exec(t);if(v&&(!v[1]||unitOf(v[1].replace(/[^\p{L}%°/]/gu,''))||/^(?:VAC|VDC|Vac|Vdc|%)$/.test(v[1])))return false;
 return /\d/.test(t)||/^\p{Lu}{2,6}$/u.test(t);
}
// The right-most run of two or more product names set at an even pitch, with labels to their left: on the heading's own
// line, or on the rows below it when the top-left cell is blank (labels: where the labels below start).
function heading(items:readonly Item[],labels=Infinity):Item[]|null {
 const run:Item[]=[];
 for(let k=items.length-1;k>=0;k--){
  const it=items[k]!;if(!named(it.text))break;
  if(run.length>=2){const pitch=mid(run[run.length-2]!)-mid(run.at(-1)!),gap=mid(run.at(-1)!)-mid(it);if(gap<pitch*0.75||gap>pitch*1.33)break;}
  else if(run.length===1&&mid(run[0]!)-mid(it)<it.x1-it.x0)break;
  run.push(it);
 }
 run.reverse();
 return run.length>=2&&new Set(run.map(i=>i.text.toLowerCase())).size===run.length&&run[0]!.x0>Math.min(items[0]!.x0,labels)+20?run:null;
}

export function sideBySide(layout:ReadonlyMap<number,readonly PositionedLine[]>,rules:ReadonlyMap<number,readonly Rule[]>=new Map()):SideBySide[] {
 const out:SideBySide[]=[];
 for(const [page,lines] of layout){
  const all=lines.map((l,n)=>itemsOf(l,n)),drawn=rules.get(page)??[];
  const vert=drawn.filter(r=>r.x1-r.x0<2&&r.y1-r.y0>=2).map(r=>({x:(r.x0+r.x1)/2,y0:r.y0,y1:r.y1}));
  const walls=(at:number)=>vert.filter(v=>v.y0-1<=at&&at<=v.y1+1).map(v=>v.x).sort((a,b)=>a-b);
  const labels=(at:number)=>Math.min(...all.slice(at+1,at+4).flat().map(it=>it.x0));
  for(let i=0;i<all.length;i++){
   const head=heading(all[i]!,labels(i));if(!head)continue;
   const pitch=(mid(head.at(-1)!)-mid(head[0]!))/(head.length-1),w=walls(head[0]!.y+head[0]!.h*0.3);
   // Each product's column: the cell drawn around its name, else half a pitch either side of it.
   const cols=head.map(h=>({name:h.text,c:mid(h),x0:w.filter(x=>x<=h.x0+1).at(-1)??mid(h)-pitch/2,x1:w.find(x=>x>=h.x1-1)??mid(h)+pitch/2}));
   const start=cols[0]!.x0,end=cols.at(-1)!.x1;
   // A table that draws its columns' borders shows a merged cell by leaving them out; one that does not is read by position.
   const bordered=cols.slice(1).every(c=>w.some(x=>Math.abs(x-c.x0)<1));
   // Row borders: rules drawn across the product columns, top to bottom; a line's band is the gap between two of them.
   const flat=[...new Set(drawn.filter(r=>r.y1-r.y0<2&&Math.min(r.x1,end)-Math.max(r.x0,start)>pitch*0.5).map(r=>Math.round(r.y0+r.y1)/2))].sort((a,b)=>b-a);
   const band=(it:Item)=>{const at=it.y+it.h*0.3;return flat.findIndex(r=>r<at);};
   // The rows: a line with a label starts one; a line of values alone joins the row whose band it shares, else is a row of
   // its own under the same label ("1000 VA" then "1000 W" under "Power type rating"). A sentence at the left, or another
   // heading row, ends the table.
   // borrowed: a row of values alone takes the label before it until its own label's line comes ("94 %" printed a little
   // above "Efficiency at nominal load").
   type Row={label:string;band:number;items:Item[];borrowed?:boolean;aligned?:Item[]};
   const rows:Row[]=[];let k=i+1;
   for(;k<all.length;k++){
    const items=all[k]!;if(!items.length)continue;
    // Another heading row starts another table of other products ("2 poles" then "4 poles" families).
    if(heading(items,labels(k)))break;
    const content=items.filter(it=>!/^note\.?\s*\d+$/i.test(it.text));
    if(!content.length)continue;
    const label=content.filter(it=>it.x1<=start+2),values=content.filter(it=>it.x1>start+2),text=label.map(it=>it.text).join(' ');
    // A sentence, text running from the labels across the columns, or a line below the last row border is past the table.
    if(text.length>80||text.split(/\s+/).length>14||items.some(it=>it.x0<start-2&&it.x1>start+pitch))break;
    const b=flat.length?band(values[0]??label[0]!):-1,last=rows.at(-1),same=!!last&&!last.aligned&&b>=0&&b===last.band;
    if(flat.length&&rows.length&&b<0)break;
    // Some PDFs left-align both the model and its ratings. Each column must independently
    // confirm that alignment before it overrides a merged band or inferred cell boundary.
    const aligned=head.map(h=>content.find(it=>Math.abs(it.x0-h.x0)<=3));
    const caption=content.filter(it=>it.x1<=head[0]!.x0+1).map(it=>it.text).join(' ');
    if(/[a-z]/i.test(caption)&&aligned.every((v):v is Item=>!!v&&/^[-+<>≤≥]?\s*\d/.test(v.text))){
     rows.push({label:caption,band:b,items:aligned,aligned});
     continue;
    }
    // A label printed on two lines of one row ("Dimensions approx." over "(mm) UPS") is one label.
    if(same){if(text){last!.label=last!.borrowed?text:`${last!.label} ${text}`;delete last!.borrowed;}last!.items.push(...values);}
    else if(label.length)rows.push({label:text,band:b,items:values});
    else if(last&&values.length)rows.push({label:last.label,band:b,items:values,borrowed:true});
   }
   if(rows.filter(r=>r.items.length).length<3)continue;
   const texts=cols.map(()=>[] as string[]);
   for(const r of rows){
    if(r.aligned){r.aligned.forEach((v,j)=>texts[j]!.push(r.label+'\t'+v.text));continue;}
    // A label with no values is a section title over the rows below it.
    if(!r.items.length){texts.forEach(t=>t.push(r.label));continue;}
    // The printed pieces: items set close on one line are one piece ("15." "1" "kg").
    const pieces:Item[]=[];
    for(const it of [...r.items].sort((a,b)=>a.ln-b.ln||a.x0-b.x0)){
     const p=pieces.find(q=>q.ln===it.ln&&it.x0>=q.x0&&it.x0-q.x1<Math.min(q.h,it.h)*0.6);
     if(p){p.text+=it.x0-p.x1<0.08*Math.min(p.h,it.h)?it.text:` ${it.text}`;p.x1=Math.max(p.x1,it.x1);}else pieces.push({...it});
    }
    const each=cols.map(()=>[] as string[]);
    for(const p of pieces){
     const v=walls(p.y+p.h*0.3).filter(x=>x>start+1&&x<end-1),l=v.filter(x=>x<=p.x0+1).at(-1)??start,rt=v.find(x=>x>=p.x1-1)??end;
     let on:number[]=bordered?cols.flatMap((c,j)=>c.c>l&&c.c<rt?[j]:[]):[];
     const otherValues=pieces.some(q=>q!==p&&q.ln===p.ln);
     if(!bordered&&otherValues){
      const column=cols.findIndex(c=>Math.abs(c.c-mid(p))<pitch*0.4);
      if(column>=0)on=[column];
     }
     if(!on.length){
      // No drawn cell: the widest run of columns centred where the piece is, else the nearest column.
      for(let a=0;a<cols.length;a++)for(let b=cols.length-1;b>=a;b--)if(b-a+1>on.length&&Math.abs((cols[a]!.c+cols[b]!.c)/2-mid(p))<=pitch*0.2)on=Array.from({length:b-a+1},(_,j)=>a+j);
      if(!on.length)on=[cols.reduce((m,c,j)=>Math.abs(c.c-mid(p))<Math.abs(cols[m]!.c-mid(p))?j:m,0)];
     }
     for(const j of on)each[j]!.push(p.text);
    }
    each.forEach((v,j)=>{if(v.length)texts[j]!.push(`${r.label}\t${v.join(' ')}`);});
   }
   cols.forEach((c,j)=>{if(texts[j]!.some(t=>t.includes('\t')))out.push({name:c.name,page,text:texts[j]!.join('\n')});});
   i=k-1;
  }
 }
 return out;
}
