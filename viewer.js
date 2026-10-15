import {layout} from './layout.js';
import {V} from './version.js';
import {gltfLoader, loadTexture} from './loaders.js';
import {startBgm, playSe, setLoopVolume} from './bgm.js';
import {createChase} from './zombie.js';
import {createFlashlight} from './flashlight.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { moveCircle, collides } from './collision.js';

const $ = s => document.querySelector(s);
const touch = navigator.maxTouchPoints > 0 && matchMedia('(pointer:coarse)').matches;
const params = new URLSearchParams(location.search);
// Lightweight rendering everywhere; ?hq=1 restores full-size textures and MSAA on desktop.
document.body.classList.toggle('touchUI', touch);
const lite = touch || params.get('hq') !== '1';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);
const fogEnabled = params.get('fog') !== '0';
const atmosphereFog = new THREE.Fog(0x030706, 3.5, 15);
// Enable after environment captures so reflections match the comparison baseline.
function createFilmGrain() {
  if (params.get('grain') === '0') return;
  const layer = document.createElement('div'); layer.id = 'filmGrain';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {position:'fixed', inset:'0', pointerEvents:'none', zIndex:'1',
    backgroundImage:'radial-gradient(ellipse at 50% 45%, transparent 40%, #0003 100%)'});
  const tile = document.createElement('canvas'); tile.width = tile.height = 128;
  const ctx = tile.getContext('2d');
  // Blend grain continuously from normal strength to double strength during the outage.
  const makeFrames = strength => { const out = [];
    for (let f = 0; f < 6; f++) {
      const pixels = ctx.createImageData(128,128);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const white = Math.random() > .5 ? 255 : 0;
        pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = white;
        pixels.data[i+3] = Math.floor(Math.random()*strength);
      }
      ctx.putImageData(pixels,0,0); out.push(`url(${tile.toDataURL()})`);
    }
    return out; };
  const darkFrames = makeFrames(16), noise=document.createElement('div');
  Object.assign(noise.style,{position:'absolute',inset:'0'});layer.append(noise);
  document.body.append(layer);
  let frame = -1;
  return now => {const next=Math.floor(now/83)%darkFrames.length;
    noise.style.opacity=String(.5+.5*(flashlight?.progress??0));
    if(next!==frame){frame=next;noise.style.backgroundImage=darkFrames[frame];}
  };
}
let updateGrain;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 9000);
camera.rotation.order = 'YXZ';
let renderer, world, game, flashlight, chase, ready = false;
let yaw = 0, yawVel = 0, fwdVel = 0, checkPitch = 0, stepDist = 0;
let pixelRatio = Math.min(devicePixelRatio || 1, lite ? 2 : 2);
const keys = new Set();
const joy = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0, t0: 0, moved: 0 };

