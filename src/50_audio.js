'use strict';
// 声音全部现场合成：海潮、风、鼓、钟、雷、化形的泛音与鹏鸣。
const Score = (() => {
  let ctx, master, noise, seaGain, idx = 0, running = false;
  const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
  const hz = n => 196 * Math.pow(2, SCALE[U.clamp(n, 0, SCALE.length - 1)] / 12);
  function env(g, when, a, d, peak) { g.gain.setValueAtTime(.0001, when); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), when + a); g.gain.exponentialRampToValueAtTime(.0001, when + a + d); }
  function tone(f, when, dur, type = 'sine', gain = .1, detune = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, when); o.detune.value = detune;
    env(g, when, .012, dur, gain); o.connect(g).connect(master); o.start(when); o.stop(when + dur + .1); return { o, g };
  }
  function hiss(when, dur, f0, f1, gain, q = .8, type = 'bandpass') {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; s.loop = true; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, when); f.frequency.exponentialRampToValueAtTime(f1, when + dur);
    env(g, when, Math.min(.08, dur * .25), dur, gain); s.connect(f).connect(g).connect(master); s.start(when); s.stop(when + dur + .1);
  }
  function start() {
    if (ctx) { ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = .4; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const sea = ctx.createBufferSource(), lp = ctx.createBiquadFilter(); sea.buffer = noise; sea.loop = true;
    lp.type = 'lowpass'; lp.frequency.value = 380; seaGain = ctx.createGain(); seaGain.gain.value = .08;
    sea.connect(lp).connect(seaGain).connect(master); sea.start();
    const drone = ctx.createGain(); drone.gain.value = .045;
    const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 260;
    for (const [f, dt] of [[55, -4], [82.4, 5], [110, 0]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; o.connect(drone); o.start(); }
    drone.connect(df).connect(master); running = true;
  }
  function event(e, when) {
    switch (e.kind) {
      case 'sea': seaGain.gain.setValueAtTime(.08, when); break;
      case 'swell': seaGain.gain.linearRampToValueAtTime(.15, when + 4); seaGain.gain.linearRampToValueAtTime(.08, when + 12); break;
      case 'breach': hiss(when, 2.2, 4200, 350, .32, .5); tone(70, when, .8, 'sine', .3); break;
      case 'leap': hiss(when, 1.6, 300, 3800, .18); break;
      case 'morph': for (let i = 1; i <= 8; i++) tone(hz(i + 2) * 1.5, when + i * .13, 2.2 - i * .12, 'sine', .05); hiss(when, 3.5, 900, 5200, .12); break;
      case 'drum': { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(110, when); o.frequency.exponentialRampToValueAtTime(44, when + .2); env(g, when, .004, .38, .3 * e.v); o.connect(g).connect(master); o.start(when); o.stop(when + .45); hiss(when, .08, 1400, 500, .06); break; }
      case 'drums': break;
      case 'thunder': hiss(when, 1.8, 180, 35, .22 * e.v, .5, 'lowpass'); tone(46, when, 1.1, 'sine', .16 * e.v); break;
      case 'cry': { const { o } = tone(880, when, 1.6, 'sine', .09); o.frequency.exponentialRampToValueAtTime(1760, when + .35); o.frequency.exponentialRampToValueAtTime(620, when + 1.4); hiss(when, 1.2, 2600, 900, .07); break; }
      case 'dive': hiss(when, 2.6, 5200, 200, .24, .6); break;
      // 缠斗撞击：低频冲击 + 高频金属嘶鸣 + 水爆，短促有力。
      case 'clash': { tone(58, when, .55, 'sine', .34); hiss(when, .35, 3200, 420, .26, .7); hiss(when, .7, 240, 60, .2, .5, 'lowpass'); break; }
      case 'rift': for (let i = 1; i <= 6; i++) tone(hz(i + 4), when + i * .08, 3 / i, 'sine', .07 / i); hiss(when, 3, 300, 6000, .16); break;
      case 'chime': for (let i = 1; i <= 5; i++) tone(440 * i * 1.01, when, 3 / i, 'sine', .07 / i); break;
      case 'star': for (let i = 1; i <= 8; i++) tone(110 * i * 1.003, when, 6 / i, 'sine', .1 / i); break;
      case 'note': { const { o, g } = tone(hz(e.v), when, 1.6, 'triangle', .085, -4); const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 4.7; lg.gain.value = 5; lfo.connect(lg).connect(o.detune); lfo.start(when); lfo.stop(when + 1.8); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2100; g.disconnect(); g.connect(f).connect(master); break; }
    }
  }
  function seek(t) { if (!ctx) return; idx = 0; while (idx < Film.EVENTS.length && Film.EVENTS[idx].t < t - .1) idx++; }
  function tick(t, paused) {
    if (!ctx || !running || paused || ctx.state !== 'running') return;
    while (idx < Film.EVENTS.length && Film.EVENTS[idx].t < t + .4) {
      const e = Film.EVENTS[idx++]; if (e.t < t - .08) continue;
      event(e, ctx.currentTime + Math.max(0, e.t - t));
    }
  }
  return { start, seek, tick, pause() { if (ctx && ctx.state === 'running') ctx.suspend(); }, resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }, get ready() { return !!ctx; } };
})();
