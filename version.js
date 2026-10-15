// index.html is the only release-version setting.
export const V='?v='+encodeURIComponent(document.querySelector('meta[name="hotel-version"]').content);
export const assetUrl=url=>url+(url.includes('?')?'&'+V.slice(1):V);
