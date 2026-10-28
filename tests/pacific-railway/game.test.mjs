import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRun,updateRun} from '../../public/pacific-railway/src/game.js';
const level=JSON.parse(await readFile(new URL('../../public/pacific-railway/examples/valley-run.json',import.meta.url),'utf8'));
function finish(input){const run=createRun(level);for(let i=0;i<18000&&!run.complete;i++)updateRun(run,1/60,input);return run;}
test('el nivel 1 requiere conducir y puede completarse con las tres estrellas',()=>{const r=finish({throttle:1});assert(r.complete);assert.equal(r.stars,3);assert.equal(r.distance,r.finish);assert(r.elapsed>0&&r.elapsed<200);assert(r.markers.every(s=>s.collected));});
test('el tren espera detenido y el reloj no empieza sin acelerar',()=>{const r=finish({});assert.equal(r.speed,0);assert.equal(r.distance,r.start);assert.equal(r.elapsed,0);assert(!r.complete);});
test('aceleración progresiva y turbo cambian la velocidad de la partida',()=>{const gentle=finish({throttle:.6}),full=finish({throttle:1}),turbo=finish({throttle:1,turbo:true});assert(gentle.complete&&full.complete&&turbo.complete);assert(full.elapsed<gentle.elapsed);assert(turbo.elapsed<full.elapsed);assert(turbo.topSpeed>full.topSpeed);});
test('el freno detiene completamente el tren, incluso si se mantiene aceleración',()=>{const r=createRun(level);for(let i=0;i<120;i++)updateRun(r,1/60,{throttle:1});assert(r.speed>100);for(let i=0;i<180;i++)updateRun(r,1/60,{throttle:1,brake:1});assert.equal(r.speed,0);const d=r.distance;for(let i=0;i<60;i++)updateRun(r,1/60,{brake:1});assert.equal(r.distance,d);assert.equal(r.throttle,0);});
test('al soltar el acelerador conserva inercia sin añadir tracción',()=>{const r=createRun(level);for(let i=0;i<30;i++)updateRun(r,1/60,{throttle:1});const speed=r.speed,d=r.distance;updateRun(r,.05,{});assert(r.speed<speed&&r.speed>0);assert(r.distance>d);assert.equal(r.throttle,0);});
test('pausar y finalizar congelan la simulación',()=>{const r=createRun(level);r.paused=true;updateRun(r,.05,{throttle:1});assert.equal(r.elapsed,0);assert.equal(r.distance,r.start);r.paused=false;r.complete=true;updateRun(r,.05,{throttle:1});assert.equal(r.elapsed,0);});
test('el tiempo de integración está acotado y nunca avanza hacia atrás',()=>{const r=createRun(level);updateRun(r,5,{throttle:1});assert.equal(r.elapsed,.05);assert(r.distance>r.start);const d=r.distance;updateRun(r,-5,{throttle:1});assert.equal(r.distance,d);});
