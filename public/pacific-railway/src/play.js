import {Renderer} from './renderer.js';
import {initShell} from './shell.js';
import {initViewport} from './viewport.js';
import {resourceUrl} from './paths.js';
initViewport();
const params=new URLSearchParams(location.search),embedded=params.get('embedded')==='1';
async function json(path){const response=await fetch(resourceUrl(path));if(!response.ok)throw new Error(`No se pudo cargar ${path}`);return response.json();}
try{
  const [manifest,levelOne]=await Promise.all([json('assets/manifest.json'),json('examples/valley-run.json')]);
  const renderer=new Renderer(document.getElementById('ride-canvas'),manifest);
  renderer.interactive=false;
  renderer.onLoadProgress=p=>{document.getElementById('boot-fill').style.width=p*100+'%';document.getElementById('boot-progress').textContent='Preparando el viaje… '+Math.round(p*100)+'%';};
  await renderer.load();
  let timer;
  const toast=text=>{const el=document.getElementById('toast');el.textContent=text;el.classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>el.classList.remove('visible'),3000);};
  const notify=(type,result)=>window.parent.postMessage({type,result},location.origin);
  const shell=initShell({manifest,renderer,levelOne,toast,embedded,initialSkin:params.get('skin'),onExit:()=>embedded?notify('churchill:railway:exit'):location.assign(new URL('../',resourceUrl('')).href),onComplete:result=>notify('churchill:railway:complete',result)});
  window.rielGame=Object.freeze({getScreen:shell.getScreen,getRun:()=>{const r=shell.getRun();return r?{distance:r.distance,speed:r.speed,elapsed:r.elapsed,stars:r.stars,complete:r.complete,paused:r.paused}:null;}});
  let last=performance.now();
  function frame(now){const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;shell.tick(dt);requestAnimationFrame(frame);}
  requestAnimationFrame(frame);
}catch(error){const el=document.getElementById('boot-progress');el.textContent=error.message;el.setAttribute('role','alert');if(embedded)window.parent.postMessage({type:'churchill:railway:error'},location.origin);console.error(error);}
