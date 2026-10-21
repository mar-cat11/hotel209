// Corridor balloons and bunting that pile up with the story (stage 1: cat medallion, 2: all three medallions,
// 3: flashlight), and room 205's balloons (stage 0, always there, carried by that room so they hide with it).
// Layout and the balloon shape live in corridordecor-data.js (work/corridor_decor_layout.py).
// Balloons sway slightly about the point where they touch the ceiling, on game time (still while time is stopped);
// the bunting does not move. No collision. Each stage is one merged mesh whose vertex colours hold albedo with an overhead shading term, all
// sharing one material. The corridor's light is a dim self-lit share of that colour (a Lambert material with no
// scene lights reaching it), so the blackout removes it and the flashlight lights the true albedo, as on the walls.
import * as THREE from 'three';
import {decor, balloonMesh} from './corridordecor-data.js';

// Room 205's circus palette (linear RGB).
const PALETTE = {Red:[.49,.065,.042], Cream:[.83,.72,.48], Blue:[.055,.28,.36], Yellow:[.76,.48,.07], Green:[.17,.34,.11],
  Pink:[.59,.23,.28], Purple:[.29,.12,.34], Brown:[.24,.12,.055], Gold:[.53,.32,.08], Ribbon:[.70,.66,.58]};
const LIGHT = new THREE.Vector3(.25, 1, .2).normalize();   // corridor ceiling lights, roughly overhead

class Builder {
  constructor() {this.pos = []; this.nor = []; this.col = []; this.sway = []; this.amp = []; this.idx = [];}
  // spec adds a white highlight (balloon latex). sway: {pivot, phase, amp(i)} swings these vertices about the pivot.
  add(verts, faces, color, normals, spec = 0, sway = null) {
    const base = this.pos.length / 3, c = PALETTE[color];
    verts.forEach((v, i) => {
      this.pos.push(v.x, v.y, v.z); this.nor.push(normals[i].x, normals[i].y, normals[i].z);
      if (sway) {this.sway.push(sway.pivot.x, sway.pivot.y, sway.pivot.z, sway.phase); this.amp.push(sway.amp(i));}
      else {this.sway.push(0, 0, 0, 0); this.amp.push(0);}
      const n = normals[i], d = Math.max(0, n.dot(LIGHT));
      const k = .45 + .55 * d, s = spec * Math.pow(d, 28);
      this.col.push(c[0] * k + s, c[1] * k + s, c[2] * k + s);
    });
    for (const f of faces) for (let j = 1; j < f.length - 1; j++) this.idx.push(base + f[0], base + f[j], base + f[j + 1]);
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('decorSway', new THREE.Float32BufferAttribute(this.sway, 4));
    g.setAttribute('decorAmp', new THREE.Float32BufferAttribute(this.amp, 1));
    g.setIndex(this.idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material); m.frustumCulled = false; return m;
  }
}

// Small deterministic generator so every item's details (ribbon curl, pennant lengths) stay put between loads.
function random(seed) {return () => {seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296;};}

