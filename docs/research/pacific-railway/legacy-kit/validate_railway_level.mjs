import {readFile} from 'node:fs/promises';
import {validateLevel,buildTrack} from '../public/pacific-railway/src/track.js';
const path=process.argv.slice(2).find(arg=>arg!=='--');
if(!path){console.error('Uso: pnpm validate:railway -- archivo.json');process.exit(1);}
try{const level=JSON.parse(await readFile(path,'utf8')),errors=validateLevel(level);if(errors.length)throw new Error(errors.join('\n'));console.log(JSON.stringify({valid:true,id:level.id,lengthPx:Math.round(buildTrack(level).length)},null,2));}catch(error){console.error(error.message);process.exit(1);}
