/* ============================================================
   TwinX 73-report — 점검 결과 대시보드 (성능점검 결과 보고 화면)
   · 툴바 「점검결과」: 종합 대시보드 / 측정목록 / 현장 증빙 3개 화면
   · 데이터: 트윈에 들어온 점검 측정 전부(점검 결과서 Word·PDF·엑셀 변환, ADMIN 측정, 이력)
     — 하드코딩 없이 현재 모델에서 매번 집계. 측정 행 → 설비·실·층과 연결되어 「2D/3D에서 보기」 가능
   · 발주처 보고(깔끔한 보고 화면) / 엔지니어 관리(조치 상태·메모) 모드, 화이트/다크 테마, CSV·인쇄
   · 외부 라이브러리 없이 SVG 차트
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.report2) return;
  var U = TX.util, esc = U.esc;
  var ACT_KEY = 'twinx_action_v1', PREF_KEY = 'twinx_rp_pref_v1';
  var STDN = { gnd: '접지', heat: '발열', pwr: '전원', sig: '신호', env: '환경' };
  var STD_ORDER = ['접지', '발열', '전원', '신호', '환경', '기타'];
  var PAL = ['#2f66f5', '#4db8ff', '#f5a3bd', '#b38cf0', '#10b981', '#f59e0b', '#64748b'];
  var ACT_STEPS = ['접수', '조치 계획', '조치 중', '조치 완료', '재측정 확인'];
  var OPS_KEY = 'ict_twin_v14_ops', OPS_SEED = [{ d: '2026-10-14', l4a: 1280, l4b: 1282, disk: 84, by: '정기점검 보고서' }];
  /* 화면 인스턴스: 트윈 오버레이(기본) / ADMIN 측정 대시보드 내장(inline, source='inspection') */
  function createInst(OPTS) {
  OPTS = OPTS || {};
  var el = null, view = 1, D = null, pref = Object.assign(loadPref(), OPTS.pref || {}), st = { tab: 0, bldg: 'ALL', q: '', fb: 'ALL', ff: 'ALL', fs: 'ALL', fv: 'ALL', defOnly: false, page: 1, cal: null, sel: null }, urls = [];

  function loadPref() { try { return Object.assign({ theme: 'light', mode: 'client' }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { return { theme: 'light', mode: 'client' }; } }
  function savePref() { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (e) { } }
  function acts() { try { return JSON.parse(localStorage.getItem(ACT_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function setAct(id, o) { var a = acts(); a[id] = Object.assign(a[id] || {}, o, { at: new Date().toISOString() }); try { localStorage.setItem(ACT_KEY, JSON.stringify(a)); } catch (e) { } }
  function pd(s) { var m = String(s || '').match(/(\d{4})[-./년\s]+(\d{1,2})(?:[-./월\s]+(\d{1,2}))?/); return m ? new Date(+m[1], +m[2] - 1, +(m[3] || 1)) : null; }
  function ymd(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d ? d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) : ''; }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : null; }
  function f1(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1); }
  function toast(msg) { if (!el) return; var t = U.el('div', 'tx-rp-toast', esc(msg)); el.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }

  /* ---------------- 집계 ---------------- */
  function collect() {
    var M = TX.model || { floors: [], rooms: [], assets: [], measurements: [] };
    var fBy = {}; M.floors.forEach(function (f) { fBy[f.code] = f; });
    var seen = new Set(), list = [];
    var add = function (m, a, r) { if (!m || seen.has(m)) return; seen.add(m); list.push({ m: m, a: a || (m.assetId && TX.asset(m.assetId)) || null, r: r || (m.roomId && TX.room(m.roomId)) || null }); };
    (M.measurements || []).forEach(function (m) { add(m); });
    M.assets.forEach(function (a) { (a.measures || []).forEach(function (m) { add(m, a); }); });
    M.rooms.forEach(function (r) { (r.measures || []).forEach(function (m) { add(m, null, r); }); });
    if (OPTS.source) list = list.filter(function (x) { return x.m.source === OPTS.source; }); /* ADMIN 측정 시트 행만 (ADMIN 화면과 건수 일치) */
    var ev = TX.analysis && TX.analysis.evaluate ? TX.analysis.evaluate(list.map(function (x) { return x.m; })) : [];
    var evBy = new Map(); ev.forEach(function (e) { evBy.set(e.m, e); });
    var A = acts(), meta = (OPTS.meta && OPTS.meta()) || {}, site = meta.site || (M.site && M.site.name) || '사업장';
    var rows = list.map(function (x, i) {
      var m = x.m, a = x.a, r = x.r || (a && TX.room(a.room)) || null, e = evBy.get(m) || {};
      var fc = (a && a.floor) || (r && r.floor) || null, f = fc && fBy[fc];
      var raw = m.raw || {}, v = m.value;
      var vs = v == null || v === '' ? '—' : (typeof v === 'number' ? (Math.round(v * 100) / 100) : v) + (m.unit && typeof v === 'number' ? ' ' + m.unit : '');
      var crit = m.criterion || (e.limit && e.limit.text) || m.crit || raw.기준 || '';
      var j = m.judge === 'bad' ? 'bad' : m.judge === 'na' ? 'na' : m.judge === 'good' ? 'good' : 'none';
      var id = m.id || ('M' + (i + 1));
      return {
        num: typeof e.value === 'number' && isFinite(e.value) ? e.value : (typeof m.value === 'number' ? m.value : null), lim: e.limit || null, iUnit: e.unit || m.unit || '', iName: e.item || m.item || '',
        id: id, key: (a ? a.id : r ? r.id : '-') + '|' + id, m: m, a: a, r: r, judge: j, warn: !!m.warn || (!!e.near && j !== 'bad'),
        std: STDN[m.std] || '기타', item: m.item || '측정', value: vs, crit: String(crit || ''), date: pd(m.date || meta.date), dateS: m.date || meta.date || '',
        bldg: m.building || raw.건물 || (f && f.building) || '미지정', floor: m.floorText || raw.층 || (f && f.name) || '', floorCode: fc, /* 원본 행의 건물·층·설비를 우선 (ADMIN 화면과 같은 묶음) */
        loc: m.location || raw['점검 위치'] || (r && r.name) || '', equip: m.equip || raw.설비 || (a && (a.category || a.name)) || (r ? '실 환경' : '설비 미매칭'), eqName: a ? a.name : (m.equip || ''),
        note: raw.비고 || raw['현장 소견'] || raw.소견 || raw.내용 || '', src: m.source || '', act: A[(a ? a.id : r ? r.id : '-') + '|' + id] || null
      };
    });
    rows.sort(function (x, y) { var o = { bad: 0, na: 2, good: 1, none: 1 }; return (o[x.judge] - o[y.judge]) || ((y.date || 0) - (x.date || 0)) || x.bldg.localeCompare(y.bldg); });
    var bad = rows.filter(function (r) { return r.judge === 'bad'; }), good = rows.filter(function (r) { return r.judge === 'good'; }), na = rows.filter(function (r) { return r.judge === 'na'; });
    var eff = good.length + bad.length;
    var grp = function (key) { var o = {}; rows.forEach(function (r) { var k = r[key]; var g = o[k] = o[k] || { k: k, n: 0, good: 0, bad: 0, na: 0, warn: 0 }; g.n++; g[r.judge === 'none' ? 'good' : r.judge]++; if (r.warn) g.warn++; }); return Object.keys(o).map(function (k) { var g = o[k]; g.rate = pct(g.good, g.good + g.bad); return g; }); };
    var byEq = grp('equip').sort(function (a, b) { return b.n - a.n; });
    var byStd = grp('std').sort(function (a, b) { return STD_ORDER.indexOf(a.k) - STD_ORDER.indexOf(b.k); });
    var byB = grp('bldg').sort(function (a, b) { return b.n - a.n; });
    var dates = {}; rows.forEach(function (r) { if (!r.date) return; var k = ymd(r.date); var o = dates[k] = dates[k] || { k: k, d: r.date, n: 0, bad: 0, na: 0 }; o.n++; if (r.judge === 'bad') o.bad++; else if (r.judge === 'na') o.na++; });
    var dlist = Object.keys(dates).sort().map(function (k) { return dates[k]; });
    var assets = M.assets.filter(function (a) { return (a.measures || []).length; });
    var assetOk = assets.filter(function (a) { return !(a.measures || []).some(function (m) { return m.judge === 'bad'; }); }).length;
    var linked = rows.filter(function (r) { return r.a || r.r; }).length;
    var badAssets = {}; bad.forEach(function (r) { var k = r.a ? r.a.id : r.equip; var o = badAssets[k] = badAssets[k] || { k: k, a: r.a, name: r.a ? r.a.name : r.equip, n: 0, rows: [] }; o.n++; o.rows.push(r); });
    var badEq = byEq.filter(function (g) { return g.bad; }).sort(function (a, b) { return (a.rate == null ? 101 : a.rate) - (b.rate == null ? 101 : b.rate); });
    var done = bad.filter(function (r) { return r.act && r.act.step >= 3; }).length;
    var items = groupItems(rows);
    return { items: items, M: M, site: site, rows: rows, bad: bad, good: good, na: na, eff: eff, rate: pct(good.length, eff), byEq: byEq, byStd: byStd, byB: byB, dates: dlist,
      first: dlist[0] && dlist[0].d, last: dlist.length ? dlist[dlist.length - 1].d : null, assets: assets.length, assetOk: assetOk, linked: linked,
      badAssets: Object.keys(badAssets).map(function (k) { return badAssets[k]; }).sort(function (a, b) { return b.n - a.n; }), badEq: badEq, done: done };
  }

  /* ---------------- SVG 차트 ---------------- */
  function lineChart(labels, series, opt) {
    opt = opt || {}; var W = opt.W || 900, H = opt.H || 250, L = 46, R = 16, T = 14, B = 34, n = labels.length; if (!n) return empty();
    var lo = opt.lo != null ? opt.lo : 0, hi = opt.hi != null ? opt.hi : Math.max.apply(null, [1].concat(series.reduce(function (a, s) { return a.concat(s.v.filter(function (x) { return x != null; })); }, []))) * 1.1;
    var X = function (i) { return L + (n === 1 ? (W - L - R) / 2 : (W - L - R) * i / (n - 1)); }, Y = function (v) { return T + (H - T - B) * (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1)); };
    var o = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="tx-rp-svg">'], every = Math.max(1, Math.ceil(n / 10)), maxc = n > 8 ? 5 : 8;
    for (var t = 0; t <= 4; t++) { var v = lo + (hi - lo) * t / 4, y = Y(v); o.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="tx-rp-grid"/><text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" class="tx-rp-ax">' + (opt.fmt ? opt.fmt(v) : Math.round(v)) + '</text>'); }
    series.forEach(function (s, si) {
      var pts = s.v.map(function (v, i) { return v == null ? null : [X(i), Y(v)]; }).filter(Boolean); if (!pts.length) return;
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
      if (s.area) o.push('<path d="' + d + 'L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - B) + 'L' + pts[0][0].toFixed(1) + ' ' + (H - B) + 'Z" fill="' + s.c + '" fill-opacity="' + (si ? 0.10 : 0.16) + '"/>');
      o.push('<path d="' + d + '" fill="none" stroke="' + s.c + '" stroke-width="3" stroke-linejoin="round"/>');
      s.v.forEach(function (v, i) { if (v == null) return; o.push('<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="5.5" fill="var(--rp-card)" stroke="' + s.c + '" stroke-width="2.5"><title>' + esc(labels[i] + ' · ' + s.name + ' ' + (opt.fmt ? opt.fmt(v) : v)) + '</title></circle>'); });
    });
    labels.forEach(function (l, i) { if (i % every) return; var t = String(l).replace(/\s*(설비|시스템)$/, ''); o.push('<text x="' + X(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" class="tx-rp-ax tx-rp-axl">' + esc(t.length > maxc ? t.slice(0, maxc) + '…' : t) + '<title>' + esc(l) + '</title></text>'); });
    return o.join('') + '</svg>';
  }
  function barChart(items, opt) { // items [{label, a(total), b(bad), id}]
    opt = opt || {}; if (!items.length) return empty();
    var W = 520, H = 220, B = 26, T = 10, mx = Math.max.apply(null, items.map(function (i) { return i.a; }).concat([1])), gw = (W - 20) / items.length, bw = Math.min(26, gw * 0.62);
    var o = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="tx-rp-svg" preserveAspectRatio="none">'];
    items.forEach(function (it, i) {
      var x = 10 + gw * i + (gw - bw) / 2, h = (H - B - T) * it.a / mx, hb = (H - B - T) * (it.b || 0) / mx, y0 = H - B;
      o.push('<g class="tx-rp-bar" data-rp-eq="' + esc(it.label) + '"><rect x="' + x + '" y="' + T + '" width="' + bw + '" height="' + (H - B - T) + '" rx="3" class="tx-rp-track"/>' +
        '<rect x="' + x + '" y="' + (y0 - h) + '" width="' + bw + '" height="' + Math.max(1.5, h) + '" rx="3" fill="' + (opt.c || 'var(--rp-cobalt)') + '"/>' +
        (it.b ? '<rect x="' + x + '" y="' + (y0 - h) + '" width="' + bw + '" height="' + Math.max(3, hb) + '" rx="3" fill="var(--rp-crimson)"/>' : '') +
        '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="tx-rp-ax' + (it.b ? ' tx-rp-axbad' : '') + '">' + (i + 1) + '</text>' +
        '<title>' + esc((i + 1) + '. ' + it.label + ' · 측정 ' + it.a + (it.b ? ' · 불량 ' + it.b : '')) + '</title></g>');
    });
    return o.join('') + '</svg>';
  }
  function donutChart(parts, center, sub) {
    var tot = parts.reduce(function (s, p) { return s + p.v; }, 0), r = 62, c = 2 * Math.PI * r, acc = 0, o = ['<svg viewBox="0 0 180 180" class="tx-rp-donut"><circle cx="90" cy="90" r="' + r + '" fill="none" class="tx-rp-trackc" stroke-width="16"/>'];
    parts.forEach(function (p) { if (!p.v) return; var len = c * p.v / (tot || 1); o.push('<circle cx="90" cy="90" r="' + r + '" fill="none" stroke="' + p.c + '" stroke-width="16" stroke-dasharray="' + Math.max(0, len - 2).toFixed(1) + ' ' + c.toFixed(1) + '" stroke-dashoffset="' + (-acc).toFixed(1) + '" transform="rotate(-90 90 90)"><title>' + esc(p.k + ' ' + p.v + '건') + '</title></circle>'); acc += len; });
    return o.join('') + '<text x="90" y="88" text-anchor="middle" class="tx-rp-dn">' + esc(center) + '</text><text x="90" y="108" text-anchor="middle" class="tx-rp-ds">' + esc(sub || '') + '</text></svg>';
  }
  function rings(items, center) {
    var o = ['<svg viewBox="0 0 200 200" class="tx-rp-donut">'];
    items.slice(0, 6).forEach(function (it, i) { var r = 90 - i * 10, c = 2 * Math.PI * r, p = it.rate == null ? 0 : it.rate; o.push('<circle cx="100" cy="100" r="' + r + '" fill="none" class="tx-rp-trackc" stroke-width="7"/><circle cx="100" cy="100" r="' + r + '" fill="none" stroke="' + PAL[i % PAL.length] + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (c * p / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 100 100)"><title>' + esc(it.k + ' ' + (it.rate == null ? '—' : it.rate + '%') + ' (' + it.n + '건)') + '</title></circle>'); });
    return o.join('') + '<text x="100" y="104" text-anchor="middle" class="tx-rp-dn tx-rp-dn2">' + esc(center) + '</text><text x="100" y="120" text-anchor="middle" class="tx-rp-ds">전체 적합률</text></svg>';
  }
  function radar(axes, series) {
    var n = axes.length; if (n < 3) return empty('기준이 3종 이상일 때 표시');
    var cx = 120, cy = 112, R = 78, P = function (i, v) { var t = -Math.PI / 2 + 2 * Math.PI * i / n; return [cx + Math.cos(t) * R * v, cy + Math.sin(t) * R * v]; }, o = ['<svg viewBox="0 0 240 230" class="tx-rp-donut">'];
    [0.25, 0.5, 0.75, 1].forEach(function (k) { o.push('<polygon points="' + axes.map(function (a, i) { return P(i, k).join(','); }).join(' ') + '" fill="none" class="tx-rp-grid"/>'); });
    axes.forEach(function (a, i) { var p = P(i, 1.18); o.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + P(i, 1)[0] + '" y2="' + P(i, 1)[1] + '" class="tx-rp-grid"/><text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 3).toFixed(1) + '" text-anchor="middle" class="tx-rp-ax">' + esc(a) + '</text>'); });
    series.forEach(function (s, si) { o.push('<polygon points="' + s.v.map(function (v, i) { return P(i, v == null ? 0 : v / 100).map(function (q) { return q.toFixed(1); }).join(','); }).join(' ') + '" fill="' + PAL[si % PAL.length] + '" fill-opacity="0.18" stroke="' + PAL[si % PAL.length] + '" stroke-width="2"><title>' + esc(s.name) + '</title></polygon>'); });
    return o.join('') + '</svg>';
  }
  function miniDonut(p, c) { var r = 15, cc = 2 * Math.PI * r; return '<svg viewBox="0 0 40 40" class="tx-rp-mdn"><circle cx="20" cy="20" r="' + r + '" fill="none" class="tx-rp-trackc" stroke-width="5"/><circle cx="20" cy="20" r="' + r + '" fill="none" stroke="' + c + '" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + (cc * (p || 0) / 100).toFixed(1) + ' ' + cc.toFixed(1) + '" transform="rotate(-90 20 20)"/><text x="20" y="23" text-anchor="middle">' + (p == null ? '—' : f1(p)) + '</text></svg>'; }
  function empty(t) { return '<p class="tx-rp-empty">' + esc(t || '자료 없음') + '</p>'; }
  function chip(j, warn) { return j === 'bad' ? '<span class="tx-rp-chip is-bad">불량</span>' : j === 'na' ? '<span class="tx-rp-chip is-na">제외</span>' : warn ? '<span class="tx-rp-chip is-warn">관찰</span>' : j === 'good' ? '<span class="tx-rp-chip is-ok">양호</span>' : '<span class="tx-rp-chip is-na">미판정</span>'; }

  /* ---------------- 화면 ---------------- */
  function card(cls, title, sub, right, body) { return '<section class="tx-rp-card ' + (cls || '') + '"><div class="tx-rp-ch"><div><h4>' + title + '</h4>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>' + (right || '') + '</div>' + body + '</section>'; }
  function header() {
    var d = D, per = d.first ? ymd(d.first) + (d.last && ymd(d.last) !== ymd(d.first) ? ' ~ ' + ymd(d.last) : '') : '점검일 미기재';
    return '<div class="tx-rp-hd"><div class="tx-rp-brand"><i>ICT</i><div><b>' + esc(d.site) + ' 정보통신설비 성능점검 결과</b><small>점검일 ' + esc(per) + ' · 측정 ' + d.rows.length + '건 (유효 ' + d.eff + '건) · ' + (OPTS.inline ? 'ADMIN 측정 자료 · 트윈 연동' : '디지털 트윈 연동') + '</small></div></div>' +
      '<nav class="tx-rp-tabs">' + [[1, '📊 통합'], [4, '🗂 항목별'], [2, '측정목록 (' + d.rows.length + ')'], [3, '현장 증빙 · 조치']].map(function (t) { return '<button type="button" data-rp="view" data-k="' + t[0] + '" class="' + (view === t[0] ? 'is-on' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav>' +
      '<div class="tx-rp-tools"><div class="tx-rp-seg"><button type="button" data-rp="mode" data-k="client" class="' + (pref.mode === 'client' ? 'is-on' : '') + '">발주처 보고</button><button type="button" data-rp="mode" data-k="engineer" class="' + (pref.mode === 'engineer' ? 'is-on' : '') + '">엔지니어 관리</button></div>' +
      '<div class="tx-rp-seg"><button type="button" data-rp="theme" data-k="light" class="' + (pref.theme === 'light' ? 'is-on' : '') + '">화이트</button><button type="button" data-rp="theme" data-k="dark" class="' + (pref.theme === 'dark' ? 'is-on' : '') + '">다크</button></div>' +
      '<button type="button" class="tx-rp-btn" data-rp="csv" data-k="all">CSV 내보내기</button><button type="button" class="tx-rp-btn tx-rp-pri" data-rp="print">인쇄</button>' + (OPTS.inline ? '' : '<button type="button" class="tx-rp-x" data-rp="close" aria-label="닫기" title="트윈으로 돌아가기">✕</button>') + '</div></div>';
  }
  /* ADMIN 제목 줄에 들어가는 한 줄 도구 막대 (내장 모드) */
  function barHtml() {
    var d = D;
    return [[1, '통합'], [4, '항목별'], [2, '측정목록 ' + d.rows.length], [3, '증빙·조치']].map(function (t) { return '<button type="button" data-rp="view" data-k="' + t[0] + '" class="tx-rp-bt' + (view === t[0] ? ' is-on' : '') + '">' + t[1] + '</button>'; }).join('') +
      '<span class="tx-rp-bsep"></span><button type="button" data-rp="mode" data-k="' + (pref.mode === 'engineer' ? 'client' : 'engineer') + '" class="tx-rp-bt' + (pref.mode === 'engineer' ? ' is-on' : '') + '" title="발주처 보고 ↔ 엔지니어 관리(조치 단계·운영 지표 입력)"><span class="l-full">' + (pref.mode === 'engineer' ? '엔지니어 관리' : '발주처 보고') + '</span><span class="l-short">' + (pref.mode === 'engineer' ? '관리' : '보고') + '</span></button>' +
      '<button type="button" data-rp="theme" data-k="' + (pref.theme === 'dark' ? 'light' : 'dark') + '" class="tx-rp-bt" title="화이트/다크 전환">' + (pref.theme === 'dark' ? '☀' : '☾') + '</button>' +
      '<button type="button" data-rp="csv" data-k="all" class="tx-rp-bt tx-rp-hc" title="측정목록 CSV">CSV</button><button type="button" data-rp="print" class="tx-rp-bt tx-rp-bpri">인쇄</button>';
  }
  function emptyView() {
    return '<div class="tx-rp-body"><section class="tx-rp-card tx-rp-none"><h4>아직 점검 측정 자료가 없습니다</h4><p>점검 결과서(Word·PDF·엑셀)를 등록하면 이 화면이 자동으로 채워집니다. 측정 행은 설비·실에 연결되어 2D·3D 트윈에서도 색으로 표시됩니다.</p>' +
      (TX.pipe && TX.pipe.report ? '<button type="button" class="tx-rp-btn tx-rp-pri" data-rp="import">점검 결과서 등록하기</button>' : '') + '</section></div>';
  }
  /* 종합 대시보드 */
  function view1() {
    var d = D, o = [];
    // ① 캘린더
    var base = st.cal || d.last || new Date(), y = base.getFullYear(), mo = base.getMonth(), first = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate();
    var dm = {}; d.dates.forEach(function (x) { if (x.d.getFullYear() === y && x.d.getMonth() === mo) dm[x.d.getDate()] = x; });
    var cal = '<div class="tx-rp-cal"><div class="tx-rp-calhd"><button type="button" data-rp="cal" data-k="-1">‹</button><b>' + y + '년 ' + (mo + 1) + '월</b><button type="button" data-rp="cal" data-k="1">›</button></div><div class="tx-rp-calg">' +
      ['일', '월', '화', '수', '목', '금', '토'].map(function (w) { return '<i>' + w + '</i>'; }).join('') + new Array(first + 1).join('<span></span>');
    for (var day = 1; day <= days; day++) { var x = dm[day]; cal += '<span class="' + (x ? (x.bad ? 'is-bad' : 'is-on') : '') + '"' + (x ? ' title="' + esc(x.k + ' · 측정 ' + x.n + '건' + (x.bad ? ' · 불량 ' + x.bad : '')) + '"' : '') + '>' + day + '</span>'; }
    cal += '</div></div>';
    var evs = d.dates.slice(-3).reverse().map(function (x) { var wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][x.d.getDay()]; return '<div class="tx-rp-ev' + (x.bad ? ' is-bad' : '') + '"><div class="tx-rp-evd"><small>' + wd + '</small><b>' + x.d.getDate() + '</b></div><div><b>' + esc(x.k) + ' 점검 ' + x.n + '건</b><small>양호 ' + (x.n - x.bad - (x.na || 0)) + ' · 불량 ' + x.bad + (x.na ? ' · 제외 ' + x.na : '') + '</small></div></div>'; }).join('') || empty('점검일이 기재된 측정이 없습니다');
    var steps = [['측정 등록', d.rows.length > 0], ['설비 매칭', d.linked === d.rows.length && d.rows.length > 0], ['불량 식별', true], ['조치', d.bad.length === 0 || d.done === d.bad.length], ['재측정', d.bad.length === 0 || d.bad.every(function (r) { return r.act && r.act.step >= 4; })]];
    var tl = '<div class="tx-rp-tl">' + steps.map(function (s, i) { return '<div class="' + (s[1] ? 'is-done' : '') + '"><i>' + (s[1] ? '✔' : i + 1) + '</i><span>' + s[0] + '</span></div>'; }).join('') + '</div>' +
      '<div class="tx-rp-note"><b>' + (d.bad.length ? '불량 ' + d.bad.length + '건 식별' : '불량 없음') + '</b> · 설비 연결 ' + d.linked + '/' + d.rows.length + '건 · 조치 완료 ' + d.done + '/' + d.bad.length + '</div>';
    o.push(card('tx-rp-c5', '점검 캘린더 · 추진 현황', '점검일별 측정 · 진행 단계', '', '<div class="tx-rp-calwrap">' + cal + '<div class="tx-rp-evs">' + evs + '</div></div>' + tl));
    // ② KPI 탭 + 메인 차트
    var gnd = d.byStd.find(function (g) { return g.k === '접지'; }) || d.byStd[0];
    var K = [['전체 적합률', d.rate == null ? '—' : f1(d.rate) + '%', '양호 ' + d.good.length + ' / 유효 ' + d.eff, d.na.length ? '제외 ' + d.na.length : ''],
      ['총 측정 건수', d.rows.length + '건', d.byB.length + '개 건물 · ' + d.byEq.length + '개 설비 구분', ''],
      ['불량 항목', d.bad.length + '건', '조치 완료 ' + d.done + '건', d.bad.length ? '조치 필요' : '', 'bad'],
      [(gnd ? gnd.k : '기준') + ' 기준', gnd && gnd.rate != null ? f1(gnd.rate) + '%' : '—', gnd ? '측정 ' + gnd.n + ' · 불량 ' + gnd.bad : '', ''],
      ['설비 정상률', d.assets ? f1(pct(d.assetOk, d.assets)) + '%' : '—', '측정 설비 ' + d.assets + '대 중 ' + d.assetOk + '대', '']];
    var kt = '<div class="tx-rp-kpis">' + K.map(function (k, i) { return '<button type="button" data-rp="tab" data-k="' + i + '" class="tx-rp-kpi' + (st.tab === i ? ' is-on' : '') + '"><span>' + k[0] + (k[3] ? '<em class="' + (k[4] ? 'is-bad' : '') + '">' + k[3] + '</em>' : '') + '</span><small>' + esc(k[2]) + '</small><b class="' + (k[4] && d.bad.length ? 'is-bad' : '') + '">' + k[1] + '</b></button>'; }).join('') + '</div>';
    var ch, lg;
    if (st.tab === 0 || st.tab === 4) { var eqs = d.byEq.slice(0, 14); ch = lineChart(eqs.map(function (g) { return g.k; }), [{ name: '설비별 적합률', v: eqs.map(function (g) { return g.rate; }), c: 'var(--rp-cobalt)', area: true }, { name: '관찰 제외 비율', v: eqs.map(function (g) { return pct(g.n - g.warn - g.bad, g.n); }), c: 'var(--rp-emerald)', area: true }], { lo: 0, hi: 100, fmt: function (v) { return Math.round(v) + '%'; } }); lg = ['설비별 적합률 (%)', 'var(--rp-cobalt)', '관찰·불량 없는 비율 (%)', 'var(--rp-emerald)']; }
    else if (st.tab === 1) { ch = lineChart(d.dates.map(function (x) { return x.k.slice(2); }), [{ name: '측정', v: d.dates.map(function (x) { return x.n; }), c: 'var(--rp-cobalt)', area: true }, { name: '불량', v: d.dates.map(function (x) { return x.bad; }), c: 'var(--rp-crimson)' }]); lg = ['점검일별 측정 건수', 'var(--rp-cobalt)', '불량', 'var(--rp-crimson)']; }
    else if (st.tab === 2) { var be = d.byEq.filter(function (g) { return g.bad; }); ch = be.length ? lineChart(be.map(function (g) { return g.k; }), [{ name: '불량', v: be.map(function (g) { return g.bad; }), c: 'var(--rp-crimson)', area: true }]) : empty('불량 항목이 없습니다'); lg = ['설비 구분별 불량 건수', 'var(--rp-crimson)']; }
    else { ch = lineChart(d.byStd.map(function (g) { return g.k; }), [{ name: '기준 적합률', v: d.byStd.map(function (g) { return g.rate; }), c: 'var(--rp-lav)', area: true }], { lo: 0, hi: 100, fmt: function (v) { return Math.round(v) + '%'; } }); lg = ['기술기준별 적합률 (%)', 'var(--rp-lav)']; }
    var leg = ''; for (var li = 0; li < lg.length; li += 2) leg += '<span><i style="background:' + lg[li + 1] + '"></i>' + lg[li] + '</span>';
    o.push('<section class="tx-rp-card tx-rp-c7 tx-rp-main">' + kt + '<div class="tx-rp-chart">' + ch + '</div><div class="tx-rp-cf"><div class="tx-rp-leg">' + leg + '</div><button type="button" class="tx-rp-btn" data-rp="view" data-k="2">상세 분석 (' + d.rows.length + '건)</button></div></section>');
    // ③ 설비별 측정 물량
    var bs = ['ALL'].concat(d.byB.map(function (b) { return b.k; }));
    var eqRows = st.bldg === 'ALL' ? d.byEq : (function () { var o2 = {}; d.rows.filter(function (r) { return r.bldg === st.bldg; }).forEach(function (r) { var g = o2[r.equip] = o2[r.equip] || { k: r.equip, n: 0, bad: 0 }; g.n++; if (r.judge === 'bad') g.bad++; }); return Object.keys(o2).map(function (k) { return o2[k]; }).sort(function (a, b) { return b.n - a.n; }); })();
    var eqs2 = eqRows.slice(0, 14);
    o.push(card('tx-rp-c3', '설비별 측정 물량 (' + d.byEq.length + '종)', '크림슨 캡: 불량 포함 ' + d.badEq.length + '개 설비', '<select data-rp="bldg" class="tx-rp-sel">' + bs.map(function (b) { return '<option value="' + esc(b) + '"' + (b === st.bldg ? ' selected' : '') + '>' + (b === 'ALL' ? '전체 (' + d.rows.length + ')' : esc(b)) + '</option>'; }).join('') + '</select>',
      '<div class="tx-rp-chart tx-rp-short">' + barChart(eqs2.map(function (g) { return { label: g.k, a: g.n, b: g.bad }; })) + '</div><ol class="tx-rp-eqleg">' + eqs2.map(function (g) { return '<li class="' + (g.bad ? 'is-bad' : '') + '">' + esc(g.k) + ' <b>' + g.n + '</b></li>'; }).join('') + '</ol>'));
    // ④ 불량 즉시 확인
    var bl = d.bad.slice(0, 6);
    o.push(card('tx-rp-c3', '불량 ' + d.bad.length + '건 즉시 확인', '행 클릭 시 상세 · 트윈 위치 확인', d.bad.length ? '<span class="tx-rp-chip is-bad">' + esc(Array.from(new Set(d.bad.map(function (r) { return r.bldg; }))).slice(0, 2).join('·')) + '</span>' : '',
      bl.length ? '<div class="tx-rp-defs">' + bl.map(function (r, i) { return '<button type="button" data-rp="row" data-k="' + esc(r.key) + '" class="tx-rp-def c' + (i % 4) + '"><i>' + (i + 1) + '</i><span><b>' + esc(r.equip) + '</b><small>' + esc([r.bldg, r.floor, r.loc].filter(Boolean).join(' ')) + '</small></span><em>' + esc(r.std) + '</em><strong>' + esc(String(r.value)) + '</strong><u>' + (r.act ? esc(ACT_STEPS[r.act.step] || '접수') : '미조치') + '</u></button>'; }).join('') + (d.bad.length > 6 ? '<button type="button" class="tx-rp-more" data-rp="defonly">불량 전체 ' + d.bad.length + '건 보기 →</button>' : '') + '</div>' : '<div class="tx-rp-allok">✔ 불량 판정 항목이 없습니다</div>'));
    // ⑤ 기준 적합률 hbar
    var hb = d.byEq.filter(function (g) { return g.bad; }).slice(0, 4).map(function (g) { return { k: /설비$/.test(g.k) ? g.k : g.k + ' 설비', v: g.rate, c: 'var(--rp-cobalt)' }; }).concat(d.byStd.map(function (g, i) { return { k: g.k + ' 기준', v: g.rate, c: PAL[(i + 1) % PAL.length] }; })).slice(0, 7);
    o.push(card('tx-rp-c3', '주요 설비 · 기준 적합률', '불량 설비 및 기술기준', '', '<div class="tx-rp-hbars">' + hb.map(function (h) { return '<div><span>' + esc(h.k) + '</span><b>' + (h.v == null ? '—' : f1(h.v) + '%') + '</b><i><u style="width:' + (h.v || 0) + '%;background:' + h.c + '"></u></i></div>'; }).join('') + '</div>'));
    // ⑥ 건물별 비중
    var bp = d.byB.slice(0, 6).map(function (b, i) { return { k: b.k, v: b.n, c: PAL[i % PAL.length] }; });
    o.push(card('tx-rp-c3', '건물별 점검 비중', d.byB.length + '개 건물 합계 ' + d.rows.length + '건', '', '<div class="tx-rp-dwrap">' + donutChart(bp, d.rows.length + '건', '양호 ' + d.good.length + ' · 불량 ' + d.bad.length) + '</div><div class="tx-rp-leg tx-rp-legc">' + bp.map(function (p) { return '<span><i style="background:' + p.c + '"></i>' + esc(p.k) + ' ' + p.v + '</span>'; }).join('') + '</div>'));
    var r3 = [], ops = opsData(); if (ops) r3.push(opsCard(ops));
    // ⑦ 기준 링
    r3.push(card('tx-rp-r3', '기술기준 링', '링에 마우스를 올리면 기준별 적합률', '', '<div class="tx-rp-dwrap">' + rings(d.byStd, d.rate == null ? '—' : f1(d.rate) + '%') + '</div><div class="tx-rp-leg tx-rp-legc">' + d.byStd.slice(0, 6).map(function (g, i) { return '<span><i style="background:' + PAL[i % PAL.length] + '"></i>' + esc(g.k) + ' ' + (g.rate == null ? '—' : f1(g.rate) + '%') + '</span>'; }).join('') + '</div>'));
    // ⑧ 건물별 기준 레이더
    var axes = d.byStd.map(function (g) { return g.k; }), bser = d.byB.slice(0, 4).map(function (b) { return { name: b.k, v: axes.map(function (ax) { var rr = d.rows.filter(function (r) { return r.bldg === b.k && r.std === ax; }), gg = rr.filter(function (r) { return r.judge === 'good' || r.judge === 'none'; }).length, bb = rr.filter(function (r) { return r.judge === 'bad'; }).length; return pct(gg, gg + bb); }) }; });
    r3.push(card('tx-rp-r3', '건물별 기준 레이더', d.byB.slice(0, 4).map(function (b) { return b.k; }).join('·') + ' 오버레이', '', '<div class="tx-rp-dwrap">' + radar(axes, bser) + '</div><div class="tx-rp-leg tx-rp-legc">' + bser.map(function (s, i) { return '<span><i style="background:' + PAL[i % PAL.length] + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>'));
    // ⑨ 불량 설비 요약
    var be4 = d.badEq.slice(0, 4);
    r3.push(card('tx-rp-r3', '불량 ' + be4.length + '개 설비 요약', '전체 적합률 및 최저 ' + be4.length + '종', '<strong class="tx-rp-big">' + (d.rate == null ? '—' : f1(d.rate) + '%') + '</strong>', '<div class="tx-rp-prog"><u style="width:' + (d.rate || 0) + '%"></u></div>' +
      (be4.length ? '<div class="tx-rp-m4">' + be4.map(function (g, i) { return '<div>' + miniDonut(g.rate, PAL[i % PAL.length]) + '<span><small>' + (i < 9 ? '0' : '') + (i + 1) + '</small><b>' + esc(g.k) + '</b><em>불량 ' + g.bad + '건</em></span></div>'; }).join('') + '</div>' : '<div class="tx-rp-allok">✔ 불량 설비 없음</div>')));
    // ⑩ 퍼널
    var withPhoto = d.badAssets.filter(function (b) { return b.a && TX.pipe && TX.pipe.photos.count(b.a.id).total; }).length;
    var fn = [['총 점검 대상', d.rows.length + '건', d.rows.length], ['유효 측정 (제외 ' + d.na.length + ')', d.eff + '건', d.eff], ['양호 판정', d.good.length + '건', d.good.length], ['설비·실 연결', d.linked + '건', d.linked], ['불량 조치 완료', d.done + '/' + d.bad.length, d.bad.length ? d.done : 0]];
    var fmx = Math.max(1, d.rows.length);
    r3.push(card('tx-rp-r3', '점검 적합성 · 처리 퍼널', d.rows.length + '건 대상 → 유효 → 양호 → 연결 → 조치', '<span class="tx-rp-chip">5단계</span>', '<div class="tx-rp-fun">' + fn.map(function (f, i) { var w = Math.max(46, 100 * f[2] / fmx); return '<div><span>' + (i === 4 ? (d.bad.length ? f1(pct(d.done, d.bad.length)) + '%' : '—') : f1(pct(f[2], fmx)) + '%') + '</span><b style="width:' + w + '%;background:' + PAL[i % PAL.length] + '">' + esc(f[0]) + ' ' + esc(f[1]) + '</b></div>'; }).join('') + '</div>' + (withPhoto || d.badAssets.length ? '<small class="tx-rp-foot">불량 설비 증빙 사진 ' + withPhoto + '/' + d.badAssets.length + '대</small>' : '')));
    if (d.items.length) o.push(itemTableCard(d.items));
    o.push('<div class="tx-rp-row3" style="--n:' + r3.length + '">' + r3.join('') + '</div>');
    return '<div class="tx-rp-body"><div class="tx-rp-bento">' + o.join('') + '</div><p class="tx-rp-src">출처: 트윈에 등록된 점검 측정 자료(점검 결과서·ADMIN 측정) · 실시간 센서 값 아님 · 마지막 집계 ' + ymd(new Date()) + '</p></div>';
  }

  /* ================= 측정 항목별 (점검앱 대시보드 방식: 통합 표 · 항목별 카드) ================= */
  function itemLabel(r) {
    var m = r.m, u = r.iUnit || '', st = m.std, n = String(r.iName || m.item || '').replace(/^\(추가\)\s*/, '');
    if (/ΔT/.test(n)) return '열화상 ΔT';
    if (st === 'gnd' || /Ω/.test(u)) return '접지저항';
    if (/lx/i.test(u)) return '조도';
    if (/RH/i.test(u) || (st === 'env' && /%/.test(u))) return '습도';
    if (st === 'env' && /℃|°C/.test(u)) return '온도';
    if (/dB\(A\)/i.test(u)) return '이상 소음';
    if (st === 'pwr' || /^V$/.test(u)) return r.num != null && r.num < 150 && /AC/i.test(r.crit + ((r.lim && r.lim.text) || '')) ? '입력 전원 (DC)' : '입력 전원'; /* AC 220V 기준을 DC 48V 등에 적용하지 않음 */
    if (st === 'heat') return '열화상 최고온도';
    var t = n.split(/\s[—–-]\s/).pop().replace(/\([^)]*\)/g, '').replace(/\s*(측정|확인|상태)\s*$/g, '').trim();
    return t.length > 16 ? t.slice(0, 16) + '…' : t || '측정';
  }
  function groupItems(rows) {
    var g = {}, order = [];
    rows.forEach(function (r) {
      if (r.num == null || r.judge === 'na') return;
      var lab = itemLabel(r), k = lab + '|' + (r.iUnit || '');
      if (!g[k]) { g[k] = { key: k, name: lab, unit: r.iUnit || '', rows: [], lim: null }; order.push(k); }
      g[k].rows.push(r); if (!g[k].lim && !/\(DC\)$/.test(lab) && r.lim && (r.lim.lo != null || r.lim.hi != null)) g[k].lim = r.lim;
    });
    return order.map(function (k) {
      var it = g[k], vs = it.rows.map(function (r) { return r.num; }), lim = it.lim, lo = lim && lim.lo != null ? lim.lo : null, hi = lim && lim.hi != null ? lim.hi : null;
      var sum = vs.reduce(function (a, b) { return a + b; }, 0), avg = sum / vs.length, mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
      var out = it.rows.filter(function (r) { return (hi != null && r.num > hi) || (lo != null && r.num < lo); });
      if (!lim) out = [];
      var bad = it.rows.filter(function (r) { return r.judge === 'bad'; });
      var kind = lo != null && hi != null ? 'range' : hi != null ? 'gauge' : lo != null ? 'low' : 'line';
      var rep = kind === 'gauge' ? mx : kind === 'low' ? mn : avg, repLab = kind === 'gauge' ? '최고값' : kind === 'low' ? '최저값' : '평균';
      it.rows.sort(function (a, b) { return (a.bldg + a.floor + a.loc).localeCompare(b.bldg + b.floor + b.loc, 'ko'); });
      return Object.assign(it, { n: vs.length, avg: avg, min: mn, max: mx, lo: lo, hi: hi, kind: kind, rep: rep, repLab: repLab, out: out, bad: bad, critText: lim ? lim.text : '' ,
        status: bad.length ? 'bad' : !lim ? 'none' : out.length ? 'dev' : 'ok' });
    }).sort(function (a, b) { var o = { bad: 0, dev: 1, ok: 2, none: 3 }; return (o[a.status] - o[b.status]) || (b.n - a.n); });
  }
  function nf(v) { if (v == null || !isFinite(v)) return '—'; var a = Math.abs(v); return (a >= 100 ? Math.round(v) : a >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100).toLocaleString('en-US'); }
  function scaleOf(it, padK) { var ext = [it.min, it.max].concat([it.lo, it.hi].filter(function (x) { return x != null; })); var lo = Math.min.apply(null, ext), hi = Math.max.apply(null, ext), pad = (hi - lo || Math.abs(hi) || 1) * (padK || 0.25); var a = lo - pad; if (lo >= 0 && a < 0) a = 0; return { lo: a, hi: hi + pad }; } /* 음수가 될 수 없는 값은 0 아래로 내리지 않음 */
  var ST_IC = { bad: ['!', 'var(--rp-crimson)'], dev: ['~', 'var(--rp-amber)'], ok: ['✓', 'var(--rp-emerald)'], none: ['–', 'var(--rp-muted)'] };
  function gaugeSVG(it) {
    var top = Math.max(it.hi * 1.5, it.max * 1.1, 1), cx = 150, cy = 124, R = 86, A = function (v) { var t = Math.PI * (1 - Math.max(0, Math.min(1, v / top))); return [cx + R * Math.cos(t), cy - R * Math.sin(t)]; };
    var arc = function (v0, v1) { var p0 = A(v0), p1 = A(v1), large = (v1 - v0) / top > 0.5 ? 1 : 0; return 'M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + 'A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1); };
    var over = it.rep > it.hi, col = over ? 'var(--rp-crimson)' : it.rep > it.hi * 0.8 ? 'var(--rp-amber)' : 'var(--rp-emerald)', o = ['<svg viewBox="0 0 300 160" class="tx-rp-gauge">'];
    o.push('<path d="' + arc(0, top) + '" fill="none" class="tx-rp-trackc" stroke-width="16" stroke-linecap="round"/>');
    o.push('<path d="' + arc(0, Math.min(it.hi, top)) + '" fill="none" stroke="var(--rp-emerald-soft)" stroke-width="16"/>');
    o.push('<path d="' + arc(0, Math.max(0.0001, Math.min(it.rep, top))) + '" fill="none" stroke="' + col + '" stroke-width="16" stroke-linecap="round"/>');
    for (var i = 0; i <= 4; i++) { var v = top * i / 4, p = A(v), q = [cx + (R + 24) * (p[0] - cx) / R, cy + (R + 24) * (p[1] - cy) / R]; o.push('<text x="' + q[0].toFixed(1) + '" y="' + (q[1] + 4).toFixed(1) + '" text-anchor="middle" class="tx-rp-ax">' + nf(v) + '</text>'); }
    var lp = A(it.hi), li = [cx + (R - 12) * (lp[0] - cx) / R, cy + (R - 12) * (lp[1] - cy) / R], lo2 = [cx + (R + 10) * (lp[0] - cx) / R, cy + (R + 10) * (lp[1] - cy) / R];
    o.push('<line x1="' + li[0].toFixed(1) + '" y1="' + li[1].toFixed(1) + '" x2="' + lo2[0].toFixed(1) + '" y2="' + lo2[1].toFixed(1) + '" stroke="var(--rp-crimson)" stroke-width="3"><title>기준 ' + nf(it.hi) + it.unit + '</title></line>');
    var np = A(Math.min(it.rep, top)), nn = [cx + (R - 26) * (np[0] - cx) / R, cy + (R - 26) * (np[1] - cy) / R];
    o.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + nn[0].toFixed(1) + '" y2="' + nn[1].toFixed(1) + '" stroke="var(--rp-text)" stroke-width="3.5" stroke-linecap="round"/><circle cx="' + cx + '" cy="' + cy + '" r="8" fill="var(--rp-card)" stroke="var(--rp-text)" stroke-width="3.5"/>');
    o.push('<rect x="' + (cx - 58) + '" y="' + (cy + 18) + '" width="116" height="22" rx="7" fill="' + (over ? 'var(--rp-crimson-soft)' : 'var(--rp-emerald-soft)') + '"/><text x="' + cx + '" y="' + (cy + 34) + '" text-anchor="middle" font-size="13" font-weight="900" fill="' + col + '">' + nf(it.rep) + esc(it.unit) + ' ' + it.repLab + '</text>');
    return o.join('') + '</svg>';
  }
  function rangeSVG(it) {
    var sc = scaleOf(it), W = 360, L = 14, Rr = W - 14, X = function (v) { return L + (v - sc.lo) / (sc.hi - sc.lo || 1) * (Rr - L); }, y = 40, a = it.lo != null ? it.lo : sc.lo, b = it.hi != null ? it.hi : sc.hi, o = ['<svg viewBox="0 0 ' + W + ' 92" class="tx-rp-svg">'];
    o.push('<text x="' + ((X(a) + X(b)) / 2).toFixed(1) + '" y="14" text-anchor="middle" font-size="11" font-weight="800" fill="var(--rp-emerald)">참고기준 ' + esc(it.critText || '') + '</text><line x1="' + X(a).toFixed(1) + '" x2="' + X(b).toFixed(1) + '" y1="20" y2="20" stroke="var(--rp-emerald)" stroke-dasharray="4 3"/>');
    o.push('<rect x="' + L + '" y="' + (y - 7) + '" width="' + (Rr - L) + '" height="14" rx="7" class="tx-rp-track"/><rect x="' + X(a).toFixed(1) + '" y="' + (y - 7) + '" width="' + Math.max(2, X(b) - X(a)).toFixed(1) + '" height="14" rx="7" fill="var(--rp-emerald-soft)"/>');
    it.rows.forEach(function (r) { var ov = (it.hi != null && r.num > it.hi) || (it.lo != null && r.num < it.lo); o.push('<circle cx="' + X(r.num).toFixed(1) + '" cy="' + y + '" r="' + (ov ? 4.5 : 3.5) + '" fill="' + (ov ? 'var(--rp-crimson)' : 'var(--rp-muted)') + '"><title>' + esc(r.loc + ' ' + nf(r.num) + it.unit) + '</title></circle>'); });
    o.push('<circle cx="' + X(it.avg).toFixed(1) + '" cy="' + y + '" r="9" fill="var(--rp-card)" stroke="var(--rp-cobalt)" stroke-width="4"/><rect x="' + (X(it.avg) - 34).toFixed(1) + '" y="' + (y + 12) + '" width="68" height="18" rx="6" fill="var(--rp-cobalt-soft)"/><text x="' + X(it.avg).toFixed(1) + '" y="' + (y + 25) + '" text-anchor="middle" font-size="11" font-weight="900" fill="var(--rp-cobalt)">' + nf(it.avg) + esc(it.unit) + '</text>');
    for (var i = 0; i <= 4; i++) { var v = sc.lo + (sc.hi - sc.lo) * i / 4; o.push('<text x="' + X(v).toFixed(1) + '" y="' + (y + 48) + '" text-anchor="middle" class="tx-rp-ax">' + nf(v) + '</text>'); }
    return o.join('') + '</svg>';
  }
  function trendSVG(it, H, W) {
    H = H || 120; W = W || 360; var L = 34, Rr = W - 8, T = 10, B = 22, n = it.rows.length, sc = scaleOf(it, 0.15);
    var X = function (i) { return n === 1 ? (L + Rr) / 2 : L + (Rr - L) * i / (n - 1); }, Y = function (v) { return T + (H - T - B) * (1 - (v - sc.lo) / (sc.hi - sc.lo || 1)); }, o = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="tx-rp-svg">'];
    for (var t = 0; t <= 3; t++) { var v = sc.lo + (sc.hi - sc.lo) * t / 3, yy = Y(v); o.push('<line x1="' + L + '" x2="' + Rr + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" class="tx-rp-grid"/><text x="' + (L - 4) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end" class="tx-rp-ax">' + nf(v) + '</text>'); }
    if (it.lo != null && it.hi != null) o.push('<rect x="' + L + '" y="' + Y(it.hi).toFixed(1) + '" width="' + (Rr - L) + '" height="' + Math.max(1, Y(it.lo) - Y(it.hi)).toFixed(1) + '" fill="var(--rp-emerald-soft)"/>');
    [it.lo, it.hi].forEach(function (v) { if (v != null) o.push('<line x1="' + L + '" x2="' + Rr + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--rp-emerald)" stroke-dasharray="5 4"/>'); });
    var d = it.rows.map(function (r, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(r.num).toFixed(1); }).join('');
    o.push('<path d="' + d + 'L' + X(n - 1).toFixed(1) + ' ' + (H - B) + 'L' + X(0).toFixed(1) + ' ' + (H - B) + 'Z" fill="var(--rp-cobalt-soft)"/><path d="' + d + '" fill="none" stroke="var(--rp-cobalt)" stroke-width="2"/>');
    var every = Math.max(1, Math.ceil(n / 7));
    it.rows.forEach(function (r, i) { var ov = (it.hi != null && r.num > it.hi) || (it.lo != null && r.num < it.lo); o.push('<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(r.num).toFixed(1) + '" r="' + (ov ? 4 : 2.8) + '" fill="' + (ov ? 'var(--rp-crimson)' : 'var(--rp-card)') + '" stroke="' + (ov ? 'var(--rp-card)' : 'var(--rp-cobalt)') + '" stroke-width="1.6"><title>' + esc(r.loc + ' · ' + nf(r.num) + it.unit) + '</title></circle>');
      if (i % every === 0) o.push('<text x="' + X(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="tx-rp-ax" font-size="9">' + esc(String(r.floor || r.loc).slice(0, 6)) + '</text>'); });
    return o.join('') + '</svg>';
  }
  function spark(it) {
    var W = 150, H = 30, n = it.rows.length, sc = scaleOf(it, 0.1), X = function (i) { return n === 1 ? W / 2 : 3 + (W - 6) * i / (n - 1); }, Y = function (v) { return 3 + (H - 6) * (1 - (v - sc.lo) / (sc.hi - sc.lo || 1)); };
    var band = it.lo != null || it.hi != null ? '<rect x="0" y="' + Y(it.hi != null ? it.hi : sc.hi).toFixed(1) + '" width="' + W + '" height="' + Math.max(1, Y(it.lo != null ? it.lo : sc.lo) - Y(it.hi != null ? it.hi : sc.hi)).toFixed(1) + '" fill="var(--rp-emerald-soft)"/>' : '';
    var d = it.rows.map(function (r, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(r.num).toFixed(1); }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="tx-rp-spark">' + band + '<path d="' + d + '" fill="none" stroke="var(--rp-cobalt)" stroke-width="1.6"/>' + it.rows.map(function (r, i) { var ov = (it.hi != null && r.num > it.hi) || (it.lo != null && r.num < it.lo); return ov ? '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(r.num).toFixed(1) + '" r="2.6" fill="var(--rp-crimson)"/>' : ''; }).join('') + '</svg>';
  }
  function distBar(it) {
    var sc = scaleOf(it, 0.12), P = function (v) { return Math.max(0, Math.min(100, (v - sc.lo) / (sc.hi - sc.lo || 1) * 100)); };
    var a = it.lo != null ? P(it.lo) : 0, b = it.hi != null ? P(it.hi) : 100;
    return '<span class="tx-rp-dist"><i style="left:' + a + '%;width:' + Math.max(1, b - a) + '%"></i><u style="left:' + P(it.min) + '%;width:' + Math.max(1, P(it.max) - P(it.min)) + '%"></u><b style="left:' + P(it.avg) + '%"></b></span>';
  }
  function statusChip(it) { return it.status === 'bad' ? '<span class="tx-rp-chip is-bad">부적합 ' + it.bad.length + '</span>' : it.status === 'dev' ? '<span class="tx-rp-chip is-warn">범위 밖 ' + it.out.length + '</span>' : it.status === 'ok' ? '<span class="tx-rp-chip is-ok">범위 이내</span>' : '<span class="tx-rp-chip is-na">기준 없음</span>'; }
  function itemTableCard(items) {
    return '<section class="tx-rp-card tx-rp-full12"><div class="tx-rp-ch"><div><h4>측정 항목 한눈에 보기</h4><small>' + items.length + '개 항목 · 줄을 누르면 위치별 값 · 「🗂 항목별」에서 항목마다 그래프</small></div></div><div class="tx-rp-tablewrap"><table class="tx-rp-table tx-rp-itab"><thead><tr><th></th><th>측정 항목</th><th>위치별 추이</th><th class="r">' + '대표값</th><th class="r">최소~최대</th><th>기준 대비 분포</th><th>참고기준</th><th>상태</th></tr></thead><tbody>' +
      items.map(function (it) { var ic = ST_IC[it.status]; return '<tr data-rp="item" data-k="' + esc(it.key) + '"><td><i class="tx-rp-dot" style="background:' + ic[1] + '"></i></td><td><b>' + esc(it.name) + '</b><small>' + it.n + '곳 · ' + it.repLab + ' ' + nf(it.rep) + esc(it.unit) + '</small></td><td>' + spark(it) + '</td><td class="tx-rp-val">' + nf(it.rep) + '<small class="u">' + esc(it.unit) + '</small></td><td class="r tx-rp-mut">' + nf(it.min) + '~' + nf(it.max) + '</td><td>' + distBar(it) + '</td><td class="tx-rp-mut">' + esc(it.critText || '—') + '</td><td>' + statusChip(it) + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="tx-rp-leg" style="margin-top:8px"><span><i style="background:var(--rp-emerald-soft);border-radius:2px"></i>참고범위</span><span><i style="background:var(--rp-text);border-radius:2px;height:3px"></i>최소~최대</span><span><i style="background:var(--rp-cobalt)"></i>대표값</span><span><i style="background:var(--rp-crimson)"></i>이탈 위치</span></div></section>';
  }
  /* 🗂 항목별: 측정 항목마다 게이지·범위·추이 카드 */
  function view4() {
    var d = D, its = d.items;
    if (!its.length) return '<div class="tx-rp-body">' + empty('숫자로 된 측정값이 없습니다 (접지저항·전압·온습도·조도 등 측정값이 있으면 항목별 그래프가 나타납니다)') + '</div>';
    var nb = its.filter(function (x) { return x.status === 'bad'; }), nd = its.filter(function (x) { return x.status === 'dev'; });
    var alerts = (nb.length ? '<div class="tx-rp-alert is-bad">⚠ 부적합 판정 ' + nb.reduce(function (s, x) { return s + x.bad.length; }, 0) + '건 · ' + nb.map(function (x) { return esc(x.name); }).join(' · ') + '</div>' : '') + (nd.length ? '<div class="tx-rp-alert is-warn">ℹ 참고범위 밖 ' + nd.reduce(function (s, x) { return s + x.out.length; }, 0) + '건 (환경 편차·부적합 아님) · ' + nd.map(function (x) { return esc(x.name); }).join(' · ') + '</div>' : '');
    var cards = its.map(function (it, i) {
      var ic = ST_IC[it.status], chart = it.kind === 'gauge' ? gaugeSVG(it) : it.kind === 'range' || it.kind === 'low' ? rangeSVG(it) + (it.n >= 3 ? '<div class="tx-rp-mini">' + trendSVG(it, 96) + '</div>' : '') : trendSVG(it, 150);
      var foot = it.status === 'bad' ? '<span class="is-bad">부적합 ' + it.bad.length + '곳</span>' : it.status === 'dev' ? '<span class="is-warn">참고범위 밖 ' + it.out.length + '곳</span>' : it.status === 'ok' ? '<span class="is-ok">범위 이내 ' + it.n + '/' + it.n + '</span>' : '<span class="tx-rp-mut">참고기준 없음 · ' + it.n + '곳</span>';
      return '<button type="button" class="tx-rp-icard is-' + it.status + '" data-rp="item" data-k="' + esc(it.key) + '" style="animation-delay:' + (i * 0.04).toFixed(2) + 's"><div class="tx-rp-ich"><i style="background:' + ic[1] + '">' + ic[0] + '</i><b title="' + esc(it.name) + '">' + esc(it.name) + '</b><strong class="is-' + it.status + '">' + nf(it.rep) + '<small>' + esc(it.unit) + '</small></strong></div>' +
        '<div class="tx-rp-ics"><span>' + it.repLab + ' · ' + it.n + '곳</span><span>' + (it.critText ? '참고기준 ' + esc(it.critText) : '참고기준 없음') + '</span></div><div class="tx-rp-icc">' + chart + '</div><div class="tx-rp-icf">' + foot + '<span class="tx-rp-mut">자세히 ›</span></div></button>';
    }).join('');
    return '<div class="tx-rp-body"><div class="tx-rp-alerts">' + alerts + '</div><div class="tx-rp-igrid">' + cards + '</div><p class="tx-rp-src">항목별: 같은 측정 항목을 위치마다 모아 기준과 비교 · 대표값 = 상한 기준은 최고값, 하한 기준은 최저값, 범위 기준은 평균</p></div>';
  }
  function itemModal(key) {
    var it = D.items.find(function (x) { return x.key === key; }); if (!it) return;
    var m = U.el('div', 'tx-rp-modal');
    var rows = it.rows.slice().sort(function (a, b) { var ov = function (r) { return (it.hi != null && r.num > it.hi) || (it.lo != null && r.num < it.lo) ? 1 : 0; }; return (b.judge === 'bad') - (a.judge === 'bad') || ov(b) - ov(a) || b.num - a.num; });
    m.innerHTML = '<div class="tx-rp-mbox tx-rp-mwide"><div class="tx-rp-mh">' + statusChip(it) + '<h3>' + esc(it.name) + ' · ' + it.n + '곳</h3><button type="button" class="tx-rp-x" data-rp="mclose">✕</button></div><div class="tx-rp-mbd">' +
      '<div class="tx-rp-mstat"><div><small>' + it.repLab + '</small><b>' + nf(it.rep) + esc(it.unit) + '</b></div><div><small>평균</small><b>' + nf(it.avg) + esc(it.unit) + '</b></div><div><small>최소~최대</small><b>' + nf(it.min) + '~' + nf(it.max) + '</b></div><div><small>참고기준</small><b>' + esc(it.critText || '없음') + '</b></div></div>' +
      '<div class="tx-rp-mchart">' + trendSVG(it, 200, 820) + '</div><div class="tx-rp-tablewrap"><table class="tx-rp-table"><thead><tr><th>판정</th><th>건물·위치</th><th>설비</th><th class="r">실측값</th><th>점검일</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr data-rp="row" data-k="' + esc(r.key) + '" class="' + (r.judge === 'bad' ? 'is-bad' : '') + '"><td>' + chip(r.judge, r.warn) + '</td><td>' + esc([r.bldg, r.floor, r.loc].filter(Boolean).join(' ')) + '</td><td>' + esc(r.equip) + '</td><td class="tx-rp-val ' + (r.judge === 'bad' ? 'is-bad' : '') + '">' + nf(r.num) + ' ' + esc(it.unit) + '</td><td class="tx-rp-mut">' + esc(r.dateS) + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>';
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-rp="mclose"]')) { m.remove(); return; } var tr = e.target.closest('[data-rp="row"]'); if (tr) { e.stopPropagation(); m.remove(); modal(tr.getAttribute('data-k')); } });
    el.appendChild(m);
  }
  /* 측정목록 */
  function filtered() {
    var q = st.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (st.defOnly && r.judge !== 'bad') return false;
      if (st.fb !== 'ALL' && r.bldg !== st.fb) return false;
      if (st.ff !== 'ALL' && r.equip !== st.ff) return false;
      if (st.fs !== 'ALL' && r.std !== st.fs) return false;
      if (st.fv !== 'ALL' && (st.fv === 'warn' ? !r.warn : r.judge !== st.fv)) return false;
      if (q && [r.id, r.bldg, r.floor, r.loc, r.equip, r.eqName, r.item, r.value, r.crit, r.note].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function view2() {
    var d = D, rs = filtered(), per = 15, pages = Math.max(1, Math.ceil(rs.length / per)); st.page = Math.min(st.page, pages);
    var sel = function (k, all, list) { return '<select data-rp="f" data-k="' + k + '" class="tx-rp-sel">' + '<option value="ALL">' + all + '</option>' + list.map(function (v) { var val = Array.isArray(v) ? v[0] : v, lab = Array.isArray(v) ? v[1] : v; return '<option value="' + esc(val) + '"' + (st[k] === val ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join('') + '</select>'; };
    var body = rs.slice((st.page - 1) * per, st.page * per).map(function (r) {
      return '<tr data-rp="row" data-k="' + esc(r.key) + '" class="' + (r.judge === 'bad' ? 'is-bad' : r.warn ? 'is-warn' : '') + '"><td class="tx-rp-id">' + esc(r.id) + '</td><td>' + chip(r.judge, r.warn) + '</td><td><b>' + esc(r.bldg) + '</b></td><td>' + esc([r.floor, r.loc].filter(Boolean).join(' ')) + '</td><td><b>' + esc(r.equip) + '</b>' + (r.a && r.eqName !== r.equip ? '<small>' + esc(r.eqName) + '</small>' : '') + '</td><td class="tx-rp-mut">' + esc(r.std) + '</td><td>' + esc(r.item) + '</td><td class="tx-rp-val ' + (r.judge === 'bad' ? 'is-bad' : r.judge === 'good' ? 'is-ok' : '') + '">' + esc(String(r.value)) + '</td><td class="tx-rp-mut">' + esc(r.crit || '—') + '</td><td class="tx-rp-mut">' + esc(r.dateS) + '</td><td class="tx-rp-note">' + esc(r.note || '') + '</td><td>' + (r.a || r.r ? '<span class="tx-rp-tw" title="트윈 연결됨">◉</span>' : '<span class="tx-rp-mut" title="설비 미매칭">–</span>') + '</td></tr>';
    }).join('') || '<tr><td colspan="12">' + empty('조건에 맞는 측정이 없습니다') + '</td></tr>';
    var pg = ''; for (var p = Math.max(1, st.page - 2); p <= Math.min(pages, st.page + 2); p++) pg += '<button type="button" data-rp="page" data-k="' + p + '" class="' + (p === st.page ? 'is-on' : '') + '">' + p + '</button>';
    return '<div class="tx-rp-body"><section class="tx-rp-card tx-rp-full"><div class="tx-rp-ch"><div><h4>' + esc(d.site) + ' 전체 측정목록 (' + d.rows.length + '건)</h4><small>필터 결과 ' + rs.length + '건 — 양호 ' + d.good.length + ' · 불량 ' + d.bad.length + ' · 제외 ' + d.na.length + ' (유효 ' + d.eff + '건 · 적합률 ' + (d.rate == null ? '—' : f1(d.rate) + '%') + ')</small></div><div class="tx-rp-acts"><button type="button" class="tx-rp-btn" data-rp="csv" data-k="flt">필터 결과 CSV</button><button type="button" class="tx-rp-btn tx-rp-pri" data-rp="csv" data-k="all">전체 ' + d.rows.length + '건 CSV</button></div></div>' +
      '<div class="tx-rp-filters"><input type="search" data-rp="q" class="tx-rp-in" placeholder="관리ID · 위치 · 설비명 · 실측값 · 현장 소견 검색" value="' + esc(st.q) + '">' +
      sel('fb', '전체 건물 (' + d.byB.length + ')', d.byB.map(function (b) { return [b.k, b.k + ' (' + b.n + ')']; })) + sel('ff', '전체 설비 (' + d.byEq.length + '종)', d.byEq.map(function (g) { return g.k; })) + sel('fs', '전체 기술기준', d.byStd.map(function (g) { return g.k; })) +
      sel('fv', '전체 판정', [['bad', '불량'], ['good', '양호'], ['warn', '관찰(기준 근접)'], ['na', '제외'], ['none', '미판정']]) +
      '<button type="button" class="tx-rp-btn tx-rp-danger' + (st.defOnly ? ' is-on' : '') + '" data-rp="defonly">' + (st.defOnly ? '전체 보기' : '불량 ' + d.bad.length + '건만 보기') + '</button><button type="button" class="tx-rp-btn" data-rp="freset">필터 초기화</button></div>' +
      '<div class="tx-rp-tablewrap"><table class="tx-rp-table"><thead><tr><th>관리ID</th><th>판정</th><th>건물</th><th>점검 위치</th><th>설비 구분</th><th>기준</th><th>측정항목</th><th>실측값</th><th>허용기준</th><th>점검일</th><th>현장 소견</th><th>트윈</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="tx-rp-cf"><span>' + st.page + ' / ' + pages + ' 페이지 (페이지당 ' + per + '건)</span><div class="tx-rp-pager"><button type="button" data-rp="page" data-k="' + (st.page - 1) + '"' + (st.page === 1 ? ' disabled' : '') + '>이전</button>' + pg + '<button type="button" data-rp="page" data-k="' + (st.page + 1) + '"' + (st.page === pages ? ' disabled' : '') + '>다음</button></div></div></section></div>';
  }
  /* 현장 증빙 · 조치 */
  function view3() {
    var d = D, cards = d.bad.slice(), goods = d.good.filter(function (r) { return r.a; }).slice(0, 2);
    cards = cards.concat(goods);
    var withP = 0;
    var html = cards.map(function (r) {
      var c = r.a && TX.pipe ? TX.pipe.photos.count(r.a.id) : null; if (c && c.total) withP++;
      return '<div class="tx-rp-evi" data-rp-ph="' + esc(r.a ? r.a.id : '') + '"><div class="tx-rp-ph" data-rp="photo" data-k="' + esc(r.a ? r.a.id : '') + '">' + (c && c.total ? '<div class="tx-rp-img" data-img="' + esc(r.a.id) + '"></div><em>사진 ' + c.total + '장</em>' : '<span>📷</span><b>' + (r.a ? '클릭하여 현장 사진 첨부' : '설비 매칭 후 첨부 가능') + '</b><small>' + esc(r.std === '접지' ? '접지저항계' : r.std === '발열' ? '열화상 카메라' : r.std === '신호' ? '계측기·광파워미터' : '육안·현장 촬영') + '</small>') + (r.a ? '<u>+ 첨부</u>' : '') + '</div>' +
        '<div class="tx-rp-evb"><div><b>' + esc(r.id + ' · ' + r.equip) + '</b>' + chip(r.judge, r.warn) + '</div><small>' + esc([r.bldg, r.floor, r.loc].filter(Boolean).join(' ')) + '</small><p class="' + (r.judge === 'bad' ? 'is-bad' : 'is-ok') + '">실측: <b>' + esc(String(r.value)) + '</b> <span>(기준 ' + esc(r.crit || '—') + ')</span></p>' +
        (pref.mode === 'engineer' && r.judge === 'bad' ? '<div class="tx-rp-step">' + ACT_STEPS.map(function (s, i) { return '<button type="button" data-rp="act" data-k="' + esc(r.key) + '" data-s="' + i + '" class="' + (r.act && r.act.step >= i ? 'is-on' : '') + '">' + s + '</button>'; }).join('') + '</div>' : (r.judge === 'bad' ? '<small class="tx-rp-actst">조치 상태: <b>' + (r.act ? esc(ACT_STEPS[r.act.step]) : '접수 전') + '</b>' + (r.act && r.act.memo ? ' · ' + esc(r.act.memo) : '') + '</small>' : '')) +
        '<div class="tx-rp-evf"><button type="button" class="tx-rp-btn" data-rp="row" data-k="' + esc(r.key) + '">상세</button>' + (r.a || r.r ? '<button type="button" class="tx-rp-btn" data-rp="go" data-k="' + esc(r.key) + '" data-v="2d">2D 위치</button><button type="button" class="tx-rp-btn" data-rp="go" data-k="' + esc(r.key) + '" data-v="3d">3D 위치</button>' : '') + '</div></div></div>';
    }).join('');
    return '<div class="tx-rp-body"><section class="tx-rp-card tx-rp-full"><div class="tx-rp-ch"><div><h4>현장 증빙 사진 (불량 ' + d.bad.length + '건 + 정상 표본 ' + goods.length + '건)</h4><small>카드를 클릭해 현장 사진을 첨부하면 설비의 「전경」 사진으로 저장되어 트윈 설비 정보에서도 보입니다.</small></div><span class="tx-rp-chip">첨부 ' + withP + ' / ' + cards.length + '건</span></div>' +
      (cards.length ? '<div class="tx-rp-evgrid">' + html + '</div>' : empty('표시할 측정이 없습니다')) + '</section>' +
      '<section class="tx-rp-card tx-rp-full tx-rp-sub">' + (pref.mode === 'engineer' ? '<b>엔지니어 관리 모드:</b> 불량 카드의 조치 단계(접수 → 조치 계획 → 조치 중 → 조치 완료 → 재측정 확인)를 눌러 기록합니다. 상세 창에서 메모를 남길 수 있고, 이 PC에 저장됩니다.<button type="button" class="tx-rp-btn" data-rp="mode" data-k="client">발주처 보고 모드로</button>' : '<b>발주처 보고 모드:</b> 조치 단계 입력 버튼은 깔끔한 보고 화면을 위해 숨겨져 있습니다.<button type="button" class="tx-rp-btn tx-rp-pri" data-rp="mode" data-k="engineer">엔지니어 관리 모드 켜기</button>') + '</section></div>';
  }
  function modal(key) {
    var r = D.rows.find(function (x) { return x.key === key; }); if (!r) return;
    var m = U.el('div', 'tx-rp-modal'), raw = r.m.raw || {};
    var extra = Object.keys(raw).filter(function (k) { var v = raw[k]; return v != null && v !== '' && typeof v !== 'object' && !/^(id|_)/.test(k); }).slice(0, 14);
    m.innerHTML = '<div class="tx-rp-mbox"><div class="tx-rp-mh">' + chip(r.judge, r.warn) + '<h3>' + esc(r.id + ' · ' + r.item) + '</h3><button type="button" class="tx-rp-x" data-rp="mclose">✕</button></div><div class="tx-rp-mbd">' +
      '<dl>' + [['건물·위치', [r.bldg, r.floor, r.loc].filter(Boolean).join(' ')], ['설비', r.equip + (r.a ? ' · ' + r.a.name + ' (' + r.a.id + ')' : ' (트윈 설비 미매칭)')], ['기술기준', r.std], ['실측값', r.value], ['허용기준', r.crit || '—'], ['점검일', r.dateS || '—'], ['현장 소견', r.note || '—'], ['자료 출처', { inspection: 'ADMIN 측정', report: '점검 결과서 변환', history: '점검 이력' }[r.src] || r.src || '—']].map(function (p) { return '<dt>' + p[0] + '</dt><dd class="' + (p[0] === '실측값' && r.judge === 'bad' ? 'is-bad' : '') + '">' + esc(String(p[1])) + '</dd>'; }).join('') + '</dl>' +
      (extra.length ? '<details><summary>원본 행 (' + extra.length + '개 항목)</summary><dl class="tx-rp-raw">' + extra.map(function (k) { return '<dt>' + esc(k) + '</dt><dd>' + esc(String(raw[k])) + '</dd>'; }).join('') + '</dl></details>' : '') +
      (r.judge === 'bad' && pref.mode === 'engineer' ? '<div class="tx-rp-mact"><label>조치 단계<select data-rp="mstep">' + ACT_STEPS.map(function (s, i) { return '<option value="' + i + '"' + (r.act && r.act.step === i ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label><label>조치 메모<input type="text" data-rp="mmemo" value="' + esc(r.act && r.act.memo || '') + '" placeholder="예: 접지선 재체결, 11/25 재측정 예정"></label><button type="button" class="tx-rp-btn tx-rp-pri" data-rp="msave">조치 저장</button></div>' : '') +
      '</div><div class="tx-rp-mf">' + (r.a || r.r ? '<button type="button" class="tx-rp-btn" data-rp="go" data-k="' + esc(r.key) + '" data-v="2d">2D 도면에서 위치 보기</button><button type="button" class="tx-rp-btn tx-rp-pri" data-rp="go" data-k="' + esc(r.key) + '" data-v="3d">3D 트윈에서 보기</button>' : '<small>설비가 매칭되지 않은 측정입니다 · 측정 매칭 확인에서 설비를 지정하면 트윈 위치가 연결됩니다</small>') + '</div></div>';
    m.addEventListener('click', function (e) {
      if (e.target === m || (e.target.closest('[data-rp="mclose"]'))) { m.remove(); return; }
      if (e.target.closest('[data-rp="msave"]')) { setAct(r.key, { step: +m.querySelector('[data-rp="mstep"]').value, memo: m.querySelector('[data-rp="mmemo"]').value.trim() }); m.remove(); render(); toast('조치 상태를 저장했습니다'); }
    });
    el.appendChild(m);
  }


  /* 운영 지표 스냅샷 (ADMIN v14 '운영 지표 추이'와 같은 저장소: L4 세션 2대 · CCWAS05 디스크) */
  function opsData() {
    try { var v = JSON.parse(localStorage.getItem(OPS_KEY) || 'null'); if (v && v.length) return v; } catch (e) { }
    return window.__ICT_TWIN_V14__ ? OPS_SEED.slice() : null;
  }
  function opsCard(ops) {
    var last = ops[ops.length - 1], lvl = last.disk >= 90 ? 'bad' : last.disk >= 80 ? 'warn' : 'ok';
    var spark = ops.length > 1 ? lineChart(ops.map(function (o) { return String(o.d).slice(5); }), [{ name: 'L4SWITCH1', v: ops.map(function (o) { return +o.l4a; }), c: 'var(--rp-lav)', area: true }, { name: 'L4SWITCH2', v: ops.map(function (o) { return +o.l4b; }), c: 'var(--rp-cobalt)' }], (function () { var vs = []; ops.forEach(function (o) { vs.push(+o.l4a, +o.l4b); }); var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), pad = Math.max(5, (hi - lo) * 0.25); return { W: 380, H: 150, lo: Math.floor(lo - pad), hi: Math.ceil(hi + pad) }; })()) : '<p class="tx-rp-empty">스냅샷 1건 · 값을 추가하면 추이선이 그려집니다</p>';
    var form = pref.mode === 'engineer' ? '<div class="tx-rp-opsf"><input type="number" data-rp="ops" data-k="l4a" placeholder="L4-1 세션"><input type="number" data-rp="ops" data-k="l4b" placeholder="L4-2 세션"><input type="number" step="0.1" data-rp="ops" data-k="disk" placeholder="디스크 %"><button type="button" class="tx-rp-btn tx-rp-pri" data-rp="opsadd">값 입력</button></div>' : '';
    return card('tx-rp-r3', '운영 지표 스냅샷', esc(last.d) + ' · ' + esc(last.by || '수기 입력') + ' · 자동 수집 아님', '<span class="tx-rp-chip ' + (lvl === 'ok' ? 'is-ok' : lvl === 'warn' ? 'is-warn' : 'is-bad') + '">디스크 ' + last.disk + '%' + (lvl === 'warn' ? ' Warning' : lvl === 'bad' ? ' Critical' : '') + '</span>',
      '<div class="tx-rp-chart tx-rp-ops">' + spark + '</div><div class="tx-rp-opsv"><div><small title="L4SWITCH1 세션">L4-1 세션</small><b>' + Number(last.l4a).toLocaleString() + '</b></div><div><small title="L4SWITCH2 세션">L4-2 세션</small><b>' + Number(last.l4b).toLocaleString() + '</b></div><div class="' + (lvl === 'ok' ? '' : 'is-' + lvl) + '"><small title="CCWAS05 디스크 · 임계 80%">디스크(80%)</small><b>' + last.disk + '%</b></div></div>' + form + '<small class="tx-rp-foot">스냅샷 ' + ops.length + '건 · ADMIN 운영 지표와 같은 값</small>');
  }
  /* ---------------- 렌더 · 이벤트 ---------------- */
  function render() {
    if (!el) return;
    urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
    D = collect();
    var sy = el.querySelector('.tx-rp-body'), top = sy ? sy.scrollTop : 0;
    el.className = 'tx-rp' + (OPTS.inline ? ' tx-rp-inline' : '') + (pref.theme === 'dark' ? ' tx-rp-dark' : '') + (pref.mode === 'engineer' ? ' tx-rp-eng' : '');
    var mo = el.querySelector('.tx-rp-modal'); /* 열린 상세 창은 다시 그려도 유지 */
    var bar = OPTS.inline && OPTS.bar ? OPTS.bar() : null;
    if (bar) { if (!bar._rpBound) { bar._rpBound = true; bar.addEventListener('click', onClick); } bar.className = 'tx-rp-tbar' + (pref.theme === 'dark' ? ' tx-rp-tbar-dark' : ''); bar.innerHTML = barHtml(); }
    el.innerHTML = (bar || OPTS.noHeader ? '' : header()) + (!D.rows.length ? emptyView() : view === 2 ? view2() : view === 3 ? view3() : view === 4 ? view4() : view1());
    if (mo) el.appendChild(mo);
    if (bar && OPTS.barFit) OPTS.barFit(bar, el); /* 본문을 그린 뒤 막대 위치 결정 (좁으면 본문 맨 위) */
    var b2 = el.querySelector('.tx-rp-body'); if (b2) b2.scrollTop = top;
    if (view === 3 && TX.pipe && TX.pipe.photos.all) loadThumbs();
  }
  function loadThumbs() {
    var need = Array.prototype.map.call(el.querySelectorAll('[data-img]'), function (n) { return n.getAttribute('data-img'); }); if (!need.length) return;
    TX.pipe.photos.all().then(function (all) {
      need.forEach(function (id) {
        var ps = (all || []).filter(function (p) { return p.asset === id; }).sort(function (a, b) { return (a.slot === 'full' ? 0 : 1) - (b.slot === 'full' ? 0 : 1); });
        var n = el && el.querySelector('[data-img="' + id + '"]'); if (!n || !ps.length || !ps[0].blob) return;
        var u = URL.createObjectURL(ps[0].blob); urls.push(u); n.style.backgroundImage = 'url("' + u + '")';
      });
    }).catch(function () { });
  }
  function csv(rows) {
    var head = ['관리ID', '판정', '건물', '층', '점검 위치', '설비 구분', '설비명', '설비ID', '기술기준', '측정항목', '실측값', '허용기준', '점검일', '현장 소견', '조치 상태', '조치 메모'];
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var txt = '﻿' + [head].concat(rows.map(function (r) { return [r.id, { bad: '불량', good: r.warn ? '관찰' : '양호', na: '제외', none: '미판정' }[r.judge], r.bldg, r.floor, r.loc, r.equip, r.a ? r.a.name : '', r.a ? r.a.id : '', r.std, r.item, r.value, r.crit, r.dateS, r.note, r.act ? ACT_STEPS[r.act.step] : '', r.act ? r.act.memo || '' : '']; })).map(function (r) { return r.map(q).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = (D.site || '점검') + '_측정목록_' + ymd(new Date()) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('CSV ' + rows.length + '건을 내보냈습니다');
  }
  function goTwin(key, v) {
    var r = D.rows.find(function (x) { return x.key === key; }); if (!r) return;
    var fl = r.floorCode, ns = Object.assign({ view: v === '3d' ? '3d' : '2d' }, fl ? { floor: fl } : {});
    if (OPTS.inline) TX.open(ns); else { close(); TX.setState(ns); }
    setTimeout(function () { if (r.a) TX.select(r.a.id); else if (r.r) TX.setState({ room: r.r.id }); }, 120);
  }
  function onClick(e) {
    var b = e.target.closest('[data-rp]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    var a = b.getAttribute('data-rp'), k = b.getAttribute('data-k');
    if (a === 'close') close();
    else if (a === 'view') { view = +k; render(); var bd = el.querySelector('.tx-rp-body'); if (bd) bd.scrollTop = 0; }
    else if (a === 'mode') { pref.mode = k; savePref(); render(); }
    else if (a === 'theme') { pref.theme = k; savePref(); render(); }
    else if (a === 'tab') { st.tab = +k; render(); }
    else if (a === 'cal') { var c = st.cal || D.last || new Date(); st.cal = new Date(c.getFullYear(), c.getMonth() + (+k), 1); render(); }
    else if (a === 'row') modal(k);
    else if (a === 'item') itemModal(k);
    else if (a === 'go') goTwin(k, b.getAttribute('data-v'));
    else if (a === 'csv') csv(k === 'flt' ? filtered() : D.rows);
    else if (a === 'print') { if (OPTS.inline) { document.body.classList.add('tx-rp-pinline'); var off = function () { document.body.classList.remove('tx-rp-pinline'); window.removeEventListener('afterprint', off); }; window.addEventListener('afterprint', off); window.print(); setTimeout(off, 1500); } else window.print(); }
    else if (a === 'legacy') { if (OPTS.onLegacy) OPTS.onLegacy(); }
    else if (a === 'opsadd') { var g = function (k2) { var n = el.querySelector('[data-rp="ops"][data-k="' + k2 + '"]'); return n && n.value !== '' ? +n.value : null; }; var v1 = g('l4a'), v2 = g('l4b'), v3 = g('disk'); if (v1 == null || v2 == null || v3 == null) { toast('세 값을 모두 입력하세요'); return; } var arr = opsData() || []; arr.push({ d: ymd(new Date()), l4a: v1, l4b: v2, disk: v3, by: '수기 입력' }); try { localStorage.setItem(OPS_KEY, JSON.stringify(arr)); } catch (er) { } render(); toast('운영 지표를 추가했습니다 (ADMIN 운영 지표에도 반영)'); }
    else if (a === 'defonly') { st.defOnly = !st.defOnly; st.page = 1; view = 2; render(); }
    else if (a === 'freset') { st.q = ''; st.fb = st.ff = st.fs = st.fv = 'ALL'; st.defOnly = false; st.page = 1; render(); }
    else if (a === 'page') { st.page = Math.max(1, +k); render(); }
    else if (a === 'act') { setAct(k, { step: +b.getAttribute('data-s') }); render(); }
    else if (a === 'import') { if (!OPTS.inline) close(); TX.pipe.report.open(); }
    else if (a === 'photo') {
      if (!k || !TX.pipe) return;
      var i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.multiple = true; i.style.display = 'none';
      i.onchange = function () { var fs = Array.prototype.slice.call(i.files || []); i.remove(); if (!fs.length) return; TX.pipe.photos.add(k, 'full', fs.slice(0, 1)).then(function () { return TX.pipe.photos.reindex(); }).then(function () { render(); toast('현장 사진을 첨부했습니다'); }).catch(function (er) { toast('첨부 실패: ' + er.message); }); };
      document.body.appendChild(i); i.click();
    }
  }
  function onChange(e) {
    var t = e.target, a = t.getAttribute('data-rp');
    if (a === 'bldg') { st.bldg = t.value; render(); }
    else if (a === 'f') { st[t.getAttribute('data-k')] = t.value; st.page = 1; render(); }
  }
  var qT = null;
  function onInput(e) { var t = e.target; if (t.getAttribute('data-rp') !== 'q' || e.isComposing) return; /* 한글 조합 중에는 다시 그리지 않음 */ clearTimeout(qT); qT = setTimeout(function () { st.q = t.value; st.page = 1; var pos = t.selectionStart; render(); var n = el.querySelector('[data-rp="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { } } }, 220); }
  function onKey(e) { if (e.key !== 'Escape' || !el) return; var m = el.querySelector('.tx-rp-modal'); if (m) m.remove(); else close(); e.stopPropagation(); }

  function open(v) {
    if (!el) {
      el = U.el('div', 'tx-rp'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '점검 결과 대시보드');
      el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', onInput); el.addEventListener('compositionend', onInput);
      document.body.appendChild(el); document.addEventListener('keydown', onKey, true); document.body.classList.add('tx-rp-open');
    }
    if (v) view = v;
    if (TX.pipe && TX.pipe.photos.reindex) TX.pipe.photos.reindex().then(function () { if (el && view === 3) render(); });
    render(); paintBtn();
  }
  function mountInline(host) {
    if (el === host) { render(); return; }
    el = host; el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', onInput); el.addEventListener('compositionend', onInput);
    render();
  }
  function unmount() { if (!el) return; urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = []; el = null; }
  function close() { if (OPTS.inline) { unmount(); return; } if (!el) return; urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = []; el.remove(); el = null; document.removeEventListener('keydown', onKey, true); document.body.classList.remove('tx-rp-open'); paintBtn(); }

  return { setView: function (v) { view = v; render(); var bd = el && el.querySelector('.tx-rp-body'); if (bd) bd.scrollTop = 0; if (el && el.scrollIntoView && OPTS.inline) el.scrollTop = 0; }, view: function () { return view; }, open: open, close: close, render: render, mountInline: mountInline, unmount: unmount, active: function () { return !!el; }, host: function () { return el; }, data: collect, csv: function () { return D ? D.rows.length : 0; } };
  }
  var OV = createInst({});

  /* ---------------- 툴바 버튼 ---------------- */
  function root() { return TX.ui && TX.ui.root; }
  function paintBtn() { var on = OV && OV.active(), b = root() && root().querySelector('.tx-rp-tbtn'); if (b) { b.classList.toggle('tx-on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); } }
  function mountBtn() {
    var r = root(); if (!r || r.querySelector('.tx-rp-tbtn')) return;
    var g = r.querySelector('.tx-groups'); if (!g) return;
    var b = U.el('button', 'tx-tbtn tx-rp-tbtn', '<svg class="tx-ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l1 2h3v16H5V5h3z"/><path d="M9 12l2 2 4-4"/><path d="M8 18h8"/></svg><span class="tx-tbtn-lbl">점검결과</span>');
    b.type = 'button'; b.title = '점검 결과 대시보드: 적합률·불량·측정목록·현장 증빙 (점검 결과서 기준)'; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function (e) { e.stopPropagation(); if (OV.active()) OV.close(); else OV.open(); });
    var ds = g.querySelector('.tx-dash-btn'); g.insertBefore(b, ds ? ds.nextSibling : g.firstChild);
  }
  TX.on('ui-ready', mountBtn); TX.on('open', function () { setTimeout(mountBtn, 0); });
  TX.on('model', function () { if (OV.active()) OV.render(); });
  TX.on('close', function () { OV.close(); });
  if (root()) setTimeout(mountBtn, 0);

  TX.report2 = { open: OV.open, close: OV.close, active: OV.active, data: OV.data, csv: OV.csv, create: createInst };
})();
