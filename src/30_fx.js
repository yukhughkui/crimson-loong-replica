'use strict';
// 闪电、化形光屑、破浪水沫与夜星。
const FX = (() => {
  const V3 = THREE.Vector3, dummy = new THREE.Object3D();
  let bolts = [], motes, spray, bubble, stars, plankton, clash;
  const A = new V3(), B = new V3();
  const ballPt = [0, 0], bubPt = [0, 0];
  const STRIKES = [27.3, 28.1, 43.2, 44, 44.7, 49.5, 64.2];
  function dotTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.85)');
    r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  function build(scene) {
    const dot = dotTexture();
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
      const b = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      b.frustumCulled = false; scene.add(b); bolts.push(b);
    }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(900 * 3), 3));
    mg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(900 * 3), 3));
    motes = new THREE.Points(mg, new THREE.PointsMaterial({ map: dot, size: 1.7, vertexColors: true, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    motes.frustumCulled = false; scene.add(motes);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1260 * 3), 3));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(1260 * 3), 3));
    spray = new THREE.Points(sg, new THREE.PointsMaterial({ map: dot, size: 1.4, vertexColors: true, transparent: true, opacity: .8, depthWrite: false, sizeAttenuation: true }));
    spray.frustumCulled = false; scene.add(spray);
    // 缠斗冲击：鹏爪/巨鲲撞击海面激起的冲天水柱 + 飞散鳞光，交锋时刻短暂爆发。
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(760 * 3), 3));
    cg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(760 * 3), 3));
    clash = new THREE.Points(cg, new THREE.PointsMaterial({ map: dot, size: 1.9, vertexColors: true, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    clash.frustumCulled = false; scene.add(clash);
    // 浮力气泡：半透明上浮小球，粒径不同→终端速度不同，横向受涡街摆动。
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(520 * 3), 3));
    bubble = new THREE.Points(bg, new THREE.PointsMaterial({ map: dot, color: 0xeaf7ff, size: 2.6, transparent: true, opacity: .68, depthWrite: false }));
    bubble.frustumCulled = false; scene.add(bubble);
    const stg = new THREE.BufferGeometry(), sp = [], sc = [];
    const rnd = U.rng(4242);
    for (let i = 0; i < 600; i++) {
      const a = rnd() * U.TAU, z = rnd() * 2 - 1, r = Math.sqrt(1 - z * z);
      sp.push(Math.cos(a) * r * 2200, z * 2200, Math.sin(a) * r * 2200);
      const b = .6 + rnd() * .4; sc.push(b * .8, b * .9, b);
    }
    stg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); stg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    stars = new THREE.Points(stg, new THREE.PointsMaterial({ map: dot, size: 9, vertexColors: true, transparent: true, opacity: 0, sizeAttenuation: false, depthWrite: false }));
    stars.frustumCulled = false; scene.add(stars);
    // 水下悬浮微粒：只在 uUnder>0 时显现，随相机移动，缓慢漂移。
    // 没有浮游颗粒的水下世界像空荡的蓝盒子，是水下镜头失真的主因之一。
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(460 * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(460 * 3), 3));
    plankton = new THREE.Points(pg, new THREE.PointsMaterial({
      map: dot, size: .62, vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    plankton.frustumCulled = false; scene.add(plankton);
    // 连续水冠：破水时向外翻卷的薄壁水碗。顶点每帧由 Phys 阻力弹道求值（按 t 直接算，可跳帧），
    // 冠缘按方位高频起伏撕裂成冠齿，比一团点云更接近真实破水的水冠。
    // 52s 是水下缠斗，不是破水：不入冠（旧版淡点云可用，连续水壁会糊住战斗主体）。
    for (const [at, px, pz] of BREACHES) if (at !== 52) buildCrown(scene, px, pz, at);
  }
  const crowns = [], CN = 64, CM = 14, cPt = [0, 0];
  function buildCrown(scene, px, pz, at) {
    const nv = (CN + 1) * (CM + 1);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const idx = [];
    for (let j = 0; j <= CM; j++) for (let i = 0; i <= CN; i++) {
      const k = j * (CN + 1) + i; uv[k * 2] = i / CN; uv[k * 2 + 1] = j / CM;
    }
    for (let j = 0; j < CM; j++) for (let i = 0; i < CN; i++) {
      const a = j * (CN + 1) + i; idx.push(a, a + CN + 1, a + 1, a + 1, a + CN + 1, a + CN + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mat = Gfx.mat({ uAlpha: { value: 0 } },
      `varying vec3 vW,vN;varying vec2 vUv;
       void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `uniform float uAlpha;varying vec3 vW,vN;varying vec2 vUv;
       void main(){
         vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);
         float fres=pow(1.-max(dot(N,V),0.),3.);
         float ndl=max(dot(N,normalize(uSunDir)),0.);
         vec3 col=mix(vec3(.20,.46,.62),vec3(.72,.86,.94),clamp(ndl*.55+fres*.42,0.,1.));
         float v=vUv.y;
         // 冠缘撕裂：齿状 alpha 裁切 + 泡沫白，避免整齐的塑料圆筒边。
         // 冠顶(v→1)用多频噪声不均匀裁掉，形成参差的碎裂水缘而非平切线。
         float tooth=sin(vUv.x*57.+uTime*1.3)*.5+sin(vUv.x*29.-uTime*.9)*.28;
         float tips=sin(vUv.x*83.-uTime*2.)*.5+sin(vUv.x*41.+uTime*1.1)*.34+sin(vUv.x*13.)*.3;
         float edge=v+(tooth*.13+tips*.22)*v*v;
         float cut=1.-smoothstep(.60,1.,edge);
         // 冠顶封口整段压暗淡出，消除网格末端的硬直边；只留下缘的水壁主体。
         cut*=1.-smoothstep(.72,.98,v)*.92;
         col=mix(col,vec3(.88,.95,1.),smoothstep(.55,.92,v)*.42);
         gl_FragColor=vec4(col,uAlpha*cut*(.44+.38*v));
       }`, { transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
    crowns.push({ mesh, px, pz, at });
  }
  function updateCrown(t) {
    for (const c of crowns) {
      const age = t - c.at;
      if (age < 0 || age > 1.7) { c.mesh.visible = false; continue; }
      c.mesh.visible = true;
      const tau = Math.min(age, .78);                 // 水冠在 0.78s 张到最大，随后溃散
      c.mesh.material.uniforms.uAlpha.value = (1 - U.sm(1.05, 1.7, age)) * .88;
      const pos = c.mesh.geometry.attributes.position.array, nor = c.mesh.geometry.attributes.normal.array;
      for (let j = 0; j <= CM; j++) {
        const v = j / CM;
        for (let i = 0; i <= CN; i++) {
          const a = i / CN * U.TAU;
          // 冠壁主体统一弹道(相邻方位高度接近→连成一圈水墙)；只有最顶端才按方位错开时间。
          const tipJit = v * v * (U.h1(i * .29 + c.at * 3) - .5) * .22;
          const sa = tau * v + tipJit;
          Phys.ballistic(5, 1, sa, cPt);               // 高初速、低阻力：整圈一起冲高
          const tooth = Math.sin(a * 9 + c.at) * .5 + Math.sin(a * 17 - c.at * 2) * .28;
          // 半径收窄(0.52)、高度抬高(2.4)：破水是向上喷涌的连续水壁，不是分离的花瓣。
          const r = cPt[0] * .52 + tooth * v * v * .55, y = cPt[1] * 2.4 + Math.sin(a * 7 + c.at) * v * v * .35;
          const k = (j * (CN + 1) + i) * 3;
          pos[k] = c.px + Math.cos(a) * r; pos[k + 1] = y; pos[k + 2] = c.pz + Math.sin(a) * r;
        }
      }
      // 旋转面解析法线：外法线 ∝ (径向·dy, -dr, 径向·dy)
      for (let j = 0; j <= CM; j++) {
        const jp = Math.min(j + 1, CM), jm = Math.max(j - 1, 0);
        for (let i = 0; i <= CN; i++) {
          const k = (j * (CN + 1) + i) * 3, kp = (jp * (CN + 1) + i) * 3, km = (jm * (CN + 1) + i) * 3;
          const rx = pos[k] - c.px, rz = pos[k + 2] - c.pz, rr = Math.hypot(rx, rz) || 1;
          const dr = Math.hypot(pos[kp] - c.px, pos[kp + 2] - c.pz) - Math.hypot(pos[km] - c.px, pos[km + 2] - c.pz);
          const dy = pos[kp + 1] - pos[km + 1], L = Math.hypot(dy, -dr) || 1;
          nor[k] = rx / rr * dy / L; nor[k + 1] = -dr / L; nor[k + 2] = rz / rr * dy / L;
        }
      }
      c.mesh.geometry.attributes.position.needsUpdate = true;
      c.mesh.geometry.attributes.normal.needsUpdate = true;
    }
  }
  function updateBolts(t) {
    bolts.forEach((b, i) => {
      const s = STRIKES[i % STRIKES.length], d = t - s;
      if (d < 0 || d > .38) { b.material.opacity = 0; return; }
      const p = b.geometry.attributes.position;
      const x0 = -140 + i * 60, x1 = x0 + (i % 2 ? 70 : -50);
      for (let k = 0; k < 12; k++) {
        const u = k / 11;
        p.setXYZ(k, U.lerp(x0, x1, u) + (U.h1(i * 31 + k + Math.floor(t * 30)) - .5) * 12 * (k > 0 && k < 11 ? 1 : 0),
          U.lerp(300, 20, u), -260 + i * 22 + (U.h1(i * 17 + k) - .5) * 20);
      }
      p.needsUpdate = true; b.material.opacity = d < .1 ? .95 : .35;
    });
  }
  function updateMotes(t) {
    const pos = motes.geometry.attributes.position.array, col = motes.geometry.attributes.color.array;
    let used = 0;
    if (t > 29 && t < 47) {
      Creature.pengAt(Math.max(30, t), A);
      for (let i = 0; i < 900; i++) {
        const seed = i * 1.37;
        const born = 30 + U.h1(seed + 21) * 4.5, age = t - born;
        if (age < 0 || age > 4.5) continue;
        // 旧版所有粒子从鹏体下方按固定速率上升，屏幕上是垂直的一列白点，像渲染故障。
        // 改为绕鹏体的球状爆散，暖金色调，短生命周期快速淡出。
        const az = U.h1(seed) * U.TAU, el = (U.h1(seed + 7) * 2 - 1) * 1.25;
        const r = (2.2 + U.h1(seed + 13) * 7.5) * (1 + age * .55);
        pos[used * 3] = A.x + Math.cos(az) * Math.cos(el) * r;
        pos[used * 3 + 1] = A.y + Math.sin(el) * r * .72;
        pos[used * 3 + 2] = A.z + Math.sin(az) * Math.cos(el) * r;
        const f = Math.pow(1 - age / 4.5, 1.4);
        col[used * 3] = .92 * f; col[used * 3 + 1] = .70 * f; col[used * 3 + 2] = .38 * f;
        used++;
      }
    }
    for (let i = used; i < 900; i++) { pos[i * 3 + 1] = -9999; }
    motes.geometry.attributes.position.needsUpdate = true; motes.geometry.attributes.color.needsUpdate = true;
  }
  // 破水水花：每颗水滴有粒径(→阻力档)与初速档，位置由 Phys 的 RK4 二次阻力弹道给出，
  // 不再是与物理无关的死抛物线。小水滴阻力大、飞得近且早落水，大水滴抛得远，自然分层。
  // 横向再叠加物体尾流的涡街侧力，出水瞬间呈伞状外翻而非均匀圆环。
  const BREACHES = [[24, 4, -18], [27, 2, 10], [52, 34, -110]];
  function updateSpray(t) {
    const pos = spray.geometry.attributes.position.array, col = spray.geometry.attributes.color.array;
    let used = 0;
    const NS = Phys.SPEEDS.length, ND = Phys.DRAGS.length;
    const TONGUES = 12;   // 水舌数：把方位量化成若干束，破水才有"水柱"而非均匀点云
    for (const [at, px, pz] of BREACHES) {
      for (let i = 0; i < 420 && used < 1260; i++) {
        const seed = i * 3.17 + at * 11;
        // 破水是持续喷发：诞生窗口拉到 1.4 秒，任一帧都有更多处于不同飞行阶段的水滴叠成水冠。
        const born = at - .5 + U.h1(seed + 9) * 1.4;
        const age = t - born; if (age < 0 || age > 3.5) continue;
        // 同一水舌共享方位、初速档接近，粒子沿同一条弹道束散开，读起来是一束水而非噪声。
        const tongue = Math.floor(U.h1(seed + 1) * TONGUES);
        const a = (tongue + .5) / TONGUES * U.TAU + (U.h1(seed + 12) - .5) * .13;
        // 连续水冠已给出主体，粒子退为冠缘飞溅的细碎水珠：走中高弹道、贴冠壁外缘、快速淡出。
        const core = U.h1(seed + 15) > .72;
        const si = core ? Math.min(NS - 1, 4 + Math.floor(U.h1(seed) * 2)) : 2 + Math.floor(U.h1(seed) * 3);
        const di = Math.floor(U.h1(seed + 5) * 3);
        Phys.ballistic(si, di, age, ballPt);
        const r = ballPt[0], y = ballPt[1];
        if (y < 0 || r < 0) continue;                 // 已落水：自然回收
        const side = Phys.vortexLateral(Math.sin(a) * r, r, age, 14, U.h1(seed + 2) * 2);
        const rr = r * 1.08 + side * .35;              // 略在冠壁之外散开
        pos[used * 3]     = px + Math.cos(a) * rr;
        pos[used * 3 + 1] = y;
        pos[used * 3 + 2] = pz + Math.sin(a) * rr;
        // 中心水柱亮白、外缘水冠偏青蓝，随飞行淡出，避免"一团均匀白点"。
        const fade = Math.pow(1 - age / 3.5, .7);
        const w = core ? 1 : .74;
        col[used * 3] = .90 * w * fade; col[used * 3 + 1] = .96 * w * fade; col[used * 3 + 2] = 1.0 * w * fade;
        used++;
      }
    }
    for (let i = used; i < 1260; i++) pos[i * 3 + 1] = -9999;
    spray.geometry.attributes.position.needsUpdate = true; spray.geometry.attributes.color.needsUpdate = true;
  }

  // 气泡：鲲下潜/鹏入水时留下。上升位移由浮力+二次阻力的 RK4 表给出（终端速度随粒径），
  // 横向叠加涡街侧力形成"之"字上浮，接近水面时淡出溶解。
  function updateBubbles(t) {
    const pos = bubble.geometry.attributes.position.array; let used = 0;
    const NR = Phys.RADII.length;
    for (const [at, px, pz] of BREACHES) {
      for (let i = 0; i < 90 && used < 400; i++) {
        const seed = i * 5.13 + at * 7;
        const born = at - .4 + U.h1(seed + 3) * 2.0, a = t - born;
        if (a < 0 || a > 8) continue;
        const ri = Math.floor(U.h1(seed) * NR);
        Phys.bubble(ri, a, bubPt);
        const rise = bubPt[0];
        // 气泡集中在入水点附近，随上浮仅小幅张开——真实空腔溃灭气泡不会铺满半片海。
        const az = U.h1(seed + 1) * U.TAU, r0 = .5 + U.h1(seed + 2) * 2.6 + rise * .06;
        const side = Phys.vortexLateral(Math.sin(az) * r0, rise + 3, a, 6, U.h1(seed + 4) * 3);
        const x = px + Math.cos(az) * r0 + side * .5;
        const z = pz + Math.sin(az) * r0 + side * .35;
        const y = -3 - rise;
        if (y > 1.5) continue;                        // 浮出水面破裂
        pos[used * 3] = x; pos[used * 3 + 1] = y; pos[used * 3 + 2] = z;
        used++;
      }
    }
    for (let i = used; i < 520; i++) pos[i * 3 + 1] = -9999;
    bubble.geometry.attributes.position.needsUpdate = true;
  }
  // 交锋水柱：取鹏与巨鲲轨迹中点作冲击原点，用二次阻力弹道喷出上冲水粒，
  // 夹少量暖金鳞光（巨鲲被击中的碎鳞）。短暂爆发、快速淡出，与撞击闪光同步。
  const CP = new V3(), RP = new V3();
  function updateClash(t) {
    const pos = clash.geometry.attributes.position.array, col = clash.geometry.attributes.color.array;
    let used = 0;
    const NS = Phys.SPEEDS.length, ND = Phys.DRAGS.length;
    for (const [ci, at] of Film.CLASHES.entries()) {
      const age = t - at; if (age < 0 || age > 2.4) continue;
      Creature.pengAt(at, CP); Creature.rivalAt(at, RP);
      // 冲击点取两者连线中点偏海面，保证水柱从海里升起而非悬空。
      const px = (CP.x + RP.x) * .5, pz = (CP.z + RP.z) * .5;
      for (let i = 0; i < 190 && used < 760; i++) {
        const seed = i * 3.71 + ci * 17;
        const si = Math.min(NS - 1, 2 + Math.floor(U.h1(seed) * 4));
        const di = Math.floor(U.h1(seed + 4) * ND);
        Phys.ballistic(si, di, age * .7, ballPt);
        const r = ballPt[0], y = ballPt[1];
        if (y < 0 || r < 0) continue;
        const a = U.h1(seed + 1) * U.TAU;
        const side = Phys.vortexLateral(Math.sin(a) * r, r, age, 12, U.h1(seed + 2) * 2);
        const rr = r + side * .3;
        pos[used * 3] = px + Math.cos(a) * rr;
        pos[used * 3 + 1] = y;
        pos[used * 3 + 2] = pz + Math.sin(a) * rr;
        const f = 1 - age / 2.4, warm = U.h1(seed + 6) > .87 ? 1 : 0;
        col[used * 3] = (warm ? 1.0 : .72) * f; col[used * 3 + 1] = (warm ? .72 : .88) * f; col[used * 3 + 2] = (warm ? .34 : 1.0) * f;
        used++;
      }
    }
    for (let i = used; i < 760; i++) pos[i * 3 + 1] = -9999;
    clash.geometry.attributes.position.needsUpdate = true; clash.geometry.attributes.color.needsUpdate = true;
  }
  function updatePlankton(t, cam) {
    const under = Gfx.L.uUnder.value;
    plankton.material.opacity = under * .45;
    if (under < .01) return;
    const pos = plankton.geometry.attributes.position.array, col = plankton.geometry.attributes.color.array;
    const cp = cam.position;
    for (let i = 0; i < 460; i++) {
      const s = i * 2.31;
      const b = .34 + .66 * U.h1(s + 3);
      pos[i * 3] = cp.x + (U.h1(s) - .5) * 96 + Math.sin(t * .23 + s) * 1.7;
      pos[i * 3 + 1] = cp.y + (U.h1(s + 1) - .5) * 58 + Math.sin(t * .17 + s * 1.7) * 1.2;
      pos[i * 3 + 2] = cp.z + (U.h1(s + 2) - .5) * 96 + Math.cos(t * .19 + s) * 1.7;
      col[i * 3] = b * .52; col[i * 3 + 1] = b * .84; col[i * 3 + 2] = b;
    }
    plankton.geometry.attributes.position.needsUpdate = true;
    plankton.geometry.attributes.color.needsUpdate = true;
  }
  function update(t, cam) {
    updateBolts(t); updateMotes(t); updateCrown(t); updateSpray(t); updateBubbles(t); updateClash(t); updatePlankton(t, cam);
    stars.material.opacity = U.sm(70, 86, t) * .85;
  }
  return { build, update };
})();
