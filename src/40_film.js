'use strict';
// 九十秒的同一张时间表：镜头、天光、海况、后期与配乐都读它。
const Film = (() => {
  const V3 = THREE.Vector3;
  const DUR = 90;
  const T = { SURFACE: 14, BREACH: 24, LEAP: 27, MORPH: 30, WINGS: 37, STORM: 42, DIVE: 52, RIFT: 64, ASCEND: 78, STAR: 86 };
  const CAM = U.track([
    // 渊中潜行：相机潜入水下，侧后方跟随鲲，看它背上的焦散光网与远处透光的水面
    [0, -28, -4, -52], [6, -12, -3, -62], [12, 6, -2, -52], [18, 24, -1, -28], [21, 26, 4, -16], [24, 40, 14, -48],
    [27, 16, 30, 6], [30, 26, 40, 8], [34, -2, 52, 30], [37, -40, 62, 20], [42, -58, 72, -6],
    // 海天缠斗：相机贴海、侧向拉开，让鹏(上)与对手巨鲲(下)同时入画，捕捉交错咬斗而非各自独飞。
    [46, -70, 40, -40], [49, -62, 26, -70], [52, -46, 34, -104], [55, -30, 22, -132],
    [58, -10, 34, -160], [61, 6, 46, -178], [64, -88, 62, -172], [70, -86, 120, -158],
    [78, -18, 186, -100], [84, 22, 250, -50], [90, 40, 320, 2],
  ]);
  const LOOK = U.track([
    [0, -52, -8, -82], [6, -36, -8, -93], [12, -16, -6, -82], [18, 6, -1, -53], [21, 7, 2, -39], [24, 4, 8, -18],
    // 42s 视线抬到鹏所在的 y≈80：旧版看向 y=54，鹏被顶出画面只剩一角。
    [27, 2, 32, 10], [30, 0, 56, 28], [34, -12, 76, 26], [37, -8, 48, 24], [42, -14, 80, -6],
    // 缠斗段视线落在鹏与巨鲲之间的海面，保持两者都在画面里。
    [46, -10, 28, -56], [49, 4, 20, -70], [52, 10, 18, -92], [55, -2, 16, -120],
    [58, -18, 22, -150], [61, -32, 34, -170], [64, -40, 52, -186], [70, -30, 110, -176],
    [78, 12, 232, -120], [84, 30, 308, -62], [90, 36, 376, -20],
  ]);
  const FOV = U.keyed([[0, 52], [14, 46], [24, 50], [27, 56], [34, 44], [42, 58], [52, 42], [64, 62], [78, 48], [90, 55]]);
  const dusk = U.keyed([[0, .12], [18, .22], [30, .40], [42, .72], [58, .48], [72, .24], [86, .06], [90, .02]]);
  const storm = U.keyed([[0, .05], [14, .12], [24, .35], [34, .62], [42, 1], [58, 1], [64, .82], [72, .35], [86, .06], [90, 0]]);
  // 缠斗交点：鹏俯冲与巨鲲上跃相撞的时刻（交锋 = 冲击闪光 + 雷击 + 水柱）。
  const CLASHES = [49.2, 52.4, 55.6, 61.0];
  const flashAt = t => {
    let f = 0;
    for (const s of [27.3, 28.1, 43.2, 44.0, 44.7, 64.2]) { const d = t - s; if (d >= 0 && d < .5) f += Math.exp(-d / .06); }
    for (const s of CLASHES) { const d = t - s; if (d >= 0 && d < .6) f += .9 * Math.exp(-d / .09); }
    return f + 1.4 * U.pulse(t, T.LEAP, .02, .18) + 1.8 * U.pulse(t, T.RIFT, .04, .35);
  };
  const shake = t => .9 * U.pulse(t, T.BREACH, .1, .7) + .8 * U.pulse(t, T.MORPH, .2, 2) + 1.1 * U.pulse(t, 44, .03, .5)
    + CLASHES.reduce((a, s) => a + 1.2 * U.pulse(t, s, .03, .5), 0) + .9 * U.pulse(t, T.RIFT, .05, .8);
  const p = new V3(), look = new V3(), sunDir = new V3();
  const out = { exposure: 1, bloom: .5, flash: 0, white: 0, fade: 1, time: 0 };
  const EVENTS = [], push = (t, kind, v = 0) => EVENTS.push({ t, kind, v });
  push(0, 'sea'); push(14, 'swell'); push(24, 'breach'); push(27, 'leap'); push(30, 'morph');
  for (const s of [27.3, 28.1, 43.2, 44, 44.7, 49.5, 64.2]) push(s, 'thunder', .7);
  push(34, 'drum'); push(37, 'cry'); push(42, 'drums'); push(52, 'dive'); push(64, 'rift'); push(78, 'chime'); push(86, 'star');
  for (const s of CLASHES) { push(s, 'clash'); push(s - .02, 'thunder', .85); }
  for (let t = 42; t <= 64; t += .75) push(t, 'drum', .55);
  for (const [t, n] of [[0, 0], [8, 3], [16, 5], [24, 7], [30, 10], [37, 12], [44, 9], [52, 7], [60, 5], [64, 12], [72, 9], [80, 7], [86, 0]]) push(t, 'note', n);
  EVENTS.sort((a, b) => a.t - b.t);

  function apply(t, camera, pointer) {
    CAM(t, p); LOOK(t, look);
    const sh = shake(t), fl = flashAt(t), d = dusk(t), s = storm(t);
    camera.position.copy(p); camera.position.x += pointer.x * .7 + Math.sin(t * 29) * .12 * sh;
    camera.position.y += pointer.y * .45 + Math.cos(t * 34) * .1 * sh;
    camera.lookAt(look.x + pointer.x * .6, look.y + pointer.y * .4, look.z);
    camera.fov = FOV(t) + sh * .8; camera.updateProjectionMatrix();
    sunDir.set(.52 - d * .35, .58 - d * .38, -.62).normalize();
    Gfx.L.uSunDir.value.copy(sunDir);
    Gfx.L.uSunCol.value.setRGB(1.5 - d * .35, 1.16 - d * .42, .82 - d * .3);
    Gfx.L.uSkyCol.value.setRGB(.26 - d * .06, .42 - d * .14, .68 - d * .14);
    Gfx.L.uGroundCol.value.setRGB(.20 - d * .05, .25 - d * .07, .30 - d * .06);
    Gfx.L.uFogCol.value.setRGB(.52 - d * .12 - s * .12, .62 - d * .2 - s * .1, .74 - d * .16 - s * .05);
    Gfx.L.uFogD.value = .0011 + s * .0008;
    Gfx.L.uStorm.value = s; Gfx.L.uFlash.value = fl; Gfx.L.uDusk.value = d; Gfx.L.uTime.value = t;
    Gfx.L.uCloudShade.value = .34 + s * .42;
    // 水下程度：开场渊中潜行(1)→破水而出(0)，鹏 52s 俯冲入海再短暂没入
    const under = U.keyed([[0, 1], [17, 1], [22, .55], [25, 0], [49, 0], [54, .8], [57, .5], [60, 0], [90, 0]])(t);
    Gfx.L.uUnder.value = under;
    out.exposure = U.keyed([[0, .88], [24, .88], [42, .80], [64, .78], [78, .94], [90, 1.0]])(t)
      * (1 + fl * .18) * (1 + under * .09);
    out.bloom = .26 + s * .12 + fl * .18; out.flash = fl;
    out.white = U.pulse(t, T.RIFT + .03, .06, .4) * .75;
    out.fade = U.sm(.1, 1.6, t) * (1 - U.sm(88, 90, t));
    out.time = t;
    return out;
  }
  return { DUR, T, EVENTS, CLASHES, apply, flashAt };
})();
