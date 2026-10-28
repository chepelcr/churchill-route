// Same distance thresholds as Churchill. The back half of the train brakes.
export const TOUCH_DEAD=30;
export const TOUCH_FULL=170;
export const TOUCH_TURBO=235;

export function getTouchDrive(pointer,vehicle){
  if(!pointer)return {throttle:0,brake:0,turbo:false};
  const dx=pointer.x-vehicle.x,dy=pointer.y-vehicle.y;
  const along=dx*Math.cos(vehicle.angle)+dy*Math.sin(vehicle.angle);
  const distance=Math.abs(along);
  const amount=Math.max(0,Math.min(1,(distance-TOUCH_DEAD)/(TOUCH_FULL-TOUCH_DEAD)));
  return {throttle:along>0?amount:0,brake:along<0?amount:0,turbo:along>TOUCH_TURBO};
}

export function localCanvasPoint(client,rect,width,height){
  return {x:(client.x-rect.left)*width/rect.width,y:(client.y-rect.top)*height/rect.height};
}
