// PixiJS hybrid scene — the WebGL half of the render stack (Milestone C).
// Owns the WORLD (backdrop, streamed surface tiles, vector roads, buildings,
// trees/palms) and every MOVING ENTITY (boats, peds, vendors, animals, traffic,
// trains, gulls, player). The canvas2d backend runs above it in overlay mode
// for landmarks, pier/bridge, weather, particles/floats, compass and minimap.
// New visual elements should land HERE, not in canvas2d.
import { Application, Container, Sprite, Graphics, Texture } from "pixi.js";
import { buildTileTexture } from "./tileTexture.js";
import { WORLD2D as W } from "../../world2d/index.js";
import {
  state, traffic, pedestrians, gulls, boats, parked, vendors, animals, trains,
} from "../../game/state.js";
import { traceVehicleSilhouette } from "../vehicleShapes.js";
import { paintVehicle } from "../canvas2d.js";

const COL = {
  water: 0x2a7fa8, land: 0xe8d5a0, beach: 0xf4d77a,
  asphalt: 0x3a3540, acera: 0xcec7b2, bridge: 0x8c8c8c,
  canopy: 0x3f7d3f, canopy2: 0x4f8f4a, trunk: 0x6b4a2e, frond: 0x2e8b57,
};

const num = (c) => (typeof c === "number" ? c : (typeof c === "string" && c[0] === "#") ? parseInt(c.slice(1), 16) : 0xffffff);

