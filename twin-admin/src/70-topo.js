/* ============================================================
   TwinX 70-topo (통합 리드) — 순수 계통도 보기 (보기 전환: 2D CAD | 3D | 분할 | 계통도)
   · 도면 배경 없이 설비·묶음(랙)·연결(회선) · 상하위 관계만 표시 — 공간 위치(2D·3D)와 역할 분리
   · 층별 가로 띠(위=상층) × 상위→하위 단계(왼쪽→오른쪽) 자동 정렬
   · 노드 끌기 = 계통도 화면 배치만 변경 (localStorage 'twinx_topo_layout_v1'), 실제 설치 좌표에는 영향 없음
   · 노드 선택 = 같은 설비가 2D·3D·인스펙터에서도 선택 (공통 설비 데이터)
   · 연결 추가·삭제: 간이 현행화 초안이면 즉시 반영, ADMIN 자료면 「변경 대기」 후 ADMIN 검증·적용으로 반영
   · 논리 연결(이 화면)과 실제 케이블 포설 경로(구조 편집 트레이)는 별개 정보
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.topo) return;
  var U = TX.util, esc = U.esc, C = TX.C;
  var LKEY = 'twinx_topo_layout_v1';
  function toast(m, k) { TX.emit('toast', { msg: m, kind: k || 'info' }); }
  function lay() { try { return JSON.parse(localStorage.getItem(LKEY) || '{}') || {}; } catch (e) { return {}; } }
  function laySave(o) { try { localStorage.setItem(LKEY, JSON.stringify(o)); } catch (e) { } }
  var GC = { RED: '#f43f5e', ORANGE: '#f59e0b', YELLOW: '#eab308', GREEN: '#10b981', NONE: '#94a3b8' };
  var LTYPES = [['optical', '광', '광'], ['data', 'UTP', 'UTP'], ['power', '전원', '전원'], ['ground', '접지', '접지']];
  function lcol(t) { return C && C.LINK && C.LINK[t] ? C.LINK[t].css : '#64748b'; }

  var pane = null, svg = null, bar = null, view = { x: 40, y: 20, k: 1 }, pend = { add: [], del: {} }, mode = null, from = null, selLink = null, nodes = {}, drag = null;
  function quickOn() { return TX.quick && TX.quick.active && TX.quick.active(); }

  function mount() {
    var views = TX.ui && TX.ui.root && TX.ui.root.querySelector('.tx-views'); if (!views || pane) return;
    pane = U.el('div', 'tx-pane tx-pane-topo'); pane.setAttribute('role', 'region'); pane.setAttribute('aria-label', '계통도');
    bar = U.el('div', 'tx-tp-bar'); pane.appendChild(bar);
    svg = U.svg('svg', { class: 'tx-tp-svg' }); pane.appendChild(svg);
    views.appendChild(pane);
    bind();
  }
  /* ---------- 자동 배치: 층 띠 × 상하위 단계 ---------- */
  function units() {
    var M = TX.model; if (!M) return [];
    return M.assets.filter(function (a) { return !a.bundle || a.bundle.lead === a.id; }).map(function (a) { return a.bundle && TX.bundleView ? TX.bundleView(a) : a; });
  }
  function nid(id) { return TX.bundleLead ? TX.bundleLead(id) : id; }
  function links() {
    var M = TX.model; if (!M) return [];
    var out = M.links.map(function (l) { return { id: l.id, from: nid(l.from), to: nid(l.to), type: l.type, cable: l.cable, ofrom: l.from, oto: l.to, del: !!pend.del[l.id] }; });
    pend.add.forEach(function (l, i) { out.push({ id: 'NEW' + i, from: nid(l.from), to: nid(l.to), type: l.type, cable: '', pending: true }); });
    return out.filter(function (l) { return l.from !== l.to; });
  }
  var NW = 176, NH = 48, GX = 70, GY = 18, LANE_PAD = 34;
  function layout() {
    var M = TX.model, us = units(), L = links(), saved = lay();
    var floors = M.floors.slice().sort(function (a, b) { return b.level - a.level; });
    var inc = {}, out = {}; L.forEach(function (l) { inc[l.to] = (inc[l.to] || 0) + 1; (out[l.from] = out[l.from] || []).push(l.to); });
    var depth = {}, q = us.filter(function (a) { return !inc[a.id]; }).map(function (a) { depth[a.id] = 0; return a.id; });
    while (q.length) { var c = q.shift(); (out[c] || []).forEach(function (t) { if (depth[t] == null || depth[t] < depth[c] + 1) { if (depth[c] + 1 < 12) { depth[t] = depth[c] + 1; q.push(t); } } }); }
    us.forEach(function (a) { if (depth[a.id] == null) depth[a.id] = 0; });
    nodes = {}; var y = 10, lanes = [];
    floors.forEach(function (f) {
      var list = us.filter(function (a) { return a.floor === f.code; }); if (!list.length) return;
      var cols = {}; list.forEach(function (a) { (cols[depth[a.id]] = cols[depth[a.id]] || []).push(a); });
      var maxRows = 0; Object.keys(cols).forEach(function (k) { cols[k].sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }); maxRows = Math.max(maxRows, cols[k].length); });
      var h = LANE_PAD + maxRows * (NH + GY) + 10;
      lanes.push({ f: f, y: y, h: h });
      Object.keys(cols).forEach(function (k) { cols[k].forEach(function (a, i) { var p = saved[a.id]; nodes[a.id] = { a: a, x: p ? p[0] : 150 + (+k) * (NW + GX), y: p ? p[1] : y + LANE_PAD + i * (NH + GY), manual: !!p }; }); });
      y += h + 14;
    });
    return { lanes: lanes, L: L, H: y };
  }
  function render() {
    if (!pane || TX.state.view !== 'topo' || !TX.model) return;
    var M = TX.model, lo = layout(), sel = nid(TX.state.selected), o = [];
    var W = 160 + Math.max(4, Object.keys(nodes).reduce(function (m, k) { return Math.max(m, nodes[k].x); }, 0)) + NW + 60;
    o.push('<g transform="translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')">');
    lo.lanes.forEach(function (ln, i) {
      o.push('<rect x="0" y="' + ln.y + '" width="' + W + '" height="' + ln.h + '" rx="10" fill="' + (i % 2 ? '#0f1b2d' : '#0c1626') + '" stroke="#1e3a5f"/>' +
        '<text x="14" y="' + (ln.y + 22) + '" class="tx-tp-lane">' + esc((ln.f.building ? ln.f.building + ' ' : '') + (ln.f.name || ln.f.code)) + '</text>');
    });
    lo.L.forEach(function (l) {
      var a = nodes[l.from], b = nodes[l.to]; if (!a || !b) return;
      var x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2;
      if (x2 < x1 - 10) { x1 = a.x; x2 = b.x + NW; }
      var mx = (x1 + x2) / 2, d = 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2;
      var on = selLink === l.id, hot = sel && (l.from === sel || l.to === sel);
      o.push('<path d="' + d + '" class="tx-tp-hit" data-l="' + esc(l.id) + '"/>' +
        '<path d="' + d + '" fill="none" stroke="' + (l.del ? '#f43f5e' : lcol(l.type)) + '" stroke-width="' + (on || hot ? 3 : 1.8) + '" stroke-opacity="' + (l.del ? 0.5 : on || hot ? 1 : 0.75) + '"' + (l.pending || l.del ? ' stroke-dasharray="6 4"' : '') + ' pointer-events="none"/>' +
        '<circle cx="' + x2 + '" cy="' + y2 + '" r="3" fill="' + lcol(l.type) + '" pointer-events="none"/>');
      if (l.cable && view.k > 0.7) o.push('<text x="' + mx + '" y="' + ((y1 + y2) / 2 - 4) + '" class="tx-tp-cab">' + esc(l.cable) + '</text>');
    });
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id], a = n.a, g = a.grade || 'NONE', isSel = id === sel, isFrom = from === id;
      var room = TX.room(a.room), sub = a.bundleLabel ? a.bundleLabel + ' · ' + (room ? room.name : '') : (a.id + (a.model ? ' · ' + a.model : ''));
      o.push('<g class="tx-tp-node' + (isSel ? ' is-sel' : '') + (isFrom ? ' is-from' : '') + (a.unplaced ? ' is-unplaced' : '') + '" data-n="' + esc(id) + '" transform="translate(' + n.x + ' ' + n.y + ')">' +
        '<rect width="' + NW + '" height="' + NH + '" rx="7" class="tx-tp-box"/><rect width="5" height="' + NH + '" rx="2" fill="' + GC[g] + '"/>' +
        '<text x="13" y="19" class="tx-tp-name">' + esc((a.bundleLabel ? '▣ ' : '') + String(a.name).slice(0, 18)) + '</text>' +
        '<text x="13" y="36" class="tx-tp-sub">' + esc(String(sub).slice(0, 30)) + '</text>' +
        (a.unplaced ? '<text x="' + (NW - 8) + '" y="16" text-anchor="end" class="tx-tp-un">미배치</text>' : '') +
        '<circle cx="' + (NW - 10) + '" cy="' + (NH - 10) + '" r="4" fill="' + GC[g] + '"/></g>');
    });
    o.push('</g>');
    svg.innerHTML = o.join('');
    paintBar();
  }
  function paintBar() {
    var n = pend.add.length + Object.keys(pend.del).length, q = quickOn();
    bar.innerHTML = '<b>계통도</b><span class="tx-tp-hint">' + (mode === 'add' ? (from ? '② 도착 설비를 누르세요' : '① 출발(상위) 설비를 누르세요') : '설비 구성·연결 관계 · 노드를 끌면 화면 배치만 바뀝니다(설치 위치 영향 없음)') + '</span>' +
      '<span class="tx-tp-sp"></span>' +
      (mode === 'add' ? '<select data-t="ltype">' + LTYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select><button type="button" data-t="cancel">취소</button>'
        : '<button type="button" data-t="add">＋ 연결 추가</button>') +
      '<button type="button" data-t="del"' + (selLink ? '' : ' disabled') + '>선택 연결 삭제</button>' +
      '<button type="button" data-t="auto">자동 정렬</button><button type="button" data-t="fit">화면 맞춤</button><button type="button" data-t="svg">SVG</button>' +
      (!q ? '<button type="button" data-t="push" class="is-pri"' + (n ? '' : ' disabled') + '>변경 ADMIN 반영' + (n ? ' (' + n + ')' : '') + '</button>' : '<em>초안 · 즉시 반영</em>');
  }
  function fit() {
    if (!pane) return;
    var ks = Object.keys(nodes); if (!ks.length) return;
    var x1 = 0, y1 = 0; ks.forEach(function (k) { x1 = Math.max(x1, nodes[k].x + NW); y1 = Math.max(y1, nodes[k].y + NH); });
    var r = pane.getBoundingClientRect(), k = Math.min(1.4, Math.max(0.3, Math.min((r.width - 40) / (x1 + 40), (r.height - 70) / (y1 + 30))));
    view = { x: 20, y: 50, k: k }; render();
  }
  function bind() {
    var pt = function (e) { var r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; };
    svg.addEventListener('wheel', function (e) { e.preventDefault(); var r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k2 = U.clamp(view.k * (e.deltaY < 0 ? 1.12 : 0.89), 0.25, 2.5); view.x = mx - (mx - view.x) * k2 / view.k; view.y = my - (my - view.y) * k2 / view.k; view.k = k2; render(); }, { passive: false });
    svg.addEventListener('pointerdown', function (e) {
      var n = e.target.closest('[data-n]'), l = e.target.closest('[data-l]');
      if (n) { var id = n.getAttribute('data-n'), p = pt(e); drag = { id: id, dx: p.x - nodes[id].x, dy: p.y - nodes[id].y, moved: false, sx: e.clientX, sy: e.clientY }; svg.setPointerCapture(e.pointerId); return; }
      if (l) { selLink = l.getAttribute('data-l'); render(); return; }
      drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (drag.pan) { view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; render(); return; }
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
      if (!drag.moved) return;
      var p = pt(e); nodes[drag.id].x = Math.round((p.x - drag.dx) / 10) * 10; nodes[drag.id].y = Math.round((p.y - drag.dy) / 10) * 10;
      var o = lay(); o[drag.id] = [nodes[drag.id].x, nodes[drag.id].y]; laySave(o); render();
    });
    svg.addEventListener('pointerup', function () {
      if (!drag) return; var d = drag; drag = null;
      if (d.pan) { if (Math.abs(view.x - d.vx) + Math.abs(view.y - d.vy) < 3) { selLink = null; render(); } return; }
      if (d.moved) return;
      if (mode === 'add') { if (!from) { from = d.id; render(); } else if (from !== d.id) addLink(from, d.id); return; }
      selLink = null; TX.select(d.id);
    });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-t]'); if (!b || b.tagName === 'SELECT') return;
      var k = b.getAttribute('data-t');
      if (k === 'add') { mode = 'add'; from = null; render(); }
      else if (k === 'cancel') { mode = null; from = null; render(); }
      else if (k === 'del' && selLink) delLink(selLink);
      else if (k === 'auto') { if (confirm('계통도 노드 배치를 자동 정렬로 되돌릴까요? (설치 위치에는 영향 없음)')) { laySave({}); render(); fit(); } }
      else if (k === 'fit') fit();
      else if (k === 'svg') { var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + svg.clientWidth + '" height="' + svg.clientHeight + '" style="background:#06101f;font-family:Arial,sans-serif"><style>' + EXPORT_CSS + '</style>' + svg.innerHTML + '</svg>'; U.download(new Blob([s], { type: 'image/svg+xml' }), 'ICT_Twin_계통도_' + U.today() + '.svg'); }
      else if (k === 'push') pushAdmin();
    });
  }
  var EXPORT_CSS = '.tx-tp-box{fill:#0b1220;stroke:#334155}.tx-tp-name{fill:#f1f5f9;font-size:12px;font-weight:700}.tx-tp-sub{fill:#94a3b8;font-size:10px}.tx-tp-lane{fill:#93c5fd;font-size:12px;font-weight:700}.tx-tp-cab{fill:#64748b;font-size:9px;text-anchor:middle}.tx-tp-hit{fill:none;stroke:transparent}.tx-tp-un{fill:#f59e0b;font-size:9px}';
  function typeSel() { var s = bar.querySelector('[data-t="ltype"]'); return s ? s.value : 'optical'; }
  function addLink(a, b) {
    var t = typeSel(); mode = null; from = null;
    var M = TX.model, A = TX.asset(a), B = TX.asset(b);
    if (M.links.some(function (l) { return nid(l.from) === a && nid(l.to) === b; }) || pend.add.some(function (l) { return l.from === a && l.to === b; })) { toast('이미 있는 연결입니다', 'warn'); render(); return; }
    if (quickOn()) {
      var D = TX.quick.draft(), k = 1; while (D.links.some(function (l) { return l.id === 'L' + String(k).padStart(3, '0'); })) k++;
      D.links.push({ id: 'L' + String(k).padStart(3, '0'), from: a, to: b, type: t, auto: false }); TX.quick._.save(); TX.quick._.apply();
      toast('연결 추가 (초안 저장됨): ' + (A ? A.name : a) + ' → ' + (B ? B.name : b), 'success');
    } else { pend.add.push({ from: a, to: b, type: t }); toast('연결 추가 대기 · 「변경 ADMIN 반영」을 누르면 ADMIN 검증 후 적용됩니다', 'info'); }
    render();
  }
  function delLink(id) {
    if (/^NEW\d+$/.test(id)) { pend.add.splice(+id.slice(3), 1); selLink = null; render(); return; }
    if (quickOn()) { var D = TX.quick.draft(); D.links = D.links.filter(function (l) { return l.id !== id; }); TX.quick._.save(); TX.quick._.apply(); toast('연결 삭제 (초안 저장됨)', 'success'); }
    else { if (pend.del[id]) delete pend.del[id]; else pend.del[id] = 1; toast(pend.del[id] ? '연결 삭제 대기 · 「변경 ADMIN 반영」으로 적용' : '삭제 대기 취소', 'info'); }
    selLink = null; render();
  }
  function pushAdmin() {
    var sync = TX.adminSync, t = sync && sync.raw(); if (!t) { toast('ADMIN 자료를 읽지 못했습니다', 'error'); return; }
    var nameOf = { optical: '광', data: 'UTP', power: '전원', ground: '접지' }, ids = {}; t.links.forEach(function (l) { ids[String(l.연결ID)] = 1; });
    var nDel = Object.keys(pend.del).length, nAdd = pend.add.length;
    t.links = t.links.filter(function (l) { return !pend.del[String(l.연결ID)]; });
    pend.add.forEach(function (l, i) { var id = 'L' + Date.now().toString(36).toUpperCase() + i; t.links.push({ 연결ID: id, 출발설비ID: l.from, 도착설비ID: l.to, 연결유형: nameOf[l.type] || '광', 케이블번호: '', 출발단자: '', 도착단자: '', 연결상태: '정상' }); });
    if (!confirm('계통도 변경을 ADMIN에 반영합니다.\n연결 추가 ' + nAdd + ' · 삭제 ' + nDel + '\n실행 전 복원용 백업을 저장합니다. 계속할까요?')) return;
    sync.backup('계통도 변경 반영 전').then(function () { pend = { add: [], del: {} }; sync.push(t, '계통도 변경(추가 ' + nAdd + ' · 삭제 ' + nDel + ')을 ADMIN에 전달했습니다 · 「전체 교체 적용」을 누르면 반영됩니다'); });
  }

  /* ---------- 보기 전환 연동 ---------- */
  TX.on('ui-ready', function () { mount(); });
  TX.on('open', function () { mount(); setTimeout(function () { if (TX.state.view === 'topo') { render(); fit(); } }, 60); });
  TX.on('state', function (p) { var ch = (p && p.changed) || []; if (ch.indexOf('view') >= 0 && TX.state.view === 'topo') { mount(); render(); if (!svg.childNodes.length || view.k === 1) fit(); } else if (TX.state.view === 'topo' && (ch.indexOf('selected') >= 0)) render(); });
  TX.on('model', function () { if (TX.state.view === 'topo') render(); });
  TX.on('resize', function () { if (TX.state.view === 'topo') render(); });
  if (TX.ui && TX.ui.root) mount();

  TX.topo = { render: render, fit: fit, pending: function () { return pend; }, nodes: function () { return nodes; }, push: pushAdmin };
})();