// ---------------------------------------------------------------- sky + sea
const SKY_GLSL = /* glsl */`
uniform vec3 moonDir;
vec3 skyBase(vec3 d){
  float haze = pow(clamp(1.0 - abs(d.y), 0.0, 1.0), 10.0);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 sky = mix(vec3(0.010, 0.020, 0.045), vec3(0.003, 0.007, 0.020), sqrt(up));
  sky += vec3(0.010, 0.016, 0.030) * haze;
  // moon halo (cheap)
  float c = max(dot(d, moonDir), 0.0);
  sky += vec3(0.30, 0.38, 0.55) * pow(c, 220.0) * 0.55 + vec3(0.08, 0.10, 0.16) * pow(c, 18.0) * 0.25;
  return sky;
}
`;
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, toneMapped: true,
  uniforms: { haze: { value: fogEnabled ? .025 : 0 }, moonDir: { value: new THREE.Vector3(-1, .197, -.36).normalize() } },
  vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
  fragmentShader: 'precision highp float;\n' + SKY_GLSL + /* glsl */`
  varying vec3 vD; uniform float haze;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec3 d = normalize(vD);
    vec3 col = skyBase(d);
    // stars
    vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, acos(clamp(d.y, -1., 1.)) / 3.14159265);
    vec2 g = uv * vec2(1500., 750.);
    vec2 cell = floor(g); float h = hash(cell);
    vec2 f = fract(g) - 0.5;
    float star = step(0.9965, h) * smoothstep(0.35, 0.02, length(f)) * smoothstep(0.02, 0.12, d.y);
    col += star * vec3(0.9, 0.95, 1.15) * (0.4 + 1.2 * hash(cell + 3.1));
    // moon disc
    float c = dot(d, moonDir);
    float disc = smoothstep(0.99982, 0.99988, c);
    col += disc * vec3(9.0, 8.8, 8.0);
    col = mix(col, vec3(.003, .007, .006), haze);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`
});
// tileable normal-slope map for the sea (mip-mapped, so distant water averages out instead of aliasing)
function makeWaveTexture(N = 512) {
  const h = new Float32Array(N * N);
  let seed = 1234567; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (const [cells, amp] of [[4, 1.0], [8, .6], [16, .38], [32, .22], [64, .12], [128, .06]]) {
    const g = new Float32Array(cells * cells).map(() => rnd());
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * cells, fy = y / N * cells; const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const x1 = (ix + 1) % cells, y1 = (iy + 1) % cells;
      const a = g[iy * cells + ix], b = g[iy * cells + x1], c = g[y1 * cells + ix], d = g[y1 * cells + x1];
      h[y * N + x] += amp * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xp = h[y * N + (x + 1) % N], xm = h[y * N + (x + N - 1) % N], yp = h[((y + 1) % N) * N + x], ym = h[((y + N - 1) % N) * N + x];
    const sx = (xp - xm) * 0.5 * 9, sy = (yp - ym) * 0.5 * 9;     // slope per texel scaled
    const i = (y * N + x) * 4;
    data[i] = Math.max(0, Math.min(255, 128 + sx * 127)); data[i + 1] = Math.max(0, Math.min(255, 128 + sy * 127)); data[i + 2] = 128; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
const seaMat = new THREE.ShaderMaterial({
  transparent: false, toneMapped: true, depthWrite: true,
  uniforms: { haze: { value: fogEnabled ? 1 : 0 }, moonDir: skyMat.uniforms.moonDir, t: { value: 0 }, waves: { value: makeWaveTexture() } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: 'precision highp float;\n' + SKY_GLSL + /* glsl */`
  varying vec3 vW; uniform float haze; uniform float t; uniform sampler2D waves;
  vec2 sl(vec2 p, float scale, vec2 vel, float amp, float rot){
    float c = cos(rot), s = sin(rot);
    vec2 q = mat2(c, -s, s, c) * p / scale + vel * t / scale;
    vec2 v = texture2D(waves, q).xy - 0.5;
    return mat2(c, s, -s, c) * v * 2.0 * amp;
  }
  void main(){
    vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam / dist;
    vec2 s = sl(vW.xz, 70.0, vec2(0.9, 0.3), 0.55, 0.0) + sl(vW.xz, 23.0, vec2(-0.5, 0.8), 0.45, 0.9)
           + sl(vW.xz, 7.0, vec2(0.6, -0.7), 0.35, 2.1) + sl(vW.xz, 2.3, vec2(-0.9, -0.2), 0.22, 4.0);
    vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
    vec3 R = reflect(-V, N); R.y = abs(R.y);
    float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
    vec3 col = skyBase(R) * F + vec3(0.0008, 0.0022, 0.0042) * (1.0 - F);
    float c = max(dot(R, moonDir), 0.0);
    float glint = pow(c, 4000.0) * 120.0 + pow(c, 700.0) * 10.0 + pow(c, 80.0) * 0.5;
    col += vec3(0.85, 0.92, 1.0) * glint * (0.35 + F);
    float fog = (1.0 - exp(-dist * 0.00035)) * haze;
    col = mix(col, skyBase(normalize(vec3(-V.x, 0.0, -V.z))), fog * 0.85);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`
});

// ---------------------------------------------------------------- material table
const DEFS = {
  Floor:    { map: ['floor_planks', 1.92, 1.8], albedo: [.47, .39, .31], rough: .38, env: .7, wear: .06 },
  Carpet:   { map: ['carpet', 1.1, 1.1], albedo: [.085, .085, .09], rough: .95, wear: .09, kind: 1 },
  CarpetX:  { map: ['carpet', 1.1, 1.1], albedo: [.085, .085, .09], rough: .95, wear: .09, kind: 1, rot: true },
  Wall:     { map: ['plaster_soft', 2.2, 2.2], albedo: [.80, .80, .78], rough: .85, wear: .05 },
  Ceiling:  { map: ['plaster_soft', 2.2, 2.2], albedo: [.62, .63, .62], rough: .9, wear: .04 },
  Fabric:   { map: ['fabric_soft', .8, .8], albedo: [.045, .047, .045], rough: .9, wear: .06 },
  Wood:     { map: ['wood', 1.8, 1.8], albedo: [.17, .11, .07], rough: .45, env: .4, wear: .06 },
  Door:     { map: ['wood', 1.8, 1.8], albedo: [.30, .20, .12], rough: .5, env: .3, wear: .07 },
  PanelWood:{ map: ['panel_soft', 1.2, 1.2], albedo: [.12, .095, .075], rough: .5, env: .3, wear: .05 },
  Stone:    { map: ['stone_tiles', 1.2, 1.2], albedo: [.30, .28, .25], rough: .4, env: .5, wear: .05 },
  StoneFloor: {map: ['stone_grey', 1, 1], albedo: [.5,.5,.5], rough: .9, wear: .08},
  StoneWall:{ map: ['stone_grey', 1.0, 1.0], albedo: [.36, .35, .33], rough: .55, wear: .04 },
  HallTile: { map: ['hall_tile', 1.2, 1.2], albedo: [.34, .34, .33], rough: .28, env: .6, wear: .05 },
  Groove:   { albedo: [.10, .09, .08], rough: .6, wear: 0 },
  Marble:   { map: ['marble', 1.8, 1.8], albedo: [.8, .8, .78], rough: .18, env: .6, wear: .04 },
  Granite:  { map: ['sparkle', 1.0, 1.0], albedo: [.025, .025, .028], rough: .12, env: .9, wear: .03 },
  Leather:  { map: ['leather', .8, .8], albedo: [.03, .03, .033], rough: .5, env: .3, wear: .05 },
  Linen:    { map: ['linen', .35, .35], albedo: [.82, .83, .82], rough: .92, wear: .02 },
  White:    { albedo: [.8, .8, .8], rough: .7, wear: .05 },
  Black:    { albedo: [.012, .012, .014], rough: .45, env: .5, wear: .05 },
  Trim:     { albedo: [.012, .012, .014], rough: .4, env: .5, wear: .05 },
  Plate:    { albedo: [.01, .01, .01], rough: .4, wear: 0 },
  DoorBronze: { albedo: [.12, .075, .035], rough: .72, env: .18, wear: .12 },
  DoorSteel: { albedo: [.065, .075, .08], rough: .75, env: .15, wear: .12 },
  Chrome:   { albedo: [.55, .55, .56], rough: .15, env: 1, wear: .12 },
  Steel:    { albedo: [.30, .33, .38], rough: .35, env: .5, wear: .12 },
  Brass:    { albedo: [.5, .36, .17], rough: .3, env: 1, wear: .08 },
  Porcelain:{ albedo: [.85, .86, .85], rough: .12, env: .6, wear: .03 },
  TV:       { albedo: [.004, .005, .006], rough: .12, env: 1.0, wear: .03 },
  Bathwater:{ albedo: [.06, .09, .095], rough: .05, env: 1.0, wear: 0 },
  Gravel:   { albedo: [.10, .10, .10], rough: .95, wear: .1 },
  DarkGlass:{ albedo: [.01, .015, .025], rough: .08, env: 1.0, wear: 0 },
  Plant:    { albedo: [.02, .06, .02], rough: .9, wear: 0 },
  CourtDrape: { map: ['fabric_soft', .35, .35], albedo: [.24, .18, .12], rough: .98, double: true },
  CourtSheer: { map: ['linen', .24, .24], albedo: [.78, .74, .65], rough: 1, double: true, opacity: .88 },
  CourtBark: { map: ['wood', .4, 1.8], albedo: [.12, .085, .045], rough: .95 },
  CourtLeaf: { albedo: [.11, .22, .055], rough: .8, double: true },
  CourtLeafDeep: { albedo: [.03, .06, .02], rough: .9, double: true },
  CourtLeafDark: { albedo: [.06, .13, .035], rough: .85, double: true },
  CourtLeafLight: { albedo: [.20, .30, .09], rough: .8, double: true },
  CourtSoil: { albedo: [.035, .024, .013], rough: 1, wear: .12 },
  CourtSoffit: { map: ['plaster_soft', 2.2, 2.2], albedo: [.58, .55, .49], rough: .9, wear: .02 },
  CourtFrame: { albedo: [.025, .028, .027], rough: .38, env: .3 },
  CourtRecess: { albedo: [.008, .008, .008], rough: 1 },
  CourtGlass: { albedo: [.08, .10, .11], rough: .12, env: .7, opacity: .12, double: true },
};
const EMISSIVE = { LED: [2.4, 1.75, 1.05], Lamp: [2.6, 1.9, 1.1], Exit: [0.25, 1.9, 0.5] };
const texCache = new Map(); let AVG = {};
startBgm('audio/bgm_loop.wav' + V, .45, {door: 'audio/se_door.wav' + V, step: 'audio/se_step.wav' + V, unlock: 'audio/se_unlock.wav' + V}, {merry: 'audio/merry_loop.wav' + V});
const allTex = [];
const textures1k=new Set(["floor_planks","plaster_soft","fabric_soft","wood","panel_soft","marble","leather","linen"]);
function getTex(name, w, h, rot = false) {
  const key = JSON.stringify([name,w,h,rot]);
  if (texCache.has(key)) return texCache.get(key);
  const t = loadTexture(`textures/${name}${lite && textures1k.has(name) ? '_1k' : ''}.jpg${V}`, {maxSize:lite?1024:0});
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / w, 1 / h); t.channel = 1;
  if (rot) { t.center.set(.5, .5); t.rotation = Math.PI / 2; }
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texCache.set(key, t); return t;
}
const WB = (params.get('wb') ?? '0.9,0.975,1.14').split(',').map(Number);

// shared wear / grime layer (one function injected into every lit material)
const WEAR_FN = /* glsl */`
float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(wh(i), wh(i+vec2(1,0)), f.x), mix(wh(i+vec2(0,1)), wh(i+vec2(1,1)), f.x), f.y); }
vec3 wearFn(vec3 c, vec3 p, vec3 n, float s, int kind){
  float g = wn(p.xz*2.7 + p.y*1.9)*0.6 + wn(p.xz*9.1 - p.y*5.3)*0.4;
  c *= 1.0 + s*0.9*(g-0.5);
  float vert = 1.0 - smoothstep(0.35, 0.7, abs(n.y));
  float low = (1.0 - smoothstep(0.0, 0.11, p.y)) * vert;
  c *= 1.0 - s*3.0*low*(0.35 + 0.65*wn(vec2(p.x+p.z, p.y*9.0)*vec2(3.,1.)));      // scuffs at the wall base
  float top = smoothstep(0.8, 1.0, n.y) * step(0.3, p.y);
  c = mix(c, vec3(dot(c, vec3(.33))) + 0.05, clamp(s*1.6*top*wn(p.xz*6.0), 0., .5));   // dust on upward faces
  c *= 1.0 - s*1.2*vert*smoothstep(0.55, 0.9, wn(vec2((p.x+p.z)*5., p.y*0.35)))*(0.4 + 0.6*clamp(p.y/2.6, 0., 1.));
  if (kind == 1) {   // carpet traffic wear along the corridor centre lines
    float d1 = (p.z > 7.6 && p.z < 31.0) ? abs(p.x - 7.1) : 9.0;
    float d2 = (p.x > 8.0 && p.z < 9.7) ? abs(p.z - 8.6) : 9.0;
    float d3 = (p.x > 8.0 && p.z > 28.1) ? abs(p.z - 29.6) : 9.0;
    float d = min(d1, min(d2, d3));
    float tr = exp(-d*d/0.25);
    c = mix(c, c*1.5 + 0.012, tr*0.5*wn(p.xz*vec2(1.5, 15.) + vec2(0., p.x*3.)));
  }
  return c;
}`;
function addWear(m, s, kind) {
  if (!s) return;
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;\n' + WEAR_FN)
      .replace('#include <map_fragment>', `#include <map_fragment>\n diffuseColor.rgb = wearFn(diffuseColor.rgb, vWP, normalize(vWN), ${s.toFixed(3)}, ${kind});`);
  };
  m.customProgramCacheKey = () => `wear${s}_${kind}`;
}
const PLANTS = { PachiraBark: ['pachira_bark', 0.55], PachiraLeaf: ['pachira_leaf', 1.0], CalatheaLeaf: ['calathea_leaf', 0.95] };
// CC0 Poly Haven plants (real leaf-shaped geometry): unlit-by-lightmap, warm uplight falloff with height instead.
function makePlantMaterial(base) {
  const [file, gain] = PLANTS[base];
  const t = loadTexture(`textures/${file}.jpg${V}`); allTex.push(t);
  t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  const m = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWy;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWy = (modelMatrix * vec4(position, 1.)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWy;')
      .replace('#include <map_fragment>', `#include <map_fragment>\n diffuseColor.rgb *= vec3(1.0, .84, .62) * ${gain.toFixed(3)} * (.30 + .70 * mix(1.0, .25, smoothstep(.1, 2.2, vWy)));`);
  };
  m.customProgramCacheKey = () => 'plant' + gain;
  m.name = base; return m;
}
const matCache = new Map();
const envMatsFor = new Map();     // chunk key -> materials needing that chunk's environment
function makeMaterial(base, group, lm, chunkKey) {
  const key = base + '|' + group;
  if (matCache.has(key)) return matCache.get(key);
  if(base.startsWith('Focus')){const m=makeMaterial(base.slice(5),group,lm,chunkKey).clone();m.lightMapIntensity=world.lightMapIntensity;matCache.set(key,m);return m;}
  if(base==='Room205LED' || base==='Room205Lamp'){const m=new THREE.MeshBasicMaterial({color:new THREE.Color(.018,.013,.008)});m.name=base;matCache.set(key,m);return m;}
  if (PLANTS[base]) { const pm = makePlantMaterial(base); matCache.set(key, pm); return pm; }
  if (base.startsWith('Circus')) {
    const photo = world.room205.posters.find(p => p.name === base);
    const bulb = base === 'CircusBulb' || base === 'CircusFlicker';
    const color = world.room205.palette[base.slice(6)] ?? [.8, .7, .5];
    const cm = bulb ? new THREE.MeshBasicMaterial({color: new THREE.Color(.18, .125, .062)}) :
      new THREE.MeshStandardMaterial({color: new THREE.Color(...color), roughness: .88, side: THREE.DoubleSide,
        lightMap: lm, lightMapIntensity: world.lightMapIntensity*(group==='r207'?.25:1)});
    if (photo) {
      // The atlas is shared by all prints; each print maps its own world-space bounds.
      let atlas = texCache.get('r205Photos');
      if (!atlas) {atlas = loadTexture('textures/r205_photos.jpg'+V); atlas.colorSpace=THREE.SRGBColorSpace; atlas.channel=1; allTex.push(atlas); texCache.set('r205Photos',atlas);}
      cm.map=atlas.clone(); cm.map.channel=1; cm.map.repeat.set(-1/(photo.w*4),1/(photo.h*3));
      cm.map.offset.set((photo.index%4+1)/4+photo.zmin/(photo.w*4),(2-Math.floor(photo.index/4))/3-photo.ymin/(photo.h*3));
      cm.color.setRGB(1,1,1); cm.map.needsUpdate=true;
    } else if (!bulb) addWear(cm,.07,0);
    cm.name=base; matCache.set(key,cm); return cm;
  }
  let m;
  if (EMISSIVE[base]) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(...EMISSIVE[base]) }); }
  else {
    const d = DEFS[base] ?? { albedo: [.5, .5, .5], rough: .7, wear: 0 };
    m = new THREE.MeshStandardMaterial({ roughness: d.rough, metalness: d.metal ?? 0, side: d.double ? THREE.DoubleSide : THREE.FrontSide });
    if (d.opacity) { m.transparent = true; m.opacity = d.opacity; m.depthWrite = false; m.forceSinglePass = true; }
    let tint = d.albedo.slice();
    if (d.map) {
      const [n, w, h] = d.map; m.map = getTex(n, w, h, !!d.rot);
      const a = AVG[n] ?? [.5, .5, .5];
      tint = tint.map((v, i) => Math.min(4, v / Math.max(a[i], 1e-3)));
    }
    if (d.metal) m.color.setRGB(...d.albedo);
    else { m.color.setRGB(tint[0] * WB[0], tint[1] * WB[1], tint[2] * WB[2]); m.lightMap = lm; m.lightMapIntensity = world.lightMapIntensity*(group==='r207'?.25:1); }
    m.envMapIntensity = d.env ?? 0;
    if (d.env) { if (!envMatsFor.has(chunkKey)) envMatsFor.set(chunkKey, []); envMatsFor.get(chunkKey).push(m); }
    addWear(m, d.wear ?? 0, d.kind ?? 0);
  }
  m.name = base;
  // Baked corridor materials also contain the two lift cabins. Their steel and
  // pale surfaces need a weaker flashlight response inside those recesses.
  m.userData.liftCabinSurfaces = group === 'corr';
  matCache.set(key, m); return m;
}
function addTileUV(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) { uv[2 * i] = x; uv[2 * i + 1] = z; }
    else if (nx >= nz) { uv[2 * i] = z; uv[2 * i + 1] = y; }
    else { uv[2 * i] = x; uv[2 * i + 1] = y; }
  }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
}

