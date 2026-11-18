// Rejects ZIP-based files (XLSX) that would inflate to an unreasonable size before any parser touches them.
// Reads the ZIP central directory directly, so it costs microseconds and trusts nothing the parser would build.
export const MAX_UNZIPPED=200*1024*1024,MAX_ENTRIES=5000;
export function checkZip(data:ArrayBuffer|Uint8Array):void {
 const bytes=data instanceof Uint8Array?data:new Uint8Array(data),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw Error('This is not a valid XLSX file.');
 const entries=view.getUint16(eocd+10,true),start=view.getUint32(eocd+16,true);
 if(entries===0xffff||start===0xffffffff||entries>MAX_ENTRIES)throw Error('This workbook has too many internal parts to open safely.');
 let total=0,at=start;
 for(let k=0;k<entries;k++){
  if(at+46>bytes.length||view.getUint32(at,true)!==0x02014b50)throw Error('This XLSX file is damaged.');
  const size=view.getUint32(at+24,true);if(size===0xffffffff)throw Error('This workbook is too large to open safely.');
  total+=size;if(total>MAX_UNZIPPED)throw Error('This workbook expands to more than 200 MB. Remove unused sheets or images and try again.');
  at+=46+view.getUint16(at+28,true)+view.getUint16(at+30,true)+view.getUint16(at+32,true);
 }
}

// Image size from the file header, read before anything decodes the pixels: a small file can claim
// 50,000 × 50,000 px and exhaust memory when decoded.
export const MAX_IMAGE_SIDE=12000,MAX_IMAGE_PIXELS=60e6;
export function imageSize(b:Uint8Array):{type:string;width:number;height:number}|null {
 const u16=(i:number)=>(b[i]!<<8)|b[i+1]!,u32=(i:number)=>((b[i]!<<24)>>>0)+(b[i+1]!<<16)+(b[i+2]!<<8)+b[i+3]!,le16=(i:number)=>b[i]!|(b[i+1]!<<8),le24=(i:number)=>b[i]!|(b[i+1]!<<8)|(b[i+2]!<<16);
 if(b.length>=24&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47&&String.fromCharCode(...b.slice(12,16))==='IHDR')return {type:'image/png',width:u32(16),height:u32(20)};
 if(b.length>=4&&b[0]===0xff&&b[1]===0xd8){let i=2;while(i+9<b.length){if(b[i]!==0xff){i++;continue;}const m=b[i+1]!;if(m===0xd8||m===0x01||(m>=0xd0&&m<=0xd7)){i+=2;continue;}if(m>=0xc0&&m<=0xcf&&m!==0xc4&&m!==0xc8&&m!==0xcc)return {type:'image/jpeg',width:u16(i+7),height:u16(i+5)};const len=u16(i+2);if(len<2)return null;i+=2+len;}return null;}
 if(b.length>=30&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'){const kind=String.fromCharCode(...b.slice(12,16));
  if(kind==='VP8 ')return {type:'image/webp',width:le16(26)&0x3fff,height:le16(28)&0x3fff};
  if(kind==='VP8L'){const v=b[21]!|(b[22]!<<8)|(b[23]!<<16)|(b[24]!<<24);return {type:'image/webp',width:(v&0x3fff)+1,height:((v>>>14)&0x3fff)+1};}
  if(kind==='VP8X')return {type:'image/webp',width:le24(24)+1,height:le24(27)+1};}
 return null;
}
// Refuses images whose header claims more pixels than the browser can safely decode for OCR.
export function checkImage(b:Uint8Array):string {
 const size=imageSize(b);if(!size)throw Error('The image could not be decoded. Use a PNG, JPG or WebP file.');
 if(!size.width||!size.height||size.width>MAX_IMAGE_SIDE||size.height>MAX_IMAGE_SIDE||size.width*size.height>MAX_IMAGE_PIXELS)throw Error(`The image is larger than ${MAX_IMAGE_SIDE.toLocaleString('en')} px or 60 megapixels. Scale it down first.`);
 return size.type;
}
