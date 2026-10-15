import {ownResources} from './resources.js';
import {loadGLTF} from './loaders.js';
import * as THREE from 'three';
import {hallEnv} from './liftprops.js';
let keySource;
export function loadKeyModel(){
 if(!keySource)keySource=(async()=>{
  return (await loadGLTF('models/key205.glb')).scene;
 })().catch(error=>{keySource=null;throw error;});
 return keySource;
}
// Brass key + oval 205 tag (real size ~8 cm key). Resolves to a Group; only the converted materials are owned.
export async function buildHotelKey(renderer){
 const g=new THREE.Group();g.name='hotelKey205';
 const model=(await loadKeyModel()).clone(true),env=renderer?hallEnv(renderer):null,done=new Map();
 model.traverse(o=>{if(!o.isMesh)return;const conv=m=>{if(!done.has(m)){const tag=m.name==='Tag';
  done.set(m,new THREE.MeshStandardMaterial({name:m.name,map:m.map,color:0xffffff,side:THREE.DoubleSide,metalness:tag?.55:.75,roughness:tag?.45:.34,envMap:env,envMapIntensity:tag?.7:1,emissive:0xffffff,emissiveMap:m.map,emissiveIntensity:tag?.5:.26}));}return done.get(m);};
  o.material=Array.isArray(o.material)?o.material.map(conv):conv(o.material);});
 g.add(model);return ownResources(g);
}
