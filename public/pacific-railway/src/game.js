import { atDistance, buildTrack, validateLevel } from './track.js';

export function createRun(level) {
  const errors=validateLevel(level);if(errors.length)throw new Error(errors.join('\n'));
  const track=buildTrack(level),start=(level.train.cars-1)*level.train.spacing+90,finish=track.length-90;
  return {level:structuredClone(level),track,start,finish,distance:start,speed:0,topSpeed:0,throttle:0,brake:0,started:false,elapsed:0,complete:false,paused:false,stars:0,markers:[.25,.5,.75].map(f=>({distance:start+(finish-start)*f,collected:false}))};
}

export function updateRun(run,dt,input={}) {
  if(run.complete||run.paused)return run;
  dt=Math.max(0,Math.min(.05,dt));
  const brake=Math.max(0,Math.min(1,Number(input.brake)||0));
  const throttle=brake>0?0:Math.max(0,Math.min(1,Number(input.throttle)||0));
  run.throttle=throttle;run.brake=brake;
  if(throttle>0)run.started=true;
  if(run.started)run.elapsed+=dt;
  const point=atDistance(run.track,run.distance);
  // No idle thrust or speed floor: a resting train waits for the driver.
  const gravity=run.speed>0||throttle>0?-Math.sin(point.angle)*90:0;
  const resistance=run.speed>0?14+run.speed*.04:0;
  const acceleration=throttle*(input.turbo?280:220)+gravity-resistance-brake*400;
  run.speed=Math.max(0,Math.min(input.turbo?580:460,run.speed+acceleration*dt));run.topSpeed=Math.max(run.topSpeed,run.speed);
  run.distance=Math.min(run.finish,run.distance+run.speed*dt);
  for(const star of run.markers)if(!star.collected&&run.distance>=star.distance){star.collected=true;run.stars++;}
  if(run.distance>=run.finish)run.complete=true;
  return run;
}
