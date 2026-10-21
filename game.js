import {createSettings} from './settings.js';
import {loadTexture} from './loaders.js';
import {layout} from './layout.js';
import {assetUrl} from './version.js';
import {createInventoryThumbnails} from './inventory.js';
import {renderMessage} from './message-text.js';
import {createDialControl} from './dialprops.js';
import {createCorridorDecor} from './corridordecor.js';
import {buildBox} from './boxprops.js';
export {preloadClown} from './eventprops.js';
export {preloadBoxProps} from './boxprops.js';
import {createMedallionDrag} from './medalliondrag.js';
import {createPaintingDrag} from './paintingdrag.js';
import {buildCard} from './cardprops.js';
import * as THREE from 'three';
import {buildEventProps} from './eventprops.js';
import {createPresentation} from './presentation.js';
import {LIFT_PROPS, buildCallLamp} from './liftprops.js';
export {preloadLiftProps} from './liftprops.js';

// Content lives in story.json; snapshots contain only gameplay state.
export function createGame({changeLanguage, save, playSe, beforeLeftLift, ending, data, scene, camera, rooms, doorObjects, jump, debug, canReach, renderer, flashlight}) {
  const state = {items: [], used: [], flags: [], inserted: {}, placements: {}, selected: null};
  const objects = new Map(), listeners = new Set();
  const ui = document.createElement('div'); ui.id = 'gameUI';
  ui.innerHTML = `<div id="caption" role="status" aria-live="polite" hidden></div>`;
  document.body.append(ui);
  const caption = ui.querySelector('#caption');
  let liftEventActive = false, liftOpening = false, liftOpenedAt = null, liftMsgStep = 0;
  let saidAt = 0, objectiveAt = null, boxOpening = false, doorMessage = false, captionChoice = null, captionDone = null, blackoutPhase = 'idle', blackoutAt = 0;
  const captionChoices=document.createElement("div");captionChoices.className="captionChoices presentationChoices";captionChoices.hidden=true;captionChoices.innerHTML=data.messages.captionChoices;caption.append(captionChoices);
  function endCaptionChoice(yes){const done=captionChoice;captionChoice=null;say('');if(yes)done?.();}
  for(const b of captionChoices.children)b.onclick=e=>{consume(e);endCaptionChoice(b.dataset.dialAnswer==='yes');};
  const say = (message, pause = true) => {caption.classList.remove('objective');const done = !message ? captionDone : null; captionDone = null; doorMessage = !!message && pause; renderMessage(caption,message);if(captionChoice)caption.append(captionChoices);captionChoices.hidden=!captionChoice; caption.hidden = !message; if (message) saidAt = performance.now(); done?.();};
  // Dismiss paused captions at pointerdown, consuming the entire gesture.
  let closingPointer = null;
  const consume = e => {e.preventDefault();e.stopImmediatePropagation();};
  document.addEventListener('pointerdown', e => {
    if (!doorMessage) {closingPointer = null; return;}
    if (objectiveFading()) {consume(e); return;}
    if(captionChoice && e.target.closest?.('.captionChoices'))return;
    closingPointer = e.pointerId;if(captionChoice)endCaptionChoice(false);else say(''); consume(e);
  }, true);
  for (const type of ['pointerup','pointercancel','click']) document.addEventListener(type, e => {
    if (closingPointer === null || (type !== 'click' && e.pointerId !== closingPointer)) return;
    consume(e); if(type === 'click' || type === 'pointercancel')closingPointer = null;
  }, true);
  document.addEventListener('keydown', e => {
    if (!doorMessage) return;
    consume(e);if(objectiveFading())return;if(captionChoice){if(!e.repeat && e.code==='Escape')endCaptionChoice(false);else if(!e.repeat && ['Enter','Space'].includes(e.code))endCaptionChoice(true);return;} if (!e.repeat && ['Enter','Space'].includes(e.code)) say('');
  }, true);
  document.addEventListener('click', e => {if (!doorMessage && !caption.hidden && performance.now() - saidAt > 400 && !e.target.closest?.('#gameDebug')) say('');}, true);
  // Objectives: the current hint under an "Objective" heading, at the start of a new game and right after each
  // medallion or the flashlight is obtained. They wait until every pickup presentation and message has closed.
  const OBJECTIVE_ITEMS = ['star', 'octopus', 'cat', 'flashlight'], OBJECTIVE_FADE = 500;
  const objectiveFading = () => caption.classList.contains('objective') && performance.now() - saidAt < OBJECTIVE_FADE;
  const queueObjective = (delay = 0) => {objectiveAt = performance.now() + delay;};
  function showObjective() {
    if (objectiveAt === null || performance.now() < objectiveAt || !caption.hidden || doorMessage || presentation.active || boxOpening
      || blackoutPhase !== 'idle' || inventoryPhase !== 'closed' || settingsUI.open || liftEventActive || ending()) return;
    objectiveAt = null;
    const text = currentHint(); if (!text) return;
    say(text, true);
    const label = document.createElement('div'); label.className = 'objectiveLabel'; label.textContent = data.messages.objectiveLabel;
    caption.prepend(label); caption.classList.add('objective');
  }
  const has = c => !c || (c.items ?? []).every(i => state.items.includes(i)) && (c.flags ?? []).every(f => state.flags.includes(f));
  const flag = f => {if (!state.flags.includes(f)) state.flags.push(f);};
  const markUsed = id => {if(!state.used.includes(id))state.used.push(id);};
  function apply(result = {}) {
    for (const i of result.take ?? []) {markUsed(i);state.items = state.items.filter(x => x !== i);}
    for (const i of result.give ?? []) if (!state.items.includes(i)) {state.items.push(i);if (OBJECTIVE_ITEMS.includes(i)) queueObjective();}
    for (const f of result.flags ?? []) flag(f);
    for (const id of result.open ?? []) doorObjects.get(id)?.openDoor();
    if (result.event) {window.dispatchEvent(new CustomEvent(result.event)); for (const fn of listeners) fn(result.event);}
    if (!state.items.includes(state.selected)) state.selected = null;
    render();
  }
  const blackoutFade=document.createElement('div');blackoutFade.id='blackoutFade';blackoutFade.setAttribute('aria-hidden','true');ui.append(blackoutFade);
  function startBlackout(){
    if(blackoutPhase!=='idle'||flashlight.acquired)return;
    say('');blackoutPhase='dimming';flashlight.trigger();
  }
  function updateBlackout(){
    const now=performance.now();flashlight.fade(now);
    if(blackoutPhase==='dimming' && flashlight.progress>=1){
      blackoutPhase='message';say(data.messages.blackoutNotice,true);
      captionDone=()=>{say(data.messages.flashlightAdvice,true);captionDone=()=>{blackoutPhase='out';blackoutAt=performance.now();};};
    }else if(blackoutPhase==='out'){
      blackoutFade.style.opacity=String(Math.min(1,(now-blackoutAt)/450));
      if(now-blackoutAt>=450){apply({give:['flashlight']});flashlight.acquire();blackoutPhase='in';blackoutAt=now;}
    }else if(blackoutPhase==='in'){
      blackoutFade.style.opacity=String(Math.max(0,1-(now-blackoutAt)/450));
      if(now-blackoutAt>=450)blackoutPhase='idle';
    }
  }
  function render() {
    eventFigure.visible=!state.flags.includes('clownGone');
    // Corridor balloons and bunting pile up: cat medallion, then all three medallions, then the flashlight.
    const f=state.flags;corridorDecor.setStage(state.items.includes('flashlight')?3:['starFound','queenTaken','lodgeTaken'].every(x=>f.includes(x))?2:f.includes('starFound')?1:0);
    eventFigure.userData.haze.visible=eventFigure.visible;
    for (const [id, o] of objects) {
      const taken = o.def.once && state.flags.includes(o.def.once) && o.def.kind === 'pickup';
      o.root.visible = !taken;
      for (const m of o.hideMaterials ?? []) m.visible = !taken;
      o.sync?.(state);   // prop visuals (inserted medals, lamps, LED) follow state
    }
    if (debugPanel) debugPanel.querySelector('pre').textContent = JSON.stringify(state, null, 2);
  }
  function select(id) {if (id && !state.items.includes(id)) return false; state.selected = state.selected === id ? null : id; render(); return true;}
  const eventFigure=buildEventProps(scene, rooms, data, renderer);
  const corridorDecor=createCorridorDecor(scene, rooms);
  const presentation = createPresentation({data, camera, renderer, ui});
  const thumbnail=createInventoryThumbnails(data,renderer);
  let inventoryPhase = 'closed', inventoryTimer;
  const bagButton=document.createElement('button');bagButton.id='bagButton';bagButton.type='button';bagButton.setAttribute('aria-label',data.messages.inventoryLabel);bagButton.setAttribute('aria-expanded','false');
  bagButton.innerHTML=`<svg viewBox="0 0 36 30" aria-hidden="true"><defs><linearGradient id="folderPaper" x2="0.4" y2="1"><stop stop-color="#b5a17a"/><stop offset="1" stop-color="#79684b"/></linearGradient></defs><path d="M4 8V5q0-2 2-2h9l3 4h12q2 0 2 2v16H4Z" fill="#75664e" stroke="#c0ad88" stroke-width=".7"/><path d="M3 11q0-2 2-2h25q2 0 2 2l-2 15H5Z" fill="url(#folderPaper)" stroke="#c0ad88" stroke-width=".8"/><path d="m7 12 20-.4M8 24l17 .3M6 14l-.4 7" stroke="#ded0b0" opacity=".24" fill="none"/></svg>`;
  const bagScreen=document.createElement('div');bagScreen.id='bagScreen';bagScreen.hidden=true;bagScreen.innerHTML=data.messages.inventoryDialog;ui.append(bagButton,bagScreen);
  // Magnifier above the bag shows the hint for the current progress (story.json hints, first unmet wins).
  const hintButton=document.createElement('button');hintButton.id='hintButton';hintButton.type='button';hintButton.setAttribute('aria-label',data.messages.hintLabel);hintButton.hidden=true;
  hintButton.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="13" cy="13" r="8.5" fill="#0006" stroke="#c0ad88" stroke-width="2.6"/><path d="M19.5 19.5 28 28" stroke="#c0ad88" stroke-width="4" stroke-linecap="round"/></svg>';
  const currentHint=()=>{const has=f=>state.flags.includes(f);for(const h of data.hints??[]){if(h.requires&&!h.requires.every(has))continue;if(!h.done.some(g=>g.split('+').every(has)))return h.text;}return '';};
  hintButton.addEventListener('pointerdown',e=>e.stopPropagation());hintButton.onclick=e=>{consume(e);captionChoice=()=>say(currentHint(),true);say(data.messages.hintQuestion,true);};   // the pause message freezes time until answered
  ui.append(hintButton);
  const settingsUI=createSettings({ui,data,changeLanguage,save:()=>{captionChoice=()=>{save().then(ok=>{if(ok)say(data.messages.savedMessage,true);});};say(data.messages.saveQuestion,true);},giveUp:()=>{captionChoice=()=>{const url=new URL(location.href);url.searchParams.delete('check');url.searchParams.delete('debug');location.replace(url);};say(data.messages.giveUpQuestion,true);},blocked:()=>ending()||doorMessage||presentation.active||boxOpening||inventoryPhase!=='closed'||blackoutPhase!=='idle'});
  function relabel(){hintButton.setAttribute('aria-label',data.messages.hintLabel);bagButton.setAttribute('aria-label',data.messages.inventoryLabel);bagScreen.querySelector('section').setAttribute('aria-label',data.messages.inventoryLabel);const template=document.createElement('template');template.innerHTML=data.messages.captionChoices;[...captionChoices.children].forEach((b,i)=>b.textContent=template.content.children[i].textContent);presentation.relabel();settingsUI.refresh();for(const o of objects.values())o.name=o.def.label;}
  function closeInventory(){
    if(inventoryPhase==='closed'||inventoryPhase==='closing')return;
    clearTimeout(inventoryTimer);inventoryPhase='closing';bagScreen.classList.remove('shown');
    inventoryTimer=setTimeout(()=>{bagScreen.hidden=true;inventoryPhase='closed';bagButton.setAttribute('aria-expanded','false');bagButton.focus({preventScroll:true});},240);
  }
  function openInventory(){
    if(settingsUI.open||ending()||inventoryPhase!=='closed'||doorMessage||presentation.active||boxOpening||blackoutPhase!=='idle')return;
    const grid=bagScreen.querySelector('.inventoryGrid');grid.replaceChildren();
    for(const id of ['star','octopus','cat','moon','island','ship','key205','card','emergency']){
      const slot=document.createElement('div');slot.className='inventorySlot';slot.dataset.item=id;
      const obtained=state.items.includes(id)||state.used.includes(id),used=state.used.includes(id);
      slot.dataset.state=obtained?(used?'used':'obtained'):'empty';
      if(obtained){const img=document.createElement('img');img.alt='';const name=document.createElement('span');name.textContent=data.items[id].shortLabel??data.items[id].label;slot.append(img,name);thumbnail(id).then(src=>{img.src=src;}).catch(console.error);}
      grid.append(slot);
    }
    inventoryPhase='opening';bagScreen.hidden=false;bagButton.setAttribute('aria-expanded','true');
    requestAnimationFrame(()=>bagScreen.classList.add('shown'));
    inventoryTimer=setTimeout(()=>{inventoryPhase='open';bagScreen.querySelector('section').focus({preventScroll:true});},240);
  }
  bagButton.addEventListener('pointerdown',e=>e.stopPropagation());bagButton.onclick=e=>{consume(e);if(inventoryPhase==='closed')openInventory();else closeInventory();};
  bagScreen.addEventListener('pointerdown',e=>e.stopPropagation());bagScreen.onclick=e=>{consume(e);if(!e.target.closest('.inventoryGrid'))closeInventory();};
  document.addEventListener('keydown',e=>{if(inventoryPhase!=='closed'){consume(e);if(e.code==='Escape'&&!e.repeat)closeInventory();}else if(e.code==='KeyI'&&!e.repeat){consume(e);openInventory();}},true);
  function finish(d) {
     say('');
    if (d.result?.give?.length) {
      presentation.item(d.result.give[0], () => {apply(d.kind==='grid'?{...d.result,take:Object.keys(d.answer)}:d.result); say(d.message || data.messages.pickupDone,true);}, d.pickupMessageLines??d.messageLines);
    } else {apply(d.result); say(d.silentFinish ? '' : (d.message || data.messages.inspectDone),true);}
    return true;
  }
  function interact(id, input = {}) {
    const d = objects.get(id)?.def; if (!d || (presentation.active && !(['painting','rightLift'].includes(d.id) && input.inWorld))) return false;
    if (settingsUI.open || ending() || blackoutPhase!=='idle' || doorMessage || !canReach(d.position,d.room)) return false;
    if(d.id==='courtyardWindow' && state.flags.includes('clownGone'))return false;
    if(d.model==='box203'){
      if(!has(d.requires))return false;
      if(state.flags.includes(d.takenFlag)){say(data.messages.boxEmpty,true);return true;}
      if(d.unlockFlag && !state.flags.includes(d.unlockFlag)){
        if(d.boxModel==='steelbox'){
          if(!state.items.includes(d.item)){say(data.messages.slitBoxLocked,true);return true;}
          captionChoice=()=>{flag(d.unlockFlag);playSe('unlock');render();interact(id);};
          say(data.messages.slitBoxQuestion,true);return true;
        }
        else if(d.kind!=='dial'){say(data.messages.boxLocked,true);return true;}
        if(d.kind==='dial'){
          captionChoice=()=>{
            const o=objects.get(id),target=o.root.localToWorld(new THREE.Vector3(0,.095,.132)),eye=o.root.localToWorld(new THREE.Vector3(0,.095,.34));
            presentation.event({...d,id:'dialLock',presentationChoice:false,camera:{position:eye.toArray(),target:target.toArray(),fov:34},fitPortrait:true,messageLines:[]},()=>{}, {start:()=>dialControl.start(),stop:()=>dialControl.stop()});
          };
          say(data.messages.dialQuestion,true);return true;
        }
        flag(d.unlockFlag);render();
      }else say('');
      const o=objects.get(id), target=o.root.localToWorld(new THREE.Vector3(0,.045,0));
      const eye=o.root.localToWorld(new THREE.Vector3(0,d.id!=='box203'?.82:.62,d.id!=='box203'?.36:.26));
      presentation.event({...d,camera:{position:eye.toArray(),target:target.toArray(),fov:48},messageLines:d.pickupMessageLines,fitPortrait:true,onReady:()=>presentation.boxItem(d.result.give[0],async()=>{say('');await o.prop.open();flag(d.openedFlag);render();o.prop.presenting(true);}),onCleanup:()=>o.prop.presenting(false)},()=>{apply(d.result);if(d.id==='liftBox')startBlackout();else say(d.message,true);});
      return true;
    }
    if(['leftLift','rightLift'].includes(d.id) && state.flags.includes(d.once)) return false;
    if(d.id==='leftLift') {
      const used=state.flags.includes(d.once), choice=!used && state.items.includes(d.item);
      say('');
      presentation.event({...d,presentationChoice:choice,messageLines:choice?[data.messages.cardQuestion]:[],
        onAccept:choice?()=>{
          beforeLeftLift();liftEventActive=true;markUsed('card');
          // Commit the checkpoint and room sealing now; open the lift only in the front view.
          apply({...d.result,open:[]});
          presentation.event({id:'leftLiftEvent',mandatory:true,camera:layout.leftLiftCamera,fitPortrait:true,messageLines:[],
            onReady:()=>{presentation.setBusy(true);doorObjects.get('leftLift').openDoor();liftOpening=true;liftMsgStep=0;},
            onTap:()=>{if(liftMsgStep!==1)return false;liftMsgStep=2;presentation.message(data.messages.clownWarning);return true;}
          },()=>{liftEventActive=false;});
        }:undefined},()=>{},choice?null:{start:()=>{},stop:()=>{},tapToClose:true});
      return true;
    }
    if(d.id==='rightLift' && !input.inWorld) {
      say('');
      presentation.event({...d,messageLines:[]},()=>{}, {start:()=>medallionDrag.start(),stop:()=>medallionDrag.stop(),tapToClose:!d.accept.some(id=>state.items.includes(id))});
      return true;
    }
    if (d.once && state.flags.includes(d.once)) {
      if(d.id==='painting'){say('');presentation.event({...d,messageLines:[],presentationChoice:false},()=>{});return true;}
      if(d.id==='clown'){say(data.messages.clownInspect,true);return true;}
      return false;
    }
    if (!has(d.requires)) return false;
    if (d.presentation === 'event' && !input.presented && input.cell === undefined && !input.remove && input.code === undefined) {
      say('');
      presentation.event(d, () => {if(d.kind!=='grid')apply(d.result);}, d.kind==='grid'?{start:()=>paintingDrag.start(),stop:()=>paintingDrag.stop()}:null);
      return true;
    }
    if (d.kind === 'grid') {
      const p=input.plate??state.selected;
      if(input.remove){if(!(p in d.answer)||!state.items.includes(p))return false;delete (state.placements[id]??={})[p];state.used=state.used.filter(i=>i!==p);render();return true;}
      if (input.cell === undefined) {return interact(id);}
      if (!(p in d.answer) || !state.items.includes(p) || !Number.isInteger(input.cell) || input.cell<0 || input.cell>8) return false;
      const placements=state.placements[id]??={};
      if(Object.entries(placements).some(([k,v])=>k!==p && v===input.cell))return false;
      placements[p]=input.cell;markUsed(p); render();
      if (!Object.entries(d.answer).every(([k,v])=>placements[k]===v)) {if(!input.inWorld)say(data.messages.platePlaced,true); return true;}
      // The solved painting consumes its plates and unlocks the floor box.
    }
    if (d.kind === 'slots') {
      const item=input.medal;
      if(!input.inWorld || !state.items.includes(item) || d.slots[input.cell]?.item!==item)return false;
      const inserted=state.inserted[id]??=[];if(inserted.includes(item))return false;
      inserted.push(item);apply({take:[item],flags:[`${id}_${item}Inserted`]});
      if(inserted.length<d.accept.length)return true;
      apply(d.result);
      setTimeout(()=>{if(presentation.eventId===d.id)presentation.close(true,()=>say(d.message,true));},900);
      return true;
    }
    if (d.kind === 'use' && (state.selected !== d.item || !state.items.includes(d.item))) {say(data.messages.selectItem.replace('{item}',data.items[d.item].label),true);return false;}
    // Solved painting: the floor box clicks open as its message appears.
    if(d.id==='painting' && input.inWorld){presentation.close(true,()=>{playSe('unlock');finish(d);});return true;}
    if(d.id==='painting')playSe('unlock');
    return finish(d);
  }
  function unlock(id) {
    if(settingsUI.open || ending() || blackoutPhase!=='idle' || doorMessage)return false;
    if(/^room\d+$/.test(id) && state.flags.includes('leftElevatorOpened')){say(data.messages.roomSealed,true);return false;}
    const d=data.doors[id]; if (!d) return true;
    if(d.unlockFlag && state.flags.includes(d.unlockFlag))return true;
    if(id==='room220' && !has(d.requires)){say(data.messages.room220Sealed,true);return false;}
    if (d.broken || !has(d.requires)) {say(d.broken ? data.messages.roomBroken : data.messages.roomLocked, true);return false;}
    for(const item of d.requires?.items??[])markUsed(item);
    if(d.unlockFlag){
      flag(d.unlockFlag);apply(d.result);playSe('unlock');
      say(d.unlockMessage,true);return false;
    }
    apply(d.result);return true;
  }
  for(const d of data.interactables) {
    const root=new THREE.Group();root.position.fromArray(d.position);root.rotation.y=d.rotation??0;
    if(d.model==='box203'){
      if(d.id==='dialBox'||d.id==='bathSlot'){
        const room=rooms[d.room].root;room.updateMatrixWorld(true);
        const support=new THREE.Raycaster(new THREE.Vector3(d.position[0],1.65,d.position[2]),new THREE.Vector3(0,-1,0)).intersectObject(room,true).find(h=>h.object.isMesh && h.object.material?.visible!==false);
        d.position[1]=support?.point.y??0;root.position.fromArray(d.position);
      }
      const prop=buildBox(renderer,d);root.add(prop.group);if(d.id==='liftBox')scene.add(root);else rooms[d.room].root.add(root);
      objects.set(d.id,{root,hit:prop.hit,def:d,id:d.id,name:d.label,kind:'interactable',sync:prop.sync,prop,toggle:()=>interact(d.id)});
      continue;
    }
    if (d.model === 'room205Clown') {
      const hit=new THREE.Mesh(new THREE.BoxGeometry(.46,.44,.38),new THREE.MeshBasicMaterial({visible:false}));
      root.add(hit); rooms[d.room].root.add(root);
      const hideMaterials=new Set();
      rooms[d.room].root.traverse(o=>{if(o.isMesh)for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(d.hideMaterials.includes(m.name))hideMaterials.add(m);});
      const cardBounds=new THREE.Box3();rooms[d.room].root.updateMatrixWorld(true);
      rooms[d.room].root.traverse(o=>{if(o.isMesh && (Array.isArray(o.material)?o.material:[o.material]).some(m=>d.hideMaterials.includes(m.name))){cardBounds.expandByObject(o);o.visible=false;}});
      const card=buildCard();card.position.copy(cardBounds.isEmpty()?new THREE.Vector3(9.695,.91,3.58):cardBounds.getCenter(new THREE.Vector3()));// Raise the face 60 degrees from the floor toward the south entrance.
      // The lower edge stays at the original hand position.
      card.rotation.set(-Math.PI/6,0,0);
      card.scale.setScalar(1.5);
      card.position.add(new THREE.Vector3(0,.027*1.5,0).applyEuler(card.rotation));
      card.position.y-=.025;
      card.name='clownHeldCard';
      rooms[d.room].root.add(card);card.traverse(o=>{if(o.isMesh)hideMaterials.add(o.material);});
      objects.set(d.id,{root,hit,def:d,id:d.id,name:d.label,kind:'interactable',hideMaterials,toggle:()=>interact(d.id)});
      continue;
    }
    if (LIFT_PROPS[d.model] && !['plate','medallion'].includes(d.model)) {   // modelled wall prop; local +z faces into the hall, d.wall = distance from position to the wall
      const prop=LIFT_PROPS[d.model](renderer,d); prop.group.position.z=-(d.wall ?? 0); prop.group.scale.setScalar(d.scale ?? 1); root.add(prop.group);
      const call=d.callLamp ? buildCallLamp(d.callLamp) : null; if(call)scene.add(call.group);
      const sync=state=>{prop.sync(state);call?.sync(state);};
      scene.add(root); objects.set(d.id,{root,hit:prop.hit,def:d,id:d.id,name:d.label,kind:'interactable',sync,prop,call,toggle:()=>interact(d.id)});
      continue;
    }
    if(d.id==='welcome') {
      const texture=loadTexture(assetUrl('textures/lobby_welcome.png'));texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
      // Wood wall is x=4.46; keep the interaction anchor and place paper 2 mm off it.
      root.position.x=4.463;
      const backing=new THREE.Mesh(new THREE.BoxGeometry(.21,.297,.002),new THREE.MeshBasicMaterial({color:0xf2e8ce}));backing.position.z=-.001;root.add(backing);
      const paper=new THREE.Mesh(new THREE.PlaneGeometry(.21,.297),new THREE.MeshBasicMaterial({map:texture}));root.add(paper);
      const tapeMat=new THREE.MeshBasicMaterial({color:0xd4bc80,transparent:true,opacity:.72});
      for(const x of [-.074,.074]){const tape=new THREE.Mesh(new THREE.PlaneGeometry(.042,.017),tapeMat);tape.position.set(x,.139,.0006);tape.rotation.z=x<0?-.18:.14;root.add(tape);}
      const hit=new THREE.Mesh(new THREE.BoxGeometry(.25,.34,.008),new THREE.MeshBasicMaterial({visible:false}));root.add(hit);
      scene.add(root);objects.set(d.id,{root,hit,def:d,id:d.id,name:d.label,kind:'interactable',toggle:()=>interact(d.id)});continue;
    }
    const geo=d.shape==='disc'?new THREE.CylinderGeometry(.15,.15,.07,16):new THREE.BoxGeometry(d.shape==='panel'?.52:.28,d.shape==='panel'?.36:.24,.12);
    const prop=['plate','medallion'].includes(d.model)?LIFT_PROPS[d.model](renderer,d):null;
    const mesh=prop?.group ?? new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:d.color??'#8aafad'}));if(d.presentation==='event')mesh.visible=false;root.add(mesh);
    if(d.shape==='clown') {const head=new THREE.Mesh(new THREE.SphereGeometry(.15,12,8),new THREE.MeshBasicMaterial({color:'#ecd9b9'}));head.position.y=.25;root.add(head);const card=new THREE.Mesh(new THREE.BoxGeometry(.14,.09,.025),new THREE.MeshBasicMaterial({color:'#a4c4ce'}));card.position.set(.2,.02,.09);root.add(card);}
    // Invisible volumes follow the object, with extra room for small touch targets.
    const size=d.hitSize ?? (d.model==='plate'?[.24,.12,.24]:d.model==='medallion'?[.2,.1,.2]:d.shape==='panel'?[.60,.44,.18]:d.shape==='disc'?[.38,.16,.38]:[.38,.32,.24]);
    const hit=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({visible:false}));if(d.hitOffset)hit.position.fromArray(d.hitOffset);root.add(hit);
    if(d.room) {rooms[d.room].root.add(root);} else scene.add(root);
    objects.set(d.id,{root,hit,def:d,id:d.id,name:d.label,kind:'interactable',sync:prop?.sync,prop,toggle:()=>interact(d.id)});
  }
  const dialObject=objects.get('dialBox');
  const dialControl=createDialControl({answer:dialObject.def.answer,prop:dialObject.prop.dial,root:dialObject.root,layer:ui.querySelector('#presentation'),camera:()=>presentation.viewCamera,solved:()=>{
    presentation.setBusy(true);
    setTimeout(()=>{flag(dialObject.def.unlockFlag);flag('dialUnlocked');playSe('unlock');render();presentation.message(data.messages.dialUnlocked);
      setTimeout(()=>{presentation.setBusy(false);presentation.close(false);},1100);
    },1000);
  }});
  const paintingObject=objects.get('painting');
  const paintingDrag=createPaintingDrag({prop:paintingObject.prop,state,d:paintingObject.def,layer:ui.querySelector('#presentation'),camera:()=>presentation.viewCamera,commit:(plate,cell)=>interact('painting',cell===null?{plate,remove:true,inWorld:true}:{plate,cell,inWorld:true})});
  const medalObject=objects.get('rightLift');
  const medallionDrag=createMedallionDrag({prop:medalObject.prop,state,d:medalObject.def,layer:ui.querySelector('#presentation'),camera:()=>presentation.viewCamera,commit:(medal,cell)=>interact('rightLift',{medal,cell,inWorld:true})});
  let debugPanel;
  if(debug){debugPanel=document.createElement('details');debugPanel.id='gameDebug';debugPanel.innerHTML='<summary>Debug</summary><pre></pre>';for(const [label,pose] of Object.entries(data.jumps)){const b=document.createElement('button');b.textContent=label;b.onclick=()=>jump(...pose);debugPanel.append(b);}const black=document.createElement('button');black.textContent='Blackout + flashlight';black.id='debugBlackout';black.onclick=startBlackout;debugPanel.append(black);ui.append(debugPanel);}
  render();
  const flickerMaterials=new Set();
  rooms[207].root.traverse(o=>{if(o.isMesh)for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m.name==='CircusFlicker')flickerMaterials.add(m);});
  // The first time the player walks up to the courtyard window, the shadow event starts by itself.
  const AUTO_WINDOW_DISTANCE=1.5, autoWindowPoint=new THREE.Vector3();let autoWindowBox=null, autoWindowTried=false;
  function autoCourtyardWindow(){
    if(autoWindowTried || state.flags.includes('shadowSeen'))return;
    const o=objects.get('courtyardWindow');if(!o)return;
    if(!autoWindowBox){o.hit.updateWorldMatrix(true,false);autoWindowBox=new THREE.Box3().setFromObject(o.hit);}
    autoWindowPoint.copy(camera.position);autoWindowPoint.y=THREE.MathUtils.clamp(autoWindowPoint.y,autoWindowBox.min.y,autoWindowBox.max.y);
    if(autoWindowBox.distanceToPoint(autoWindowPoint)<AUTO_WINDOW_DISTANCE && interact('courtyardWindow'))autoWindowTried=true;   // once only, even if the event is backed out of
  }
  function update(t) {
    updateBlackout();
    showObjective();
    corridorDecor.update(t);
    bagButton.hidden=blackoutPhase!=='idle' || doorMessage || presentation.active || boxOpening;
    hintButton.hidden=bagButton.hidden || inventoryPhase!=='closed' || settingsUI.open;
    settingsUI.button.hidden=hintButton.hidden;bagButton.hidden ||= settingsUI.open;
    presentation.update(t);
    autoCourtyardWindow();
    if(liftOpening && doorObjects.get('leftLift').t===1){liftOpening=false;liftOpenedAt=performance.now();}   // real time: game time is frozen during the lift event
    if(liftOpenedAt!==null && performance.now()-liftOpenedAt>=1500){liftOpenedAt=null;liftMsgStep=1;presentation.message(data.messages.clownReveal);presentation.setBusy(false);}
    eventFigure.userData.update?.(t);
    paintingDrag.update();
    medallionDrag.update();
    for(const o of objects.values())if(o.def.model==='box203')o.prop.update();
    if(!rooms[207].root.visible)return;
    const phase=t%9.7, gain=phase>8.7 && (Math.sin(t*51)>.2) ? .06 : 1;
    for(const m of flickerMaterials)m.color.setRGB(.18*gain,.125*gain,.062*gain);
  }
  return {ready:Promise.all([...objects.values()].map(o=>o.prop?.ready)),debugStartChase(){if(!debug || ending() || state.flags.includes('leftElevatorOpened'))return;if(!state.items.includes('card'))state.items.push('card');beforeLeftLift();markUsed('card');apply(objects.get('leftLift').def.result);},restore(saved){objectiveAt=null;liftEventActive=false;liftOpening=false;liftOpenedAt=null;liftMsgStep=0;say('');closeInventory();settingsUI.close();Object.assign(state,structuredClone(saved));blackoutPhase='idle';blackoutFade.style.opacity='0';if(state.items.includes('flashlight'))flashlight.restore();for(const o of objects.values())o.prop?.restore?.(state);render();},relabel,interact,select,unlock,say,queueObjective,corridorDecor,objects,has,update, reachable:id=>{const d=objects.get(id)?.def;return !!d && canReach(d.position,d.room);}, snapshot:()=>structuredClone(state),onEvent:fn=>listeners.add(fn), presentation, eventFigure, paintingDrag, medallionDrag, dialControl, get liftEventActive(){return liftEventActive;},get timeStopped(){return settingsUI.open || doorMessage || liftEventActive || blackoutPhase!=='idle';},get blackoutActive(){return blackoutPhase!=='idle';},get paused(){return settingsUI.open || blackoutPhase!=='idle' || ending() || doorMessage || presentation.active || boxOpening || inventoryPhase!=='closed';}};
}
