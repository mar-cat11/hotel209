import {disposeOwned} from './resources.js';
import * as THREE from 'three';
import {buildPickupModel} from './presentation.js';

// One lazy offscreen context for the lifetime of the inventory; serialized bitmap cache.
// Per-item resources are disposed after rendering. No animation loop or closed-screen work.
export function createInventoryThumbnails(data,gameRenderer){
 const cache=new Map();let queue=Promise.resolve(),offscreen=null;
 return id=>{
  if(cache.has(id))return cache.get(id);
  const task=queue.then(async()=>{
   let source;try{
   source=await buildPickupModel(id,data,gameRenderer);
   if(!offscreen){offscreen=new THREE.WebGLRenderer({alpha:true,antialias:true});offscreen.setSize(256,256);offscreen.setPixelRatio(1);offscreen.outputColorSpace=THREE.SRGBColorSpace;offscreen.toneMapping=gameRenderer.toneMapping;offscreen.toneMappingExposure=1;}
   const renderer=offscreen;
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.01,20);camera.position.z=2.2;
    scene.add(new THREE.HemisphereLight(0xfff1db,0x647599,3));
    for(const [color,intensity,pos] of [[0xffe4bb,5,[2,3,4]],[0xaccfff,3,[-3,1,2]]]){const light=new THREE.DirectionalLight(color,intensity);light.position.fromArray(pos);scene.add(light);}
    const bounds=new THREE.Box3().setFromObject(source),size=bounds.getSize(new THREE.Vector3());source.position.sub(bounds.getCenter(new THREE.Vector3()));
    const group=new THREE.Group();group.add(source);group.scale.setScalar(1/Math.max(size.x,size.y,size.z));group.rotation.set(.12,-.3,.04);scene.add(group);
    renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');
   }finally{disposeOwned(source);}
  });cache.set(id,task);task.catch(()=>cache.delete(id));queue=task.catch(()=>{});return task;
 };
}
