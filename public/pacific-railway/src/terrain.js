export const GROUND_BAND=24;
export function viewportGround(cameraY,scale,height){
  const screenY=height-GROUND_BAND;
  return {screenY,worldY:cameraY+screenY/scale};
}
export function groundCamera(track,height,preferredScale=.9){
  const groundY=track.maxY+96;
  const scale=Math.min(preferredScale,Math.max(.04,(height-100)/(groundY-track.minY+112)));
  return {scale,cameraY:groundY-(height-GROUND_BAND)/scale};
}