// ---------------------------------------------------------------- doors
const doors = [];
const dynObstacles = new Map();
function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
const leafTexBase = () => { const t = getTex('wood', 1.8, 1.8).clone(); t.channel = 0; t.repeat.set(.5, 1); t.needsUpdate = true; allTex.push(t); return t; };
let leafTex = null;
function clearOf(box, margin = .06) {
  const r = world.playerRadius + margin, p = camera.position;
  return !(p.x > box.min[0] - r && p.x < box.max[0] + r && p.z > box.min[1] - r && p.z < box.max[1] + r);
}
function buildHingedDoor(d) {
  leafTex ??= leafTexBase();
  const len = Math.hypot(d.other[0] - d.hinge[0], d.other[1] - d.hinge[1]);
  const dx = (d.other[0] - d.hinge[0]) / len, dz = (d.other[1] - d.hinge[1]) / len;
  const thC = Math.atan2(dx, dz), thO = Math.atan2(d.inward[0], d.inward[1]);
  let delta = thO - thC; while (delta > Math.PI) delta -= 2 * Math.PI; while (delta < -Math.PI) delta += 2 * Math.PI;
  const g = new THREE.Group(); g.position.set(d.hinge[0], 0, d.hinge[1]);
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, color: new THREE.Color(1.2, 0.75, 0.4), roughness: .55, emissive: new THREE.Color(.52, .32, .17), emissiveMap: leafTex });
  if (d.steel) {leafMat.map = leafMat.emissiveMap = null; leafMat.color.set(0x687777); leafMat.emissive.set(0x243333);}
  // Overlap the jambs by 2 cm, header by 2 cm, and floor by 1 cm.
  // Keep the hinge and collision boxes anchored to the original opening.
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.21, len + .04), leafMat); leaf.position.set(0, 1.095, len / 2); g.add(leaf);
  const metal = new THREE.MeshStandardMaterial({ color: d.steel ? 0x484d50 : 0x625039, metalness: .65, roughness: .72 });
  metal.name = d.steel ? 'DoorSteel' : 'DoorBronze';
  const lockMat = new THREE.MeshStandardMaterial({ color: 0x030304, roughness: .7 });
  lockMat.name = 'DoorLock';
  for (const s of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.06), lockMat);
    plate.name = 'lockPlate'; plate.position.set(s * .035, .99, len - .08); g.add(plate);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.14), metal); lever.position.set(s * 0.05, 0.99, len - 0.12 + 0.05); g.add(lever);
    const rose = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.05), metal); rose.position.set(s * 0.055, 0.99, len - 0.1); g.add(rose);
  }
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.45, d.height, len), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, d.height / 2, len / 2); g.add(hit);
  g.rotation.y = thC; scene.add(g);
  const o = { room: d.room, name: d.name, kind: 'door', hit, open: false, t: 0, dir: 0, center: [(d.hinge[0] + d.other[0]) / 2, (d.hinge[1] + d.other[1]) / 2] };
  const key = 'door' + d.room;
  const apply = () => { g.rotation.y = thC + delta * ease(o.t); dynObstacles.set(key, o.t < .5 ? d.closedBox : d.openBox); };
  o.update = dt => { if (o.dir) { o.t = Math.min(1, Math.max(0, o.t + o.dir * dt / 0.9)); if (o.t === 0 || o.t === 1) o.dir = 0; apply(); } };
  o.toggle = () => { if (o.dir !== 0) return; if (o.open && !clearOf(d.closedBox)) return; o.open = !o.open; o.dir = o.open ? 1 : -1; playSe('door', .8); };
  o.restore = saved => {Object.assign(o,saved);apply();};
  apply(); doors.push(o); return o;
}
function buildBathDoor(d) {
  const b = d.bath, c = b.closed, op = b.open;
  const sx = c[2] - c[0], sz = c[3] - c[1], h = 2.16, y0 = 0.04;
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(.62, .70, .68), transparent: true, opacity: .62, roughness: .35, emissive: new THREE.Color(.10, .115, .11), depthWrite: false });
  const g = new THREE.Group(); const panel = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), mat); panel.renderOrder = 5; g.add(panel);
  const bar = new THREE.MeshStandardMaterial({ color: 0x343a3c, roughness: .75, metalness: .4 });
  bar.name = 'DoorSteel';
  const alongX = sx > sz, len = alongX ? sx : sz;
  const c0 = [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2], c1 = [(op[0] + op[2]) / 2, (op[1] + op[3]) / 2];
  const travel = alongX ? Math.sign(c1[0] - c0[0]) : Math.sign(c1[1] - c0[1]);
  for (const s of [-1, 1]) {
    const hd = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.02 : 0.03, 0.5, alongX ? 0.03 : 0.02), bar);
    const off = -travel * (len / 2 - 0.07);
    hd.position.set(alongX ? off : s * (sx / 2 + .02), 1.0 - h / 2 - y0 + 0.0, alongX ? s * (sz / 2 + .02) : off); g.add(hd);
  }
  g.position.set(c0[0], y0 + h / 2, c0[1]); scene.add(g);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(alongX ? sx : .3, h, alongX ? .3 : sz), new THREE.MeshBasicMaterial({ visible: false })); g.add(hit);
  const o = { room: d.room, name: `${world.labels?.[d.room] ?? d.room}号室の浴室ドア`, kind: 'bath', hit, open: false, t: 0, dir: 0, center: c0 };
  const closedBox = { min: [c[0] - .04, c[1] - .04], max: [c[2] + .04, c[3] + .04] };
  const key = 'bath' + d.room;
  const apply = () => { const e = ease(o.t); g.position.x = c0[0] + (c1[0] - c0[0]) * e; g.position.z = c0[1] + (c1[1] - c0[1]) * e; dynObstacles.set(key, o.t < .5 ? closedBox : { min: [0, 0], max: [0, 0] }); };
  o.update = dt => { if (o.dir) { o.t = Math.min(1, Math.max(0, o.t + o.dir * dt / 0.8)); if (o.t === 0 || o.t === 1) o.dir = 0; apply(); } };
  o.toggle = () => { if (o.dir === 0) { o.open = !o.open; o.dir = o.open ? 1 : -1; playSe('door', .8); } };
  o.restore = saved => {Object.assign(o,saved);apply();};
  apply(); doors.push(o); return o;
}
function buildSigns() {
  for (const s of world.signs) {
    const t = loadTexture(`textures/${s.png}.png${V}`); allTex.push(t); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const glow = /^(room_|floor_2)/.test(s.png) ? new THREE.Color(2.2, 1.9, 1.4) : s.png === 'exit' ? new THREE.Color(1.6, 1.6, 1.6) : new THREE.Color(.75, .75, .75);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: t, color: glow }));
    m.position.set(s.x, s.z, s.y); m.rotation.y = Math.atan2(s.nx, s.ny); scene.add(m);
  }
}

