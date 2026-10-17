import {layout} from './layout.js';
import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {preloadClown} from './eventprops.js';
import {collides} from './collision.js';

// A 25 cm navigation grid shares the player's static walls and moving door boxes.
// Static cells and edges are built once; dynamic doors are checked only on replans.
export async function createChase({scene,camera,world,game,doors,specialDoors,dynObstacles,jump,pose,debug,messages}) {
  const asset=await preloadClown(), figure=clone(asset.scene);
  // Baked hall lighting cannot illuminate a moving model. Give its albedo a
  // modest base illumination; the existing flashlight shader still controls blackout.
  figure.traverse(o=>{if(o.isMesh){const prepare=m=>{m=m.clone();m.emissive.copy(m.color);m.emissiveMap=m.map;m.emissiveIntensity=.32;return m;};o.material=Array.isArray(o.material)?o.material.map(prepare):prepare(o.material);}});
  figure.name='chasingClown';figure.visible=false;scene.add(figure);
  const mixer=new THREE.AnimationMixer(figure);
  const clip=THREE.AnimationClip.findByName(asset.animations,'ZombieWalk');
  if(!clip)throw new Error('clown.glb: ZombieWalk is missing');
  const walkAction=mixer.clipAction(clip), idleClip=THREE.AnimationClip.findByName(asset.animations,'Idle');
  if(!idleClip)throw new Error('clown.glb: Idle is missing');
  const idleAction=mixer.clipAction(idleClip);let animation=clip.name;
  walkAction.play();mixer.update(0);
  const {spawn,grid,clear:clearBounds}=layout.chase, {step,width,height,playerRadius}=grid, count=width*height;
  const navWorld={...world,playerRadius}, emptyWorld={playerRadius,obstacles:[]};
  const points=Array.from({length:count},(_,i)=>[i%width*step,Math.floor(i/width)*step]);
  const inside=(x,z)=>layout.chase.corridors.some(([x1,z1,x2,z2])=>x>=x1&&x<=x2&&z>=z1&&z<=z2) ||
    Object.values(world.rooms).some(r=>x>=r.bounds[0]&&x<=r.bounds[2]&&z>=r.bounds[1]&&z<=r.bounds[3]);
  function clear(a,b,boxes=[],w=navWorld) {
    const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.08));
    for(let i=0;i<=n;i++)if(collides(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,w,boxes))return false;
    return true;
  }
  const free=points.map(([x,z])=>inside(x,z)&&!collides(x,z,navWorld));
  const edges=points.map((p,i)=>free[i]?[i-1,i+1,i-width,i+width].filter(j=>j>=0&&j<count&&free[j]&&Math.hypot(points[j][0]-p[0],points[j][1]-p[1])<.26&&clear(p,points[j])):[]);
  // Render through the game's renderer, with isolated lighting unaffected by the
  // floor blackout shader. Reuse the same rig and ZombieWalk clip, never video.
  const movieScene=new THREE.Scene();movieScene.background=new THREE.Color(0);
  const movieCamera=new THREE.PerspectiveCamera(45,camera.aspect,.01,30);
  const movieFigure=clone(asset.scene);movieScene.add(movieFigure);
  movieFigure.traverse(o=>{if(o.isMesh){const prepare=m=>{m=m.clone();m.emissiveIntensity=0;return m;};o.material=Array.isArray(o.material)?o.material.map(prepare):prepare(o.material);}});
  const movieMixer=new THREE.AnimationMixer(movieFigure),movieAction=movieMixer.clipAction(clip);movieAction.play();movieMixer.update(0);
  const head=movieFigure.getObjectByName('head'),headPosition=new THREE.Vector3();
  const keyLight=new THREE.SpotLight(0xe7d9cf,3,12,.25,.85,1);
  keyLight.position.set(-.35,1.9,.5);keyLight.target.position.set(0,1.5,-3);movieScene.add(keyLight,keyLight.target);
  movieScene.add(new THREE.HemisphereLight(0x8593ab,0x030304,.009));
  let active=false, ended=false, saved=null, path=[], replan=0, detour=0, elapsed=0, movieTime=0, phase='idle';
  function movieFrame(){
    const approach=THREE.MathUtils.clamp((movieTime-.8)/4.3,0,1);
    movieCamera.aspect=camera.aspect;movieCamera.updateProjectionMatrix();
    // The rig faces local -Z. Turn it toward the camera and keep walking forward.
    movieFigure.rotation.y=Math.PI;movieFigure.position.set(0,0,-(5.5-5.28*approach));
    movieFigure.updateMatrixWorld(true);head.getWorldPosition(headPosition);
    movieCamera.position.set(0,headPosition.y+.18,.12);
    movieCamera.lookAt(0,headPosition.y+.16,-6);
    keyLight.position.y=movieCamera.position.y+.25;
    keyLight.target.position.copy(headPosition);keyLight.target.position.y+=.02;
    const lightDistance=keyLight.position.distanceTo(keyLight.target.position);
    keyLight.angle=Math.min(.75,Math.atan(.7/lightDistance));
    keyLight.intensity=lightDistance*.55;
    // Black first, reveal the walk, then black out after the face close-up.
    const shade=movieTime<.45?movieTime/.45:movieTime<.8?1:movieTime<1.15?1-(movieTime-.8)/.35:movieTime<5.1?0:Math.min(1,(movieTime-5.1)/.45);
    overlay.style.backgroundColor=`rgba(0,0,0,${shade})`;
  }
  const overlay=document.createElement('div');overlay.id='chaseEnding';overlay.hidden=true;
  overlay.innerHTML=messages.endingUI;document.body.append(overlay);
  const button=overlay.querySelector('button'),restart=overlay.querySelector('.restart');
  restart.onclick=e=>{e.preventDefault();e.stopPropagation();location.reload();};
  // Retry always starts where the lift-event camera stood, facing the left lift (not where the card was used).
  function checkpoint(){saved={state:game.snapshot(),pose:[...layout.chase.startPose],doors:doors.map(d=>({open:d.open,t:d.t,dir:d.dir}))};}
  function start(){if(active||ended)return;if(!saved)checkpoint();
    jump(...layout.chase.startPose);   // first start and retries both begin where the lift-event camera stood
    // Seal guest rooms immediately, including leaves partway through an animation.
    // restore() updates both the leaf and its collision box without changing the checkpoint.
    for(const d of doors)if(d.kind==='door' && typeof d.room==='number')d.restore({open:false,t:0,dir:0});
    specialDoors.get('rightLift')?.closeDoor?.();
    animation=game.liftEventActive?'Idle':clip.name;mixer.stopAllAction();(game.liftEventActive?idleAction:walkAction).reset().play();mixer.update(0);
    active=true;figure.position.set(spawn[0],0,spawn[1]);figure.rotation.y=-Math.PI/2;figure.visible=true;path=[];replan=0;elapsed=0;
  }
  game.onEvent(e=>{if(e==='leftElevatorOpened')start();});
  function showResult(win){
    phase='result';overlay.style.backgroundColor='#000';overlay.dataset.phase=phase;
    const label=overlay.querySelector('div');if(win)label.innerHTML=messages.clearResult;else label.textContent=messages.caughtResult;
    button.hidden=win;restart.hidden=!win;if(!win)button.focus({preventScroll:true});
  }
  function finish(win){
    ended=true;active=false;figure.visible=false;
    document.body.classList.add('chaseEnded');
    overlay.hidden=false;overlay.dataset.result=win?'clear':'caught';
    // Clear fades to black slowly; the overlay must be laid out once before 'shown' so the transition runs.
    if(win){overlay.style.transition='opacity 1.6s ease-in';overlay.getBoundingClientRect();}
    overlay.classList.add('shown');
    overlay.querySelector('div').textContent='';button.hidden=true;
    if(win){phase='clearFade';overlay.dataset.phase=phase;setTimeout(()=>{if(phase==='clearFade')showResult(true);},1600+2000);return;}
    phase='movie';movieTime=0;overlay.dataset.phase=phase;movieAction.reset().play();movieMixer.update(0);movieFrame();
  }
  button.onclick=e=>{e.preventDefault();e.stopPropagation();if(!saved||!ended||phase!=='result'||overlay.dataset.result!=='caught')return;game.restore(saved.state);doors.forEach((d,i)=>d.restore?.(saved.doors[i]));jump(...saved.pose);figure.visible=false;ended=false;active=false;phase='idle';path=[];overlay.hidden=true;overlay.classList.remove('shown');overlay.style.backgroundColor='';document.body.classList.remove('chaseEnded');};
  // loose: the clown itself may stand slightly inside a collision margin; then take the closest free cell within 1.5 m.
  function nearest(p,boxes,loose=false){let best=-1,distance=.8;for(let i=0;i<count;i++){if(!free[i])continue;const q=points[i],d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<distance&&clear(p,q,boxes)){best=i;distance=d;}}
    if(best<0&&loose&&collides(p[0],p[1],navWorld,boxes)){distance=1.5;for(let i=0;i<count;i++){if(!free[i])continue;const q=points[i],d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<distance){best=i;distance=d;}}}
    return best;}
  function route(boxes){
    const a=[figure.position.x,figure.position.z], b=[camera.position.x,camera.position.z];
    if(clear(a,b,boxes)){path=[b];return;}
    const from=nearest(a,boxes,true),to=nearest(b,boxes);path=[];if(from<0||to<0)return;
    const parent=new Int32Array(count).fill(-1),queue=new Int32Array(count);let head=0,tail=1;queue[0]=from;parent[from]=from;
    while(head<tail&&parent[to]<0){const i=queue[head++];for(const j of edges[i])if(parent[j]<0&&clear(points[i],points[j],boxes,emptyWorld)){parent[j]=i;queue[tail++]=j;}}
    if(parent[to]<0)return;
    let i=to;const ids=[i];while(i!==from){i=parent[i];ids.push(i);}ids.reverse();
    const raw=[...ids.map(i=>points[i]),b];let current=a,k=0;
    // After a blocked shortcut (corner clipping), follow the grid cell by cell for a moment.
    if(detour>0){path=raw;return;}
    while(k<raw.length){let next=k;while(next+1<raw.length&&clear(current,raw[next+1],boxes))next++;path.push(raw[next]);current=raw[next];k=next+1;}
  }
  function update(dt,realDt=dt){
    if(phase==='movie'){
      movieTime+=dt;movieMixer.update(dt);movieFrame();
      if(movieTime>=5.7)showResult(false);
      return;
    }
    if(active && game.liftEventActive){mixer.update(realDt);return;}
    if(active && animation==='Idle'){idleAction.stop();walkAction.reset().play();animation=clip.name;}
    if(!active||game.paused)return;
    // The figure waits inside until the sliding door is completely open.
    if(specialDoors.get('leftLift').t<1)return;
    elapsed+=dt;replan-=dt;detour-=dt;const boxes=[...dynObstacles.values()];
    // Exit doors (room doors stay sealed during the chase) open by themselves when the clown reaches them.
    const autoDoors=doors.filter(d=>d.kind==='door'&&typeof d.room!=='number'&&game.snapshot().flags.includes(d.room+'Unlocked'));
    for(const d of autoDoors)if(!d.open&&!d.dir&&Math.hypot(d.center[0]-figure.position.x,d.center[1]-figure.position.z)<1.3)(d.geometryToggle??d.toggle)();
    const me=[figure.position.x,figure.position.z],you=[camera.position.x,camera.position.z];
    // Within 3 m and in sight: head straight for the player every frame (grid replans lag behind side-steps).
    if(Math.hypot(me[0]-you[0],me[1]-you[1])<3&&clear(me,you,boxes))path=[you];
    else if(replan<=0){const shut=new Set(autoDoors.filter(d=>!d.open).map(d=>dynObstacles.get('door'+d.room)));route(boxes.filter(b=>!shut.has(b)));replan=.35;}
    const ramp=Math.min(1,.12+.88*elapsed/5);walkAction.timeScale=ramp;   // slow first steps, full speed after 5 s
    let travel=1.3*ramp*dt; // Player walking speed is 1.4 m/s.
    while(travel>0&&path.length){const q=path[0],p=[figure.position.x,figure.position.z],distance=Math.hypot(q[0]-p[0],q[1]-p[1]);if(distance<.01){path.shift();continue;}
      const amount=Math.min(travel,distance),x=p[0]+(q[0]-p[0])*amount/distance,z=p[1]+(q[1]-p[1])*amount/distance;
      if(!collides(p[0],p[1],navWorld,boxes)&&!clear(p,[x,z],boxes)){path=[];replan=0;detour=1;break;}
      figure.rotation.y=Math.atan2(q[0]-p[0],q[1]-p[1])+Math.PI;figure.position.set(x,0,z);travel-=amount;
    }
    mixer.update(dt);
    const a=[figure.position.x,figure.position.z],b=[camera.position.x,camera.position.z];
    if(Math.hypot(a[0]-b[0],a[1]-b[1])<1.2&&clear(a,b,boxes)){finish(false);return;}
    if(camera.position.x<clearBounds.maxX&&camera.position.x>clearBounds.minX&&Math.abs(camera.position.z-clearBounds.z)<clearBounds.halfDepth)finish(true);
  }
  if(debug){const b=document.createElement('button');b.id='debugChase';b.textContent=messages.debugChase;b.onclick=()=>{if(active||ended)return;game.debugStartChase();};document.querySelector('#gameDebug').append(b);}
  return {update,checkpoint,get movie(){return phase==='movie'&&movieTime>=.45?{scene:movieScene,camera:movieCamera}:null;},get ended(){return ended;},get active(){return active;},figure,stats:()=>({active,ended,position:figure.position.toArray(),path:path.map(p=>[...p]),elapsed,phase,movieTime,animation})};
}
