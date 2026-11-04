/* ============================================================
   T4 3D 엔진 — TwinX.scene3d = { render, resize, snapshot, dispose }
   - 월드 1 unit = 1 m, 층(또는 적층 전체) bounds 중심 = 원점, x=동, z=남, y=위
   - 시안 A 돌하우스 / B 룸·랙 투시 / C 홀로그램 계통 / D 열화상·위험기둥
   - 정적(static) · 오버레이(overlay: 선택·장애·링크·접지·열화상) 2단 재빌드, GPU 자원 Bag 단위 dispose
   - Three.js r128 전역 THREE (애드온 없음: 궤도/워크/픽킹 직접 구현)
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.scene3d) return;
  var C = TX.C, U = TX.util;

  var FLOOR_H = 3.2, EYE = 1.6, BG = 0x070c18;
  var WALL_H = 1.3, WALL_TECH = 1.75, WALL_T = 0.12, TRAY_Y = 2.3, PARAPET_H = 1.0, SLAB_M = 1000, SLAB_T = 0.3;
  var TECH = { telecom: 1, server: 1, power: 1 };
  var CONCEPT_NAME = { A: '돌하우스', B: '룸·랙 투시', C: '홀로그램 계통', D: '열화상·위험기둥' };
  var GRADE_SCORE = { RED: 85, ORANGE: 65, YELLOW: 45, GREEN: 20, NONE: 10 };
  var CYAN = 0x22d3ee, FAULT = 0xff1744;

  var S = {
    host: null, wrap: null, canvas: null, labelsEl: null, miniWrap: null, miniEl: null, miniHead: null, hudEl: null, devRoot: null,
    renderer: null, scene: null, camera: null, lights: {}, gStatic: null, gOverlay: null, ray: null,
    bagS: null, bagO: null, texCache: {}, doorCache: {},
    anchors: [], picks: [], anim: { sp: [], op: [], sk: [], ok: [], spin: [] }, info: {}, roomInfo: {},
    org: { x: 0, y: 0 }, center: null, sceneR: 10, floorR: 10, focus: null, focusY: 0, concept: 'A', roomB: null, walkB: null,
    orbit: { theta: 0.62, phi: 0.9, r: 30, tgt: null, gT: null, gR: 30, gTheta: null, gPhi: null, minR: 2, maxR: 200 },
    walk: { x: 0, z: 0, yaw: 0, pitch: -0.06, keys: {}, init: false },
    need: { static: true, overlay: true, fit: true }, camDirty: true, raf: 0, last: 0, w: 0, h: 0,
    userZoom: false, prevLayers: null, pendingFly: null, frameMs: 0, builds: 0, ro: null, failed: false, hoverT: 0
  };

  /* ---------------- 기본 유틸 ---------------- */
  function M() { return TX.model; }
  function st() { return TX.state; }
  function hexOf(css) { return parseInt(String(css).replace('#', ''), 16) || 0; }
  function mixHex(a, b, t) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  function gradeOf(a) { return a && C.GRADE[a.grade] ? a.grade : 'NONE'; }
  function gHex(g) { return (C.GRADE[g] || C.GRADE.NONE).hex; }
  function roomStyle(t) { return C.ROOM[t] || C.ROOM.office; }
  function explode() { return U.clamp(+st().explode || 1.5, 1, 2.4); }
  function num(v) { return typeof v === 'number' ? v : U.num(v); }
  function floorsAll() { return (M() && M().floors) || []; }
  function roomsOf(code) { return TX.roomsOf(code); }
  function assetsOf(code) { return TX.assetsOf(code); }
  function linkMeta(t) { return C.LINK[t] || C.LINK.path; }
  function bounds(fl) {
    var b = fl && fl.bounds;
    if (b && isFinite(b.x0) && isFinite(b.x1) && b.x1 > b.x0 && b.y1 > b.y0) return b;
    var rs = fl ? roomsOf(fl.code) : [], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rs.forEach(function (r) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    if (!isFinite(x0)) (fl ? assetsOf(fl.code) : []).forEach(function (a) { if (a.x != null) { x0 = Math.min(x0, a.x - 2000); x1 = Math.max(x1, a.x + 2000); y0 = Math.min(y0, a.y - 2000); y1 = Math.max(y1, a.y + 2000); } });
    if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 20000, y1: 15000 };
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function unionBounds(fls) {
    var u = null;
    fls.forEach(function (f) { var b = bounds(f); u = u ? { x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) } : Object.assign({}, b); });
    return u || { x0: 0, y0: 0, x1: 20000, y1: 15000 };
  }
  function X(mm) { return (mm - S.org.x) / 1000; }
  function Z(mm) { return (mm - S.org.y) / 1000; }
  function floorY(code) {
    if (!st().stack || S.concept === 'B' || S.concept === 'C') return 0;
    var fs = floorsAll(), i = fs.findIndex(function (f) { return f.code === code; });
    var fi = fs.findIndex(function (f) { return S.focus && f.code === S.focus.code; });
    return ((fs.length - 1 - i) - (fs.length - 1 - fi)) * FLOOR_H * explode();
  }
  function heatOf(list) {
    var ms = (list || []).filter(function (m) { return m && m.std === 'heat' && num(m.value) != null; });
    if (!ms.length) return null;
    ms.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    var m = ms[0], v = num(m.value), unit = String(m.unit || ''), item = String(m.item || '');
    var dt = /Δ|차|delta|dt/i.test(unit + item) || v < 25;
    var sev = dt ? v / 15 : (v - 25) / 30;
    if (m.judge === 'bad') sev = Math.max(sev, 0.75);
    return { v: v, unit: unit || (dt ? 'K' : '℃'), sev: U.clamp(sev, 0, 1), date: m.date, judge: m.judge, n: ms.length };
  }
  function gndBad(list) { return (list || []).some(function (m) { return m && m.std === 'gnd' && m.judge === 'bad'; }); }
  function riskOf(a) {
    if (TX.analysis && typeof TX.analysis.risk === 'function') {
      try { var r = TX.analysis.risk(a); if (r && isFinite(r.total)) return { total: r.total, est: false }; } catch (e) { }
    }
    return { total: GRADE_SCORE[gradeOf(a)], est: true };
  }
  function faultInfo() {
    var f = st().fault || {};
    if (!f.active) return null;
    var src = f.source || (TX.fault && TX.fault.source) || null;
    var imp = TX.fault && TX.fault.impact instanceof Map ? TX.fault.impact : new Map();
    if (!imp.size && src && !TX.analysis) imp = localImpact(src);
    return src || imp.size ? { src: src, imp: imp } : null;
  }
  function localImpact(src) { // 분석 모듈(T5) 부재 시 표시용 간이 BFS
    var out = new Map(), q = [src], links = (M() && M().links) || [];
    while (q.length) {
      var cur = q.shift();
      links.forEach(function (l) { if (l.from === cur && l.to !== src && !out.has(l.to)) { out.set(l.to, { sev: 'outage', depth: 1 }); q.push(l.to); } });
    }
    return out;
  }
  function impSev(v) { return v && (v.sev || v.severity || v) === 'degraded' ? 'degraded' : 'outage'; }

  /* ---------------- GPU 자원 Bag (재빌드 단위 dispose) ---------------- */
  function Bag() { this.g = {}; this.m = {}; this.own = []; }
  Bag.prototype.geo = function (k, make) { return this.g[k] || (this.g[k] = make()); };
  Bag.prototype.mat = function (k, make) { return this.m[k] || (this.m[k] = make()); };
  Bag.prototype.keep = function (x) { this.own.push(x); return x; };
  Bag.prototype.box = function (w, h, d) { return this.geo('b' + w.toFixed(3) + ',' + h.toFixed(3) + ',' + d.toFixed(3), function () { return new THREE.BoxGeometry(w, h, d); }); };
  Bag.prototype.edges = function (w, h, d) { var me = this; return this.geo('e' + w.toFixed(3) + ',' + h.toFixed(3) + ',' + d.toFixed(3), function () { return new THREE.EdgesGeometry(me.box(w, h, d)); }); };
  Bag.prototype.dispose = function () {
    var k; for (k in this.g) this.g[k].dispose(); for (k in this.m) this.m[k].dispose();
    this.own.forEach(function (x) { if (x && x.dispose) x.dispose(); }); this.g = {}; this.m = {}; this.own = [];
  };
  function clearGroup(g, bag) {
    if (!g) return;
    var seen = new Set();
    g.traverse(function (o) {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (!seen.has(m)) { seen.add(m); m.dispose(); } });
    });
    while (g.children.length) g.remove(g.children[g.children.length - 1]);
    if (bag) bag.dispose();
  }
  function trn(m, op, dw) { if (op != null && op < 0.995) { m.transparent = true; m.opacity = op; m.depthWrite = dw != null ? dw : op > 0.55; } return m; }
  function mStd(bag, color, op, o) {
    return bag.mat('S' + color + '|' + (op == null ? 1 : op).toFixed(2) + (o ? JSON.stringify(o) : ''), function () {
      return trn(new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.55, metalness: 0.25 }, o || {})), op);
    });
  }
  function mBasic(bag, color, op, o) {
    return bag.mat('B' + color + '|' + (op == null ? 1 : op).toFixed(2) + (o ? JSON.stringify(o) : ''), function () {
      var m = new THREE.MeshBasicMaterial(Object.assign({ color: color }, o || {}));
      return trn(m, op, o && o.depthWrite != null ? o.depthWrite : undefined);
    });
  }
  function mLine(bag, color, op) {
    return bag.mat('L' + color + '|' + (op == null ? 1 : op).toFixed(2), function () { return trn(new THREE.LineBasicMaterial({ color: color }), op, false); });
  }
  function mesh(parent, geo, mat, x, y, z, shadow) {
    var m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (shadow) { m.castShadow = true; m.receiveShadow = true; }
    parent.add(m); return m;
  }
  function boxE(bag, parent, w, h, d, x, y, z, mat, edgeMat, shadow) {
    var m = mesh(parent, bag.box(w, h, d), mat, x, y, z, shadow);
    if (edgeMat) { var e = new THREE.LineSegments(bag.edges(w, h, d), edgeMat); e.position.set(x, y, z); parent.add(e); }
    return m;
  }
  function pulse(m, spd, amp, op, mode, overlay) { m.userData.pl = { spd: spd, amp: amp, op: op, mode: mode || 'flat' }; (overlay ? S.anim.op : S.anim.sp).push(m); return m; }
  function packet(m, d, overlay) { m.userData.pk = d; (overlay ? S.anim.ok : S.anim.sk).push(m); return m; }

  /* ---------------- 층 평면 캔버스 텍스처 (층별 캐시, 모델 변경 시 무효화) ---------------- */
  function doorsOf(fl) {
    if (S.doorCache[fl.code]) return S.doorCache[fl.code];
    var rooms = roomsOf(fl.code), corr = rooms.filter(function (r) { return r.type === 'corr'; }), out = {};
    rooms.forEach(function (r) {
      if (r.type === 'corr') return;
      var best = null;
      function ov(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0); }
      corr.forEach(function (c) {
        var cand = [];
        if (ov(r.x, r.x + r.w, c.x, c.x + c.w) > 600) {
          var at = (Math.max(r.x, c.x) + Math.min(r.x + r.w, c.x + c.w)) / 2;
          if (c.y >= r.y + r.h - 50) cand.push({ side: 'S', d: c.y - (r.y + r.h), at: at });
          if (c.y + c.h <= r.y + 50) cand.push({ side: 'N', d: r.y - (c.y + c.h), at: at });
        }
        if (ov(r.y, r.y + r.h, c.y, c.y + c.h) > 600) {
          var at2 = (Math.max(r.y, c.y) + Math.min(r.y + r.h, c.y + c.h)) / 2;
          if (c.x >= r.x + r.w - 50) cand.push({ side: 'E', d: c.x - (r.x + r.w), at: at2 });
          if (c.x + c.w <= r.x + 50) cand.push({ side: 'W', d: r.x - (c.x + c.w), at: at2 });
        }
        cand.forEach(function (k) { if (!best || k.d < best.d) best = k; });
      });
      var side = r.door || (best ? best.side : 'S');
      var along = side === 'N' || side === 'S';
      var len = along ? r.w : r.h, lo = along ? r.x : r.y, dw = Math.min(950, len * 0.45);
      var at = best && best.side === side ? best.at : lo + len / 2;
      at = U.clamp(at, lo + dw / 2 + 200, lo + len - dw / 2 - 200);
      if (len < dw + 400) at = lo + len / 2;
      out[r.id] = { side: side, at: at, w: dw };
    });
    return (S.doorCache[fl.code] = out);
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function planTexture(fl) {
    if (S.texCache[fl.code]) return S.texCache[fl.code];
    var b = bounds(fl), x0 = b.x0 - SLAB_M, y0 = b.y0 - SLAB_M, wmm = b.x1 - b.x0 + 2 * SLAB_M, hmm = b.y1 - b.y0 + 2 * SLAB_M;
    var ppm = Math.min(96, 2048 / (Math.max(wmm, hmm) / 1000));
    var cw = Math.max(64, Math.round(wmm / 1000 * ppm)), ch = Math.max(64, Math.round(hmm / 1000 * ppm));
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var g = cv.getContext('2d');
    var P = function (mm) { return mm / 1000 * ppm; }, PX = function (mm) { return (mm - x0) / 1000 * ppm; }, PY = function (mm) { return (mm - y0) / 1000 * ppm; };
    var lw = Math.max(1, ppm / 40), font = 'Arial,"Noto Sans KR","Malgun Gothic",sans-serif';
    g.fillStyle = '#a7aeb8'; g.fillRect(0, 0, cw, ch);
    g.fillStyle = '#d3d7dd'; g.fillRect(PX(b.x0), PY(b.y0), P(b.x1 - b.x0), P(b.y1 - b.y0));
    // 구조 그리드(8.4m 모듈) 옅게
    g.strokeStyle = 'rgba(30,41,59,0.10)'; g.lineWidth = lw; g.setLineDash([lw * 6, lw * 4]);
    for (var gx = b.x0; gx <= b.x1 + 1; gx += 8400) { g.beginPath(); g.moveTo(PX(gx), PY(b.y0)); g.lineTo(PX(gx), PY(b.y1)); g.stroke(); }
    for (var gy = b.y0; gy <= b.y1 + 1; gy += 8400) { g.beginPath(); g.moveTo(PX(b.x0), PY(gy)); g.lineTo(PX(b.x1), PY(gy)); g.stroke(); }
    g.setLineDash([]);
    var rooms = roomsOf(fl.code), doors = doorsOf(fl);
    function grid(x, y, w, h, step, col, wid) { g.strokeStyle = col; g.lineWidth = wid; g.beginPath(); for (var a = x; a < x + w; a += step) { g.moveTo(a, y); g.lineTo(a, y + h); } for (var c = y; c < y + h; c += step) { g.moveTo(x, c); g.lineTo(x + w, c); } g.stroke(); }
    rooms.forEach(function (r) {
      var s = roomStyle(r.type), x = PX(r.x), y = PY(r.y), w = P(r.w), h = P(r.h);
      g.fillStyle = s.fill; g.fillRect(x, y, w, h);
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      var t = r.type;
      if (t === 'corr' || t === 'lobby' || t === 'wc') grid(x, y, w, h, 0.6 * ppm, 'rgba(80,60,30,0.12)', lw);
      else if (t === 'telecom' || t === 'power' || t === 'server' || t === 'control') {
        grid(x, y, w, h, 0.6 * ppm, 'rgba(30,41,59,0.24)', lw * 1.2);
        if (s.hatch) { g.strokeStyle = s.hatch + '30'; g.lineWidth = lw * 1.4; g.beginPath(); for (var k = -h; k < w; k += 0.35 * ppm) { g.moveTo(x + k, y + h); g.lineTo(x + k + h, y); } g.stroke(); }
      } else if (t === 'park') {
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = lw * 2; g.beginPath();
        for (var px = x + 0.5 * ppm; px < x + w; px += 2.5 * ppm) { g.moveTo(px, y + h * 0.4); g.lineTo(px, y + h - 0.3 * ppm); } g.stroke();
        g.fillStyle = 'rgba(250,204,21,0.9)'; g.fillRect(x, y + h * 0.2, w, Math.max(2, 0.12 * ppm));
      } else if (t === 'stair') {
        g.strokeStyle = 'rgba(30,41,59,0.45)'; g.lineWidth = lw * 1.2; g.beginPath();
        var vert = h >= w, n = Math.max(6, Math.floor((vert ? h : w) / (0.28 * ppm)));
        for (var q = 1; q < n; q++) { if (vert) { g.moveTo(x + 0.15 * ppm, y + q * h / n); g.lineTo(x + w / 2 - 0.08 * ppm, y + q * h / n); g.moveTo(x + w / 2 + 0.08 * ppm, y + q * h / n); g.lineTo(x + w - 0.15 * ppm, y + q * h / n); } else { g.moveTo(x + q * w / n, y + 0.15 * ppm); g.lineTo(x + q * w / n, y + h / 2 - 0.08 * ppm); g.moveTo(x + q * w / n, y + h / 2 + 0.08 * ppm); g.lineTo(x + q * w / n, y + h - 0.15 * ppm); } }
        g.stroke();
      } else { g.strokeStyle = 'rgba(80,60,30,0.09)'; g.lineWidth = lw * 1.2; g.beginPath(); for (var pl = x; pl < x + w; pl += 0.2 * ppm) { g.moveTo(pl, y); g.lineTo(pl, y + h); } g.stroke(); }
      g.restore();
      g.strokeStyle = 'rgba(30,41,59,0.45)'; g.lineWidth = lw; g.strokeRect(x, y, w, h);
      if (t !== 'corr' && w > 46 && h > 30) {
        var fs = U.clamp(w / 9, 11, Math.min(34, h / 4));
        g.fillStyle = 'rgba(30,41,59,0.62)'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.font = 'bold ' + fs.toFixed(0) + 'px ' + font;
        g.fillText(String(r.id).replace(fl.code + '-', ''), x + w / 2, y + h - fs * 1.15, w - 8);
        g.font = (fs * 0.72).toFixed(0) + 'px ' + font;
        g.fillText((r.w * r.h / 1e6).toFixed(1) + '㎡', x + w / 2, y + h - fs * 0.3, w - 8);
      }
    });
    // 문 열림 궤적
    g.strokeStyle = 'rgba(146,64,14,0.6)'; g.lineWidth = lw * 1.3;
    rooms.forEach(function (r) {
      var d = doors[r.id]; if (!d) return;
      var rad = P(d.w), hx, hy, a0, a1;
      if (d.side === 'S') { hx = PX(d.at - d.w / 2); hy = PY(r.y + r.h); a0 = -Math.PI / 2; a1 = 0; }
      else if (d.side === 'N') { hx = PX(d.at - d.w / 2); hy = PY(r.y); a0 = 0; a1 = Math.PI / 2; }
      else if (d.side === 'W') { hx = PX(r.x); hy = PY(d.at - d.w / 2); a0 = 0; a1 = Math.PI / 2; }
      else { hx = PX(r.x + r.w); hy = PY(d.at - d.w / 2); a0 = Math.PI / 2; a1 = Math.PI; }
      g.beginPath(); g.arc(hx, hy, rad, a0, a1); g.stroke();
    });
    // 방위 · 축척
    g.fillStyle = 'rgba(30,41,59,0.65)'; g.font = 'bold ' + Math.round(ppm * 0.6) + 'px ' + font; g.textAlign = 'center';
    g.fillText('N ▲', cw - ppm * 0.9, ppm * 0.75);
    var sb = 5 * ppm, sx = ppm * 0.4, sy = ch - ppm * 0.35;
    g.fillStyle = 'rgba(30,41,59,0.75)'; g.fillRect(sx, sy - lw * 2, sb, lw * 2); g.fillRect(sx, sy - lw * 6, lw * 1.5, lw * 6); g.fillRect(sx + sb - lw * 1.5, sy - lw * 6, lw * 1.5, lw * 6);
    g.font = Math.round(ppm * 0.32) + 'px ' + font; g.textAlign = 'left'; g.fillText('5 m', sx + sb + lw * 4, sy);
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = S.renderer ? Math.min(8, S.renderer.capabilities.getMaxAnisotropy()) : 4;
    S.texCache[fl.code] = tex;
    return tex;
  }
  function invalidateCaches() {
    Object.keys(S.texCache).forEach(function (k) { S.texCache[k].dispose(); });
    S.texCache = {}; S.doorCache = {};
  }

  /* ---------------- 공통 건축 부재 ---------------- */
  function addSlab(bag, g, fl, y, op, isF, tint) {
    var b = bounds(fl), x0 = b.x0 - SLAB_M, x1 = b.x1 + SLAB_M, y0 = b.y0 - SLAB_M, y1 = b.y1 + SLAB_M;
    var w = (x1 - x0) / 1000, d = (y1 - y0) / 1000;
    var side = mStd(bag, 0x8f99a5, op, { roughness: 0.92, metalness: 0 });
    var top = bag.mat('top' + fl.code + op.toFixed(2) + (tint || ''), function () {
      return trn(new THREE.MeshStandardMaterial({ map: planTexture(fl), color: tint || 0xffffff, roughness: 0.84, metalness: 0 }), op);
    });
    var slab = new THREE.Mesh(bag.box(w, SLAB_T, d), [side, side, top, side, side, side]);
    slab.position.set(X((x0 + x1) / 2), y - SLAB_T / 2, Z((y0 + y1) / 2));
    slab.receiveShadow = true; g.add(slab);
    var e = new THREE.LineSegments(bag.edges(w, SLAB_T, d), mLine(bag, isF ? 0x38bdf8 : 0x475569, isF ? 0.75 : 0.35));
    e.position.copy(slab.position); g.add(e);
    return { x0: X(x0), x1: X(x1), z0: Z(y0), z1: Z(y1) };
  }
  function wallPiece(bag, g, cx, cy, cz, sx, sy, sz, mat, cap, edge, shadow) {
    boxE(bag, g, sx, sy, sz, cx, cy, cz, mat, edge, shadow);
    mesh(g, bag.box(sx + 0.004, 0.02, sz + 0.004), cap, cx, cy + sy / 2 + 0.01, cz);
  }
  function addParapet(bag, g, fl, y, op) {
    var b = bounds(fl), m = 400, t = 0.25, x0 = X(b.x0 - m), x1 = X(b.x1 + m), z0 = Z(b.y0 - m), z1 = Z(b.y1 + m);
    var mat = mStd(bag, 0xe5e7eb, op, { roughness: 0.9, metalness: 0 }), cap = mBasic(bag, 0x1e293b, op), cy = y + PARAPET_H / 2;
    var sh = op > 0.5;
    wallPiece(bag, g, (x0 + x1) / 2, cy, z0 - t / 2, x1 - x0 + 2 * t, PARAPET_H, t, mat, cap, null, sh);
    wallPiece(bag, g, (x0 + x1) / 2, cy, z1 + t / 2, x1 - x0 + 2 * t, PARAPET_H, t, mat, cap, null, sh);
    wallPiece(bag, g, x0 - t / 2, cy, (z0 + z1) / 2, t, PARAPET_H, z1 - z0, mat, cap, null, sh);
    wallPiece(bag, g, x1 + t / 2, cy, (z0 + z1) / 2, t, PARAPET_H, z1 - z0, mat, cap, null, sh);
  }
  function addRoomWalls(bag, g, rm, y, op, door) {
    var tech = TECH[rm.type], h = tech ? WALL_TECH : WALL_H, t = WALL_T;
    var x0 = X(rm.x), x1 = X(rm.x + rm.w), z0 = Z(rm.y), z1 = Z(rm.y + rm.h);
    if (x1 - x0 < 0.4 || z1 - z0 < 0.4) return h;
    var fill = hexOf(roomStyle(rm.type).fill);
    var mat = mStd(bag, mixHex(fill, 0xffffff, 0.62), op, { roughness: 0.85, metalness: 0 });
    var capCol = rm.type === 'telecom' ? 0x9a3412 : rm.type === 'server' ? 0x3730a3 : rm.type === 'power' ? 0x9f1239 : 0x334155;
    var cap = mBasic(bag, capCol, op), edge = mLine(bag, 0x8b8578, 0.5 * op), cy = y + h / 2, sh = op > 0.5;
    var sides = {
      N: { along: true, c: z0 + t / 2, a: x0, b: x1 }, S: { along: true, c: z1 - t / 2, a: x0, b: x1 },
      W: { along: false, c: x0 + t / 2, a: z0 + t, b: z1 - t }, E: { along: false, c: x1 - t / 2, a: z0 + t, b: z1 - t }
    };
    Object.keys(sides).forEach(function (k) {
      var s = sides[k], segs = [[s.a, s.b]], dd = null;
      if (door && door.side === k) {
        var at = s.along ? X(door.at) : Z(door.at), dw = door.w / 1000;
        dd = { a: at - dw / 2, b: at + dw / 2, w: dw };
        segs = [[s.a, dd.a], [dd.b, s.b]];
      }
      segs.forEach(function (sg) {
        var len = sg[1] - sg[0]; if (len < 0.05) return;
        var mid = (sg[0] + sg[1]) / 2;
        if (s.along) wallPiece(bag, g, mid, cy, s.c, len, h, t, mat, cap, edge, sh);
        else wallPiece(bag, g, s.c, cy, mid, t, h, len, mat, cap, edge, sh);
      });
      if (dd) { // 열린 문짝 (실 안쪽 70°)
        var lh = Math.min(2.0, h * 0.94), pv = new THREE.Group();
        var leaf = mesh(pv, bag.box(dd.w - 0.04, lh, 0.04), mStd(bag, 0x8a5a2b, op, { roughness: 0.6, metalness: 0.05 }), (dd.w - 0.04) / 2, lh / 2, 0, sh);
        void leaf;
        if (s.along) { pv.position.set(dd.a, y, s.c); pv.rotation.y = k === 'S' ? 1.2 : -1.2; }
        else { pv.position.set(s.c, y, dd.a); pv.rotation.y = k === 'W' ? -Math.PI / 2 + 1.2 : -Math.PI / 2 - 1.2; }
        g.add(pv);
      }
    });
    return h;
  }
  function addLadderTray(bag, g, a, b, y, color, op, wide) {
    var ax = X(a[0]), az = Z(a[1]), bx = X(b[0]), bz = Z(b[1]);
    var len = Math.hypot(bx - ax, bz - az); if (len < 0.1) return;
    var W2 = wide ? 0.2 : 0.14;
    var mat = mStd(bag, color, op, { metalness: 0.55, roughness: 0.35, emissive: color, emissiveIntensity: 0.16 });
    var grp = new THREE.Group(); grp.position.set((ax + bx) / 2, y, (az + bz) / 2); grp.rotation.y = -Math.atan2(bz - az, bx - ax);
    [-W2, W2].forEach(function (off) { var r = mesh(grp, bag.box(len, 0.06, 0.02), mat, 0, 0, off); r.castShadow = op > 0.5; });
    var n = Math.max(2, Math.floor(len / 0.3));
    var rungs = new THREE.InstancedMesh(bag.box(0.025, 0.015, W2 * 2), mat, n), m4 = new THREE.Matrix4();
    for (var i = 0; i < n; i++) { m4.makeTranslation(-len / 2 + (i + 0.5) * (len / n), -0.02, 0); rungs.setMatrixAt(i, m4); }
    grp.add(rungs);
    mesh(grp, bag.box(len, 0.045, W2 * 1.4), mStd(bag, 0x1d4ed8, op, { roughness: 0.7, metalness: 0.05 }), 0, 0.005, 0);
    g.add(grp);
  }

  /* ---------------- 설비 3D 모델 (kind별, 로컬 +z = 정면) ---------------- */
  var KIND_DIM = { rack: [0.6, 2.0, 1.0], server: [0.6, 2.0, 1.0], video: [0.6, 1.6, 0.8], power: [1.2, 1.7, 0.8], panel: [0.8, 1.9, 0.35], ground: [0.6, 0.45, 0.14], ap: [0.36, 0.05, 0.36], cctv: [0.3, 0.3, 0.4], tray: [2.0, 0.1, 0.4] };
  function kindOf(a) { return KIND_DIM[a.kind] ? a.kind : 'rack'; }
  function addEquipment(bag, parent, a, p, baseY, op, lod) {
    var kind = p.kind, gc = gHex(gradeOf(a)), sh = op > 0.5;
    var grp = new THREE.Group(); grp.position.set(p.wx, baseY, p.wz); grp.rotation.y = p.rot || 0;
    grp.userData.assetId = a.id; parent.add(grp);
    var std = function (c, o) { return mStd(bag, c, op, o); };
    var top = 1, dim = KIND_DIM[kind], heat = heatOf(a.measures);
    if (kind === 'rack' || kind === 'server' || kind === 'video') {
      var W = dim[0], H = dim[1], D = dim[2];
      boxE(bag, grp, W, H, D, 0, H / 2, 0, std(0x1f2937, { metalness: 0.5, roughness: 0.4 }), lod ? mLine(bag, 0x475569, 0.8 * op) : null, sh);
      mesh(grp, bag.box(W - 0.02, 0.05, 0.03), mBasic(bag, gc, op), 0, H - 0.05, D / 2 + 0.012); // 상태 표시 바
      if (lod) {
        mesh(grp, bag.box(W - 0.05, H - 0.1, 0.012), mStd(bag, 0x0f172a, op * 0.55, { metalness: 0.1, roughness: 0.1 }), 0, H / 2, D / 2 + 0.008);
        var nb = kind === 'video' ? 6 : 9, bh = (H - 0.3) / nb;
        var ledC = kind === 'server' ? 0x38bdf8 : 0x22c55e;
        for (var i = 0; i < nb; i++) {
          var by = 0.12 + i * bh + bh / 2;
          mesh(grp, bag.box(W - 0.1, bh * 0.7, 0.02), std(i % 3 === 0 ? 0x334155 : 0x475569), 0, by, D / 2 - 0.02);
          mesh(grp, bag.box(0.05, 0.022, 0.012), mBasic(bag, i === 2 && a.grade !== 'GREEN' ? gc : ledC, op), W / 2 - 0.1, by, D / 2 + 0.003);
        }
        if (kind === 'video') mesh(grp, bag.box(W * 0.9, 0.36, 0.05), mBasic(bag, 0x1e3a8a, op), 0, H + 0.2, 0.1);
        mesh(grp, bag.geo('cyl.05', function () { return new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10); }), std(0x1d4ed8), -0.15, H + 0.15, -0.2);
      }
      top = H + (kind === 'video' ? 0.4 : 0);
    } else if (kind === 'power') {
      var PW = dim[0], PH = dim[1], PD = dim[2];
      boxE(bag, grp, PW, PH, PD, 0, PH / 2, 0, std(0xcbd5e1, { metalness: 0.5, roughness: 0.45 }), lod ? mLine(bag, 0x64748b, 0.8 * op) : null, sh);
      if (lod) {
        for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
          var hot = heat && heat.sev > 0.6 && r === 3 && c >= 2;
          mesh(grp, bag.box(0.24, 0.26, 0.02), hot ? mStd(bag, 0xf43f5e, op, { emissive: 0xf43f5e, emissiveIntensity: 0.7 }) : std(0x334155), -PW / 2 + 0.18 + c * 0.28, 0.25 + r * 0.33, PD / 2 + 0.01);
        }
        mesh(grp, bag.box(0.3, 0.12, 0.015), mBasic(bag, 0x67e8f9, op), 0, PH - 0.15, PD / 2 + 0.01);
      }
      top = PH;
    } else if (kind === 'panel') {
      boxE(bag, grp, dim[0], dim[1], dim[2], 0, dim[1] / 2, 0, std(0x94a3b8, { metalness: 0.45, roughness: 0.5 }), lod ? mLine(bag, 0x475569, 0.8 * op) : null, sh);
      if (lod) {
        mesh(grp, bag.box(0.01, dim[1] - 0.1, 0.01), mBasic(bag, 0x334155, op), 0, dim[1] / 2, dim[2] / 2 + 0.006);
        mesh(grp, bag.box(0.03, 0.14, 0.03), std(0x111827), 0.06, 1.0, dim[2] / 2 + 0.02);
        mesh(grp, bag.box(0.16, 0.12, 0.01), mBasic(bag, 0xfacc15, op), -0.2, 1.5, dim[2] / 2 + 0.006);
      }
      top = dim[1];
    } else if (kind === 'ground') {
      boxE(bag, grp, 0.6, 0.42, 0.14, 0, 0.6, 0, std(0x94a3b8, { metalness: 0.6 }), null, sh);
      mesh(grp, bag.box(0.62, 0.05, 0.16), std(0x16a34a), 0, 0.86, 0);
      mesh(grp, bag.box(0.62, 0.05, 0.16), std(0xfacc15), 0, 0.92, 0);
      mesh(grp, bag.box(0.5, 0.02, 0.32), std(0xb45309, { metalness: 0.8, roughness: 0.3 }), 0, 0.012, 0.3);
      mesh(grp, bag.geo('cyl.015', function () { return new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6); }), std(0x16a34a), 0, 0.2, 0.08);
      top = 0.95;
    } else if (kind === 'ap') {
      var ay = 2.4;
      mesh(grp, bag.geo('apdisc', function () { return new THREE.CylinderGeometry(0.18, 0.18, 0.05, 28); }), std(0xf8fafc, { metalness: 0.1, roughness: 0.3 }), 0, ay, 0, sh);
      mesh(grp, bag.geo('aprod', function () { return new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6); }), std(0x94a3b8), 0, ay + 0.27, 0);
      var ring = mesh(grp, bag.geo('apring', function () { return new THREE.TorusGeometry(0.13, 0.014, 8, 30); }), mBasic(bag, gc, op), 0, ay - 0.03, 0);
      ring.rotation.x = Math.PI / 2;
      var R = U.clamp(p.cov || 5, 3, 9);
      var cov = mesh(parent, bag.geo('cov' + R.toFixed(1), function () { return new THREE.SphereGeometry(R, 36, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); }),
        mBasic(bag, 0x22d3ee, 0.07 * op, { side: THREE.DoubleSide, depthWrite: false }), p.wx, baseY + ay, p.wz);
      cov.scale.y = Math.min(1, ay / R);
      top = ay + 0.1;
    } else if (kind === 'cctv') {
      var cy = 2.4;
      mesh(grp, bag.box(0.12, 0.2, 0.06), std(0x64748b), 0, cy, -0.1);
      var body = mesh(grp, bag.geo('cctvb', function () { return new THREE.CylinderGeometry(0.07, 0.08, 0.32, 16); }), std(0xf1f5f9, { roughness: 0.35 }), 0, cy - 0.04, 0.08, sh);
      body.rotation.x = Math.PI / 2 - 0.45;
      var cone = mesh(grp, bag.geo('cctvc', function () { var c = new THREE.ConeGeometry(1.6, 4, 24, 1, true); c.translate(0, -2, 0); return c; }),
        mBasic(bag, 0xa78bfa, 0.08 * op, { side: THREE.DoubleSide, depthWrite: false }), 0, cy - 0.05, 0.2);
      cone.rotation.x = -(Math.PI / 2 + 0.45); cone.userData.noPick = true;
      top = cy + 0.1;
    } else if (kind === 'tray') {
      mesh(grp, bag.box(2.0, 0.06, 0.4), mStd(bag, gc, op, { emissive: gc, emissiveIntensity: 0.35, metalness: 0.5 }), 0, TRAY_Y, 0, sh);
      mesh(grp, bag.box(2.0, 0.05, 0.3), std(0x64748b), 0, TRAY_Y + 0.05, 0);
      top = TRAY_Y + 0.1;
    }
    if (a.grade === 'RED' && op > 0.5) { // 경보 빔
      var beam = mesh(parent, bag.geo('beam', function () { return new THREE.CylinderGeometry(0.08, 0.22, 1.6, 18, 1, true); }),
        mBasic(bag, 0xf43f5e, 0.2, { side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), p.wx, baseY + top + 1.1, p.wz);
      pulse(beam, 2.6, 0.15, 0.24, 'radial');
    }
    S.picks.push(grp);
    return top;
  }
  function placeAssets(fl) {
    var out = {}, placed = [], m = M();
    var risers = ((m && m.risers) || []).filter(function (r) { return !r.floors || !r.floors.length || r.floors.indexOf(fl.code) >= 0; });
    var fb = bounds(fl);
    assetsOf(fl.code).forEach(function (a) {
      var rm = TX.room(a.room); if (rm && rm.floor !== fl.code) rm = null;
      var kind = kindOf(a), x = num(a.x), y = num(a.y);
      if (x == null || y == null) { x = rm ? rm.x + rm.w / 2 : (fb.x0 + fb.x1) / 2; y = rm ? rm.y + rm.h / 2 : (fb.y0 + fb.y1) / 2; }
      var dim = KIND_DIM[kind], half = Math.max(dim[0], dim[2]) * 500 + 250;
      function clampIn(px, py) {
        if (!rm) return [px, py];
        var mx = Math.min(half, rm.w / 2), my = Math.min(half, rm.h / 2);
        return [U.clamp(px, rm.x + mx, rm.x + rm.w - mx), U.clamp(py, rm.y + my, rm.y + rm.h - my)];
      }
      var c = clampIn(x, y); x = c[0]; y = c[1];
      // 정면: 가장 가까운 벽의 반대 방향
      var fx = 0, fz = 1, nearW = null;
      if (rm) {
        var dl = x - rm.x, dr = rm.x + rm.w - x, dt = y - rm.y, db = rm.y + rm.h - y, mn = Math.min(dl, dr, dt, db);
        if (mn === dt) { fx = 0; fz = 1; nearW = 'N'; } else if (mn === db) { fx = 0; fz = -1; nearW = 'S'; } else if (mn === dl) { fx = 1; fz = 0; nearW = 'W'; } else { fx = -1; fz = 0; nearW = 'E'; }
        if (kind === 'ground' || kind === 'panel' || kind === 'cctv') { // 벽부형: 벽에 붙임
          var off = dim[2] * 500 + WALL_T * 1000 + 30;
          if (nearW === 'N') y = rm.y + off; else if (nearW === 'S') y = rm.y + rm.h - off; else if (nearW === 'W') x = rm.x + off; else x = rm.x + rm.w - off;
        }
      }
      if (kind !== 'ap' && kind !== 'tray') { // 겹침 회피 (벽 평행 방향으로 이동)
        var tx = Math.abs(fz) > 0 ? 1 : 0, ty = 1 - tx, step = Math.max(dim[0] * 1000 + 150, 750), bx = x, by = y;
        for (var k = 0; k < 12; k++) {
          var o = k === 0 ? 0 : Math.ceil(k / 2) * step * (k % 2 ? 1 : -1), q = clampIn(bx + tx * o, by + ty * o);
          var clash = placed.some(function (p) { return Math.hypot(p[0] - q[0], p[1] - q[1]) < step * 0.92; }) ||
            risers.some(function (r) { return Math.abs(r.x - q[0]) < 650 && Math.abs(r.y - q[1]) < 650; });
          if (!clash) { x = q[0]; y = q[1]; break; }
        }
        placed.push([x, y]);
      }
      out[a.id] = { x: x, y: y, wx: X(x), wz: Z(y), rm: rm, kind: kind, rot: Math.atan2(fx, fz), cov: rm ? Math.hypot(rm.w, rm.h) / 2000 : 5 };
    });
    return out;
  }

  /* ---------------- 라벨 앵커 ---------------- */
  function clearLabels() { S.anchors = []; if (S.labelsEl) S.labelsEl.textContent = ''; }
  function anchor(pos, html, cls, pri, data, frag) {
    var el = document.createElement('div');
    el.className = 'tx-s3-lab ' + (cls || '');
    el.innerHTML = html;
    if (data && data.a) el.setAttribute('data-a', data.a);
    if (data && data.r) el.setAttribute('data-r', data.r);
    if (data && data.t) el.title = data.t;
    el.style.visibility = 'hidden';
    frag.appendChild(el);
    var an = { el: el, pos: pos, pri: pri, base: pri, id: data ? (data.a || data.r || '') : '', isA: !!(data && data.a), w: 0, h: 0, vis: false };
    S.anchors.push(an);
    return an;
  }
  function assetChip(a, pos, pri, frag, scoreMode) {
    var g = gradeOf(a), rk = riskOf(a), mc = (a.measures || []).length;
    var score = rk.est ? (scoreMode === 'always' ? '≈' + rk.total : '') : String(Math.round(rk.total));
    var badge = st().layers && st().layers.measure && mc ? '<em>실측 ' + mc + '</em>' : '';
    // 상태 등급(asset.grade)과 위험점수(analysis.risk)는 서로 다른 값 → 점수에 '위험' 명시
    var html = '<i></i>' + U.esc(a.id) + ' <b>' + g + '</b>' + (score ? ' <small class="tx-s3-rk">위험 ' + score + '</small>' : '') + badge;
    return anchor(pos, html, 'tx-s3-chip tx-g-' + g, pri + (g === 'RED' ? 30 : g === 'ORANGE' ? 20 : g === 'YELLOW' ? 10 : 0), { a: a.id, t: a.name + (rk.est ? ' · 점수 미산출(등급 기반)' : ' · 위험점수 ' + Math.round(rk.total)) }, frag);
  }
  function roomChip(rm, pos, frag) {
    var tech = TECH[rm.type];
    var area = rm.w * rm.h / 1e6;
    return anchor(pos, U.esc(rm.name) + ' <span>' + U.esc(rm.id) + '</span>', tech ? 'tx-s3-room tx-s3-tech' : 'tx-s3-room',
      (tech ? 58 : 44) + Math.min(6, area / 20), { r: rm.id, t: rm.name + ' · ' + area.toFixed(1) + '㎡' }, frag);
  }

  /* ---------------- 시안 A: 돌하우스 ---------------- */
  function buildDoll(focus, frag) {
    var s = st(), stack = !!s.stack, fls = stack ? floorsAll() : [focus], L = s.layers || {};
    var ub = stack ? unionBounds(fls) : bounds(focus);
    S.org = { x: (ub.x0 + ub.x1) / 2, y: (ub.y0 + ub.y1) / 2 };
    var bag = S.bagS, g = S.gStatic, ext = null, yMin = Infinity, yMax = -Infinity;
    var pickMat = bag.mat('pick', function () { return new THREE.MeshBasicMaterial({ visible: false }); });
    fls.forEach(function (fl) {
      var y = floorY(fl.code), isF = fl.code === focus.code, op = (!stack || isF) ? 1 : (s.ghost ? 0.16 : 0.92);
      var interactive = isF || !s.ghost, nA = assetsOf(fl.code).length, lod = (isF || !s.ghost) && nA < 180 ? 1 : 0;
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      var e = addSlab(bag, g, fl, y, op, isF);
      if (isF) ext = e;
      addParapet(bag, g, fl, y, op);
      var doors = doorsOf(fl);
      roomsOf(fl.code).forEach(function (rm) {
        var cx = X(rm.x + rm.w / 2), cz = Z(rm.y + rm.h / 2), wh = WALL_H;
        if (interactive) {
          var tile = mesh(g, bag.box(Math.max(0.1, rm.w / 1000 - 0.1), 0.02, Math.max(0.1, rm.h / 1000 - 0.1)), pickMat, cx, y + 0.012, cz);
          tile.userData = { roomId: rm.id, floor: fl.code }; S.picks.push(tile);
        }
        if (rm.type !== 'corr') wh = addRoomWalls(bag, g, rm, y, op, doors[rm.id]);
        S.roomInfo[rm.id] = { rm: rm, y: y, cx: cx, cz: cz, w: rm.w / 1000, d: rm.h / 1000, heat: heatOf(rm.measures), gnd: gndBad(rm.measures), op: op, isF: isF };
        var lz = Z(rm.y) + Math.min(1.6, rm.h / 1000 * 0.22);
        if (isF && rm.type !== 'corr') roomChip(rm, new THREE.Vector3(cx, y + wh + 0.3, lz), frag);
        else if (!isF && !s.ghost && TECH[rm.type]) roomChip(rm, new THREE.Vector3(cx, y + wh + 0.3, lz), frag).base -= 25;
      });
      var places = placeAssets(fl);
      assetsOf(fl.code).forEach(function (a) {
        var p = places[a.id]; if (!p) return;
        var top = addEquipment(bag, g, a, p, y, op, lod);
        if (!interactive) S.picks.pop();
        S.info[a.id] = { a: a, base: new THREE.Vector3(p.wx, y, p.wz), top: y + top, center: new THREE.Vector3(p.wx, y + top * 0.6, p.wz),
          ringR: Math.max(0.45, Math.max(KIND_DIM[p.kind][0], KIND_DIM[p.kind][2]) * 0.75), halo: true, op: op, isF: isF,
          heat: heatOf(a.measures), gnd: gndBad(a.measures) };
        if (isF || !s.ghost) assetChip(a, new THREE.Vector3(p.wx, y + top + 0.75, p.wz), isF ? 50 : 20, frag);
      });
      if (L.tray !== false) (fl.trays || []).forEach(function (t) { if (t && t.a && t.b) addLadderTray(bag, g, t.a, t.b, y + TRAY_Y, 0xfacc15, op, t.main); });
    });
    if (s.riser !== false) addRisers(bag, g, fls, yMin, yMax, frag);
    var fy = floorY(focus.code);
    S.focusY = fy;
    S.walkB = ext;
    var b = bounds(focus), fw = (b.x1 - b.x0) / 1000 + 2, fd = (b.y1 - b.y0) / 1000 + 2;
    S.floorR = Math.hypot(fw, fd, 3) / 2;
    var hs = (yMax - yMin) + 3;
    S.sceneR = stack ? Math.hypot(fw, fd, hs) / 2 : S.floorR;
    S.center = new THREE.Vector3(0, stack ? (fy * 0.6 + (yMin + yMax) / 2 * 0.4) + 0.8 : fy + 0.8, 0);
    S.gridY = yMin - 1.4;
  }
  function addRisers(bag, g, fls, yMin, yMax, frag) {
    var m = M(), stack = !!st().stack;
    ((m && m.risers) || []).forEach(function (r) {
      var on = fls.filter(function (f) { return !r.floors || !r.floors.length || r.floors.indexOf(f.code) >= 0; });
      if (!on.length || r.x == null) return;
      var ys = on.map(function (f) { return floorY(f.code); });
      var y0 = Math.min.apply(null, ys) - SLAB_T - 0.05, y1 = Math.max.apply(null, ys) + 2.9, h = y1 - y0, cy = (y0 + y1) / 2;
      var x = X(r.x), z = Z(r.y), col = 0x38bdf8;
      var shaft = mesh(g, bag.box(0.7, h, 0.7), mStd(bag, col, 0.14, { roughness: 0.1, metalness: 0.1, depthWrite: false }), x, cy, z);
      shaft.material.depthWrite = false;
      var e = new THREE.LineSegments(bag.edges(0.7, h, 0.7), mLine(bag, col, 0.85)); e.position.copy(shaft.position); g.add(e);
      var cables = [[-0.16, C.LINK.optical.hex], [0, C.LINK.data.hex], [0.16, C.LINK.ground.hex]];
      cables.forEach(function (c) {
        mesh(g, bag.geo('rc' + h.toFixed(2), function () { return new THREE.CylinderGeometry(0.04, 0.04, h, 10); }), mStd(bag, c[1], 1, { emissive: c[1], emissiveIntensity: 0.4, roughness: 0.4 }), x + c[0], cy, z);
      });
      var pg = bag.geo('pkt.06', function () { return new THREE.SphereGeometry(0.07, 10, 10); });
      for (var i = 0; i < 4; i++) {
        var up = i % 2 === 0, cx = up ? -0.16 : 0;
        var pk = mesh(g, pg, mBasic(bag, up ? 0xede9fe : 0xcffafe, 1), x + cx, y0, z);
        packet(pk, { a: new THREE.Vector3(x + cx, up ? y0 : y1, z), b: new THREE.Vector3(x + cx, up ? y1 : y0, z), p: i / 4, spd: 0.0035 * (stack ? 0.6 : 1.4) });
      }
      anchor(new THREE.Vector3(x, y1 + 0.25, z), '<span>▮</span> ' + U.esc(r.name || r.id), 'tx-s3-room tx-s3-riser', 35, { t: '라이저 ' + (r.floors || []).join('·') }, frag);
    });
  }

  /* ---------------- 시안 B: 룸·랙 투시 ---------------- */
  function pickRoomB(focus) {
    var s = st(), rm = s.room ? TX.room(s.room) : null;
    if (!rm && s.selected) { var a = TX.asset(s.selected); if (a) rm = TX.room(a.room); }
    if (!rm || (!s.room && rm.floor !== focus.code && !s.selected)) {
      var best = null, cnt = -1;
      roomsOf(focus.code).forEach(function (r) { var n = assetsOf(focus.code).filter(function (a) { return a.room === r.id; }).length; if (n > cnt) { cnt = n; best = r; } });
      rm = best;
    }
    return rm;
  }
  function parseU(u) {
    if (u == null || u === '') return null;
    if (typeof u === 'number') return { u: u, h: 1 };
    var ns = String(u).match(/\d+/g); if (!ns) return null;
    var a = +ns[0], b = ns.length > 1 ? +ns[1] : a;
    return { u: Math.min(a, b), h: Math.abs(b - a) + 1 };
  }
  function floorGridTexture(bag) {
    var cv = document.createElement('canvas'); cv.width = cv.height = 384;
    var g = cv.getContext('2d'), t = 128;
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      var perf = (i + j) % 3 === 1;
      g.fillStyle = perf ? '#b9c6d8' : '#d6dde6'; g.fillRect(i * t, j * t, t, t);
      if (perf) { g.fillStyle = 'rgba(30,41,59,0.35)'; for (var a = 10; a < t; a += 12) for (var b = 10; b < t; b += 12) g.fillRect(i * t + a, j * t + b, 4, 4); }
      g.strokeStyle = '#64748b'; g.lineWidth = 3; g.strokeRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3);
    }
    var tex = bag.keep(new THREE.CanvasTexture(cv));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = Math.min(8, S.renderer.capabilities.getMaxAnisotropy());
    return tex;
  }
  function buildRoomB(focus, frag) {
    S.genericFill = false;
    var rm = pickRoomB(focus);
    if (!rm) { buildDoll(focus, frag); return; }
    S.roomB = rm;
    var fl = TX.floor(rm.floor) || focus, bag = S.bagS, g = S.gStatic;
    S.org = { x: rm.x + rm.w / 2, y: rm.y + rm.h / 2 };
    var W = rm.w / 1000, D = rm.h / 1000, RF = 0.3, CH = 3.0, hw = W / 2, hd = D / 2;
    // 층 맥락 (어둡게)
    addSlab(bag, g, fl, -0.01, 1, false, 0x6b7584);
    // 이중마루 하부: 페데스탈 + 하부 케이블
    var nx = Math.max(1, Math.floor(W / 0.6)), nz = Math.max(1, Math.floor(D / 0.6)), cnt = (nx + 1) * (nz + 1);
    if (cnt < 6000) {
      var ped = new THREE.InstancedMesh(bag.geo('ped', function () { return new THREE.CylinderGeometry(0.02, 0.03, RF - 0.04, 6); }), mStd(bag, 0x94a3b8, 1, { metalness: 0.7, roughness: 0.3 }), cnt), m4 = new THREE.Matrix4(), k = 0;
      for (var i = 0; i <= nx; i++) for (var j = 0; j <= nz; j++) { m4.makeTranslation(-hw + i * (W / nx), (RF - 0.04) / 2, -hd + j * (D / nz)); ped.setMatrixAt(k++, m4); }
      g.add(ped);
    }
    mesh(g, bag.box(W * 0.8, 0.06, 0.25), mStd(bag, 0x1d4ed8, 1, { roughness: 0.7 }), 0, 0.06, hd * 0.35);
    mesh(g, bag.box(W * 0.8, 0.05, 0.18), mStd(bag, C.LINK.power.hex, 1, { roughness: 0.6 }), 0, 0.05, -hd * 0.1);
    // 이중마루 상판 (일부 절개: 전면 1열 제거)
    var tex = floorGridTexture(bag); tex.repeat.set(W / 1.8, (D - 0.6) / 1.8);
    var plate = mesh(g, bag.box(W, 0.04, D - 0.6), [mStd(bag, 0x475569, 1), mStd(bag, 0x475569, 1), bag.keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.1 })), mStd(bag, 0x475569, 1), mStd(bag, 0x475569, 1), mStd(bag, 0x475569, 1)], 0, RF - 0.02, -0.3);
    plate.receiveShadow = true;
    var pickMat = bag.mat('pick', function () { return new THREE.MeshBasicMaterial({ visible: false }); });
    var tile = mesh(g, bag.box(W, 0.02, D), pickMat, 0, RF + 0.01, 0); tile.userData = { roomId: rm.id }; S.picks.push(tile);
    // 유리벽 컷어웨이: 후면(N·W) 전고 유리, 전면(S·E) 하부만 + 프레임 윤곽
    var glass = mStd(bag, 0x60a5fa, 0.2, { roughness: 0.05, metalness: 0.2 }), glassLo = mStd(bag, 0x60a5fa, 0.12, { roughness: 0.05, metalness: 0.2 });
    glass.depthWrite = false; glassLo.depthWrite = false;
    var frame = mLine(bag, 0x93c5fd, 0.9), t = 0.06;
    boxE(bag, g, W, CH, t, 0, CH / 2, -hd, glass, frame);
    boxE(bag, g, t, CH, D, -hw, CH / 2, 0, glass, frame);
    boxE(bag, g, W, 0.9, t, 0, 0.45, hd, glassLo, frame);
    boxE(bag, g, t, 0.9, D, hw, 0.45, 0, glassLo, frame);
    var ol = bag.keep(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-hw, CH, hd), new THREE.Vector3(hw, CH, hd), new THREE.Vector3(hw, CH, -hd), new THREE.Vector3(hw, 0.9, hd), new THREE.Vector3(hw, CH, hd)]));
    g.add(new THREE.Line(ol, mLine(bag, 0x93c5fd, 0.6)));
    // 설비 배치 (모델 좌표 기준, 실 내부 클램프)
    var assets = assetsOf(rm.floor).filter(function (a) { return a.room === rm.id; });
    var cabs = {}, order = [], loose = [];
    assets.forEach(function (a) {
      var k = kindOf(a), rname = a.rack && a.rack.name ? String(a.rack.name) : null;
      if (!rname && (k === 'rack' || k === 'video')) rname = '#' + a.id;
      if (!rname && k === 'server') rname = '#SRV';
      if (!rname) { loose.push(a); return; }
      if (!cabs[rname]) { cabs[rname] = { name: rname, devs: [], self: rname === '#' + a.id ? a : null }; order.push(rname); }
      cabs[rname].devs.push(a);
    });
    var placedC = [];
    order.forEach(function (nm, idx) {
      var cb = cabs[nm], xs = cb.devs.map(function (a) { return num(a.x); }).filter(isFinite), ys = cb.devs.map(function (a) { return num(a.y); }).filter(isFinite);
      var x = xs.length ? xs.reduce(function (p, q) { return p + q; }, 0) / xs.length / 1000 - S.org.x / 1000 : -hw + 0.8 + idx * 0.75;
      var z = ys.length ? ys.reduce(function (p, q) { return p + q; }, 0) / ys.length / 1000 - S.org.y / 1000 : -hd + 1.2;
      x = U.clamp(x, -hw + 0.5, hw - 0.5); z = U.clamp(z, -hd + 0.8, hd - 1.2);
      for (var k = 0; k < 16 && placedC.some(function (p) { return Math.abs(p[0] - x) < 0.66 && Math.abs(p[1] - z) < 1.1; }); k++) { x += 0.68; if (x > hw - 0.4) { x = -hw + 0.5; z += 1.6; } }
      placedC.push([x, z]); cb.x = x; cb.z = z;
    });
    // 랙 열 상부 사다리 트레이 + 인입 케이블
    if (placedC.length) {
      var minX = Math.min.apply(null, placedC.map(function (p) { return p[0]; })), maxX = Math.max.apply(null, placedC.map(function (p) { return p[0]; }));
      var rows = {}; placedC.forEach(function (p) { rows[p[1].toFixed(1)] = p[1]; });
      Object.keys(rows).forEach(function (k) {
        var z = rows[k];
        addLadderTray(bag, g, [(minX - 0.6) * 1000 + S.org.x, z * 1000 + S.org.y], [(maxX + 0.6) * 1000 + S.org.x, z * 1000 + S.org.y], 2.75, 0xfacc15, 1, true);
      });
      addLadderTray(bag, g, [(minX - 0.6) * 1000 + S.org.x, -hd * 1000 + 300 + S.org.y], [(minX - 0.6) * 1000 + S.org.x, Math.max.apply(null, placedC.map(function (p) { return p[1]; })) * 1000 + S.org.y], 2.75, 0xfacc15, 1, true);
    }
    order.forEach(function (nm) { addCabinet(bag, g, cabs[nm], RF, frag); });
    // 기타 설비 (UPS·분전반·접지·AP·CCTV)
    var places = placeAssets(fl);
    loose.forEach(function (a) {
      var p = places[a.id]; if (!p) return;
      var top = addEquipment(bag, g, a, p, RF, 1, 1);
      S.info[a.id] = { a: a, base: new THREE.Vector3(p.wx, RF, p.wz), top: RF + top, center: new THREE.Vector3(p.wx, RF + top * 0.6, p.wz), ringR: 0.6, halo: true, op: 1, isF: true, heat: heatOf(a.measures), gnd: gndBad(a.measures) };
      assetChip(a, new THREE.Vector3(p.wx, RF + top + 0.6, p.wz), 50, frag);
    });
    anchor(new THREE.Vector3(-hw + 0.2, CH + 0.3, -hd), U.esc(rm.name) + ' <span>' + U.esc(rm.id) + ' · ' + (W * D).toFixed(1) + '㎡</span>', 'tx-s3-room tx-s3-tech tx-s3-title', 120, { r: rm.id }, frag);
    var roomR = Math.hypot(W, D, CH) / 2 * 1.02, pts = placedC.slice();
    loose.forEach(function (a) { var p = places[a.id]; if (p) pts.push([p.wx, p.wz]); });
    if (pts.length) {
      var ax0 = Math.min.apply(null, pts.map(function (p) { return p[0]; })), ax1 = Math.max.apply(null, pts.map(function (p) { return p[0]; }));
      var az0 = Math.min.apply(null, pts.map(function (p) { return p[1]; })), az1 = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
      S.center = new THREE.Vector3((ax0 + ax1) / 2, 1.1, (az0 + az1) / 2);
      S.sceneR = Math.min(roomR, Math.max(2.6, Math.hypot(ax1 - ax0 + 1.6, az1 - az0 + 1.6, CH) / 2));
    } else { S.center = new THREE.Vector3(0, 1.1, 0); S.sceneR = roomR; }
    S.floorR = roomR;
    S.focusY = 0; S.walkB = null; S.gridY = -1.2;
  }
  function addCabinet(bag, g, cb, baseY, frag) {
    var Wc = 0.6, Hc = 2.0, Dc = 1.0, UH = 0.0445, grp = new THREE.Group();
    grp.position.set(cb.x, baseY, cb.z); grp.rotation.y = cb.z > 0 ? Math.PI : 0; g.add(grp);
    var frameM = mStd(bag, 0x111827, 1, { metalness: 0.6, roughness: 0.35 });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { mesh(grp, bag.box(0.04, Hc, 0.04), frameM, c[0] * (Wc / 2 - 0.02), Hc / 2, c[1] * (Dc / 2 - 0.02), true); });
    mesh(grp, bag.box(Wc, 0.05, Dc), frameM, 0, Hc - 0.025, 0, true);
    mesh(grp, bag.box(Wc, 0.08, Dc), frameM, 0, 0.04, 0, true);
    var side = mStd(bag, 0x1e3a8a, 0.28, { roughness: 0.1, metalness: 0.3 }); side.depthWrite = false;
    mesh(grp, bag.box(0.01, Hc - 0.1, Dc - 0.06), side, -Wc / 2, Hc / 2, 0);
    mesh(grp, bag.box(0.01, Hc - 0.1, Dc - 0.06), side, Wc / 2, Hc / 2, 0);
    mesh(grp, bag.box(Wc - 0.06, Hc - 0.1, 0.012), mStd(bag, 0x0f172a, 0.8), 0, Hc / 2, -Dc / 2 + 0.02);
    var rail = mStd(bag, 0x94a3b8, 1, { metalness: 0.8, roughness: 0.3 });
    [-0.245, 0.245].forEach(function (x) { mesh(grp, bag.box(0.015, 42 * UH, 0.015), rail, x, 0.1 + 21 * UH, Dc / 2 - 0.08); });
    // U 눈금 (5U마다)
    var tick = bag.geo('uticks', function () { var pts = []; for (var u = 0; u <= 42; u += 5) { pts.push(new THREE.Vector3(-0.27, 0.1 + u * UH, Dc / 2 - 0.07), new THREE.Vector3(-0.23, 0.1 + u * UH, Dc / 2 - 0.07)); } return new THREE.BufferGeometry().setFromPoints(pts); });
    grp.add(new THREE.LineSegments(tick, mLine(bag, 0xe2e8f0, 0.8)));
    var devs = [], cursor = 1, self = cb.self;
    cb.devs.forEach(function (a) {
      if (a === self) return;
      var pu = parseU(a.rack && a.rack.u), k = kindOf(a), hU = pu ? pu.h : (k === 'server' ? 2 : k === 'power' ? 3 : 1);
      var u = pu ? pu.u : cursor; cursor = Math.max(cursor, u + hU + 1);
      devs.push({ a: a, u: U.clamp(u, 1, 42), h: U.clamp(hU, 1, 12) });
    });
    if (self) { // 랙 자체가 설비: 범용 장비(패치·스위치·서버) 충전 + 랙 상태 색
      S.genericFill = true; // 실장 정보 없음 → 예시 그림 (HUD에 명시)
      var hsh = Math.abs(U.hash(self.id)), seq = [1, 1, 2, 1, 2, 4, 1, 2], u0 = 2;
      for (var i = 0; i < 8 + (hsh % 5) && u0 < 40; i++) { var hh = seq[(i + hsh) % seq.length]; devs.push({ a: self, u: u0, h: hh, generic: true, kind: hh === 1 ? (i % 2 ? 'patch' : 'sw') : 'srv' }); u0 += hh + ((hsh >> i) & 1); }
    }
    var devY = function (d) { return 0.1 + (d.u - 1) * UH + d.h * UH / 2; };
    devs.forEach(function (d) {
      var gc = gHex(gradeOf(d.a)), hgt = d.h * UH - 0.004, y = devY(d);
      var body = d.generic ? (d.kind === 'patch' ? 0x9ca3af : d.kind === 'sw' ? 0x1f2937 : 0x334155) : 0x273449;
      var m1 = mesh(grp, bag.box(0.46, hgt, 0.82), mStd(bag, body, 1, { metalness: 0.45, roughness: 0.45 }), 0, y, 0.02, true);
      m1.userData.assetId = d.a.id;
      var bez = mesh(grp, bag.box(0.48, hgt, 0.015), mStd(bag, d.generic ? mixHex(body, 0x000000, 0.2) : 0x0b1220, 1, { metalness: 0.3 }), 0, y, Dc / 2 - 0.06);
      bez.userData.assetId = d.a.id;
      mesh(grp, bag.box(0.018, hgt * 0.8, 0.006), mBasic(bag, d.generic ? (d.kind === 'sw' ? 0x22c55e : 0x64748b) : gc, 1), -0.21, y, Dc / 2 - 0.05);
      if (!d.generic || d.kind !== 'patch') for (var l = 0; l < 4; l++) mesh(grp, bag.box(0.012, 0.01, 0.006), mBasic(bag, l === 0 ? gc : (d.kind === 'srv' ? 0x38bdf8 : 0x22c55e), 1), 0.1 + l * 0.03, y + hgt / 2 - 0.012, Dc / 2 - 0.05);
    });
    grp.updateMatrixWorld(true);
    var prim = self || (cb.devs[0]);
    grp.userData.assetId = prim ? prim.id : null; S.picks.push(grp);
    var topW = grp.localToWorld(new THREE.Vector3(0, Hc, 0));
    var label = cb.name.charAt(0) === '#' ? (self ? self.name : '서버 랙') : cb.name;
    anchor(topW.clone().add(new THREE.Vector3(0, 0.45, 0)), '▤ ' + U.esc(label), 'tx-s3-room tx-s3-cab', 60, prim ? { a: prim.id } : null, frag);
    var done = {};
    devs.forEach(function (d) {
      if (done[d.a.id]) return; done[d.a.id] = 1;
      var y = devY(d), wp = grp.localToWorld(new THREE.Vector3(0, y, Dc / 2));
      S.info[d.a.id] = { a: d.a, base: grp.localToWorld(new THREE.Vector3(0, 0, 0)), top: topW.y, center: wp, ringR: 0.55, halo: false, op: 1, isF: true,
        box: { grp: grp, y: y, h: d.a === self ? Hc : d.h * UH }, heat: heatOf(d.a.measures), gnd: gndBad(d.a.measures) };
      if (d.a !== self) assetChip(d.a, grp.localToWorld(new THREE.Vector3(0.34, y + 0.02, Dc / 2)), 55, frag).el.classList.add('tx-s3-side');
    });
    if (self) assetChip(self, topW.clone().add(new THREE.Vector3(0, 0.12, 0)), 50, frag);
  }

  /* ---------------- 시안 C: 홀로그램 계통 ---------------- */
  function buildHolo(focus, frag) {
    var m = M(), bag = S.bagS, g = S.gStatic, ex = explode();
    S.org = { x: 0, y: 0 };
    var links = (m.links || []).filter(function (l) { return TX.asset(l.from) && TX.asset(l.to); });
    var ids = {}; links.forEach(function (l) { ids[l.from] = 1; ids[l.to] = 1; });
    var nodes = Object.keys(ids);
    if (!nodes.length) nodes = assetsOf(focus.code).map(function (a) { return a.id; });
    var inc = {}, out = {}; nodes.forEach(function (id) { inc[id] = []; out[id] = []; });
    links.forEach(function (l) { if (inc[l.to] && out[l.from] && l.from !== l.to) { inc[l.to].push(l.from); out[l.from].push(l.to); } });
    var depth = {}; nodes.forEach(function (id) { depth[id] = 0; });
    for (var it = 0; it < Math.min(nodes.length, 40); it++) {
      var ch = false;
      links.forEach(function (l) { if (depth[l.from] != null && depth[l.to] != null && depth[l.to] < depth[l.from] + 1 && depth[l.from] + 1 < 12) { depth[l.to] = depth[l.from] + 1; ch = true; } });
      if (!ch) break;
    }
    var tiers = {}, maxD = 0;
    nodes.forEach(function (id) { var d = depth[id]; (tiers[d] = tiers[d] || []).push(id); maxD = Math.max(maxD, d); });
    var TG = 2.1 * ex, ang = {}, pos = {}, maxR = 3;
    for (var d = 0; d <= maxD; d++) {
      var list = tiers[d] || []; if (!list.length) continue;
      var r = Math.max(2.4 + d * 2.6, list.length * 1.25 / (2 * Math.PI));
      maxR = Math.max(maxR, r);
      var want = {};
      list.forEach(function (id, i) {
        var ps = inc[id].filter(function (p) { return ang[p] != null; });
        if (!ps.length) { want[id] = i / list.length * Math.PI * 2; return; }
        var sx = 0, sy = 0; ps.forEach(function (p) { sx += Math.cos(ang[p]); sy += Math.sin(ang[p]); }); want[id] = Math.atan2(sy, sx);
      });
      list.sort(function (a, b) { return want[a] - want[b]; });
      var sx2 = 0, sy2 = 0;
      list.forEach(function (id, i) { var dlt = want[id] - i / list.length * Math.PI * 2; sx2 += Math.cos(dlt); sy2 += Math.sin(dlt); });
      var offA = d === 0 ? 0 : Math.atan2(sy2, sx2), y = (maxD - d) * TG;
      list.forEach(function (id, i) { var a = offA + i / list.length * Math.PI * 2; ang[id] = a; pos[id] = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r); });
      // 계층 링
      var ringC = d === 0 ? 0xf43f5e : d === 1 ? 0x22d3ee : 0x10b981;
      var ring = mesh(g, bag.geo('hr' + r.toFixed(2), function () { return new THREE.RingGeometry(r - 0.035, r + 0.035, 128); }), mBasic(bag, ringC, 0.65, { side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), 0, y, 0);
      ring.rotation.x = -Math.PI / 2;
      var disc = mesh(g, bag.geo('hd' + r.toFixed(2), function () { return new THREE.CircleGeometry(r, 96); }), mBasic(bag, ringC, 0.045, { side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), 0, y - 0.01, 0);
      disc.rotation.x = -Math.PI / 2;
      var dash = mesh(g, bag.geo('hdash' + r.toFixed(2), function () { return new THREE.RingGeometry(r + 0.2, r + 0.26, 64, 1, 0, Math.PI * 0.35); }), mBasic(bag, ringC, 0.8, { side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), 0, y, 0);
      dash.rotation.x = -Math.PI / 2; dash.userData.spin = 0.25 * (d % 2 ? -1 : 1); S.anim.spin.push(dash);
      anchor(new THREE.Vector3(r + 0.4, y + 0.1, 0), '계층 ' + d + ' · ' + list.length + '대', 'tx-s3-room tx-s3-tier', 15, null, frag);
    }
    var hTot = maxD * TG;
    var pgrid = new THREE.PolarGridHelper(maxR + 2, 16, 8, 96, 0x1e3a8a, 0x0e2148);
    pgrid.position.y = -0.9; pgrid.material.transparent = true; pgrid.material.opacity = 0.55; g.add(pgrid);
    var core = mesh(g, bag.geo('core' + hTot.toFixed(1), function () { return new THREE.CylinderGeometry(0.05, 0.05, hTot + 3, 12, 1, true); }), mBasic(bag, CYAN, 0.35, { blending: THREE.AdditiveBlending, depthWrite: false }), 0, hTot / 2, 0);
    pulse(core, 1.2, 0.8, 0.35, 'radial');
    var nodeGeo = { box: bag.geo('nbox', function () { return new THREE.BoxGeometry(0.5, 0.62, 0.5); }), cyl: bag.geo('ncyl', function () { return new THREE.CylinderGeometry(0.3, 0.3, 0.55, 20); }), oct: bag.geo('noct', function () { return new THREE.OctahedronGeometry(0.38, 0); }) };
    var shell = bag.geo('nshell', function () { return new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.55, 0)); });
    var stalkPts = [];
    nodes.forEach(function (id) {
      var a = TX.asset(id), p = pos[id]; if (!a || !p) return;
      var gc = gHex(gradeOf(a)), k = kindOf(a), ng = (k === 'rack' || k === 'server' || k === 'video') ? nodeGeo.box : (k === 'power' || k === 'panel') ? nodeGeo.cyl : nodeGeo.oct;
      var grp = new THREE.Group(); grp.position.copy(p).add(new THREE.Vector3(0, 0.55, 0)); grp.userData.assetId = id; g.add(grp);
      mesh(grp, ng, mStd(bag, gc, 1, { emissive: gc, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.3 }), 0, 0, 0);
      var sh = new THREE.LineSegments(shell, mLine(bag, mixHex(gc, 0xffffff, 0.4), 0.55)); sh.userData.spin = 0.5; S.anim.spin.push(sh); grp.add(sh);
      S.picks.push(grp);
      stalkPts.push(p.clone(), p.clone().add(new THREE.Vector3(0, 0.55, 0)));
      S.info[id] = { a: a, base: p.clone(), top: p.y + 1.1, center: grp.position.clone(), ringR: 0.75, halo: false, op: 1, isF: true, heat: null, gnd: false, node: true };
      assetChip(a, p.clone().add(new THREE.Vector3(0, 1.45, 0)), 50, frag);
    });
    if (stalkPts.length) g.add(new THREE.LineSegments(bag.keep(new THREE.BufferGeometry().setFromPoints(stalkPts)), mLine(bag, CYAN, 0.5)));
    S.center = new THREE.Vector3(0, hTot / 2, 0);
    S.floorR = S.sceneR = Math.hypot(maxR * 2, hTot + 2) / 2 * 1.05;
    S.focusY = 0; S.walkB = null; S.gridY = -1.0;
    S.holoEmpty = !links.length;
  }

  /* ---------------- 시안 D: 열화상·위험기둥 ---------------- */
  function heatPlane(bag, g, fl, y, pts) {
    var b = bounds(fl), x0 = b.x0 - SLAB_M, y0 = b.y0 - SLAB_M, wmm = b.x1 - b.x0 + 2 * SLAB_M, hmm = b.y1 - b.y0 + 2 * SLAB_M;
    var ppm = Math.min(24, 512 / (Math.max(wmm, hmm) / 1000)), cv = document.createElement('canvas');
    cv.width = Math.max(32, Math.round(wmm / 1000 * ppm)); cv.height = Math.max(32, Math.round(hmm / 1000 * ppm));
    var cg = cv.getContext('2d');
    pts.forEach(function (p) {
      var px = (p.x - x0) / 1000 * ppm, py = (p.y - y0) / 1000 * ppm, r = (1.5 + p.sev * 4) * ppm;
      var grd = cg.createRadialGradient(px, py, 0, px, py, r);
      var c = p.sev >= 0.66 ? '255,23,68' : p.sev >= 0.4 ? '245,158,11' : '6,182,212';
      grd.addColorStop(0, 'rgba(' + c + ',0.9)'); grd.addColorStop(0.5, 'rgba(' + c + ',0.35)'); grd.addColorStop(1, 'rgba(' + c + ',0)');
      cg.fillStyle = grd; cg.fillRect(px - r, py - r, r * 2, r * 2);
    });
    var tex = bag.keep(new THREE.CanvasTexture(cv)); tex.encoding = THREE.sRGBEncoding;
    var pl = mesh(g, bag.keep(new THREE.PlaneGeometry(wmm / 1000, hmm / 1000)), bag.keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })), X(x0 + wmm / 2), y + 0.03, Z(y0 + hmm / 2));
    pl.rotation.x = -Math.PI / 2;
  }
  function buildRisk(focus, frag) {
    var s = st(), stack = !!s.stack, fls = stack ? floorsAll() : [focus];
    var ub = stack ? unionBounds(fls) : bounds(focus);
    S.org = { x: (ub.x0 + ub.x1) / 2, y: (ub.y0 + ub.y1) / 2 };
    var bag = S.bagS, g = S.gStatic, yMin = Infinity, yMax = -Infinity, gap = FLOOR_H * explode();
    var Hmax = stack ? Math.min(4.5, gap * 0.8) : 4.5, nHeat = 0;
    var pillarG = bag.geo('pil', function () { return new THREE.CylinderGeometry(0.34, 0.34, 1, 6); });
    var pickMat = bag.mat('pick', function () { return new THREE.MeshBasicMaterial({ visible: false }); });
    fls.forEach(function (fl) {
      var y = floorY(fl.code), isF = fl.code === focus.code, op = (!stack || isF) ? 1 : (s.ghost ? 0.3 : 0.9), inter = isF || !s.ghost;
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      addSlab(bag, g, fl, y, op, isF, 0x4b5563);
      var pts = [], loops = [];
      roomsOf(fl.code).forEach(function (rm) {
        var x0 = X(rm.x), x1 = X(rm.x + rm.w), z0 = Z(rm.y), z1 = Z(rm.y + rm.h), yy = y + 0.02;
        loops.push(new THREE.Vector3(x0, yy, z0), new THREE.Vector3(x1, yy, z0), new THREE.Vector3(x1, yy, z0), new THREE.Vector3(x1, yy, z1), new THREE.Vector3(x1, yy, z1), new THREE.Vector3(x0, yy, z1), new THREE.Vector3(x0, yy, z1), new THREE.Vector3(x0, yy, z0));
        if (inter) { var tile = mesh(g, bag.box(Math.max(0.1, x1 - x0 - 0.1), 0.02, Math.max(0.1, z1 - z0 - 0.1)), pickMat, (x0 + x1) / 2, y + 0.012, (z0 + z1) / 2); tile.userData = { roomId: rm.id, floor: fl.code }; S.picks.push(tile); }
        var h = heatOf(rm.measures); if (h) { pts.push({ x: rm.x + rm.w / 2, y: rm.y + rm.h / 2, sev: h.sev }); nHeat += h.n; }
        S.roomInfo[rm.id] = { rm: rm, y: y, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, heat: h, gnd: gndBad(rm.measures), op: op, isF: isF };
      });
      if (loops.length) g.add(new THREE.LineSegments(bag.keep(new THREE.BufferGeometry().setFromPoints(loops)), mLine(bag, 0x38bdf8, isF ? 0.7 : 0.3)));
      var places = placeAssets(fl);
      assetsOf(fl.code).forEach(function (a) {
        var p = places[a.id]; if (!p) return;
        var rk = riskOf(a), gc = gHex(gradeOf(a)), h = 0.25 + rk.total / 100 * Hmax;
        var grp = new THREE.Group(); grp.position.set(p.wx, y, p.wz); grp.userData.assetId = a.id; g.add(grp);
        var pil = mesh(grp, pillarG, mStd(bag, gc, op * 0.92, { emissive: gc, emissiveIntensity: 0.38, roughness: 0.35, metalness: 0.2 }), 0, h / 2, 0, op > 0.5);
        pil.scale.y = h;
        mesh(grp, bag.geo('pcap', function () { return new THREE.CylinderGeometry(0.36, 0.36, 0.04, 6); }), mBasic(bag, mixHex(gc, 0xffffff, 0.55), op), 0, h + 0.02, 0);
        var pe = new THREE.LineSegments(bag.geo('pile', function () { return new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.34, 0.34, 1, 6)); }), mLine(bag, mixHex(gc, 0xffffff, 0.5), 0.7 * op));
        pe.scale.y = h; pe.position.y = h / 2; grp.add(pe);
        if (inter) S.picks.push(grp);
        var ht = heatOf(a.measures);
        if (ht) {
          nHeat += ht.n; pts.push({ x: p.x, y: p.y, sev: ht.sev });
          var R = 0.8 + ht.sev * 2.4, col = ht.sev >= 0.66 ? 0xf43f5e : ht.sev >= 0.4 ? 0xf59e0b : 0x06b6d4;
          var dome = mesh(g, bag.geo('dome' + R.toFixed(2), function () { return new THREE.SphereGeometry(R, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2); }), mBasic(bag, col, (ht.sev > 0.5 ? 0.3 : 0.16) * op, { side: THREE.DoubleSide, depthWrite: false }), p.wx, y, p.wz);
          if (ht.sev >= 0.66) pulse(dome, 1.6, 0.08, (ht.sev > 0.5 ? 0.3 : 0.16) * op, 'all');
        }
        S.info[a.id] = { a: a, base: new THREE.Vector3(p.wx, y, p.wz), top: y + h + 0.05, center: new THREE.Vector3(p.wx, y + h * 0.6, p.wz), ringR: 0.62, halo: false, op: op, isF: isF, heat: ht, gnd: gndBad(a.measures) };
        if (inter) assetChip(a, new THREE.Vector3(p.wx, y + h + 0.45, p.wz), isF ? 50 : 20, frag, 'always');
      });
      if (pts.length) heatPlane(bag, g, fl, y, pts);
    });
    S.heatCount = nHeat;
    var b = bounds(focus), fw = (b.x1 - b.x0) / 1000 + 2, fd = (b.y1 - b.y0) / 1000 + 2;
    S.floorR = Math.hypot(fw, fd, Hmax) / 2;
    S.sceneR = stack ? Math.hypot(fw, fd, yMax - yMin + Hmax) / 2 : S.floorR;
    S.focusY = floorY(focus.code);
    S.center = new THREE.Vector3(0, S.focusY + 1.2, 0);
    S.walkB = null; S.gridY = yMin - 1.4;
  }

  /* ---------------- 정적 빌드 ---------------- */
  function buildStatic() {
    var tb = performance.now();
    try { buildStatic0(); } finally { S.buildMs = performance.now() - tb; }
  }
  function buildStatic0() {
    S.need.static = false; S.need.overlay = true;
    clearGroup(S.gStatic, S.bagS); S.bagS = new Bag();
    clearLabels();
    S.ovInGrp = []; S.picks = []; S.anim.sp = []; S.anim.sk = []; S.anim.spin = []; S.info = {}; S.roomInfo = {}; S.roomB = null; S.holoEmpty = false; S.heatCount = 0;
    var s = st(), m = M();
    S.concept = ({ A: 1, B: 1, C: 1, D: 1 })[s.concept] ? s.concept : 'A';
    S.builds++;
    if (!m || !m.floors || !m.floors.length) { S.focus = null; setHud('<b>3D</b> · 설비 데이터를 불러오는 중입니다…'); return; }
    var focus = TX.floor(s.floor) || m.floors[0];
    S.focus = focus;
    var frag = document.createDocumentFragment();
    if (S.concept === 'B') buildRoomB(focus, frag);
    else if (S.concept === 'C') buildHolo(focus, frag);
    else if (S.concept === 'D') buildRisk(focus, frag);
    else buildDoll(focus, frag);
    S.labelsEl.appendChild(frag);
    // 바닥 그리드 · 조명 맞춤
    var gs = Math.ceil(Math.max(20, S.sceneR * 4) / 2) * 2;
    var grid = new THREE.GridHelper(gs, gs / 2, 0x1e3a8a, 0x0b1730);
    grid.position.y = S.gridY != null ? S.gridY : -1; grid.material.transparent = true; grid.material.opacity = 0.45; grid.material.depthWrite = false;
    S.gStatic.add(grid);
    var R = S.sceneR, dl = S.lights.dir, c = S.center;
    dl.position.set(c.x + R * 0.7, c.y + R * 1.6, c.z + R * 1.0);
    dl.target.position.copy(c);
    var sc = dl.shadow.camera; sc.left = -R * 1.15; sc.right = R * 1.15; sc.top = R * 1.15; sc.bottom = -R * 1.15; sc.near = 0.5; sc.far = R * 5;
    sc.updateProjectionMatrix();
    S.lights.rim.position.set(c.x - R, c.y + R * 0.6, c.z - R * 1.2);
    S.renderer.shadowMap.needsUpdate = true;
    var o = S.orbit;
    if (S.need.fit) { S.need.fit = false; fitCamera(!S.fitOnce); S.fitOnce = true; }
    else { o.gT.copy(S.center); }
    o.minR = Math.max(1.2, Math.min(S.sceneR, S.floorR) * 0.12); o.maxR = Math.max(fitR(S.sceneR), fitR(S.floorR)) * 3;
    if (walkActive()) initWalk(false);
    syncHud();
    S.camDirty = true;
  }
  function fitR(R) {
    var cam = S.camera, fov = cam.fov * Math.PI / 180, asp = S.w && S.h ? Math.max(0.3, (S.safe ? S.safe.w : S.w) / (S.safe ? S.safe.h : S.h)) : 1.6;
    var fh = 2 * Math.atan(Math.tan(fov / 2) * asp);
    var k = asp >= 1.4 ? 0.82 : asp <= 0.8 ? 1.0 : 1.0 - (asp - 0.8) / 0.6 * 0.18;
    return R / Math.sin(Math.min(fov, fh) / 2) * k;
  }
  function fitCamera(snap) {
    var o = S.orbit;
    o.gT.copy(S.center); o.gR = fitR(S.sceneR); S.userZoom = false;
    if (snap) { o.tgt.copy(o.gT); o.r = o.gR; }
  }

  /* ---------------- 오버레이 빌드 (선택·장애·링크·접지·열화상·실 강조) ---------------- */
  function buildOverlay() {
    S.need.overlay = false;
    (S.ovInGrp || []).forEach(function (o) { if (o.parent) o.parent.remove(o); }); S.ovInGrp = [];
    clearGroup(S.gOverlay, S.bagO); S.bagO = new Bag(); S.anim.op = []; S.anim.ok = [];
    var s = st(), sel = s.selected, f = faultInfo(), L = s.layers || {}, bag = S.bagO, g = S.gOverlay, cpt = S.concept;
    var torus = function (r, t) { return bag.geo('tor' + r + '|' + t, function () { return new THREE.TorusGeometry(r, t, 8, 40); }); };
    Object.keys(S.info).forEach(function (id) {
      var inf = S.info[id], a = inf.a, isSel = id === sel, isSrc = f && id === f.src, imp = f && f.imp.get(id);
      var gc = gHex(gradeOf(a));
      if (inf.halo) {
        var halo = mesh(g, torus(0.22, 0.028), mBasic(bag, isSel ? CYAN : isSrc ? FAULT : gc, 0.95 * inf.op), inf.base.x, inf.top + 0.3, inf.base.z);
        halo.rotation.x = Math.PI / 2;
        pulse(halo, a.grade === 'RED' || isSrc ? 3 : 1.4, a.grade === 'RED' || isSrc ? 0.35 : isSel ? 0.25 : 0.1, 0.95 * inf.op, 'flat', true);
      }
      if (isSel || isSrc || imp) {
        var col = isSrc ? FAULT : imp ? (impSev(imp) === 'outage' ? 0xf43f5e : 0xf59e0b) : CYAN;
        var R = inf.ringR, rp = inf.node ? inf.base : inf.base;
        var ring = mesh(g, bag.geo('rg' + R.toFixed(2), function () { return new THREE.RingGeometry(R * 0.78, R, 48); }), mBasic(bag, col, 0.85, { side: THREE.DoubleSide, depthWrite: false }), rp.x, rp.y + 0.035, rp.z);
        ring.rotation.x = -Math.PI / 2;
        if (isSrc || imp) pulse(ring, isSrc ? 3.2 : 2.2, isSrc ? 0.7 : 0.4, 0.85, 'flat', true);
        if (isSel && !inf.box) { // 선택 표시 수직 가이드
          var gl = mesh(g, bag.geo('selbeam', function () { return new THREE.CylinderGeometry(R * 0.9, R * 0.9, 1, 32, 1, true); }), mBasic(bag, CYAN, 0.1, { side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), rp.x, (rp.y + inf.top) / 2 + 0.1, rp.z);
          gl.scale.y = Math.max(0.3, inf.top - rp.y + 0.2);
        }
      }
      if (inf.box && (isSel || isSrc || imp)) { // B: 랙 내부 장비 강조
        var bx = new THREE.LineSegments(bag.edges(0.52, inf.box.h + 0.01, 0.88), mLine(bag, isSel ? CYAN : FAULT, 1));
        bx.position.set(0, inf.box.y, 0.02); inf.box.grp.add(bx); S.ovInGrp = S.ovInGrp || []; S.ovInGrp.push(bx);
        var hl = mesh(inf.box.grp, bag.box(0.5, inf.box.h + 0.005, 0.02), mBasic(bag, isSel ? CYAN : FAULT, 0.5, { blending: THREE.AdditiveBlending, depthWrite: false }), 0, inf.box.y, 0.5);
        S.ovInGrp.push(hl); pulse(hl, 2.4, 0.04, 0.5, 'all', true);
      }
      if (L.ground !== false && inf.gnd && cpt !== 'C') {
        var gr = mesh(g, torus(0.42, 0.035), mBasic(bag, 0xfacc15, 0.9), inf.base.x, inf.base.y + 0.06, inf.base.z);
        gr.rotation.x = -Math.PI / 2; pulse(gr, 1.6, 0.25, 0.9, 'flat', true);
      }
      if (L.thermal && inf.heat && (cpt === 'A' || cpt === 'B')) addDome(bag, g, inf.base, inf.heat, inf.op);
    });
    Object.keys(S.roomInfo).forEach(function (rid) {
      var ri = S.roomInfo[rid];
      if (L.thermal && ri.heat && cpt === 'A') addDome(bag, g, new THREE.Vector3(ri.cx, ri.y, ri.cz), ri.heat, ri.op);
      if (L.ground !== false && ri.gnd && cpt !== 'C') { var q = mesh(g, torus(Math.min(ri.w, ri.d) * 0.3, 0.04), mBasic(bag, 0xfacc15, 0.7), ri.cx, ri.y + 0.06, ri.cz); q.rotation.x = -Math.PI / 2; pulse(q, 1.2, 0.08, 0.7, 'flat', true); }
      if (rid === s.room && ri.isF && (cpt === 'A' || cpt === 'D')) {
        var hp = mesh(g, bag.box(Math.max(0.1, ri.w - 0.14), 0.01, Math.max(0.1, ri.d - 0.14)), mBasic(bag, 0x38bdf8, 0.2, { depthWrite: false }), ri.cx, ri.y + 0.02, ri.cz);
        void hp;
        var ol = new THREE.LineSegments(bag.edges(ri.w - 0.1, 0.02, ri.d - 0.1), mLine(bag, 0x38bdf8, 1)); ol.position.set(ri.cx, ri.y + 0.03, ri.cz); g.add(ol);
      }
    });
    if ((cpt === 'A' && L.links !== false) || cpt === 'C' || (cpt === 'B' && L.links !== false) || (cpt === 'D' && L.links !== false && f)) addArcs(bag, g, f, sel, cpt);
    // 라벨 상태
    S.anchors.forEach(function (an) {
      if (!an.isA) { an.el.classList.toggle('tx-sel', an.id === s.room); return; }
      var isSel = an.id === sel, im = f && (an.id === f.src || f.imp.has(an.id));
      an.el.classList.toggle('tx-sel', isSel); an.el.classList.toggle('tx-imp', !!im); an.el.classList.toggle('tx-src', !!(f && an.id === f.src));
      an.pri = an.base + (isSel ? 200 : 0) + (im ? 90 : 0);
    });
    syncHud();
    S.camDirty = true;
  }
  function addDome(bag, g, p, h, op) {
    var R = 0.7 + h.sev * 2.2, col = h.sev >= 0.66 ? 0xf43f5e : h.sev >= 0.4 ? 0xf59e0b : 0x06b6d4;
    mesh(g, bag.geo('od' + R.toFixed(2), function () { return new THREE.SphereGeometry(R, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2); }), mBasic(bag, col, (h.sev > 0.5 ? 0.28 : 0.14) * op, { side: THREE.DoubleSide, depthWrite: false }), p.x, p.y, p.z);
  }
  function addArcs(bag, g, f, sel, cpt) {
    var links = (M() && M().links) || [], pg = bag.geo('apk', function () { return new THREE.SphereGeometry(1, 12, 10); });
    var faint = {}, ex = explode();
    links.forEach(function (l) {
      var A = S.info[l.from], B = S.info[l.to]; if (!A || !B || l.from === l.to) return;
      var onPath = f && (l.from === f.src || f.imp.has(l.from)) && f.imp.has(l.to);
      var touch = l.from === sel || l.to === sel, meta = linkMeta(l.type), col = onPath ? FAULT : meta.hex;
      var p1 = cpt === 'C' ? A.center.clone() : new THREE.Vector3(A.base.x, A.top + 0.05, A.base.z);
      var p2 = cpt === 'C' ? B.center.clone() : new THREE.Vector3(B.base.x, B.top + 0.05, B.base.z);
      if (cpt === 'B' && A.box) p1 = A.center.clone(); if (cpt === 'B' && B.box) p2 = B.center.clone();
      var dist = p1.distanceTo(p2), mid = p1.clone().add(p2).multiplyScalar(0.5);
      mid.y = Math.max(p1.y, p2.y) + (cpt === 'C' ? 0.6 + dist * 0.12 : 0.6 + dist * 0.18) / (cpt === 'C' ? 1 : 1) * (cpt === 'C' ? ex / 1.5 : 1);
      var curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      var strong = onPath || touch || cpt === 'C';
      if (strong) {
        var rad = onPath ? 0.07 : touch ? 0.05 : 0.04;
        var tube = new THREE.Mesh(bag.keep(new THREE.TubeGeometry(curve, 48, rad, 6, false)), mBasic(bag, col, onPath ? 0.95 : touch ? 0.9 : 0.55, onPath || cpt !== 'C' ? { depthWrite: false } : { depthWrite: false, blending: THREE.AdditiveBlending }));
        g.add(tube);
        var n = onPath ? 3 : 2, sz = onPath ? 0.14 : 0.09;
        for (var i = 0; i < n; i++) {
          var pk = mesh(g, pg, mBasic(bag, onPath ? 0xffffff : mixHex(col, 0xffffff, 0.5), 1), p1.x, p1.y, p1.z);
          pk.scale.setScalar(sz);
          packet(pk, { curve: curve, p: i / n + (Math.abs(U.hash(l.id || l.from)) % 100) / 300, spd: onPath ? 0.012 : 0.0045 }, true);
        }
      } else {
        var key = col + (meta.dash ? 'd' : '');
        (faint[key] = faint[key] || { col: col, dash: meta.dash, pts: [] });
        var ps = curve.getPoints(28);
        for (var j = 0; j < ps.length - 1; j++) { if (meta.dash && j % 2) continue; faint[key].pts.push(ps[j], ps[j + 1]); }
      }
    });
    Object.keys(faint).forEach(function (k) {
      var fz = faint[k];
      g.add(new THREE.LineSegments(bag.keep(new THREE.BufferGeometry().setFromPoints(fz.pts)), mLine(bag, fz.col, 0.42)));
    });
  }

  /* ---------------- 카메라 ---------------- */
  function walkActive() { return !!(st().walk && S.concept === 'A' && S.walkB); }
  function initWalk(force) {
    var w = S.walk;
    if (w.init && !force && w.floor === (S.focus && S.focus.code)) return;
    w.init = true; w.floor = S.focus && S.focus.code;
    var corr = roomsOf(S.focus.code).filter(function (r) { return r.type === 'corr'; }).sort(function (a, b) { return b.w * b.h - a.w * a.h; })[0];
    if (corr) {
      var along = corr.w >= corr.h;
      w.x = X(along ? corr.x + Math.min(1500, corr.w * 0.1) : corr.x + corr.w / 2);
      w.z = Z(along ? corr.y + corr.h / 2 : corr.y + Math.min(1500, corr.h * 0.1));
      w.yaw = along ? 0 : Math.PI / 2;
    } else {
      var sr = st().room && TX.room(st().room), rs = roomsOf(S.focus.code).slice().sort(function (a, b) { return b.w * b.h - a.w * a.h; });
      var rm = sr && sr.floor === S.focus.code ? sr : rs[0];
      if (rm) {
        var dr = doorsOf(S.focus)[rm.id] || { side: 'S', at: rm.x + rm.w / 2 }, cxm = rm.x + rm.w / 2, cym = rm.y + rm.h / 2, ins = 900;
        var px = dr.side === 'W' ? rm.x + ins : dr.side === 'E' ? rm.x + rm.w - ins : dr.at, py = dr.side === 'N' ? rm.y + ins : dr.side === 'S' ? rm.y + rm.h - ins : dr.at;
        w.x = X(px); w.z = Z(py); w.yaw = Math.atan2(Z(cym) - w.z, X(cxm) - w.x);
        if (Math.hypot(Z(cym) - w.z, X(cxm) - w.x) < 0.2) w.yaw = 0;
      } else { w.x = (S.walkB.x0 + S.walkB.x1) / 2; w.z = (S.walkB.z0 + S.walkB.z1) / 2; w.yaw = 0; }
    }
    w.pitch = -0.06; w.keys = {};
  }
  function applyCamera() {
    var cam = S.camera, o = S.orbit, fog = S.scene.fog;
    if (walkActive()) {
      var w = S.walk, y = S.focusY + EYE;
      cam.position.set(w.x, y, w.z);
      cam.lookAt(w.x + Math.cos(w.yaw) * Math.cos(w.pitch), y + Math.sin(w.pitch), w.z + Math.sin(w.yaw) * Math.cos(w.pitch));
      cam.near = 0.05; cam.far = 400; fog.near = 12; fog.far = Math.max(40, S.floorR * 3);
    } else {
      var r = o.r;
      cam.position.set(o.tgt.x + r * Math.sin(o.phi) * Math.sin(o.theta), o.tgt.y + r * Math.cos(o.phi), o.tgt.z + r * Math.sin(o.phi) * Math.cos(o.theta));
      cam.lookAt(o.tgt);
      cam.near = Math.max(0.05, r * 0.01); cam.far = r * 6 + S.sceneR * 8 + 100;
      fog.near = r + S.sceneR * 0.35; fog.far = r + S.sceneR * 3.2;
    }
    cam.updateProjectionMatrix();
    S.camDirty = true;
  }
  function angDiff(a, b) { var d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
  function stepCamera(dt) {
    var o = S.orbit, k = 1 - Math.pow(0.0008, dt), moved = false;
    if (walkActive()) {
      var w = S.walk, K = w.keys, fwd = ((K.KeyW || K.ArrowUp) ? 1 : 0) - ((K.KeyS || K.ArrowDown) ? 1 : 0), side = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), turn = (K.ArrowRight || K.KeyE ? 1 : 0) - (K.ArrowLeft || K.KeyQ ? 1 : 0);
      if (fwd || side || turn) {
        w.yaw += turn * 1.8 * dt;
        var sp = (K.ShiftLeft || K.ShiftRight ? 6.5 : 3.2) * dt, b = S.walkB;
        w.x = U.clamp(w.x + (Math.cos(w.yaw) * fwd - Math.sin(w.yaw) * side) * sp, b.x0 + 0.4, b.x1 - 0.4);
        w.z = U.clamp(w.z + (Math.sin(w.yaw) * fwd + Math.cos(w.yaw) * side) * sp, b.z0 + 0.4, b.z1 - 0.4);
        moved = true;
      }
    } else {
      if (o.tgt.distanceToSquared(o.gT) > 1e-6) { o.tgt.lerp(o.gT, k); moved = true; }
      if (Math.abs(o.r - o.gR) > 1e-3) { o.r += (o.gR - o.r) * k; moved = true; }
      if (o.gTheta != null) { var d = angDiff(o.theta, o.gTheta); if (Math.abs(d) < 1e-3) { o.theta = o.gTheta; o.gTheta = null; } else o.theta += d * k; moved = true; }
      if (o.gPhi != null) { var dp = o.gPhi - o.phi; if (Math.abs(dp) < 1e-3) { o.phi = o.gPhi; o.gPhi = null; } else o.phi += dp * k; moved = true; }
    }
    if (moved || S.camDirty) applyCamera();
  }
  function flyTo(id) {
    var inf = S.info[id]; if (!inf || walkActive()) return false;
    var o = S.orbit;
    o.gT.copy(inf.center);
    o.gR = Math.min(o.r, Math.max(o.minR * 2, fitR(Math.max(3, S.floorR * 0.42))));
    return true;
  }
  function preset(p) {
    var o = S.orbit;
    if (p === 'focus') {
      var s = st();
      if (s.selected && flyTo(s.selected)) return;
      var ri = s.room && S.roomInfo[s.room];
      if (ri) { o.gT.set(ri.cx, ri.y + 0.8, ri.cz); o.gR = fitR(Math.max(3, Math.hypot(ri.w, ri.d) / 2 * 1.1)); return; }
      p = 'reset';
    }
    if (walkActive()) TX.setState({ walk: false });
    if (p === 'iso' || p === 'reset') { o.gTheta = 0.62; o.gPhi = 0.9; }
    else if (p === 'front') { o.gTheta = 0; o.gPhi = 1.22; }
    else if (p === 'top') { o.gTheta = 0; o.gPhi = 0.02; }
    if (p === 'reset' || p === 'top' || p === 'front' || p === 'iso') { o.gT.copy(S.center || new THREE.Vector3()); o.gR = fitR(S.sceneR) * (p === 'top' ? 0.92 : 1); S.userZoom = false; }
  }

  /* ---------------- 입력 ---------------- */
  function isTyping(e) { var t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  function raycast(cx, cy) {
    var rect = S.canvas.getBoundingClientRect();
    var v = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    S.ray.setFromCamera(v, S.camera);
    var hits = S.ray.intersectObjects(S.picks, true), room = null;
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object, aid = null, rid = null, skip = false;
      while (o) { if (o.userData.noPick) skip = true; if (o.userData.assetId && !aid) aid = o.userData.assetId; if (o.userData.roomId && !rid) rid = o.userData.roomId; if (aid) break; o = o.parent; }
      if (skip) continue;
      if (aid) return { assetId: aid };
      if (rid && !room) room = { roomId: rid, floor: hits[i].object.userData.floor };
    }
    return room;
  }
  function bindInput() {
    var cv = S.canvas, ptrs = new Map(), mode = null, drag = 0, pinch0 = 0, r0 = 0, mid0 = null, btn = 0;
    function pan(dx, dy) {
      var o = S.orbit, kk = o.r * 0.0017, th = o.theta;
      o.tgt.x -= (Math.cos(th) * dx - Math.sin(th) * dy) * kk; o.tgt.z -= (-Math.sin(th) * dx - Math.cos(th) * dy) * kk;
      var c = S.center || new THREE.Vector3(), lim = S.sceneR * 1.6, ddx = o.tgt.x - c.x, ddz = o.tgt.z - c.z, dd = Math.hypot(ddx, ddz);
      if (dd > lim) { o.tgt.x = c.x + ddx / dd * lim; o.tgt.z = c.z + ddz / dd * lim; }
      o.gT.copy(o.tgt);
    }
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('pointerdown', function (e) {
      try { cv.focus({ preventScroll: true }); cv.setPointerCapture(e.pointerId); } catch (x) { }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) { drag = 0; btn = e.button; mode = (e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey) ? 'pan' : 'rot'; }
      else if (ptrs.size === 2) {
        var p = Array.from(ptrs.values()); pinch0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1; r0 = S.orbit.r;
        mid0 = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; mode = 'pinch'; drag += 10;
      }
      S.orbit.gTheta = S.orbit.gPhi = null;
      if (!walkActive()) { S.orbit.gT.copy(S.orbit.tgt); S.orbit.gR = S.orbit.r; }
      cv.classList.add('tx-s3-drag');
    });
    cv.addEventListener('pointermove', function (e) {
      if (!ptrs.has(e.pointerId)) {
        var now = performance.now();
        if (now - S.hoverT > 90 && S.camera) { S.hoverT = now; var h = raycast(e.clientX, e.clientY); cv.style.cursor = h ? 'pointer' : ''; }
        return;
      }
      var prev = ptrs.get(e.pointerId), dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      var o = S.orbit;
      if (mode === 'pinch' && ptrs.size >= 2) {
        var p = Array.from(ptrs.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        if (walkActive()) { var w0 = S.walk; w0.x += Math.cos(w0.yaw) * (d - pinch0) * 0.004; pinch0 = d; }
        else { o.r = o.gR = U.clamp(r0 * pinch0 / d, o.minR, o.maxR); pan(mid.x - mid0.x, mid.y - mid0.y); S.userZoom = true; }
        mid0 = mid; S.camDirty = true; return;
      }
      if (ptrs.size !== 1) return;
      drag += Math.abs(dx) + Math.abs(dy);
      if (walkActive()) { var w = S.walk; w.yaw += dx * 0.005; w.pitch = U.clamp(w.pitch - dy * 0.004, -0.75, 0.6); }
      else if (mode === 'pan') pan(dx, dy);
      else { o.theta -= dx * 0.0075; o.phi = U.clamp(o.phi - dy * 0.0065, 0.02, 1.48); }
      S.camDirty = true;
    });
    function end(e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size === 0) {
        cv.classList.remove('tx-s3-drag');
        if (e.type === 'pointerup' && drag < 6 && mode !== 'pinch' && btn === 0) {
          var h = raycast(e.clientX, e.clientY);
          if (h && h.assetId) TX.select(h.assetId);
          else if (h && h.roomId) { var patch = { room: h.roomId }; if (h.floor && h.floor !== st().floor) patch.floor = h.floor; TX.setState(patch); }
        }
        mode = null;
      } else if (ptrs.size === 1) { mode = 'rot'; }
    }
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('dblclick', function (e) {
      var h = raycast(e.clientX, e.clientY);
      if (h && h.assetId) { if (h.assetId !== st().selected) TX.select(h.assetId); flyTo(h.assetId); }
      else if (h && h.roomId) { TX.setState({ room: h.roomId }); S.pendingPreset = 'focus'; }
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      if (walkActive()) { var w = S.walk, b = S.walkB; w.x = U.clamp(w.x - Math.cos(w.yaw) * dy * 0.006, b.x0 + 0.4, b.x1 - 0.4); w.z = U.clamp(w.z - Math.sin(w.yaw) * dy * 0.006, b.z0 + 0.4, b.z1 - 0.4); }
      else { var o = S.orbit; o.gR = U.clamp(o.gR * Math.exp(dy * 0.0012), o.minR, o.maxR); S.userZoom = true; }
      S.camDirty = true;
    }, { passive: false });
    window.addEventListener('keydown', function (e) {
      if (!walkActive() || !running() || isTyping(e)) return;
      if (e.code === 'Escape') { TX.setState({ walk: false }); return; }
      if (/^(KeyW|KeyA|KeyS|KeyD|KeyQ|KeyE|Arrow\w+|ShiftLeft|ShiftRight)$/.test(e.code)) { S.walk.keys[e.code] = true; if (/^Arrow/.test(e.code)) e.preventDefault(); }
    });
    window.addEventListener('keyup', function (e) { delete S.walk.keys[e.code]; });
    window.addEventListener('blur', function () { S.walk.keys = {}; });
  }

  /* ---------------- 라벨 투영 · 겹침 컬링 ---------------- */
  var _v = null;
  function updateLabels() {
    var el = S.labelsEl, show = st().labels !== false;
    el.style.display = show ? '' : 'none';
    if (!show) return;
    var w = S.w, h = S.h, cam = S.camera, walk = walkActive(), cand = [];
    cam.updateMatrixWorld();
    S.anchors.forEach(function (an) {
      _v.copy(an.pos).project(cam);
      var ok = _v.z < 1 && _v.z > -1;
      if (ok && walk && an.pos.distanceTo(cam.position) > 22) ok = false;
      if (ok) {
        an.sx = (_v.x * 0.5 + 0.5) * w; an.sy = (-_v.y * 0.5 + 0.5) * h;
        if (an.sx < 6 || an.sx > w - 6 || an.sy < 18 || an.sy > h - 4) ok = false;
      }
      if (ok) cand.push(an); else if (an.vis) { an.el.style.visibility = 'hidden'; an.vis = false; }
    });
    cand.sort(function (a, b) { return b.pri - a.pri || a.sy - b.sy; });
    var placed = [];
    cand.forEach(function (an) {
      if (!an.w) { an.w = an.el.offsetWidth || 80; an.h = an.el.offsetHeight || 18; }
      var x0 = an.sx - an.w / 2 - 2, x1 = x0 + an.w + 4, dy = 0, ok = false;
      for (var step = 0; step < 3 && !ok; step++) { // 겹치면 위로 최대 2칸 비켜 배치
        dy = -step * (an.h + 3);
        var y0 = an.sy - an.h - 2 + dy, y1 = y0 + an.h + 4, hit = false;
        for (var i = 0; i < placed.length && !hit; i++) { var p = placed[i]; if (x0 < p[2] && x1 > p[0] && y0 < p[3] && y1 > p[1]) hit = true; }
        if (!hit && y0 > 14) ok = true;
      }
      if (!ok && an.pri < 200) { if (an.vis) { an.el.style.visibility = 'hidden'; an.vis = false; } return; }
      if (!ok) dy = 0;
      an.dy = dy;
      placed.push([x0, an.sy - an.h - 2 + dy, x1, an.sy + 2 + dy]);
      an.el.style.transform = 'translate3d(' + (an.sx - an.w / 2).toFixed(1) + 'px,' + (an.sy - an.h + dy).toFixed(1) + 'px,0)';
      an.el.style.zIndex = String(Math.min(999, Math.round(an.pri)));
      if (!an.vis) { an.el.style.visibility = 'visible'; an.vis = true; }
    });
  }

  /* ---------------- 미니맵 ---------------- */
  function drawMini() {
    var wrap = S.miniWrap, fl = S.concept === 'B' && S.roomB ? TX.floor(S.roomB.floor) : S.focus;
    if (!fl || S.concept === 'C' || S.w < 360) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    var b = bounds(fl), bw = b.x1 - b.x0, bh = b.y1 - b.y0, W = S.w < 700 ? 150 : 210, H = Math.round(U.clamp(W * bh / bw, 60, 150));
    var dpr = Math.min(2, window.devicePixelRatio || 1), cv = S.miniEl;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var pad = 6, s = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh), ox = (W - bw * s) / 2, oy = (H - bh * s) / 2;
    var MX = function (mm) { return ox + (mm - b.x0) * s; }, MY = function (mm) { return oy + (mm - b.y0) * s; };
    S.miniMap = { s: s, ox: ox, oy: oy, b: b };
    g.fillStyle = '#0b1324'; g.fillRect(0, 0, W, H);
    var sel = st().room, f = faultInfo(), roomB = S.roomB && S.roomB.id;
    roomsOf(fl.code).forEach(function (r) {
      var col = roomStyle(r.type).fill, hot = TECH[r.type];
      g.fillStyle = r.type === 'corr' ? 'rgba(148,163,184,0.16)' : hot ? 'rgba(249,115,22,0.22)' : 'rgba(148,163,184,0.10)';
      g.fillRect(MX(r.x), MY(r.y), r.w * s, r.h * s);
      g.strokeStyle = r.id === sel || r.id === roomB ? '#38bdf8' : hot ? '#f97316' : '#475569'; g.lineWidth = r.id === sel || r.id === roomB ? 1.6 : 0.8;
      g.strokeRect(MX(r.x) + 0.5, MY(r.y) + 0.5, Math.max(1, r.w * s - 1), Math.max(1, r.h * s - 1));
      void col;
    });
    g.strokeStyle = 'rgba(250,204,21,0.85)';
    (fl.trays || []).forEach(function (t) { if (!t || !t.a) return; g.lineWidth = t.main ? 1.6 : 1; g.beginPath(); g.moveTo(MX(t.a[0]), MY(t.a[1])); g.lineTo(MX(t.b[0]), MY(t.b[1])); g.stroke(); });
    ((M() && M().risers) || []).forEach(function (r) { if (r.floors && r.floors.length && r.floors.indexOf(fl.code) < 0) return; g.fillStyle = '#0ea5e9'; g.fillRect(MX(r.x) - 2.5, MY(r.y) - 2.5, 5, 5); });
    assetsOf(fl.code).forEach(function (a) {
      var inf = S.info[a.id]; var ax = inf ? inf.base.x * 1000 + S.org.x : a.x, ay = inf ? inf.base.z * 1000 + S.org.y : a.y;
      if (ax == null) return;
      var im = f && (a.id === f.src || f.imp.has(a.id));
      g.fillStyle = im ? '#ff1744' : (C.GRADE[gradeOf(a)] || C.GRADE.NONE).css;
      g.beginPath(); g.arc(MX(ax), MY(ay), a.id === st().selected ? 3.4 : 2.1, 0, Math.PI * 2); g.fill();
      if (a.id === st().selected) { g.strokeStyle = '#22d3ee'; g.lineWidth = 1.4; g.stroke(); }
    });
    // 카메라 위치 · 시야각
    var cam = S.camera, cx, cz, dx, dz;
    if (walkActive()) { cx = S.walk.x; cz = S.walk.z; dx = Math.cos(S.walk.yaw); dz = Math.sin(S.walk.yaw); }
    else { cx = cam.position.x; cz = cam.position.z; var tx = S.orbit.tgt.x - cx, tz = S.orbit.tgt.z - cz, l = Math.hypot(tx, tz) || 1; dx = tx / l; dz = tz / l; if (l < 0.01) { dx = 0; dz = -1; } }
    var mmx = cx * 1000 + S.org.x, mmy = cz * 1000 + S.org.y;
    var px = U.clamp(MX(mmx), 4, W - 4), py = U.clamp(MY(mmy), 4, H - 4), a1 = Math.atan2(dz, dx);
    var hf = Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect), L = 30;
    g.fillStyle = 'rgba(56,189,248,0.25)'; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a1 - hf) * L, py + Math.sin(a1 - hf) * L); g.lineTo(px + Math.cos(a1 + hf) * L, py + Math.sin(a1 + hf) * L); g.closePath(); g.fill();
    g.fillStyle = '#38bdf8'; g.strokeStyle = '#fff'; g.lineWidth = 1.3; g.beginPath(); g.arc(px, py, 3.6, 0, Math.PI * 2); g.fill(); g.stroke();
    S.miniHead.innerHTML = '<b>미니맵</b> ' + U.esc(fl.name || fl.code) + '<span>' + (walkActive() ? '워크 ' : '') + 'X ' + cx.toFixed(1) + ' · Z ' + cz.toFixed(1) + ' m</span>';
  }
  function bindMini() {
    S.miniEl.addEventListener('click', function (e) {
      var mm = S.miniMap; if (!mm) return;
      var r = S.miniEl.getBoundingClientRect(), x = (e.clientX - r.left - mm.ox) / mm.s + mm.b.x0, y = (e.clientY - r.top - mm.oy) / mm.s + mm.b.y0;
      var wx = X(x), wz = Z(y);
      if (walkActive()) { var b = S.walkB; S.walk.x = U.clamp(wx, b.x0 + 0.4, b.x1 - 0.4); S.walk.z = U.clamp(wz, b.z0 + 0.4, b.z1 - 0.4); }
      else { S.orbit.gT.x = wx; S.orbit.gT.z = wz; }
      S.camDirty = true;
    });
  }

  /* ---------------- HUD ---------------- */
  function setHud(html) { if (S.hudEl) S.hudEl.innerHTML = html; }
  function syncHud() {
    if (!S.hudEl || !S.focus) return;
    var s = st(), cpt = S.concept, parts = ['<b>3D · 시안 ' + cpt + ' ' + CONCEPT_NAME[cpt] + '</b>'];
    if (cpt === 'B' && S.roomB) parts.push(U.esc(S.roomB.name) + (S.genericFill ? ' · <i class="tx-s3-hf" style="color:#fbbf24">랙 내부 장비는 예시 그림(실장 정보 미등록)</i>' : ''));
    else if (cpt === 'C') parts.push('계통 노드 ' + Object.keys(S.info).length + (S.holoEmpty ? ' · 등록된 연결 관계 없음' : ''));
    else parts.push(U.esc(S.focus.name || S.focus.code) + (s.stack ? ' · 전층 적층' : ''));
    var f = faultInfo();
    if (f) parts.push('<i class="tx-s3-hf">장애 파급 ' + (f.src ? U.esc(f.src) + ' → ' : '') + f.imp.size + '대</i>');
    if (cpt === 'D' || (s.layers && s.layers.thermal)) {
      var n = 0; Object.keys(S.info).forEach(function (k) { if (S.info[k].heat) n++; });
      parts.push(n ? '발열 실측(정기점검) ' + n + '개소' : '발열 실측(정기점검) 자료 없음');
      if (cpt === 'D') parts.push(TX.analysis ? '기둥 = 위험점수' : '기둥 = 등급 기반 추정');
    }
    var hint = walkActive() ? 'W·A·S·D 이동 · ←→ 회전 · 드래그 시선 · Shift 빠르게 · Esc 종료' : '드래그 회전 · 우클릭/Shift 팬 · 휠 줌 · 더블클릭 포커스';
    S.hudEl.innerHTML = '<div>' + parts.join(' · ') + '</div><small>' + hint + '</small>';
  }

  /* ---------------- 애니메이션 · 루프 ---------------- */
  function animate(t, dt) {
    var ph = t * 0.003, sel = st().selected;
    function pl(m) {
      var d = m.userData.pl, x = Math.sin(ph * d.spd) * 0.5 + 0.5, sc = 1 + x * d.amp;
      if (d.mode === 'flat') m.scale.set(sc, sc, 1); else if (d.mode === 'radial') m.scale.set(sc, m.scale.y, sc); else m.scale.setScalar(sc);
      if (m.material.transparent) m.material.opacity = d.op * (0.55 + 0.45 * Math.cos(ph * d.spd));
    }
    S.anim.sp.forEach(pl); S.anim.op.forEach(pl);
    function pk(m) {
      var d = m.userData.pk; d.p = (d.p + d.spd * dt * 60) % 1;
      if (d.curve) d.curve.getPoint(d.p, m.position); else m.position.lerpVectors(d.a, d.b, d.p);
    }
    S.anim.sk.forEach(pk); S.anim.ok.forEach(pk);
    S.anim.spin.forEach(function (m) { m.rotation.z += m.userData.spin * dt; if (m.type === 'LineSegments') m.rotation.y += m.userData.spin * dt; });
    void sel;
  }
  function running() { return !!S.raf; }
  function canRun() {
    if (!S.renderer || !S.host || S.failed || document.hidden) return false;
    if (!S.host.isConnected || S.host.clientWidth < 2 || S.host.clientHeight < 2) return false;
    if (S.devRoot && S.host.parentNode === S.devRoot) return !!st().open;
    if (TX.ui && TX.ui.view3d === S.host && typeof TX.ui.isVisible === 'function') { try { return !!TX.ui.isVisible('3d'); } catch (e) { } }
    var v = st().view; return !!st().open && (v === '3d' || v === 'split');
  }
  function frame(t) {
    var dt = Math.min(0.1, Math.max(0.001, (t - (S.last || t)) / 1000)); S.last = t;
    if (S.need.static) buildStatic();
    if (S.need.overlay) buildOverlay();
    if (S.pendingFly) { flyTo(S.pendingFly); S.pendingFly = null; }
    if (S.pendingPreset) { preset(S.pendingPreset); S.pendingPreset = null; }
    stepCamera(dt);
    animate(t, dt);
    var t0 = performance.now();
    S.renderer.render(S.scene, S.camera);
    S.frameMs = S.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    if (S.camDirty) { S.camDirty = false; updateLabels(); drawMini(); }
  }
  function loop(t) { S.raf = requestAnimationFrame(loop); try { frame(t); } catch (e) { console.error('[TwinX.scene3d]', e); stopLoop(); S.failed = true; } }
  function startLoop() { if (S.raf || !canRun()) return; S.last = 0; S.raf = requestAnimationFrame(loop); }
  function stopLoop() { if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; }
  function checkRun() { if (canRun()) { resize(); startLoop(); } else stopLoop(); }

  /* ---------------- 마운트 · 초기화 ---------------- */
  function init() {
    var wrap = U.el('div', 'tx-s3');
    var canvas = document.createElement('canvas'); canvas.className = 'tx-s3-canvas'; canvas.tabIndex = 0; canvas.setAttribute('aria-label', '3D 디지털 트윈 뷰');
    wrap.appendChild(canvas);
    S.labelsEl = U.el('div', 'tx-s3-labels'); wrap.appendChild(S.labelsEl);
    S.miniWrap = U.el('div', 'tx-s3-mini'); S.miniHead = U.el('div', 'tx-s3-mini-h'); S.miniEl = document.createElement('canvas'); S.miniEl.title = '클릭: 해당 위치로 이동';
    S.miniWrap.appendChild(S.miniHead); S.miniWrap.appendChild(S.miniEl); wrap.appendChild(S.miniWrap);
    // 미니맵 접기: 헤더 클릭 토글, 좁은 화면(≤760px)은 기본 접힘
    if (window.innerWidth <= 760) S.miniWrap.classList.add('tx-s3-mini-c');
    S.miniHead.title = '클릭: 미니맵 접기/펼치기';
    S.miniHead.addEventListener('click', function (e) { e.stopPropagation(); S.miniWrap.classList.toggle('tx-s3-mini-c'); });
    S.hudEl = U.el('div', 'tx-s3-hud'); wrap.appendChild(S.hudEl);
    S.wrap = wrap; S.canvas = canvas;
    if (typeof THREE === 'undefined') { S.failed = true; wrap.appendChild(U.el('div', 'tx-s3-err', '3D 라이브러리(three.js)를 불러오지 못했습니다.')); return; }
    try {
      S.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    } catch (e) {
      S.failed = true; wrap.appendChild(U.el('div', 'tx-s3-err', '이 브라우저에서 WebGL을 사용할 수 없어 3D 화면을 표시할 수 없습니다. 2D 도면을 이용하세요.')); return;
    }
    var r = S.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(BG, 1);
    var sc = S.scene = new THREE.Scene();
    sc.background = new THREE.Color(BG); sc.fog = new THREE.Fog(BG, 30, 90);
    S.camera = new THREE.PerspectiveCamera(42, 1.6, 0.1, 1000);
    sc.add(new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.85));
    sc.add(new THREE.AmbientLight(0x94a3b8, 0.18));
    var dl = new THREE.DirectionalLight(0xffffff, 1.05); dl.castShadow = true; dl.shadow.mapSize.set(2048, 2048); dl.shadow.bias = -0.0005; dl.shadow.normalBias = 0.02; dl.shadow.radius = 3;
    sc.add(dl); sc.add(dl.target);
    var rim = new THREE.DirectionalLight(0x60a5fa, 0.35); sc.add(rim);
    S.lights = { dir: dl, rim: rim };
    S.gStatic = new THREE.Group(); S.gOverlay = new THREE.Group(); sc.add(S.gStatic); sc.add(S.gOverlay);
    S.bagS = new Bag(); S.bagO = new Bag();
    S.ray = new THREE.Raycaster(); _v = new THREE.Vector3();
    S.orbit.tgt = new THREE.Vector3(); S.orbit.gT = new THREE.Vector3(); S.center = new THREE.Vector3();
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stopLoop(); });
    canvas.addEventListener('webglcontextrestored', function () { invalidateCaches(); S.need.static = true; checkRun(); });
    S.labelsEl.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.tx-s3-lab') : null; if (!el) return;
      var a = el.getAttribute('data-a'), rr = el.getAttribute('data-r');
      if (a) TX.select(a); else if (rr) TX.setState({ room: rr });
    });
    S.labelsEl.addEventListener('dblclick', function (e) { var el = e.target.closest ? e.target.closest('[data-a]') : null; if (el) flyTo(el.getAttribute('data-a')); });
    bindInput(); bindMini();
    S.prevLayers = JSON.stringify(st().layers || {});
  }
  function mount(host) {
    if (!host) return;
    if (!S.wrap) init();
    if (S.host !== host) {
      host.appendChild(S.wrap); S.host = host;
      if (S.ro) S.ro.disconnect();
      if (window.ResizeObserver) { S.ro = new ResizeObserver(function () { resize(); checkRun(); }); S.ro.observe(host); }
    }
    if (!M() && !TX.data && TX.demoModel) setTimeout(function () { if (!TX.model) TX.setModel(TX.demoModel()); }, 0);
    S.need.static = true; S.need.fit = true;
    resize(); checkRun();
  }
  function devMount() { // T2 셸이 없을 때 시험용 전체화면 컨테이너
    if (S.host || (TX.ui && TX.ui.view3d) || TX.shell) return;
    var root = S.devRoot = U.el('div', 'tx-s3-dev');
    var host = U.el('div', 'tx-s3-dev-view'); root.appendChild(host);
    var close = U.el('button', 'tx-s3-dev-close', '닫기 ✕'); close.type = 'button'; close.onclick = function () { TX.close(); }; root.appendChild(close);
    document.body.appendChild(root);
    mount(host);
  }
  /* T2 떠 있는 패널(인스펙터·범례)을 피해 화면 중심·미니맵·HUD 배치 */
  function layoutAvoid() {
    if (!S.host || !S.camera || !S.w) return;
    var ui = TX.ui, sa = null;
    if (ui && ui.view3d === S.host && typeof ui.safeArea === 'function') { try { sa = ui.safeArea('3d'); } catch (e) { sa = null; } }
    if (!sa || !(sa.w > 40) || !(sa.h > 40)) sa = { x: 0, y: 0, w: S.w, h: S.h };
    sa = { x: U.clamp(sa.x, 0, S.w - 40), y: U.clamp(sa.y, 0, S.h - 40), w: Math.min(sa.w, S.w), h: Math.min(sa.h, S.h) };
    var key = [sa.x, sa.y, sa.w, sa.h].map(Math.round).join(',');
    var sx = Math.round(S.w / 2 - (sa.x + sa.w / 2)), sy = Math.round(S.h / 2 - (sa.y + sa.h / 2));
    if (key !== S.saKey) {
      S.saKey = key; S.safe = sa; S.cover = Math.max(0, S.w - sa.w);
      if (sx || sy) S.camera.setViewOffset(S.w, S.h, sx, sy, S.w, S.h); else S.camera.clearViewOffset();
      if (!S.userZoom && S.fitOnce) S.orbit.gR = fitR(S.sceneR);
      S.camDirty = true;
    }
    var right = Math.max(0, S.w - (sa.x + sa.w)), bottom = Math.max(0, S.h - (sa.y + sa.h));
    if (S.miniWrap) { S.miniWrap.style.right = (right + 10) + 'px'; S.miniWrap.style.top = (sa.y + 10) + 'px'; }
    if (S.hudEl) { S.hudEl.style.left = (sa.x + 10) + 'px'; S.hudEl.style.bottom = (bottom + 10) + 'px'; S.hudEl.style.maxWidth = Math.max(160, sa.w - 20 - (S.miniWrap && S.miniWrap.style.display !== 'none' && sa.h < 260 ? 230 : 0)) + 'px'; }
  }
  function resize() {
    if (!S.renderer || !S.host) return;
    var w = S.host.clientWidth, h = S.host.clientHeight;
    if (w < 2 || h < 2 || (w === S.w && h === S.h)) return;
    var asp0 = S.w && S.h ? S.w / S.h : 0;
    S.w = w; S.h = h;
    S.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    S.renderer.setSize(w, h, false);
    S.camera.aspect = w / h; S.saKey = ''; layoutAvoid(); S.camera.updateProjectionMatrix();
    if (!S.userZoom && S.fitOnce && Math.abs(asp0 - w / h) > 0.02) S.orbit.gR = fitR(S.sceneR);
    S.anchors.forEach(function (a) { a.w = 0; });
    S.camDirty = true;
    if (!S.raf && canRun()) { try { frame(performance.now()); } catch (e) { console.error(e); } }
  }

  /* ---------------- 이벤트 결합 ---------------- */
  TX.on('ui-ready', function (ui) { if (ui && ui.view3d) { if (S.devRoot) { S.devRoot.remove(); S.devRoot = null; } mount(ui.view3d); } });
  TX.on('open', function () {
    setTimeout(function () { if (TX.ui && TX.ui.view3d) mount(TX.ui.view3d); else devMount(); if (S.devRoot) S.devRoot.style.display = ''; checkRun(); }, 0);
  });
  TX.on('close', function () { if (S.devRoot) S.devRoot.style.display = 'none'; stopLoop(); S.walk.keys = {}; });
  TX.on('model', function () { invalidateCaches(); S.need.static = true; S.need.fit = true; S.walk.init = false; checkRun(); });
  TX.on('resize', function () { resize(); layoutAvoid(); checkRun(); setTimeout(layoutAvoid, 380); });
  TX.on('fault', function () { S.need.overlay = true; });
  TX.on('select', function (id) { S.need.overlay = true; if (id) S.pendingFly = id; });
  TX.on('camera', function (e) { if (!S.renderer) return; S.pendingPreset = (e && e.preset) || 'reset'; if (!S.raf && S.fitOnce) { preset(S.pendingPreset); S.pendingPreset = null; } });
  TX.on('state', function (e) {
    var ch = (e && e.changed) || [], has = function (k) { return ch.indexOf(k) >= 0; };
    if (['concept', 'floor', 'stack', 'ghost', 'riser', 'explode'].some(has)) S.need.static = true;
    if (has('concept') || has('stack')) S.need.fit = true;
    if (has('floor') && !st().stack) S.need.fit = true;
    if (has('layers')) {
      var now = st().layers || {}, prev = {}; try { prev = JSON.parse(S.prevLayers || '{}'); } catch (x) { }
      S.prevLayers = JSON.stringify(now);
      if (prev.tray !== now.tray || prev.measure !== now.measure) S.need.static = true;
      S.need.overlay = true;
    }
    if (has('room')) { if (S.concept === 'B' || st().concept === 'B') S.need.static = true; S.need.overlay = true; }
    if (has('selected') || has('fault')) S.need.overlay = true;
    if (has('selected') && st().concept === 'B' && st().selected) { var a = TX.asset(st().selected); if (a && S.roomB && a.room !== S.roomB.id) S.need.static = true; }
    if (has('labels')) S.camDirty = true;
    if (has('walk')) {
      if (st().walk && st().concept !== 'A') TX.emit('toast', { msg: '워크스루는 시안 A(돌하우스)에서 사용할 수 있습니다.', kind: 'info' });
      if (st().walk) { S.walk.init = false; if (S.walkB) initWalk(true); } else { S.walk.keys = {}; }
      if (st().walk && S.canvas) try { S.canvas.focus({ preventScroll: true }); } catch (x) { }
      S.camDirty = true; syncHud();
    }
    if (has('view') || has('open') || has('panel')) { setTimeout(checkRun, 0); setTimeout(layoutAvoid, 60); setTimeout(layoutAvoid, 420); }
    checkRun();
  });
  document.addEventListener('visibilitychange', checkRun);
  window.addEventListener('resize', function () { resize(); });

  /* ---------------- 스냅샷 ---------------- */
  function snapshot() {
    if (!S.renderer || S.failed) { TX.emit('toast', { msg: '3D 화면이 준비되지 않았습니다.', kind: 'warn' }); return Promise.resolve(null); }
    if (!S.w) resize();
    if (S.need.static) buildStatic(); if (S.need.overlay) buildOverlay();
    applyCamera(); S.renderer.render(S.scene, S.camera); updateLabels();
    var src = S.canvas, cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    var g = cv.getContext('2d'), k = src.width / S.w, font = 'Arial,"Noto Sans KR","Malgun Gothic",sans-serif';
    g.drawImage(src, 0, 0);
    if (st().labels !== false) S.anchors.forEach(function (an) {
      if (!an.vis) return;
      var cs = getComputedStyle(an.el), x = (an.sx - an.w / 2) * k, y = (an.sy - an.h + (an.dy || 0)) * k, w = an.w * k, h = an.h * k;
      g.fillStyle = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : 'rgba(15,23,42,0.9)';
      if (/tx-s3-tech/.test(an.el.className)) g.fillStyle = '#ea580c';
      roundRect(g, x, y, w, h, 5 * k); g.fill();
      g.strokeStyle = cs.borderTopColor || '#38bdf8'; g.lineWidth = k; g.stroke();
      g.fillStyle = cs.color || '#fff'; g.font = 'bold ' + (10.5 * k).toFixed(1) + 'px ' + font; g.textBaseline = 'middle'; g.textAlign = 'center';
      g.fillText(an.el.textContent.trim(), x + w / 2, y + h / 2, w - 4 * k);
    });
    if (S.miniWrap.style.display !== 'none' && S.miniEl.width) {
      var mr = S.miniEl.getBoundingClientRect(), hr = S.canvas.getBoundingClientRect();
      g.globalAlpha = 0.95; g.drawImage(S.miniEl, (mr.left - hr.left) * k, (mr.top - hr.top) * k, mr.width * k, mr.height * k); g.globalAlpha = 1;
    }
    var m = M(), title = ((m && m.site && m.site.name) || 'TwinX') + ' · 3D 시안 ' + S.concept + ' ' + CONCEPT_NAME[S.concept] + ' · ' + (S.focus ? (S.focus.name || S.focus.code) : '') + ' · ' + U.today() + ' · 자료: ' + (m && m.source === 'admin' ? 'ADMIN 등록·정기점검 실측' : '시범 데이터');
    g.font = 'bold ' + (12 * k) + 'px ' + font; var tw = g.measureText(title).width;
    g.fillStyle = 'rgba(7,12,24,0.82)'; g.fillRect(8 * k, cv.height - 30 * k, tw + 20 * k, 22 * k);
    g.fillStyle = '#e2e8f0'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(title, 18 * k, cv.height - 19 * k);
    var name = 'TwinX_3D_' + S.concept + '_' + (S.focus ? S.focus.code : 'all') + '_' + U.today() + '.png';
    return new Promise(function (res) {
      cv.toBlob(function (b) { if (b) { U.download(b, name); TX.emit('toast', { msg: '3D 스냅샷을 저장했습니다 (' + name + ')', kind: 'success' }); } res(b); }, 'image/png');
    });
  }

  /* ---------------- 공개 API ---------------- */
  TX.scene3d = {
    render: function () {
      S.need.static = true;
      if (!S.renderer || S.failed) return;
      if (!S.raf) { resize(); if (S.w) { try { frame(performance.now()); } catch (e) { console.error(e); } } }
    },
    resize: function () { S.w = 0; resize(); checkRun(); },
    snapshot: snapshot,
    dispose: function () {
      stopLoop();
      clearGroup(S.gStatic, S.bagS); clearGroup(S.gOverlay, S.bagO); invalidateCaches(); clearLabels();
      if (S.ro) S.ro.disconnect(); S.ro = null;
      if (S.renderer) { S.renderer.renderLists.dispose(); S.renderer.dispose(); try { S.renderer.forceContextLoss(); } catch (e) { } }
      if (S.wrap) S.wrap.remove(); if (S.devRoot) S.devRoot.remove();
      S.renderer = null; S.wrap = null; S.host = null; S.devRoot = null; S.w = S.h = 0; S.fitOnce = false; S.failed = false;
      S.need = { static: true, overlay: true, fit: true };
    },
    /* 시험·진단용 */
    stats: function () {
      var r = S.renderer; if (!r) return null;
      return { running: !!S.raf, concept: S.concept, builds: S.builds, buildMs: +(S.buildMs || 0).toFixed(1), frameMs: +S.frameMs.toFixed(2), calls: r.info.render.calls, triangles: r.info.render.triangles,
        geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: (r.info.programs || []).length, anchors: S.anchors.length,
        visibleLabels: S.anchors.filter(function (a) { return a.vis; }).length, assets: Object.keys(S.info).length, size: [S.w, S.h] };
    },
    flyTo: function (id) { return flyTo(id); }
  };
  if (TX.ui && TX.ui.view3d) mount(TX.ui.view3d);
})();