function hsl(h, s, l) { // h 0-360, s/l 0-1 → 0xRRGGBB
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

export class PixiScene {
  constructor() {
    this.app = new Application();
    this.tiles = new Map();
    this.pool = new Map();       // entity object -> display object
    this.playerKey = null;       // vehicleKey+color of the rasterized sprite
  }

  async init(canvas) {
    await this.app.init({
      canvas, resizeTo: window, background: COL.water, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
      preference: "webgl",
    });
    this.world = new Container();
    this.L = {
      backdrop: new Container(), surface: new Container(), roads: new Container(),
      buildings: new Container(), green: new Container(),
      sea: new Container(),      // boats (under land entities visually is fine)
      ground: new Container(),   // parked, peds, vendors, animals, traffic, trains
      player: new Container(),
      air: new Container(),      // gulls
    };
    this.world.addChild(this.L.backdrop, this.L.surface, this.L.roads, this.L.buildings,
      this.L.green, this.L.sea, this.L.ground, this.L.player, this.L.air);
    this.app.stage.addChild(this.world);

    const g = new Graphics();
    g.rect(0, 0, W.W, W.H).fill(COL.water);
    for (const p of W.LAND_POLYS || []) if (p.length >= 6) g.poly(p).fill(COL.land);
    for (const p of W.WATERS || []) if (p.length >= 6) g.poly(p).fill(COL.water);
    for (const p of W.BEACHES || []) if (p.length >= 6) g.poly(p).fill(COL.beach);
    this.L.backdrop.addChild(g);

    this.playerShadow = new Graphics();
    this.playerSprite = new Sprite();
    this.playerSprite.anchor.set(0.5);
    this.L.player.addChild(this.playerShadow, this.playerSprite);
    return this;
  }

  // ----- tiles ---------------------------------------------------------------
  _tileKey(t) { return t.tc * 100000 + t.tr; }

  _ensureTile(t) {
    const key = this._tileKey(t);
    if (this.tiles.has(key)) return;

    const sprite = new Sprite(buildTileTexture(t));
    sprite.x = t.x; sprite.y = t.y;
    sprite.scale.set(W.CELL);
    this.L.surface.addChild(sprite);

    // vector roads: acera shoulders under the asphalt, rounded joins — the
    // smooth look the 4px-texel surface grid can't give
    const roads = new Graphics();
    const ACERA = (W.META && W.META.aceraPx) || 8;
    for (const r of t.roads) {
      if (r.cls === "pedestrian") continue;
      this._stroke(roads, r.pts);
      roads.stroke({ width: r.w + ACERA * 2, color: COL.acera, cap: "round", join: "round" });
    }
    for (const r of t.roads) {
      if (r.cls === "pedestrian") continue;
      this._stroke(roads, r.pts);
      roads.stroke({ width: r.w, color: r.bridge ? COL.bridge : COL.asphalt, cap: "round", join: "round" });
    }
    this.L.roads.addChild(roads);

    const bld = new Graphics();
    for (const b of t.buildings) {
      bld.poly(b.pts).fill({ color: b.color != null ? num(b.color) : 0x785037 });
      bld.poly(b.pts).stroke({ width: 1.5, color: 0x000000, alpha: 0.18 });
    }
    this.L.buildings.addChild(bld);

    const green = new Graphics();
    for (const tr of t.trees || []) {
      const s = tr.s || 1;
      green.circle(tr.x + 2, tr.y + 3, 7 * s).fill({ color: 0x000000, alpha: 0.18 });
      green.circle(tr.x, tr.y, 7.5 * s).fill(COL.canopy);
      green.circle(tr.x - 2 * s, tr.y - 2 * s, 4.5 * s).fill(COL.canopy2);
    }
    for (const pa of t.palms || []) {
      const s = pa.s || 1;
      green.circle(pa.x + 3, pa.y + 3, 6 * s).fill({ color: 0x000000, alpha: 0.16 });
      green.circle(pa.x, pa.y, 1.8 * s).fill(COL.trunk);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (pa.sway || 0);
        green.moveTo(pa.x, pa.y);
        green.lineTo(pa.x + Math.cos(a) * 9 * s, pa.y + Math.sin(a) * 9 * s);
      }
      green.stroke({ width: 2.4 * s, color: COL.frond, cap: "round" });
    }
    this.L.green.addChild(green);

    this.tiles.set(key, { sprite, roads, bld, green });
  }

  _stroke(g, pts) {
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  }

  _cullTiles(keys) {
    for (const [key, rec] of this.tiles) {
      if (keys.has(key)) continue;
      rec.sprite.destroy({ texture: true, textureSource: true });
      rec.roads.destroy(); rec.bld.destroy(); rec.green.destroy();
      this.tiles.delete(key);
    }
  }

  // ----- entity makers (drawn once; only transforms update per frame) --------
  _makeCar(c) {
    const g = new Graphics();
    g.rect(-c.w / 2 + 3, -c.h / 2 + 3, c.w, c.h).fill({ color: 0x000000, alpha: 0.3 });
    g.rect(-c.w / 2, -c.h / 2, c.w, c.h).fill(num(c.color));
    if (c.kind === "truck") {
      g.rect(-c.w / 2, -c.h / 2, c.w * 0.62, c.h).fill(0xe8e4da);          // box
      g.rect(c.w / 2 - 7, -c.h / 2 + 1, 6, c.h - 2).fill(0x3a3a48);       // cab glass
    } else if (c.kind === "bus") {
      g.rect(-c.w / 2 + 3, -c.h / 2 + 1.5, c.w - 6, 3).fill(0xbfe3f0);    // window band
    } else {
      g.rect(-c.w * 0.15, -c.h / 2 + 1.5, c.w * 0.4, c.h - 3).fill({ color: 0xffffff, alpha: 0.35 });
    }
    g.rect(-c.w / 2, -c.h / 2, 2.5, c.h).fill(0x26222c);
    g.rect(c.w / 2 - 2.5, -c.h / 2, 2.5, c.h).fill(0x26222c);
    return g;
  }
  _makePed(pe) {
    const g = new Graphics();
    g.ellipse(1, 5, 4, 1.6).fill({ color: 0x000000, alpha: 0.25 });
    g.circle(0, 0, 2.6).fill(hsl(pe.hue || 0, 0.55, 0.55));
    g.circle(0, -2.6, 1.7).fill(0xe8b88a);
    return g;
  }
  _makeVendor(v) {
    const g = new Graphics();
    g.ellipse(1, 6, 7, 2).fill({ color: 0x000000, alpha: 0.25 });
    g.rect(-6, -4, 12, 8).fill(0xffffff);
    g.rect(-7, -7, 14, 4).fill(hsl(v.hue || 10, 0.7, 0.55));
    return g;
  }
  _makeAnimal(a) {
    const g = new Graphics();
    g.ellipse(0, 3, 5, 1.5).fill({ color: 0x000000, alpha: 0.22 });
    g.ellipse(0, 0, 5, 2.6).fill(a.cat ? 0x8a8a92 : 0x8a6a48);
    g.circle(4.5, -1, 1.8).fill(a.cat ? 0x8a8a92 : 0x8a6a48);
    return g;
  }
  _makeGull(_) {
    const g = new Graphics();
    g.moveTo(-5, 0); g.lineTo(0, -3); g.lineTo(5, 0);
    g.stroke({ width: 2, color: 0xf5f5f5, cap: "round", join: "round" });
    return g;
  }
  _makeBoat(b) {
    const g = new Graphics();
    const L = b.kind === "ferry" ? 56 : 26, H = b.kind === "ferry" ? 16 : 9;
    g.ellipse(0, H * 0.55, L * 0.55, 3).fill({ color: 0x0a3a52, alpha: 0.35 });
    g.roundRect(-L / 2, -H / 2, L, H, 4).fill(b.kind === "ferry" ? 0xf0ede4 : 0xffffff);
    if (b.kind === "ferry") {
      g.roundRect(-L * 0.3, -H * 0.95, L * 0.6, H * 0.55, 3).fill(0xd94f30);
    } else {
      g.roundRect(-L / 2 + 3, -H / 2 + 2, L - 6, H - 4, 3).fill(0x2a7fa8);
    }
    return g;
  }
  _makeTrain(tr) {
    const c = new Container();
    for (let k = 0; k < 3; k++) {
      const g = new Graphics();
      g.rect(-16, -7, 32, 14).fill(k === 0 ? 0xb03a2e : 0x9a6a3a);
      g.rect(-16, -7, 32, 3).fill({ color: 0x000000, alpha: 0.25 });
      c.addChild(g);
    }
    return c;
  }

  _sync(arr, layer, make, update) {
    for (const e of arr) {
      let d = this.pool.get(e);
      if (!d) { d = make(e); layer.addChild(d); this.pool.set(e, d); }
      d.__live = this._frame;
      update(e, d);
    }
  }

  _syncPlayer() {
    const p = state.p, veh = state.veh;
    const show = !state.attract && veh;
    this.playerShadow.visible = show; this.playerSprite.visible = show;
    if (!show) return;
    const key = state.vehicleKey + "|" + veh.color + "|" + veh.w;
    if (key !== this.playerKey) {
      this.playerKey = key;
      const S = 4, cw = (veh.w + 12) * S, chh = (veh.h + 12) * S;
      const cv = document.createElement("canvas");
      cv.width = cw; cv.height = chh;
      const g = cv.getContext("2d");
      g.setTransform(S, 0, 0, S, cw / 2, chh / 2);
      paintVehicle(g, state.vehicleKey, veh);
      this.playerSprite.texture?.destroy(true);
      this.playerSprite.texture = Texture.from(cv);
      this.playerSprite.scale.set(1 / S);
      this.playerShadow.clear();
      traceVehicleSilhouette(this.playerShadow, state.vehicleKey, veh);
      this.playerShadow.fill({ color: 0x000000, alpha: 0.35 });
    }
    const lift = (state.elev || 0) * 7;
    this.playerShadow.position.set(p.x + 4 + lift * 0.6, p.y + 6 + lift);
    this.playerShadow.rotation = p.a;
    this.playerShadow.alpha = Math.max(0.1, 1 - lift * 0.06);
    this.playerSprite.position.set(p.x, p.y - lift);
    this.playerSprite.rotation = p.a;
  }

  render(tms) {
    if (!this.world) return;
    this._frame = tms;

    // shared camera jitter so the canvas overlay shakes in lockstep
    const shake = state.cam.shake || 0;
    state.cam._sx = (Math.random() - 0.5) * shake;
    state.cam._sy = (Math.random() - 0.5) * shake;
    const camX = state.cam.x + state.cam._sx, camY = state.cam.y + state.cam._sy;
    const z = state.cam.zoom || 3;
    const sw = this.app.screen.width, sh = this.app.screen.height;
    this.world.scale.set(z);
    this.world.position.set(sw / 2 - camX * z, sh / 2 - camY * z);

    const hw = sw / 2 / z, hh = sh / 2 / z;
    const visible = W.visibleTiles(camX - hw, camY - hh, camX + hw, camY + hh);
    const keys = new Set();
    for (const t of visible) { keys.add(this._tileKey(t)); this._ensureTile(t); }
    this._cullTiles(keys);

    this._sync(boats, this.L.sea, this._makeBoat.bind(this), (b, d) => {
      d.position.set(b.x, b.y); d.scale.x = b.vx < 0 ? -1 : 1;
    });
    this._sync(parked, this.L.ground, this._makeCar.bind(this), (c, d) => {
      d.position.set(c.x, c.y); d.rotation = c.ang || 0;
    });
    this._sync(pedestrians, this.L.ground, this._makePed.bind(this), (pe, d) => {
      d.position.set(pe.x, pe.y + Math.sin(pe.ph || 0) * 0.6);
    });
    this._sync(vendors, this.L.ground, this._makeVendor.bind(this), (v, d) => {
      d.position.set(v.x, v.y);
    });
    this._sync(animals, this.L.ground, this._makeAnimal.bind(this), (a, d) => {
      d.position.set(a.x, a.y);
      d.scale.x = Math.cos(a.ang || 0) < 0 ? -1 : 1;
    });
    this._sync(traffic, this.L.ground, this._makeCar.bind(this), (c, d) => {
      d.position.set(c.x, c.y); d.rotation = c.ang;
    });
    this._sync(trains, this.L.ground, this._makeTrain.bind(this), (tr, d) => {
      for (let k = 0; k < 3 && k < d.children.length; k++) {
        const car = tr.cars[k];
        if (car) { d.children[k].position.set(car.x, car.y); d.children[k].rotation = car.ang; }
      }
    });
    this._sync(gulls, this.L.air, this._makeGull.bind(this), (gl, d) => {
      d.position.set(gl.x, gl.y + Math.sin(gl.ph || 0) * 2);
      d.scale.y = 0.7 + 0.5 * Math.abs(Math.sin(gl.ph || 0)); // wing flap
    });
    this._syncPlayer();

    // sweep entities that left their arrays
    for (const [e, d] of this.pool) {
      if (d.__live !== this._frame) { d.destroy({ children: true }); this.pool.delete(e); }
    }
  }
}
