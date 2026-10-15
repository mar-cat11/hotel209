// Word segmentation avoids treating the の in あの or the が in ながら as particles.
const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('ja', {granularity:'word'}) : null;
const particles = new Set(['は','が','を','に','へ','で','と','の','も','から','まで','より']);
export function messagePhrases(value) {
  const result=[];
  for (const line of String(value).split('\n')) {
    if(result.length)result.push('\n');
    let phrase='';
    const flush=()=>{if(phrase){result.push(phrase);phrase='';}};
    // Quotes, numeric room identifiers and ellipses are indivisible tokens.
    for(const chunk of line.match(/「[^」]*」|\d+号室|\.{3,}|[^「\d.]+|\d+|./gu)??[]) {
      const protectedToken=/^(「|\d+号室|\.{3})/.test(chunk);
      const words=protectedToken?[chunk]:segmenter?[...segmenter.segment(chunk)].map(s=>s.segment):chunk.match(/から|まで|より|[^はがをにへでとのも。、！？…]+[はがをにへでとのも]?|./gu)??[];
      for(const word of words){phrase+=word;if(particles.has(word)||/[。、！？…]$/.test(word))flush();}
    }
    flush();
  }
  return result;
}
export function renderMessage(element,value,{highlight=''}={}) {
  fitMessageWidth(element);
  element.replaceChildren();
  let offset=0;
  for(const phrase of messagePhrases(value)) {
    if(phrase==='\n'){element.append(document.createTextNode('\n'));offset++;continue;}
    const span=document.createElement('span');span.className='messagePhrase';
    const end=Math.max(0,Math.min(phrase.length,highlight.length-offset));
    if(end){const name=document.createElement('span');name.className='itemName';name.textContent=phrase.slice(0,end);span.append(name,document.createTextNode(phrase.slice(end)));}
    else span.textContent=phrase;
    element.append(span);offset+=phrase.length;
  }
}

// Shrink-to-fit after wrapping: CSS keeps a wrapped block at full available width, which pushes left-aligned
// lines off-centre. Measure the widest rendered line and size the block to it so the block itself stays centred.
const fitted=new Map();
function fitAll(){
  scheduled=false;
  for(const [el,state] of fitted){
    if(!el.isConnected){fitted.delete(el);continue;}
    const visible=el.offsetParent!==null&&!el.closest('[hidden]');
    const key=visible?el.textContent+'|'+innerWidth+'x'+innerHeight:'';
    if(key===state.key)continue;
    state.key=key;el.style.width='';
    if(!visible)continue;
    const box=el.getBoundingClientRect();let right=box.left;
    for(const r of el.querySelectorAll('.messagePhrase'))for(const rect of r.getClientRects())right=Math.max(right,rect.right);
    if(right>box.left)el.style.width=Math.ceil(right-box.left+1)+'px';
  }

}
let scheduled=false;
// Fit in a microtask, i.e. after the current change but before the browser paints. A requestAnimationFrame
// callback would land one frame late when the text is set from inside the game loop, so the unfitted
// (left-shifted) block was visible for a frame.
function scheduleFit(){if(!scheduled){scheduled=true;queueMicrotask(fitAll);}}
export function fitMessageWidth(element){fitted.set(element,{key:null});scheduleFit();}
addEventListener('resize',scheduleFit);
visualViewport?.addEventListener('resize',scheduleFit);
document.fonts?.ready.then(()=>{for(const state of fitted.values())state.key=null;scheduleFit();});
document.fonts?.addEventListener('loadingdone',()=>{for(const state of fitted.values())state.key=null;scheduleFit();});
// Captions can become visible after renderMessage; observe visibility/content changes, not fitted widths.
new MutationObserver(records=>{
  if(records.some(r=>[...fitted.keys()].some(el=>r.target===el||el.contains(r.target)||r.target.contains?.(el))))scheduleFit();
}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class']});
