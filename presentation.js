import {ownResources,disposeOwned} from './resources.js';
import {renderMessage} from './message-text.js';
import {buildHotelKey} from './keyprops.js';
import {buildCard} from './cardprops.js';
import * as THREE from 'three';
import {loadMedallions} from './liftprops.js';
import {buildPlate} from './plateprops.js';

// Isolated scene and lights: pickup models never inherit the room's darkness.
export function createPresentation({data,camera,renderer,ui}) {
  const layer=document.createElement('section');layer.id='presentation';layer.hidden=true;
  layer.innerHTML=data.messages.presentationUI;
  ui.append(layer);
  const text=layer.querySelector('.presentationText'),choices=layer.querySelector('.presentationChoices'),fade=layer.querySelector('.presentationFade');
  const back=layer.querySelector('.paintingBack');back.onclick=e=>{e.stopPropagation();answer(false);};
  const stage=new THREE.Scene(),lens=new THREE.PerspectiveCamera(40,1,.01,100);lens.position.z=3;
  stage.add(new THREE.HemisphereLight(0xfff1db,0x647599,3));
  for(const [color,intensity,pos] of [[0xffe4bb,5,[2,3,4]],[0xaccfff,3,[-3,1,2]],[0xffffff,4,[1,2,-2]]]){const light=new THREE.DirectionalLight(color,intensity);light.position.fromArray(pos);stage.add(light);}
  let session=null,model=null,viewCamera=null,generation=0;
  function paintName(name,tail='') {renderMessage(text,name+tail,{highlight:name});}
  function setSelection(n){session.selection=n;for(const [i,b] of [...choices.children].entries()){b.classList.toggle('selected',i===n);b.setAttribute('aria-pressed',String(i===n));}}
  function question(){if(!session || session.kind!=='item' && !session.itemId)return;session.phase='ready';layer.dataset.phase='ready';const lines=session.lines??[session.name+data.messages.itemExistsSuffix,data.messages.pickupQuestion];paintName(session.name,lines.join('\n').replace(session.name,''));choices.hidden=false;setSelection(0);}
  function cleanup(){session?.world?.stop();session?.def?.onCleanup?.();back.hidden=true;back.disabled=false;generation++;if(model){stage.remove(model);disposeOwned(model);model=null;}session=null;viewCamera=null;layer.hidden=true;document.body.classList.remove('presenting');}
  function answer(yes){if(!session || session.phase!=='ready')return;const s=session;if(s.kind==='item'){cleanup();if(yes)s.done();}else if(yes && s.def.onAccept){session.phase='reaction';layer.dataset.phase='reaction';choices.hidden=true;Promise.resolve(s.def.onAccept()).then(()=>{if(session===s){session.phase='ready';answer(true);}});delete s.def.onAccept;}else{session.phase='out';session.time=performance.now();session.accept=yes;layer.dataset.phase='out';text.hidden=true;choices.hidden=true;}}
  for(const [i,b] of [...choices.children].entries()){b.onclick=e=>{e.stopPropagation();setSelection(i);answer(i===0);};b.onpointerenter=()=>{if(session)setSelection(i);};}
  layer.onclick=()=>{if(!session)return;if(session.phase==='name')question();else if(session.phase==='ready' && !session.choice && (!session.world || session.world.tapToClose)){if(session.def?.onTap?.())return;answer(true);}};
  document.addEventListener('keydown',e=>{if(!session)return;if(!['ArrowUp','ArrowDown','KeyW','KeyS','Enter','Space','Escape'].includes(e.code))return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;if(e.code==='Escape'){if(session.kind==='item')cleanup();else answer(!!session.def?.mandatory);return;}if(session.phase==='name'){if(['Enter','Space'].includes(e.code))question();return;}if(session.phase!=='ready' || session.world)return;if(['ArrowUp','KeyW'].includes(e.code))setSelection(0);else if(['ArrowDown','KeyS'].includes(e.code))setSelection(1);else{if(!session.choice && session.def?.onTap?.())return;answer(!session.choice || session.selection===0);}},true);
  function begin(kind,done){layer.hidden=false;layer.className=kind;document.body.classList.add('presenting');text.hidden=false;choices.hidden=true;fade.style.opacity='0';session={kind,done,time:performance.now(),phase:'name',selection:0,choice:kind==='item'};layer.dataset.phase='name';}
  async function item(id,done,lines){begin('item',done);session.name=data.items[id].label;session.lines=lines;question();await loadItem(id);}
  async function loadItem(id){const token=++generation;
    const source=await buildPickupModel(id,data,renderer);
    if(token!==generation){disposeOwned(source);return;}
    const box=new THREE.Box3().setFromObject(source),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());source.position.sub(center);const normalized=new THREE.Group();normalized.add(source);normalized.scale.setScalar((id==='card'?.98:.9)/Math.max(size.x,size.y,size.z));model=new THREE.Group();model.add(normalized);stage.add(model);
  }
  async function boxItem(id,open){const s=session;if(!s)return;s.itemId=id;s.name=data.items[id].label;s.lines=s.def.messageLines;s.phase='reaction';layer.dataset.phase='reaction';choices.hidden=true;text.hidden=true;await open?.();if(session!==s)return;await loadItem(id);if(session!==s)return;s.itemTime=performance.now();layer.classList.add('item');text.hidden=false;question();}

  function event(d,done,world=null){begin('event',done);session.phase='in';session.def=d;session.world=world;session.choice=!!d.presentationChoice;layer.dataset.phase='in';text.hidden=true;fade.style.opacity='0';}
  function update(t){if(!session)return;const elapsed=(performance.now()-session.time)/1000;
    if(session.kind==='item' || session.itemId && session.phase==='ready'){if(model){const itemElapsed=session.itemTime?(performance.now()-session.itemTime)/1000:elapsed;const k=Math.min(1,itemElapsed/(session.itemId ? .65 : .45));model.scale.setScalar(.02+.98*(1-Math.pow(1-k,3)));if(session.itemId)model.position.y=-.48*(1-k);model.rotation.set(.15*Math.sin(t*.7),itemElapsed*.55,.08*Math.sin(t*.5));}}
    else if(session.phase==='in'){fade.style.opacity=String(Math.min(1,elapsed/.4));if(elapsed>=.4){viewCamera=camera.clone();const pose=session.def.camera;viewCamera.position.fromArray(pose.position);viewCamera.lookAt(new THREE.Vector3(...pose.target));viewCamera.fov=pose.fov??48;if(session.def.fitPortrait || ['painting','hieroglyph','seaWindow'].includes(session.def.id))viewCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(viewCamera.fov/2))/Math.min(1,camera.aspect)));if(session.def.id==='welcome' && camera.aspect<1){const dist=viewCamera.position.distanceTo(new THREE.Vector3(...pose.target));viewCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(.125/(dist*camera.aspect)));}if(session.def.id==='painting' && camera.aspect<1){const dist=viewCamera.position.distanceTo(new THREE.Vector3(...pose.target));viewCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(.28/(dist*camera.aspect)));}// portrait phone: fit painting + plate row (~56 cm) to screen width