// ---------------------------------------------------------------- chunks
const lmCache = new Map();
function getLM(g) {
  if (lmCache.has(g)) return lmCache.get(g);
  const t = loadTexture(`textures/lm_${g}${lite ? '_half' : ''}.jpg${V}`); allTex.push(t);
  t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.channel = 0; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  lmCache.set(g, t); return t;
}

async function loadChunk(url, key) {
  const gltf = await gltfLoader.loadAsync(url + V);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const gname = (o.name.match(/^(corr|court|tree|gl|r\d+|e\d+)/) ?? [''])[0];
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    addTileUV(o.geometry);
    const lm = /^(e\d+|gl|tree)$/.test(gname) ? null : getLM(gname);
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(m => makeMaterial(m.name.replace(/^Carousel/, '').replace(/__x.*$/, '').replace(/\.\d+$/, ''), gname, lm, key));
    o.material = Array.isArray(o.material) ? mats : mats[0];
    // Exported corridor Groove strips float ahead of the baked wood surfaces.
    // Hide these decorative overlays throughout the hall/corridors; keep baked wood intact.
    if(gname==='corr')for(const m of mats)if(m.name==='Groove')m.visible=false;
    o.matrixAutoUpdate = false; o.updateMatrix();
  });
  return gltf.scene;
}
const rooms = {};     // n -> {root, promise, door, inside}
let skyDome, sea;
function captureEnv(center, key, visibleRoots) {
  try {
    const cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cc = new THREE.CubeCamera(0.1, 9000, cube); cc.position.copy(center);
    skyDome.position.copy(center); sea.position.set(center.x, SEA_Y, center.z);
    const saved = [];
    for (const [n, r] of Object.entries(rooms)) if (r.root) { saved.push([r.root, r.root.visible]); r.root.visible = visibleRoots.includes(+n); }
    cc.update(renderer, scene);
    for (const [obj, v] of saved) obj.visible = v;
    const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromCubemap(cube.texture).texture;
    for (const m of envMatsFor.get(key) ?? []) { m.envMap = env; m.needsUpdate = true; }
    cube.dispose(); pm.dispose();
  } catch (e) { console.warn('env capture failed', e); }
}
function ensureRoom(n) {
  const r = rooms[n]; if (r.promise) return r.promise;
  r.promise = (async () => {
    const info = world.rooms[n];
    const root = await loadChunk(info.chunk, 'r' + n); root.visible = false; scene.add(root); r.root = root;
    if(n===207)await loadCarousel(root);
    await waitTextures();
    const b = info.bounds; captureEnv(new THREE.Vector3((b[0] + b[2]) / 2 + (n == 209 ? -1.2 : 0), 1.2, (b[1] + b[3]) / 2), 'r' + n, [n]);
    r.loaded = true; return root;
  })().catch(error=>{if(r.root)scene.remove(r.root);r.root=null;r.promise=null;throw error;});
  return r.promise;
}
let carousel = null;
// Carousel music (room 205 = internal 207): loud at the carousel, faint at the door, silent once out of the room.
// Outside the room the distance is measured through the doorway, so it isn't heard through walls.
function updateMerry() {
  const {room,roomMargin,doorReach,maxVolume,falloff}=layout.merry;
  const r = rooms[room]; if (!carousel || !r?.root) { setLoopVolume('merry', 0); return; }
  const p = camera.position, b = world.rooms[room].bounds, c = carousel.getWorldPosition(new THREE.Vector3()), dc = r.door.center;
  const inside = p.x > b[0] - roomMargin && p.x < b[2] + roomMargin && p.z > b[1] - roomMargin && p.z < b[3] + roomMargin;
  const doorToCarousel = Math.hypot(dc[0] - c.x, dc[1] - c.z), reach = doorToCarousel + doorReach;
  const d = inside ? Math.hypot(p.x - c.x, p.z - c.z) : (r.door.open || r.door.t > 0) ? Math.hypot(p.x - dc[0], p.z - dc[1]) + doorToCarousel : Infinity;
  setLoopVolume('merry', maxVolume * Math.max(0, 1 - d / reach) ** falloff);
}
async function loadCarousel(root) {
  const source=await loadChunk('chunks/r207_carousel.glb','r207');
  const parts=[];source.updateMatrixWorld(true);
  source.traverse(o=>{if(!o.isMesh)return;const geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();geo.applyMatrix4(o.matrixWorld);
    const colors=new Float32Array(geo.attributes.position.count*3);const c=o.material.color;for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;}geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    for(const name of Object.keys(geo.attributes))if(!['position','normal','uv','color'].includes(name))geo.deleteAttribute(name);parts.push(geo);});
  const geo=mergeGeometries(parts);for(const part of parts)part.dispose();
  // World-space bake UVs stay attached as the painted toy turns around its spindle.
  const pivot=new THREE.Vector3(9.53,0,.71);geo.translate(-pivot.x,-pivot.y,-pivot.z);
  carousel=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88,side:THREE.DoubleSide,lightMap:getLM('r207'),lightMapIntensity:world.lightMapIntensity*.25}));
  carousel.name='carouselRotating';carousel.position.copy(pivot);root.add(carousel);
}
let insideAny = false, expoNow = 1.9;
function updateRooms() {
  const p = camera.position; insideAny = false;
  // Partly drawn curtains reveal the opposing interiors through their gaps.
  // Keep those three interiors present while a guest is in a courtyard room.
  const courtyardView = (p.x>8 && p.x<21.3 && p.z>=16 && p.z<=21.8) || [201, 202, 220].some(n => {
    const b = world.rooms[n].bounds;
    return p.x > b[0] && p.x < b[2] && p.z > b[1] && p.z < b[3];
  });
  for (const [n, r] of Object.entries(rooms)) {
    const info = world.rooms[n];
    if (!r.root) continue;
    const b = info.bounds;
    const inside = p.x > b[0] - .3 && p.x < b[2] + .3 && p.z > b[1] - .3 && p.z < b[3] + .3;
    r.root.visible = inside || r.door.t > 0 || r.door.open || (courtyardView && [201, 202, 220].includes(+n));
    r.bath.hit.parent.visible = r.root.visible;
    if (inside) insideAny = true;
  }
  updateMerry();
  // Courtyard rooms see each other through their windows: if any one is drawn (e.g. its door is open while the
  // player stands in its doorway), draw all three so the view across the courtyard never loses furniture.
  const court = [201, 202, 220].filter(n => rooms[n]?.root);
  if (court.some(n => rooms[n].root.visible)) for (const n of court) { rooms[n].root.visible = true; rooms[n].bath.hit.parent.visible = true; }
}

