'use strict';
// 鲲与鹏：参数化身体、逐片鳞片几何、逐根飞羽、背光次表面散射，化形由时间轴上的一次溶解完成。
const Creature = (() => {
  const V3 = THREE.Vector3;
  const WORLD_UP = new V3(0, 1, 0);
  const BX = new V3(), BY = new V3(), BZ = new V3(), BASIS = new THREE.Matrix4();
  // 用显式正交基构造朝向，而不是 setFromUnitVectors——后者在朝向接近 -z（朝镜头飞回）时
  // 旋转轴退化，会把鹏的翼面翻成竖直的两堵墙。这里翼展轴恒为水平，背恒朝上。
  function orientBird(dir) {                    // 鹏：本地 +z 对齐飞行方向，+x 为翼展
    BZ.copy(dir).normalize();
    BX.crossVectors(WORLD_UP, BZ).normalize();
    BY.crossVectors(BZ, BX).normalize();
    BASIS.makeBasis(BX, BY, BZ); return dummy.quaternion.setFromRotationMatrix(BASIS);
  }
  function orientFish(dir) {                    // 鲲：本地 +x 对齐游动方向，+y 为背
    BX.copy(dir).normalize();
    BZ.crossVectors(BX, WORLD_UP).normalize();
    BY.crossVectors(BZ, BX).normalize();
    BASIS.makeBasis(BX, BY, BZ); return dummy.quaternion.setFromRotationMatrix(BASIS);
  }
  // 鲲的跃起是弹道而非"飞到天上停住"：旧版 30s 后停在 y=70 不落，鱼在天上悬停是最刺眼的逻辑错误。
  // 现在 24 破水→27 顶点→34 落回海面，化形时在高空附近完全消散（见 update 的 scale）。
  const KUN = U.track([
    [-4, -60, -9, -80], [8, -35, -8, -95], [14, -10, -5, -78], [19, 8, -1, -50], [24, 4, 7, -18],
    [27, 2, 34, 10], [30, 0, 44, 28], [34, 0, 26, 40], [38, 0, 4, 44], [94, 0, 4, 44],
  ]);
  // 鹏的轨迹在中段俯冲贴海，与对手巨鲲在海天交界反复交错缠斗，而非始终在高空独飞。
  const PENG = U.track([
    [-4, 0, 60, 30], [32, 0, 60, 30], [36, -8, 78, 34], [40, -22, 96, 18], [44, -18, 68, -14],
    [48, -6, 34, -52], [52, 14, 11, -92], [56, 4, 30, -128], [60, -18, 16, -158],
    [64, -40, 54, -186], [70, -30, 120, -170], [78, 12, 232, -122], [86, 30, 308, -62], [94, 36, 376, -20],
  ]);
  // 对手巨鲲：盘踞同一片海，鹏俯冲时迎击上跃，两者交错咬斗后各自退回。
  const RIVAL = U.track([
    [-4, 70, -26, -120], [38, 70, -26, -120], [42, 52, -20, -100], [46, 34, -6, -74],
    [49, 20, 14, -62], [52, 10, 15, -86], [55, -8, 7, -112], [58, -24, 14, -136],
    [61, -40, 22, -156], [64, -54, -8, -180], [70, -70, -28, -200], [94, -84, -30, -220],
  ]);
  const rivalAt = (t, out) => RIVAL(t, out);
  const TMP = new V3(), TMP2 = new V3(), dummy = new THREE.Object3D();
  const kunAt = (t, out) => KUN(t, out);
  const pengAt = (t, out) => PENG(t, out);
  const dirAt = (path, t, out) => { path(t + .5, TMP); path(t - .5, TMP2); return out.subVectors(TMP, TMP2).normalize(); };

  // 鲲的剖面：多控制点样条取代单峰 sin 幂次。
  // 旧公式 u→0 时半径归零、中段一个鼓包、头部几乎与体腔等粗，
  // 从后上方看就是一枚锥形火箭。新剖面有真实鱼类的四段：细尾柄 → 快速加粗
  // 的尾干 → 宽平体腔 → 收窄的钝头。
  const KUN_KEYS = [
    [0.00, .17], [.05, .25], [.12, .44], [.22, .74], [.35, .95], [.50, 1.00],
    [.63, .97], [.73, .88], [.82, .75], [.89, .62], [.95, .48], [1.00, .28]
  ];
  const KUN_RY = 2.9, KUN_RZ = 1.65;   // 侧扁：背腹高、左右窄，鱼而非海豚
  function profileCurve(keys, u) {
    const uu = U.clamp(u, 0, 1);
    if (uu <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (uu <= keys[i][0]) {
        const t = U.sm(keys[i - 1][0], keys[i][0], uu);
        return U.lerp(keys[i - 1][1], keys[i][1], t);
      }
    }
    return keys[keys.length - 1][1];
  }
  const profAt = u => profileCurve(KUN_KEYS, u);
  // 摆尾 = 推进行波(traveling wave)：相位由头向尾传播，振幅向尾指数增大；
  // 叠加 burst-and-coast——真实鱼类交替爆发摆尾与滑行，而非匀速正弦。
  // 身体与鳞片共用同一公式，保证鳞片严丝合缝贴在鱼身上。
  const SWIM_W = 4.6, SWIM_K = 9.0;   // 角频率 rad/s、整条鱼约 1.4 个波长的波数
  const SWAY = `float swayT=pow(1.-aBodyU,2.3);
    float burst=.86+.14*sin(uTime*.85);
    float ph=uTime*${SWIM_W.toFixed(2)}-aBodyU*${SWIM_K.toFixed(2)};
    p.z+=sin(ph)*2.6*swayT*burst;
    p.y+=cos(ph*.72-aBodyU*3.)*.55*swayT;`;
  // 鹏扇翼由欠阻尼二阶振子驱动：翼尖相位滞后于翼根并放大过冲，形成由内向外的拍打动波。
  const WG = Phys.WING.gain, WL = Phys.WING.lag;
  // 鸟类拍翼非对称：下扑产生升力(快而有力)，上扑收翼减阻(慢而轻)——二次谐波塑造下扑主导波形。
  const FLAP = `float ph=uTime*2.55;
    float drive=sin(ph)+.28*sin(2.*ph);
    float lagP=ph-${WL.toFixed(4)};
    float tip=${WG.toFixed(4)}*(sin(lagP)+.28*sin(2.*lagP));`;

  function fishGeometry() {
    const rings = 52, seg = 18, pos = [], uvs = [], idx = [], bu = [];
    for (let i = 0; i <= rings; i++) {
      const u = i / rings, x = -8 + u * 17, prof = profAt(u);
      for (let j = 0; j <= seg; j++) {
        const a = j / seg * U.TAU;
        pos.push(x, Math.cos(a) * prof * KUN_RY + Math.sin(u * 9) * .12, Math.sin(a) * prof * KUN_RZ);
        uvs.push(u, j / seg); bu.push(u);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j; idx.push(a, a + 1, a + seg + 1, a + 1, a + seg + 2, a + seg + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aBodyU', new THREE.Float32BufferAttribute(bu, 1));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }

  // 逐片鳞片：覆瓦状铺满鱼身。每片带 aBodyU（同步摆尾）、aBelly（腹背）、aTone（个体色差）、uv（片内坐标）。
  function scaleGeometry() {
    const pos = [], uvs = [], bu = [], belly = [], tone = [], idx = [];
    const rnd = U.rng(777), ROWS = 32, NU = 3, NV = 3;
    let vi = 0;
    for (let r = 0; r <= ROWS; r++) {
      const uc = r / ROWS, prof = profAt(uc);
      // 列数逐行抖动：旧版每行严格同列，侧面看就是一列列竖直缝=网兜。
      const cols = Math.max(8, Math.round(23 * (.22 + .78 * prof) + (rnd() - .5) * 3));
      // 行距放大 1.32 倍形成覆瓦重叠；旧版刚好首尾相接，远看是规则网眼。
      const du = .94 / ROWS * 1.06, da = 1.02 * U.TAU / cols;
      for (let c = 0; c < cols; c++) {
        const ac = (c + (r % 2) * .5 + (r % 3) * .07) / cols * U.TAU;
        // 环带倾斜：让鳞片行沿身体表面斜向排布（侧面 sin 最大、背腹为 0），
        // 从侧面看是斜向编织而非正对镜头的竖直网格。
        const lean = Math.sin(ac) * .018;
        const tn = .84 + rnd() * .32, base = vi;
        for (let i = 0; i <= NU; i++) {
          const fu = i / NU, uu = U.clamp(uc + (fu - .5) * du + lean, .002, .998), pr = profAt(uu);
          const x = -8 + uu * 17;
          for (let j = 0; j <= NV; j++) {
            const fv = j / NV, aa = ac + (fv - .5) * da;
            const cy = Math.cos(aa), sy = Math.sin(aa);
            let ny = cy / KUN_RY, nz = sy / KUN_RZ; const nl = Math.hypot(ny, nz) || 1; ny /= nl; nz /= nl;
            // 覆瓦翘起：后缘(fu→1)外翻更明显，中央鼓起，边缘伏贴。沿椭圆外法线偏移。
            const bulge = .085 * Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv)
              + .075 * Math.pow(fu, 3) * Math.sin(Math.PI * fv);
            pos.push(x, cy * pr * KUN_RY + Math.sin(uu * 9) * .12 + ny * bulge,
              sy * pr * KUN_RZ + nz * bulge);
            // 法线分量方向：椭圆截面外法线 ∝ (cos a / Ry, sin a / Rz)
            uvs.push(fu, fv); bu.push(uu); belly.push(U.sm(-.28, .42, -cy)); tone.push(tn); vi++;
          }
        }
        for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
          const a0 = base + i * (NV + 1) + j;
          idx.push(a0, a0 + 1, a0 + NV + 1, a0 + 1, a0 + NV + 2, a0 + NV + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aBodyU', new THREE.Float32BufferAttribute(bu, 1));
    g.setAttribute('aBelly', new THREE.Float32BufferAttribute(belly, 1));
    g.setAttribute('aTone', new THREE.Float32BufferAttribute(tone, 1));
    g.setIndex(idx); return g;
  }

  // 分叉新月尾鳍：从尾柄(-8)向后的上下两叶，外缘弧形、中央内凹。
  // 旧版尾部只是一根收尖的锥体，是"鲲不像鱼"的最大原因。
  function tailFinGeometry() {
    const pos = [], uvs = [], bu = [], idx = [];
    const lobes = [{ s: 1, len: 3.7, sweep: 1.00 }, { s: -1, len: 3.2, sweep: .84 }];
    for (const lobe of lobes) {
      const base = pos.length / 3, NU = 9, NV = 16;
      for (let i = 0; i <= NU; i++) {
        const f = i / NU;                       // 0 内缘 .. 1 外缘
        for (let j = 0; j <= NV; j++) {
          const th = (j / NV) * 1.5;             // 0 内凹 .. 1.5rad 叶尖（更向后勾）
          const reach = lobe.len * (.24 + .76 * Math.pow(Math.sin(th), .8));
          // 关键：内缘随 th 增大逐步逼近外缘，到叶尖处完全重合→收成尖角。
          // 旧版叶尖 inner=0.86reach，f 方向仍有 0.14 宽度，斜上方看就是一块平头矩形板。
          const tipClose = U.sm(.55, 1.5, th);
          const inner = reach * tipClose * .98;
          const rr = inner + (reach - inner) * f;
          // 厚度随叶尖收窄，避免鼓成方块；外缘(f→1)略向后弯出月牙弧。
          const thick = Math.sin(Math.PI * f) * Math.sin(th) * .22 * (1 - tipClose * .55);
          pos.push(
            -8 - Math.cos(th) * rr * .95 - Math.pow(f, 3) * Math.sin(th) * .5,
            lobe.s * Math.sin(th) * rr * lobe.sweep,
            thick
          );
          uvs.push(f, j / NV); bu.push(-.30 * f);
        }
      }
      for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
        const a = base + i * (NV + 1) + j;
        idx.push(a, a + 1, a + NV + 1, a + 1, a + NV + 2, a + NV + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aBodyU', new THREE.Float32BufferAttribute(bu, 1));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // ---- 逐根飞羽构成的翅膀 ----
  function wingGeometry(side) {
    const pos = [], uvs = [], span = [], shade = [], idx = [];
    let vi = 0;
    function feather(uSpan, dirX, dirZ, len, width, lift, tone) {
      const rootX = side * (3.2 + uSpan * 8.6);
      // 飞羽抬高到翼面膜之上：膜与羽若共用同一条 sin(u*2.3) 脊线就会共面，
      // 深度测试在每片羽与膜的重叠带上打出一排暗点（放大后正对应羽片数）。
      const rootY = Math.sin(uSpan * 2.3) * 1.2 + .34;
      // 两翼统一向后掠。旧版左右翼 rootZ 符号相反，造成两翼前后错位。
      const rootZ = -uSpan * .75;
      const NU = 7, NV = 4, base = vi;
      // 羽片宽度轴固定以翼展方向为主，只轻微跟随飞羽的外张角。
      // 旧版宽度轴是 (-dirZ,dirX)：初级飞羽越靠翼尖越外张，宽度轴随之转到前后向，
      // 翼展方向便失去覆盖，相邻飞羽之间露出一排背景黑洞（放大截图里的"破烂带"）。
      const wAxisX = side * (1 - Math.abs(dirX) * .16);
      const wAxisZ = dirX * .22;
      // 每根羽片沿飞行方向/竖直方向做确定性微错落：羽片相互重叠时若严格共面，
      // 深度测试会在重叠带产生摩尔纹般的暗点。瓦片式错落同时更像真实覆瓦羽列。
      const layZ = (U.h1(uSpan * 9973) - .5) * .11;
      const layY = (U.h1(uSpan * 7919) - .5) * .09;
      for (let i = 0; i <= NU; i++) {
        const fu = i / NU;
        // 羽端收尖放缓：旧版 fu=1 时 shape 只剩 .35，末端半宽不足相邻羽距的一半。
        const shape = Math.pow(Math.sin(Math.PI * (fu * .78 + .08)), .48) * (1 - fu * .10);
        for (let j = 0; j <= NV; j++) {
          const fv = j / NV * 2 - 1;
          const w = width * shape * fv;
          pos.push(
            rootX + dirX * len * fu + wAxisX * w,
            rootY + layY + lift * fu + (1 - Math.abs(fv)) * .18 * shape + Math.sin(fu * 3.14) * .14,
            rootZ + layZ + dirZ * len * fu + wAxisZ * w
          );
          uvs.push(fu, fv * .5 + .5);
          span.push(uSpan);
          shade.push(tone);
          vi++;
        }
      }
      for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
        const a = base + i * (NV + 1) + j;
        idx.push(a, a + 1, a + NV + 1, a + 1, a + NV + 2, a + NV + 1);
      }
    }
    // 关键修正：飞羽从翼前缘向飞行反方向(-z)伸展，这才是真实鸟翼的覆瓦结构。
    // 旧版 dirZ 为正，所有羽毛朝鸟头方向伸出，从侧后方看就是一把举着的纸扇。
    const N2 = 32;
    for (let k = 0; k < N2; k++) {
      const u = k / (N2 - 1) * .64;
      feather(u, side * (.10 + u * .16), -1.0, 3.9 + u * 1.8, .66, -u * .30, .78 + .18 * (1 - u));
    }
    const N1 = 26;
    for (let k = 0; k < N1; k++) {
      const f = k / (N1 - 1), u = .62 + f * .38;
      const ang = f * .88;
      // 初级飞羽：翼尖最长，向外后方斜伸，形成尖削的翼端而非齐平扇缘。
      // 外张角收敛到 .88rad、长度差从 3.6 收到 2.6——旧版翼尖羽末端沿翼展跨度是
      // 根部的三倍，间距超过羽片宽度，配合旋转后的宽度轴就成了一排黑洞。
      feather(u, side * (.22 + Math.sin(ang) * .74), -Math.cos(ang), 4.6 + f * 2.6, .56 * (1 - f * .15), -u * .16, .92 + .10 * f);
    }
    const NC = 24;
    for (let k = 0; k < NC; k++) {
      const u = k / (NC - 1) * .98;
      feather(u, side * .06, -.55, 2.2 + u * .9, .46, .24, .70 + .10 * u);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // 连续翼面：覆盖羽毛根部约 72%，前缘平滑、后缘弧形，让翅膀成为整片翼而非梳齿；翼尖仍露出分叉飞羽。
  function membraneGeometry(side) {
    const pos = [], uvs = [], span = [], shade = [], idx = [];
    const NU = 12, NV = 8;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, us = u * .92;
      const rootX = side * (3.2 + us * 8.6);
      // 翼尖保留窄膜直到 u=1：旧版膜在 0.84 截止，初级飞羽根部之间的缝露出暗背景黑点。
      // 后缘从 -.66 延到 -1.5 倍弦长，让膜成为飞羽下方的连续衬底，缝隙透出羽色而非暗海。
      const chord = (4.6 * (1 - Math.pow(u, 2.1)) + .85) * (1 - u * .18);
      // 翼面前缘在 +z（飞行方向），后缘向 -z 拖出，与向后伸展的飞羽一致。
      const frontZ = chord * .34, backZ = -chord * .66;
      const yArch = Math.sin(u * 2.3) * 1.2 + Math.sin(u * Math.PI) * .5;
      for (let j = 0; j <= NV; j++) {
        const fv = j / NV, z = frontZ + (backZ - frontZ) * fv;
        pos.push(rootX + side * (fv * .6 - .3), yArch + (1 - Math.abs(fv * 2 - 1)) * .25, -us * .75 + z);
        uvs.push(u, fv); span.push(us); shade.push(.62 + .10 * (1 - u));
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j;
      idx.push(a, a + 1, a + NV + 1, a + 1, a + NV + 2, a + NV + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // 鹏身：连续的鸟类体轴，取代"椭球 + 独立颈球 + 独立头球"的拼接。
  // 剖面依次给出尾根、收腹、饱满胸、细颈、头、喙基；背腹高于左右宽（侧扁），
  // 胸部下缘额外压出龙骨，从侧后方看不再是鱼雷。
  const BIRD_KEYS = [
    [.00, .10], [.08, .30], [.20, .55], [.34, .82], [.48, 1.00], [.58, 1.08],
    [.66, 1.06], [.74, .88], [.81, .52], [.87, .40], [.92, .46], [.96, .58], [1.00, .34]
  ];
  function birdBodyGeometry() {
    const rings = 44, seg = 22, pos = [], uvs = [], idx = [];
    for (let i = 0; i <= rings; i++) {
      const u = i / rings, z = -7 + u * 16, r = profileCurve(BIRD_KEYS, u);
      for (let j = 0; j <= seg; j++) {
        const a = j / seg * U.TAU, ca = Math.cos(a), sa = Math.sin(a);
        // 龙骨：胸腹下缘的纵向脊，鸟类飞行肌附着处，是鸟类剖面区别于鱼雷的关键。
        const keel = .46 * Math.exp(-Math.pow((u - .58) / .17, 2)) * Math.max(0, -sa);
        pos.push(ca * r * 1.75, sa * r * 2.25 - keel + r * .12, z);
        uvs.push(j / seg, u);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j; idx.push(a, a + 1, a + seg + 1, a + 1, a + seg + 2, a + seg + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const FINS = `varying vec3 vW,vN;varying vec2 vUv;varying float vSpan,vShade;`;
  // 屏幕空间导数求法线：飞羽末端是极窄三角形，cross(dFdx,dFdy) 在个别像素退化到近零，
  // normalize 后变 NaN → 渲染成规则排列的黑点（数量正好等于飞羽根数）。
  // 退化时回退到插值顶点法线，保住这一像素。
  const NORMAL = `vec3 d1=dFdx(vW),d2=dFdy(vW);vec3 nc=cross(d1,d2);float nl=length(nc);
    vec3 nv=normalize(vN);vec3 N=nl>0.00001?nc/nl:nv;if(dot(N,nv)<0.)N=-N;`;
  // 背光次表面透亮：视线与光同向的一面（背光侧）透出组织的暖/冷光，薄边缘更明显。
  const SSS = `vec3 Ls=normalize(uSunDir);vec3 Vs=normalize(cameraPosition-vW);
    float trans=pow(max(dot(Vs,-Ls),0.),2.4);
    float thin=pow(1.-abs(dot(N,Vs)),1.4);
    float sssAmt=trans*(.35+.65*thin);`;

  function build(scene) {
    const tex = Gfx.textures();
    // 鱼身底层：作为鳞片缝隙的暗底，只在缝隙露出。
    const fishMat = Gfx.mat({},
      `uniform float uTime;attribute float aBodyU;varying vec3 vW,vN;varying vec2 vUv;
       void main(){vec3 p=position;${SWAY}
        vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(p,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `varying vec3 vW,vN;varying vec2 vUv;void main(){${NORMAL}
        vec3 col=clLight(N,vW,vec3(.035,.085,.11),0.);gl_FragColor=vec4(col,1.);}`);
    // 鳞片：腹背渐变 + 覆瓦明暗 + 缝隙阴影 + 背光透亮。
    const scaleMat = Gfx.mat({},
      `uniform float uTime;attribute float aBodyU,aBelly,aTone;
       varying vec3 vW,vN;varying vec2 vUv;varying float vBelly,vTone,vBodyU;
       void main(){vec3 p=position;${SWAY}
        vUv=uv;vBelly=aBelly;vTone=aTone;vBodyU=aBodyU;vN=normalize(mat3(modelMatrix)*normal);
        vec4 w=modelMatrix*vec4(p,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `varying vec3 vW,vN;varying vec2 vUv;varying float vBelly,vTone,vBodyU;
       void main(){${NORMAL}
        float fu=vUv.x,fv=vUv.y;
        float radial=sin(3.14159*fu)*sin(3.14159*fv);
        // 边缘柔和过渡：旧版 0.11/0.14 的窄硬边让每片鳞都像方格，连成网兜。
        float edge=U_SM(.0,.24,fu)*U_SM(.0,.24,1.-fu)*U_SM(.0,.26,fv)*U_SM(.0,.26,1.-fv);
        vec3 dark=vec3(.055,.19,.26), pale=vec3(.66,.75,.74);
        vec3 base=mix(dark,pale,vBelly*.94);
        base*=.88+.18*radial;
        base*=.94+.06*edge;
        // 世界坐标噪声打散规则行列：双层噪声（粗斑+细粒），更像活体皮肤而非编织网。
        float grain=gn(vW.xz*1.35+vW.y*.75)*.6+gn(vW.xz*4.2-vW.y*1.9)*.4;
        base*=.80+.36*grain;
        // 侧线：真实鱼类从鳃盖延伸至尾柄的感官线，显著提升"这是一条鱼"的辨识度。
        float lat=exp(-pow((vBelly-.46)*9.,2.))*smoothstep(.12,.90,vBodyU);
        base*=1.-lat*.17;
        base*=vTone;
        // 鳃盖弧线与吻端嘴线：给钝头以可辨识的鱼头解剖，而非光滑胶囊。
        float gill=exp(-pow((vBodyU-.795)*28.,2.))*U_SM(.12,.30,fv)*(1.-U_SM(.68,.88,fv));
        float mouth=U_SM(.958,.970,vBodyU)*(1.-U_SM(.986,.997,vBodyU));
        base*=1.-gill*.34-mouth*.62;
        ${SSS}
        vec3 col=clLight(N,vW,base,0.);
        vec3 sssCol=mix(vec3(.16,.52,.60),vec3(1.0,.70,.40),vBelly);
        col+=sssCol*sssAmt*(.26+.30*uDusk);
        float rim=pow(1.-max(dot(N,Vs),0.),3.);
        col+=vec3(.32,.60,.78)*rim*.30;
        gl_FragColor=vec4(col,1.);}`.replace(/U_SM\(/g, 'smoothstep('));
    const kun = new THREE.Group();
    const body = new THREE.Mesh(fishGeometry(), fishMat); kun.add(body);
    const scales = new THREE.Mesh(scaleGeometry(), scaleMat); scales.castShadow = true; kun.add(scales);
    // 所有鳍共用一套带鳍条、背光透光的材质。
    const tailFinMat = Gfx.mat({},
      `uniform float uTime;attribute float aBodyU;varying vec3 vW,vN;varying vec2 vUv;
       void main(){vec3 p=position;${SWAY}
        vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(p,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `varying vec3 vW,vN;varying vec2 vUv;void main(){${NORMAL}
        // 鳍条放射纹沿 vUv.y(扇形角)，边缘压暗，避免薄叶在逆光下读成一块纯白矩形板。
        float ray=.40+.60*pow(abs(sin(vUv.y*34.)),.75);
        float fade=U_SM(.0,.16,vUv.x)*(1.-U_SM(.80,1.,vUv.x)*.60);
        vec3 base=vec3(.075,.26,.36)*ray*fade;
        ${SSS}
        vec3 col=clLight(N,vW,base,0.);
        col+=vec3(.24,.55,.70)*sssAmt*.24;
        col+=vec3(.20,.42,.56)*pow(1.-max(dot(N,Vs),0.),3.)*.22;
        gl_FragColor=vec4(col,1.);}`.replace(/U_SM\(/g, 'smoothstep('), { side: THREE.DoubleSide });

    // 参数化鳍片：沿身体弧线展开、后掠、拱起。旧版用 3 个 ConeGeometry 当鳍，
    // 从侧面看是生硬的三角锥。鳍条的 aBodyU 按每个顶点的实际 x 采样，与鱼身同步摆动。
    function bladeFin(x0, yBase, len, height, sweep, dir) {
      const NU = 16, NV = 4, pos = [], uvs = [], bu = [], idx = [];
      for (let i = 0; i <= NU; i++) {
        const f = i / NU;
        const arch = Math.pow(Math.sin(Math.PI * Math.pow(f, .82)), .72);
        for (let j = 0; j <= NV; j++) {
          const g = j / NV;
          const x = x0 + f * len - sweep * g * arch;
          pos.push(x, yBase + dir * height * arch * g + Math.sin(g * Math.PI) * .16, (g - .5) * .22 * arch);
          uvs.push(f, g); bu.push((x + 8) / 17);
        }
      }
      for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
        const a = i * (NV + 1) + j; idx.push(a, a + 1, a + NV + 1, a + 1, a + NV + 2, a + NV + 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('aBodyU', new THREE.Float32BufferAttribute(bu, 1));
      geo.setIndex(idx); geo.computeVertexNormals(); return geo;
    }
    kun.add(new THREE.Mesh(bladeFin(-1.5, 2.30, 5.5, 2.0, 1.2, 1), tailFinMat));   // 背鳍：收小，不再像帆
    kun.add(new THREE.Mesh(bladeFin(-4.2, -1.35, 3.2, 1.6, .7, -1), tailFinMat));  // 臀鳍
    for (const s of [-1, 1]) {                                                       // 胸鳍：鳃盖正后方，向后外展
      const g = bladeFin(4.6, -.15, 3.0, 1.9, 1.35, 1);
      g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, tailFinMat);
      m.position.set(0, -.30, s * 1.05); m.scale.z = s; kun.add(m);
    }
    const tailFin = new THREE.Mesh(tailFinGeometry(), tailFinMat); kun.add(tailFin);
    // 眼：金色虹膜 + 瞳孔 + 高光
    const iris = new THREE.MeshBasicMaterial({ color: 0x8f743f });
    const pupil = new THREE.MeshBasicMaterial({ color: 0x05080a });
    const glint = new THREE.MeshBasicMaterial({ color: 0xe8f2f5 });
    for (const s of [-1, 1]) {
      // 眼睛嵌进体表：头部在 x≈7 处半宽仅约 1.0，旧版瞳孔 z=1.17+ 半径浮在皮外。
      // 虹膜贴表、瞳孔半嵌、高光收紧，三点沿体表法线依次内收。
      const e = new THREE.Mesh(new THREE.SphereGeometry(.24, 12, 10), iris); e.position.set(7.10, .92, s * .90); kun.add(e);
      const p = new THREE.Mesh(new THREE.SphereGeometry(.15, 10, 8), pupil); p.position.set(7.22, .92, s * .98); kun.add(p);
      const g = new THREE.Mesh(new THREE.SphereGeometry(.032, 6, 5), glint); g.position.set(7.30, 1.00, s * 1.01); kun.add(g);
    }
    scene.add(kun);
    // 对手巨鲲：克隆同一套几何与材质（共享 uTime，摆尾节奏一致），单独轨迹与朝向。
    // 体色更深、体型略小，与主角鲲区分；它属于这片海，不是化形的那条。
    // 色差：主角青蓝、对手暖铜，缠斗时一眼分敌我。改 shader 里的色偏需要独立材质。
    const scaleMatR = scaleMat.clone();
    scaleMatR.fragmentShader = scaleMat.fragmentShader
      .replace('vec3 dark=vec3(.055,.19,.26), pale=vec3(.66,.75,.74);', 'vec3 dark=vec3(.20,.10,.06), pale=vec3(.78,.62,.40);')
      .replace('vec3(.16,.52,.60),vec3(1.0,.70,.40)', 'vec3(.62,.36,.14),vec3(1.0,.58,.26)')
      .replace('vec3(.32,.60,.78)*rim*.30', 'vec3(.78,.50,.26)*rim*.34');
    const fishMatR = fishMat.clone();
    const tailMatR = tailFinMat.clone();
    tailMatR.fragmentShader = tailFinMat.fragmentShader
      .replace('vec3(.075,.26,.36)*ray*fade', 'vec3(.26,.15,.08)*ray*fade')
      .replace('vec3(.24,.55,.70)*sssAmt*.42', 'vec3(.70,.42,.20)*sssAmt*.42');
    const rival = kun.clone(true);
    rival.traverse(o => {
      if (!o.isMesh) return;
      if (o.material === scaleMat) o.material = scaleMatR;
      else if (o.material === fishMat) o.material = fishMatR;
      else if (o.material === tailFinMat) o.material = tailMatR;
    });
    rival.scale.setScalar(.86);
    Creature.rivalMats = [scaleMatR, fishMatR, tailMatR];
    scene.add(rival);

    // 逐根飞羽材质：羽轴亮、羽缘暗、羽枝纹、扇翅相位滞后，加背光透亮。
    const featherMat = Gfx.mat({},
      `attribute float aSpan,aShade;uniform float uTime;${FINS}
       void main(){vec3 p=position;float s=aSpan;
         ${FLAP}
         // 上反角 + 欠阻尼振子扇翅：翼尖滞后过冲使拍打呈由内向外的动波，非刚性翻转
         p.y+=s*s*1.6 + drive*s*2.7 + tip*s*s*1.15;
         vUv=uv;vSpan=s;vShade=aShade;
         vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(p,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      // 飞羽不用屏幕导数法线：初级飞羽是极窄三角形，dFdx/dFdy 在部分像素跨三角形
      // 插值出的法线方向失真，clLight 把它算成规则排列的黑点（数量正好等于羽片数）。
      // 这里改用插值顶点法线——羽枝纹、羽轴高光仍由下方 base 提供，细节不会丢。
      `${FINS}void main(){vec3 N=normalize(vN);
         float v=vUv.y*2.-1.;              // -1..1 横跨羽片，0 为羽轴
         float shaft=1.-abs(v);
         // 羽枝：从羽轴斜向两侧生长的细纹，倾角随位置变，分三级频率叠加
         float ang=v*2.7;
         float barb=sin(vUv.x*118.+abs(v)*34.+ang)*.030
                   +sin(vUv.x*253.+abs(v)*71.)*.014
                   +sin(vUv.x*61.-abs(v)*19.)*.020;
         // 羽端分叉裂片：羽尖处把连续边缘切成细齿
         float tip=smoothstep(.80,1.,vUv.x);
         float split=tip*pow(abs(sin(vUv.y*3.14159*18.)),.8)*.020;
         float edge=1.-.12*pow(abs(v),3.)-split;
         vec3 base=vec3(.48,.58,.68)*vShade;
         base*=.80+.26*pow(shaft,.7); base+=barb; base*=edge;
         base*=.90+.14*vUv.x;
         // 各向异性丝光：视线绕羽轴方向的镜面亮带，模拟羽毛丝的定向反射
         vec3 Vw=normalize(cameraPosition-vW);
         float aniso=pow(max(dot(Vw,normalize(vec3(0.,1.,.35))),0.),5.)*shaft;
         base+=vec3(.30,.40,.55)*aniso*.35;
         ${SSS}
         vec3 col=clLight(N,vW,base,0.);
         col+=vec3(.52,.66,.86)*sssAmt*.16;
         float rim=pow(1.-max(dot(N,Vs),0.),2.8);
         col+=vec3(.50,.64,.82)*rim*.40;
         // 顶点法线比导数法线平滑，补一层柔和环境光把翼面明暗层次拉回来
         col+=vec3(.09,.13,.20)*(.5+.5*shaft);
         // 保底环境亮度：窄羽片的顶点法线朝向参差，弱光角下 base 再被压暗就会读成黑点。
         col+=vec3(.07,.11,.16);
         // 双面补光：背面（背向太阳）填充
         col+=vec3(.05,.08,.12)*(1.-max(dot(N,normalize(uSunDir)),0.));
         gl_FragColor=vec4(col,1.);}`, { side: THREE.DoubleSide });
    // 翼面材质：前缘亮、后缘渐暗，细腻羽纹，弱背光透亮。
    const membraneMat = Gfx.mat({},
      `attribute float aSpan,aShade;uniform float uTime;${FINS}
       void main(){vec3 p=position;float s=aSpan;
         ${FLAP}
         p.y+=s*s*1.6 + drive*s*2.7 + tip*s*s*1.15;
         vUv=uv;vSpan=s;vShade=aShade;vN=normalize(mat3(modelMatrix)*normal);
         vec4 w=modelMatrix*vec4(p,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `${FINS}void main(){${NORMAL}
         float front=1.-vUv.y;
         // 覆羽扇形：一层层叠瓦状短羽，沿翼展重复，边缘有细密斜纹
         float row=vUv.y*13.+vUv.x*2.5;
         float scale=1.-smoothstep(.0,.9,abs(fract(row)-.5)*2.);
         float barb=sin(vUv.x*230.+vUv.y*48.)*.018+sin(vUv.x*97.-vUv.y*23.)*.015;
         vec3 base=vec3(.44,.52,.62)*vShade*(.80+.28*front)+barb;
         base*=1.-scale*.12;
         vec3 Vw=normalize(cameraPosition-vW);
         float aniso=pow(max(dot(Vw,normalize(vec3(0.,1.,.3))),0.),6.)*.18;
         base+=vec3(.28,.38,.54)*aniso;
         ${SSS}
         vec3 col=clLight(N,vW,base,0.);
         col+=vec3(.50,.64,.84)*sssAmt*.14;
         gl_FragColor=vec4(col,1.);}`, { side: THREE.DoubleSide });
    const peng = new THREE.Group();
    const wingL = new THREE.Mesh(wingGeometry(-1), featherMat), wingR = new THREE.Mesh(wingGeometry(1), featherMat);
    const memL = new THREE.Mesh(membraneGeometry(-1), membraneMat), memR = new THREE.Mesh(membraneGeometry(1), membraneMat);
    wingL.castShadow = wingR.castShadow = true; peng.add(memL, memR, wingL, wingR);
    Creature.membraneMat = membraneMat;
    // 躯干：细绒纹理 + 背光透亮
    const trunkMat = Gfx.mat({ uMap: { value: tex.feather.map }, uNMap: { value: tex.feather.normalMap } },
      `uniform float uTime;${FINS.replace('varying float vSpan,vShade;', '')}void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `uniform sampler2D uMap,uNMap;${FINS.replace('varying float vSpan,vShade;', '')}void main(){${NORMAL}
       vec3 base=texture2D(uMap,vUv*2.).rgb*vec3(.98,.99,1.);
       float down=sin(vUv.x*90.)*sin(vUv.y*70.)*.035; base+=down;
       ${SSS}
       vec3 col=clLight(N,vW,base,0.);
       col+=vec3(.70,.80,.96)*sssAmt*.30;
       gl_FragColor=vec4(col,1.);}`);
    const trunk = new THREE.Mesh(birdBodyGeometry(), trunkMat); peng.add(trunk);
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(1.9, 16, 12), trunkMat);
      shoulder.position.set(s * 1.9, .05, 2.2); shoulder.scale.set(1.1, .7, 1.7); peng.add(shoulder);
    }
    // 颈与头已并入上面的连续体轴，这里只保留喙、眼与羽冠。
    const beak = new THREE.Mesh(new THREE.ConeGeometry(.40, 2.3, 10), new THREE.MeshStandardMaterial({ color: 0xd7a24c, roughness: .5 }));
    beak.rotation.x = Math.PI / 2; beak.position.set(0, .18, 9.7); peng.add(beak);
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(.13, 1.7 - i * .15, 5), featherMat);
      c.position.set((i - 2) * .24, 1.35, 7.7 - i * .18); c.rotation.x = -1.25; c.rotation.z = (i - 2) * .18; peng.add(c);
    }
    const peM = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.15, 8, 6), peM); e.position.set(s * .68, .72, 8.35); peng.add(e); }
    const tailMat = Gfx.mat({ uMap: { value: tex.feather.map } },
      `uniform float uTime;${FINS.replace('varying float vSpan,vShade;', '')}void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `uniform sampler2D uMap;${FINS.replace('varying float vSpan,vShade;', '')}void main(){vec4 t=texture2D(uMap,vUv);if(t.a<.18)discard;${NORMAL}
       ${SSS}
       vec3 col=clLight(N,vW,t.rgb*vec3(.50,.60,.72),0.);col+=vec3(.5,.62,.82)*sssAmt*.24;
       gl_FragColor=vec4(col,1.);}`, { side: THREE.DoubleSide });
    // 分叉尾羽：渐尖羽片呈扇形展开，末端收细而非平齐梳齿
    const tailGeom = (() => {
      const g = new THREE.PlaneGeometry(1.05, 7, 1, 6), p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k), f = (y + 3.5) / 7;        // 0 根部 .. 1 末端
        p.setX(k, p.getX(k) * (1 - .9 * Math.pow(f, 1.3))); // 向末端收成尖，避免平头矩形
      }
      p.needsUpdate = true; g.computeVertexNormals(); return g;
    })();
    for (let i = -2; i <= 2; i++) {
      const t = new THREE.Mesh(tailGeom, tailMat);
      t.rotation.x = -Math.PI / 2.35; t.rotation.z = i * .13;
      t.position.set(i * 1.15, .1, -7.0 - (2 - Math.abs(i)) * .55); peng.add(t);
    }
    scene.add(peng);
    Creature.kun = kun; Creature.peng = peng; Creature.rival = rival; Creature.fishMat = fishMat; Creature.scaleMat = scaleMat;
    Creature.featherMat = featherMat; Creature.trunkMat = trunkMat; Creature.tailFinMat = tailFinMat;
  }

  function update(t) {
    const gone = U.sm(84, 88, t);
    Creature.kun.visible = t < 38.5;
    Creature.peng.visible = t > 30 && gone < .99;
    if (Creature.kun.visible) {
      kunAt(t, dummy.position); dirAt(KUN, t, TMP);
      TMP.y = U.clamp(TMP.y, -.6, .6); TMP.normalize();
      orientFish(TMP);
      // 化形：跃起顶点附近完全消散（旧版只缩到 0.25，留下一条半大的鱼挂在天上）。
      dummy.scale.setScalar(1 - U.sm(29.5, 36, t)); dummy.updateMatrix();
      Creature.kun.position.copy(dummy.position); Creature.kun.quaternion.copy(dummy.quaternion); Creature.kun.scale.copy(dummy.scale);
      Creature.fishMat.uniforms.uTime.value = t; Creature.scaleMat.uniforms.uTime.value = t;
      Creature.tailFinMat.uniforms.uTime.value = t;
    }
    // 对手巨鲲：只在缠斗段出现（40-68s），随上跃/下潜由轨迹切线定朝向。
    Creature.rival.visible = t > 39 && t < 69;
    if (Creature.rival.visible) {
      rivalAt(t, dummy.position); dirAt(RIVAL, t, TMP);
      // 鱼可跃得比鸟陡，但完全竖直会露出腹背的怪异轮廓；限制到 ±0.55（约 33°）。
      TMP.y = U.clamp(TMP.y, -.55, .55); TMP.normalize();
      orientFish(TMP);
      dummy.scale.setScalar(.86); dummy.updateMatrix();
      Creature.rival.position.copy(dummy.position); Creature.rival.quaternion.copy(dummy.quaternion); Creature.rival.scale.copy(dummy.scale);
      for (const m of Creature.rivalMats) if (m.uniforms && m.uniforms.uTime) m.uniforms.uTime.value = t;
    }
    if (Creature.peng.visible) {
      pengAt(t, dummy.position); dirAt(PENG, t, TMP);
      // 限制俯仰：轨迹切线在俯冲段近乎竖直，直接对齐会让鹏头朝下、翼面竖成两堵墙。
      // 把竖直分量压到 ±0.40（约 24° 俯冲角），水平朝向仍取切线，鸟保持滑翔姿态。
      TMP.y = U.clamp(TMP.y, -.40, .40); TMP.normalize();
      orientBird(TMP);
      dummy.scale.setScalar(U.sm(30, 37, t) * (1 - gone));
      dummy.updateMatrix(); Creature.peng.position.copy(dummy.position); Creature.peng.quaternion.copy(dummy.quaternion); Creature.peng.scale.copy(dummy.scale);
      Creature.featherMat.uniforms.uTime.value = t;
      Creature.membraneMat.uniforms.uTime.value = t;
      Creature.trunkMat.uniforms.uTime.value = t;
    }
  }
  return { build, update, kunAt, pengAt, rivalAt, dirAt, KUN, PENG, RIVAL };
})();
