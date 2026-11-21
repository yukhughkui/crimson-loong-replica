'use strict';
// 天、海、礁、雨。海面用镜像相机反射，云用烘焙密度图，远礁用 SDF 射线步进。
const World = (() => {
  const V3 = THREE.Vector3;

  // ---- 天穹 ----
  const skyU = { uCloud: { value: null } };
  let sky;
  function buildSky(scene) {
    skyU.uCloud.value = Gfx.textures().cloud.map;
    // 天空顶点着色器自己声明 GLSL_SKY（解析天空函数），片元里按 uDusk 在白昼/黄昏间过渡。
    sky = Gfx.mat(skyU,
      `varying vec3 vD; void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      `${Gfx.GLSL_SKY}
      varying vec3 vD; uniform sampler2D uCloud;
      // 远礁剪影：按方位角生成的喀斯特塔峰，底部始终接地。
      // 之前用 SDF 圆柱体做远礁，在海平面附近被裁成一条条漂浮的蓝色长方体，极其廉价。
      float karstRow(float az,float seed,float base,float amp){
        float s=0.;
        for(int i=0;i<9;i++){
          float f=float(i);
          float c=-3.14159+(f+.27*sin(f*2.1+seed))*6.28318/9.;
          float da=abs(atan(sin(az-c),cos(az-c)));
          float w=.052+.032*abs(sin(f*1.7+seed));
          float ht=base+amp*pow(abs(sin(f*2.9+seed*1.3)),1.6);
          s=max(s,ht*exp(-pow(da/w,2.)));
        }
        return s*(.90+.10*sin(az*37.+seed));
      }
      void main(){
        vec3 d=normalize(vD); float h=d.y;
        // 解析天空：白昼与黄昏两套，按 uDusk 平滑过渡（HDR 值，可能 > 1）
        vec3 col=mix(skyDay(d),skyBase(d,1.),smoothstep(.10,.72,uDusk));
        float sd=max(dot(d,normalize(uSunDir)),0.);
        // 两层积云：底层厚而暗、顶层被日光照亮，带受光面与银边
        vec2 cuv=d.xz/max(h+.10,.05);
        vec4 a=texture2D(uCloud,cuv*.13+vec2(uTime*.0022,uTime*.0007));
        vec4 b=texture2D(uCloud,cuv*.27+vec2(.31+uTime*.0033,uTime*.0014));
        vec4 e=texture2D(uCloud,cuv*.55-vec2(uTime*.0041,-uTime*.0009));
        float dens=smoothstep(.36,.63,a.r*.80+b.r*.52+e.r*.28);
        // 云的受光：朝太阳方向 + 顶部更亮；银边取云密度梯度
        float lit=clamp(.30+ .70*pow(sd,1.5) + a.g*.25,0.,1.);
        vec3 cc=mix(vec3(.13,.19,.28),vec3(.86,.90,.95),lit);
        cc=mix(cc,vec3(1.05,.62,.40),uDusk*.70*(1.-lit*.6));
        float rim=smoothstep(.30,.52,dens)*(1.-smoothstep(.52,.72,dens))*pow(sd,3.);
        cc+=vec3(1.6,.95,.55)*rim*.55;
        float mask=smoothstep(-.02,.20,h)*(1.-smoothstep(.78,.99,h));
        col=mix(col,cc,dens*mask*.94);
        // 风暴云墙：低空、有翻滚噪声、吞掉阳光
        float sw=dot(d,normalize(vec3(-.35,.30,-.89)));
        float storm=pow(max(sw,0.),7.)*uStorm;
        vec3 stormCol=vec3(.095,.135,.20)+vec3(.16,.19,.24)*b.g;
        col=mix(col,stormCol,storm*.94);
        col+=vec3(.55,.7,1.)*pow(max(sw,0.),160.)*uFlash*1.6;
        // 远礁：两排接地塔峰，远排低淡、近排高深，按距离做大气透视。
        {
          float az=atan(d.z,d.x);
          float rFar=karstRow(az,1.7,.030,.040);
          float rNear=karstRow(az,5.3,.046,.062);
          float farM=(1.-smoothstep(rFar-.007,rFar+.009,h))*smoothstep(-.006,.008,h);
          float nearM=(1.-smoothstep(rNear-.007,rNear+.010,h))*smoothstep(-.006,.008,h);
          float heightFade=1.-smoothstep(.020,.095,h);
          vec3 farCol=mix(vec3(.36,.47,.57),vec3(.62,.48,.44),uDusk*.7)*(.86+.14*a.g);
          vec3 nearCol=mix(vec3(.12,.19,.24),vec3(.30,.27,.29),uDusk*.8)*(.80+.20*a.g);
          col=mix(col,farCol,farM*.42*heightFade*(1.-uUnder*.8));
          col=mix(col,nearCol,nearM*.72*heightFade*(1.-uUnder*.9));
        }
        if(h<-.02){ col=mix(vec3(.03,.06,.09),col,smoothstep(-.18,-.02,h)); }
        // 水下抬头看到的是被水面折射/散射后的幽光，不是天空本身。
        // 旧版水下仍渲染亮天空，海面平面远端边界之外露出一条亮白地平线——一眼假的"天花板缝"。
        // 让地平线(h≈0)处与海面透光天花板同色，越往下越暗、越往上渐入深水散射色，抹平硬边。
        if(uUnder>.001){
          float hh=clamp(h,-.25,.9);
          // seam 必须贴近海面底面的颜色(mix(.055,.20,.30,.30,.60,.72,≈.38)≈.15,.35,.46)，
          // 否则海面远端边缘之外露出的天空球会比天花板亮，切出一条假地平线。
          vec3 seam=vec3(.15,.35,.46);
          vec3 underAir=hh<0.
            ? mix(seam,vec3(.03,.12,.20),1.-smoothstep(-.25,0.,hh))
            : mix(seam,vec3(.11,.28,.38),smoothstep(0.,.9,hh));
          col=mix(col,underAir,uUnder*.985);
        }
        gl_FragColor=vec4(col,1.);
      }`,
      { side: THREE.BackSide, depthWrite: false, fog: false });
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 28), sky);
    skyMesh.frustumCulled = false; sky = skyMesh; scene.add(sky);
  }

  // ---- 海面：多尺度 Gerstner 波 + 双层流动细节法线 + 深浅水色 + 镜像反射 ----
  const seaU = { tReflect: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uNormal: { value: null } };
  let sea;
  function buildSea(scene) {
    const g = new THREE.PlaneGeometry(2600, 2600, 220, 220); g.rotateX(-Math.PI / 2);
    // 用各向同性的岩石碎纹法线，不用鱼鳞法线（那会在海面铺出规则网格反光）
    seaU.uNormal.value = Gfx.textures().rock.normalMap;
    // GLSL：4 组不同方向/频率/速度的行波，兼顾大涌与细浪；返回高度，供顶点位移与法线差分。
    const WAVE = `
      vec3 wv(vec2 p){
        vec3 h=vec3(0.);
        h+=vec3(sin(p.x*.055+p.y*.031+uTime*.70),cos(p.x*.055+p.y*.031+uTime*.70),0.)*.86;
        h+=vec3(sin(-p.x*.083+p.y*.061+uTime*.93),cos(-p.x*.083+p.y*.061+uTime*.93),0.)*.55;
        h+=vec3(sin(p.x*.149-p.y*.107+uTime*1.31),cos(p.x*.149-p.y*.107+uTime*1.31),0.)*.28;
        h+=vec3(sin(p.x*.27+p.y*.22-uTime*1.9),cos(p.x*.27+p.y*.22-uTime*1.9),0.)*.12;
        return h;
      }
      float wh(vec2 p){return wv(p).x;}
    `;
    const m = Gfx.mat(seaU,
      `uniform float uTime; varying vec3 vW,vN; varying vec2 vUv; varying float vH; varying float vCrest;
      ${WAVE}
      void main(){vUv=uv;vec3 q=position;vec3 w=wv(q.xz);q.y+=w.x;vH=w.x;
        // crest：波峰的二阶曲率，用于浪尖泡沫
        float e=2.2;
        float dx=(wh(q.xz+vec2(e,0.))-2.*wh(q.xz)+wh(q.xz-vec2(e,0.)))/(e*e);
        float dz=(wh(q.xz+vec2(0.,e))-2.*wh(q.xz)+wh(q.xz-vec2(0.,e)))/(e*e);
        vCrest=max(0.,-(dx+dz))*40.;
        float ddx=(wh(q.xz+vec2(e,0.))-wh(q.xz-vec2(e,0.)))/(2.*e);
        float ddz=(wh(q.xz+vec2(0.,e))-wh(q.xz-vec2(0.,e)))/(2.*e);
        vN=normalize(vec3(-ddx,1.,-ddz));vec4 wp=modelMatrix*vec4(q,1.);vW=wp.xyz;
        gl_Position=projectionMatrix*viewMatrix*wp;}`,
      `uniform sampler2D tReflect,uNormal;uniform vec2 uRes;
       varying vec3 vW,vN;varying vec2 vUv;varying float vH,vCrest;
      void main(){
        // 双层细节法线：不同尺度、不同流向，破除单一正弦的塑料感
        // 细节法线按世界坐标采样，避免 UV 平铺的网格感；远处衰减
        float detDist=1.-smoothstep(120.,700.,length(vW-cameraPosition));
        vec2 np=vW.xz*.06;
        vec3 n1=texture2D(uNormal,np+vec2(uTime*.008,-uTime*.011)).rgb;
        vec3 n2=texture2D(uNormal,np*2.3-vec2(uTime*.013,uTime*.006)).rgb;
        vec3 det=vec3((n1.r-.5)+(n2.r-.5)*.5,0.,(n1.g-.5)+(n2.g-.5)*.5)*.5*detDist;
        vec3 N=normalize(vN+det);
        vec3 V=normalize(cameraPosition-vW);
        float ndv=max(dot(N,V),0.);
        float fres=pow(1.-ndv,5.); fres=.03+.97*fres;
        // 反射扰动随波法线走，远处扰动收敛
        float dist=length(vW-cameraPosition);
        vec2 suv=gl_FragCoord.xy/uRes+N.xz*(.030+.012*sin(uTime*.6));
        vec3 refl=texture2D(tReflect,clamp(suv,vec2(.002),vec2(.998))).rgb;
        // 深浅水色：视线越掠射越显深青，垂直看透出浅青底
        vec3 shallow=vec3(.035,.16,.19), deep=vec3(.006,.045,.072);
        vec3 water=mix(shallow,deep,pow(1.-ndv,1.4));
        water=mix(water,vec3(.10,.19,.20),clamp(vH*.22+.5,0.,1.)*.25);
        vec3 col=clLight(N,vW,water,0.);
        col=mix(col,refl,fres*.92*(1.-uUnder));
        // 水下时水面不再当镜子（否则会映出第二条鲲），而是柔和的透光天花板。
        // 焦散用两组错频光丝相乘再提锐，避免单频 sin*sin 铺出规则棋盘格。
        float cc1=sin(vW.x*.011+uTime*.31+sin(vW.z*.006)*2.)*sin(vW.z*.009-uTime*.23+sin(vW.x*.007)*2.);
        float cc2=sin(vW.x*.019-vW.z*.014+uTime*.19)*sin(vW.z*.021+vW.x*.008-uTime*.15);
        float causticCeil=clamp(.5+.34*cc1+.16*cc2,0.,1.);
        causticCeil=pow(causticCeil,1.4);
        vec3 ceiling=mix(vec3(.055,.20,.30),vec3(.30,.60,.72),causticCeil)*(1.-uStorm*.45);
        col=mix(col,ceiling,uUnder*.92);
        // 浪尖泡沫与太阳耀斑只在水面上方成立；水下若保留，会在天花板边缘亮成一条假线。
        float foamMask=smoothstep(1.1,2.2,vCrest+n1.r*.30)*(1.-smoothstep(180.,600.,dist));
        col+=vec3(.62,.76,.82)*foamMask*(.20+.35*uStorm)*(1.-uUnder);
        float gl=pow(max(dot(reflect(-normalize(uSunDir),N),V),0.),90.);
        col+=vec3(1.,.86,.62)*gl*1.6*(1.-uStorm*.6)*(1.-uUnder);
        gl_FragColor=vec4(col,1.);}`,
      { side: THREE.DoubleSide });
    sea = new THREE.Mesh(g, m); sea.frustumCulled = false; scene.add(sea);
    // 海床：带沙脊法线的暗色平面，是水下焦散的主要承接面
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600, 1, 1),
      Gfx.mat({ uMap: { value: Gfx.textures().rock.map }, uNMap: { value: Gfx.textures().rock.normalMap } },
        `varying vec3 vW,vN;varying vec2 vUv;void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
        `uniform sampler2D uMap,uNMap;varying vec3 vW,vN;varying vec2 vUv;
         void main(){vec2 s=vW.xz*.035;vec3 n1=texture2D(uNMap,s).rgb,n2=texture2D(uNMap,s*2.7).rgb;
           vec3 N=normalize(vec3((n1.r-.5)+(n2.r-.5)*.5,1.,(n1.g-.5)+(n2.g-.5)*.5));
           float ripple=.5+.5*sin(vW.x*.35+sin(vW.z*.12)*3.)*sin(vW.z*.31);
           vec3 sand=mix(vec3(.055,.13,.15),vec3(.11,.22,.23),ripple*.5+texture2D(uMap,s).r*.4);
           vec3 col=clLight(N,vW,sand,0.);gl_FragColor=vec4(col,1.);}`));
    bed.rotation.x = -Math.PI / 2; bed.position.y = -26; bed.frustumCulled = false; scene.add(bed);
  }

  // ---- 礁岩与石阙：位移网格 + 烘焙细节 ----
  function buildRocks(scene) {
    const T = Gfx.textures();
    const matRock = Gfx.mat({ uMap: { value: T.rock.map }, uNMap: { value: T.rock.normalMap } },
      `varying vec3 vW,vN;varying vec2 vUv;void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `uniform sampler2D uMap,uNMap;varying vec3 vW,vN;varying vec2 vUv;
      void main(){vec3 t=texture2D(uMap,vUv*3.).rgb;vec3 nm=texture2D(uNMap,vUv*3.).rgb;
        vec3 N=normalize(vN+vec3(nm.r-.5,nm.g-.5,0.)*.55);
        vec3 col=clLight(N,vW,t,0.);gl_FragColor=vec4(col,1.);}`);
    const stone = Gfx.mat({ uMap: { value: T.rock.map }, uNMap: { value: T.rock.normalMap } },
      `varying vec3 vW,vN;varying vec2 vUv;void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `uniform sampler2D uMap,uNMap;varying vec3 vW,vN;varying vec2 vUv;
      void main(){vec3 t=texture2D(uMap,vUv*2.).rgb*.85+vec3(.05,.03,.02);
        vec3 nm=texture2D(uNMap,vUv*2.).rgb;vec3 N=normalize(vN+vec3(nm.r-.5,nm.g-.5,0.)*.4);
        gl_FragColor=vec4(clLight(N,vW,t,0.),1.);}`);
    function stack(x, z, h, r, seed) {
      const seg = 26, rows = 48, pos = [], uvs = [], idx = [];
      for (let j = 0; j <= rows; j++) {
        const v = j / rows, y = -4 + v * h;
        // 喀斯特峰林：底部肥厚，中段收腰，顶部再度外扩并给出参差的圆钝轮廓（不是尖锥）
        const waist = 1.02 - .28 * Math.sin(Math.PI * Math.pow(v, .82));
        // 顶部平滑收圆：外扩后缓慢收敛，不做骤缩，避免钩状尖角
        // 峰顶圆钝收尖：旧版顶部仍保留 87% 半径，露出水面后被截成平顶方块。
        const cap = 1 + .10 * U.sm(.55, .75, v) * (1 - U.sm(.80, .92, v)) - .88 * Math.pow(U.sm(.62, 1, v), 1.5);
        const taper = Math.max(.12, waist * cap);
        for (let i = 0; i <= seg; i++) {
          const a = i / seg * U.TAU;
          const erode = U.ridged(Math.cos(a) * 3 + seed, y * .045 + seed, v * 2, 5);
          // 横向层理 + 竖向溶蚀沟，随高度变化
          const strata = Math.sin(v * 46 + Math.sin(a * 3 + seed) * 1.4) * .045;
          const spike = Math.sin(v * 27 + a * 5 + seed) * .55 * (1 - U.sm(.78, .92, v));
          const rr = r * taper * (.80 + erode * .44 + strata) + spike;
          const lean = (Math.sin(v * 1.8 + seed) * 3.5 * v + Math.sin(seed * 2.1) * v * v * r * .12) * (1 - .5 * U.sm(.85, 1., v));
          pos.push(x + Math.cos(a) * rr + lean, y, z + Math.sin(a) * rr + Math.cos(seed) * v * v * r * .10);
          uvs.push(i / seg, v);
        }
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i; idx.push(a, a + 1, a + seg + 1, a + 1, a + seg + 2, a + seg + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, matRock); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    }
    // 这些远景实体礁石已停用：它们的柱状侧面在贴近水面的低视角下被海面截断，
    // 投影成地平线上一排平顶蓝色长方体（二分截图已确认）。地平线剪影现在完全
    // 由天空着色器里的 karstRow 提供，几何礁石只造成穿帮，不再生成。
    // 原参数表留作参考：
    // [[-70,-125,92,17,3],[82,-150,118,21,9],[-95,-150,105,20,3],[60,-185,135,25,15],
    //  [-185,-240,165,34,22],[190,-250,155,32,31],[-45,-330,120,28,38],[120,-340,140,30,45],
    //  [-260,-380,190,46,52],[280,-400,185,44,59]].forEach(s => stack(...s));
    // 海中的石阙
    gate = new THREE.Group(); gate.position.set(0, 0, -105);
    for (const x of [-16, 16]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(5, 46, 5), stone); p.position.set(x, 18, 0); gate.add(p);
      const b = new THREE.Mesh(new THREE.BoxGeometry(44, 4, 6), stone); b.position.set(0, 41, 0); gate.add(b);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(49, 2.4, 8), stone); cap.position.set(0, 44, 0); gate.add(cap);
    }
    gate.traverse(o => { if (o.isMesh) o.castShadow = true; });     scene.add(gate);
    // 原先这里有一圈 26 个悬空 BoxGeometry 平台；改成低矮礁盘后，从低角度
    // 看仍是一排浮在水面的蓝色椭圆块。地平线轮廓已由天空的 karstRow 提供，
    // 这里不再堆任何近水面的几何体，避免重复与穿帮。
  }

  // ---- 雨幕与雾气 ----
  let gate, rain, mist, rainU;
  function buildAir(scene) {
    const rnd = U.rng(1919), dummy = new THREE.Object3D();
    rainU = { uTime: { value: 0 }, uStorm: { value: 0 } };
    rain = new THREE.InstancedMesh(new THREE.PlaneGeometry(.035, 2.4),
      Gfx.mat(rainU, `uniform float uTime,uStorm;varying float vA;
        attribute vec3 inst; void main(){vec3 p=position;float y=mod(inst.y-uTime*(48.+inst.z*22.),160.);
        p.x+=inst.x;p.y+=y;p.z+=inst.z;vA=uStorm;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;}`,
        `varying float vA;void main(){gl_FragColor=vec4(vec3(.65,.78,.92),vA*.20);}`, { transparent: true, depthWrite: false, side: THREE.DoubleSide }), 1800);
    // 用 InstancedBufferAttribute 携带每滴雨的初始位置
    const arr = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) { arr[i * 3] = (rnd() - .5) * 420; arr[i * 3 + 1] = rnd() * 160; arr[i * 3 + 2] = (rnd() - .5) * 420 - 60; }
    rain.geometry.setAttribute('inst', new THREE.InstancedBufferAttribute(arr, 3));
    rain.frustumCulled = false; scene.add(rain);
    for (let i = 0; i < 70; i++) {
      const a = rnd() * U.TAU, r = 25 + rnd() * 160, s = 30 + rnd() * 65;
      const sp = Gfx.sprite(0xa9c4d8, s, .10);
      sp.position.set(Math.cos(a) * r, 1 + rnd() * 5, -40 + Math.sin(a) * r); scene.add(sp);
    }
  }

  // ---- 水下丁达尔光柱：阳光穿过起伏水面被散射成锥状光束 ----
  // 三层同心开口圆柱做 Additive 叠加，中心光程长、边缘软衰减；只在 uUnder>0 显现。
  let shafts;
  function buildShafts(scene) {
    const makeShaftMat = a => Gfx.mat({ uLayerA: { value: a } },
      `varying vec2 vUv;varying vec3 vW,vN;
       void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      `uniform float uLayerA;varying vec2 vUv;varying vec3 vW,vN;
       void main(){
         float fade=smoothstep(0.,.30,vUv.y)*(1.-smoothstep(.86,1.,vUv.y));
         vec3 V=normalize(cameraPosition-vW);
         // 正对相机的柱面视线穿过整个光锥，光程最长；侧面掠过则暗
         float core=pow(abs(dot(normalize(vN),V)),1.7);
         float n=gfbm3(vW*.052+vec3(uTime*.020,0.,uTime*.014));
         float flick=.68+.46*n;
         vec3 sunCol=mix(vec3(.34,.74,.94),vec3(1.0,.78,.48),uDusk*.85);
         float amt=fade*core*flick*uUnder*(.20+.12*n)*uLayerA;
         gl_FragColor=vec4(sunCol*amt,1.);
       }`, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    shafts = new THREE.Group();
    const rnd = U.rng(20261120);
    const layers = [[.9, 2.6, 1.0], [2.3, 5.6, .55], [4.6, 9.2, .30]].map(([rt, rb, a]) => ({ rt, rb, mat: makeShaftMat(a) }));
    for (let i = 0; i < 9; i++) {
      const h = 34 + rnd() * 12, tiltZ = (rnd() - .5) * .72, tiltX = (rnd() - .5) * .48;
      const px = (rnd() - .5) * 130, pz = (rnd() - .5) * 130, ry = rnd() * U.TAU;
      for (const layer of layers) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(layer.rt, layer.rb, h, 12, 1, true), layer.mat);
        m.position.set(px, -h * .5 + 1, pz);
        m.rotation.set(tiltX, ry, tiltZ);
        shafts.add(m);
      }
    }
    shafts.frustumCulled = false; scene.add(shafts);
  }

  function build(scene) { buildSky(scene); buildSea(scene); buildRocks(scene); buildAir(scene); buildShafts(scene); }
  function update(t, cam) {
    rainU.uTime.value = t; rainU.uStorm.value = Gfx.L.uStorm.value;
    // 水下时隐藏水面上的石阙（否则从水下看是悬空方块）
    // 石阙是开端意象；缠斗段相机贴海穿过 z≈-105，会穿进石柱内部，故 42s 后隐藏。
    if (gate) gate.visible = Gfx.L.uUnder.value < .25 && t < 42;
    // 光柱随相机平移，保证水下镜头里始终有穿透水面的光束
    if (shafts && cam) shafts.position.set(cam.position.x * .92, 0, cam.position.z * .92);
  }
  return { build, update, sky, get sea() { return sea; }, seaU };
})();
