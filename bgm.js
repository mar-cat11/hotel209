// Gapless looping BGM + one-shot SE via Web Audio; starts on the first user gesture (iOS autoplay rule).
// iOS can leave a context "interrupted" after the app is backgrounded, so a fresh context is built on return.
let ctx = null;
const seUrls = {}, seBufs = {}, loops = {};   // loops: extra looping sounds whose volume the game sets (e.g. carousel)
export function startBgm(url, volume = 0.45, se = {}, extraLoops = {}) {
  for (const [k, u] of Object.entries(extraLoops)) loops[k] ??= { url: u, buf: null, gain: null, vol: 0 };
  let buffer = null, started = false, building = null;
  Object.assign(seUrls, se);
  const audio = async (c, u) => {
    const response = await fetch(u);
    if (!response.ok) throw new Error(`Audio HTTP ${response.status}: ${u}`);
    return c.decodeAudioData(await response.arrayBuffer());
  };
  const startLoop = async (l, c) => {
    l.buf ??= await audio(c, l.url);
    if (c !== ctx || document.hidden || l.gain) return;
    l.gain = c.createGain(); l.gain.gain.value = l.vol; l.gain.connect(c.destination);
    const s = c.createBufferSource(); s.buffer = l.buf; s.loop = true; s.connect(l.gain); s.start();
  };
  const drop = () => {
    const old = ctx; ctx = null; building = null;
    for (const l of Object.values(loops)) l.gain = null;
    old?.close().catch(() => {});
  };
  const build = async () => {
    if (ctx || building || document.hidden) return;
    const c = new (window.AudioContext || window.webkitAudioContext)();
    ctx = c; building = c;
    try {
      buffer ??= await audio(c, url);
      if (c !== ctx || document.hidden) return;
      const gain = c.createGain(); gain.gain.value = volume; gain.connect(c.destination);
      const src = c.createBufferSource(); src.buffer = buffer; src.loop = true; src.connect(gain); src.start();
      await c.resume();
      if (c !== ctx || document.hidden) return;
      for (const l of Object.values(loops)) startLoop(l, c).catch(() => {});
      for (const [k, u] of Object.entries(seUrls)) if (!seBufs[k]) audio(c, u).then(b => { seBufs[k] = b; }).catch(() => {});
    } catch (error) {
      if (c === ctx) drop();
      // A later user gesture retries failed network/decode/context creation.
    } finally { if (building === c) building = null; }
  };
  const attempt = () => { build().catch(() => {}); };
  const unlock = () => {
    started = true;
    if (!ctx) attempt();
    else {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      if (!building) {
        for (const l of Object.values(loops)) if (!l.gain) startLoop(l, ctx).catch(() => {});
        for (const [k, u] of Object.entries(seUrls)) if (!seBufs[k]) audio(ctx, u).then(b => { seBufs[k] = b; }).catch(() => {});
      }
    }
  };
  ['pointerdown', 'keydown', 'touchend'].forEach(t => addEventListener(t, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!started) return;
    if (document.hidden) drop(); else attempt();   // tries to resume right away; a later tap resumes it if iOS refuses
  });
  addEventListener('pageshow', e => { if (e.persisted && started && !document.hidden) { drop(); attempt(); } });
}
// Play a one-shot SE; silently skipped until audio is unlocked and the sound is decoded.
export function playSe(name, volume = 1, rate = 1) {
  const buf = seBufs[name]; if (!ctx || ctx.state !== 'running' || !buf) return;
  const g = ctx.createGain(); g.gain.value = volume; g.connect(ctx.destination);
  const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.connect(g); s.start();
}
// Set a looping sound's volume (0–1); eased so position updates don't click.
export function setLoopVolume(name, v) {
  const l = loops[name]; if (!l) return; l.vol = v;
  if (l.gain && ctx) l.gain.gain.setTargetAtTime(v, ctx.currentTime, .15);
}
