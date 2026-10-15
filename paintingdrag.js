import * as THREE from 'three';

// All positions are in the actual painting's local coordinates.
export function createPaintingDrag({prop,state,d,layer,camera,commit}) {
  const {group,plates,centers}=prop, ids=Object.keys(d.answer);
  const ray=new THREE.Raycaster(),normal=new THREE.Vector3(),plane=new THREE.Plane();
  const rim=new THREE.Shape([new THREE.Vector2(-.04,-.04),new THREE.Vector2(.04,-.04),new THREE.Vector2(.04,.04),new THREE.Vector2(-.04,.04)]);
  rim.holes.push(new THREE.Path([new THREE.Vector2(-.032,-.032),new THREE.Vector2(-.032,.032),new THREE.Vector2(.032,.032),new THREE.Vector2(.032,-.032)]));
  const highlight=new THREE.Mesh(new THREE.ShapeGeometry(rim),new THREE.MeshBasicMaterial({color:0x7effbf,transparent:true,opacity:.9,depthWrite:false}));
  highlight.visible=false;group.add(highlight);
  let active=false,drag=null,animation=null;
  const row=id=>new THREE.Vector3((ids.indexOf(id)-1)*.116,-.41,.07);
  const seat=cell=>new THREE.Vector3(...centers[cell],.024);
  const target=id=>Number.isInteger(state.placements[d.id]?.[id])?seat(state.placements[d.id][id]):row(id);
  function sync(){if(!active)return;for(const id of ids){plates[id].visible=state.items.includes(id);if(drag?.id!==id && animation?.id!==id)plates[id].position.copy(target(id));}}
  function point(e){const cam=camera();if(!cam)return null;group.updateWorldMatrix(true,false);cam.updateMatrixWorld();ray.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2),cam);normal.set(0,0,1).transformDirection(group.matrixWorld);plane.setFromNormalAndCoplanarPoint(normal,group.localToWorld(new THREE.Vector3(0,0,.06)));const p=ray.ray.intersectPlane(plane,new THREE.Vector3());return p?group.worldToLocal(p):null;}
  function cellAt(p,id){const cell=centers.findIndex(([x,y])=>Math.abs(p.x-x)<.034 && Math.abs(p.y-y)<.034);return cell>=0 && !Object.entries(state.placements[d.id]??{}).some(([k,v])=>k!==id && v===cell)?cell:null;}
  function move(e){if(!drag || e.pointerId!==drag.pointer)return;e.preventDefault();const p=point(e);if(!p)return;plates[drag.id].position.copy(p);drag.cell=cellAt(p,drag.id);highlight.visible=drag.cell!==null;if(highlight.visible)highlight.position.set(...centers[drag.cell],.036);}
  function down(e){if(!active || animation || drag || e.button>0)return;const p=point(e);if(!p)return;const id=ids.find(id=>plates[id].visible && Math.abs(p.x-plates[id].position.x)<.045 && Math.abs(p.y-plates[id].position.y)<.045);if(!id)return;e.preventDefault();e.stopPropagation();drag={id,pointer:e.pointerId,cell:null};layer.setPointerCapture(e.pointerId);move(e);}
  function up(e){if(!drag || drag.pointer!==e.pointerId)return;e.preventDefault();const {id,cell}=drag;const cancelled=e.type==='pointercancel';animation={id,cell:cancelled?state.placements[d.id]?.[id]??null:cell,from:plates[id].position.clone(),to:cancelled?target(id):cell===null?row(id):seat(cell),time:performance.now()};drag=null;highlight.visible=false;if(layer.hasPointerCapture(e.pointerId))layer.releasePointerCapture(e.pointerId);}
  layer.addEventListener('pointerdown',down);layer.addEventListener('pointermove',move);layer.addEventListener('pointerup',up);layer.addEventListener('pointercancel',up);
  return {start(){active=true;sync();},stop(){active=false;drag=null;animation=null;highlight.visible=false;prop.sync(state);},sync,update(){if(!animation)return;const a=animation,k=Math.min(1,(performance.now()-a.time)/220);plates[a.id].position.lerpVectors(a.from,a.to,1-(1-k)**3);if(k===1){animation=null;commit(a.id,a.cell);sync();}},screenPoint(id,cell){const p=cell===null?row(id):cell===undefined?plates[id].position.clone():seat(cell);const v=group.localToWorld(p).project(camera());return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2};},get dragging(){return drag?.id??null;},get active(){return active;}};
}
