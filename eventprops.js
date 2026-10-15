import {assetUrl} from './version.js';
import {loadGLTF, loadTexture} from './loaders.js';
import * as THREE from 'three';
let clownAsset;
export function preloadClown(){
 if(!clownAsset)clownAsset=loadGLTF('models/clown.glb').catch(error=>{clownAsset=null;throw error;});
 return clownAsset;
}
// Shared world landmarks; silhouettes remain inexpensive in lite mode.
export function buildEventProps(scene,rooms,data,renderer){
 const dark=new THREE.MeshBasicMaterial({color:0x080f16});
 const figure=new THREE.Group();figure.name='eventClown';figure.position.set(19.15,0,22.25);figure.rotation.y=Math.PI;rooms[220].root.add(figure);
 preloadClown().then(asset=>{figure.add(asset.scene);const mixer=new THREE.AnimationMixer(asset.scene);mixer.clipAction(THREE.AnimationClip.findByName(asset.animations,'Idle')).setLoop(THREE.LoopRepeat,Infinity).play();mixer.update(0);figure.userData.actions=asset.animations.map(a=>a.name);let last;figure.userData.update=t=>{if(last!==undefined && figure.visible)mixer.update(Math.min(.1,t-last));last=t;};});
 // The real baked sheer (court_detail.py) now spans the whole 220 window; the haze below is a runtime layer in front of it.
 const curtainPos=new THREE.Vector3(19.30,1.27,21.94);
 // A small one-time shadow capture, softened on the fabric: no per-frame extra pass.
 const shadowTarget=new THREE.WebGLRenderTarget(128,256,{depthBuffer:true});
 const hazeMaterial=new THREE.ShaderMaterial({name:'220CurtainHaze',
  uniforms:{shadowMap:{value:shadowTarget.texture}},side:THREE.DoubleSide,transparent:false,depthWrite:true,
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D shadowMap;varying vec2 vUv;
   void main(){float shadow=0.;for(int x=-2;x<=2;x++)for(int y=-2;y<=2;y++){
    vec2 offset=vec2(float(x)/128.,float(y)/256.)*1.6;
    shadow+=1.-texture2D(shadowMap,vUv+offset).r;}shadow/=25.;
    float folds=sin(vUv.x*57.)*.025+sin(vUv.x*114.)*.008;
    float glow=exp(-length((vUv-vec2(.63,.48))*vec2(2.,1.5))*2.)*.13;
    vec3 fabric=vec3(.40,.37,.31)+folds+glow;
    gl_FragColor=vec4(fabric*(1.-shadow*.72),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
 });
 const hazeCloth=new THREE.PlaneGeometry(2.40,2.40,88,1);
 for(let i=0;i<hazeCloth.attributes.position.count;i++){const x=hazeCloth.attributes.position.getX(i);hazeCloth.attributes.position.setZ(i,.028*Math.sin((x+.615)/.14*Math.PI*2));}
 const haze=new THREE.Mesh(hazeCloth,hazeMaterial);haze.name='220CurtainHaze';haze.position.copy(curtainPos);haze.position.z-=.035;scene.add(haze);figure.userData.haze=haze;
 preloadClown().then(()=>{
  const shadowScene=new THREE.Scene();shadowScene.background=new THREE.Color(0xffffff);
  shadowScene.overrideMaterial=new THREE.MeshBasicMaterial({color:0x000000});
  const shadowCamera=new THREE.OrthographicCamera(-1.20,1.20,1.20,-1.20,.01,5);
  shadowCamera.position.set(19.30,1.27,20.5);shadowCamera.lookAt(19.30,1.27,22.25);
  shadowScene.add(figure);shadowScene.updateMatrixWorld(true);
  const previous=renderer.getRenderTarget();renderer.setRenderTarget(shadowTarget);renderer.render(shadowScene,shadowCamera);renderer.setRenderTarget(previous);
  rooms[220].root.add(figure);shadowScene.overrideMaterial.dispose();
 });
 const branch=(group,a,b,r,mat=dark)=>{const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),v=to.clone().sub(from);const m=new THREE.Mesh(new THREE.CylinderGeometry(r*.65,r,v.length(),5),mat);m.position.copy(from).add(to).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());group.add(m);};
 const island=new THREE.Group();
 for(const [x,y,z,sx,sy,sz] of [[0,1,0,12,2.6,5],[-9,.4,1,6,1.3,3],[9,.3,-1,7,1.2,3],[-3,2,0,5,2.4,4],[5,1.6,0,4,2,3]]){const m=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshBasicMaterial({color:0x101b24}));m.position.set(x,y,z);m.scale.set(sx,sy,sz);island.add(m);}
 // Crooked wind-bent pines, with uneven rounded needle clusters.
 for(const [x,h,lean] of [[-7,5,-1.4],[-2,7,-2.1],[5,5.5,-1.6]]){
  const points=[[x,2,0],[x+.35,h*.48,0],[x+lean*.45,h*.72,.1],[x+lean,h+1.5,0]];
  for(let i=1;i<points.length;i++)branch(island,points[i-1],points[i],.25-i*.045);
  for(const [j,t,reach,rise] of [[0,.46,-2.0,.3],[1,.61,1.7,.6],[2,.77,-2.5,.45],[3,.91,1.2,.25],[4,1,-1.1,.5]]){
   const y=2+(h-.5)*t,stem=x+lean*t*t,tip=stem+reach;
   branch(island,[stem,y,0],[tip,y+rise,0],.09);
   for(let k=0;k<5;k++){
    const leaf=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),dark);
    leaf.position.set(tip+(k-2)*.48,y+rise+Math.sin(k*2.3+j)*.23,(k%2)*.35);
    leaf.scale.set(.65+(k%3)*.16,.36+(k%2)*.2,.55);leaf.rotation.z=(k-2)*.17;
    island.add(leaf);
   }
  }
 }
 island.rotation.y=Math.PI/2;island.name="seaIsland";island.position.set(-90,-4.2,4.8);scene.add(island);
 const ship=new THREE.Group();const hullShape=new THREE.Shape();hullShape.moveTo(-4,.6);hullShape.lineTo(4,.6);hullShape.lineTo(3.2,-.35);hullShape.lineTo(-2.7,-.4);hullShape.closePath();const hull=new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape,{depth:1.5,bevelEnabled:false}),dark);hull.position.z=-.75;ship.add(hull);
 const cabin=new THREE.Mesh(new THREE.BoxGeometry(1.9,.7,1.2),dark);cabin.position.set(1.4,.9,0);ship.add(cabin);
 const glow=new THREE.Mesh(new THREE.PlaneGeometry(.22,.25),new THREE.MeshBasicMaterial({color:0xffca69,toneMapped:false,side:THREE.DoubleSide}));glow.position.set(1.5,.93,.61);ship.add(glow);
 for(const [x,h] of [[-1.7,6],[.8,6.7]]){branch(ship,[x,.5,0],[x,h,0],.055);branch(ship,[x-1.5,1.1,0],[x+1.6,1.1,0],.04);for(const end of [-3.5,3.5])branch(ship,[x,h,0],[end,.6,.45],.012);}
 branch(ship,[-4,.6,0],[-5,1.1,0],.045);ship.name="seaShip";ship.rotation.y=Math.PI/2;ship.position.set(-24,-4.2,16.5);ship.scale.setScalar(.65);scene.add(ship);
 const d=data.interactables.find(d=>d.id==='hieroglyph');const texture=loadTexture(assetUrl('textures/props2_hieroglyph.jpg'));texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const g=new THREE.Group(),wood=new THREE.MeshBasicMaterial({color:0x302018}),edge=new THREE.MeshBasicMaterial({color:0x513a27});
 const box=(w,h,t,x,y,z,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,t),mat);m.position.set(x,y,z);g.add(m);};
 box(.99,.685,.0575,0,0,-.00625,wood);const art=new THREE.Mesh(new THREE.PlaneGeometry(.90,.604),new THREE.MeshBasicMaterial({map:texture}));art.position.z=.026;g.add(art);
 for(const x of [-.466,.466]){box(.036,.65,.04,x,0,.028,wood);box(.006,.612,.008,x-Math.sign(x)*.018,0,.049,edge);}
 for(const y of [-.321,.321]){box(.9,.036,.04,0,y,.028,wood);box(.9,.006,.008,0,y-Math.sign(y)*.018,.049,edge);}
 g.position.fromArray(d.position);g.rotation.y=d.rotation;rooms[d.room].root.add(g);
 return figure;
}
