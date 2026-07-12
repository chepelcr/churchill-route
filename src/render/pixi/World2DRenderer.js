// PixiJS/WebGL renderer for the streamed planar world (Milestone C perf path).
// Renders WORLD2D: per-tile surface textures + vector buildings in layered
// containers, with tile culling driven by WORLD2D.visibleTiles. A single "world"
// container carries the camera transform (pan+zoom) so the GPU does the scaling —
// this is the path that stays smooth zoomed out to the whole map, where the
// canvas2d per-tile blits get expensive. NOT yet wired behind the Renderer.js
// seam (the shipped game still uses canvas2d + the corridor WORLD); this drives
// the 2-D world in world2d-pixi.html and, later, Phase 4.
import { Application, Container, Sprite, Graphics } from "pixi.js";
import { buildTileTexture } from "./tileTexture.js";

const POI_COLOR = { kiosk: 0xffd23f, customer: 0x22d3ee, other: 0xe84855 };

export class World2DRenderer {
  constructor() {
    this.app = new Application();
    this.W = null;
    this.tiles = new Map(); // tileKey -> { sprite, gfx }
    this.pois = null;       // persistent POI Graphics (world coords)
    this.car = null;        // car Graphics
    this._veh = null;
  }

  // async — Pixi 8 needs Application.init() before use.
  async init(canvas, world) {
    this.W = world;
    await this.app.init({
      canvas,
      resizeTo: window,
      background: 0x12303e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: "webgl",
    });

    // camera-transformed world; layered so draw order is stable
    this.world = new Container();
    this.surfaceLayer = new Container();
    this.buildingLayer = new Container();
    this.poiLayer = new Container();
    this.entityLayer = new Container();
    this.world.addChild(this.surfaceLayer, this.buildingLayer, this.poiLayer, this.entityLayer);
    this.app.stage.addChild(this.world);

    this._buildPOIs();
    return this;
  }

  // POIs are global (not tiled) and few (~52) — draw once as world-space dots.
  _buildPOIs() {
    const g = new Graphics();
    for (const l of this.W.LANDMARKS) {
      const c = l.type === "kiosk" ? POI_COLOR.kiosk : POI_COLOR.other;
      g.circle(l.x, l.y, 6).fill(c);
    }
    for (const c of this.W.CUSTOMERS) g.circle(c.x, c.y, 5).fill(POI_COLOR.customer);
    this.poiLayer.addChild(g);
    this.pois = g;
  }

  setVehicle(veh) {
    this._veh = veh;
    if (this.car) this.car.destroy();
    const g = new Graphics();
    g.rect(-veh.w / 2, -veh.h / 2, veh.w, veh.h).fill(colorNum(veh.color));
    g.rect(-veh.w * 0.15, -veh.h / 2, veh.w * 0.4, veh.h).fill(colorNum(veh.roof));
    this.entityLayer.addChild(g);
    this.car = g;
  }

  _tileKey(t) { return t.tc * 100000 + t.tr; }

  _ensureTile(t) {
    const key = this._tileKey(t);
    if (this.tiles.has(key)) return;
    const sprite = new Sprite(buildTileTexture(t));
    sprite.x = t.x; sprite.y = t.y;
    sprite.scale.set(this.W.CELL); // 1 texel = CELL world px
    this.surfaceLayer.addChild(sprite);

    const gfx = new Graphics();
    for (const b of t.buildings) {
      gfx.poly(b.pts).fill({ color: b.color != null ? colorNum(b.color) : 0x785037, alpha: 0.9 });
    }
    this.buildingLayer.addChild(gfx);

    this.tiles.set(key, { sprite, gfx });
  }

  _cull(visibleKeys) {
    for (const [key, rec] of this.tiles) {
      if (visibleKeys.has(key)) continue;
      rec.sprite.destroy({ texture: true, textureSource: true });
      rec.gfx.destroy();
      this.tiles.delete(key);
    }
  }

  // cam = { x, y, zoom }; car = { x, y, a } (optional)
  render(cam, car) {
    const sw = this.app.screen.width, sh = this.app.screen.height, z = cam.zoom;
    // world transform: screen = (world - cam)*z + center
    this.world.scale.set(z);
    this.world.position.set(sw / 2 - cam.x * z, sh / 2 - cam.y * z);

    const halfW = sw / 2 / z, halfH = sh / 2 / z;
    const x0 = cam.x - halfW, y0 = cam.y - halfH, x1 = cam.x + halfW, y1 = cam.y + halfH;

    const visible = this.W.visibleTiles(x0, y0, x1, y1);
    const visibleKeys = new Set();
    for (const t of visible) { const k = this._tileKey(t); visibleKeys.add(k); this._ensureTile(t); }
    this._cull(visibleKeys);

    if (car && this.car) { this.car.position.set(car.x, car.y); this.car.rotation = car.a; }
    return visible.length;
  }
}

function colorNum(c) {
  if (typeof c === "number") return c;
  if (typeof c === "string" && c[0] === "#") return parseInt(c.slice(1), 16);
  return 0xffffff;
}
