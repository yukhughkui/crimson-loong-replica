'use strict';
// 确定性物理层。影片支持任意时刻跳帧（?t=24&pause），所以这里不用逐帧累积的刚体积分，
// 而是构建期用 RK4 把力学方程预积分成轨迹表，运行期按 t 插值采样——既真实又可重现。
// 四个模型：二次阻力弹道（水花）、浮力+阻力上升（气泡）、Kármán 涡街侧力、欠阻尼翼振子。
const Phys = (() => {
  const GRAV = 26;                       // 场景重力尺度：旧水花 -13*age² 即 0.5*g → g=26，保持一致
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

  // ---- 通用 RK4：把一阶 ODE 系 dx/dt=f(t,x) 积分成等步长轨迹表 ----
  // 返回 Float32Array，第 i 个样本存 state0.length 个分量。构建期调用一次，运行期只读。
  function integrate(f, state0, dt, steps) {
    const n = state0.length, tab = new Float32Array((steps + 1) * n);
    const x = state0.slice(), k1 = new Array(n), k2 = new Array(n), k3 = new Array(n), k4 = new Array(n), tmp = new Array(n);
    for (let i = 0; i < n; i++) tab[i] = x[i];
    for (let step = 0; step < steps; step++) {
      const t = step * dt;
      f(t, x, k1);
      for (let i = 0; i < n; i++) tmp[i] = x[i] + .5 * dt * k1[i];
      f(t + .5 * dt, tmp, k2);
      for (let i = 0; i < n; i++) tmp[i] = x[i] + .5 * dt * k2[i];
      f(t + .5 * dt, tmp, k3);
      for (let i = 0; i < n; i++) tmp[i] = x[i] + dt * k3[i];
      f(t + dt, tmp, k4);
      for (let i = 0; i < n; i++) x[i] += dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      const off = (step + 1) * n;
      for (let i = 0; i < n; i++) tab[off + i] = x[i];
    }
    return tab;
  }
  // 轨迹表采样：t 线性插值，越界钳到端点（粒子生命结束后停在末态或由调用方回收）。
  function sample(tab, n, dt, t, out) {
    const ft = clamp(t / dt, 0, (tab.length / n) - 1);
    const i = Math.floor(ft), f = ft - i, a = i * n, b = Math.min(i + 1, tab.length / n - 1) * n;
    for (let k = 0; k < n; k++) out[k] = tab[a + k] + (tab[b + k] - tab[a + k]) * f;
    return out;
  }

  // ---- 1. 二次阻力弹道：水滴离开水面后在空气中的运动 ----
  // 状态 [沿射程 r, 高 y, 径向速度 vr, 竖直速度 vy]
  //   vr' = -kd*|v|*vr        （空气阻力与速度平方成正比）
  //   vy' = -g - kd*|v|*vy
  // kd 由粒径决定：细雾比大水珠阻力大得多，于是大小水滴自然分层。
  const SPEEDS = [4, 6, 9, 12, 16, 21];       // 发射初速档：水冠紧贴主体，不过度铺满画面
  const DRAGS = [.004, .009, .016, .026, .040]; // 阻力档（小→大粒径）
  const BALL_DT = .02, BALL_STEPS = 176;      // 3.52 s
  const balls = [];
  for (const sp of SPEEDS) for (const kd of DRAGS) {
    const s0 = [0, .6, sp, sp * .82];         // 抛出角由初速比设定
    const tab = integrate((t, x, dx) => {
      const v = Math.hypot(x[2], x[3]);
      dx[0] = x[2]; dx[1] = x[3];
      dx[2] = -kd * v * x[2];
      dx[3] = -GRAV - kd * v * x[3];
    }, s0, BALL_DT, BALL_STEPS);
    balls.push(tab);
  }
  const ballOut = [0, 0, 0, 0];
  // 按档位取弹道在 t 时刻的 [r, y]；落回水面(y<0)由调用方剔除。
  function ballistic(speedIdx, dragIdx, t, out) {
    const tab = balls[speedIdx * DRAGS.length + dragIdx];
    sample(tab, 4, BALL_DT, t, ballOut);
    out[0] = ballOut[0]; out[1] = ballOut[1];
    return out;
  }

  // ---- 2. 浮力气泡：水下气泡上浮 ----
  //   vy' = (1-ρg/ρw)*g - kd*|vy|*vy   浮力减去二次阻力，很快达到终端速度 vt=√(g_b/kd)
  // 侧向受涡街周期力而摆动（见 vortexLateral），半径随上浮略增（压强减小）→ 浮力略增。
  const BUB_DT = .03, BUB_STEPS = 300;        // 9 s
  const RADII = [.35, .6, 1.0, 1.6, 2.4];     // 气泡半径档
  const bubs = RADII.map(r => {
    const gb = GRAV * .12;                    // 有效浮力加速度：气泡实际受表观质量+污染层抑制，远小于 g
    const kd = 1.1 / (r * r);                 // 阻力∝截面积/质量∝1/r，限制大气泡终端速度以免瞬间浮出水面
    return integrate((t, x, dx) => {
      dx[0] = x[1];
      dx[1] = gb - kd * Math.abs(x[1]) * x[1];
    }, [0, 0], BUB_DT, BUB_STEPS);
  });
  const bubOut = [0, 0];
  // 气泡在 t 时刻的 [上升位移, 竖直速度]
  function bubble(radiusIdx, t, out) {
    sample(bubs[radiusIdx], 2, BUB_DT, t, bubOut);
    out[0] = bubOut[0]; out[1] = bubOut[1];
    return out;
  }

  // ---- 3. Kármán 涡街：物体尾流中交替脱落的涡对 ----
  // 每个涡是点涡，诱导切向速度 Γ/(2πr)；相邻涡符号相反，沿下游以 0.8*U 漂移。
  // 这里只取横向诱导分量，用来摆动气泡与水沫，使尾流有真实的"之"字轨迹。
  // q = 横渡尾流的横向坐标, s = 沿流向到物体的距离, U = 来流速度, phase = 脱落相位
  function vortexLateral(q, s, t, U, phase) {
    if (s < 1) return 0;
    let v = 0;
    for (let k = 0; k < 6; k++) {
      const age = t - k * .42 - phase;
      if (age < 0) continue;
      const sc = s - U * .82 * age;             // 涡心已漂移到的流向位置
      const ds = s - sc, dq = q - (k % 2 ? 1 : -1) * 1.5;
      const r2 = ds * ds + dq * dq + 1.2;
      const sign = k % 2 ? 1 : -1;
      // 点涡切向速度的横向分量 ∝ -ds/r²，符号交替
      v += sign * (-ds) / r2 * Math.exp(-age * .55) * 7.5;
    }
    return clamp(v, -6, 6);
  }

  // ---- 4. 欠阻尼二阶振子：翼尖相对翼根的相位滞后与过冲 ----
  // 驱动频率 ω、固有频率 ωn、阻尼比 ζ。稳态频率响应：
  //   增益 = 1/√((1-r²)²+(2ζr)²),  滞后 = atan2(2ζr, 1-r²),  r=ω/ωn
  // 翼尖取滞后相位+增益放大，翼根取原位，于是扇翅呈由内向外的行波，带真实过冲。
  function oscillator(r, zeta) {
    const re = 1 - r * r, im = 2 * zeta * r;
    return { gain: 1 / Math.sqrt(re * re + im * im), lag: Math.atan2(im, re) };
  }
  const WING = oscillator(.78, .34);           // 略低于固有频率、欠阻尼 → 有可见过冲

  function init() { /* 轨迹表在模块加载时已构建；保留钩子供镜头/调试使用 */ }
  return {
    init, integrate, sample, ballistic, bubble, vortexLateral, oscillator, WING,
    GRAV, SPEEDS, DRAGS, RADII,
  };
})();
