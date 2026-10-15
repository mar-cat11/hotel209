import * as THREE from 'three';

// Ten printed sectors wrap each cylinder; its axis runs across the box front.
export function buildDialLock(renderer) {
 const group=new THREE.Group();group.name='dialLock';group.position.set(0,.095,.112);
 const brass=new THREE.MeshBasicMaterial({color:0xb79757}),edge=new THREE.MeshBasicMaterial({color:0x594327}),steel=new THREE.MeshBasicMaterial({color:0xc3c5be});
 const add=(size,pos,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);m.position.set(...pos);group.add(m);return m;};
 add([.098,.035,.018],[0,0,0],edge);add([.104,.005,.022],[0,.019,.002],brass);add([.104,.005,.022],[0,-.019,.002],brass);
 for(const x of [-.05,.05]){add([.006,.038,.022],[x,0,.002],brass);const screw=new THREE.Mesh(new THREE.CircleGeometry(.0018,12),steel);screw.position.set(x,0,.014);group.add(screw);add([.0025,.0005,.001],[x,0,.0142],edge);}
 const latch=new THREE.Group();group.add(latch);
 const wheels=[],digits=[0,0,0,0],animations=new Map();
 const c=document.createElement('canvas');c.width=1280;c.height=128;const ctx=c.getContext('2d');
 ctx.fillStyle='#eee9dc';ctx.fillRect(0,0,c.width,c.height);ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 90px sans-serif';
 for(let i=0;i<=10;i++){ctx.fillStyle='#1d2427';ctx.save();ctx.translate(i*128,64);ctx.rotate(-Math.PI/2);ctx.fillText(String(i%10),0,0);ctx.restore();ctx.fillStyle='#aca79b';ctx.fillRect(i*128+62.5,0,1.5,128);}
 const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
 const print=new THREE.MeshBasicMaterial({map:texture});
 for(let i=0;i<4;i++){const pivot=new THREE.Group();pivot.position.set((i-1.5)*.022,0,.004);group.add(pivot);const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.017,.017,.019,80,1,false),[print,steel,steel]);wheel.rotation.z=-Math.PI/2;pivot.add(wheel);wheels.push(pivot);}
 for(const x of [-.041,.041]){const mark=new THREE.Mesh(new THREE.ConeGeometry(.0018,.003,3),new THREE.MeshBasicMaterial({color:0x682c22}));mark.rotation.z=x<0?-Math.PI/2:Math.PI/2;mark.position.set(x,0,.024);group.add(mark);}
 return {group,wheels,digits,latch,turn(i){if(animations.has(i))return false;digits[i]=(digits[i]+1)%10;animations.set(i,{from:wheels[i].rotation.x,time:performance.now()});return true;},update(){for(const [i,a] of animations){const k=Math.min(1,(performance.now()-a.time)/160);wheels[i].rotation.x=a.from-Math.PI/5*(1-(1-k)**3);if(k===1)animations.delete(i);}},sync(unlocked){latch.position.y=unlocked?.012:0;latch.rotation.z=unlocked?-.3:0;},get moving(){return animations.size>0;}};
}

export function createDialControl({answer,prop,root,layer,camera,solved}) {
 let active=false,locked=false;const ray=new THREE.Raycaster();
 function down(e){if(!active||locked||e.target.closest('button')||e.button>0)return;const cam=camera();if(!cam)return;cam.updateMatrixWorld();root.updateWorldMatrix(true,true);ray.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2),cam);
 const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0,0,1).transformDirection(prop.group.matrixWorld),prop.group.localToWorld(new THREE.Vector3(0,0,.022)));
 const hit=ray.ray.intersectPlane(plane,new THREE.Vector3());if(!hit)return;const p=prop.group.worldToLocal(hit);const i=Math.round(p.x/.022+1.5);if(i<0||i>3||Math.abs(p.y)>.025||Math.abs(p.x-(i-1.5)*.022)>.011)return;
 e.preventDefault();e.stopPropagation();if(prop.turn(i)&&prop.digits.join('')===String(answer)){locked=true;solved();}}
 layer.addEventListener('pointerdown',down);
 return {start(){active=true;},stop(){active=false;},get active(){return active;},get locked(){return locked;},screenPoint(i){const p=prop.group.localToWorld(new THREE.Vector3((i-1.5)*.022,0,.022)).project(camera());return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};}};
}
