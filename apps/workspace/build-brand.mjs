import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const bytes=await readFile(new URL('./brand/ashbi-logo.png',import.meta.url));
const hash=createHash('sha256').update(bytes).digest('hex');
if(hash!=='2690c44df7a213bed3fac1fbe3a74cf06d1a7c427a0c383f9ceff508950a7ce9')throw Error('Ashbi logo differs from its documented source');
await writeFile(new URL('./ui-brand-assets.generated.mjs',import.meta.url),`// Generated from the unchanged, provenance-checked Ashbi brand asset.\nexport const brandLogo='/brand/ashbi-${hash.slice(0,16)}.png';\nconst encoded='${bytes.toString('base64')}';\nexport function brandAsset(path){return path===brandLogo?Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)):null;}\n`);