// Gameplay assets use the same cache generation as the baked scene.
const specialDoors = new Map();
function setGamePose(x,z,degrees,pitch=0) {camera.position.set(x,world.eyeHeight,z);yaw=THREE.MathUtils.degToRad(degrees);checkPitch=THREE.MathUtils.degToRad(pitch);yawVel=fwdVel=0;camera.rotation.set(checkPitch,yaw,0);updateRooms();}
async function initGameplay() {
  const [{createGame, preloadLiftProps, preloadBoxProps, preloadClown}, data] = await Promise.all([import('./game.js'), fetch('story.json'+V).then(r=>r.json())]);
  await Promise.all([preloadLiftProps(), preloadBoxProps(), preloadClown()]);   // preload medallions and hinged boxes behind the loading screen
  const css=document.createElement('link');css.rel='stylesheet';css.href='game.css'+V;document.head.append(css);
  for(const d of data.specialDoors) {
    if(d.type==='exit') {
      const o=buildHingedDoor({...d,room:d.id,steel:true});
      o.geometryToggle=o.toggle;o.toggle=()=>{if(o.open || game.unlock(d.id))o.geometryToggle();};
      o.openDoor=()=>{if(!o.open)o.geometryToggle();};specialDoors.set(d.id,o);
    } else {
      const panels=[];
      for(const sign of [-1,1]) {const panel=new THREE.Mesh(new THREE.BoxGeometry(.045,2.35,.60),new THREE.MeshStandardMaterial({color:0x777d7d,roughness:.4,metalness:.5,emissive:0x252b2c}));panel.position.set(4.405+(sign===1?-.008:0),1.095,d.z+sign*.285);panel.name='liftSlidingPanel';scene.add(panel);panels.push(panel);}
      const hit=new THREE.Mesh(new THREE.BoxGeometry(.16,2.19,1.08),new THREE.MeshBasicMaterial({visible:false}));hit.position.set(4.515,1.095,d.z);scene.add(hit);
      const o={id:d.id,kind:'lift',name:d.id==='rightLift'?'右エレベーター':'左エレベーター',hit,open:false,t:0,dir:0,center:[4.515,d.z]};
      const box={min:[4.49,d.z-.54],max:[4.54,d.z+.54]};dynObstacles.set(d.id,box);
      o.toggle=()=>game.interact(d.id);
      o.openDoor=()=>{o.open=true;o.dir=1;};
      o.restore=saved=>{Object.assign(o,saved);panels.forEach((p,i)=>p.position.z=d.z+(i===0?-1:1)*(.285+ease(o.t)*.59));if(o.t===1)dynObstacles.delete(d.id);else dynObstacles.set(d.id,box);};
      o.closeDoor=()=>{if(o.t>0){o.open=false;o.dir=-1;dynObstacles.set(d.id,box);}};
      o.update=dt=>{if(!o.dir)return;o.t=Math.min(1,Math.max(0,o.t+o.dir*dt));panels.forEach((p,i)=>p.position.z=d.z+(i===0?-1:1)*(.285+ease(o.t)*.59));if(o.t===1){o.dir=0;dynObstacles.delete(d.id);}else if(o.t===0)o.dir=0;};
      doors.push(o);specialDoors.set(d.id,o);
    }
  }
  for(const [n,room] of Object.entries(rooms)) {
    const id='room'+(world.labels?.[n]??n);
    const d=room.door;d.geometryToggle=d.toggle;d.toggle=()=>{if(d.open || game.unlock(id))d.geometryToggle();};
  }
  flashlight=createFlashlight(scene,camera);await flashlight.ready;
  game=createGame({playSe,mode,beforeLeftLift:()=>chase.checkpoint(), ending:()=>!!chase?.ended,data,scene,camera,rooms,flashlight,doorObjects:specialDoors,jump:setGamePose,debug:params.get('debug')==='1',renderer,canReach:(position,room)=>{
    const target=new THREE.Vector3(...position),distance=camera.position.distanceTo(target);
    if(distance>4.5 || (room && !rooms[room].root.visible))return false;
    const r=new THREE.Raycaster(camera.position,target.sub(camera.position).normalize(),.01,distance-.25);
    const blocks=r.intersectObjects(scene.children,true).filter(h=>visibleInScene(h.object) && h.object.isMesh && h.object.material.visible!==false && !h.object.material.transparent && /^(corr|court|r\d+)_?/.test(h.object.name));
    if(blocks.length)return false;
    const closedHits=r.intersectObjects(doors.filter(d=>!d.open).map(d=>d.hit),false);
    return !closedHits.length;
  }});
  await game.ready;
  chase=await createChase({messages:data.messages,scene,camera,world,game,doors,specialDoors,dynObstacles,jump:setGamePose,pose:()=>[camera.position.x,camera.position.z,THREE.MathUtils.radToDeg(yaw),THREE.MathUtils.radToDeg(checkPitch)],debug:params.get('debug')==='1'});
  // Fixed room leaves stay baked; matching hit volumes use the normal door reach/occlusion rules.
  for (const obstacle of world.obstacles.filter(o => /^door\d+$/.test(o.n))) {
    const n=Number(obstacle.n.slice(4)), id='room'+world.labels[n];
    const [x0,z0]=obstacle.min,[x1,z1]=obstacle.max;
    const hit=new THREE.Mesh(new THREE.BoxGeometry(x1-x0,2.15,z1-z0),new THREE.MeshBasicMaterial({visible:false}));
    hit.position.set((x0+x1)/2,1.075,(z0+z1)/2);scene.add(hit);
    data.doors[id]={broken:true};
    doors.push({room:n,name:world.labels[n]+'号室のドア',kind:'broken',hit,open:false,center:[hit.position.x,hit.position.z],update:()=>{},toggle:()=>game.unlock(id)});
  }
  // The table and plush are baked geometry in r207; game.js owns only their interaction.
}

