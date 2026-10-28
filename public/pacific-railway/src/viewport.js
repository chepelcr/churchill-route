export const LANDSCAPE_WIDTH=1280;
export const LANDSCAPE_HEIGHT=720;

export function fitLandscape(width,height){
  return {width:LANDSCAPE_WIDTH,height:LANDSCAPE_HEIGHT,scale:Math.min(width/LANDSCAPE_WIDTH,height/LANDSCAPE_HEIGHT)};
}

export function initViewport(){
  const root=document.getElementById('app-viewport');
  function resize(){const fit=fitLandscape(window.innerWidth,window.innerHeight);root.style.setProperty('--viewport-scale',fit.scale);}
  resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
  document.getElementById('landscape-fullscreen').addEventListener('click',async()=>{
    try{await document.documentElement.requestFullscreen?.();}catch{}
    try{await screen.orientation?.lock?.('landscape');}catch{}
    resize();
  });
}
