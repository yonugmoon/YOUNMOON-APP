/* ============================================================
   TwinX 68-fusion (통합 리드) — ADMIN 「설비 디지털 트윈」 화면 ↔ 2D·3D 뷰어 융합
   · 상단 탭에 「4. 입체 트윈」 추가 → 뷰어를 별도 전체화면이 아니라 ADMIN 도면 자리에 붙여(도킹) 표시
   · 「토폴로지 나란히」: 왼쪽 ADMIN 토폴로지 + 오른쪽 2D/3D 를 한 화면에
   · 동기화: 층 선택(ADMIN select ↔ 뷰어 층) · 설비 선택(ADMIN 설비 카드 ↔ 뷰어 선택 · ADMIN 우측 상세 패널)
   · 「크게 보기」: 도킹을 풀고 기존 전체화면 뷰어로 전환
   기존 도면 방식(ADMIN 토폴로지·라이저·실장도, 뷰어 2D CAD/3D)은 그대로 두고 배치만 바꿈
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.fusion) return;
  var U = TX.util;
  var MODE_KEY = 'twinx_fusion_mode_v1';
  var mode = 'full'; // 'full' = 도면 자리 전체 · 'side' = 토폴로지 나란히
  try { mode = localStorage.getItem(MODE_KEY) === 'side' ? 'side' : 'full'; } catch (e) { }
  var docked = false, host = null, guard = false, ro = null, lastSz = '';

  function panel() { return document.querySelector('.work-area > .canvas-panel'); }
  function heading() { var p = panel(); return p && p.querySelector(':scope > .panel-heading'); }
  function floorSel() { var p = panel(); return p && p.querySelector('select.floor-select'); }
  function txRoot() { return TX.ui && TX.ui.root; }

  /* ---------------- 탭 ---------------- */
  function ensureTab() {
    var h = heading(); if (!h) return;
    var tabs = h.querySelector('.dt-mode-tabs'); if (!tabs) return;
    if (!tabs.querySelector('[data-dtmode="twin"]')) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('data-dtmode', 'twin'); b.className = 'tx-fuse-tab' + (docked ? ' on' : '');
      b.title = '2D CAD · 3D 입체 · 분할 뷰어를 이 화면 안에서 보기 (층·설비 선택 연동)';
      b.textContent = '🧊 4. 입체 트윈';
      tabs.appendChild(b);
    }
    fitTabs(h, tabs);
    if (docked) {
      // React 재렌더로 호스트가 사라졌으면 다시 붙임
      if (!host || !document.contains(host)) mountHost();
      tabs.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-dtmode') === 'twin'); });
    }
  }
  /** 우측 상세 패널에 탭이 가려지면 짧은 이름으로 (전체 이름은 툴팁) */
  var SHORT = { cad: '🗺️ 1. 토폴로지', riser: '🏢 2. 라이저', shelf: '🗄️ 3. 랙 실장', twin: '🧊 4. 입체 트윈' };
  function rightLimit() {
    var d = document.querySelector('.work-area > .detail'), h = heading(); if (!h) return 0;
    var hr = h.getBoundingClientRect(), lim = hr.right;
    if (d) { var dr = d.getBoundingClientRect(); if (dr.width > 0 && dr.left > hr.left && dr.left < lim) lim = dr.left - 8; }
    return lim;
  }
  function hostRight() {
    var p = panel(), d = document.querySelector('.work-area > .detail'), pr = p.getBoundingClientRect(), lim = pr.right - 12;
    if (d) { var dr = d.getBoundingClientRect(); if (dr.width > 0 && dr.left > pr.left + 200 && dr.left < lim) lim = dr.left - 10; }
    return lim;
  }
  function fitTabs(h, tabs) {
    var bs = Array.prototype.slice.call(tabs.querySelectorAll('button[data-dtmode]'));
    bs.forEach(function (b) { if (!b.hasAttribute('data-full')) { b.setAttribute('data-full', b.textContent); if (!b.title) b.title = b.textContent.replace(/^\S+\s/, ''); } });
    var lim = rightLimit(), short = tabs.classList.contains('tx-tabs-short');
    if (!short) { var last = bs[bs.length - 1]; if (last && last.getBoundingClientRect().right > lim) { tabs.classList.add('tx-tabs-short'); bs.forEach(function (b) { var k = b.getAttribute('data-dtmode'); if (SHORT[k]) b.textContent = SHORT[k]; }); } }
    else if (tabs.scrollWidth + tabs.getBoundingClientRect().left + 260 < lim) { tabs.classList.remove('tx-tabs-short'); h.classList.remove('tx-entry-compact'); bs.forEach(function (b) { b.textContent = b.getAttribute('data-full'); }); }
    // 짧게 해도 가리면 「2D·3D 통합 뷰어」 버튼을 아이콘만 남김
    var lb = bs[bs.length - 1];
    if (tabs.classList.contains('tx-tabs-short') && lb && lb.getBoundingClientRect().right > rightLimit()) h.classList.add('tx-entry-compact');
  }
  window.addEventListener('resize', function () { var h = heading(), t = h && h.querySelector('.dt-mode-tabs'); if (t) fitTabs(h, t); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.dt-mode-tabs button[data-dtmode]');
    if (!b) return;
    var m = b.getAttribute('data-dtmode');
    if (m === 'twin') { if (!docked) dock(); }
    else if (docked) undock(true);
  }, true);

  /* ---------------- 도킹 ---------------- */
  function mountHost() {
    var p = panel(); if (!p) return false;
    if (!host) { host = U.el('div', 'tx-dock-host'); }
    if (host.parentNode !== p) p.appendChild(host);
    var r = txRoot(); if (r && r.parentNode !== host) host.appendChild(r);
    p.classList.add('tx-fused'); p.classList.toggle('tx-fused-side', mode === 'side');
    layout();
    if (!ro && window.ResizeObserver) {
      ro = new ResizeObserver(function () { layout(); });
    }
    if (ro) { ro.disconnect(); ro.observe(p); var h = heading(); if (h) ro.observe(h); var rt = txRoot(); if (rt) ro.observe(rt); }
    return true;
  }
  function layout() {
    var p = panel(), h = heading(); if (!p || !host || !docked) return;
    var pr = p.getBoundingClientRect(), hr = h ? h.getBoundingClientRect() : pr;
    var top = Math.max(0, hr.bottom - pr.top + 8), left = Math.max(0, hr.left - pr.left), width = Math.max(320, hostRight() - hr.left);
    var bottom = 12;
    // 좌측 ADMIN 요약 카드(등록·정상·주의·이상)가 도면 위에 떠 있으면 그 오른쪽부터 사용
    var mt = document.querySelector('main section.metrics');
    if (mt && mode !== 'side') {
      var mr = mt.getBoundingClientRect();
      if (mr.width > 0 && mr.right > pr.left + left && mr.left < pr.left + left + 40 && mr.bottom > pr.top + top) { var nl = mr.right - pr.left + 10; width -= nl - left; left = nl; }
    }
    if (mode === 'side') {
      var lw = Math.round(width * 0.5);
      var dw = p.querySelector('.drawing-wrap'); if (dw) { dw.style.width = (left + lw) + 'px'; dw.style.top = top + 'px'; }
      left += lw + 8; width -= lw + 8;
    } else { var d = p.querySelector('.drawing-wrap'); if (d) { d.style.width = ''; d.style.top = ''; } }
    host.style.top = top + 'px'; host.style.left = left + 'px'; host.style.width = width + 'px'; host.style.bottom = bottom + 'px';
    var rt = txRoot();
    if (rt) {
      var w = host.getBoundingClientRect().width;
      rt.classList.toggle('tx-cq-m', w < 1366); rt.classList.toggle('tx-cq-s', w < 1100); rt.classList.toggle('tx-cq-xs', w < 860);
    }
    var hr2 = host.getBoundingClientRect(), sz = Math.round(hr2.width) + 'x' + Math.round(hr2.height);
    if (sz !== lastSz) { lastSz = sz; window.dispatchEvent(new Event('resize')); }
  }
  function dock() {
    var sel = floorSel(), opts = { view: (TX.state.view === '2d' ? '3d' : TX.state.view) };
    if (sel && sel.value && TX.floor(sel.value)) opts.floor = sel.value;
    docked = true;
    if (!TX.state.open) TX.open(opts); else TX.setState(opts);
    var rt = txRoot(); if (!rt) { docked = false; return; }
    rt.classList.add('tx-docked');
    mountHost();
    // 도킹 중에는 ADMIN 페이지 스크롤을 막지 않음, 우측 상세는 ADMIN 상세 패널이 담당
    document.documentElement.style.overflow = ''; document.body.style.overflow = '';
    if (TX.state.panel && TX.state.panel.inspector) TX.setState({ panel: { inspector: false } });
    injectCtl();
    syncFromAdminSelection();
    setTimeout(layout, 60); setTimeout(layout, 400);
  }
  function undock(keepClosed) {
    if (!docked) return;
    docked = false;
    var p = panel(), rt = txRoot();
    if (p) { p.classList.remove('tx-fused', 'tx-fused-side'); var d = p.querySelector('.drawing-wrap'); if (d) { d.style.width = ''; d.style.top = ''; } }
    if (rt) { rt.classList.remove('tx-docked', 'tx-cq-m', 'tx-cq-s', 'tx-cq-xs'); document.body.appendChild(rt); var c = rt.querySelector('.tx-fuse-ctl'); if (c) c.remove(); }
    if (host) { host.remove(); }
    if (ro) ro.disconnect();
    if (keepClosed && TX.state.open) TX.close();
  }
  /** 도킹 해제 후 기존 전체화면 뷰어로 */
  function expand() {
    undock(false);
    var p = panel(); if (p) p.querySelectorAll('.dt-mode-tabs button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-dtmode') === 'cad'); });
    document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';
    window.dispatchEvent(new Event('resize'));
  }
  function setMode(m) {
    mode = m; try { localStorage.setItem(MODE_KEY, m); } catch (e) { }
    var p = panel(); if (p) p.classList.toggle('tx-fused-side', m === 'side');
    injectCtl(); layout();
  }
  /** 뷰어 툴바 오른쪽(닫기 앞)에 융합 전용 버튼 */
  function injectCtl() {
    var rt = txRoot(); if (!rt) return;
    var old = rt.querySelector('.tx-fuse-ctl'); if (old) old.remove();
    var close = rt.querySelector('.tx-close-btn'); if (!close) return;
    var c = U.el('div', 'tx-fuse-ctl',
      '<button type="button" data-fz="side" class="' + (mode === 'side' ? 'is-on' : '') + '" title="왼쪽 ADMIN 토폴로지 + 오른쪽 2D·3D">토폴로지 <span class="tx-fz-l">나란히</span></button>' +
      '<button type="button" data-fz="big" title="전체화면 뷰어로 크게 보기">⛶<span class="tx-fz-l"> 크게</span></button>');
    c.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fz]'); if (!b) return;
      if (b.getAttribute('data-fz') === 'side') setMode(mode === 'side' ? 'full' : 'side'); else expand();
    });
    close.parentNode.insertBefore(c, close);
  }

  /* ---------------- 동기화: 층 ---------------- */
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (guard || !t.matches || !t.matches('.canvas-panel select.floor-select')) return;
    if (TX.state.open && TX.floor(t.value) && TX.state.floor !== t.value) { guard = true; TX.setState({ floor: t.value }); guard = false; }
  }, true);
  TX.on('state', function (p) {
    var ch = (p && p.changed) || [];
    if (!docked || guard || ch.indexOf('floor') < 0) return;
    var sel = floorSel(), f = TX.state.floor;
    if (sel && f && sel.value !== f && Array.prototype.some.call(sel.options, function (o) { return o.value === f; })) {
      guard = true;
      var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, f); sel.dispatchEvent(new Event('change', { bubbles: true }));
      guard = false;
    }
  });

  /* ---------------- 동기화: 설비 선택 ---------------- */
  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.\-]{1,40}$/;
  function cardId(g) {
    var ts = g.querySelectorAll('text');
    for (var i = 0; i < ts.length; i++) { var v = (ts[i].textContent || '').trim(); if (ID_RE.test(v) && TX.asset(v)) return v; }
    return null;
  }
  function findCard(id) {
    var p = panel(); if (!p) return null;
    var gs = p.querySelectorAll('.drawing-scroll g.equipment');
    for (var i = 0; i < gs.length; i++) if (cardId(gs[i]) === id) return gs[i];
    return null;
  }
  function markCard(id) {
    var p = panel(); if (!p) return;
    p.querySelectorAll('g.equipment.tx-fuse-sel').forEach(function (g) { g.classList.remove('tx-fuse-sel'); });
    var g = id && findCard(id); if (g) g.classList.add('tx-fuse-sel');
  }
  // ADMIN 설비 카드 클릭 → 뷰어 선택 (탭 1에서 고른 설비가 탭 4로 넘어가도 유지)
  document.addEventListener('click', function (e) {
    if (guard || !e.isTrusted) return;
    var g = e.target.closest && e.target.closest('.canvas-panel .drawing-scroll g.equipment'); if (!g) return;
    var id = cardId(g); if (!id) return;
    guard = true; try { TX.select(id); } finally { guard = false; }
    markCard(id);
  }, true);
  // 뷰어에서 설비 선택 → ADMIN 카드 클릭(우측 상세 패널 갱신)
  TX.on('select', function (p) {
    // 도킹 중 설비 상세는 ADMIN 우측 상세 패널이 담당 → 뷰어 인스펙터는 접어 둠
    if (docked) setTimeout(function () { if (docked && TX.state.panel && TX.state.panel.inspector) TX.setState({ panel: { inspector: false } }); }, 0);
    var id = p && (p.id || p.asset || (typeof p === 'string' ? p : null));
    if (id == null) id = TX.state.selected;
    markCard(id);
    if (!docked || guard || !id) return;
    var a = TX.asset(id); if (!a) return;
    var sel = floorSel();
    var tries = 0;
    var go = function () {
      var g = findCard(id); if (!g) { if (++tries < 8) setTimeout(go, 120); return; }
      var cur = document.querySelector('.work-area > .detail .detail-status .mono');
      if (cur && cur.textContent.trim() === id) { markCard(id); return; }
      guard = true;
      try { g.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } finally { guard = false; }
      markCard(id);
    };
    if (sel && a.floor && sel.value !== a.floor && Array.prototype.some.call(sel.options, function (o) { return o.value === a.floor; })) {
      guard = true;
      var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, a.floor); sel.dispatchEvent(new Event('change', { bubbles: true }));
      guard = false;
      setTimeout(go, 120);
    } else go();
  });
  function syncFromAdminSelection() {
    // ADMIN 상세 패널에 열린 설비가 있으면 뷰어도 같은 설비 선택
    var idEl = document.querySelector('.work-area > .detail .detail-status .mono');
    var id = idEl && idEl.textContent.trim();
    if (id && TX.asset(id) && TX.state.selected !== id) { guard = true; try { TX.select(id); } finally { guard = false; } }
  }

  /* ---------------- 수명주기 ---------------- */
  TX.on('close', function () {
    if (!docked) return;
    // 뷰어 ✕/ESC → 도킹 해제 후 탭 1 토폴로지로 복귀
    undock(false);
    var b = document.querySelector('.dt-mode-tabs button[data-dtmode="cad"]'); if (b) b.click();
  });
  TX.on('ui-ready', function () { if (docked) { mountHost(); injectCtl(); } });
  TX.on('model', function () { if (docked) setTimeout(function () { markCard(TX.state.selected); }, 50); });
  // 사이드바에서 다른 메뉴로 이동하면(캔버스 패널 사라짐) 도킹 해제
  setInterval(function () {
    try {
      ensureTab();
      if (docked && !panel()) undock(true);
      else if (docked) layout();
    } catch (e) { }
  }, 1500);
  var q = false;
  function sched() { if (q) return; q = true; requestAnimationFrame(function () { q = false; try { ensureTab(); } catch (e) { } }); }
  function init() { var r = document.getElementById('root'); if (r && window.MutationObserver) new MutationObserver(sched).observe(r, { childList: true, subtree: true }); sched(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  TX.fusion = { dock: dock, undock: undock, expand: expand, setMode: setMode, docked: function () { return docked; }, mode: function () { return mode; } };
})();