// ---------------------------------------------------------------- input
addEventListener('keydown', e => {
  if (game?.paused || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'Space' && e.target.closest?.('#gameUI button')) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (ready) keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); joy.active = false; joy.id = joy.tapId = null; joy.x = joy.y = 0; $('#knob').style.transform = ''; });
for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'touchmove']) document.addEventListener(type, e => {if(!e.target.closest?.('#gameUI'))e.preventDefault();}, { passive: false });
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function visibleInScene(o) { for (let p=o;p;p=p.parent) if (!p.visible) return false; return true; }
function pickDoor(cx, cy) {
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera); ray.far = 4.5;
  const candidates = [...doors, ...(game?.objects.values() ?? [])].filter(d=>d.kind!=='lift' && visibleInScene(d.hit));
  const hits = ray.intersectObjects(candidates.map(d => d.hit), false);
  if (!hits.length) return null;
  // A closed door or a wall must not allow a click into the next room.
  const nearest = hits[0];
  const walls=ray.intersectObjects(scene.children,true).filter(h=>h.object.isMesh && h.object.material.visible !== false && visibleInScene(h.object) && !h.object.material.transparent && /^(corr|court|r\d+)_?/.test(h.object.name));
  if(walls[0] && walls[0].distance < nearest.distance-.03) return null;
  return candidates.find(d => d.hit === nearest.object);
}
function tapAt(x, y) { if(game?.paused)return; const d = pickDoor(x, y); if (d) d.toggle(); }
function bindPointer(el) {
  el.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse' && ready) { const d = pickDoor(e.clientX, e.clientY); el.style.cursor = d ? 'pointer' : 'default'; }
    if (game?.paused) return;
    if (e.pointerId === joy.id) updateStick(e);
    else if (e.pointerId === joy.tapId) {
      yaw -= (e.clientX - joy.lookX) * .005; checkPitch = Math.max(-1.2, Math.min(1.2, checkPitch - (e.clientY - joy.lookY) * .005));
      joy.lookMoved = Math.max(joy.lookMoved, Math.hypot(e.clientX - joy.tapX, e.clientY - joy.tapY));
      joy.lookX = e.clientX; joy.lookY = e.clientY;
    }
  });
  el.addEventListener('pointerdown', e => {
    if (!ready || game?.paused || e.pointerType === 'mouse') return;
    const rect = $('#stick').getBoundingClientRect(), cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
    if (touch && Math.hypot(e.clientX - cx, e.clientY - cy) <= rect.width / 2 + 10 && joy.id === null) {
      joy.id = e.pointerId; joy.active = true; joy.cx = cx; joy.cy = cy; joy.t0 = performance.now(); joy.moved = 0; joy.x = joy.y = 0;
      updateStick(e);
      el.setPointerCapture(e.pointerId);
    } else if (joy.tapId == null) { joy.tapId = e.pointerId; joy.tapX = joy.lookX = e.clientX; joy.tapY = joy.lookY = e.clientY; joy.lookMoved = 0; joy.tapT = performance.now(); el.setPointerCapture(e.pointerId); }
  });
  const end = e => {
    if (e.pointerId === joy.id) {
      joy.id = null; joy.active = false; joy.x = joy.y = 0; $('#knob').style.transform = '';
    } else if (e.pointerId === joy.tapId) {
      joy.tapId = null;
      if (e.type !== 'pointercancel' && joy.lookMoved < 14 && performance.now() - joy.tapT < 350 && Math.hypot(e.clientX - joy.tapX, e.clientY - joy.tapY) < 14) tapAt(e.clientX, e.clientY);
    }
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('click', e => { if (e.pointerType === 'mouse' || !touch) tapAt(e.clientX, e.clientY); });
}
function updateStick(e) {
  const R = 50; let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
  joy.moved = Math.max(joy.moved, Math.hypot(dx, dy));
  const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
  joy.x = dx / R; joy.y = dy / R; $('#knob').style.transform = `translate(${dx}px,${dy}px)`;
}

