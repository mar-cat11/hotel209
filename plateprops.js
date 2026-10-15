import {ownResources} from './resources.js';
import * as THREE from 'three';

// 64 mm square including bevel, 10 mm body; local +z is the relief face.
// Geometry is shared by desk pickups and painting inserts; no motif textures.
const cache=new Map();
function polygon(points) {const s=new THREE.Shape();points.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y));s.closePath();return s;}
function square(half) {return polygon([[-half,-half],[half,-half],[half,half],[-half,half]]);}
function reliefShapes(motif) {
  if(motif==='ship')return [polygon([[-.024,-.012],[.024,-.012],[.016,-.022],[-.014,-.022]]),polygon([[-.002,-.011],[.001,-.011],[.001,.024],[-.002,.024]]),polygon([[-.006,.022],[-.024,-.008],[-.006,-.008]]),polygon([[.005,.018],[.023,-.008],[.005,-.008]])];
  if(motif==='moon') {
    const disc=new THREE.Shape();disc.absarc(0,0,.024,0,Math.PI*2,false);return [disc];
  }
  const island=new THREE.Shape();island.absellipse(0,-.019,.025,.006,0,Math.PI*2,false);
  const trunk=new THREE.Shape();trunk.moveTo(-.002,-.017);trunk.quadraticCurveTo(.007,0,0,.014);trunk.lineTo(.004,.015);trunk.quadraticCurveTo(.012,0,.003,-.017);trunk.closePath();
  const leaves=[[-.024,.008],[-.018,.023],[.018,.026],[.025,.008]].map(([x,y])=>{const s=new THREE.Shape();s.moveTo(.002,.014);s.quadraticCurveTo(x*.6,y+.012,x,y);s.quadraticCurveTo(x*.6,y-.002,.002,.012);s.closePath();return s;});
  return [island,trunk,...leaves];
}
export function buildPlate(motif,env) {
  if(!cache.has(motif)){
    const body=new THREE.ExtrudeGeometry(square(.0308),{depth:.0076,bevelEnabled:true,bevelSize:.0012,bevelThickness:.0012,bevelSegments:2,curveSegments:12});body.translate(0,0,.0012);
    const rimShape=square(.0275);rimShape.holes.push(new THREE.Path(square(.0259).getPoints()));
    const rim=new THREE.ExtrudeGeometry(rimShape,{depth:.0006,bevelEnabled:false});rim.translate(0,0,.010);
    const relief=new THREE.ExtrudeGeometry(reliefShapes(motif),{depth:.0015,bevelEnabled:true,bevelSize:.00035,bevelThickness:.00035,bevelSegments:1,curveSegments:12});relief.translate(0,0,.0103);
    cache.set(motif,{body,rim,relief});
  }
  const g=new THREE.Group(),geo=cache.get(motif);
  const brass=new THREE.MeshStandardMaterial({color:0x9b7540,metalness:.75,roughness:.48,envMap:env,envMapIntensity:1.5});
  const glaze=new THREE.MeshStandardMaterial({color:0x173b40,metalness:.25,roughness:.3,envMap:env,envMapIntensity:1.2});
  g.add(new THREE.Mesh(geo.body,brass),new THREE.Mesh(geo.rim,brass),new THREE.Mesh(geo.relief,glaze));
  return ownResources(g);
}
export function buildPlatePickup(d,env) {
  const group=new THREE.Group(),tile=buildPlate(d.motif,env);tile.rotation.set(-Math.PI/2,0,d.plateAngle??0);group.add(tile);
  return {group,sync(state){tile.visible=!state.flags.includes(d.once);}};
}
