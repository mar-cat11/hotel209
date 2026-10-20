import {loadGLTF} from './loaders.js';
import * as THREE from 'three';

// One shared, shadow-free albedo lighting term, including previously unlit baked meshes.
export function createFlashlight(scene, camera) {
  const uniforms={flashGain:{value:1},flashBlack:{value:0},flashPosition:{value:new THREE.Vector3()},flashDirection:{value:new THREE.Vector3(0,0,-1)},flashRange:{value:1.5}};
  const patched=new WeakSet(); let blackout=false, acquired=false, started=0, progress=0;
  const lights=new Map(), sprites=new Map(), fogEnd=new THREE.Color(0x010203);
  let fogStart;
  const root=new THREE.Group();root.name='liftFlashlight';root.position.set(2.72,.832,17.48);root.rotation.y=-Math.PI/4;scene.add(root);
  // Asset's head points along local +X; it rests beside, rather than inside, the key box.
  const ready=loadGLTF('./models/flashlight.glb').then(g=>{
    g.scene.traverse(o=>{if(o.isMesh){const m=o.material;o.material=new THREE.MeshBasicMaterial({map:m.map,color:m.color,side:m.side,transparent:o.name==='lens',opacity:o.name==='lens'?.24:1,depthWrite:o.name!=='lens'});}});
    root.add(g.scene);return g.scene;
  });
  const lens=new THREE.Mesh(new THREE.CircleGeometry(.020,24),new THREE.MeshBasicMaterial({color:0xffedc4,side:THREE.DoubleSide}));
  lens.name='flashlightGlow';lens.rotation.y=Math.PI/2;lens.position.x=.101;root.add(lens);
  const light=new THREE.SpotLight(0xffe6bd,2.5,1.5,.42,.75,2);light.name='tableFlashlightSpot';light.position.set(.102,0,0);root.add(light);root.add(light.target);light.target.position.set(1,.015,0);
  const pos=new THREE.Vector3(),dir=new THREE.Vector3(),offset=new THREE.Vector3(.12,-.12,-.05);
  const registered=new WeakSet(), lightObjects=new Set(), spriteObjects=new Set();
  function register(tree) {
    tree.traverse(o=>{
      if(!registered.has(o)){
        registered.add(o);o.addEventListener('childadded',event=>register(event.child));
        if(o.isLight)lightObjects.add(o);
        if(o.isSprite)spriteObjects.add(o);
      }
      if(!o.isMesh || o===lens)return;
      for(const m of Array.isArray(o.material)?o.material:[o.material]) {
        if(patched.has(m)||(!m.isMeshBasicMaterial&&!m.isMeshStandardMaterial&&!m.isMeshPhongMaterial&&!m.isMeshLambertMaterial))continue;
        patched.add(m);const old=m.onBeforeCompile, oldKey=m.customProgramCacheKey();
        // Restrict attenuation to baked cabin surfaces, leaving the moving clown
        // and the corridor outside the cabins at their existing brightness.
        const cabinResponse=m.userData.liftCabinSurfaces ? `
            float inCabinX=step(2.,flashWorld.x)*(1.-step(4.4,flashWorld.x));
            float inCabinZ=step(16.1,flashWorld.z)*(1.-step(18.3,flashWorld.z))
                         +step(19.8,flashWorld.z)*(1.-step(22.,flashWorld.z));
            flashLit*=mix(1.,.12,flashBlack*inCabinX*inCabinZ);
        ` : '';
        m.onBeforeCompile=shader=>{
          old?.(shader);Object.assign(shader.uniforms,uniforms);
          shader.vertexShader='varying vec3 flashWorld; varying vec3 flashNormal;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nflashWorld=(modelMatrix*vec4(position,1.)).xyz; flashNormal=normalize(mat3(modelMatrix)*normal);');
          shader.fragmentShader='varying vec3 flashWorld; varying vec3 flashNormal; uniform float flashGain; uniform float flashBlack; uniform vec3 flashPosition; uniform vec3 flashDirection; uniform float flashRange;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
            vec3 flashDelta=flashWorld-flashPosition;
            float flashDistance=length(flashDelta);
            vec3 flashRay=flashDelta/max(flashDistance,.001);
            float flashDot=dot(flashRay,flashDirection);
            float flashCone=smoothstep(.78,.995,flashDot)*.9+smoothstep(.55,.9,flashDot)*.06;
            float flashFall=pow(max(0.,1.-flashDistance/flashRange),2.)/(1.+.12*flashDistance*flashDistance);
            float flashDiffuse=max(.08,dot(normalize(flashNormal),-flashRay));
            vec3 flashLit=diffuseColor.rgb*vec3(1.,.90,.73)*flashCone*flashFall*flashDiffuse*3.8*flashGain;
            ${cabinResponse}
            outgoingLight=mix(outgoingLight+flashLit, diffuseColor.rgb*.0018+flashLit, flashBlack);
            #include <opaque_fragment>`);
        };
        m.customProgramCacheKey=()=> oldKey+'|flash-albedo-v3|cabin'+!!m.userData.liftCabinSurfaces;m.needsUpdate=true;
      }
    });
    if(blackout)applyBlackout();
  }
  function applyBlackout(){
    for(const o of lightObjects){if(!lights.has(o))lights.set(o,o.intensity);o.intensity=lights.get(o)*(1-progress);}
    for(const o of spriteObjects){if(!sprites.has(o)){o.material=o.material.clone();sprites.set(o,o.material.opacity);}o.material.opacity=sprites.get(o)*(1-.985*progress);}
  }
  register(scene);
  function trigger(){if(blackout)return;blackout=true;fogStart=scene.fog?.color.clone();started=performance.now();document.body.classList.add('blackout');applyBlackout();}
  function fade(now){
    if(!blackout||progress>=1)return;
    progress=Math.min(1,Math.max(0,(now-started)/3000));
    uniforms.flashBlack.value=progress;
    document.body.style.setProperty('--blackout-progress',String(progress));
    if(scene.fog&&fogStart)scene.fog.color.copy(fogStart).lerp(fogEnd,progress);
    applyBlackout();
  }
  // Hide only the table model: removing its (already dark) spot light would change the scene's light count and make
  // three.js recompile every lit material at once, a visible stall right after the blackout.
  function acquire(){acquired=true;for(const o of root.children)if(o!==light&&o!==light.target)o.visible=false;light.intensity=0;uniforms.flashRange.value=10;}
  function update(view, now, gain=1){
    uniforms.flashGain.value=gain;

    if(acquired){view.updateMatrixWorld();pos.copy(offset);if(view!==camera)pos.set(.025,-.025,-.01);pos.applyMatrix4(view.matrixWorld);view.getWorldDirection(dir);if(view===camera){dir.y-=.14;dir.normalize();}}
    else{root.updateMatrixWorld();pos.set(.102,0,0).applyMatrix4(root.matrixWorld);dir.set(1,.015,0).normalize().transformDirection(root.matrixWorld);}
    uniforms.flashPosition.value.copy(pos);uniforms.flashDirection.value.copy(dir);
  }
  return {restore(){trigger();started=performance.now()-3000;fade(performance.now());acquire();},root,light,ready,register,trigger,fade,acquire,update,get progress(){return progress;},get blackout(){return blackout;},get acquired(){return acquired;},uniforms};
}
