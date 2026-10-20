export const scales=[.6,.8,1,1.25,1.5];
// Move Speed changes running only; walking stays 1.4 m/s.
export const runSpeeds=[1.6,1.9,2.2,2.6,3];
export const settings={speed:3,sensitivity:3};
try{const saved=JSON.parse(localStorage.getItem('hotel-settings'));for(const k of Object.keys(settings))if(Number.isInteger(saved?.[k])&&saved[k]>=1&&saved[k]<=5)settings[k]=saved[k];}catch{}
export function createSettings({ui,data,changeLanguage,save,giveUp,blocked}){
  const button=document.createElement('button');button.id='settingsButton';button.type='button';button.hidden=true;button.setAttribute('aria-expanded','false');
  button.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m13 3 6 0 1 4 3 2 4-1 3 5-3 3 0 3 3 3-3 5-4-1-3 2-1 4-6 0-1-4-3-2-4 1-3-5 3-3 0-3-3-3 3-5 4 1 3-2Z" transform="translate(2 -1) scale(.9)" fill="#0006" stroke="#c0ad88" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="none" stroke="#c0ad88" stroke-width="2"/></svg>';
  const screen=document.createElement('div');screen.id='settingsScreen';screen.hidden=true;
  screen.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="settingsTitle" tabindex="-1"><h2 id="settingsTitle" data-text="settingsLabel"></h2><div class="settingsRow"><span data-text="languageLabel"></span><div class="settingsLanguage"><button type="button" data-language="ja">日本語</button><button type="button" data-language="en">English</button></div></div><label class="settingsRow"><span data-text="moveSpeedLabel"></span><input id="moveSpeed" type="range" min="1" max="5" step="1"><output></output></label><label class="settingsRow"><span data-text="lookSensitivityLabel"></span><input id="lookSensitivity" type="range" min="1" max="5" step="1"><output></output></label><div class="settingsActions"><button id="saveButton" type="button" data-text="saveLabel"></button><button id="giveUpButton" type="button" data-text="giveUpLabel"></button><button id="settingsClose" type="button" data-text="closeLabel"></button></div><a id="privacyLink" href="https://mar-cat11.github.io/hotel209/privacy/" target="_blank" rel="noopener" data-text="privacyLabel"></a></section>';
  ui.append(button,screen);
  function refresh(){button.setAttribute('aria-label',data.messages.settingsLabel);for(const el of screen.querySelectorAll('[data-text]'))el.textContent=data.messages[el.dataset.text];for(const b of screen.querySelectorAll('[data-language]'))b.setAttribute('aria-pressed',String(b.dataset.language===document.documentElement.lang));}
  function close(){screen.hidden=true;button.setAttribute('aria-expanded','false');button.focus({preventScroll:true});}
  button.onpointerdown=e=>e.stopPropagation();button.onclick=e=>{e.stopPropagation();if(blocked())return;refresh();screen.hidden=false;button.setAttribute('aria-expanded','true');screen.querySelector('section').focus({preventScroll:true});};
  screen.onpointerdown=e=>e.stopPropagation();screen.onclick=e=>e.stopPropagation();
  screen.querySelector('#settingsClose').onclick=close;
  for(const b of screen.querySelectorAll('[data-language]'))b.onclick=()=>{changeLanguage(b.dataset.language);refresh();};
  for(const [id,k] of [['moveSpeed','speed'],['lookSensitivity','sensitivity']]){const input=screen.querySelector('#'+id),output=input.nextElementSibling;input.value=settings[k];output.value=input.value;input.oninput=()=>{settings[k]=Number(input.value);output.value=input.value;try{localStorage.setItem('hotel-settings',JSON.stringify(settings));}catch{}};}
  // Save and Back to Title close the panel and ask with the usual yes/no caption.
  screen.querySelector('#saveButton').onclick=()=>{close();save();};
  screen.querySelector('#giveUpButton').onclick=()=>{close();giveUp();};
  document.addEventListener('keydown',e=>{if(screen.hidden)return;e.stopImmediatePropagation();if(e.code==='Escape'){e.preventDefault();close();}},true);
  refresh();return {button,refresh,close,get open(){return !screen.hidden;}};
}