viewCamera.updateProjectionMatrix();session.phase='reveal';session.time=performance.now();}}
    else if(session.phase==='reveal'){fade.style.opacity=String(Math.max(0,1-elapsed/.4));if(elapsed>=.4){session.phase='ready';layer.dataset.phase='ready';text.hidden=!!session.world && !session.world.message;renderMessage(text,session.world && !session.world.message?'':session.def.messageLines.join('\n'));choices.hidden=!session.choice || !!session.world;if(session.world){layer.classList.add('paintingWorld');back.hidden=false;session.world.start();}setSelection(0);session.def.onReady?.();}}
    else if(session.phase==='out'){fade.style.opacity=String(Math.min(1,elapsed/.4));if(elapsed>=.4){session.world?.stop();back.hidden=true;viewCamera=null;if(model){stage.remove(model);}session.phase='return';layer.dataset.phase='return';session.time=performance.now();layer.className='return';}}
    else if(session.phase==='return'){fade.style.opacity=String(Math.max(0,1-elapsed/.4));if(elapsed>=.4){const s=session;cleanup();if(s.accept)s.done();}}
  }
  function render(){if(viewCamera){if(session?.def.fitPortrait && ['leftLift','leftLiftEvent','rightLift','dialLock'].includes(session.def.id))viewCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad((session.def.camera.fov??48)/2))/Math.min(1,camera.aspect)));if(session?.def.id==='rightLift'){
      // Fit the plate to portrait width, or 43% of landscape height.
      const portrait=camera.aspect<1,dist=.78,y=portrait?1.255:1.34;
      viewCamera.position.set(4.56+dist,y,18.02);viewCamera.lookAt(4.56,y,18.02);
      const halfSpan=portrait?.315/.88/camera.aspect/2:.238586/.43/2;
      viewCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(halfSpan/(dist-.023)));
    }viewCamera.aspect=camera.aspect;viewCamera.updateProjectionMatrix();}if(!session || session.kind!=='item' && !session.itemId || !model || session.phase==='return')return;lens.aspect=camera.aspect;lens.position.z=session.name===data.items.card.label?3/Math.min(1,camera.aspect):3/Math.min(1,camera.aspect*1.25);lens.updateProjectionMatrix();const auto=renderer.autoClear;renderer.autoClear=false;renderer.clearDepth();renderer.render(stage,lens);renderer.autoClear=auto;}
  return {item,event,boxItem,setBusy(busy){if(!session)return;session.phase=busy?'reaction':'ready';layer.dataset.phase=session.phase;back.disabled=busy;},message(value){text.hidden=false;renderMessage(text,value);},close(accept=false,done){if(!session)return;if(done)session.done=done;answer(accept);},update,render,get active(){return !!session;},get eventId(){return session?.kind==='event'?session.def.id:null;},get viewCamera(){return viewCamera;},get modelPose(){return model?{position:model.position.toArray(),rotation:model.rotation.toArray()}:null;}};
}
function buildSimpleItem(id,label){const g=new THREE.Group(),brass=new THREE.MeshStandardMaterial({color:0xc4a457,metalness:.65,roughness:.3}),white=new THREE.MeshStandardMaterial({color:0xf3eee0,roughness:.65});
 const add=(geo,mat,x=0,y=0,z=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);g.add(m);return m;};
 const c=document.createElement('canvas');c.width=256;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=id==='emergency'?'#9b201d':'#eee9d9';ctx.fillRect(0,0,256,128);ctx.fillStyle=id==='emergency'?'white':'#34382f';ctx.textAlign='center';ctx.font='bold 27px sans-serif';ctx.fillText(id==='key205'?'205':id==='card'?'HOTEL':label,128,72);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
 const face=new THREE.MeshStandardMaterial({map:tex,roughness:.65});add(new THREE.BoxGeometry(id==='card'?.86:.48,id==='card'?.54:.25,.025),[white,white,white,white,face,white],id==='card'?0:.2,id==='card'?0:.28);
 if(id!=='card'){add(new THREE.TorusGeometry(.13,.035,8,24),brass,-.18,.2);add(new THREE.BoxGeometry(.06,.5,.04),brass,-.18,-.12);for(let i=0;i<3;i++)add(new THREE.BoxGeometry(.11,.045,.04),brass,-.12,-.23+i*.07);}else add(new THREE.BoxGeometry(.13,.11,.008),new THREE.MeshStandardMaterial({color:0xb6a06b,metalness:.6,roughness:.4}),-.23,.02,.018);
 return ownResources(g,{geometry:true,textures:true});}

export async function buildPickupModel(id,data,renderer){
    let source;
    if(['star','cat','octopus'].includes(id)){const assets=await loadMedallions();source=assets[{star:1,cat:2,octopus:3}[id]].clone(true);source.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.metalness=.5;o.material.roughness=.32;}});ownResources(source);}
    else if(['moon','island','ship'].includes(id))source=buildPlate(id,null);
    else source=id==='card'?buildCard():id==='key205'?await (async()=>{const k=await buildHotelKey(renderer),w=new THREE.Group();k.rotation.set(Math.PI/2,0,-.5);w.add(k);return w;})():buildSimpleItem(id,data.items[id].label);
    return source;
}
