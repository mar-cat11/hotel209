import {loadTexture} from './loaders.js';
import {assetUrl} from './version.js';
import * as THREE from 'three';
import {buildPlate} from './plateprops.js';

// Local +z faces the room. Board holes are open geometry, with separate floors.
export function buildPainting(renderer, d, env) {
  const group = new THREE.Group();
  const texture = c => {const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;};
  const c=document.createElement('canvas');c.width=512;c.height=256;
  const ctx=c.getContext('2d');ctx.fillStyle='#c4a477';ctx.fillRect(0,0,512,256);
  let seed=203;const rand=()=>((seed=seed*16807%2147483647)/2147483647);
  for(let i=0;i<1500;i++){ctx.fillStyle=`rgba(${rand()>.5?'255,238,199':'79,48,24'},${.02+rand()*.05})`;ctx.fillRect(rand()*512,rand()*256,30+rand()*160,.5);}
  const board=new THREE.MeshStandardMaterial({map:texture(c),roughness:.86});
  const wood=new THREE.MeshStandardMaterial({color:0x302016,roughness:.65});
  const inner=new THREE.MeshStandardMaterial({color:0x806344,roughness:.92});
  const box=(w,h,t,x,y,z,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,t),mat);m.position.set(x,y,z);group.add(m);return m;};
  box(.44,.64,.014,0,0,.009,wood);
  const face=new THREE.Shape();face.moveTo(-.202,0);face.lineTo(.202,0);face.lineTo(.202,.302);face.lineTo(-.202,.302);face.closePath();
  const centers=[];
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    const x=(col-1)*.116,y=.252-row*.093,s=.068;
    centers.push([x,y]);
    const hole=new THREE.Path();hole.moveTo(x-s/2,y-s/2);hole.lineTo(x-s/2,y+s/2);hole.lineTo(x+s/2,y+s/2);hole.lineTo(x+s/2,y-s/2);hole.closePath();face.holes.push(hole);
    box(s,s,.003,x,y,.019,new THREE.MeshStandardMaterial({map:board.map,color:0x97816b,roughness:.92}));
    // Dark upper lip and true 14 mm inner walls give each socket depth.
    box(s,.003,.014,x,y+s/2,.027,inner);box(s,.003,.014,x,y-s/2,.027,inner);
    box(.003,s,.014,x-s/2,y,.027,inner);box(.003,s,.014,x+s/2,y,.027,inner);
  }
  const panel=new THREE.Mesh(new THREE.ExtrudeGeometry(face,{depth:.014,bevelEnabled:false}),board);panel.position.z=.02;group.add(panel);
  const sea=loadTexture(assetUrl('textures/painting_sea.jpg'));sea.colorSpace=THREE.SRGBColorSpace;sea.anisotropy=4;sea.repeat.x=(.404/.302)/(.864/.282);sea.offset.x=(1-sea.repeat.x)/2;
  const ocean=new THREE.Mesh(new THREE.PlaneGeometry(.404,.302),new THREE.MeshStandardMaterial({map:sea,roughness:.95}));ocean.position.set(0,-.151,.034);group.add(ocean);
  box(.018,.64,.037,-.211,0,.025,wood);box(.018,.64,.037,.211,0,.025,wood);
  box(.404,.018,.037,0,.311,.025,wood);box(.404,.018,.037,0,-.311,.025,wood);
  const plates={};
  for(const motif of Object.keys(d.answer)){
    const p=buildPlate(motif,env);group.add(p);p.visible=false;plates[motif]=p;
  }
  group.traverse(o=>{if(o.isMesh){o.material.envMap=env;o.material.envMapIntensity=.85;}});
  const hit=new THREE.Mesh(new THREE.BoxGeometry(.46,.66,.10),new THREE.MeshBasicMaterial({visible:false}));hit.position.z=.025;group.add(hit);
  return {group,hit,plates,centers,sync(state){for(const [id,p] of Object.entries(plates)){const cell=state.placements?.[d.id]?.[id];p.visible=Number.isInteger(cell)&&cell>=0&&cell<9;if(p.visible)p.position.set(...centers[cell],.024);}}};
}