// ---------------------------------------------------------------- loop
let gameTime = 0;
let last = 0, frames = 0, acc = 0, fps = 0, roomTimer = 0;
const YAW_RATE = Math.PI / 2;
const SEA_Y = -4.2;
function animate(now) {
  if (sizedW !== innerWidth || sizedH !== innerHeight) resize();   // iOS sometimes skips resize events (toolbar / app switch)
  const dt = Math.min((now - last) / 1000 || 0, 0.05); last = now;
  const gameDt=game?.timeStopped?0:dt;gameTime+=gameDt;
  seaMat.uniforms.t.value = gameTime;
  if(!chase?.ended)game?.update(gameTime);
  if(gameDt && carousel && rooms[207].root.visible && camera.position.distanceTo(carousel.position)<8)carousel.rotation.y+=gameDt*Math.PI*2/14;
  if (ready) {
    document.body.classList.toggle('controlsPaused', !!game?.paused);
    const left = keys.has('ArrowLeft') || keys.has('KeyA'), right = keys.has('ArrowRight') || keys.has('KeyD');
    const fwd = keys.has('ArrowUp') || keys.has('KeyW'), back = keys.has('ArrowDown') || keys.has('KeyS');
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    let turn = (left ? 1 : 0) - (right ? 1 : 0), move = (fwd ? 1 : 0) - (back ? 1 : 0);
    if (game?.paused) {turn = move = 0; keys.clear(); joy.active = false; joy.id = joy.tapId = null; joy.x = joy.y = 0; $('#knob').style.transform = ''; yawVel = fwdVel = 0;}
    if (joy.active) { const dz = 0.12; turn += -(Math.abs(joy.x) < dz ? 0 : joy.x); move += -(Math.abs(joy.y) < dz ? 0 : joy.y); }
    turn = Math.max(-1, Math.min(1, turn)); move = Math.max(-1, Math.min(1, move));
    yawVel += (turn * YAW_RATE - yawVel) * (1 - Math.exp(-dt * 9));
    const speed = (run || (joy.active && Math.hypot(joy.x, joy.y) > 0.95)) ? 3.2 : 1.55;
    fwdVel += (move * speed - fwdVel) * (1 - Math.exp(-dt * 8));
    yaw += yawVel * dt;
    if (Math.abs(fwdVel) > 0.003) {
      const px = camera.position.x, pz = camera.position.z;
      const p = moveCircle(camera.position.x, camera.position.z, -Math.sin(yaw) * fwdVel * dt, -Math.cos(yaw) * fwdVel * dt, world, [...dynObstacles.values()]);
      stepDist += Math.hypot(p[0] - px, p[1] - pz); if (stepDist > 1.4) { stepDist = 0; playSe('step', .5 + Math.random() * .15, .92 + Math.random() * .16); }
      camera.position.x = p[0]; camera.position.z = p[1];
    }
    camera.position.y = world.eyeHeight; camera.rotation.set(checkPitch, yaw, 0);
    if(!chase?.ended)for (const d of doors) d.update(game?.liftEventActive && d.id==='leftLift'?dt:gameDt);
    chase?.update(gameDt,dt);
    roomTimer += dt; if (roomTimer > .15) { roomTimer = 0; updateRooms(); }
    const baseE = parseFloat(params.get('exp') ?? '1.25'); const targetE = insideAny ? baseE : baseE * parseFloat(params.get('corrx') ?? '1.7');
    expoNow += (targetE - expoNow) * (1 - Math.exp(-dt * 1.5)); renderer.toneMappingExposure = expoNow;
    frames++; acc += dt;
    if (acc >= 2) { fps = frames / acc; frames = 0; acc = 0; if (lite && fps < 28 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - .25); resize(); } }
  }
  skyDome.position.copy(camera.position); sea.position.set(camera.position.x, SEA_Y, camera.position.z);
  flashlight?.update(game?.presentation.viewCamera ?? camera,now/1000,game?.liftEventActive ? .15 : 1);
  const movie=chase?.movie;
  renderer.render(movie?.scene ?? scene, movie?.camera ?? game?.presentation.viewCamera ?? camera);
  updateGrain?.(now);
  if(!chase?.ended)game?.presentation.render();
}
let sizedW = 0, sizedH = 0;
function resize() {
  if (!renderer) return;
  sizedW = innerWidth; sizedH = innerHeight;
  camera.aspect = innerWidth / innerHeight;
  const hfov = 92;
  camera.fov = camera.aspect >= 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov / 2)) / camera.aspect)) : 88;
  camera.updateProjectionMatrix(); renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 150));
