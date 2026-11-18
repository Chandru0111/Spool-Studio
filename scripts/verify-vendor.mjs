import fs from 'node:fs/promises';import crypto from 'node:crypto';
const lines=(await fs.readFile('dist/CHECKSUMS.txt','utf8')).trim().split('\n');
for(const line of lines){const [hash,file]=line.split('  ');const actual=crypto.createHash('sha256').update(await fs.readFile(`dist/${file}`)).digest('hex');if(hash!==actual)throw Error(`Checksum mismatch: ${file}`);}
console.log(`Verified ${lines.length} local PDF/OCR asset checksums.`);
