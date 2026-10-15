// Builders explicitly own new resources; clones never own their source geometry or textures.
export function ownResources(root,{geometry=false,materials=true,textures=false}={}) {
  const owned=new Set();
  root.traverse(o=>{if(!o.isMesh)return;if(geometry)owned.add(o.geometry);
    if(materials)for(const m of Array.isArray(o.material)?o.material:[o.material]){
      owned.add(m);if(textures)for(const value of Object.values(m))if(value?.isTexture)owned.add(value);
    }
  });
  root.userData.ownedResources=owned;
  return root;
}
export function disposeOwned(root) {
  const resources=new Set();root?.traverse(o=>{for(const resource of o.userData.ownedResources??[])resources.add(resource);delete o.userData.ownedResources;});
  for(const resource of resources)resource.dispose();
}
