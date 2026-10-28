import { atDistance, pointAt, PIECES } from './track.js';
import { localCanvasPoint } from './controls.js';
import { viewportGround, groundCamera, GROUND_BAND } from './terrain.js';
import { resourceUrl } from './paths.js';

export class Renderer {
  constructor(canvas, manifest) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.images=new Map();this.manifest=manifest;
    this.scale=.68;this.cameraX=0;this.cameraY=0;this.follow=true;this.parallax=true;this.seamTest=false;
    this.width=1;this.height=1;this.drag=null;this.interactive=true;this.groundLocked=false;
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);this.resize();
    canvas.addEventListener('pointerdown',e=>{if(!this.interactive)return;const p=this.localPoint(e);this.drag={x:p.x,y:p.y,cx:this.cameraX,cy:this.cameraY};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!this.drag||!this.interactive)return;const p=this.localPoint(e);this.follow=false;this.seamTest=false;this.cameraX=this.drag.cx-(p.x-this.drag.x)/this.scale;this.cameraY=this.drag.cy-(p.y-this.drag.y)/this.scale;this.onViewChange?.();});
    const end=()=>{this.drag=null;};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
    canvas.addEventListener('wheel',e=>{if(!this.interactive)return;e.preventDefault();const p=this.localPoint(e);this.zoom(Math.exp(-e.deltaY*.001),p.x,p.y);},{passive:false});
  }
  async load(){
    let loaded=0;await Promise.all(this.manifest.assets.map(a=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{this.images.set(a.id,image);this.onLoadProgress?.(++loaded/this.manifest.assets.length);resolve();};image.onerror=()=>reject(new Error(`No se pudo cargar ${a.svg}`));image.src=resourceUrl(a.svg);})));
  }
  localPoint(event){return localCanvasPoint({x:event.clientX,y:event.clientY},this.canvas.getBoundingClientRect(),this.width,this.height);}
  resize(){const width=this.canvas.parentElement.clientWidth,height=this.canvas.parentElement.clientHeight;if(width<1||height<1)return;this.width=width;this.height=height;const dpr=Math.min(window.devicePixelRatio||1,this.lowQuality?1:2);this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);this.ctx.setTransform(dpr,0,0,dpr,0,0);}
  resetView(level,track,distance,preferredScale){this.scale=preferredScale??(this.width<500?.45:.68);this.cameraY=level.start.y-this.height*.64/this.scale;if(this.groundLocked)Object.assign(this,groundCamera(track,this.height,this.scale));const p=atDistance(track,distance);this.cameraX=Math.max(level.start.x-100,p.x-this.width*.42/this.scale);this.follow=true;this.seamTest=false;this.onViewChange?.();}
  fit(level,track){this.follow=false;this.seamTest=false;this.scale=Math.min(1.2,(this.width-100)/(track.end.x-level.start.x+160),(this.height-100)/(track.maxY-track.minY+160));this.scale=Math.max(.04,this.scale);this.cameraX=level.start.x-50/this.scale;this.cameraY=(track.minY+track.maxY)/2-this.height/2/this.scale;this.onViewChange?.();}
  zoom(factor,px=this.width/2,py=this.height/2){const wx=this.cameraX+px/this.scale,wy=this.cameraY+py/this.scale;this.scale=Math.max(.04,Math.min(1.8,this.scale*factor));this.cameraX=wx-px/this.scale;this.cameraY=wy-py/this.scale;this.follow=false;this.onViewChange?.();}
  draw(level,track,distance,playing,dt){
    if(!this.images.size)return;
    const ctx=this.ctx,w=this.width,h=this.height;
    if(this.seamTest){this.cameraX+=dt*380;this.follow=false;}
    else if(playing&&this.follow){const front=atDistance(track,distance),targetX=front.x-w*(this.groundLocked?.42:.56)/this.scale,targetY=front.y-h*.54/this.scale;const ease=1-Math.exp(-dt*3);this.cameraX+=(targetX-this.cameraX)*ease;if(!this.groundLocked)this.cameraY+=(targetY-this.cameraY)*ease;}
    if(this.groundLocked)this.cameraY=track.maxY+96-(h-GROUND_BAND)/this.scale;
    ctx.clearRect(0,0,w,h);
    for(const layer of this.manifest.assets.filter(a=>a.type==='background-layer')){
      const image=this.images.get(layer.id);
      if(layer.parallax===0){ctx.drawImage(image,0,0,w,h);continue;}
      const tw=h*2,offset=((-(this.parallax?this.cameraX*this.scale:0)*layer.parallax)%tw+tw)%tw;
      for(let x=offset-tw;x<w;x+=tw){ctx.drawImage(image,x,0,tw,h);if(this.seamTest){ctx.save();ctx.strokeStyle='#eb6b3a99';ctx.setLineDash([4,5]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.restore();}}
    }
    const groundFrame=viewportGround(this.cameraY,this.scale,h);
    // A continuous grassy edge and soil fill, anchored to the canvas bottom.
    ctx.fillStyle='#92764e';ctx.fillRect(0,groundFrame.screenY,w,GROUND_BAND);
    ctx.fillStyle='#ba9a68';ctx.fillRect(0,groundFrame.screenY+5,w,5);
    ctx.fillStyle='#668354';ctx.fillRect(0,groundFrame.screenY-3,w,8);
    ctx.fillStyle='#99ac72';ctx.fillRect(0,groundFrame.screenY-3,w,2);
    const grassOffset=((-this.cameraX*this.scale)%38+38)%38;
    ctx.strokeStyle='#9eae77';ctx.lineWidth=1.5;
    for(let x=grassOffset-38;x<w;x+=38){ctx.beginPath();ctx.moveTo(x,groundFrame.screenY-2);ctx.lineTo(x+3,groundFrame.screenY-7);ctx.moveTo(x+3,groundFrame.screenY-2);ctx.lineTo(x+7,groundFrame.screenY-5);ctx.stroke();}
    ctx.save();ctx.scale(this.scale,this.scale);ctx.translate(-this.cameraX,-this.cameraY);
    const left=this.cameraX-350,right=this.cameraX+w/this.scale+350;
    const ground=groundFrame.worldY;
    for(const seg of track.segments){
      if(seg.x+seg.advance+40<left||seg.x>right)continue;
      const p=PIECES[seg.id],mid=pointAt(p,p.diameter?0:.5),center={x:seg.x+mid.x,y:seg.y+mid.y};
      const top=center.y+19,bottom=ground-18,post=this.images.get('support-post');
      if(bottom<=top)continue;
      ctx.globalAlpha=.8;ctx.drawImage(post,center.x-18,top,36,bottom-top);
      if(bottom-top>100)ctx.drawImage(this.images.get('support-brace'),center.x-75,bottom-128,128,128);
      ctx.drawImage(this.images.get('support-foot'),center.x-32,ground-25,64,32);ctx.globalAlpha=1;
    }
    const start=track.segments[0];
    ctx.drawImage(this.images.get('station-canopy'),start.x-16,start.y-128,288,160);
    for(const seg of track.segments)if(seg.x+seg.advance+40>=left&&seg.x<=right){const asset=this.manifest.assets.find(a=>a.id===seg.id);ctx.drawImage(this.images.get(seg.id),seg.x-asset.pivot.x,seg.y-asset.pivot.y,asset.width,asset.height);}
    ctx.drawImage(this.images.get('finish-flag'),track.end.x+20-21,track.end.y-165,96,176);
    if(this.markers)for(const marker of this.markers){if(marker.collected)continue;const p=atDistance(track,marker.distance);ctx.save();ctx.translate(p.x+Math.sin(p.angle)*85,p.y-Math.cos(p.angle)*85);ctx.fillStyle='#ffe388';ctx.strokeStyle='#b08445';ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?9:20;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
    for(let i=level.train.cars-1;i>=0;i--){
      const pos=atDistance(track,distance-i*level.train.spacing),role=i===0?'car-front':i===level.train.cars-1?'car-rear':'car-middle',id=level.train.skin&&level.train.skin!=='classic'?`${role}-${level.train.skin}`:role;
      ctx.save();ctx.translate(pos.x,pos.y-3);ctx.rotate(pos.angle);ctx.drawImage(this.images.get(id),-86,-100,176,112);ctx.restore();
    }
    ctx.restore();
    if(this.drivePointer){const {point,vehicle,braking,amount}=this.drivePointer;ctx.save();ctx.strokeStyle=braking?'#ef9a70':'#ffde8f';ctx.fillStyle=braking?'#ef9a7033':'#ffde8f33';ctx.lineWidth=2;ctx.setLineDash([5,6]);ctx.beginPath();ctx.moveTo(vehicle.x,vehicle.y);ctx.lineTo(point.x,point.y);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(point.x,point.y,18+amount*12,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
  }
}