// Balloon template in metres, y up, centred on the balloon body (the data's y is the body centre).
const balloon = (() => {
  const v = balloonMesh.verts.map(([u, w, z]) => new THREE.Vector3(u * .01, (z - 13) * .01, w * .01));
  let faces = balloonMesh.faces.map(f => [...f]);
  const normals = smoothNormals(v, faces);
  // The source winding may face inwards once the axes are swapped; make normals point away from the centre.
  if (normals.reduce((s, n, i) => s + n.dot(v[i]), 0) < 0) {faces = faces.map(f => [...f].reverse()); normals.forEach(n => n.negate());}
  return {v, faces, normals};
})();
function smoothNormals(v, faces) {
  const n = v.map(() => new THREE.Vector3()), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const f of faces) for (let j = 1; j < f.length - 1; j++) {
    a.subVectors(v[f[j]], v[f[0]]); b.subVectors(v[f[j + 1]], v[f[0]]); const c = a.clone().cross(b);
    for (const i of [f[0], f[j], f[j + 1]]) n[i].add(c);
  }
  return n.map(x => x.normalize());
}
function ellipsoid(b, center, radii, basis, color, spec = 0, seg = 10, rings = 6) {
  const v = [], normals = [], faces = [];
  for (let j = 0; j <= rings; j++) for (let i = 0; i < seg; i++) {
    const a = Math.PI * j / rings, t = Math.PI * 2 * i / seg;
    const local = new THREE.Vector3(Math.sin(a) * Math.cos(t), Math.cos(a), Math.sin(a) * Math.sin(t));
    v.push(center.clone().addScaledVector(basis[0], local.x * radii.x).addScaledVector(basis[1], local.y * radii.y).addScaledVector(basis[2], local.z * radii.z));
    normals.push(basis[0].clone().multiplyScalar(local.x).addScaledVector(basis[1], local.y).addScaledVector(basis[2], local.z).normalize());
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {const p = j * seg + i, q = j * seg + (i + 1) % seg; faces.push([p, p + seg, q + seg, q]);}
  b.add(v, faces, color, normals, spec);
}
function tube(b, points, radius, color, sides = 5, sway = null) {
  const v = [], normals = [], faces = [];
  points.forEach((p, i) => {
    const t = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(i - 1, 0)]).normalize();
    const axis = Math.abs(t.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = t.clone().cross(axis).normalize(), w = t.clone().cross(u);
    for (let j = 0; j < sides; j++) {
      const a = Math.PI * 2 * j / sides, n = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
      v.push(p.clone().addScaledVector(n, radius)); normals.push(n);
    }
  });
  for (let i = 0; i < points.length - 1; i++) for (let j = 0; j < sides; j++)
    faces.push([i * sides + j, (i + 1) * sides + j, (i + 1) * sides + (j + 1) % sides, i * sides + (j + 1) % sides]);
  b.add(v, faces, color, normals, 0, sway && {...sway, amp: i => sway.amp(Math.floor(i / sides) / (points.length - 1))});
}

function addBalloon(b, item, rnd) {
  const yaw = item.yaw, tilt = (rnd() - .5) * .24, center = new THREE.Vector3(item.x, item.y, item.z);
  const rot = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(tilt));
  const v = balloon.v.map(p => p.clone().applyMatrix4(rot).add(center));
  const normals = balloon.normals.map(n => n.clone().transformDirection(rot));
  // Swings about its top, where it rests against the ceiling; the ribbon trails a little further at its end.
  const pivot = center.clone().add(new THREE.Vector3(0, .13, 0)), swayPhase = rnd() * 6.28;
  b.add(v, balloon.faces, item.color, normals, .5, {pivot, phase: swayPhase, amp: () => .05});
  // Short, gently curling ribbon from the knot.
  const knot = new THREE.Vector3(0, -.13, 0).applyMatrix4(rot).add(center), len = .14 + rnd() * .12, phase = rnd() * 6.28;
  const pts = []; for (let i = 0; i <= 8; i++) {const t = i / 8; pts.push(knot.clone().add(new THREE.Vector3(Math.sin(phase + t * 5) * .018 * t, -len * t, Math.cos(phase + t * 4) * .018 * t)));}
  tube(b, pts, .0016, 'Ribbon', 4, {pivot, phase: swayPhase, amp: t => .05 + .07 * t});
}

