// Native Preferences keeps the slot outside WebView storage.
export const SAVE_KEY='hotel-save';
function preferences(){const c=window.Capacitor;if(!c?.isNativePlatform?.())return null;return c.Plugins?.Preferences??(c.isPluginAvailable?.('Preferences')?c.registerPlugin?.('Preferences'):null);}
export async function get(key){try{const p=preferences();return p?(await p.get({key})).value:localStorage.getItem(key);}catch{return null;}}
export async function set(key,value){try{const p=preferences();if(p)await p.set({key,value});else localStorage.setItem(key,value);return true;}catch(error){console.error(error);return false;}}
export async function readSave(){try{const s=JSON.parse(await get(SAVE_KEY));return s?.version===1 && Array.isArray(s.state?.items) && Array.isArray(s.state?.flags) && Array.isArray(s.state?.used) && s.state?.placements && s.state?.inserted?s:null;}catch{return null;}}
