'use strict';
// 共享光照块、烘焙贴图、解析天空、云影场、HDR 后期链。
// 本轮移植 crimson-loong 的三大全局系统：解析黄昏天空 / 统一云影+双介质大气透视 / 完整后期。
const Gfx = (() => {
  const V3 = THREE.Vector3;
  const SUN = new V3(.52, .58, -.62).normalize();

  // 所有材质共用同一组 uniform 对象：Film 每帧只改这里，整片海天同时变色。
  const L = {
    uSunDir: { value: SUN.clone() },
    uSunCol: { value: new THREE.Color(1.5, 1.15, .82) },
    uSkyCol: { value: new THREE.Color(.30, .46, .68) },
    uGroundCol: { value: new THREE.Color(.22, .27, .31) },
    uFogCol: { value: new THREE.Color(.58, .68, .78) },
    uFogD: { value: .0015 },
    uStorm: { value: 0 }, uFlash: { value: 0 }, uDusk: { value: 0 }, uTime: { value: 0 },
    uCloudShade: { value: .55 },
    // 云影场：烘焙的平铺纹理 + 每帧的状态
    clT: { value: null }, clA: { value: new THREE.Vector4() }, clB: { value: new THREE.Vector4() }, clC: { value: new THREE.Vector4() },
    // 水下光学：焦散图 + 水下程度（0 水面之上，1 完全水下）
    cauT: { value: null }, uUnder: { value: 0 }, uCauDbg: { value: 0 },
  };

  const GLSL_NOISE = `
    float gh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float gn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y); }
    float gfbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){v+=a*gn(p);p=p*2.03+vec2(17.1,9.2);a*=.5;} return v; }
    float gfbm3(vec3 p){ float v=0.,a=.5;
      for(int i=0;i<4;i++){ vec3 i3=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        float n=mix(mix(mix(gh(i3.xy+i3.z),gh(i3.xy+vec2(1,0)+i3.z),f.x),mix(gh(i3.xy+vec2(0,1)+i3.z),gh(i3.xy+vec2(1,1)+i3.z),f.x),f.y),
                    mix(mix(gh(i3.xy+i3.z+1.),gh(i3.xy+vec2(1,0)+i3.z+1.),f.x),mix(gh(i3.xy+vec2(0,1)+i3.z+1.),gh(i3.xy+vec2(1,1)+i3.z+1.),f.x),f.y),f.z);
        v+=a*n; p=p*2.03+vec3(17.1,9.2,5.3); a*=.5; } return v; }
  `;

  // ==========================================================================
  // 解析黄昏天空：低空的红带、天顶的蓝、太阳盘与卷云（亮度可越过 1，交给 HDR 后期）
  // 移植自 crimson-loong GLSL_SKY / skyBase
  // ==========================================================================
  const GLSL_SKY = `
    vec3 skyBase(vec3 d,float disc){
      float h=clamp(d.y,-.05,1.);
      float sd=max(dot(d,normalize(uSunDir)),0.);
      float az=dot(normalize(d.xz+1e-5),normalize(uSunDir.xz))*0.5+0.5;
      vec3 zen=vec3(.066,.092,.235);
      vec3 mid=mix(vec3(.205,.235,.395),vec3(.350,.300,.400),az);
      vec3 low=mix(vec3(.980,.430,.330),vec3(1.280,.600,.260),az);
      vec3 hor=mix(vec3(1.150,.400,.230),vec3(1.650,.740,.220),az*az);
      float k=1.-h;
      vec3 c=mix(zen,mid,pow(k,2.)); c=mix(c,low,pow(k,4.6)); c=mix(c,hor,pow(k,14.));
      c=mix(c,vec3(.300,.230,.400),(1.-az)*pow(k,30.)*.55);
      { vec2 cu=d.xz/max(d.y+.10,.05);
        float ci=gfbm(cu*vec2(.50,1.7)+vec2(4.,1.))*0.7+gfbm(cu*vec2(1.3,4.6))*0.3;
        ci=smoothstep(.50,.78,ci)*smoothstep(.03,.28,d.y);
        c=mix(c,vec3(1.40,.56,.36),ci*.72); }
      c+=vec3(1.3,.52,.18)*pow(sd,6.)*.42;
      c+=vec3(2.4,1.25,.46)*pow(sd,48.)*.8;
      c+=vec3(6.0,3.6,1.6)*pow(sd,700.)*disc;
      c+=vec3(60.0,38.0,17.0)*smoothstep(.99962,.99982,sd)*disc;
      if(d.y<0.) c=mix(c,vec3(.17,.13,.15),smoothstep(0.,-.25,d.y));
      return c;
    }
    // 白昼一侧：蓝天 + 高空冷积云，风暴与黄昏时向 skyBase 过渡
    vec3 skyDay(vec3 d){
      float h=clamp(d.y,-.05,1.);
      float sd=max(dot(d,normalize(uSunDir)),0.);
      vec3 zen=vec3(.055,.19,.44);
      vec3 hor=vec3(.55,.70,.86);
      vec3 c=mix(hor,zen,smoothstep(-.05,.72,h));
      c+=vec3(1.,.72,.40)*pow(sd,10.)*.30;
      c+=vec3(5.,3.4,1.8)*pow(sd,680.)*1.;
      c+=vec3(1.,.96,.86)*smoothstep(.9995,.99978,sd)*26.;
      return c;
    }
  `;

  // ==========================================================================
  // 统一光照块：云影场 clSunAt + 双介质大气透视 clFog，所有材质共享。
  // 这是"真实感最大的来源"——云影沿太阳方向投在任意表面，雾按高度分两层积累。
  // 移植自 crimson-loong GLSL_FOG / clSunCore / clFog，参数按鲲鹏场景尺度调整。
  // ==========================================================================
  const LIGHT = GLSL_NOISE + `
    uniform vec3 uSunDir,uSunCol,uSkyCol,uGroundCol,uFogCol;
    uniform float uFogD,uStorm,uFlash,uDusk,uTime,uCloudShade,uUnder,uCauDbg;
    uniform sampler2D clT,cauT; uniform vec4 clA,clB,clC;

    // 世界点处直射阳光所占比例：云影沿太阳射线投影到地面平面，随后被风暴/暮线削减。
    float clSunCore(vec3 wp,out float ray){
      vec2 g=wp.xz-vec2(${SUN.x.toFixed(5)},${SUN.z.toFixed(5)})/max(${SUN.y.toFixed(5)},.12)*wp.y;
      vec4 n=texture2D(clT,g*${(1 / 380).toFixed(7)}+clA.xy);
      float rag=(n.g-.5)*52.;
      float s=1.-clA.z*(1.-n.r);
      float under=clB.y*(1.-smoothstep(clB.x-14.,clB.x+14.,g.y+rag))*(1.-smoothstep(clB.z-9.,clB.z+9.,wp.y+rag*.3));
      s*=1.-under;
      s*=1.-clB.w*smoothstep(clB.z-24.,clB.z+24.,dot(g,vec2(.72,-.69))+rag);
      ray=n.b*clA.z;
      return clamp(s,0.,1.);
    }
    float clSunAt(vec3 wp){ float ray; return clSunCore(wp,ray); }

    // 水面焦散：阳光经波动水面折射聚焦成移动光网。两层反向漂移的焦散图相乘取锐，
    // 只在近水的浅层可见（随深度指数衰减），受云影调制，带轻微 RGB 色散。
    vec3 clCaustic(vec3 wp){
      // 上界收紧到 -1.5：水面(y≈0)不该吃焦散，否则破水帧水下光网浮到水面上。
      // 只有海床(y=-26)和水下游动的鲲(y=-4..-28)才接收折射光斑。
      if(wp.y>-1.5||wp.y<-34.) return vec3(0.);
      float depth=max(0.,-1.5-wp.y);
      float fade=exp(-depth*.045);
      // 大尺度水面折射扭曲：两层不同频率噪声，让光网流动而非平移瓷砖
      vec2 q=wp.xz*.019;
      float w1=gn(wp.xz*.004+vec2(uTime*.017,uTime*.011))-.5;
      float w2=gn(wp.xz*.009-vec2(uTime*.013,uTime*.019))-.5;
      vec2 warp=vec2(w1,w2)*.40;
      vec2 A=q+warp+vec2(uTime*.024,-uTime*.017);
      // 细网旋转 ~35° 错开主轴，两层不再平行叠成规则菱形
      mat2 R=mat2(.82,-.57,.57,.82);
      vec2 B=R*(q*.63-warp*.6)+vec2(-uTime*.019,uTime*.031);
      // 色散：三层微偏移各取一通道，边缘泛出冷暖色散
      float cr=texture2D(cauT,A+vec2(.003,0.)).r*texture2D(cauT,B+vec2(.003,0.)).r;
      float cg=texture2D(cauT,A).r*texture2D(cauT,B).r;
      float cb=texture2D(cauT,A-vec2(.003,0.)).r*texture2D(cauT,B-vec2(.003,0.)).r;
      vec3 net=pow(clamp(vec3(cr,cg,cb),0.,1.),vec3(1.0))*3.2;
      float g2=texture2D(cauT,A).g*texture2D(cauT,B).g;
      net+=pow(clamp(g2,0.,1.),1.3)*.85;
      float sun=clSunAt(wp);
      float vis=fade*(.45+.55*sun)*(1.-uStorm*.5)*.50;
      return net*vis;
    }

    // 太阳此刻的颜色（风暴里失去金色，变云底的灰蓝；闪电作为同侧白钥匙光）
    vec3 clSunK(vec3 wp,out float sto){
      float ray,be; vec2 g=wp.xz-vec2(${SUN.x.toFixed(5)},${SUN.z.toFixed(5)})/max(${SUN.y.toFixed(5)},.12)*wp.y;
      vec4 n=texture2D(clT,g*${(1 / 380).toFixed(7)}+clA.xy);
      float rag=(n.g-.5)*52.;
      float s=clSunCore(wp,ray);
      sto=clB.y*(1.-smoothstep(clB.x-14.,clB.x+14.,g.y+rag))*(1.-smoothstep(clB.z-9.,clB.z+9.,wp.y+rag*.3));
      vec3 c=mix((vec3(1.)+clC.rgb)*s,vec3(.50,.75,1.36)*(s*(1.+clC.r)),sto);
      return c+vec3(.70,1.08,2.10)*clB.z*0.;
    }

    // 双介质大气透视：谷雾（按高度指数衰减）+ 空气（随距离累加），并拾取视线中途的阳光。
    vec3 clFog(vec3 col,vec3 wp,vec3 cam){
      vec3 v=wp-cam; float d=length(v); v/=max(d,1e-4);
      float b=.042;
      float y0=max(cam.y,-10.), y1=max(wp.y,-10.), dy=y1-y0;
      float e0=exp(-b*y0), e1=exp(-b*y1);
      float avg=abs(dy)>.02?(e0-e1)/(b*dy):e0;
      // 白天雾偏淡（破水段原本灰白一片），黄昏与风暴保留甚至加强。
      float fogScale=mix(.60,1.0,smoothstep(.24,.66,uDusk))*(1.+uStorm*.22);
      float tm=${.0023.toFixed(5)}*d*avg*fogScale, ta=${.00060.toFixed(5)}*d*fogScale;
      float fw=max(dot(v,normalize(uSunDir)),0.);
      float lit=clSunAt(cam+v*min(d*.6,160.));
      vec3 key=uSunCol*(vec3(1.)+clC.rgb);
      float f2=fw*fw,f14=f2*f2*f2; f14*=f14*f2; float ph=.42+.50*f2+1.3*f14;
      vec3 sky=mix(vec3(.30,.38,.54),vec3(.17,.22,.42),uDusk);
      sky=mix(sky,vec3(.150,.180,.250),clB.w*0.8);
      // 雾里的直射光注入过高会把白天段整片洗成灰白；黄昏靠 fogScale 补偿保留逆光氛围。
      vec3 mist=sky*.92+key*(lit*ph*.52)+vec3(.40,.50,.85)*clC.w;
      vec3 air=sky*mix(1.04,.90,smoothstep(40.,260.,wp.y))+key*(lit*(.07+.34*f2+.72*f14))+vec3(.26,.33,.55)*clC.w;
      vec3 fc=(mist*tm+air*ta)/max(tm+ta,1e-6);
      vec3 result=mix(col,fc,1.-exp(-(tm+ta)));
      // 水下吸收：相机潜入水面后，长波(红)先被吸收、短波保留，能见度随距离骤降
      if(uUnder>.001){
        float depth=max(0.,-cam.y);
        vec3 absorb=exp(-vec3(.055,.020,.012)*d*(1.+depth*.06));
        vec3 waterTint=mix(vec3(.05,.30,.42),vec3(.02,.14,.26),clamp(depth/26.,0.,1.));
        vec3 inscatter=waterTint*(1.-exp(-d*.028))*(.5+.5*fw);
        vec3 submerged=result*absorb+inscatter;
        result=mix(result,submerged,uUnder);
      }
      return result;
    }

    vec3 clLight(vec3 n,vec3 p,vec3 albedo,float rough){
      vec3 N=normalize(n);
      float ndl=max(dot(N,normalize(uSunDir)),0.);
      float sto; vec3 sunK=clSunK(p,sto);
      vec3 direct=sunK*ndl;
      float h=N.y*.5+.5;
      vec3 fill=mix(uGroundCol,uSkyCol,h)*(1.-sto*.55);
      vec3 cold=vec3(.26,.42,.72)*uStorm*(.20+ndl*.4)+vec3(.42,.58,.95)*uFlash*.9;
      vec3 col=albedo*(direct+fill+cold);
      float rim=pow(1.-max(dot(N,normalize(cameraPosition-p)),0.),2.6);
      col+=rim*mix(albedo,vec3(1.),.42)*(.10+uFlash*.24);
      // 焦散光斑：投在朝上的表面（水底礁岩、潜行的鲲背），随水深衰减。
      // 放在雾之后叠加，避免被水下吸收雾吃掉——焦散是穿过水柱直接抵达表面的光。
      vec3 fogged=clFog(col,p,cameraPosition);
      float up=max(N.y,0.)*.55+.45;
      fogged+=clCaustic(p)*up*vec3(.78,.95,1.06)*.72;
      return fogged;
    }
  `;
  const mat = (uniforms, vs, fs, extra = {}) => new THREE.ShaderMaterial({
    uniforms: Object.assign({}, L, uniforms), vertexShader: vs, fragmentShader: LIGHT + fs, ...extra,
  });

  // ==========================================================================
  // 加载时烘焙：高度场 → 颜色图与法线图；云影图（r=日照比例 g=破碎边 b=云缘光束）
  // ==========================================================================
  function bakeSurface(size, heightFn, colorFn, strength = 3) {
    const h = new Float32Array(size * size), c = new Uint8Array(size * size * 4), n = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = heightFn(x / size, y / size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, u = x / size, v = y / size, hh = h[i];
      const dx = h[y * size + ((x + 1) % size)] - h[y * size + ((x + size - 1) % size)];
      const dy = h[((y + 1) % size) * size + x] - h[((y + size - 1) * size + x) % (size * size)];
      const inv = 1 / Math.hypot(dx * strength, dy * strength, 1), rgb = colorFn(hh, u, v);
      c[i * 4] = rgb[0] * 255; c[i * 4 + 1] = rgb[1] * 255; c[i * 4 + 2] = rgb[2] * 255; c[i * 4 + 3] = 255;
      n[i * 4] = (-dx * strength * inv * .5 + .5) * 255;
      n[i * 4 + 1] = (-dy * strength * inv * .5 + .5) * 255;
      n[i * 4 + 2] = (inv * .5 + .5) * 255; n[i * 4 + 3] = 255;
    }
    const mk = (arr, srgb) => {
      const t = new THREE.DataTexture(arr, size, size, THREE.RGBAFormat);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
    };
    return { map: mk(c, true), normalMap: mk(n, false) };
  }

  // 云影场：抖动网格上的破碎积云，r=1 表示全日照；云沿风向拉长，边缘带噪声。
  function bakeCloudShadow() {
    const N = 256, P = 380, rnd = U.rng(20261119);
    const px = new Uint8Array(N * N * 4);
    const vn = (u, v, f) => U.fbm2(u * f, v * f, 3);
    const blobs = [];
    for (let cj = 0; cj < 7; cj++) for (let ci = 0; ci < 7; ci++) {
      if (rnd() < .14) continue;
      blobs.push({ u: (ci + .5 + (rnd() - .5) * .62) / 7, v: (cj + .5 + (rnd() - .5) * .62) / 7,
        r: (.028 + rnd() * .035), e: 1.0 + rnd() * .5 });
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = (i + .5) / N, v = (j + .5) / N;
      let m = -1;
      for (const q of blobs) {
        let du = u - q.u, dv = v - q.v; du -= Math.round(du); dv -= Math.round(dv);
        const d = Math.hypot(du / q.e, dv) / q.r;
        if (d < 1) m = Math.max(m, (1 - d));
      }
      // 多频强破碎：圆形 blob 被揉成不规则云絮，避免投出整齐的圆斑
      const rag = (vn(u, v, 14) - .5) * .26 + (vn(u, v, 33) - .5) * .15 + (vn(u, v, 71) - .5) * .07;
      const edge = m + rag;
      const lit = 1 - U.sm(-.10, .22, edge) * .72;       // 云影变浅、边缘柔和
      const beam = U.sm(-.30, -.02, edge) * (1 - U.sm(.06, .26, edge)) * U.sm(.55, .72, vn(u, v, 29));
      const k = (j * N + i) * 4;
      px[k] = lit * 255; px[k + 1] = U.clamp(vn(u, v, 9)) * 255; px[k + 2] = beam * 255; px[k + 3] = 255;
    }
    const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false; t.needsUpdate = true; return t;
  }

  // 水面焦散图：不再拿规则 Voronoi 网格直接当光网（那会在海床铺出蜂窝瓷砖）。
  // 先对采样坐标做周期性域扭曲（整数频率 sin/cos，u/v 跨 1 时相位归零→平铺无缝），
  // 再取扭曲后 Voronoi 的 F2-F1 脊线，得到弯曲、粗细不均、局部断续的折射光丝。
  function bakeCaustic() {
    const N = 256, rnd = U.rng(31337);
    const px = new Uint8Array(N * N * 4);
    // 抖动网格：返回在 cell 空间求 F2-F1 的闭包
    const makeVor = g => {
      const ox = new Float32Array(g * g), oy = new Float32Array(g * g);
      for (let k = 0; k < g * g; k++) { ox[k] = rnd() * .72; oy[k] = rnd() * .72; }
      return (x, y) => {
        const i0 = Math.floor(x), j0 = Math.floor(y);
        let f1 = 9, f2 = 9;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const gx = i0 + di, gy = j0 + dj;
          const ci = (gx % g + g) % g, cj = (gy % g + g) % g, k = cj * g + ci;
          const dx = gx + .14 + ox[k] - x, dy = gy + .14 + oy[k] - y, d = dx * dx + dy * dy;
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
        }
        return Math.sqrt(f2) - Math.sqrt(f1);
      };
    };
    const vorMain = makeVor(9), vorFine = makeVor(17);
    const ph = Array.from({ length: 16 }, () => rnd() * U.TAU);
    const warp = (u, v) => {
      let wx = 0, wy = 0;
      const L = [[1, 2, .52], [2, 1, .40], [3, 3, .18], [4, 2, .09]];
      for (let i = 0; i < L.length; i++) {
        const fx = L[i][0], fy = L[i][1], a = L[i][2], p = ph[i * 2], q = ph[i * 2 + 1];
        wx += a * Math.sin(U.TAU * fx * u + p) * Math.cos(U.TAU * fy * v + q);
        wy += a * Math.cos(U.TAU * fy * u + q) * Math.sin(U.TAU * fx * v + p);
      }
      return [wx, wy];
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      const wv = warp(u, v), wx = wv[0], wy = wv[1];
      // 主网沿扭曲场揉成弯曲光丝；细网用反向扭曲 + 更密网格，两层不同向
      const d1 = vorMain((u + wx * .11) * 9, (v + wy * .11) * 9);
      const d2 = vorFine((u - wy * .07) * 17, (v + wx * .07) * 17);
      // 收窄阈值：F2-F1 越小越亮，得到细而锐的折射亮丝而非宽瓷砖缝
      const main = Math.pow(U.clamp(1 - d1 * 2.1, 0, 1), 1.9);
      const fine = Math.pow(U.clamp(1 - d2 * 2.7, 0, 1), 2.5);
      // 大尺度调制：焦散成片出现、带暗区断带，避免均匀铺满整片海床（基底抬到 .38 免得太稀）
      const mod = U.clamp(.38 + .74 * (.5 + .5 * Math.sin(U.TAU * 2 * u + ph[0]) * Math.cos(U.TAU * 3 * v + ph[1])), 0, 1);
      const k = (j * N + i) * 4;
      px[k] = main * 255 * mod; px[k + 1] = fine * 255 * mod; px[k + 2] = 0; px[k + 3] = 255;
    }
    const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.needsUpdate = true; return t;
  }

  let T = null;
  function textures() {
    if (T) return T;
    const rock = bakeSurface(512,
      (u, v) => U.clamp(U.ridged(u * 7, v * 7, 1.3, 5) * .78 + U.fbm2(u * 23, v * 23, 3) * .3),
      (h) => { const g = .16 + h * .36; return [g * 1.08 + .06, g * 1.04 + .05, g * .96 + .05]; }, 5);
    const scale = bakeSurface(512,
      (u, v) => {
        const a = Math.abs(Math.sin(u * Math.PI * 34)), b = Math.abs(Math.sin(v * Math.PI * 22));
        return U.clamp(a * b * .65 + U.fbm2(u * 30, v * 30, 3) * .35);
      },
      (h, u, v) => { const p = .10 + h * .28; return [p * .72, p * 1.12, p * 1.32]; }, 3.5);
    const feather = bakeSurface(256,
      (u, v) => {
        const s = Math.abs(u - .5) * 2, t = Math.abs(v - .5) * 2;
        return U.clamp((1 - Math.pow(s, 1.7) - t * t * .45) * 1.5) * (.72 + .28 * Math.sin(u * 190 + v * 22));
      },
      (h) => [.36 + h * .42, .43 + h * .42, .50 + h * .4], 1.5);
    const cloud = bakeSurface(512,
      (u, v) => U.clamp(U.fbm2(u * 5 + U.noise2(v * 3, 1) * .4, v * 5, 6) * 1.35 - .28),
      (h) => [h, U.clamp(h + U.fbm2(h * 3, .5, 3) * .3 - .35), U.clamp(1 - Math.abs(h - .5) * 2)], 1);
    const wa = new Uint8Array(512 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 512; x++) {
      const u = x / 512, v = y / 128, edge = .70 + .16 * Math.sin(u * U.TAU * 8);
      const a = U.clamp((edge - v) * 22);
      const k = (y * 512 + x) * 4, barb = .9 + .1 * Math.sin(u * U.TAU * 8 * 13 + v * 6);
      wa[k] = wa[k + 1] = wa[k + 2] = 235 * barb; wa[k + 3] = a * 255;
    }
    const wingAlpha = new THREE.DataTexture(wa, 512, 128, THREE.RGBAFormat);
    wingAlpha.colorSpace = THREE.SRGBColorSpace; wingAlpha.wrapS = THREE.RepeatWrapping; wingAlpha.wrapT = THREE.ClampToEdgeWrapping;
    wingAlpha.minFilter = THREE.LinearMipmapLinearFilter; wingAlpha.magFilter = THREE.LinearFilter; wingAlpha.generateMipmaps = true; wingAlpha.needsUpdate = true;
    L.clT.value = bakeCloudShadow();
    L.cauT.value = bakeCaustic();
    T = { rock, scale, feather, cloud, wingAlpha };
    return T;
  }

  // 云影场每帧状态：漂移、云量、风暴前缘与深度、暮线、闪光、色调
  function applyLight(t) {
    const vx = -5.6, vz = 2.2, P = 380;
    L.clA.value.set(-vx * t / P, -vz * t / P, .78, U.sm(0, 86, t));
    const stormFront = -60 + 34 * (t - 26);
    L.clB.value.set(stormFront, L.uStorm.value * .9, 84, U.sm(74, 78, t));
    const d = L.uDusk.value;
    L.clC.value.set(-d * .34, -d * .46, -d * .62, L.uFlash.value);
  }

  function spriteTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.2, 'rgba(210,235,255,.65)');
    gr.addColorStop(.55, 'rgba(120,180,235,.15)'); gr.addColorStop(1, 'rgba(90,150,220,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  let spriteMap = null;
  function sprite(color, size, opacity = 1) {
    if (!spriteMap) spriteMap = spriteTex();
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteMap, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity }));
    s.scale.set(size, size, 1); return s;
  }

  // ==========================================================================
  // 后期：MSAA 半浮点场景 → AO → 4 级泛光 → 体积光遮罩 → 完整 ACES → 分级
  // 移植自 crimson-loong 80_post.js
  // ==========================================================================
  function initPost(R) {
    const hf = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const sceneRT = new THREE.WebGLRenderTarget(2, 2, { ...hf, depthBuffer: true, samples: 4 });
    const fxRT = new THREE.WebGLRenderTarget(2, 2, { ...hf, depthBuffer: false });
    const godRT = new THREE.WebGLRenderTarget(2, 2, { ...hf, depthBuffer: false });
    const godRT2 = new THREE.WebGLRenderTarget(2, 2, { ...hf, depthBuffer: false });
    const blooms = [];
    let W = 2, H = 2;
    const quad = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const VS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';
    const mk = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    const CU = { tC: { value: null }, tB: { value: null }, tG: { value: null }, uBloom: { value: .085 }, uGod: { value: .5 },
      uExp: { value: 1 }, uFade: { value: 1 }, uTime: L.uTime, uRes: { value: new THREE.Vector2() }, uFlash: { value: 0 }, uDusk: { value: 0 } };

    const mCopy = mk(`uniform sampler2D tC; varying vec2 vUv; void main(){ gl_FragColor=vec4(texture2D(tC,vUv).rgb,1.); }`, { tC: CU.tC });
    const mGodMask = mk(`uniform sampler2D tC; uniform vec2 uSun; uniform float uAsp; varying vec2 vUv;
      void main(){ vec3 c=texture2D(tC,vUv).rgb; float l=dot(c,vec3(.3,.5,.2));
        vec2 q=(vUv-uSun)*vec2(uAsp,1.); float near=exp(-dot(q,q)*1.8);
        gl_FragColor=vec4(max(c-vec3(.62),0.)*near*smoothstep(.7,2.3,l),1.); }`,
      { tC: CU.tC, uSun: { value: new THREE.Vector2() }, uAsp: { value: 1 } });
    const mGodBlur = mk(`uniform sampler2D tC; uniform vec2 uSun,uDir; varying vec2 vUv;
      void main(){ vec2 dir=uDir; vec3 s=vec3(0.); float w=0.;
        for(int i=0;i<10;i++){ float f=(float(i)+.5)/10.; vec2 u=vUv+dir*f; float inb=step(0.,u.x)*step(u.x,1.)*step(0.,u.y)*step(u.y,1.);
          float ww=1.-f*.4; s+=texture2D(tC,u).rgb*ww*inb; w+=ww; }
        gl_FragColor=vec4(s/max(w,1e-3),1.); }`, { tC: CU.tC, uDir: { value: new THREE.Vector2() }, uSun: mGodMask.uniforms.uSun });

    const mDown0 = mk(`uniform sampler2D tC; uniform vec2 uT; varying vec2 vUv;
      void main(){ vec3 a=texture2D(tC,vUv+vec2(-1,1)*uT).rgb,b=texture2D(tC,vUv+vec2(1,1)*uT).rgb,c=texture2D(tC,vUv+vec2(-1,-1)*uT).rgb,d=texture2D(tC,vUv+vec2(1,-1)*uT).rgb;
        float wa=1./(1.+max(a.r,max(a.g,a.b))),wb=1./(1.+max(b.r,max(b.g,b.b))),wc=1./(1.+max(c.r,max(c.g,c.b))),wd=1./(1.+max(d.r,max(d.g,d.b)));
        gl_FragColor=vec4(max((a*wa+b*wb+c*wc+d*wd)/(wa+wb+wc+wd),vec3(0.)),1.); }`, { tC: CU.tC, uT: { value: new THREE.Vector2() } });
    const mDown = mk(`uniform sampler2D tC; uniform vec2 uT; varying vec2 vUv;
      vec3 S(vec2 o){ return texture2D(tC,vUv+o*uT).rgb; }
      float kw(vec3 c){ return 1./(1.+max(c.r,max(c.g,c.b))); }
      void main(){ vec3 a=S(vec2(-2,2)),b=S(vec2(0,2)),c=S(vec2(2,2)),d=S(vec2(-2,0)),e=S(vec2(0,0)),f=S(vec2(2,0)),g=S(vec2(-2,-2)),h=S(vec2(0,-2)),i=S(vec2(2,-2));
        vec3 j=S(vec2(-1,1)),k=S(vec2(1,1)),l=S(vec2(-1,-1)),m=S(vec2(1,-1));
        vec3 g0=(j+k+l+m)*.25,g1=(a+b+d+e)*.25,g2=(b+c+e+f)*.25,g3=(d+e+g+h)*.25,g4=(e+f+h+i)*.25;
        float w0=kw(g0)*.5,w1=kw(g1)*.125,w2=kw(g2)*.125,w3=kw(g3)*.125,w4=kw(g4)*.125;
        gl_FragColor=vec4(max((g0*w0+g1*w1+g2*w2+g3*w3+g4*w4)/(w0+w1+w2+w3+w4),vec3(0.)),1.); }`, { tC: CU.tC, uT: { value: new THREE.Vector2() } });
    const mUp = mk(`uniform sampler2D tC,tB; uniform vec2 uT; uniform float uMix; varying vec2 vUv;
      void main(){ vec3 s=vec3(0.);
        s+=texture2D(tC,vUv+vec2(-1,1)*uT).rgb+texture2D(tC,vUv+vec2(1,1)*uT).rgb+texture2D(tC,vUv+vec2(-1,-1)*uT).rgb+texture2D(tC,vUv+vec2(1,-1)*uT).rgb;
        s+=2.*(texture2D(tC,vUv+vec2(0,1)*uT).rgb+texture2D(tC,vUv+vec2(0,-1)*uT).rgb+texture2D(tC,vUv+vec2(1,0)*uT).rgb+texture2D(tC,vUv+vec2(-1,0)*uT).rgb);
        s+=4.*texture2D(tC,vUv).rgb; s/=16.;
        gl_FragColor=vec4(mix(texture2D(tB,vUv).rgb,s,uMix),1.); }`, { tC: CU.tC, tB: CU.tB, uT: { value: new THREE.Vector2() }, uMix: { value: .62 } });

    // 完整 ACES（RRT + ODT）+ 暗角 + 色差 + 分离色调 + S 曲线 + 颗粒
    const mFinal = mk(`uniform sampler2D tC,tB,tG; uniform float uBloom,uGod,uExp,uFade,uTime,uFlash,uDusk; uniform vec2 uRes; varying vec2 vUv;
      float hs(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      vec3 RRTAndODTFit(vec3 v){ vec3 a=v*(v+.0245786)-.000090537; vec3 b=v*(.983729*v+.432951)+.238081; return a/b; }
      vec3 aces(vec3 c){ const mat3 I=mat3(vec3(.59719,.07600,.02840),vec3(.35458,.90834,.13383),vec3(.04823,.01566,.83777));
        const mat3 O=mat3(vec3(1.60475,-.10208,-.00327),vec3(-.53108,1.10813,-.07276),vec3(-.07367,-.00605,1.07602));
        c=I*(c/.6); c=RRTAndODTFit(c); return clamp(O*c,0.,1.); }
      void main(){ vec2 uv=vUv,q=uv-.5; float r2=dot(q,q);
        vec2 ca=q*r2*(.004+uFlash*.006);
        vec3 c=vec3(texture2D(tC,uv-ca).r,texture2D(tC,uv).g,texture2D(tC,uv+ca).b);
        vec3 b=texture2D(tB,uv).rgb,g=texture2D(tG,uv).rgb;
        c=max(mix(c,b,uBloom)+g*uGod*vec3(1.,.72,.46)+b*uFlash*.25,0.);
        c*=uExp*(1.-.42*smoothstep(.10,.75,r2*1.25));
        c+=uFlash*vec3(.05,.09,.15);
        c=aces(c);
        float l=dot(c,vec3(.2126,.7152,.0722));
        c=mix(vec3(l),c,1.06);
        c+=vec3(-.002,.003,.012)*(1.-l)+vec3(.014,.006,-.010)*l;
        c=mix(c,c*c*(3.-2.*c),.44);
        c=pow(max(c,0.),vec3(1./2.2));
        c+=(hs(gl_FragCoord.xy+fract(uTime)*91.7)-.5)*.016;
        gl_FragColor=vec4(c*uFade,1.); }`, CU);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mCopy); mesh.frustumCulled = false; quad.add(mesh);
    const run = (mat, target) => { mesh.material = mat; R.setRenderTarget(target); R.render(quad, cam); };
    function size(w, h) {
      W = Math.max(2, w); H = Math.max(2, h);
      sceneRT.setSize(W, H); fxRT.setSize(W, H);
      godRT.setSize(Math.max(2, W >> 2), Math.max(2, H >> 2)); godRT2.setSize(Math.max(2, W >> 2), Math.max(2, H >> 2));
      CU.uRes.value.set(W, H);
      blooms.length = 0; let bw = Math.max(2, W >> 1), bh = Math.max(2, H >> 1);
      for (let i = 0; i < 4 && bw > 8 && bh > 8; i++) {
        blooms.push([new THREE.WebGLRenderTarget(bw, bh, hf), new THREE.WebGLRenderTarget(bw, bh, hf)]);
        bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
      }
    }
    const sunV = new V3(), fwd = new V3();
    function render(scene, camera, p) {
      R.setRenderTarget(sceneRT); R.clear(); R.render(scene, camera);
      mCopy.uniforms.tC.value = sceneRT.texture; run(mCopy, fxRT);

      // 体积光遮罩（太阳在画面内时）
      sunV.copy(camera.position).addScaledVector(SUN, 1000).project(camera);
      fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const facing = fwd.dot(SUN), sx = sunV.x * .5 + .5, sy = sunV.y * .5 + .5;
      const god = facing > .1 ? 1 : 0;
      if (god) {
        mGodMask.uniforms.tC.value = fxRT.texture; mGodMask.uniforms.uSun.value.set(sx, sy); mGodMask.uniforms.uAsp.value = W / H;
        run(mGodMask, godRT);
        mGodBlur.uniforms.tC.value = godRT.texture; mGodBlur.uniforms.uDir.value.set((sx - .5) * .28 / W * H * 4, (sy - .5) * .28 * 4);
        run(mGodBlur, godRT2); CU.tG.value = godRT2.texture;
      } else {
        // 必须给 tG 绑定一张确定为空的纹理：传 null 时采样结果未定义，
        // 会偶发读回旧 framebuffer 内容，在天空上表现为硬边的矩形色块。
        R.setRenderTarget(godRT2); R.clear(); CU.tG.value = godRT2.texture;
      }

      // 泛光链
      let src = fxRT.texture, sw = W, sh = H;
      for (let i = 0; i < blooms.length; i++) {
        const t = blooms[i][0], m = i === 0 ? mDown0 : mDown;
        m.uniforms.tC.value = src; m.uniforms.uT.value.set(1 / sw, 1 / sh); run(m, t);
        src = t.texture; sw = t.width; sh = t.height;
      }
      let up = blooms[blooms.length - 1][0];
      for (let i = blooms.length - 2; i >= 0; i--) {
        const t = blooms[i][1]; mUp.uniforms.tC.value = up.texture; mUp.uniforms.tB.value = blooms[i][0].texture;
        mUp.uniforms.uT.value.set(1 / up.width, 1 / up.height); run(mUp, t); up = t;
      }
      CU.tC.value = fxRT.texture; CU.tB.value = up.texture;
      CU.uBloom.value = p.bloom; CU.uGod.value = god * .6; CU.uExp.value = p.exposure;
      CU.uFlash.value = p.flash; CU.uDusk.value = L.uDusk.value; CU.uFade.value = p.fade;
      run(mFinal, null);
    }
    return { size, render, sceneRT };
  }

  return { L, SUN, GLSL_NOISE, GLSL_SKY, LIGHT, mat, bakeSurface, textures, applyLight, sprite, initPost };
})();
