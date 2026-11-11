/* ============================================================
   TwinX 72-dash (통합 리드) — 관제 대시보드 (3D 건물 + 지표 카드 + 차트 패널)
   · 툴바 「관제」: 왼쪽 3D(전층 적층 · 히트맵/계통 와이어/돌하우스), 오른쪽 차트 패널, 3D 위 지표 카드(실제 설비·실로 연결선)
   · 모든 수치는 등록 자료(설비·연결·점검 결과서 측정) 기준 — 실시간 센서 값이 아님을 화면에 명시
     (센서 연동 시 TwinX.ingest 로 들어온 값이 같은 측정 자료로 합쳐져 그대로 표시됨)
   · 외부 라이브러리 없이 SVG 차트
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.dash) return;
  var U = TX.util, esc = U.esc;
  var GC = { RED: '#f43f5e', ORANGE: '#f59e0b', YELLOW: '#eab308', GREEN: '#10b981', NONE: '#64748b' };
  var on = false, col = null, kpi = null, lead = null, strip = null, modeBar = null, timer = null, prev = null, links = [];

  function root() { return TX.ui && TX.ui.root; }
  function pane3d() { var r = root(); return r && r.querySelector('.tx-pane-3d'); }
  function fmt(n) { return n == null || isNaN(n) ? '—' : (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('en-US'); }
  function pd(s) { var m = String(s || '').match(/(\d{4})[-./](\d{1,2})(?:[-./](\d{1,2}))?/); return m ? new Date(+m[1], +m[2] - 1, +(m[3] || 1)) : null; }

  /* ---------------- 자료 집계 ---------------- */
  function collect() {
    var M = TX.model || { floors: [], rooms: [], assets: [], links: [], measurements: [] };
    var seen = new Set(), ms = [];
    var add = function (m, a, r) { if (m && !seen.has(m)) { seen.add(m); ms.push({ m: m, a: a || (m.assetId && TX.asset(m.assetId)) || null, r: r || (m.roomId && TX.room(m.roomId)) || null }); } };
    M.assets.forEach(function (a) { (a.measures || []).forEach(function (m) { add(m, a, null); }); });
    M.rooms.forEach(function (r) { (r.measures || []).forEach(function (m) { add(m, null, r); }); });
    (M.measurements || []).forEach(function (m) { add(m); });
    var g = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0, NONE: 0 }; M.assets.forEach(function (a) { g[a.grade in g ? a.grade : 'NONE']++; });
    var n = M.assets.length, okRate = n ? Math.round((g.GREEN) / n * 1000) / 10 : null, checked = n - g.NONE;
    var bad = ms.filter(function (x) { return x.m.judge === 'bad'; }), warn = ms.filter(function (x) { return x.m.warn; });
    var lastD = null; ms.forEach(function (x) { var d = pd(x.m.date); if (d && (!lastD || d > lastD)) lastD = d; });
    // 위험도
    var risk = M.assets.map(function (a) { var r = TX.analysis && TX.analysis.risk ? TX.analysis.risk(a) : { total: 0, grade: a.grade }; return { a: a, total: r.total, grade: r.grade, bad: r.bad || 0, dep: r.dependents || 0 }; }).sort(function (x, y) { return y.total - x.total; });
    // 항목별 최악값 (접지·온도)
    var pick = function (test, worstHigh) {
      var c = ms.filter(function (x) { return test(x.m) && U.num(x.m.value) != null; });
      var linked = c.filter(function (x) { return x.a || x.r; }); if (linked.length) c = linked; // 설비·실에 연결된 측정 우선 (카드 연결선)
      if (!c.length) return null;
      c.sort(function (x, y) { return (U.num(y.m.value) - U.num(x.m.value)) * (worstHigh ? 1 : -1); });
      var badFirst = c.filter(function (x) { return x.m.judge === 'bad'; })[0];
      return badFirst || c[0];
    };
    var gnd = pick(function (m) { return m.std === 'gnd' || /접지/.test(m.item || ''); }, true);
    var temp = pick(function (m) { var u = String(m.unit || ''); if (/%|RH|lx|dB|V|Ω/i.test(u)) return false; return /℃|°C/.test(u) || /온도|열화상|발열/.test(m.item || '') && !/습도\s*$/.test(m.item || ''); }, true);
    // 층별
    var floors = M.floors.slice().sort(function (a, b) { return a.level - b.level; }).map(function (f) {
      var as = M.assets.filter(function (a) { return a.floor === f.code; });
      return { f: f, n: as.length, red: as.filter(function (a) { return a.grade === 'RED'; }).length, warn: as.filter(function (a) { return a.grade === 'ORANGE' || a.grade === 'YELLOW'; }).length };
    }).filter(function (x) { return x.n; });
    // 연결 유형
    var lt = {}; (M.links || []).forEach(function (l) { lt[l.type] = (lt[l.type] || 0) + 1; });
    // 측정 추이 (월별)
    var byMonth = {}; ms.forEach(function (x) { var d = pd(x.m.date); if (!d) return; var k = d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1); var o = byMonth[k] = byMonth[k] || { n: 0, bad: 0 }; o.n++; if (x.m.judge === 'bad') o.bad++; });
    var months = Object.keys(byMonth).sort().slice(-12).map(function (k) { return { k: k, n: byMonth[k].n, bad: byMonth[k].bad }; });
    // 기술기준별 적합률
    var std = [];
    if (TX.analysis && TX.analysis.summary) { var sm = TX.analysis.summary(); Object.keys(sm.std).forEach(function (k) { var s = sm.std[k]; if (s.total) std.push({ name: s.name, total: s.total, bad: s.bad, rate: s.rate }); }); }
    else { var by = {}; ms.forEach(function (x) { var k = x.m.item || '기타'; var o = by[k] = by[k] || { name: k, total: 0, bad: 0, good: 0 }; o.total++; if (x.m.judge === 'bad') o.bad++; else if (x.m.judge === 'good') o.good++; }); Object.keys(by).forEach(function (k) { var o = by[k]; o.rate = o.good + o.bad ? Math.round(o.good / (o.good + o.bad) * 1000) / 10 : null; std.push(o); }); }
    std.sort(function (x, y) { return y.total - x.total; });
    var fixes = TX.dream && TX.dream.last && TX.dream.last() ? TX.dream.last().fixes : null;
    return { M: M, n: n, g: g, okRate: okRate, checked: checked, ms: ms, bad: bad, warn: warn, lastD: lastD, risk: risk, gnd: gnd, temp: temp, floors: floors, lt: lt, months: months, std: std.slice(0, 6), fixes: fixes };
  }

  /* ---------------- SVG 차트 ---------------- */
  function donut(pct, color) {
    var r = 34, c = 2 * Math.PI * r, p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
    return '<svg viewBox="0 0 90 90" class="tx-ds-donut"><circle cx="45" cy="45" r="' + r + '" fill="none" stroke="#12304f" stroke-width="9"/>' +
      '<circle cx="45" cy="45" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (c * p / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 45 45)"/>' +
      '<text x="45" y="43" text-anchor="middle" class="tx-ds-dn">' + (pct == null ? '—' : fmt(pct)) + '</text><text x="45" y="57" text-anchor="middle" class="tx-ds-du">% 정상</text></svg>';
  }
  function bars(items, W, H) { // items: [{label, a, b}] a=전체 b=이상
    if (!items.length) return '<p class="tx-ds-empty">자료 없음</p>';
    var mx = Math.max.apply(null, items.map(function (i) { return i.a; }).concat([1])), bw = Math.min(34, (W - 30) / items.length - 6), o = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="tx-ds-chart">'];
    for (var t = 0; t <= 2; t++) { var y = 8 + (H - 30) * t / 2; o.push('<line x1="26" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="#12304f"/><text x="22" y="' + (y + 3) + '" text-anchor="end" class="tx-ds-ax">' + Math.round(mx * (1 - t / 2)) + '</text>'); }
    items.forEach(function (it, i) {
      var x = 32 + i * ((W - 36) / items.length), h = (H - 30) * it.a / mx, hb = (H - 30) * it.b / mx;
      o.push('<g class="tx-ds-bar" data-floor="' + esc(it.code || '') + '"><rect x="' + x + '" y="' + (H - 22 - h) + '" width="' + bw + '" height="' + Math.max(1, h) + '" rx="2" fill="#22d3ee"/>' +
        (it.b ? '<rect x="' + x + '" y="' + (H - 22 - hb) + '" width="' + bw + '" height="' + hb + '" rx="2" fill="#f43f5e"/>' : '') +
        '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="tx-ds-ax">' + esc(it.label) + '</text><title>' + esc(it.label + ' · 설비 ' + it.a + ' · 이상 ' + it.b) + '</title></g>');
    });
    return o.join('') + '</svg>';
  }
  function area(pts, W, H) { // pts: [{k, n, bad}]
    if (pts.length < 2) return null;
    var mx = Math.max.apply(null, pts.map(function (p) { return p.n; }).concat([1])), X = function (i) { return 28 + i * (W - 36) / (pts.length - 1); }, Y = function (v) { return 8 + (H - 30) * (1 - v / mx); };
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.n).toFixed(1); }).join(' ');
    var lineB = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.bad).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="tx-ds-chart"><defs><linearGradient id="tx-ds-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee" stop-opacity=".55"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + line + ' L' + X(pts.length - 1) + ' ' + (H - 22) + ' L' + X(0) + ' ' + (H - 22) + 'Z" fill="url(#tx-ds-g)"/><path d="' + line + '" fill="none" stroke="#22d3ee" stroke-width="2"/><path d="' + lineB + '" fill="none" stroke="#f43f5e" stroke-width="1.6" stroke-dasharray="4 3"/>' +
      pts.map(function (p, i) { return (i % Math.ceil(pts.length / 6) === 0 || i === pts.length - 1) ? '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle" class="tx-ds-ax">' + esc(p.k.slice(2)) + '</text>' : ''; }).join('') +
      '<text x="22" y="12" text-anchor="end" class="tx-ds-ax">' + mx + '</text></svg>';
  }
  function hbars(items) { // [{name, v, max, color, note}]
    return '<ul class="tx-ds-hb">' + items.map(function (i) { return '<li><span>' + esc(i.name) + '</span><i><b style="width:' + Math.max(2, Math.min(100, i.max ? i.v / i.max * 100 : 0)) + '%;background:' + i.color + '"></b></i><em>' + esc(i.note) + '</em></li>'; }).join('') + '</ul>';
  }

  /* ---------------- 화면 ---------------- */
  var LN = { optical: ['광', '#a78bfa'], data: ['UTP', '#22d3ee'], power: ['전원', '#f43f5e'], ground: ['접지', '#eab308'], path: ['경로', '#94a3b8'] };
  function render() {
    if (!on || !col) return;
    var d = collect(), M = d.M, site = (M.site && M.site.name) || '사업장';
    var lmax = Math.max.apply(null, Object.keys(d.lt).map(function (k) { return d.lt[k]; }).concat([1]));
    var trend = area(d.months, 320, 120);
    var todo = d.fixes ? d.fixes.filter(function (x) { return x.lv === 'high'; }).length : null;
    col.innerHTML =
      '<header><div><b>관제 대시보드</b><small>' + esc(site) + ' · ' + U.today() + '</small></div><span class="tx-ds-src" title="센서 연동 전: 등록 자료와 점검 결과서 측정값 기준"><i></i>점검 자료 기준 · 실시간 센서 아님</span></header>' +
      '<section class="tx-ds-card tx-ds-top"><div>' + donut(d.okRate, d.g.RED ? '#f43f5e' : d.g.ORANGE || d.g.YELLOW ? '#f59e0b' : '#10b981') + '</div>' +
        '<dl><div><dt>등록 설비</dt><dd>' + d.n + '<u>대</u></dd></div><div><dt>이상 · 주의</dt><dd class="' + (d.g.RED ? 'bad' : '') + '">' + d.g.RED + ' · ' + (d.g.ORANGE + d.g.YELLOW) + '</dd></div>' +
        '<div><dt>측정 자료</dt><dd>' + d.ms.length + '<u>건</u></dd></div><div><dt>불량 판정</dt><dd class="' + (d.bad.length ? 'bad' : '') + '">' + d.bad.length + '<u>건</u></dd></div></dl></section>' +
      '<section class="tx-ds-card"><h4>연결 계통 <small>회선 ' + (M.links || []).length + '</small></h4>' +
        (Object.keys(d.lt).length ? hbars(Object.keys(d.lt).map(function (k) { var x = LN[k] || [k, '#94a3b8']; return { name: x[0], v: d.lt[k], max: lmax, color: x[1], note: d.lt[k] + '회선' }; })) : '<p class="tx-ds-empty">등록된 연결 없음 · 계통도에서 「연결 추가」</p>') + '</section>' +
      '<div class="tx-ds-row"><section class="tx-ds-card"><h4>층별 설비 <small><i class="c1"></i>설비 <i class="c2"></i>이상</small></h4>' + bars(d.floors.map(function (x) { return { label: x.f.name || x.f.code, code: x.f.code, a: x.n, b: x.red }; }), 300, 130) + '</section>' +
        '<section class="tx-ds-card"><h4>측정 추이 <small><i class="c1"></i>건수 <i class="c2"></i>불량</small></h4>' + (trend || '<p class="tx-ds-empty">' + (d.months.length ? '점검 ' + d.months[0].k + ' · ' + d.months[0].n + '건 (2회 이상 쌓이면 추이 표시)' : '측정 자료 없음 · 점검 결과서 등록') + '</p>') + '</section></div>' +
      '<div class="tx-ds-row"><section class="tx-ds-card"><h4>기술기준 적합률</h4>' + (d.std.length ? hbars(d.std.map(function (s) { return { name: s.name, v: s.rate == null ? 0 : s.rate, max: 100, color: s.bad ? '#f59e0b' : '#10b981', note: (s.rate == null ? '—' : s.rate + '%') + ' · ' + s.total + '건' }; })) : '<p class="tx-ds-empty">측정 자료 없음</p>') + '</section>' +
        '<section class="tx-ds-card"><h4>조치 우선 설비 <small>위험도 순</small></h4><ol class="tx-ds-top5">' + (d.risk.filter(function (r) { return r.total > 0; }).slice(0, 5).map(function (r) {
          return '<li><button type="button" data-select="' + esc(r.a.id) + '"><i style="background:' + GC[r.a.grade] + '"></i><span>' + esc(TX.bundleView && r.a.bundle ? r.a.name : r.a.name) + '<small>' + esc((TX.floor(r.a.floor) || {}).name || '') + ' · ' + esc((TX.room(r.a.room) || {}).name || '') + '</small></span><b>' + Math.round(r.total) + '</b></button></li>';
        }).join('') || '<li class="tx-ds-empty">위험 요인이 있는 설비 없음</li>') + '</ol></section></div>' +
      '<footer>최근 점검 ' + (d.lastD ? d.lastD.getFullYear() + '-' + ('0' + (d.lastD.getMonth() + 1)).slice(-2) + '-' + ('0' + d.lastD.getDate()).slice(-2) : '—') + ' · 점검한 설비 ' + d.checked + '/' + d.n + (todo != null ? ' · 교정 필요(높음) ' + todo : '') + '</footer>';
    renderKpi(d);
  }
  function card(k, icon, title, val, unit, sub, cls, target) {
    return '<div class="tx-ds-kpi ' + (cls || '') + '" data-k="' + k + '"' + (target ? ' data-t="' + esc(target) + '"' : '') + '><i>' + icon + '</i><div><small>' + title + '</small><b>' + val + (unit ? '<u>' + unit + '</u>' : '') + '</b><span>' + sub + '</span></div></div>';
  }
  function renderKpi(d) {
    if (!kpi) return;
    var top = d.risk[0] && d.risk[0].total > 0 ? d.risk[0] : null, L = [], R = [];
    var nameOf = function (x) { return x.a ? x.a.name : x.r ? x.r.name : ''; }, idOf = function (x) { return x.a ? x.a.id : x.r ? x.r.id : ''; };
    L.push(card('temp', '🌡', '온도 (최근 측정 최고)', d.temp ? fmt(U.num(d.temp.m.value)) : '—', d.temp ? (d.temp.m.unit || '℃') : '', d.temp ? esc(nameOf(d.temp)) + (d.temp.m.judge === 'bad' ? ' · 불량' : d.temp.m.warn ? ' · 주의' : ' · 양호') : '측정 자료 없음', d.temp && d.temp.m.judge === 'bad' ? 'bad' : d.temp && d.temp.m.warn ? 'warn' : '', d.temp && idOf(d.temp)));
    L.push(card('gnd', '⏚', '접지저항 (최대)', d.gnd ? fmt(U.num(d.gnd.m.value)) : '—', d.gnd ? (d.gnd.m.unit || 'Ω') : '', d.gnd ? esc(nameOf(d.gnd)) + (d.gnd.m.judge === 'bad' ? ' · 불량' : ' · 양호') : '측정 자료 없음', d.gnd && d.gnd.m.judge === 'bad' ? 'bad' : '', d.gnd && idOf(d.gnd)));
    L.push(card('meas', '📋', '점검 측정', d.ms.length, '건', '불량 ' + d.bad.length + ' · 주의 ' + d.warn.length, d.bad.length ? 'bad' : ''));
    R.push(card('state', d.g.RED ? '⚠' : '✔', '설비 상태', d.g.RED ? '이상 ' + d.g.RED : d.g.ORANGE + d.g.YELLOW ? '주의 ' + (d.g.ORANGE + d.g.YELLOW) : d.n ? '정상' : '—', '', d.n ? '정상 ' + d.g.GREEN + ' · 미점검 ' + d.g.NONE + ' / ' + d.n + '대' : '등록 설비 없음', d.g.RED ? 'bad' : d.g.ORANGE + d.g.YELLOW ? 'warn' : 'ok'));
    R.push(card('risk', '◎', '최고 위험 설비', top ? Math.round(top.total) : '—', top ? '점' : '', top ? esc(top.a.name) + ' · ' + esc((TX.room(top.a.room) || {}).name || '') : '위험 요인 없음', top && top.total >= 60 ? 'bad' : top && top.total >= 40 ? 'warn' : '', top && top.a.id));
    var todo = d.fixes ? d.fixes.length : null;
    R.push(card('fix', '🛠', '현행화 점검', todo == null ? '—' : todo ? todo : '없음', todo ? '건' : '', todo == null ? '꿈꾸기 점검 전' : todo ? '교정 필요 · 눌러서 확인' : '교정할 항목 없음', todo ? 'warn' : 'ok'));
    kpi.innerHTML = '<div class="tx-ds-kl">' + L.join('') + '</div><div class="tx-ds-kr">' + R.join('') + '</div>';
    links = Array.prototype.slice.call(kpi.querySelectorAll('[data-t]')).map(function (el) { return { el: el, id: el.getAttribute('data-t'), right: !!el.closest('.tx-ds-kr') }; });
    drawLeads();
  }
  /** 지표 카드 → 실제 설비·실 위치 연결선 (카메라가 움직이면 따라감) */
  function drawLeads() {
    if (!on || !lead) return;
    var p3 = pane3d(); if (!p3 || !TX.scene3d || !TX.scene3d.project) { lead.innerHTML = ''; return; }
    var pr = p3.getBoundingClientRect(), o = [];
    links.forEach(function (l) {
      var id = TX.bundleLead ? TX.bundleLead(l.id) : l.id, p = TX.scene3d.project(id); if (!p) return;
      var r = l.el.getBoundingClientRect(), x0 = (l.right ? r.left : r.right) - pr.left, y0 = r.top + r.height / 2 - pr.top, mx = x0 + (l.right ? -26 : 26);
      if (p.x < 0 || p.y < 0 || p.x > pr.width || p.y > pr.height) return;
      o.push('<path d="M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' H' + mx.toFixed(1) + ' L' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + '" /><circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4"/><circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="9" class="halo"/>');
    });
    lead.innerHTML = o.join('');
  }

  var MODES = [['heat', '히트맵', { concept: 'D', ghost: false }], ['xray', '투시(와이어)', { concept: 'A', ghost: true }], ['doll', '돌하우스', { concept: 'A', ghost: false }], ['topo', '계통', { concept: 'C' }]];
  function curMode() { var s = TX.state; return s.concept === 'D' ? 'heat' : s.concept === 'C' ? 'topo' : s.concept === 'A' ? (s.ghost ? 'xray' : 'doll') : ''; }
  function paintMode() {
    if (!modeBar) return;
    var cm = curMode();
    modeBar.innerHTML = '<b>3D 표현</b>' + MODES.map(function (m) { return '<button type="button" data-m="' + m[0] + '" class="' + (cm === m[0] ? 'is-on' : '') + '">' + m[1] + '</button>'; }).join('');
  }
  function enter() {
    var r = root(), p3 = pane3d(); if (!r || !p3 || on) return;
    prev = { view: TX.state.view, stack: TX.state.stack, concept: TX.state.concept, ghost: TX.state.ghost, explode: TX.state.explode, panel: Object.assign({}, TX.state.panel) };
    on = true; r.classList.add('tx-dash');
    col = U.el('aside', 'tx-ds-col'); r.querySelector('.tx-viewport').appendChild(col);
    lead = U.svg('svg', { class: 'tx-ds-lead' }); p3.appendChild(lead);
    kpi = U.el('div', 'tx-ds-kpis'); p3.appendChild(kpi);
    modeBar = U.el('div', 'tx-ds-mode'); p3.appendChild(modeBar);
    strip = U.el('div', 'tx-ds-strip', '<button type="button" data-s="report">📈 점검 자료 연동</button><button type="button" data-s="risk">◔ 위험도 분석</button><button type="button" data-s="fault">⚠ 장애 파급 예측</button><button type="button" data-s="dream">⚙ 현행화 점검</button>'); p3.appendChild(strip);
    col.addEventListener('click', function (e) {
      var s = e.target.closest('[data-select]'); if (s) { TX.select(s.getAttribute('data-select')); return; }
      var b = e.target.closest('[data-floor]'); if (b && b.getAttribute('data-floor')) TX.setState({ floor: b.getAttribute('data-floor') });
    });
    kpi.addEventListener('click', function (e) {
      var c = e.target.closest('.tx-ds-kpi'); if (!c) return;
      var t = c.getAttribute('data-t'), k = c.getAttribute('data-k');
      if (k === 'fix' && TX.dream) { TX.dream.open('fix'); return; }
      if (t && TX.asset(TX.bundleLead ? TX.bundleLead(t) : t)) TX.select(TX.bundleLead ? TX.bundleLead(t) : t);
      else if (t && TX.room(t)) TX.setState({ room: t, floor: TX.room(t).floor });
    });
    modeBar.addEventListener('click', function (e) { var b = e.target.closest('[data-m]'); if (!b) return; var m = MODES.find(function (x) { return x[0] === b.getAttribute('data-m'); }); if (m) TX.setState(m[2]); });
    strip.addEventListener('click', function (e) {
      var b = e.target.closest('[data-s]'); if (!b) return; var k = b.getAttribute('data-s');
      if (k === 'report' && TX.pipe) TX.pipe.report.open();
      else if (k === 'dream' && TX.dream) TX.dream.open('mem');
      else if (k === 'risk' && TX.dream) TX.dream.open('cal');
      else if (k === 'fault') { var d = collect(), top = d.risk[0]; if (top && top.total > 0) { TX.select(top.a.id); TX.setState({ fault: { active: true, source: top.a.id } }); TX.emit('toast', { msg: '「' + top.a.name + '」 장애 시 파급 범위를 표시합니다 (다시 누르면 해제는 ⚡ 버튼)', kind: 'info' }); } else TX.emit('toast', { msg: '먼저 설비를 선택하고 ⚡ 장애 시뮬레이션을 누르세요', kind: 'info' }); }
    });
    TX.setState({ view: '3d', stack: true, ghost: false, concept: 'D', dash: true, explode: Math.max(1.9, TX.state.explode || 1.5), panel: { inspector: false, floors: false, legend: false } });
    if (TX.dream && TX.dream.run && !(TX.dream.last && TX.dream.last())) { try { TX.dream.run(); } catch (e) { } }
    paintMode(); render(); paintBtn();
    timer = setInterval(drawLeads, 120);
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 60);
  }
  function leave(keepView) {
    if (!on) return; on = false;
    clearInterval(timer);
    [col, lead, kpi, modeBar, strip].forEach(function (x) { if (x) x.remove(); }); col = lead = kpi = modeBar = strip = null;
    var r = root(); if (r) r.classList.remove('tx-dash');
    var back = { dash: false, stack: prev.stack, concept: prev.concept, ghost: prev.ghost, explode: prev.explode, panel: prev.panel }; if (keepView !== true) back.view = prev.view; TX.setState(back);
    paintBtn();
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 60);
  }
  function toggle() { if (on) leave(); else enter(); }

  /* ---------------- 툴바 버튼 ---------------- */
  function paintBtn() { var b = root() && root().querySelector('.tx-dash-btn'); if (b) { b.classList.toggle('tx-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); } }
  function mountBtn() {
    var r = root(); if (!r || r.querySelector('.tx-dash-btn')) return;
    var g = r.querySelector('.tx-groups'); if (!g) return;
    var b = U.el('button', 'tx-tbtn tx-dash-btn', '<svg class="tx-ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/></svg><span class="tx-tbtn-lbl">관제</span>');
    b.type = 'button'; b.title = '관제 대시보드: 3D 건물 + 지표 카드 + 차트 (등록·점검 자료 기준)'; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    g.insertBefore(b, g.firstChild);
  }
  TX.on('ui-ready', mountBtn); TX.on('open', function () { mountBtn(); });
  TX.on('model', function () { if (on) render(); });
  TX.on('dream', function () { if (on) render(); });
  TX.on('state', function (p) {
    var ch = (p && p.changed) || [];
    if (!on) return;
    if (ch.indexOf('concept') >= 0 || ch.indexOf('ghost') >= 0) paintMode();
    if (ch.indexOf('view') >= 0 && TX.state.view !== '3d') leave(true); // 다른 보기로 가면 관제 종료
  });
  TX.on('close', function () { if (on) leave(); });
  if (root()) mountBtn();

  TX.dash = { open: enter, close: leave, toggle: toggle, active: function () { return on; }, data: collect };
})();
