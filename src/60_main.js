'use strict';
(async () => {
  const $ = id => document.getElementById(id), canvas = $('c'), ld = $('ld'), st = $('st'), bar = $('bar').firstElementChild, hud = $('hud'), snd = $('snd');
  const Q = new URLSearchParams(location.search);
  const fail = msg => { $('err').style.display = 'block'; $('err').textContent = msg; ld.style.display = 'none'; };
  let R;
  try { R = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }); }
  catch (e) { fail('此影片需要 WebGL 2：' + e.message); return; }
  R.outputColorSpace = THREE.LinearSRGBColorSpace; R.toneMapping = THREE.NoToneMapping;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, .5, 3000);
  const post = Gfx.initPost(R);
  const mirrorRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true });
  const mirrorCam = new THREE.PerspectiveCamera();
  const dir = new THREE.Vector3(), target = new THREE.Vector3(), buf = new THREE.Vector2();
  let quality = Q.has('q') ? Math.max(.35, Math.min(1, +Q.get('q'))) : 1;
  function resize() {
    const w = Math.max(2, innerWidth), h = Math.max(2, innerHeight);
    const pr = Math.min(devicePixelRatio || 1, Math.sqrt(3e6 / (w * h))) * quality;
    R.setPixelRatio(pr); R.setSize(w, h, false);
    R.getDrawingBufferSize(buf);
    post.size(buf.x, buf.y); mirrorRT.setSize(Math.ceil(buf.x / 2), Math.ceil(buf.y / 2));
    World.seaU.uRes.value.copy(buf); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  const steps = [
    ['烘焙岩石、鳞片与羽毛', 30, () => Gfx.textures()],
    ['升起海天与礁岩', 25, () => World.build(scene)],
    ['唤醒鲲鹏', 25, () => Creature.build(scene)],
    ['点亮闪电与星海', 10, () => FX.build(scene)],
    ['第一帧', 10, () => { }],
  ];
  // 加载步骤之间让出事件循环即可；不依赖 requestAnimationFrame，
  // 否则在无合成器帧的离屏渲染环境里会卡在最后一步，影片永远不出现。
  const nextFrame = () => new Promise(r => setTimeout(r, 0));
  let done = 0; const total = steps.reduce((a, s) => a + s[1], 0);
  resize();
  for (const [label, w, fn] of steps) {
    st.textContent = label; await nextFrame(); fn();
    done += w; bar.style.width = (done / total * 100).toFixed(1) + '%';
  }
  st.textContent = '';

  let t = +(Q.get('t') || 0), paused = Q.has('pause') || Q.has('t'), last = performance.now();
  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', e => { pointer.x = (e.clientX / innerWidth - .5) * 2; pointer.y = (.5 - e.clientY / innerHeight) * 2; });
  addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); paused = !paused; last = performance.now(); paused ? Score.pause() : Score.resume(); }
  });
  snd.addEventListener('click', () => { Score.start(); Score.seek(t); snd.textContent = '声音已开启 · 空格暂停'; });

  function renderMirror() {
    mirrorCam.copy(camera);
    camera.getWorldDirection(dir);
    mirrorCam.position.set(camera.position.x, -camera.position.y, camera.position.z);
    target.copy(camera.position).add(dir); target.y = -target.y;
    mirrorCam.up.set(0, -1, 0); mirrorCam.lookAt(target);
    mirrorCam.updateProjectionMatrix();
    World.sea.visible = false;
    R.setRenderTarget(mirrorRT); R.clear(); R.render(scene, mirrorCam);
    World.sea.visible = true;
    World.seaU.tReflect.value = mirrorRT.texture;
  }
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!paused) { t += dt; if (t >= Film.DUR) { t = 0; Score.seek(0); } }
    const p = Film.apply(t, camera, pointer);
    Gfx.applyLight(t);
    World.update(t, camera); Creature.update(t); FX.update(t, camera);
    renderMirror();
    if (Q.has('nopost')) { R.setRenderTarget(null); R.render(scene, camera); }
    else post.render(scene, camera, p);
    Score.tick(t, paused);
    requestAnimationFrame(frame);
  }
  if (Q.has('t')) { ld.style.display = 'none'; hud.style.opacity = 0; }
  else { ld.style.opacity = 0; setTimeout(() => ld.remove(), 1100); hud.style.opacity = 1; }
  requestAnimationFrame(frame);
  window.__film = { setTime(v) { t = v; last = performance.now(); }, get t() { return t; } };
})();