// Bunting: a string arching wall to wall with red/cream striped pennants (six stripes, as in 205) hanging straight
// down every 25.5 cm. The sag curve and the 33 cm longest pennant match work/corridor_decor_layout.py's clearance checks.
function stringCurve(item) {
  const a = new THREE.Vector3(item.a[0], item.a[2], item.a[1]), b = new THREE.Vector3(item.b[0], item.b[2], item.b[1]);
  const pts = []; for (let i = 0; i <= 24; i++) {const t = i / 24, p = a.clone().lerp(b, t); p.y -= item.sag * Math.sin(Math.PI * t); pts.push(p);}
  return new THREE.CatmullRomCurve3(pts);
}
function addPennant(b, top, dir, h) {
  const w = .21, down = new THREE.Vector3(0, -1, 0), normal = dir.clone().cross(down).normalize();
  const edge = x => -h * (1 - Math.abs(x) / (w / 2));
  for (let s = 0; s < 6; s++) {
    const xs = -w / 2 + s * w / 6, xe = xs + w / 6, poly = [[xs, 0], [xe, 0], [xe, edge(xe)]];
    if (xs < 0 && xe > 0) poly.push([0, -h]);
    poly.push([xs, edge(xs)]);
    const v = poly.map(([x, y]) => top.clone().addScaledVector(dir, x).addScaledVector(down, -y));
    b.add(v, [v.map((_, i) => i)], s % 2 ? 'Red' : 'Cream', v.map(() => normal));
  }
  ellipsoid(b, top.clone().addScaledVector(down, .08), new THREE.Vector3(.027, .027, .0035), [dir, down.clone().negate(), normal], 'Gold', 0, 8, 4);
}
function addBunting(b, item, rnd) {
  const curve = stringCurve(item), length = curve.getLength();
  tube(b, curve.getSpacedPoints(Math.max(8, Math.round(length * 12))), .0022, 'Brown', 5);
  let dir = new THREE.Vector3(1, 0, 0);
  for (let s = .13; s < length - .1; s += .255) {
    const t = s / length, tangent = curve.getTangentAt(t), flat = new THREE.Vector3(tangent.x, 0, tangent.z);
    if (flat.lengthSq() > .02) dir = flat.normalize();
    addPennant(b, curve.getPointAt(t), dir.clone(), .28 + rnd() * .05);
  }
}

// The self-lit share is tuned per place: the corridor renders at ~2.1x exposure under AgX, rooms at 1.25x.
const SELF_LIT = {corridor: .3, 207: .2};
export function createCorridorDecor(scene, rooms) {
  const time = {value: 0};
  const makeMaterial = selfLit => {
    const material = new THREE.MeshLambertMaterial({vertexColors: true, side: THREE.DoubleSide});
    material.onBeforeCompile = shader => {
      shader.uniforms.decorTime = time; shader.uniforms.decorSelfLit = {value: selfLit};
      // Each balloon swings about its pivot on its own slow period and horizontal axis (Rodrigues rotation).
      shader.vertexShader = 'attribute vec4 decorSway; attribute float decorAmp; uniform float decorTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        if (decorAmp > 0.) {
          float decorAngle = decorAmp * sin(decorTime * (.55 + fract(decorSway.w * 7.31) * .35) + decorSway.w);
          vec3 decorAxis = vec3(cos(decorSway.w * 2.7), 0., sin(decorSway.w * 2.7)), decorP = transformed - decorSway.xyz;
          float decorC = cos(decorAngle), decorS = sin(decorAngle);
          transformed = decorSway.xyz + decorP * decorC + cross(decorAxis, decorP) * decorS + decorAxis * dot(decorAxis, decorP) * (1. - decorC);
        }`);
      shader.fragmentShader = 'uniform float decorSelfLit;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * decorSelfLit;');
    };
    material.customProgramCacheKey = () => 'corridorDecorSway';
    return material;
  };
  const build = (filter, selfLit, name, parent) => {
    const b = new Builder();
    decor.forEach((item, i) => {
      if (!filter(item)) return;
      const rnd = random(i * 7919 + 1);
      (item.kind === 'balloon' ? addBalloon : addBunting)(b, item, rnd);
    });
    const m = b.mesh(makeMaterial(selfLit)); m.name = name; parent.add(m); return m;
  };
  build(item => item.room === 207, SELF_LIT[207], 'room205Balloons', rooms[207].root);
  const meshes = [1, 2, 3].map(stage => {
    const m = build(item => item.stage === stage, SELF_LIT.corridor, 'corridorDecor' + stage, scene); m.visible = false; return m;
  });
  return {
    // Stages are cumulative: stage n shows everything from stages 1..n (room 205's balloons are always there).
    setStage(n) {meshes.forEach((m, i) => {m.visible = i < n;});},
    update(gameTime) {time.value = gameTime;},
    get time() {return time.value;},
    meshes,
  };
}
