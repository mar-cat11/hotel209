import {loadGLTF} from './loaders.js';
import {buildPainting} from './paintingprops.js';
import * as THREE from 'three';
import {buildPlatePickup} from './plateprops.js';

// Elevator-hall props: brass medal panel and card-key reader.
// One tiny shared environment gives both GLB brass and procedural props something to reflect.
const rng = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
const canvas = (w, h) => {const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')];};
const tex = (c, srgb = true) => {const t = new THREE.CanvasTexture(c); t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;};

let sharedEnv;
export function hallEnv(renderer) {
  if (sharedEnv) return sharedEnv;
  const [c, g] = canvas(256, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#fff4e0'); grad.addColorStop(.35, '#a89478'); grad.addColorStop(.46, '#8c7660'); grad.addColorStop(.55, '#4a3c30'); grad.addColorStop(1, '#2a241e');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#ffe2b0'; g.fillRect(0, 10, 256, 7);              // ceiling cove strip
  g.fillStyle = 'rgba(255,225,170,.8)'; g.fillRect(150, 40, 40, 30); // soft light patch (door-side glow)
  const pm = new THREE.PMREMGenerator(renderer);
  sharedEnv = pm.fromEquirectangular(tex(c)).texture; pm.dispose();
  return sharedEnv;
}

function brushed(w, h, base, spread, streaks = 2500, horizontal = true) {
  const [c, g] = canvas(w, h); g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < streaks; i++) {
    const a = rng(), x = rng() * w, y = rng() * h, l = 20 + rng() * w * .5;
    g.fillStyle = a > .5 ? `rgba(255,240,200,${(a - .5) * spread})` : `rgba(0,0,0,${(.5 - a) * spread * 1.4})`;
    horizontal ? g.fillRect(x, y, l, 1) : g.fillRect(y, x, 1, l);
  }
  return c;
}

// Soft round glow for lit lamps / LED.
let glowTex;
const glow = () => glowTex ??= (() => {const [c, g] = canvas(64, 64), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.25, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return tex(c, false);})();
function glowSprite(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map: glow(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .0}));
  s.scale.set(size, size, 1); s.raycast = () => {}; return s;
}
function lamp(parent, x, y, z0) {
  // chrome bezel + glass bead; lit() swaps the bead to warm white
  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(.0085, .0085, .006, 16), new THREE.MeshStandardMaterial({color: 0x3a3631, metalness: 1, roughness: .3}));
  bezel.rotation.x = Math.PI / 2; bezel.position.set(x, y, z0 + .003); parent.add(bezel);
  const mat = new THREE.MeshStandardMaterial({color: 0x1a1816, roughness: .15, metalness: .2, emissive: 0xffd9a0, emissiveIntensity: 0});
  const bead = new THREE.Mesh(new THREE.SphereGeometry(.0062, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  bead.rotation.x = Math.PI / 2; bead.position.set(x, y, z0 + .005); parent.add(bead);
  const halo = glowSprite(0xffd9a0, .06); halo.position.set(x, y, z0 + .012); parent.add(halo);
  return on => {mat.emissiveIntensity = on ? 2.4 : 0; mat.color.set(on ? 0xfff0d0 : 0x1a1816); halo.material.opacity = on ? .55 : 0;};
}

// Cached GLB load; viewer awaits it during the loading screen.
let medallionAssets;
export function loadMedallions() {
  if (!medallionAssets) {
    medallionAssets = Promise.all(['panel', 'cat', 'lodge', 'queen'].map(kind =>
      loadGLTF(`models/medallion_${kind}.glb`).then(a => a.scene)
    )).catch(error=>{medallionAssets=null;throw error;});
  }
  return medallionAssets;
}
export function buildMedalPanel(renderer, d) {
  // Meshy GLB plate (preloaded behind the loading screen). Local origin = wall surface, +z into the hall.
  const group = new THREE.Group(), hit = hitBox(.45, .29, .045, .0225); group.add(hit);
  let active = {sync() {}}, latest = {inserted: {}, flags: []};
  const prop = {group, hit, plates:{}, centers:[[-.1352,-.0120],[-.0022,-.0119],[.1307,-.0121]], assetsReady: false, sync(state) {latest = state; active.sync(state);}};
  prop.ready = loadMedallions().then(([panel, cat, lodge, queen]) => {
    const body = new THREE.Group(); body.position.z = .004;
    const env = hallEnv(renderer);
    const prepare = source => {
      const copy = source.clone(true);
      copy.traverse(o => {if (o.isMesh) {
        o.material = o.material.clone();
        o.material.envMap = env; o.material.envMapIntensity = 1.9;
        o.material.metalness = .95; o.material.roughness = .36;
        o.material.needsUpdate = true;
      }});
      return copy;
    };
    body.add(prepare(panel));
    const centers = [[-.1352,-.0120],[-.0022,-.0119],[.1307,-.0121]];
    const models = {cat, lodge, queen};
    const rimMat = new THREE.MeshStandardMaterial({color:0xffe3a0,metalness:.8,roughness:.22,envMap:env,envMapIntensity:2.5,emissive:0x7d4816,emissiveIntensity:.15});
    // Uniform 88/60 scaling gives 10.648 mm thickness. Back = floor + 0.5 mm.
    const scale = .088 / .060, seatZ = .022; // seat proud of the plate face
    const slots = d.slots.map((s, i) => {
      const [x,y] = centers[i], medal = prepare(models[s.motif]);
      const rim=new THREE.Mesh(new THREE.TorusGeometry(.0295,.0011,6,48),rimMat);rim.position.z=.004;medal.add(rim);
      medal.traverse(o=>{if(o.isMesh && o!==rim){o.material.roughness=.23;o.material.envMapIntensity=2.5; o.material.emissive=new THREE.Color(0xa86a26);o.material.emissiveIntensity=.4;}});
      medal.scale.setScalar(scale); medal.position.set(x,y,seatZ); body.add(medal);
      return {item:s.item, medal, lit:lamp(body,x,.082,.018)};
    });
    group.add(body);
    for(const s of slots)prop.plates[s.item]=s.medal;
    prop.dragGroup=body;
    active = {sync(state) {const have = state.inserted[d.id] ?? []; for (const s of slots) {const on = have.includes(s.item); s.medal.visible = on; s.lit(on);}}};
    active.sync(latest); prop.assetsReady = true;
  });
  return prop;
}

export function preloadLiftProps() {return loadMedallions();}

export function buildCardReader(renderer, d) {
  const env = hallEnv(renderer), g = new THREE.Group();
  const W = .10, H = .22, T = .011, B = .006;
  const rr = (w, h, r) => {const s = new THREE.Shape(); s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); return s;};
  const frameShape = rr(W, H, .008); frameShape.holes.push(new THREE.Path(rr(W - 2 * B, H - 2 * B, .004).getPoints(8)));
  const metal = new THREE.MeshStandardMaterial({map: tex(brushed(128, 256, '#4a4743', .5, 900, false)), color: 0xe0dcd6, metalness: 1, roughness: .34, envMap: env, envMapIntensity: 1.8});
  metal.emissive = new THREE.Color(0x14120f);
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, {depth: T, bevelEnabled: true, bevelThickness: .0012, bevelSize: .0012, bevelSegments: 2}), metal);
  frame.position.z = .004; g.add(frame);
  // black glass with fine scratches
  const [sc, sg] = canvas(256, 512); sg.fillStyle = '#060607'; sg.fillRect(0, 0, 256, 512);
  const sh = sg.createLinearGradient(0, 0, 256, 512); sh.addColorStop(0, 'rgba(255,255,255,.10)'); sh.addColorStop(.45, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(255,255,255,.04)'); sg.fillStyle = sh; sg.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 46; i++) {sg.strokeStyle = `rgba(200,200,210,${.12 + rng() * .35})`; sg.lineWidth = .6 + rng() * .5; sg.beginPath(); const x = rng() * 256, y = rng() * 512, a = rng() * Math.PI, l = 10 + rng() * 70; sg.moveTo(x, y); sg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); sg.stroke();}
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * B + .002, H - 2 * B + .002), new THREE.MeshStandardMaterial({map: tex(sc), color: 0xffffff, metalness: .1, roughness: .1, envMap: env, envMapIntensity: 1.8}));
  glass.position.z = .004 + T - .003; g.add(glass);
  const zf = .004 + T - .003;
  const surround = new THREE.Mesh(new THREE.BoxGeometry(.06, .017, .004), new THREE.MeshStandardMaterial({color: 0xd8d4ce, metalness: 1, roughness: .3, envMap: env, envMapIntensity: 2}));
  surround.position.set(-.005, .018, zf + .002); g.add(surround);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(.044, .0042, .0005), new THREE.MeshBasicMaterial({color: 0x020202})); slit.position.set(-.005, .018, zf + .0043); g.add(slit);
  const led = new THREE.MeshBasicMaterial({color: 0xff1a0a});
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.0034, 12, 8), led); bulb.position.set(.0315, .018, zf + .0008); g.add(bulb);
  const halo = glowSprite(0xff2020, .05); halo.material.opacity = .28; halo.position.set(.0315, .018, zf + .006); g.add(halo);
  g.add(hitBox(.14, .26, .035, .0175));
  return {group: g, hit: g.children.at(-1), sync(state) {
    const ok = state.flags.includes(d.ledFlag);
    led.color.set(ok ? 0x18ff4a : 0xff1a0a); halo.material.color.set(ok ? 0x30ff60 : 0xff2020);
  }};
}


