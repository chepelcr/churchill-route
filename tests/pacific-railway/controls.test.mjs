import test from 'node:test';
import assert from 'node:assert/strict';
import {getTouchDrive,localCanvasPoint} from '../../public/pacific-railway/src/controls.js';
import {fitLandscape} from '../../public/pacific-railway/src/viewport.js';
import {viewportGround,groundCamera,GROUND_BAND} from '../../public/pacific-railway/src/terrain.js';

test('dedo cercano no acelera; delante aumenta gradualmente y muy lejos activa turbo',()=>{
  const car={x:200,y:200,angle:0};
  assert.deepEqual(getTouchDrive(null,car),{throttle:0,brake:0,turbo:false});
  assert.equal(getTouchDrive({x:225,y:200},car).throttle,0);
  const near=getTouchDrive({x:270,y:200},car),far=getTouchDrive({x:340,y:200},car);
  assert(near.throttle>0&&far.throttle>near.throttle);assert.equal(far.brake,0);
  assert(getTouchDrive({x:440,y:200},car).turbo);
});
test('dedo detrás aplica freno progresivo y respeta la orientación en los loops',()=>{
  const right={x:250,y:200,angle:0},left={...right,angle:-Math.PI};
  const gentle=getTouchDrive({x:180,y:200},right),strong=getTouchDrive({x:70,y:200},right);
  assert(gentle.brake>0&&strong.brake>gentle.brake);assert.equal(strong.throttle,0);
  assert(getTouchDrive({x:400,y:200},left).brake>0);
  assert(getTouchDrive({x:70,y:200},left).throttle>0);
  assert(getTouchDrive({x:250,y:40},{...right,angle:-Math.PI/2}).throttle>0);
});
test('la vista mantiene 16:9 en pantallas horizontales y verticales',()=>{
  for(const [w,h]of [[1920,1080],[844,390],[390,844],[437,536]]){const v=fitLandscape(w,h);assert.equal(v.width/v.height,16/9);assert(v.width*v.scale<=w+.001);assert(v.height*v.scale<=h+.001);}
});
test('el canvas convierte correctamente coordenadas con la vista escalada',()=>{
  assert.deepEqual(localCanvasPoint({x:170,y:140},{left:10,top:50,width:640,height:360},1280,720),{x:320,y:180});
});
test('terreno y bases permanecen en el borde inferior al mover la cámara y cambiar zoom',()=>{
  for(const scale of [.1,.6,1.8])for(const cameraY of [-500,0,900]){const ground=viewportGround(cameraY,scale,720);assert.equal(ground.screenY,720-GROUND_BAND);assert(Math.abs((ground.worldY-cameraY)*scale-ground.screenY)<1e-8);}
  const track={minY:-308,maxY:588},camera=groundCamera(track,720,.9);
  assert(Math.abs(viewportGround(camera.cameraY,camera.scale,720).worldY-(track.maxY+96))<1e-8);
  assert((track.minY-camera.cameraY)*camera.scale>100*camera.scale);
});
