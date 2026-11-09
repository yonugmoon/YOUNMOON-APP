/* ============================================================
   T3 · 2D CAD 정보통신설비 평면도 — TwinX.cad2d
   - 임의 층·실·설비(mm 좌표)를 받아 시트(SVG) 1장을 문자열로 조립 → innerHTML 1회
   - 구조 그리드/치수/외벽·내벽·문/실 해치/트레이/라이저/결선/설비 심볼/인출 태그(충돌 회피)
     실측 배지·접지 경고·열화상(실측값만)·선택·장애 파급·범례·방위표·축척바·표제란·주기
   - 휠 줌(커서 기준)·드래그 팬·핀치 줌·더블클릭 맞춤·클릭 선택·호버 툴팁·SVG/PNG 내보내기
   * 계약: twin-admin/CONTRACT.md · 접두어 tx- · 전역 추가 없음
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.cad2d) return;
  var C = TX.C, U = TX.util, esc = U.esc;

  var PAPER = '#06101f';
  var FONT = 'Arial,"Noto Sans KR","Malgun Gothic","WenQuanYi Zen Hei",sans-serif';
  var MONO = 'ui-monospace,Menlo,Consolas,"DejaVu Sans Mono",monospace';
  var LEGW = 272;               // 범례 열 폭(px)
  var KIND_LABEL = {
    rack: '통신랙 (19" 42U)', server: '서버랙', power: '전원 (UPS·정류기)', ap: '무선 AP (커버리지)',
    cctv: 'CCTV (화각)', video: '영상장비 (NVR)', ground: '접지단자함', tray: '트레이 구간 설비', panel: '분전반·단자함', etc: '기타 설비'
  };
  var KIND_ORDER = ['rack', 'server', 'video', 'power', 'panel', 'ground', 'ap', 'cctv', 'tray', 'etc'];
  var LANE = { data: 0, optical: 3.2, power: -3.2, ground: -6.4, path: 6.4 };

  function n(v) { return Math.round(v * 10) / 10; }
  function mm(v) { return Math.round(v).toLocaleString('en-US'); }
  function fin(v) { return typeof v === "number" && isFinite(v); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  /* 텍스트 폭 추정 (한글 1em, 영숫자 ~0.56em) */
  function tw(s, size, mono) {
    s = String(s == null ? '' : s); var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c > 0x2e80) w += 1.0;
      else if (mono) w += 0.61;
      else if (c === 32) w += 0.28;
      else if (c >= 65 && c <= 90) w += 0.66;
      else if (c >= 48 && c <= 57) w += 0.56;
      else w += 0.52;
    }
    return w * size;
  }
  function fitText(s, size, maxW, mono) {
    s = String(s || '');
    if (tw(s, size, mono) <= maxW) return s;
    for (var k = s.length - 1; k > 0; k--) { var t = s.slice(0, k) + '…'; if (tw(t, size, mono) <= maxW) return t; }
    return '';
  }

  /* ---------- 측정값 요약 (정기점검 실측만, 가짜 값 금지) ---------- */
  function mVal(m) {
    var v = m.value;
    if (v == null || v === '') return '';
    var s = typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
    if (m.unit && s.indexOf(m.unit) < 0) s += m.unit;
    return s;
  }
  function mLabel(m) { return (m.std && C.STD[m.std]) || String(m.item || '측정').slice(0, 8); }
  function mText(m) { var v = mVal(m); return mLabel(m) + (v ? ' ' + v : '') + (m.judge === 'bad' ? ' 불량' : m.warn ? ' 주의' : ''); }
  /* 매칭 근거(v1.1): explicit/v14 = 직접 연결, 그 외(명칭·실 추정) = 추정 */
  function mEst(m) { return !!(m && m.match && m.match !== 'explicit' && m.match !== 'v14' && m.match !== 'asset' && m.match !== 'room'); }
  var SRC_LABEL = { inspection: '정기점검', row: '정기점검', history: '점검이력', 'v14-snapshot': 'v14 스냅샷' };
  var MATCH_LABEL = { explicit: '직접 연결', v14: '설비 메타', 'asset-name': '설비명 매칭(추정)', asset: '설비', room: '실' };
  function mEvid(m) {
    var a = SRC_LABEL[m.source] || (m.source ? String(m.source) : '정기점검');
    var b = m.match ? (MATCH_LABEL[m.match] || (/^room-/.test(m.match) ? '실 매칭(추정·' + m.match.slice(5) + ')' : String(m.match))) : '';
    return a + (b ? ' · ' + b : '');
  }
  function byDateDesc(a, b) { return String(b.date || '').localeCompare(String(a.date || '')); }
  function uniqT(arr) { var seen = {}; return arr.filter(function (m) { var t = mText(m); if (seen[t]) return false; seen[t] = 1; return true; }); }
  function summarize(list) {
    if (!list || !list.length) return null;
    list = uniqT(list.slice().sort(byDateDesc));
    var bad = list.filter(function (m) { return m.judge === 'bad'; }).sort(byDateDesc);
    if (bad.length) return { bad: true, est: bad.slice(0, 2).some(mEst), items: bad.slice(0, 2), all: list };
    var wn = list.filter(function (m) { return m.warn; }).sort(byDateDesc);
    if (wn.length) return { bad: false, warn: true, est: wn.slice(0, 2).some(mEst), items: wn.slice(0, 2), all: list };
    var seen = {}, main = [];
    list.slice().sort(byDateDesc).forEach(function (m) {
      var k = m.std || m.item; if (seen[k] || (m.value == null || m.value === '')) return; seen[k] = 1; main.push(m);
    });
    if (!main.length) return null;
    return { bad: false, est: main.slice(0, 2).some(mEst), items: main.slice(0, 2), all: list };
  }
  function gndBad(list) { return (list || []).some(function (m) { return m.std === 'gnd' && m.judge === 'bad'; }); }
  function heatOf(list) {
    var hs = (list || []).filter(function (m) { return m.std === 'heat' && U.num(m.value) != null; }).sort(byDateDesc);
    if (!hs.length) return null;
    var m = hs[0], v = U.num(m.value), u = String(m.unit || '') + ' ' + String(m.item || '');
    var delta = /Δ|델타|온도차|delta|K\b/i.test(u);
    var lvl = m.judge === 'bad' ? 2 : delta ? (v >= 12 ? 2 : v >= 8 ? 1 : 0) : (v >= 45 ? 2 : v >= 35 ? 1 : 0);
    return { v: v, m: m, lvl: lvl, delta: delta };
  }

  /* ---------- 충돌 검사용 사각형 버킷 ---------- */
  function Boxes() { this.r = []; this.g = new Map(); this.stamp = []; this.q = 0; }
  Boxes.prototype.add = function (x, y, w, h) {
    var i = this.r.length, cs = 64; this.r.push([x, y, x + w, y + h]); this.stamp.push(0);
    for (var gx = Math.floor(x / cs); gx <= Math.floor((x + w) / cs); gx++)
      for (var gy = Math.floor(y / cs); gy <= Math.floor((y + h) / cs); gy++) {
        var k = gx * 8192 + gy, a = this.g.get(k); if (!a) this.g.set(k, a = []); a.push(i);
      }
  };
  Boxes.prototype.hit = function (x, y, w, h, cap) {
    if (cap == null) cap = Infinity;
    var cs = 64, x2 = x + w, y2 = y + h, area = 0, q = ++this.q;
    for (var gx = Math.floor(x / cs); gx <= Math.floor(x2 / cs); gx++)
      for (var gy = Math.floor(y / cs); gy <= Math.floor(y2 / cs); gy++) {
        var a = this.g.get(gx * 8192 + gy); if (!a) continue;
        for (var j = 0; j < a.length; j++) {
          var i = a[j]; if (this.stamp[i] === q) continue; this.stamp[i] = q;
          var r = this.r[i], ox = Math.min(x2, r[2]) - Math.max(x, r[0]), oy = Math.min(y2, r[3]) - Math.max(y, r[1]);
          if (ox > 0 && oy > 0) { area += ox * oy; if (area > cap) return area; }
        }
      }
    return area;
  };

  /* ---------- 모델 접근 ---------- */
  function boundsOf(fl, rooms, assets) {
    var b = fl && fl.bounds;
    if (b && fin(b.x0) && fin(b.x1) && b.x1 > b.x0 && b.y1 > b.y0) return b;
    var xs = [], ys = [];
    rooms.forEach(function (r) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); });
    assets.forEach(function (a) { if (fin(a.x) && fin(a.y)) { xs.push(a.x); ys.push(a.y); } });
    if (!xs.length) return { x0: 0, y0: 0, x1: 20000, y1: 12000 };
    return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
  }
  function riserRange(rs) {
    var fl = (TX.model.floors || []).filter(function (f) { return rs.floors.indexOf(f.code) >= 0; });
    if (!fl.length) return '';
    fl.sort(function (a, b) { return (a.level || 0) - (b.level || 0); });
    return fl.length === 1 ? fl[0].code : fl[0].code + '~' + fl[fl.length - 1].code;
  }
  function dwgNo(code) { return 'KT-MOS-IC-' + code + '-101'; }

  /* 표기 축척(1:100/200/300/500) + 용지 근사 */
  function nominal(W, s) {
    var ks = [100, 200, 300, 500], k = 500;
    for (var i = 0; i < ks.length; i++) if (W / s / ks[i] <= 841 * 1.08) { k = ks[i]; break; }
    var pw = W / s / k, P = [['A3', 420], ['A2', 594], ['A1', 841], ['A0', 1189]], p = 'A0';
    for (var j = 0; j < P.length; j++) if (pw <= P[j][1] * 1.08) { p = P[j][0]; break; }
    return { k: k, paper: p, text: '1:' + k + ' / ' + p };
  }

  /* 주요 정렬선 추출(촘촘하면 병합) */
  function clusterEdges(vals, thr, keep) {
    var v = vals.slice().sort(function (a, b) { return a - b; }), out = [], cur = [];
    function flush() {
      if (!cur.length) return;
      var kv = cur.filter(function (x) { return keep.some(function (k) { return Math.abs(k - x) < 1; }); });
      if (kv.length) out.push(kv[0]);
      else out.push(Math.round(cur.reduce(function (a, b) { return a + b; }, 0) / cur.length / 50) * 50);
      cur = [];
    }
    v.forEach(function (x) { if (cur.length && x - cur[0] > thr) flush(); cur.push(x); });
    flush();
    // 가장자리(bounds) 클러스터가 내부 값을 삼킨 경우 끝값 보정
    return out.filter(function (x, i) { return i === 0 || x - out[i - 1] > 1; });
  }
  function gridOf(vals, lo, hi, s) {
    var thr = Math.max(1800, 48 / s), g = [];
    vals = vals.filter(function (x) { return x >= lo - 1 && x <= hi + 1; }).concat([lo, hi]);
    for (var it = 0; it < 10; it++) { g = clusterEdges(vals, thr, [lo, hi]); if (g.length <= 12) break; thr *= 1.45; }
    return g;
  }
  function chainOf(vals, lo, hi, s) {
    var thr = Math.max(60, 3 / s);
    vals = vals.filter(function (x) { return x >= lo - 1 && x <= hi + 1; }).concat([lo, hi]);
    var g = clusterEdges(vals, thr, [lo, hi]);
    if (g.length > 40) g = clusterEdges(vals, Math.max(thr, 30 / s), [lo, hi]);
    return g;
  }

  /* ---------- 표준 설비 심볼 ---------- */
  function symExt(kind, k) {
    var S = 14 * k;
    switch (kind) {
      case 'power': return [S * 1.6, S * 0.75];
      case 'tray': return [S * 2.2, S * 0.5];
      case 'ap': return [S * 0.8, S * 0.8];
      case 'cctv': return [S * 0.8, S * 0.8];
      case 'ground': return [S, S * 0.7];
      case 'panel': return [S, S * 0.6];
      case 'rack': case 'server': case 'video': return [S, S * 0.8];
      default: return [S * 0.72, S * 0.72];
    }
  }
  function sym(kind, cx, cy, col, k, ang) {
    var S = 14 * k, x = n(cx), y = n(cy), o = [], i;
    var sw = n(Math.max(1.2, 2 * k));
    function R(x0, y0, w, h, extra) { return '<rect x="' + n(x0) + '" y="' + n(y0) + '" width="' + n(w) + '" height="' + n(h) + '" ' + (extra || '') + '/>'; }
    function Lr(x1, y1, x2, y2, w) { return '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) + '" stroke="' + col + '" stroke-width="' + (w || 1) + '"/>'; }
    var body = 'fill="#0b1220" stroke="' + col + '" stroke-width="' + sw + '"';
    switch (kind) {
      case 'rack': case 'video':
        o.push(R(x - S, y - S * 0.8, S * 2, S * 1.6, body), Lr(x - S, y - S * 0.8, x + S, y + S * 0.8), Lr(x - S, y + S * 0.8, x + S, y - S * 0.8),
          R(x - S, y + S * 0.8 - 3 * k, S * 2, 3 * k, 'fill="' + col + '"'));
        if (kind === 'video') o.push('<circle cx="' + x + '" cy="' + y + '" r="' + n(5 * k) + '" fill="#0b1220" stroke="' + col + '" stroke-width="1.5"/><circle cx="' + x + '" cy="' + y + '" r="' + n(1.8 * k) + '" fill="' + col + '"/>');
        break;
      case 'server':
        o.push(R(x - S, y - S * 0.8, S * 2, S * 1.6, body));
        for (i = 1; i <= 3; i++) o.push(Lr(x - S * 0.75, y - S * 0.8 + i * S * 0.4, x + S * 0.45, y - S * 0.8 + i * S * 0.4, 1.1),
          '<circle cx="' + n(x + S * 0.7) + '" cy="' + n(y - S * 0.8 + i * S * 0.4) + '" r="' + n(1.4 * k) + '" fill="' + col + '"/>');
        break;
      case 'power':
        o.push(R(x - S * 1.6, y - S * 0.75, S * 3.2, S * 1.5, body));
        for (i = 0; i < 4; i++) o.push(Lr(x - S * 1.05 + i * S * 0.62, y - (i % 2 ? 4 : 7) * k, x - S * 1.05 + i * S * 0.62, y + (i % 2 ? 4 : 7) * k, i % 2 ? 1.2 : 2.6));
        o.push('<text x="' + n(x + S * 1.3) + '" y="' + n(y + 3.5 * k) + '" text-anchor="middle" class="tx-c-code" style="font-size:' + n(9 * k) + 'px" fill="' + col + '">+−</text>');
        break;
      case 'ground':
        o.push(R(x - S, y - S * 0.7, S * 2, S * 1.4, body), Lr(x, y - 7 * k, x, y, 1.6), Lr(x - 8 * k, y, x + 8 * k, y, 1.8), Lr(x - 5.5 * k, y + 3.5 * k, x + 5.5 * k, y + 3.5 * k, 1.6), Lr(x - 3 * k, y + 7 * k, x + 3 * k, y + 7 * k, 1.4));
        break;
      case 'panel':
        o.push(R(x - S, y - S * 0.6, S * 2, S * 1.2, body),
          '<path d="M' + n(x - S) + ' ' + n(y + S * 0.6) + 'L' + n(x + S) + ' ' + n(y - S * 0.6) + 'L' + n(x + S) + ' ' + n(y + S * 0.6) + 'Z" fill="' + col + '" fill-opacity="0.85"/>');
        break;
      case 'tray':
        o.push(R(x - S * 2.2, y - S * 0.5, S * 4.4, S, body));
        for (i = 1; i < 11; i++) o.push(Lr(x - S * 2.2 + i * S * 0.4, y - S * 0.5, x - S * 2.2 + i * S * 0.4, y + S * 0.5, 0.9));
        break;
      case 'ap':
        o.push('<circle cx="' + x + '" cy="' + y + '" r="' + n(S * 0.8) + '" ' + body + '/>',
          '<text x="' + x + '" y="' + n(y + 3.5 * k) + '" text-anchor="middle" class="tx-c-code" style="font-size:' + n(9.5 * k) + 'px" fill="' + col + '">AP</text>');
        [1.25, 1.7, 2.15].forEach(function (f, j) {
          var r = S * f; o.push('<path d="M' + n(x - r * 0.7) + ' ' + n(y - r * 0.7) + 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(x + r * 0.7) + ' ' + n(y - r * 0.7) + '" fill="none" stroke="' + col + '" stroke-width="1.2" stroke-opacity="' + (0.9 - j * 0.25) + '"/>');
        });
        break;
      case 'cctv':
        o.push('<g transform="rotate(' + n(ang || 0) + ' ' + x + ' ' + y + ')">' + R(x - S * 0.8, y - S * 0.42, S * 1.1, S * 0.84, body) +
          '<path d="M' + n(x + S * 0.3) + ' ' + n(y - S * 0.25) + 'L' + n(x + S * 0.85) + ' ' + n(y - S * 0.5) + 'L' + n(x + S * 0.85) + ' ' + n(y + S * 0.5) + 'L' + n(x + S * 0.3) + ' ' + n(y + S * 0.25) + 'Z" fill="' + col + '"/></g>');
        break;
      default:
        o.push('<circle cx="' + x + '" cy="' + y + '" r="' + n(S * 0.72) + '" ' + body + '/><circle cx="' + x + '" cy="' + y + '" r="' + n(2.2 * k) + '" fill="' + col + '"/>');
    }
    return '<g class="tx-c-eqb">' + o.join('') + '</g>';
  }

  function defs(s) {
    var g = 600 * s; if (g < 5) g = 1200 * s; if (g < 5) g = 2400 * s;
    var tile = Math.max(6, 1200 * s);
    return '<defs>' +
      '<pattern id="tx-c-hTel" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="' + C.ROOM.telecom.hatch + '" stroke-width="1.2" stroke-opacity="0.5"/></pattern>' +
      '<pattern id="tx-c-hSrv" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="9" stroke="' + C.ROOM.server.hatch + '" stroke-width="1" stroke-opacity="0.5"/></pattern>' +
      '<pattern id="tx-c-hPwr" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="' + C.ROOM.power.hatch + '" stroke-width="1.2" stroke-opacity="0.5"/></pattern>' +
      '<pattern id="tx-c-hElec" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="10" stroke="' + C.ROOM.elec.hatch + '" stroke-width="1" stroke-opacity="0.55"/></pattern>' +
      '<pattern id="tx-c-hMech" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 0L10 10M10 0L0 10" stroke="#7c9a8e" stroke-width="0.6" stroke-opacity="0.45"/></pattern>' +
      '<pattern id="tx-c-raised" width="' + n(g) + '" height="' + n(g) + '" patternUnits="userSpaceOnUse"><path d="M' + n(g) + ' 0L0 0 0 ' + n(g) + '" fill="none" stroke="#7dd3fc" stroke-width="0.5" stroke-opacity="0.32"/></pattern>' +
      '<pattern id="tx-c-tile" width="' + n(tile) + '" height="' + n(tile) + '" patternUnits="userSpaceOnUse"><path d="M' + n(tile) + ' 0L0 0 0 ' + n(tile) + '" fill="none" stroke="#38bdf8" stroke-width="0.4" stroke-opacity="0.16"/></pattern>' +
      '<pattern id="tx-c-wc" width="' + n(tile / 2) + '" height="' + n(tile / 2) + '" patternUnits="userSpaceOnUse"><path d="M' + n(tile / 2) + ' 0L0 0 0 ' + n(tile / 2) + '" fill="none" stroke="#7dd3fc" stroke-width="0.4" stroke-opacity="0.25"/></pattern>' +
      '<pattern id="tx-c-dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="0.7" fill="#94a3b8" fill-opacity="0.35"/></pattern>' +
      '<pattern id="tx-c-wall" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#0d1b30"/><line x1="0" y1="0" x2="0" y2="5" stroke="#cbd5e1" stroke-width="1.5"/></pattern>' +
      '<pattern id="tx-c-void" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#475569" stroke-width="0.6" stroke-opacity="0.5"/></pattern>' +
      '<radialGradient id="tx-c-heat2"><stop offset="0" stop-color="#ff1744" stop-opacity="0.85"/><stop offset="0.45" stop-color="#f59e0b" stop-opacity="0.45"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="tx-c-heat1"><stop offset="0" stop-color="#f59e0b" stop-opacity="0.75"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="tx-c-heat0"><stop offset="0" stop-color="#06b6d4" stop-opacity="0.6"/><stop offset="1" stop-color="#06b6d4" stop-opacity="0"/></radialGradient>' +
      '<marker id="tx-c-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#94a3b8"/></marker>' +
      '<marker id="tx-c-arrL" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>' +
      '<style>' +
      '.tx-c-room{font:700 12px ' + FONT + ';fill:#e2e8f0}' +
      '.tx-c-code{font:700 10px ' + MONO + '}' +
      '.tx-c-sm{font:10px ' + FONT + ';fill:#94a3b8}' +
      '.tx-c-dim{font:10px ' + MONO + ';fill:#94a3b8}' +
      '.tx-c-tb{font:11px ' + FONT + ';fill:#cbd5e1}' +
      '.tx-c-tbh{font:700 9px ' + FONT + ';fill:#64748b;letter-spacing:.3px}' +
      '.tx-c-halo{paint-order:stroke;stroke:' + PAPER + ';stroke-width:3px;stroke-linejoin:round}' +
      '.tx-c-eq,.tx-c-rm{cursor:pointer}' +
      '.tx-c-eq:hover .tx-c-eqb{filter:brightness(1.45)}' +
      '.tx-c-rm:hover .tx-c-rmf{fill-opacity:.2}' +
      '.tx-c-dim0{opacity:.38}' +
      '.tx-c-pulse{animation:txCadPulse 1.1s ease-in-out infinite}' +
      '@keyframes txCadPulse{50%{opacity:.22}}' +
      '.tx-c-flow{stroke-dasharray:9 6;animation:txCadFlow .7s linear infinite}' +
      '@keyframes txCadFlow{to{stroke-dashoffset:-15}}' +
      '</style></defs>';
  }

  /* 문 측 추정: room.door 우선, 없으면 인접 복도 방향, 없으면 층 중심 방향 */
  function doorOf(r, corrs, b) {
    if (r.door === 'none') return null;
    if (r.door && r.doorAt != null) return { side: r.door, c: r.doorAt, w: r.doorW, user: true };
    if (r.type === 'corr' || r.type === 'park' || r.type === 'lobby') return r.door ? { side: r.door } : null;
    var best = null;
    function consider(side, gap, a0, a1) { if (a1 - a0 > 600 && gap > -300 && gap < 3200 && (!best || gap < best.gap)) best = { side: side, gap: gap, c: (a0 + a1) / 2 }; }
    corrs.forEach(function (c) {
      if (c === r) return;
      var ox0 = Math.max(r.x, c.x), ox1 = Math.min(r.x + r.w, c.x + c.w), oy0 = Math.max(r.y, c.y), oy1 = Math.min(r.y + r.h, c.y + c.h);
      consider('S', c.y - (r.y + r.h), ox0, ox1); consider('N', r.y - (c.y + c.h), ox0, ox1);
      consider('E', c.x - (r.x + r.w), oy0, oy1); consider('W', r.x - (c.x + c.w), oy0, oy1);
    });
    if (r.door) return { side: r.door, c: best && best.side === r.door ? best.c : null };
    if (best) return best;
    var dx = (b.x0 + b.x1) / 2 - (r.x + r.w / 2), dy = (b.y0 + b.y1) / 2 - (r.y + r.h / 2);
    return { side: Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? 'E' : 'W') : (dy >= 0 ? 'S' : 'N') };
  }

  /* ==================================================================
     시트 조립 (DOM 무관) — 반환 {svg(inner), W, H, code, dwg, stats}
     ================================================================== */
  var mapInfo = null; // 마지막 빌드의 mm↔시트 좌표 (배경 맞춤용)
  function build(code, forExport) {
    var t0 = performance.now();
    var M = TX.model, st = TX.state, L = st.layers || {};
    var fl = M && (M.floors || []).find(function (f) { return f.code === code; });
    if (!fl) return null;
    var rooms = (M.rooms || []).filter(function (r) { return r.floor === code && fin(r.x) && fin(r.w); });
    var assets = (M.assets || []).filter(function (a) { return a.floor === code; });
    var roomById = {}; rooms.forEach(function (r) { roomById[r.id] = r; });
    var b = boundsOf(fl, rooms, assets);
    var bw = Math.max(1000, b.x1 - b.x0), bh = Math.max(1000, b.y1 - b.y0);
    var s = Math.min(1240 / bw, 720 / bh, Math.sqrt(1000 * 640 / (bw * bh)));
    var pw = bw * s, ph = bh * s;
    var LM = 122, TM = 138, BM = 176, RG = 64;
    var W = Math.ceil(Math.max(1340, LM + pw + RG + LEGW + 28)), H = Math.ceil(Math.max(800, TM + ph + BM));
    var availW = W - LM - RG - LEGW - 28, availH = H - TM - BM;
    var px0 = LM + (availW - pw) / 2, py0 = TM + (availH - ph) / 2;
    function X(x) { return px0 + (x - b.x0) * s; }
    function Y(y) { return py0 + (y - b.y0) * s; }
    var bx0 = X(b.x0), bx1 = X(b.x1), by0 = Y(b.y0), by1 = Y(b.y1);
    var T = clamp(250 * s, 7, 14);                      // 외벽 두께(px)
    var k = clamp(s * 1250 / 28, 0.62, 1);              // 심볼 배율
    var nom = nominal(W, s);
    var fault = st.fault && st.fault.active;
    var imp = (fault && TX.fault && TX.fault.impact instanceof Map) ? TX.fault.impact : new Map();
    var src = fault ? (st.fault.source || (TX.fault && TX.fault.source)) : null;
    var sel = TX.bundleLead ? TX.bundleLead(st.selected) : st.selected; // 묶음 모듈 선택 → 묶음 심볼 강조
    var showTags = st.labels !== false;
    var o = [];
    var boxes = new Boxes();
    var legendX = W - 28 - LEGW;

    o.push(defs(s));
    mapInfo = { floor: code, px0: px0, py0: py0, s: s, x0: b.x0, y0: b.y0 };
    o.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + PAPER + '"/>' +
      '<rect x="14" y="14" width="' + (W - 28) + '" height="' + (H - 28) + '" fill="none" stroke="#1e3a8a" stroke-width="2"/>' +
      '<rect x="22" y="22" width="' + (W - 44) + '" height="' + (H - 44) + '" fill="none" stroke="#1e3a8a" stroke-width="0.8"/>');
    // 시트 상단 좌측 도면 머리 (작게)

    /* ---- 구조 그리드 ---- */
    var exs = [], eys = [];
    rooms.forEach(function (r) { exs.push(r.x, r.x + r.w); eys.push(r.y, r.y + r.h); });
    var gx = gridOf(exs, b.x0, b.x1, s), gy = gridOf(eys, b.y0, b.y1, s);
    var bubY = by0 - T - 76, bubX = bx0 - T - 76;
    gx.forEach(function (x, i) {
      var xx = n(X(x));
      o.push('<line x1="' + xx + '" y1="' + n(bubY + 12) + '" x2="' + xx + '" y2="' + n(by1 + T + 26) + '" stroke="#334155" stroke-width="0.8" stroke-dasharray="14 4 2 4"/>' +
        '<circle cx="' + xx + '" cy="' + n(bubY) + '" r="12" fill="#0b1220" stroke="#64748b"/><text x="' + xx + '" y="' + n(bubY + 3.8) + '" text-anchor="middle" class="tx-c-code" fill="#cbd5e1">X' + (i + 1) + '</text>');
    });
    gy.forEach(function (y, i) {
      var yy = n(Y(y));
      o.push('<line x1="' + n(bubX + 12) + '" y1="' + yy + '" x2="' + n(bx1 + T + 26) + '" y2="' + yy + '" stroke="#334155" stroke-width="0.8" stroke-dasharray="14 4 2 4"/>' +
        '<circle cx="' + n(bubX) + '" cy="' + yy + '" r="12" fill="#0b1220" stroke="#64748b"/><text x="' + n(bubX) + '" y="' + n(Y(y) + 3.8) + '" text-anchor="middle" class="tx-c-code" fill="#cbd5e1">Y' + (i + 1) + '</text>');
    });

    /* ---- 층 슬래브(미지정 영역) ---- */
    o.push('<rect x="' + n(bx0) + '" y="' + n(by0) + '" width="' + n(pw) + '" height="' + n(ph) + '" fill="#0a1628"/>' +
      '<rect x="' + n(bx0) + '" y="' + n(by0) + '" width="' + n(pw) + '" height="' + n(ph) + '" fill="url(#tx-c-void)"/>');

    /* ---- 실 바닥 + 패턴 ---- */
    var corrs = rooms.filter(function (r) { return r.type === 'corr' || r.type === 'lobby'; });
    var RP = {};
    rooms.forEach(function (r) {
      var x = X(r.x), y = Y(r.y), w = r.w * s, h = r.h * s;
      RP[r.id] = { x: x, y: y, w: w, h: h, r: r };
      var stl = C.ROOM[r.type] || C.ROOM.office;
      var rect = 'x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '"';
      var pat = '';
      switch (r.type) {
        case 'telecom': pat = '<rect ' + rect + ' fill="url(#tx-c-raised)"/><rect ' + rect + ' fill="url(#tx-c-hTel)"/>'; break;
        case 'server': pat = '<rect ' + rect + ' fill="url(#tx-c-raised)"/><rect ' + rect + ' fill="url(#tx-c-hSrv)" fill-opacity="0.6"/>'; break;
        case 'power': pat = '<rect ' + rect + ' fill="url(#tx-c-hPwr)"/>'; break;
        case 'elec': pat = '<rect ' + rect + ' fill="url(#tx-c-hElec)"/>'; break;
        case 'mech': pat = '<rect ' + rect + ' fill="url(#tx-c-hMech)"/>'; break;
        case 'control': pat = '<rect ' + rect + ' fill="url(#tx-c-raised)" fill-opacity="0.55"/>'; break;
        case 'corr': case 'lobby': pat = '<rect ' + rect + ' fill="url(#tx-c-tile)"/>'; break;
        case 'wc': pat = '<rect ' + rect + ' fill="url(#tx-c-wc)"/>'; break;
        case 'store': pat = '<rect ' + rect + ' fill="url(#tx-c-dots)"/>'; break;
        case 'stair': {
          var vert = h >= w, steps = Math.max(4, Math.min(24, Math.floor((vert ? h : w) / Math.max(5, 280 * s)))), q = [];
          for (var i = 0; i <= steps; i++) {
            if (vert) { var sy = y + 8 + i * (h - 16) / steps; q.push('<line x1="' + n(x + 5) + '" y1="' + n(sy) + '" x2="' + n(x + w - 5) + '" y2="' + n(sy) + '" stroke="#64748b" stroke-width="0.8"/>'); }
            else { var sx = x + 8 + i * (w - 16) / steps; q.push('<line x1="' + n(sx) + '" y1="' + n(y + 5) + '" x2="' + n(sx) + '" y2="' + n(y + h - 5) + '" stroke="#64748b" stroke-width="0.8"/>'); }
          }
          if (vert) q.push('<line x1="' + n(x + w / 2) + '" y1="' + n(y + h - 10) + '" x2="' + n(x + w / 2) + '" y2="' + n(y + 12) + '" stroke="#94a3b8" stroke-width="1" marker-end="url(#tx-c-arr)"/><text x="' + n(x + w / 2 + 4) + '" y="' + n(y + 22) + '" class="tx-c-sm">UP</text>');
          else q.push('<line x1="' + n(x + 10) + '" y1="' + n(y + h / 2) + '" x2="' + n(x + w - 12) + '" y2="' + n(y + h / 2) + '" stroke="#94a3b8" stroke-width="1" marker-end="url(#tx-c-arr)"/><text x="' + n(x + w - 24) + '" y="' + n(y + h / 2 - 4) + '" class="tx-c-sm">UP</text>');
          pat = q.join(''); break;
        }
        case 'park': {
          var bay = 2500 * s, q2 = [];
          if (bay > 6) for (var px = x + bay; px < x + w - 4; px += bay) q2.push('<line x1="' + n(px) + '" y1="' + n(y + h * 0.45) + '" x2="' + n(px) + '" y2="' + n(y + h - 6) + '" stroke="#e2e8f0" stroke-opacity="0.3"/>');
          pat = q2.join(''); break;
        }
      }
      var active = r.id === st.room;
      o.push('<g class="tx-c-rm" data-r="' + esc(r.id) + '"><rect class="tx-c-rmf" ' + rect + ' fill="' + stl.fill + '" fill-opacity="' + (r.type === 'corr' ? 0.07 : 0.11) + '"/>' + pat +
        (active ? '<rect x="' + n(x + 3) + '" y="' + n(y + 3) + '" width="' + n(Math.max(0, w - 6)) + '" height="' + n(Math.max(0, h - 6)) + '" fill="#38bdf8" fill-opacity="0.09" stroke="#38bdf8" stroke-width="1.6" stroke-dasharray="6 3"/>' : '') + '</g>');
    });

    /* ---- CAD 배경 겹쳐 보기 (사용자 업로드 평면도 이미지, 60-workbench) ---- */
    var ul = TX.underlay && TX.underlay.get(code);
    if (ul && ul.show && L.underlay !== false) {
      var href = forExport ? ul.dataURL : (ul.url || ul.dataURL);
      var t = ul.tf, ca = Math.cos(t.rot) * t.s, sa = Math.sin(t.rot) * t.s;
      o.push('<defs><filter id="tx-ul-inv" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"/>' +
        '<feComponentTransfer><feFuncR type="linear" slope="0.85" intercept="0.03"/><feFuncG type="linear" slope="0.9" intercept="0.05"/><feFuncB type="linear" slope="1" intercept="0.1"/></feComponentTransfer></filter></defs>' +
        '<g class="tx-ul" opacity="' + ul.opacity + '" transform="translate(' + (px0 - b.x0 * s) + ',' + (py0 - b.y0 * s) + ') scale(' + s + ')" pointer-events="none">' +
        '<image href="' + href + '" xlink:href="' + href + '" x="0" y="0" width="' + ul.w + '" height="' + ul.h + '" preserveAspectRatio="none" transform="matrix(' + [ca, sa, -sa, ca, t.tx, t.ty].join(' ') + ')"' + (ul.invert ? ' filter="url(#tx-ul-inv)"' : '') + '/></g>');
    }

    /* ---- 열화상 (실측 발열값이 있을 때만) ---- */
    var heatCount = 0;
    if (L.thermal) {
      rooms.forEach(function (r) {
        var h = heatOf(r.measures); if (!h) return; heatCount++;
        var p = RP[r.id], rad = Math.min(p.w, p.h) * 0.48;
        o.push('<ellipse cx="' + n(p.x + p.w / 2) + '" cy="' + n(p.y + p.h / 2) + '" rx="' + n(p.w * 0.48) + '" ry="' + n(p.h * 0.48) + '" fill="url(#tx-c-heat' + h.lvl + ')" opacity="0.55" pointer-events="none"/>');
        void rad;
      });
      assets.forEach(function (a) {
        var h = heatOf(a.measures); if (!h || !fin(a.x)) return; heatCount++;
        var rr = clamp((1600 + clamp(h.v, 0, 80) * (h.delta ? 220 : 55)) * s, 18, 130);
        o.push('<circle cx="' + n(X(a.x)) + '" cy="' + n(Y(a.y)) + '" r="' + n(rr) + '" fill="url(#tx-c-heat' + h.lvl + ')" pointer-events="none" style="mix-blend-mode:screen"/>');
      });
    }

    /* ---- 벽체 · 문 ---- */
    var wIn = clamp(150 * s, 1.6, 3.2), doors = [];
    rooms.forEach(function (r) {
      var p = RP[r.id], hv = r.type === 'telecom' || r.type === 'power' || r.type === 'server';
      o.push('<rect x="' + n(p.x) + '" y="' + n(p.y) + '" width="' + n(p.w) + '" height="' + n(p.h) + '" fill="none" stroke="#cbd5e1" stroke-width="' + n(r.type === 'corr' ? wIn * 0.55 : hv ? wIn + 0.9 : wIn) + '"' + (r.type === 'corr' ? ' stroke-opacity="0.6"' : '') + ' pointer-events="none"/>');
      var d = doorOf(r, corrs, b); if (!d) return;
      var side = d.side, len = (side === 'N' || side === 'S') ? p.w : p.h;
      var dw = d.user ? clamp((d.w || 900) * s, 6, len * 0.9) : clamp(900 * s, 8, Math.min(len * 0.4, 30)); if (len < 18) return;
      var cx, cy, ux, uy, vx, vy;
      if (side === 'N' || side === 'S') {
        cx = d.c != null ? clamp(X(d.c), p.x + dw * 0.7, p.x + p.w - dw * 0.7) : p.x + p.w / 2; cy = side === 'S' ? p.y + p.h : p.y; ux = 1; uy = 0; vx = 0; vy = side === 'S' ? -1 : 1;
      } else {
        cy = d.c != null ? clamp(Y(d.c), p.y + dw * 0.7, p.y + p.h - dw * 0.7) : p.y + p.h / 2; cx = side === 'E' ? p.x + p.w : p.x; ux = 0; uy = 1; vx = side === 'E' ? -1 : 1; vy = 0;
      }
      var hx = cx - ux * dw / 2, hy = cy - uy * dw / 2, lx = hx + vx * dw, ly = hy + vy * dw, ex = hx + ux * dw, ey = hy + uy * dw;
      var sweep = (vx * uy - vy * ux) > 0 ? 1 : 0;
      var gw = wIn + 3;
      doors.push('<rect x="' + n(Math.min(hx, ex) - (ux ? 0 : gw / 2)) + '" y="' + n(Math.min(hy, ey) - (uy ? 0 : gw / 2)) + '" width="' + n(ux ? dw : gw) + '" height="' + n(uy ? dw : gw) + '" fill="#0a1628"/>' +
        '<line x1="' + n(hx) + '" y1="' + n(hy) + '" x2="' + n(lx) + '" y2="' + n(ly) + '" stroke="#e2e8f0" stroke-width="1.5"/>' +
        '<path d="M' + n(lx) + ' ' + n(ly) + 'A' + n(dw) + ' ' + n(dw) + ' 0 0 ' + sweep + ' ' + n(ex) + ' ' + n(ey) + '" fill="none" stroke="#94a3b8" stroke-width="0.9" stroke-dasharray="3 2"/>');
    });
    o.push('<g pointer-events="none">' + doors.join('') + '</g>');

    /* ---- 외벽 (해치) + 주출입구 ---- */
    o.push('<path d="M' + n(bx0 - T) + ' ' + n(by0 - T) + 'H' + n(bx1 + T) + 'V' + n(by1 + T) + 'H' + n(bx0 - T) + 'Z M' + n(bx0) + ' ' + n(by0) + 'V' + n(by1) + 'H' + n(bx1) + 'V' + n(by0) + 'Z" fill="url(#tx-c-wall)" fill-rule="evenodd" stroke="#e2e8f0" stroke-width="1.3" pointer-events="none"/>');
    var entry = rooms.filter(function (r) { return r.type === 'lobby' || r.type === 'park'; })[0];
    if (entry) {
      var ep = RP[entry.id], ew = clamp(1800 * s, 16, ep.w * 0.5), tol = 300 * s + 2, ent = null;
      if (Math.abs(ep.y + ep.h - by1) < tol) ent = ['S', ep.x + ep.w / 2]; else if (Math.abs(ep.y - by0) < tol) ent = ['N', ep.x + ep.w / 2];
      else if (Math.abs(ep.x - bx0) < tol) ent = ['W', ep.y + ep.h / 2]; else if (Math.abs(ep.x + ep.w - bx1) < tol) ent = ['E', ep.y + ep.h / 2];
      if (ent) {
        if (ent[0] === 'S' || ent[0] === 'N') {
          var wy = ent[0] === 'S' ? by1 : by0 - T;
          o.push('<rect x="' + n(ent[1] - ew / 2) + '" y="' + n(wy - 1) + '" width="' + n(ew) + '" height="' + n(T + 2) + '" fill="' + PAPER + '"/><line x1="' + n(ent[1] - ew / 2) + '" y1="' + n(wy + T / 2) + '" x2="' + n(ent[1] + ew / 2) + '" y2="' + n(wy + T / 2) + '" stroke="#38bdf8" stroke-width="2"/>' +
            '<text x="' + n(ent[1]) + '" y="' + n(ent[0] === 'S' ? by1 + T + 15 : by0 - T - 6) + '" text-anchor="middle" class="tx-c-sm" fill="#7dd3fc">' + (ent[0] === 'S' ? '▲' : '▼') + ' 주출입구</text>');
        } else {
          var wx = ent[0] === 'E' ? bx1 : bx0 - T;
          o.push('<rect x="' + n(wx - 1) + '" y="' + n(ent[1] - ew / 2) + '" width="' + n(T + 2) + '" height="' + n(ew) + '" fill="' + PAPER + '"/><line x1="' + n(wx + T / 2) + '" y1="' + n(ent[1] - ew / 2) + '" x2="' + n(wx + T / 2) + '" y2="' + n(ent[1] + ew / 2) + '" stroke="#38bdf8" stroke-width="2"/>');
        }
      }
    }
    // 기둥 (그리드 교점)
    var cs = clamp(450 * s, 7, 14), cols = [];
    gx.forEach(function (x) { gy.forEach(function (y) { cols.push('<rect x="' + n(X(x) - cs / 2) + '" y="' + n(Y(y) - cs / 2) + '" width="' + n(cs) + '" height="' + n(cs) + '" fill="#94a3b8" stroke="#e2e8f0" stroke-width="1"/>'); }); });
    o.push('<g pointer-events="none">' + cols.join('') + '</g>');

    /* ---- 치수선 (상단·좌측: 연쇄 + 전체) ---- */
    var dimO = [], cxs = chainOf(exs, b.x0, b.x1, s), cys = chainOf(eys, b.y0, b.y1, s);
    var dY1 = by0 - T - 22, dY2 = by0 - T - 46, dX1 = bx0 - T - 22, dX2 = bx0 - T - 46;
    dimO.push('<line x1="' + n(bx0) + '" y1="' + n(dY1) + '" x2="' + n(bx1) + '" y2="' + n(dY1) + '" stroke="#64748b" stroke-width="0.8"/>');
    cxs.forEach(function (x, i) {
      var xx = X(x);
      dimO.push('<line x1="' + n(xx) + '" y1="' + n(dY1 - 6) + '" x2="' + n(xx) + '" y2="' + n(by0 - T - 4) + '" stroke="#64748b" stroke-width="0.6"/><path d="M' + n(xx - 3.5) + ' ' + n(dY1 + 3.5) + 'L' + n(xx + 3.5) + ' ' + n(dY1 - 3.5) + '" stroke="#cbd5e1" stroke-width="1.2"/>');
      if (i > 0 && cxs.length > 2) { var t = mm(x - cxs[i - 1]), segw = xx - X(cxs[i - 1]); if (tw(t, 10, true) + 4 < segw) dimO.push('<text x="' + n((xx + X(cxs[i - 1])) / 2) + '" y="' + n(dY1 - 4) + '" text-anchor="middle" class="tx-c-dim">' + t + '</text>'); }
    });
    dimO.push('<line x1="' + n(bx0) + '" y1="' + n(dY2) + '" x2="' + n(bx1) + '" y2="' + n(dY2) + '" stroke="#64748b" stroke-width="0.8"/>' +
      '<path d="M' + n(bx0 - 3.5) + ' ' + n(dY2 + 3.5) + 'L' + n(bx0 + 3.5) + ' ' + n(dY2 - 3.5) + 'M' + n(bx1 - 3.5) + ' ' + n(dY2 + 3.5) + 'L' + n(bx1 + 3.5) + ' ' + n(dY2 - 3.5) + '" stroke="#cbd5e1" stroke-width="1.2"/>' +
      '<line x1="' + n(bx0) + '" y1="' + n(dY2 - 6) + '" x2="' + n(bx0) + '" y2="' + n(dY1) + '" stroke="#64748b" stroke-width="0.6"/><line x1="' + n(bx1) + '" y1="' + n(dY2 - 6) + '" x2="' + n(bx1) + '" y2="' + n(dY1) + '" stroke="#64748b" stroke-width="0.6"/>' +
      '<text x="' + n((bx0 + bx1) / 2) + '" y="' + n(dY2 - 4) + '" text-anchor="middle" class="tx-c-dim" fill="#cbd5e1">' + mm(b.x1 - b.x0) + '</text>');
    dimO.push('<line x1="' + n(dX1) + '" y1="' + n(by0) + '" x2="' + n(dX1) + '" y2="' + n(by1) + '" stroke="#64748b" stroke-width="0.8"/>');
    cys.forEach(function (y, i) {
      var yy = Y(y);
      dimO.push('<line x1="' + n(dX1 - 6) + '" y1="' + n(yy) + '" x2="' + n(bx0 - T - 4) + '" y2="' + n(yy) + '" stroke="#64748b" stroke-width="0.6"/><path d="M' + n(dX1 - 3.5) + ' ' + n(yy + 3.5) + 'L' + n(dX1 + 3.5) + ' ' + n(yy - 3.5) + '" stroke="#cbd5e1" stroke-width="1.2"/>');
      if (i > 0 && cys.length > 2) {
        var t = mm(y - cys[i - 1]), segh = yy - Y(cys[i - 1]), my = (yy + Y(cys[i - 1])) / 2;
        if (tw(t, 10, true) + 4 < segh) dimO.push('<text x="' + n(dX1 - 4) + '" y="' + n(my) + '" text-anchor="middle" class="tx-c-dim" transform="rotate(-90 ' + n(dX1 - 4) + ' ' + n(my) + ')">' + t + '</text>');
      }
    });
    var mY = (by0 + by1) / 2;
    dimO.push('<line x1="' + n(dX2) + '" y1="' + n(by0) + '" x2="' + n(dX2) + '" y2="' + n(by1) + '" stroke="#64748b" stroke-width="0.8"/>' +
      '<path d="M' + n(dX2 - 3.5) + ' ' + n(by0 + 3.5) + 'L' + n(dX2 + 3.5) + ' ' + n(by0 - 3.5) + 'M' + n(dX2 - 3.5) + ' ' + n(by1 + 3.5) + 'L' + n(dX2 + 3.5) + ' ' + n(by1 - 3.5) + '" stroke="#cbd5e1" stroke-width="1.2"/>' +
      '<line x1="' + n(dX2 - 6) + '" y1="' + n(by0) + '" x2="' + n(dX1) + '" y2="' + n(by0) + '" stroke="#64748b" stroke-width="0.6"/><line x1="' + n(dX2 - 6) + '" y1="' + n(by1) + '" x2="' + n(dX1) + '" y2="' + n(by1) + '" stroke="#64748b" stroke-width="0.6"/>' +
      '<text x="' + n(dX2 - 4) + '" y="' + n(mY) + '" text-anchor="middle" class="tx-c-dim" fill="#cbd5e1" transform="rotate(-90 ' + n(dX2 - 4) + ' ' + n(mY) + ')">' + mm(b.y1 - b.y0) + '</text>');
    o.push('<g pointer-events="none">' + dimO.join('') + '</g>');

    /* ---- 설비 위치(px) — 좌표 없는 설비는 실 내부 격자 자동 배치, 겹침은 살짝 분산 ---- */
    var P = {}, autoIdx = {}, symBoxes = new Boxes();
    // 묶음(모듈 묶음)은 대표 1개만 배치하고, 나머지 모듈은 같은 위치로 연결
    var placeList = assets.filter(function (a) { return !a.unplaced && (!a.bundle || a.bundle.lead === a.id); }).map(function (a) { return a.bundle && TX.bundleView ? TX.bundleView(a) : a; });
    var placed = placeList.map(function (a) {
      var x, y, rm = roomById[a.room];
      if (fin(a.x) && fin(a.y)) { x = X(clamp(a.x, b.x0, b.x1)); y = Y(clamp(a.y, b.y0, b.y1)); }
      else if (rm) {
        var i = autoIdx[rm.id] = (autoIdx[rm.id] || 0) + 1, cnt = assets.filter(function (q) { return q.room === rm.id && !fin(q.x); }).length;
        var cols2 = Math.ceil(Math.sqrt(cnt * rm.w / Math.max(1, rm.h))), rows = Math.ceil(cnt / cols2);
        x = X(rm.x + rm.w * (((i - 1) % cols2) + 0.5) / cols2); y = Y(rm.y + rm.h * (Math.floor((i - 1) / cols2) + 0.5) / rows);
      } else return null;
      var kind = KIND_LABEL[a.kind] ? a.kind : 'etc', e = symExt(kind, k);
      // 겹침 분산(동일 좌표 다중 설비)
      if (symBoxes.hit(x - e[0], y - e[1], e[0] * 2, e[1] * 2) > e[0] * e[1] * 1.2) {
        var best = null;
        for (var ring = 1; ring <= 4 && !best; ring++) for (var d = 0; d < 8; d++) {
          var ang = d * Math.PI / 4, nx = x + Math.cos(ang) * ring * e[0] * 2.1, ny = y + Math.sin(ang) * ring * e[1] * 2.3;
          if (rm) { var rp = RP[rm.id]; if (nx < rp.x + e[0] || nx > rp.x + rp.w - e[0] || ny < rp.y + e[1] || ny > rp.y + rp.h - e[1]) continue; }
          if (!symBoxes.hit(nx - e[0], ny - e[1], e[0] * 2, e[1] * 2)) { best = [nx, ny]; break; }
        }
        if (best) { x = best[0]; y = best[1]; }
      }
      symBoxes.add(x - e[0], y - e[1], e[0] * 2, e[1] * 2);
      P[a.id] = { x: x, y: y, kind: kind, e: e, a: a };
      return P[a.id];
    }).filter(Boolean);
    assets.forEach(function (a) { if (a.bundle && a.bundle.lead !== a.id && P[a.bundle.lead]) P[a.id] = P[a.bundle.lead]; });

    /* ---- 트레이 (사다리형) ---- */
    var trays = (fl.trays || []).map(function (t) { return { x1: X(t.a[0]), y1: Y(t.a[1]), x2: X(t.b[0]), y2: Y(t.b[1]), main: !!t.main }; });
    trays.forEach(function (t) { t.h = Math.abs(t.x2 - t.x1) >= Math.abs(t.y2 - t.y1); t.len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1); });
    if (L.tray !== false && trays.length) {
      var tcol = fault ? '#f43f5e' : '#facc15', tq = [];
      trays.forEach(function (t) {
        var ow = (t.main ? 6.5 : 4.5) * Math.max(0.75, k), dx = t.x2 - t.x1, dy = t.y2 - t.y1, ln = t.len || 1, ox = -dy / ln * ow, oy = dx / ln * ow;
        var rung = Math.max(5, 300 * s);
        if (Math.abs(dx) < 1 || Math.abs(dy) < 1) boxes.add(Math.min(t.x1, t.x2) - Math.abs(ox) - 1, Math.min(t.y1, t.y2) - Math.abs(oy) - 1, Math.abs(dx) + Math.abs(ox) * 2 + 2, Math.abs(dy) + Math.abs(oy) * 2 + 2);
        tq.push('<line x1="' + n(t.x1) + '" y1="' + n(t.y1) + '" x2="' + n(t.x2) + '" y2="' + n(t.y2) + '" stroke="' + tcol + '" stroke-opacity="0.1" stroke-width="' + n(ow * 2) + '"/>' +
          '<line x1="' + n(t.x1 - ox) + '" y1="' + n(t.y1 - oy) + '" x2="' + n(t.x2 - ox) + '" y2="' + n(t.y2 - oy) + '" stroke="' + tcol + '" stroke-width="1.2"/>' +
          '<line x1="' + n(t.x1 + ox) + '" y1="' + n(t.y1 + oy) + '" x2="' + n(t.x2 + ox) + '" y2="' + n(t.y2 + oy) + '" stroke="' + tcol + '" stroke-width="1.2"/>' +
          '<line x1="' + n(t.x1) + '" y1="' + n(t.y1) + '" x2="' + n(t.x2) + '" y2="' + n(t.y2) + '" stroke="' + tcol + '" stroke-width="' + n(ow * 2) + '" stroke-dasharray="1.1 ' + n(rung) + '" stroke-opacity="0.85"/>');
      });
      var mt = trays.filter(function (t) { return t.main; }).sort(function (a, c) { return c.len - a.len; })[0] || trays[0];
      if (mt && mt.len > 160) {
        var lbl = '케이블트레이 ' + (mt.main ? '(간선)' : '') + ' · 추정 경로';
        if (mt.h) { var lx0 = Math.min(mt.x1, mt.x2) + 40, ly0 = (mt.y1 + mt.y2) / 2 - 10 * Math.max(0.75, k) - 3; tq.push('<text x="' + n(lx0) + '" y="' + n(ly0) + '" class="tx-c-sm tx-c-halo" fill="#fde047">' + lbl + '</text>'); boxes.add(lx0, ly0 - 10, tw(lbl, 10), 12); }
        else { var lx1 = (mt.x1 + mt.x2) / 2 + 10 * Math.max(0.75, k) + 3, ly1 = Math.min(mt.y1, mt.y2) + 40; tq.push('<text x="' + n(lx1) + '" y="' + n(ly1) + '" class="tx-c-sm tx-c-halo" fill="#fde047" transform="rotate(90 ' + n(lx1) + ' ' + n(ly1) + ')">' + lbl + '</text>'); boxes.add(lx1 - 12, ly1, 12, tw(lbl, 10)); }
      }
      o.push('<g pointer-events="none">' + tq.join('') + '</g>');
    }

    /* ---- AP 커버리지 / CCTV 화각 (배경) ---- */
    var cov = [];
    placed.forEach(function (p) {
      if (p.kind === 'ap') {
        var rr = clamp(7000 * s, 30, 260);
        cov.push('<circle cx="' + n(p.x) + '" cy="' + n(p.y) + '" r="' + n(rr) + '" fill="#22d3ee" fill-opacity="0.05" stroke="#22d3ee" stroke-opacity="0.4" stroke-dasharray="4 4"/>');
      } else if (p.kind === 'cctv') {
        var rm = roomById[p.a.room], tx0 = rm ? X(rm.x + rm.w / 2) : (bx0 + bx1) / 2, ty0 = rm ? Y(rm.y + rm.h / 2) : (by0 + by1) / 2;
        var ang = Math.hypot(tx0 - p.x, ty0 - p.y) < 6 ? Math.PI / 2 : Math.atan2(ty0 - p.y, tx0 - p.x), fr = clamp(6000 * s, 30, 200), hf = 35 * Math.PI / 180;
        p.ang = ang * 180 / Math.PI;
        cov.push('<path d="M' + n(p.x) + ' ' + n(p.y) + 'L' + n(p.x + Math.cos(ang - hf) * fr) + ' ' + n(p.y + Math.sin(ang - hf) * fr) + 'A' + n(fr) + ' ' + n(fr) + ' 0 0 1 ' + n(p.x + Math.cos(ang + hf) * fr) + ' ' + n(p.y + Math.sin(ang + hf) * fr) + 'Z" fill="#a78bfa" fill-opacity="0.08" stroke="#a78bfa" stroke-opacity="0.45" stroke-dasharray="4 3"/>');
      }
    });
    if (cov.length) o.push('<g pointer-events="none"><clipPath id="tx-c-clip"><rect x="' + n(bx0) + '" y="' + n(by0) + '" width="' + n(pw) + '" height="' + n(ph) + '"/></clipPath><g clip-path="url(#tx-c-clip)">' + cov.join('') + '</g></g>');

    /* ---- 라이저 ---- */
    var risers = (M.risers || []).filter(function (r) { return (r.floors || []).indexOf(code) >= 0 && fin(r.x); });
    risers = risers.map(function (rs) { return { id: rs.id, name: rs.name, floors: rs.floors || [], x: rs.x, y: rs.y, _px: X(clamp(rs.x, b.x0 + 300, b.x1 - 300)), _py: Y(clamp(rs.y, b.y0 + 300, b.y1 - 300)), _to: {} }; }); // 모델 원본 불변

    /* ---- 결선 (직교 경로: 트레이/복도 축 · 타층은 라이저 경유) ---- */
    var axes = trays.slice();
    if (!axes.length) corrs.forEach(function (c) { var p = RP[c.id]; if (!p) return; if (p.w >= p.h) axes.push({ h: true, x1: p.x, x2: p.x + p.w, y1: p.y + p.h / 2, y2: p.y + p.h / 2 }); else axes.push({ h: false, x1: p.x + p.w / 2, x2: p.x + p.w / 2, y1: p.y, y2: p.y + p.h }); });
    function axisDist(t, x, y) {
      if (t.h) { var yy = t.y1 + (t.y2 - t.y1) * clamp((x - t.x1) / ((t.x2 - t.x1) || 1), 0, 1); return Math.abs(y - yy) + Math.max(0, Math.min(t.x1, t.x2) - x, x - Math.max(t.x1, t.x2)); }
      var xx = t.x1 + (t.x2 - t.x1) * clamp((y - t.y1) / ((t.y2 - t.y1) || 1), 0, 1); return Math.abs(x - xx) + Math.max(0, Math.min(t.y1, t.y2) - y, y - Math.max(t.y1, t.y2));
    }
    function route(x1, y1, x2, y2, sameRoom, lane) {
      if (sameRoom || !axes.length) {
        if (sameRoom && Math.abs(y1 - y2) < 3) return 'M' + n(x1) + ' ' + n(y1) + 'H' + n(x2);
        var my = (y1 + y2) / 2 + lane;
        return sameRoom ? 'M' + n(x1) + ' ' + n(y1) + 'V' + n(my) + 'H' + n(x2) + 'V' + n(y2) : 'M' + n(x1) + ' ' + n(y1) + 'H' + n((x1 + x2) / 2 + lane) + 'V' + n(y2) + 'H' + n(x2);
      }
      var best = null, bd = 1e9;
      axes.forEach(function (t) { var d = axisDist(t, x1, y1) + axisDist(t, x2, y2); if (d < bd) { bd = d; best = t; } });
      if (best.h) { var ty = (best.y1 + best.y2) / 2 + lane; return 'M' + n(x1) + ' ' + n(y1) + 'V' + n(ty) + 'H' + n(x2) + 'V' + n(y2); }
      var tx = (best.x1 + best.x2) / 2 + lane; return 'M' + n(x1) + ' ' + n(y1) + 'H' + n(tx) + 'V' + n(y2) + 'H' + n(x2);
    }
    var linkO = [], hotLinks = [], linkIdx = 0;
    function segBoxes(d) { // 직교 경로 세그먼트를 얇은 장애물로 등록(라벨·태그 회피용)
      var tk = d.match(/[MLHVv]|-?[\d.]+/g) || [], cx = 0, cy = 0, i = 0;
      while (i < tk.length) {
        var c = tk[i++];
        if (c === 'M') { cx = +tk[i++]; cy = +tk[i++]; continue; }
        var nx = cx, ny = cy;
        if (c === 'H') nx = +tk[i++]; else if (c === 'V') ny = +tk[i++]; else if (c === 'v') ny = cy + (+tk[i++]); else if (c === 'L') { nx = +tk[i++]; ny = +tk[i++]; } else continue;
        boxes.add(Math.min(cx, nx) - 2, Math.min(cy, ny) - 2, Math.abs(nx - cx) + 4, Math.abs(ny - cy) + 4);
        cx = nx; cy = ny;
      }
    }
    if (L.links !== false) {
      (M.links || []).forEach(function (lk) {
        var p1 = P[lk.from], p2 = P[lk.to];
        if (!p1 && !p2) return;
        if (p1 && p1 === p2) return; // 같은 묶음 안의 모듈 간 연결
        var meta = C.LINK[lk.type] || C.LINK.path;
        var onPath = fault && (lk.from === src || imp.has(lk.from)) && imp.has(lk.to);
        var isSel = sel && (lk.from === sel || lk.to === sel);
        var lane = (LANE[lk.type] || 0) + ((linkIdx++ % 3) - 1) * 1.1;
        var col = onPath ? '#ff1744' : meta.css;
        var sw = onPath ? 2.6 : isSel ? 2.1 : 1.3, so = onPath || isSel ? 1 : (fault ? 0.3 : 0.62);
        var dash = meta.dash && !onPath ? ' stroke-dasharray="6 4"' : '';
        var d, ttl;
        if (p1 && p2) {
          d = route(p1.x + lane * 0.5, p1.y, p2.x + lane * 0.5, p2.y, p1.a.room && p1.a.room === p2.a.room, lane);
          ttl = (meta.name) + ' · ' + p1.a.name + ' → ' + p2.a.name + (lk.cable ? ' [' + lk.cable + ']' : '');
        } else {
          var p = p1 || p2, other = TX.asset(p1 ? lk.to : lk.from), ofl = other ? other.floor : '?';
          var cand = risers.filter(function (r) { return !other || r.floors.indexOf(ofl) >= 0; }); if (!cand.length) cand = risers;
          if (cand.length) {
            var rs = cand.reduce(function (bb, r) { return Math.hypot(r._px - p.x, r._py - p.y) < Math.hypot(bb._px - p.x, bb._py - p.y) ? r : bb; });
            rs._to[ofl] = (rs._to[ofl] || 0) + 1;
            d = route(p.x + lane * 0.5, p.y, rs._px + lane, rs._py, false, lane);
          } else {
            d = 'M' + n(p.x) + ' ' + n(p.y) + 'v' + n(-36 - Math.abs(lane) * 2);
            linkO.push('<text x="' + n(p.x + 4) + '" y="' + n(p.y - 40) + '" class="tx-c-code" style="font-size:9px" fill="' + col + '">→' + esc(ofl) + '</text>');
          }
          ttl = meta.name + ' · ' + (p1 ? p1.a.name + ' → ' + (other ? other.name : lk.to) : (other ? other.name : lk.from) + ' → ' + p2.a.name) + ' (' + ofl + ' 연결 · 라이저 경유)';
        }
        segBoxes(d);
        var pth = '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '" stroke-opacity="' + so + '"' + dash + (onPath ? ' class="tx-c-flow"' : '') + ' stroke-linejoin="round"><title>' + esc(ttl) + '</title></path>';
        (onPath || isSel ? hotLinks : linkO).push(pth);
      });
      o.push('<g>' + linkO.join('') + hotLinks.join('') + '</g>');
    }

    // 라이저 기호(⊠) + 층범위 + 타층 연결 표기
    risers.forEach(function (rs) {
      var cx = rs._px, cy = rs._py, r = 11 * Math.max(0.8, k);
      var tos = Object.keys(rs._to), l1 = (rs.name || rs.id) + ' ↕ ' + riserRange(rs), l2 = tos.length ? '⇅ ' + tos.join('·') + ' 연결 ' + tos.reduce(function (a, t) { return a + rs._to[t]; }, 0) + '회선' : '';
      // 라벨 위치: 우측 우선, 공간 없으면 좌측
      var lw = Math.max(tw(l1, 10, true), tw(l2, 9, true)), lxr = cx + r + 5, lxl = cx - r - 5 - lw;
      var useL = boxes.hit(lxr, cy - 9, lw, 24) + symBoxes.hit(lxr, cy - 9, lw, 24) > boxes.hit(lxl, cy - 9, lw, 24) + symBoxes.hit(lxl, cy - 9, lw, 24) || lxr + lw > bx1 + T + 20;
      var lx = useL ? lxl : lxr;
      o.push('<g pointer-events="none"><rect x="' + n(cx - r) + '" y="' + n(cy - r) + '" width="' + n(r * 2) + '" height="' + n(r * 2) + '" fill="#082f49" stroke="#38bdf8" stroke-width="2"/>' +
        '<path d="M' + n(cx - r) + ' ' + n(cy - r) + 'L' + n(cx + r) + ' ' + n(cy + r) + 'M' + n(cx - r) + ' ' + n(cy + r) + 'L' + n(cx + r) + ' ' + n(cy - r) + '" stroke="#38bdf8" stroke-width="1.2"/>' +
        '<text x="' + n(lx) + '" y="' + n(cy + 1) + '" class="tx-c-code tx-c-halo" fill="#7dd3fc">' + esc(l1) + '</text>' +
        (l2 ? '<text x="' + n(lx) + '" y="' + n(cy + 13) + '" class="tx-c-code tx-c-halo" style="font-size:9px" fill="#a5b4fc">' + esc(l2) + '</text>' : '') + '</g>');
      boxes.add(cx - r, cy - r, r * 2, r * 2); boxes.add(lx, cy - 10, lw, l2 ? 26 : 14);
    });

    /* ---- 설비 심볼 + 선택 + 장애 ---- */
    var eqO = [];
    placed.forEach(function (p) {
      var a = p.a, g = C.GRADE[a.grade] || C.GRADE.NONE, col = g.css, e = p.e;
      boxes.add(p.x - e[0] - 2, p.y - e[1] - 2, e[0] * 2 + 4, e[1] * 2 + 4);
      var isSrc = fault && a.id === src, im = fault ? imp.get(a.id) : null;
      var dimmed = fault && !isSrc && !im;
      var q = '<g class="tx-c-eq' + (dimmed ? ' tx-c-dim0' : '') + '" data-a="' + esc(a.id) + '">';
      var R0 = Math.max(e[0], e[1]);
      if (isSrc || im) {
        var fc = isSrc ? '#ff1744' : im.sev === 'outage' ? '#f43f5e' : '#f59e0b';
        q += '<circle cx="' + n(p.x) + '" cy="' + n(p.y) + '" r="' + n(R0 + 14) + '" fill="' + fc + '" fill-opacity="0.14" stroke="' + fc + '" stroke-width="2" class="tx-c-pulse"/>';
      }
      if (L.ground !== false && gndBad(a.measures)) {
        q += '<circle cx="' + n(p.x) + '" cy="' + n(p.y) + '" r="' + n(R0 + 7) + '" fill="none" stroke="#f43f5e" stroke-width="1.3" stroke-dasharray="3 2"/>' +
          '<g transform="translate(' + n(p.x + e[0] + 2) + ' ' + n(p.y + e[1] + 2) + ')"><circle r="7" fill="#450a0a" stroke="#f43f5e"/><path d="M0 -4V0M-4 0H4M-2.6 2.2H2.6M-1.2 4.2H1.2" stroke="#fda4af" stroke-width="1.1"/></g>';
      }
      q += '<rect x="' + n(p.x - e[0] - 3) + '" y="' + n(p.y - e[1] - 3) + '" width="' + n(e[0] * 2 + 6) + '" height="' + n(e[1] * 2 + 6) + '" fill="transparent"/>';
      q += sym(p.kind, p.x, p.y, col, k, p.ang);
      if (a.id === sel) q += '<circle cx="' + n(p.x) + '" cy="' + n(p.y) + '" r="' + n(R0 + 10) + '" fill="none" stroke="#22d3ee" stroke-width="2" stroke-dasharray="5 3"/>';
      eqO.push(q + '</g>');
    });
    o.push(eqO.join(''));

    /* ---- 실 측정 배지 + 실명 (충돌 회피) ---- */
    var lab = [];
    rooms.forEach(function (r) {
      var p = RP[r.id];
      // 실측 배지
      if (L.measure !== false || L.ground !== false) {
        var sm = summarize(L.measure !== false ? r.measures : (r.measures || []).filter(function (m) { return m.std === 'gnd'; }));
        if (sm && (L.measure !== false || sm.bad)) {
          var txt = (sm.est ? '실측≈ ' : '실측 ') + sm.items.map(mText).join(' · ');
          var maxw = p.w - 10, bt = fitText(txt, 9.5, maxw - 10);
          if (bt && maxw > 50 && p.h > 26) {
            var bwid = tw(bt, 9.5) + 10, bxp = p.x + p.w - bwid - 5, byp = p.y + 5;
            lab.push('<g pointer-events="none"><rect x="' + n(bxp) + '" y="' + n(byp) + '" width="' + n(bwid) + '" height="14" rx="3" fill="' + (sm.bad ? '#4c0519' : sm.warn ? '#3b2a05' : '#0c2a3f') + '" stroke="' + (sm.bad ? '#f43f5e' : sm.warn ? '#eab308' : '#38bdf8') + '" stroke-width="0.9"/>' +
              '<text x="' + n(bxp + 5) + '" y="' + n(byp + 10.2) + '" style="font:700 9.5px ' + FONT.replace(/"/g, "'") + '" fill="' + (sm.bad ? '#fecdd3' : sm.warn ? '#fde68a' : '#bae6fd') + '">' + esc(bt) + '</text></g>');
            boxes.add(bxp, byp, bwid, 14);
          }
        }
      }
      // 실명·실코드·면적
      var area = (r.w * r.h / 1e6).toFixed(1) + '㎡', name = String(r.name || ''), codeT = String(r.id || '');
      var iw = p.w - 8, ih = p.h - 6;
      if (iw < 14 || ih < 11) return;
      var one = r.type === 'corr' || ih < 40;
      var fs = 12;
      if (tw(name, fs) > iw) fs = 10.5;
      if (tw(name, fs) > iw) { name = name.split(/[\s·/(]/)[0]; }
      if (tw(name, fs) > iw) name = fitText(name, fs, iw);
      var lines = [];
      if (one) {
        var full = name + '  [' + codeT + ']';
        if (r.type === 'corr' && tw(full, fs) < iw) lines.push(['n', name, fs, codeT]);
        else if (name) lines.push(['n', name, fs]);
        else if (tw(codeT, 9, true) < iw) lines.push(['c', codeT]);
      } else {
        if (name) lines.push(['n', name, fs]);
        if (tw(codeT, 10, true) < iw && ih >= 28) lines.push(['c', codeT]);
        if (ih >= 44 && tw(area, 10, true) < iw) lines.push(['a', area]);
      }
      if (!lines.length) return;
      var lh = lines.length === 1 ? 14 : lines.length * 13 + 2;
      var lw = Math.max.apply(null, lines.map(function (l) { return l[0] === 'n' ? tw(l[1] + (l[3] ? '  [' + l[3] + ']' : ''), l[2]) : tw(l[1], 10, true); }));
      // 후보: 중앙, 상/하 1/4, 좌/우 측, 복도는 좌측 1/5 등
      var cxs2 = r.type === 'corr' ? [p.x + Math.min(p.w * 0.2, 160), p.x + p.w / 2, p.x + p.w * 0.75] : [p.x + p.w / 2, p.x + p.w * 0.3, p.x + p.w * 0.7];
      var cys2 = [p.y + p.h / 2, p.y + p.h * 0.72, p.y + p.h * 0.28, p.y + p.h - lh / 2 - 6, p.y + lh / 2 + 22];
      var bestC = null, bsc = 1e12;
      cys2.forEach(function (cy, yi) {
        cxs2.forEach(function (cx, xi) {
          var x0 = clamp(cx - lw / 2, p.x + 4, p.x + p.w - 4 - lw), y0 = clamp(cy - lh / 2, p.y + 3, p.y + p.h - 3 - lh);
          var sc = boxes.hit(x0 - 2, y0 - 1, lw + 4, lh + 2) * 10 + (yi + xi) * 3;
          if (sc < bsc) { bsc = sc; bestC = [x0, y0]; }
        });
      });
      var tx = bestC[0] + lw / 2, ty = bestC[1];
      boxes.add(bestC[0] - 2, bestC[1] - 1, lw + 4, lh + 2);
      var q = '<g class="tx-c-rm" data-r="' + esc(r.id) + '">', yy = ty + 11;
      lines.forEach(function (l) {
        if (l[0] === 'n') q += '<text x="' + n(tx) + '" y="' + n(yy) + '" text-anchor="middle" class="tx-c-room tx-c-halo"' + (l[2] !== 12 ? ' style="font-size:' + l[2] + 'px"' : '') + '>' + esc(l[1]) + (l[3] ? ' <tspan class="tx-c-code" fill="#7dd3fc">[' + esc(l[3]) + ']</tspan>' : '') + '</text>';
        else if (l[0] === 'c') q += '<text x="' + n(tx) + '" y="' + n(yy) + '" text-anchor="middle" class="tx-c-code tx-c-halo" fill="' + (r.type === 'telecom' ? '#fb923c' : '#7dd3fc') + '">' + esc(l[1]) + '</text>';
        else q += '<text x="' + n(tx) + '" y="' + n(yy) + '" text-anchor="middle" class="tx-c-dim tx-c-halo">' + esc(l[1]) + '</text>';
        yy += 13;
      });
      lab.push(q + '</g>');
    });
    o.push(lab.join(''));

    /* ---- 인출선 태그 (8방향×3링 후보 + 사각형 겹침 검사) ---- */
    var tagO = [], tagsShown = 0, tagsSkipped = 0;
    if (showTags && placed.length) {
      var dense = placed.length > 40;
      var GR = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3, NONE: 4 };
      placed.forEach(function (z) { var a = z.a; z.pri = (a.id === sel ? -100 : 0) + (fault && (a.id === src || imp.has(a.id)) ? -50 : 0) + (GR[a.grade] != null ? GR[a.grade] : 4) * 2 + (gndBad(a.measures) || (a.measures || []).some(function (m) { return m.judge === 'bad'; }) ? -3 : 0); });
      var order = placed.slice().sort(function (p, q) { return p.pri - q.pri; });
      var region = { x0: bx0 - T - 30, y0: by0 - T - 20, x1: Math.min(bx1 + T + 40, legendX - 8), y1: by1 + T + 30 };
      var dirs = [[1, -1], [1, 1], [-1, -1], [-1, 1], [1, 0], [-1, 0], [0, -1], [0, 1]];
      order.forEach(function (p) {
        var a = p.a, g = C.GRADE[a.grade] || C.GRADE.NONE, col = g.css;
        var important = a.id === sel || (fault && (a.id === src || imp.has(a.id))) || a.grade === 'RED' || a.grade === 'ORANGE';
        var must = a.id === sel || (fault && (a.id === src || imp.has(a.id)));
        var sm = (L.measure !== false) ? summarize(a.measures) : (L.ground !== false && gndBad(a.measures) ? summarize((a.measures || []).filter(function (m) { return m.std === 'gnd'; })) : null);
        var l1 = String(a.bundleLabel || a.id), l1b = a.grade && a.grade !== 'NONE' ? a.grade : '';
        var fl2 = fitText(String(a.name || '').replace(/^(지하\d+층|지상\d+층|\d+층)\s*/, ''), 10.5, 150);
        var fl3 = sm ? fitText((sm.bad ? '⚠ ' : sm.warn ? '△ ' : '실측 ') + (sm.est ? '≈' : '') + sm.items.slice(0, 1).map(mText).join(''), 9.5, 150, false) : '';
        if (fault && (a.id === src || imp.has(a.id))) fl3 = a.id === src ? '⚡ 장애 발생원' : (imp.get(a.id).sev === 'outage' ? '✖ 서비스 중단 영향' : '△ 성능 저하 영향');
        function place(cmp) {
          var l2 = cmp ? '' : fl2, l3 = cmp ? '' : fl3;
          var wT = Math.max(tw(l1 + (l1b ? ' ' + l1b : ''), 10, true), tw(l2, 10.5), tw(l3, 9.5)) + 12;
          var hT = cmp ? 16 : 18 + (l2 ? 13 : 0) + (l3 ? 13 : 0);
          var best = null, bs = 1e12, ringD = cmp ? [10, 26, 48] : [14, 34, 62, 96];
          for (var ri = 0; ri < ringD.length; ri++) {
            for (var di = 0; di < 8; di++) {
              var dx = dirs[di][0], dy = dirs[di][1], dd = ringD[ri];
              var x0 = dx > 0 ? p.x + p.e[0] + dd : dx < 0 ? p.x - p.e[0] - dd - wT : p.x - wT / 2;
              var y0 = dy > 0 ? p.y + p.e[1] + dd * 0.6 : dy < 0 ? p.y - p.e[1] - dd * 0.6 - hT : p.y - hT / 2;
              var out = Math.max(0, region.x0 - x0) + Math.max(0, x0 + wT - region.x1) + Math.max(0, region.y0 - y0) + Math.max(0, y0 + hT - region.y1);
              var pen = out * 400 + ri * 60 + di * 2;
              if (pen >= bs) continue;
              var ov = boxes.hit(x0 - 2, y0 - 2, wT + 4, hT + 4, bs - pen);
              var sc = ov + pen;
              if (sc < bs) { bs = sc; best = { x: x0, y: y0, ov: ov + out * 50, w: wT, h: hT, l2: l2, l3: l3, cmp: cmp }; }
            }
            if (best && best.ov <= wT * hT * 0.04) break;
          }
          best.ok = best.ov <= best.w * best.h * 0.06;
          return best;
        }
        // 기본은 간단 라벨(ID·등급)만 — 선택·장애 설비 또는 「설비 상세 라벨」 켬일 때 이름·실측까지
        var detail = L.tagDetail === true;
        var best = must ? place(false) : !detail ? place(true) : (dense && !important) ? null : place(false);
        if (!best || !best.ok) {
          var cb = place(true);
          if (cb.ok) best = cb;
          else if (must) best = best || place(false);
          else if (important && !dense && best && best.ov < best.w * best.h * 0.25) { /* keep */ }
          else best = null;
        }
        if (!best) { tagsSkipped++; return; }
        var compact = best.cmp, wT = best.w, hT = best.h, l2 = best.l2, l3 = best.l3;
        tagsShown++;
        boxes.add(best.x - 2, best.y - 2, wT + 4, hT + 4);
        var nx = clamp(p.x, best.x, best.x + wT), ny = clamp(p.y, best.y, best.y + hT);
        var ang = Math.atan2(ny - p.y, nx - p.x), R0 = Math.max(p.e[0], p.e[1]) * 0.9;
        var sx = p.x + Math.cos(ang) * R0, sy = p.y + Math.sin(ang) * R0;
        var dimmed = fault && !(a.id === src || imp.has(a.id));
        var q = '<g class="tx-c-eq' + (dimmed ? ' tx-c-dim0' : '') + '" data-a="' + esc(a.id) + '">' +
          '<polyline points="' + n(sx) + ',' + n(sy) + ' ' + n(nx) + ',' + n(ny) + '" fill="none" stroke="' + col + '" stroke-width="0.9"/><circle cx="' + n(sx) + '" cy="' + n(sy) + '" r="1.6" fill="' + col + '"/>' +
          '<rect x="' + n(best.x) + '" y="' + n(best.y) + '" width="' + n(wT) + '" height="' + hT + '" rx="3" fill="#020617" fill-opacity="0.92" stroke="' + col + '" stroke-width="' + (a.id === sel ? 1.8 : 1.1) + '"/>' +
          '<text x="' + n(best.x + 6) + '" y="' + n(best.y + (compact ? 11.5 : 12.5)) + '" class="tx-c-code" fill="#f8fafc">' + esc(l1) + (l1b ? ' <tspan fill="' + col + '">' + l1b + '</tspan>' : '') + '</text>';
        var yy = best.y + 25.5;
        if (l2) { q += '<text x="' + n(best.x + 6) + '" y="' + n(yy) + '" class="tx-c-sm" style="font-size:10.5px" fill="#cbd5e1">' + esc(l2) + '</text>'; yy += 13; }
        if (l3) q += '<text x="' + n(best.x + 6) + '" y="' + n(yy) + '" style="font:700 9.5px ' + FONT.replace(/"/g, "'") + '" fill="' + (sm && sm.bad || /장애|중단|저하/.test(l3) ? '#fda4af' : '#7dd3fc') + '">' + esc(l3) + '</text>';
        tagO.push(q + '</g>');
      });
      o.push(tagO.join(''));
    }

    /* ---- 범례 ---- */
    var kinds = {}; placed.forEach(function (p) { kinds[p.kind] = 1; }); if (!placed.length) kinds.rack = 1;
    var rtypes = {}; rooms.forEach(function (r) { rtypes[r.type] = 1; });
    var lg = [], ly = 24, ROWH = 27;
    lg.push('<text x="14" y="' + ly + '" class="tx-c-tbh" fill="#7dd3fc" style="font-size:10px">범례 LEGEND</text>'); ly += 22;
    lg.push('<text x="14" y="' + ly + '" class="tx-c-tbh">설비 기호 SYMBOL</text>'); ly += 18;
    KIND_ORDER.forEach(function (kd) {
      if (!kinds[kd]) return;
      lg.push(sym(kd, 44, ly, '#cbd5e1', kd === 'tray' ? 0.62 : 0.8, -90 + 90) + '<text x="86" y="' + (ly + 4) + '" class="tx-c-tb">' + KIND_LABEL[kd] + '</text>'); ly += ROWH;
    });
    lg.push('<g transform="translate(44,' + ly + ')"><rect x="-10" y="-10" width="20" height="20" fill="#082f49" stroke="#38bdf8" stroke-width="2"/><path d="M-10 -10L10 10M-10 10L10 -10" stroke="#38bdf8"/></g><text x="86" y="' + (ly + 4) + '" class="tx-c-tb">EPS/TPS 수직 라이저</text>'); ly += ROWH;
    lg.push('<line x1="24" y1="' + (ly - 5) + '" x2="64" y2="' + (ly - 5) + '" stroke="#facc15"/><line x1="24" y1="' + (ly + 5) + '" x2="64" y2="' + (ly + 5) + '" stroke="#facc15"/><line x1="24" y1="' + ly + '" x2="64" y2="' + ly + '" stroke="#facc15" stroke-width="10" stroke-dasharray="1.1 6"/><text x="86" y="' + (ly + 4) + '" class="tx-c-tb">케이블 트레이 (추정)</text>'); ly += ROWH - 4;
    ly += 6;
    lg.push('<text x="14" y="' + ly + '" class="tx-c-tbh">결선 LINK</text>'); ly += 14;
    Object.keys(C.LINK).forEach(function (lk) {
      var m = C.LINK[lk];
      lg.push('<line x1="24" y1="' + ly + '" x2="64" y2="' + ly + '" stroke="' + m.css + '" stroke-width="2"' + (m.dash ? ' stroke-dasharray="6 4"' : '') + '/><text x="86" y="' + (ly + 4) + '" class="tx-c-tb">' + m.name + '</text>'); ly += 19;
    });
    lg.push('<line x1="24" y1="' + ly + '" x2="64" y2="' + ly + '" stroke="#ff1744" stroke-width="2.6" stroke-dasharray="9 6"/><text x="86" y="' + (ly + 4) + '" class="tx-c-tb">장애 파급 경로</text>'); ly += 24;
    lg.push('<text x="14" y="' + ly + '" class="tx-c-tbh">등급 GRADE (정기점검 실측·상태)</text>'); ly += 14;
    Object.keys(C.GRADE).forEach(function (gk, i) {
      var cx0 = 14 + (i % 2) * 124, cy0 = ly + Math.floor(i / 2) * 18;
      lg.push('<rect x="' + cx0 + '" y="' + (cy0 - 9) + '" width="11" height="11" rx="2" fill="' + C.GRADE[gk].css + '"/><text x="' + (cx0 + 16) + '" y="' + cy0 + '" class="tx-c-sm" fill="#cbd5e1">' + gk + ' ' + C.GRADE[gk].name + '</text>');
    });
    ly += Math.ceil(Object.keys(C.GRADE).length / 2) * 18 + 8;
    var hatchOf = { telecom: 'tx-c-hTel', server: 'tx-c-hSrv', power: 'tx-c-hPwr', elec: 'tx-c-hElec', mech: 'tx-c-hMech', control: 'tx-c-raised', corr: 'tx-c-tile', lobby: 'tx-c-tile', wc: 'tx-c-wc', store: 'tx-c-dots' };
    var rt = Object.keys(C.ROOM).filter(function (t) { return rtypes[t]; });
    if (rt.length) {
      lg.push('<text x="14" y="' + ly + '" class="tx-c-tbh">실 구분 ROOM</text>'); ly += 14;
      rt.forEach(function (t, i) {
        var cx0 = 14 + (i % 2) * 124, cy0 = ly + Math.floor(i / 2) * 18, rs = C.ROOM[t];
        lg.push('<rect x="' + cx0 + '" y="' + (cy0 - 10) + '" width="16" height="12" fill="' + rs.fill + '" fill-opacity="0.18" stroke="' + (rs.hatch || '#94a3b8') + '" stroke-width="0.8"/>' + (hatchOf[t] ? '<rect x="' + cx0 + '" y="' + (cy0 - 10) + '" width="16" height="12" fill="url(#' + hatchOf[t] + ')"/>' : '') +
          '<text x="' + (cx0 + 21) + '" y="' + cy0 + '" class="tx-c-sm" fill="#cbd5e1">' + esc(fitText(rs.label, 10, 98)) + '</text>');
      });
      ly += Math.ceil(rt.length / 2) * 18 + 6;
    }
    var layerTxt = [['tray', '트레이'], ['links', '결선'], ['measure', '실측'], ['ground', '접지'], ['thermal', '열화상']].map(function (q) { return (L[q[0]] !== false && (q[0] !== 'thermal' || L.thermal) ? '■ ' : '□ ') + q[1]; }).join('  ');
    lg.push('<text x="14" y="' + ly + '" class="tx-c-sm" style="font-size:9.5px">표시: ' + layerTxt + '</text>'); ly += 14;
    lg.push('<text x="14" y="' + ly + '" class="tx-c-sm" style="font-size:9.5px">실측 배지: <tspan fill="#f43f5e">■</tspan>불량 <tspan fill="#eab308">■</tspan>주의 <tspan fill="#38bdf8">■</tspan>양호 · ≈ 매칭 추정</text>'); ly += 14;
    if (L.thermal && !heatCount) { lg.push('<text x="14" y="' + ly + '" class="tx-c-sm" style="font-size:9.5px" fill="#fbbf24">※ 이 층에 발열(열화상) 실측값 없음</text>'); ly += 14; }
    var legTop = 40, legAvail = H - 28 - 108 - 16 - legTop, legH = ly + 6, lsc = Math.min(1, legAvail / legH);
    o.push('<g transform="translate(' + legendX + ',' + legTop + ')"><rect x="0" y="0" width="' + LEGW + '" height="' + n(Math.min(legAvail, legH * lsc)) + '" fill="#0b1220" stroke="#1e3a8a"/>' +
      '<g transform="scale(' + n(lsc * 1000) / 1000 + ')">' + lg.join('') + '</g></g>');

    /* ---- 축척바 · 방위표 ---- */
    var steps = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100], stepM = 100;
    for (var si = 0; si < steps.length; si++) if (steps[si] * 1000 * s >= 52) { stepM = steps[si]; break; }
    var segPx = stepM * 1000 * s, sbx = LM, sby = H - 112, sb = [];
    for (var i2 = 0; i2 < 5; i2++) sb.push('<rect x="' + n(i2 * segPx) + '" y="0" width="' + n(segPx) + '" height="7" fill="' + (i2 % 2 ? PAPER : '#cbd5e1') + '" stroke="#cbd5e1" stroke-width="0.8"/><text x="' + n(i2 * segPx) + '" y="21" text-anchor="middle" class="tx-c-dim">' + (i2 * stepM) + (i2 ? '' : 'm') + '</text>');
    sb.push('<text x="' + n(5 * segPx) + '" y="21" text-anchor="middle" class="tx-c-dim">' + (5 * stepM) + 'm</text><text x="' + n(5 * segPx + 30) + '" y="8" class="tx-c-dim" fill="#cbd5e1">SCALE ' + nom.text + ' (근사)</text>');
    o.push('<g transform="translate(' + sbx + ',' + sby + ')">' + sb.join('') + '</g>');
    var tbw = 610, tbh = 98, tbx = W - 28 - tbw, tby = H - 28 - tbh;
    var nx0 = tbx - 52, ny0 = H - 84;
    o.push('<g transform="translate(' + nx0 + ',' + ny0 + ')"><circle r="24" fill="none" stroke="#64748b"/><circle r="19" fill="none" stroke="#334155" stroke-dasharray="2 3"/><path d="M0 -22L8 8L0 2L-8 8Z" fill="#e2e8f0"/><text y="-29" text-anchor="middle" class="tx-c-code" fill="#e2e8f0">N</text></g>');

    /* ---- 표제란 ---- */
    var rev = fault ? 'R2 (장애해석)' : 'R1';
    function cell(x, y, w, h, hd, val, big) {
      var v = fitText(val, big ? 14 : 11, w - 12);
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="none" stroke="#334155"/><text x="' + (x + 6) + '" y="' + (y + 13) + '" class="tx-c-tbh">' + hd + '</text><text x="' + (x + 6) + '" y="' + (y + h - 10) + '" class="tx-c-tb"' + (big ? ' style="font-size:14px;font-weight:700;fill:#f8fafc"' : '') + '>' + esc(v) + '</text>';
    }
    var siteName = (M.site && (M.site.name || M.site.building)) || '정보통신설비';
    var dno = dwgNo(code);
    o.push('<g><rect x="' + tbx + '" y="' + tby + '" width="' + tbw + '" height="' + tbh + '" fill="#0b1220" stroke="#64748b" stroke-width="1.4"/>' +
      cell(tbx, tby, 250, 49, 'PROJECT 사업명', siteName + ' 정보통신설비') +
      cell(tbx, tby + 49, 250, 49, 'DRAWING 도면명', (fl.name || fl.code) + ' 정보통신설비 평면도', true) +
      cell(tbx + 250, tby, 140, 49, 'DWG NO. 도면번호', dno) +
      cell(tbx + 250, tby + 49, 140, 49, 'SCALE 축척', nom.text) +
      cell(tbx + 390, tby, 110, 49, 'DATE 작성일', U.today()) +
      cell(tbx + 390, tby + 49, 110, 49, 'REV. 개정', rev) +
      cell(tbx + 500, tby, 110, 98, 'ORG. 작성', 'kt MOS 북부') +
      '<text x="' + (tbx + 506) + '" y="' + (tby + 50) + '" class="tx-c-sm">TwinX 자동생성</text><text x="' + (tbx + 506) + '" y="' + (tby + 64) + '" class="tx-c-sm" style="font-size:9px">' + (M.source === 'admin' ? 'ADMIN 등록자료' : '데모 자료') + '</text></g>');

    /* ---- 주기 ---- */
    var lastM = ''; (M.measurements || []).forEach(function (m) { if (m.date && String(m.date) > lastM) lastM = String(m.date); });
    var notes = ['※ 본 도면은 ADMIN 설비 DB(설비·실·연결관계)에서 자동 생성되며 3D 뷰와 동일 좌표계(mm)를 사용함.',
      '※ 치수 단위 mm · 케이블트레이/라이저/결선 경로는 실 배치 기반 추정 경로임 · 통신실 이중마루 600×600.',
      '※ 측정값은 정기점검 실측 자료(자동 수집 아님)' + (lastM ? ' · 최근 점검일 ' + lastM : '') + '.'];
    var nmax = tbx - 70 - LM;
    notes.forEach(function (t, i) { o.push('<text x="' + LM + '" y="' + (H - 70 + i * 15) + '" class="tx-c-sm" fill="#64748b" style="font-size:9.5px">' + esc(fitText(t, 9.5, nmax)) + '</text>'); });

    var ms = performance.now() - t0;
    return { svg: o.join(''), W: W, H: H, code: code, dwg: dno, ms: ms, stats: { rooms: rooms.length, assets: placed.length, tags: tagsShown, tagsSkipped: tagsSkipped, scale: nom.text, s: s } };
  }

  /* ==================================================================
     DOM · 뷰포트 상호작용
     ================================================================== */
  var dom = { host: null, wrap: null, svg: null, tip: null };
  var view = null, sheet = null, last = null, dirty = true, raf = 0, fitNext = true, moved = false, userView = false;

  function curFloor() {
    var M = TX.model; if (!M || !M.floors || !M.floors.length) return null;
    var c = TX.state.floor; return M.floors.some(function (f) { return f.code === c; }) ? c : M.floors[0].code;
  }
  function visible() {
    if (!dom.host) return false;
    var ui = TX.ui;
    if (ui && ui.view2d === dom.host && typeof ui.isVisible === 'function') return !!ui.isVisible('2d');
    return true;
  }
  function applyView() { if (dom.svg && view) dom.svg.setAttribute('viewBox', n(view.x) + ' ' + n(view.y) + ' ' + n(view.w) + ' ' + n(view.h)); }
  /* 뷰포트 위에 떠 있는 셸 패널(층 레일·인스펙터·범례)을 피한 빈 영역 계산 */
  function freeArea() {
    var hr = dom.wrap.getBoundingClientRect(), f = { x0: 0, y0: 0, x1: hr.width, y1: hr.height, cw: hr.width, ch: hr.height };
    var ui = TX.ui; if (!ui || !hr.width) return f;
    [ui.floorRail, ui.inspector, document.querySelector('.tx-qk')].forEach(function (el) { // .tx-qk: 간이 현행화 패널
      if (!el || !el.getBoundingClientRect) return;
      var r = el.getBoundingClientRect(); if (r.width < 4 || r.width > hr.width * 0.4 || r.height < hr.height * 0.2) return;
      var cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
      var l = r.left - hr.left, rr = r.right - hr.left;
      if (rr < hr.width * 0.4 && rr > f.x0) f.x0 = rr + 6;
      else if (l > hr.width * 0.6 && l < f.x1) f.x1 = l - 6;
    });
    if (f.x1 - f.x0 < hr.width * 0.45) { f.x0 = 0; f.x1 = hr.width; }
    return f;
  }
  function layoutChrome() {
    if (!dom.wrap) return;
    var f = freeArea(), z = dom.wrap.querySelector('.tx-cad-zoom');
    if (z) z.style.right = Math.max(10, f.cw - f.x1 + 6) + 'px';
  }
  function fit() {
    if (!sheet) return;
    userView = false;
    var f = dom.wrap ? freeArea() : null;
    if (!f || !f.cw || !f.ch) { view = { x: 0, y: 0, w: sheet.W, h: sheet.H }; applyView(); return; }
    var pad = 4, fw = f.x1 - f.x0 - pad * 2, fh = f.y1 - f.y0 - pad * 2, kk = Math.min(fw / sheet.W, fh / sheet.H);
    var ox = f.x0 + pad + (fw - sheet.W * kk) / 2, oy = f.y0 + pad + (fh - sheet.H * kk) / 2;
    view = { x: -ox / kk, y: -oy / kk, w: f.cw / kk, h: f.ch / kk }; applyView(); layoutChrome();
  }
  function zoom(f, cx, cy) {
    if (!view || !sheet) return;
    userView = true;
    var nw = clamp(view.w * f, sheet.W / 14, sheet.W * 2.2), r = nw / view.w, nh = view.h * r;
    if (cx == null) { cx = view.x + view.w / 2; cy = view.y + view.h / 2; }
    view = { x: cx - (cx - view.x) * r, y: cy - (cy - view.y) * r, w: nw, h: nh }; applyView();
  }
  function toSvg(clientX, clientY) {
    var m = dom.svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    var pt = dom.svg.createSVGPoint(); pt.x = clientX; pt.y = clientY; var q = pt.matrixTransform(m.inverse()); return { x: q.x, y: q.y };
  }

  function render() {
    raf = 0;
    if (!dom.svg) return null;
    if (!visible()) { dirty = true; return null; }
    var code = curFloor();
    if (!code) { dom.svg.innerHTML = '<rect width="1400" height="900" fill="' + PAPER + '"/><text x="700" y="450" text-anchor="middle" fill="#64748b" style="font:14px ' + FONT.replace(/"/g, "'") + '">도면 자료(층·실)가 없습니다</text>'; sheet = { W: 1400, H: 900 }; fit(); return null; }
    var t0 = performance.now();
    var res = build(code);
    if (!res) return null;
    var key = code + ':' + res.W + 'x' + res.H;
    dom.svg.innerHTML = res.svg;
    if (fitNext || !sheet || sheet.key !== key) { sheet = { W: res.W, H: res.H, key: key }; fitNext = false; fit(); } else applyView();
    last = res; dirty = false;
    api.lastMs = performance.now() - t0; api.lastBuildMs = res.ms; api.stats = res.stats;
    return res;
  }
  function schedule() {
    if (!dom.host) return;
    if (!visible()) { dirty = true; return; }
    if (!raf) raf = requestAnimationFrame(render);
  }

  function tipHtml(t) {
    var M = TX.model; if (!M) return '';
    var id, h = '';
    function mlist(ms) {
      if (!ms || !ms.length) return '<div class="tx-cad-tip-m tx-cad-tip-none">정기점검 실측 자료 없음</div>';
      return ms.slice().sort(byDateDesc).slice(0, 4).map(function (m) { return '<div class="tx-cad-tip-m' + (m.judge === 'bad' ? ' tx-cad-tip-bad' : '') + '">' + esc(mText(m)) + ' <span>' + esc((m.date ? m.date + ' · ' : '') + mEvid(m)) + '</span></div>'; }).join('') + '<div class="tx-cad-tip-src">출처: 정기점검 실측 (자동 수집 아님) · ≈ 매칭 추정</div>';
    }
    var ea = t.closest('[data-a]'), er = !ea && t.closest('[data-r]');
    if (ea) {
      id = ea.getAttribute('data-a'); var a = TX.asset(id); if (!a) return '';
      var g = C.GRADE[a.grade] || C.GRADE.NONE;
      h = '<b>' + esc(a.name) + '</b><div class="tx-cad-tip-sub">' + esc(a.id) + ' · ' + esc(a.category || a.kind || '') + '</div>' +
        '<div class="tx-cad-tip-sub">' + esc([a.maker, a.model].filter(Boolean).join(' · ')) + '</div>' +
        '<div><span class="tx-cad-tip-g" style="background:' + g.css + '"></span>' + esc(a.status || '') + ' · ' + esc(a.grade || 'NONE') + ' ' + esc(g.name) + '</div>' + mlist(a.measures);
      var im = TX.state.fault && TX.state.fault.active && TX.fault && TX.fault.impact && TX.fault.impact.get && TX.fault.impact.get(a.id);
      if (im) h += '<div class="tx-cad-tip-bad">장애 영향: ' + (im.sev === 'outage' ? '서비스 중단' : '성능 저하') + '</div>';
    } else if (er) {
      id = er.getAttribute('data-r'); var r = TX.room(id); if (!r) return '';
      var cnt = (M.assets || []).filter(function (q) { return q.room === r.id; }).length;
      h = '<b>' + esc(r.name) + '</b><div class="tx-cad-tip-sub">' + esc(r.id) + ' · ' + esc((C.ROOM[r.type] || C.ROOM.office).label) + '</div>' +
        '<div>' + mm(r.w) + ' × ' + mm(r.h) + ' mm · ' + (r.w * r.h / 1e6).toFixed(1) + '㎡ · 설비 ' + cnt + '</div>' + mlist(r.measures);
    }
    return h;
  }

  function bind() {
    var svg = dom.svg, wrap = dom.wrap, pts = new Map(), drag = null, pinch = null;
    svg.addEventListener('wheel', function (e) {
      e.preventDefault(); var p = toSvg(e.clientX, e.clientY);
      var f = Math.pow(1.0018, clamp(e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY, -300, 300)); zoom(f, p.x, p.y);
    }, { passive: false });
    svg.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, vx: view ? view.x : 0, vy: view ? view.y : 0 }; moved = false; }
      if (pts.size === 2) { var a = Array.from(pts.values()); pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; drag = null; moved = true; }
    });
    svg.addEventListener('pointermove', function (e) {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        var a = Array.from(pts.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (d > 0 && pinch.d > 0) { var c = toSvg((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2); zoom(pinch.d / d, c.x, c.y); }
        pinch.d = d; return;
      }
      if (drag && view) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) > 4) { moved = true; wrap.classList.add('tx-cad-panning'); hideTip(); try { svg.setPointerCapture(e.pointerId); } catch (er) { } }
        if (moved) { userView = true; var m = svg.getScreenCTM(); var sc = m ? m.a : 1; view.x = drag.vx - dx / sc; view.y = drag.vy - dy / sc; applyView(); }
        return;
      }
      showTip(e);
    });
    function up(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) { drag = null; wrap.classList.remove('tx-cad-panning'); }
    }
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', function () { hideTip(); });
    svg.addEventListener('click', function (e) {
      if (moved) { moved = false; return; }
      var ea = e.target.closest && e.target.closest('[data-a]');
      if (ea) { TX.select(ea.getAttribute('data-a')); return; }
      var er = e.target.closest && e.target.closest('[data-r]');
      if (er) { var id = er.getAttribute('data-r'); TX.setState({ room: TX.state.room === id ? null : id }); }
    });
    svg.addEventListener('dblclick', function (e) { e.preventDefault(); fit(); });
    wrap.querySelector('.tx-cad-zoom').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var z = b.getAttribute('data-z'); if (z === 'in') zoom(1 / 1.3); else if (z === 'out') zoom(1.3); else fit();
    });
  }
  function showTip(e) {
    var h = e.target && e.target.closest ? tipHtml(e.target) : '';
    if (!h) { hideTip(); return; }
    var t = dom.tip, r = dom.wrap.getBoundingClientRect();
    t.innerHTML = h; t.style.display = 'block';
    var x = e.clientX - r.left + 14, y = e.clientY - r.top + 14, w = t.offsetWidth, hh = t.offsetHeight;
    if (x + w > r.width - 6) x = e.clientX - r.left - w - 12;
    if (y + hh > r.height - 6) y = e.clientY - r.top - hh - 12;
    t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { if (dom.tip) dom.tip.style.display = 'none'; }

  function mount(host) {
    if (!host) return;
    if (dom.host === host && dom.wrap && host.contains(dom.wrap)) { schedule(); return; }
    if (dom.wrap && dom.wrap.parentNode) dom.wrap.parentNode.removeChild(dom.wrap);
    dom.host = host;
    var w = U.el('div', 'tx-cad-wrap');
    w.innerHTML = '<svg class="tx-cad-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" viewBox="0 0 1400 900"></svg>' +
      '<div class="tx-cad-zoom" role="group" aria-label="도면 확대/축소"><button type="button" data-z="in" title="확대">+</button><button type="button" data-z="out" title="축소">−</button><button type="button" data-z="fit" title="도면 맞춤 (더블클릭)">⤢</button></div>' +
      '<div class="tx-cad-tip" role="tooltip"></div>';
    host.appendChild(w);
    dom.wrap = w; dom.svg = w.querySelector('svg'); dom.tip = w.querySelector('.tx-cad-tip');
    bind(); fitNext = true; dirty = true; schedule();
  }

  /* ---------- 내보내기 (현재 줌 무관 전체 시트) ---------- */
  function svgText(code) {
    code = code || curFloor(); if (!code) return '';
    var res = build(code, true); if (!res) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + res.W + '" height="' + res.H + '" viewBox="0 0 ' + res.W + ' ' + res.H + '">' + res.svg + '</svg>';
  }
  function fileBase(code) { return dwgNo(code || curFloor() || 'X') + '_정보통신설비평면도'; }
  function exportSvg() {
    var t = svgText(); if (!t) return false;
    U.download(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + t], { type: 'image/svg+xml;charset=utf-8' }), fileBase() + '.svg'); return true;
  }
  function pngBlob(scale) {
    var code = curFloor(), res = code && build(code, true);
    if (!res) return Promise.reject(new Error('no drawing'));
    scale = scale || 2;
    var text = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + res.W + '" height="' + res.H + '" viewBox="0 0 ' + res.W + ' ' + res.H + '">' + res.svg + '</svg>';
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = res.W * scale; c.height = res.H * scale;
        var g = c.getContext('2d'); g.fillStyle = PAPER; g.fillRect(0, 0, c.width, c.height); g.scale(scale, scale); g.drawImage(img, 0, 0);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/png');
      };
      img.onerror = function () { reject(new Error('svg image load failed')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
    });
  }
  function exportPng() {
    return pngBlob(2).then(function (b) { U.download(b, fileBase() + '.png'); return true; })
      .catch(function (e) { console.warn('[cad2d] PNG 내보내기 실패', e); TX.emit('toast', { msg: 'PNG 내보내기 실패', kind: 'error' }); return false; });
  }

  /* ---------- 개발 모드: 셸(T2) 없이 단독 시험 ---------- */
  function dev() {
    if (!TX.model) TX.setModel(TX.demoModel());
    var box = document.querySelector('.tx-cad-dev');
    if (!box) {
      box = U.el('div', 'tx-cad-dev');
      var bar = U.el('div', 'tx-cad-devbar');
      (TX.model.floors || []).forEach(function (f) {
        var b = U.el('button', '', esc(f.code)); b.type = 'button'; b.onclick = function () { TX.setState({ floor: f.code }); }; bar.appendChild(b);
      });
      var x = U.el('button', '', '닫기'); x.type = 'button'; x.onclick = function () { box.remove(); dom.host = null; dom.wrap = null; dom.svg = null; }; bar.appendChild(x);
      var host = U.el('div', 'tx-cad-devhost');
      box.appendChild(bar); box.appendChild(host); document.body.appendChild(box);
      mount(host);
    }
    return box;
  }

  var api = {
    render: function () { if (raf) { cancelAnimationFrame(raf); raf = 0; } return render(); },
    fit: fit,
    zoom: function (f) { zoom(f || 1); },
    exportSvg: exportSvg,
    exportPng: exportPng,
    pngBlob: pngBlob,
    /* 화면 좌표(clientX/Y) → 현재 층 평면 mm (배경 2점 맞춤용) */
    screenToMm: function (cx, cy) {
      if (!mapInfo || !dom.svg || !dom.svg.getScreenCTM()) return null;
      var pt = dom.svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      var p = pt.matrixTransform(dom.svg.getScreenCTM().inverse());
      return { x: (p.x - mapInfo.px0) / mapInfo.s + mapInfo.x0, y: (p.y - mapInfo.py0) / mapInfo.s + mapInfo.y0, floor: mapInfo.floor };
    },
    mmToScreen: function (x, y) {
      if (!mapInfo || !dom.svg || !dom.svg.getScreenCTM()) return null;
      var pt = dom.svg.createSVGPoint(); pt.x = mapInfo.px0 + (x - mapInfo.x0) * mapInfo.s; pt.y = mapInfo.py0 + (y - mapInfo.y0) * mapInfo.s;
      var p = pt.matrixTransform(dom.svg.getScreenCTM()); return { x: p.x, y: p.y };
    },
    svgText: svgText,
    build: build,
    mount: mount,
    dev: dev,
    view: function () { return view && { x: view.x, y: view.y, w: view.w, h: view.h }; },
    lastMs: 0, lastBuildMs: 0, stats: null
  };
  TX.cad2d = api;

  /* ---------- 이벤트 결합 ---------- */
  var WATCH = ['floor', 'selected', 'room', 'layers', 'fault', 'labels', 'view', 'open', 'panel'];
  TX.on('ui-ready', function (ui) { ui = ui || TX.ui; if (ui && ui.view2d) mount(ui.view2d); });
  TX.on('model', function () { fitNext = true; schedule(); });
  TX.on('underlay', function () { schedule(); });
  TX.on('state', function (p) {
    var ch = (p && p.changed) || [];
    if (ch.indexOf('floor') >= 0) fitNext = true;
    if (ch.some(function (c) { return WATCH.indexOf(c) >= 0; })) schedule();
    if (ch.indexOf('panel') >= 0 || ch.indexOf('selected') >= 0) setTimeout(function () { if (!visible()) return; if (!userView) fit(); else layoutChrome(); }, 260); // 패널 전환 애니메이션 후
  });
  TX.on('select', schedule);
  TX.on('fault', schedule);
  TX.on('resize', function () { if (dirty) schedule(); else if (visible()) { if (!userView) fit(); else layoutChrome(); } });
  if (TX.ui && TX.ui.view2d) mount(TX.ui.view2d);
})();
