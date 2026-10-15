import {LoadingManager, ImageLoader, Source, Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {assetUrl} from './version.js';
const manager=new LoadingManager().setURLModifier(url=>/^(blob:|data:)/.test(url)||/[?&]v=/.test(url)?url:assetUrl(url));
const decoder=new DRACOLoader(manager).setDecoderPath('./vendor/three/addons/libs/draco/gltf/').setWorkerLimit(2);
export const gltfLoader=new GLTFLoader(manager).setDRACOLoader(decoder);
export const loadGLTF=url=>gltfLoader.loadAsync(assetUrl(url));

// One decoded image per URL. Sampler transforms belong to Texture, pixels to Source.
const imageEntries=new Map();
const imageLoader=new ImageLoader(manager);
export function loadTexture(url,{maxSize=0,onLoad}={}) {
  const key=new URL(manager.resolveURL(url),document.baseURI).href;
  let entry=imageEntries.get(key);
  if(!entry){
    entry={variants:new Map(),image:null};imageEntries.set(key,entry);
    imageLoader.load(key,image=>{
      entry.image=image;
      for(const variant of entry.variants.values())finish(variant,image);
    },undefined,()=>{imageEntries.delete(key);});
  }
  function finish(variant,image){
    let pixels=image;
    if(variant.maxSize&&Math.max(image.width,image.height)>variant.maxSize){
      const scale=variant.maxSize/Math.max(image.width,image.height);
      pixels=document.createElement('canvas');pixels.width=Math.round(image.width*scale);pixels.height=Math.round(image.height*scale);
      const ctx=pixels.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,pixels.width,pixels.height);
    }
    variant.source.data=pixels;
    for(const [texture,callback] of variant.pending){texture.needsUpdate=true;callback?.(texture);}
    variant.pending.length=0;
  }
  let variant=entry.variants.get(maxSize);
  if(!variant){variant={source:new Source(),maxSize,pending:[]};entry.variants.set(maxSize,variant);if(entry.image)finish(variant,entry.image);}
  const texture=new Texture();texture.source=variant.source;
  if(entry.image){texture.needsUpdate=true;if(onLoad)queueMicrotask(()=>onLoad(texture));}
  else variant.pending.push([texture,onLoad]);
  return texture;
}
