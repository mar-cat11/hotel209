import {ownResources} from './resources.js';
import * as THREE from 'three';
// ISO ID-1 dimensions in metres; radius 3.18 mm, thickness 0.8 mm.
let texture;
export function buildCard(){
 const w=.0856,h=.054,r=.00318,x=-w/2,y=-h/2;
 const s=new THREE.Shape();s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
 const white=new THREE.MeshStandardMaterial({color:0xf7f7f3,roughness:.7});white.name='CircusCard';
 const body=new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth:.0008,bevelEnabled:false,curveSegments:8}),white);
 const faceGeo=new THREE.ShapeGeometry(s,16),pos=faceGeo.attributes.position,uv=faceGeo.attributes.uv;for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)+w/2)/w,(pos.getY(i)+h/2)/h);
 if(!texture){const c=document.createElement('canvas');c.width=856;c.height=540;const ctx=c.getContext('2d');ctx.fillStyle='#f5f0e3';ctx.fillRect(0,0,856,540);ctx.strokeStyle='#b49c65';ctx.lineWidth=5;ctx.strokeRect(30,30,796,480);ctx.fillStyle='#493719';ctx.font='42px Georgia';ctx.textAlign='center';ctx.fillText('◇',428,135);ctx.font='bold 72px Georgia';ctx.fillText('HOTEL',428,208);ctx.font='20px sans-serif';ctx.fillText('GUEST KEY',428,250);ctx.fillStyle='#c5ae70';ctx.fillRect(100,315,100,75);ctx.strokeStyle='#8e794d';ctx.lineWidth=3;ctx.strokeRect(100,315,100,75);ctx.beginPath();ctx.moveTo(150,315);ctx.lineTo(150,390);ctx.moveTo(100,353);ctx.lineTo(200,353);ctx.stroke();ctx.fillStyle='#493719';ctx.font='34px sans-serif';ctx.fillText('→',722,440);texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;}
 const front=new THREE.MeshBasicMaterial({map:texture});front.name='CircusCard';
 const face=new THREE.Mesh(faceGeo,front);face.position.z=.00081;
 const g=new THREE.Group();g.add(body,face);return ownResources(g,{geometry:true});
}
