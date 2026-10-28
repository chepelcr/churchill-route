import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PIECES,pointAt,buildTrack,atDistance,validateLevel} from '../../public/pacific-railway/src/track.js';
const base=JSON.parse(await readFile(new URL('../../public/pacific-railway/examples/valley-run.json',import.meta.url),'utf8'));

test('todos los ejemplos cumplen el contrato semántico',async()=>{
  for(const file of await readdir(new URL('../../public/pacific-railway/examples/',import.meta.url))){const level=JSON.parse(await readFile(new URL('../../public/pacific-railway/examples/'+file,import.meta.url),'utf8'));assert.deepEqual(validateLevel(level),[],file);const t=buildTrack(level);assert(t.length>0);assert(t.samples.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.angle)));for(let i=1;i<t.samples.length;i++)assert(t.samples[i].distance>t.samples[i-1].distance);}
});
test('todas las entradas y salidas coinciden con el catálogo',()=>{
  for(const [id,p]of Object.entries(PIECES)){const start=pointAt(p,0),end=pointAt(p,1);assert(Math.abs(start.x)<1e-8,id);assert(Math.abs(start.y)<1e-8,id);assert(Math.abs(end.x-(p.advance||256))<1e-8,id);assert(Math.abs(end.y-p.dy)<1e-8,id);assert(Math.abs(start.slope-p.start)<1e-8,id);assert(Math.abs(end.slope-p.end)<1e-8,id);}
});
test('loops de tres tamaños completan 360 grados y mantienen tangentes',()=>{
  for(const id of ['loop-small','loop-medium','loop-large']){const p=PIECES[id],top=pointAt(p,.5);assert(Math.abs(top.y+p.diameter)<1e-8);assert(Math.abs(top.angle+Math.PI)<1e-8);assert(Math.abs(pointAt(p,1).angle+2*Math.PI)<1e-8);const level={...base,pieces:['station','straight',id,'straight','brake']},track=buildTrack(level);const analytic=4*256+p.advance+Math.PI*p.diameter;assert(Math.abs(track.length-analytic)/analytic<.001);let inverted=false;for(let d=0;d<track.length;d+=3){const pt=atDistance(track,d);if(Math.cos(pt.angle)<-.95)inverted=true;assert(Number.isFinite(pt.angle));}assert(inverted);}
});
test('interpolación angular no gira de más al cerrar un loop',()=>{const t=buildTrack({...base,pieces:['station','loop-small','straight','brake']});let prev=atDistance(t,0);for(let d=1;d<t.length;d+=1){const p=atDistance(t,d),delta=Math.atan2(Math.sin(p.angle-prev.angle),Math.cos(p.angle-prev.angle));assert(Math.abs(delta)<.025);prev=p;}});
test('rechaza conexiones inválidas, datos incompletos y trenes demasiado largos',()=>{
  assert(validateLevel(null).length);assert(validateLevel({...base,pieces:['station','slope-up','brake']}).some(e=>e.includes('incompatible')));assert(validateLevel({...base,train:{cars:8,spacing:220},pieces:['station','straight','brake']}).some(e=>e.includes('corto')));assert(validateLevel({...base,pieces:['station','unknown','brake']}).some(e=>e.includes('desconocido')));assert(validateLevel({...base,foo:true}).length);assert(validateLevel({...base,start:{x:Infinity,y:0}}).length);assert(validateLevel({...base,train:{cars:3,spacing:168,skin:'unknown'}}).length);
});
test('esquema, catálogo y manifest comparten exactamente los IDs',async()=>{
  const schema=JSON.parse(await readFile(new URL('../../public/pacific-railway/schema/level.schema.json',import.meta.url),'utf8')),manifest=JSON.parse(await readFile(new URL('../../public/pacific-railway/assets/manifest.json',import.meta.url),'utf8'));assert.deepEqual([...schema.properties.pieces.items.enum].sort(),Object.keys(PIECES).sort());assert.deepEqual(manifest.assets.filter(a=>a.type==='track').map(a=>a.id).sort(),Object.keys(PIECES).sort());for(const a of manifest.assets.filter(a=>a.type==='track')){assert.equal(a.exit.x,PIECES[a.id].advance||256);assert.equal(a.exit.slope,PIECES[a.id].end);}
});