function hitBox(w, h, depth, z) {const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), new THREE.MeshBasicMaterial({visible: false})); m.position.z = z; return m;}
// Loose medallion lying face-up on furniture (pickup). Root sits on the surface; the GLB's +z face points up.
export function buildMedallionPickup(renderer, d) {
  const group = new THREE.Group(), env = hallEnv(renderer);
  let shown = true, medal = null;
  const ready=loadMedallions().then(assets => {
    const copy = assets[{cat:1, lodge:2, queen:3}[d.motif ?? 'cat']].clone(true);
    copy.traverse(o => {if (o.isMesh) {
      o.material = o.material.clone(); o.material.envMap = env; o.material.envMapIntensity = 2.5;
      o.material.metalness = .95; o.material.roughness = .23;
      o.material.emissive = new THREE.Color(0xa86a26); o.material.emissiveIntensity = .4; o.material.needsUpdate = true;
    }});
    const size = new THREE.Box3().setFromObject(copy).getSize(new THREE.Vector3());
    copy.scale.setScalar((d.diameter ?? .08) / Math.max(size.x, size.y));
    copy.rotation.set(-Math.PI / 2, 0, d.medalAngle ?? 0);
    const box = new THREE.Box3().setFromObject(copy); copy.position.y = -box.min.y + .001;
    medal = copy; medal.visible = shown; group.add(medal);
  });
  return {group, ready, sync(state) {shown = !state.flags.includes(d.once); if (medal) medal.visible = shown;}};
}
export const LIFT_PROPS = {medallion: buildMedallionPickup, plate: (renderer,d) => buildPlatePickup(d,hallEnv(renderer)), painting: (renderer,d) => buildPainting(renderer,d,hallEnv(renderer)),  medalPanel: buildMedalPanel, cardReader: buildCardReader};

// Call-button light is separate from device scale and follows story state.
export function buildCallLamp(d) {
  const group=new THREE.Group();group.position.fromArray(d.position);group.rotation.y=d.rotation;
  const material=new THREE.MeshBasicMaterial({color:0x201a12});
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(...d.size),material);group.add(mesh);
  const halo=glowSprite(0xffda9b,.14);halo.position.z=.005;group.add(halo);
  let on=false;
  return {group,mesh,get on(){return on;},sync(state){on=state.flags.includes(d.flag);material.color.set(on?0xffe0a6:0x201a12);halo.material.opacity=on?.38:0;}};
}
