import {loadGLTF} from './loaders.js';
import {buildDialLock} from './dialprops.js';
import * as THREE from 'three';

import {buildHotelKey,loadKeyModel} from './keyprops.js';
import {buildMedallionPickup, hallEnv} from './liftprops.js';

const assets=new Map();
function loadBox(name){
 if(!assets.has(name))assets.set(name,(async()=>{
  return (await loadGLTF(`models/${name}.glb`)).scene;
 })().catch(error=>{assets.delete(name);throw error;}));
 return assets.get(name);
}
export function preloadBoxProps(){return Promise.all(['box203','steelbox'].map(loadBox).concat(loadKeyModel()));}
function buildKey(d){
 const group=new THREE.Group(),mat=new THREE.MeshBasicMaterial({color:0xd5ba70});
 const ring=new THREE.Mesh(new THREE.TorusGeometry(.011,.003,8,20),mat);ring.rotation.x=-Math.PI/2;ring.position.x=-.027;group.add(ring);
 const add=(size,pos)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);m.position.set(...pos);group.add(m);};
 add([.054,.005,.006],[.009,0,0]);for(const x of [.023,.033])add([.005,.005,.011],[x,0,.007]);
 group.rotation.y=-.35;const content=new THREE.Group();content.add(group);
 return {group:content,sync:state=>{group.visible=!state.flags.includes(d.takenFlag);}};
}

function buildKey205(renderer,d){
 // Brass 205 key lying on the floor of the keepsake box (floor top at 1.2 cm; the key reaches 1 mm below its origin),
 // towards the back (-z) so the box's front wall does not hide it from where the player stands.
 const content=new THREE.Group(),holder=new THREE.Group();holder.position.set(.012,.013,-.04);holder.rotation.y=-.5;content.add(holder);
 const ready=buildHotelKey(renderer).then(k=>holder.add(k));
 return {group:content,ready,sync:state=>{content.visible=!state.flags.includes(d.takenFlag);}};
}
export function buildBox(renderer, d) {
  const group=new THREE.Group(), procedural=new THREE.Group();group.add(procedural);
  // Room lighting is baked into its meshes; these fallback materials carry their own color.
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#543421';ctx.fillRect(0,0,256,128);
  for(let y=0;y<128;y++){ctx.strokeStyle=`rgba(22,10,3,${.08+(y%7)*.025})`;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(70,y+2,180,y-2,256,y);ctx.stroke();}
  const grain=new THREE.CanvasTexture(canvas);grain.colorSpace=THREE.SRGBColorSpace;
  const wood=new THREE.MeshBasicMaterial({map:grain});
  const inside=new THREE.MeshBasicMaterial({color:0x23140e});
  const brass=new THREE.MeshBasicMaterial({color:0xb98e46});
  const mesh=(parent,size,pos,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);m.position.set(...pos);parent.add(m);return m;};
  mesh(procedural,[.3,.012,.2],[0,.006,0],inside);
  for(const x of [-.144,.144])mesh(procedural,[.012,.116,.2],[x,.07,0],wood);
  for(const z of [-.094,.094])mesh(procedural,[.276,.116,.012],[0,.07,z],wood);
  let lid=new THREE.Group();lid.name='lid';lid.position.set(0,.128,-.1);procedural.add(lid);
  mesh(lid,[.3,.012,.2],[0,.006,.1],wood);
  for(const x of [-.14,.14])for(const z of [-.09,.09]){
    mesh(procedural,[.022,.026,.022],[x,.018,z],brass);
    mesh(lid,[.022,.014,.022],[x,.006,z+.1],brass);
  }
  mesh(procedural,[.028,.035,.008],[0,.105,.104],brass);
  mesh(lid,[.022,.015,.008],[0,0,.204],brass);
  const hit=mesh(group,d.kind==='dial'?[.38,.32,.24]:[.33,.17,.23],[0,.075,0],new THREE.MeshBasicMaterial({visible:false}));
  const medal=d.itemModel==='key205'?buildKey205(renderer,d):d.itemModel==='key'?buildKey(d):buildMedallionPickup(renderer,{motif:d.motif,diameter:.075,once:d.takenFlag});
  medal.group.name=d.id+(d.itemModel==='key'||d.itemModel==='key205'?'_key':'_medallion');medal.group.position.y=d.itemModel==='key'?.016:d.itemModel==='key205'?0:.012;group.add(medal.group);
  const dial=d.id==='dialBox'?buildDialLock(renderer):null;if(dial)group.add(dial.group);
  let lamp=null,lastState={flags:[]};
  let progress=0, opening=null, started=0, resolveOpen;
  const setAngle=()=>{if(lid)lid.rotation.x=-progress*Math.PI*.58;};
  const prop={group,hit,dial,restore(state){progress=state.flags.includes(d.openedFlag)?1:0;opening=null;setAngle();},presenting(active){medal.group.visible=!active;},sync(state){dial?.sync(state.flags.includes(d.unlockFlag));lastState=state;medal.sync(state);if(lamp)lamp.material.color.setHex(state.flags.includes(d.unlockFlag)?0x18ed48:0x640908);if(state.flags.includes(d.openedFlag)){progress=1;setAngle();}},
    open(){if(progress===1)return Promise.resolve();if(opening)return opening;started=performance.now();return opening=new Promise(resolve=>{resolveOpen=resolve;});},
    update(){dial?.update();if(!opening)return;progress=Math.min(1,(performance.now()-started)/400);setAngle();if(progress===1){opening=null;resolveOpen();}},
  };
  prop.ready=Promise.all([loadBox(d.boxModel??'box203'),medal.ready]).then(([source])=>{if(!source)return;const model=source.clone(true);
    // The room uses baked lighting; preserve the source colour without requiring room lights.
    const materials=new Map();
    model.traverse(o=>{if(o.isMesh){const convert=m=>{if(!materials.has(m)){const basic=d.boxModel==='steelbox' && (m.metalness>.5)?new THREE.MeshStandardMaterial({name:m.name,map:m.map,color:m.color,metalness:.85,roughness:.42,envMap:hallEnv(renderer),envMapIntensity:1.5,emissive:m.color,emissiveMap:m.map,emissiveIntensity:.22}):new THREE.MeshBasicMaterial({name:m.name,map:m.map,color:m.color,side:m.side,transparent:m.transparent,opacity:m.opacity});materials.set(m,basic);}return materials.get(m);};o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);}});
    group.remove(procedural);group.add(model);lid=model.getObjectByName('lid')??null;lamp=model.getObjectByName('lamp');prop.assetsReady=true;prop.sync(lastState);setAngle();});
  return prop;
}
