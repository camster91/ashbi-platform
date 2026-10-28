import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';

const directory=new URL('./ui-fonts/',import.meta.url);
const target=new URL('./ui-font-assets.generated.mjs',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const license=await readFile(new URL('OFL.txt',directory));
if(sha(license)!==manifest.licenseSha256||!license.toString().includes('SIL OPEN FONT LICENSE'))throw Error('UI font license integrity mismatch');
const assets={},rules=[];let total=0,preload;
for(const font of manifest.fonts){
 if(!/^[a-z-]+\.woff2$/.test(font.file)||!/^[U+0-9A-F,\-]+$/.test(font.unicodeRange))throw Error('Invalid UI font manifest');
 const bytes=await readFile(new URL(font.file,directory));
 if(bytes.length!==font.bytes||sha(bytes)!==font.sha256||bytes.subarray(0,4).toString()!=='wOF2')throw Error('UI font integrity mismatch: '+font.file);
 total+=bytes.length;if(total>100*1024)throw Error('UI fonts exceed the 100 KiB budget');
 const path='/fonts/'+font.file.replace('.woff2','.'+font.sha256.slice(0,12)+'.woff2');
 assets[path]=bytes.toString('base64');
 if(font.file==='plus-jakarta-sans-latin-wght-normal.woff2')preload=path;
 rules.push(`@font-face{font-family:"Plus Jakarta Sans";font-style:normal;font-weight:200 800;font-display:swap;src:url("${path}") format("woff2");unicode-range:${font.unicodeRange}}`);
}
if(!preload)throw Error('Missing primary UI font');
const source=`// Generated from pinned, licensed ui-fonts assets. Do not edit.
export const fontCss=${JSON.stringify(rules.join('\n'))};
export const fontPreload=${JSON.stringify(preload)};
const encoded=Object.freeze(${JSON.stringify(assets)}),decoded=new Map();
export function fontAsset(path){
 if(!Object.hasOwn(encoded,path))return undefined;
 if(!decoded.has(path))decoded.set(path,Uint8Array.from(atob(encoded[path]),character=>character.charCodeAt(0)));
 return decoded.get(path);
}
`;
let current;try{current=await readFile(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(source!==current){const temp=new URL('./ui-font-assets.'+randomUUID()+'.tmp',import.meta.url);try{await writeFile(temp,source);await rename(temp,target);}finally{await rm(temp,{force:true});}}
console.log(`Verified ${manifest.fonts.length} UI font subsets (${total} bytes); primary font loads locally.`);