visualViewport?.addEventListener('resize', resize); addEventListener('pageshow', () => setTimeout(resize, 50));
async function waitTextures() {
  const t0 = performance.now();
  while (performance.now() - t0 < 25000) {
    const ts = [...texCache.values(), ...allTex];
    if (ts.every(t => t.image && (t.image.width > 0 || t.image.naturalWidth > 0))) return;
    await new Promise(r => setTimeout(r, 60));
  }
  throw new Error('Texture loading timed out');
}
function setLoad(p) { $('#lb').style.width = (p * 100) + '%'; }   // progress bar only; no per-room text

async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: !lite, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('check') });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Stable layer categories; within each category draw distant windows first, near windows last.
  const tPrio = m => { const n = m?.name; return n === 'CourtGlass' || n === 'DarkGlass' ? 0 : n === '220CurtainHaze' ? 2 : 1; };
  renderer.setTransparentSort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || tPrio(a.material) - tPrio(b.material) || b.z - a.z || a.id - b.id);
  renderer.toneMapping = params.get('tm') === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
  renderer.toneMappingExposure = parseFloat(params.get('exp') ?? '1.25');
  document.body.prepend(renderer.domElement); resize(); bindPointer(renderer.domElement);
  world = await (await fetch('scene.json' + V)).json();
  AVG = await (await fetch('textures/avg.json' + V)).json();
  camera.position.set(world.start.x, world.eyeHeight, world.start.z); yaw = THREE.MathUtils.degToRad(world.start.yawDeg);
  skyDome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), skyMat); skyDome.frustumCulled = false; skyDome.renderOrder = -2; scene.add(skyDome);
  sea = new THREE.Mesh(new THREE.CircleGeometry(6000, 64).rotateX(-Math.PI / 2), seaMat); sea.frustumCulled = false; sea.renderOrder = -1; scene.add(sea);
  const corr = await loadChunk(world.corridorChunk, 'corr'); scene.add(corr);
  setLoad(.35);
  for (const d of world.doors) { const o = buildHingedDoor(d); const b = buildBathDoor(d); rooms[d.room] = { door: o, bath: b }; }
  buildSigns();
  await waitTextures();
  captureEnv(new THREE.Vector3(7.0, 1.3, 19.0), 'corr', []);
  // Sequential decoding/cube captures keep startup GPU and memory peaks bounded.
  // Lite mode retains half-size lightmaps and normal mesh frustum culling.
  const roomNumbers = Object.keys(world.rooms).map(Number);
  for (const [i, n] of roomNumbers.entries()) {
    setLoad(.35 + .6 * i / roomNumbers.length);
    await ensureRoom(n);
  }
  await initGameplay();
  // Sea clue props are built separately from hotel/courtyard meshes.
  for (const name of ['seaIsland', 'seaShip']) scene.getObjectByName(name)?.traverse(o => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.fog = true;
    o.material.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>',
        `#ifdef USE_FOG
 float distantHaze = min(.12, vFogDepth * .000035);
 gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, distantHaze);
 #endif`);
    };
    o.material.customProgramCacheKey = () => 'seaLandmarkHaze';
  });
  flashlight.register(scene);
  setLoad(.95);
  scene.fog = fogEnabled ? atmosphereFog : null;
  updateGrain = createFilmGrain();
  ready = true; setLoad(1);
  const hideLoading = () => { $('#loading').style.opacity = 0; $('#loading').style.pointerEvents = 'none'; setTimeout(() => $('#loading').remove(), 900); };
  hideLoading();
  renderer.setAnimationLoop(animate); updateRooms();
  if (params.has('check') || params.get('debug') === '1') window.hotelCheck = {
    ready: true, camera, world, doors, rooms,
    setPose(x, z, yawDeg, pitchDeg = 0) { camera.position.x = x; camera.position.z = z; yaw = THREE.MathUtils.degToRad(yawDeg); checkPitch = THREE.MathUtils.degToRad(pitchDeg); yawVel = 0; fwdVel = 0; updateRooms(); },
    async openRoom(n) { await ensureRoom(n); await waitTextures(); const d = rooms[n].door; if (!d.open) (d.geometryToggle ?? d.toggle)(); return true; },
    async loadRoom(n) { await ensureRoom(n); await waitTextures(); },
    stats() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, fps, pixelRatio, gameTime, pos: camera.position.toArray(), yaw }; },
    collides(x, z) { return collides(x, z, world, [...dynObstacles.values()]); },
    pick: (x, y) => pickDoor(x, y)?.name,
    game, flashlight, specialDoors, chase,
    move(dx,dz) {const p=moveCircle(camera.position.x,camera.position.z,dx,dz,world,[...dynObstacles.values()]);camera.position.x=p[0];camera.position.z=p[1];updateRooms();return p;},
    scene,

  };
}
let mode = 'normal';
const start = () => { $('#loading').classList.remove('title');
  // 「読み込み中」 with dots cycling 1→2→3→1 while the bar fills (pad keeps the word centred)
  const lt = $('#lt'); lt.innerHTML = '<span class="pad"></span>読み込み中<span class="dots">.</span>'; let n = 1;
  const tick = setInterval(() => { const d = lt.querySelector('.dots'); if (!d || !document.querySelector('#loading')) return clearInterval(tick); n = n % 3 + 1; d.textContent = '.'.repeat(n); }, 450); init().catch(e => { console.error(e); const l = $('#loading'); l.classList.add('error'); l.textContent = '読み込めませんでした。再読み込みしてください。'; window.hotelLoadError = String(e); }); };
// Title screen: the tap starts loading (and the BGM, which needs a user gesture). Test URLs load at once.
if (params.has('check') || params.get('debug') === '1') { mode = params.get('mode') ?? 'normal'; start(); }
else {
  // NORMAL / EASY (EASY adds the hint button); the choice lasts for this page session.
  for (const b of document.querySelectorAll('#modes button')) b.onclick = e => { e.preventDefault(); e.stopPropagation(); if (!$('#loading').classList.contains('title')) return; mode = b.dataset.mode; start(); };
}
