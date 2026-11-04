/* ============================================================
   TwinX T2 · UX·레이아웃 셸 (20-shell.js)
   - 전체화면 오버레이: 툴바(≤52px) · 뷰포트(전 영역) · 상태바(≤28px)
   - 뷰포트 위에 떠 있는 접이식 패널: 층 레일(좌) · 인스펙터 서랍(우) · 범례(좌하)
   - 컨트롤은 툴바 그룹 팝오버로 접어 도면이 화면의 대부분을 차지하게 함
   - TwinX.ui / TwinX.shell 제공, 'ui-ready' · 'resize' 발행
   - ADMIN 「디지털 트윈」 화면에 진입 버튼 주입 + Shift+T
   상태 변경은 오직 TwinX.setState / TwinX.select 로만 합니다.
   ============================================================ */
(function () {
  'use strict';
  var TwinX = window.TwinX;
  if (!TwinX || TwinX.shell) return;

  var C = TwinX.C, U = TwinX.util, esc = U.esc;
  var GORDER = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'NONE'];
  var SPLIT_KEY = 'twinx_split_v1';
  var MQ_MOBILE = '(max-width: 759px)';

  /* ---------------- 아이콘 (인라인 SVG, 24 그리드, stroke=currentColor) ---------------- */
  var P = {
    cube: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
    map: '<path d="M3 6.5 9 3.5l6 3 6-3v14l-6 3-6-3-6 3z"/><path d="M9 3.5v14M15 6.5v14"/>',
    split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    wand: '<path d="m3 21 10-10"/><path d="M15 3v2M15 11v2M11 7h2M17 7h2M18.5 3.5 17 5M13 5l-1.5-1.5"/><path d="M18 14v2M17 15h2M6 3v2M5 4h2"/>',
    building: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M3 21h18M8 8h3M8 12h3M8 16h3"/>',
    layers: '<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
    camera: '<path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="3.5"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    max: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    min: '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    iso: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12 4 7.5"/>',
    front: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 15h16M9 15v4M15 15v4"/>',
    top: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 11h9v9M13 4v7"/>',
    reset: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
    focus: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    tray: '<path d="M3 8h18M3 16h18M6 8v8M10 8v8M14 8v8M18 8v8"/>',
    links: '<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="5.5" r="2.2"/><circle cx="19" cy="18.5" r="2.2"/><path d="m7 11 10-4.5M7 13l10 4.5"/>',
    thermo: '<path d="M14 14.8V4.5a2 2 0 0 0-4 0v10.3a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
    ground: '<path d="M12 3v9M5 12h14M8 16h8M10.5 20h3"/>',
    clip: '<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    stack: '<path d="m12 2.5 9 4.5-9 4.5L3 7z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
    ghost: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    riser: '<path d="M12 2v20"/><path d="M7 6h10M7 12h10M7 18h10"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    walk: '<circle cx="13" cy="4" r="2"/><path d="m8 21 3-7 3 3v4M7 11l3-3.5 4 1.5 2.5 3M11 14l-1.5-3"/>',
    spread: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    rack: '<rect x="5" y="2.5" width="14" height="19" rx="1.5"/><path d="M8 6.5h8M8 10.5h8M8 14.5h8M8 18.5h2"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
    video: '<path d="m22 8-6 4 6 4z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h4M7 12h10M7 16h6"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    legend: '<path d="M4 6h.01M4 12h.01M4 18h.01M8 6h12M8 12h12M8 18h12"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'
  };
  function ic(name, size) {
    return '<svg class="tx-ic" width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[name] || P.box) + '</svg>';
  }
  var KIND_IC = { rack: 'rack', server: 'rack', power: 'zap', ap: 'wifi', cctv: 'video', video: 'video', ground: 'ground', tray: 'tray', panel: 'panel' };
  var KIND_NAME = { rack: '랙·함체', server: '서버', power: '전원', ap: '무선 AP', cctv: 'CCTV', video: '영상', ground: '접지', tray: '트레이', panel: '분전·단자반' };

  /* ---------------- 시안 정의 (썸네일 SVG = 예전 화면 시안 카드 축소판) ---------------- */
  var CONCEPTS = [
    { k: 'A', t: '다층 적층 · 돌하우스', d: '전층 슬래브 분리 + 수직 라이저 관통',
      svg: '<rect width="120" height="66" fill="#0b1628"/>' +
        [0, 1, 2].map(function (i) { var y = 14 + i * 15; return '<path d="M24 ' + (y + 8) + ' L60 ' + y + ' L96 ' + (y + 8) + ' L60 ' + (y + 16) + 'Z" fill="' + ['#1e3a5f', '#21466f', '#285487'][i] + '" stroke="#7dd3fc" stroke-width=".8" opacity="' + (i === 1 ? 1 : .65) + '"/>'; }).join('') +
        '<path d="M48 12v42" stroke="#a78bfa" stroke-width="1.6"/><path d="M72 12v42" stroke="#22d3ee" stroke-width="1.6" stroke-dasharray="2 2"/>' +
        '<circle cx="66" cy="38" r="2.4" fill="#f43f5e"/><circle cx="54" cy="24" r="2" fill="#10b981"/>' },
    { k: 'B', t: '룸 · 랙 투시', d: '아이소메트릭 컷어웨이 + 42U 랙 슬롯',
      svg: '<rect width="120" height="66" fill="#0b1628"/>' +
        '<path d="M22 40 L60 22 L98 40 L60 58Z" fill="#1c3352" stroke="#64748b" stroke-width=".8"/>' +
        '<path d="M22 40 V24 L60 6 V22Z" fill="#16294a" stroke="#64748b" stroke-width=".8"/><path d="M60 22 V6 L98 24 V40Z" fill="#1a2f54" stroke="#64748b" stroke-width=".8"/>' +
        [0, 1, 2].map(function (i) { var x = 44 + i * 11, y = 30 + i * 5; return '<path d="M' + x + ' ' + y + 'v-15l6-3v15z" fill="#0f172a" stroke="#38bdf8" stroke-width=".8"/>' +
          [0, 1, 2, 3].map(function (j) { return '<path d="M' + (x + 1) + ' ' + (y - 3 - j * 3.4) + 'l4-2" stroke="' + (i === 2 && j === 1 ? '#f43f5e' : '#10b981') + '" stroke-width="1"/>'; }).join(''); }).join('') },
    { k: 'C', t: '홀로그램 계통', d: '광·전원 계통 토폴로지 + 흐름 표시',
      svg: '<rect width="120" height="66" fill="#071022"/>' +
        '<g stroke-width="1.2" fill="none"><path d="M60 14 L30 40 M60 14 L60 46 M60 14 L92 38" stroke="#a78bfa"/><path d="M30 40 L18 56 M30 40 L42 56 M92 38 L104 54" stroke="#22d3ee"/><path d="M60 46 L76 58" stroke="#f43f5e" stroke-dasharray="2 2"/></g>' +
        [[60, 14, 4, '#e0f2fe'], [30, 40, 3, '#22d3ee'], [60, 46, 3, '#22d3ee'], [92, 38, 3, '#22d3ee'], [18, 56, 2, '#67e8f9'], [42, 56, 2, '#67e8f9'], [104, 54, 2, '#67e8f9'], [76, 58, 2.4, '#f43f5e']].map(function (n) {
          return '<circle cx="' + n[0] + '" cy="' + n[1] + '" r="' + (n[2] + 3) + '" fill="' + n[3] + '" opacity=".18"/><circle cx="' + n[0] + '" cy="' + n[1] + '" r="' + n[2] + '" fill="' + n[3] + '"/>'; }).join('') },
    { k: 'D', t: '열화상 · 위험기둥', d: 'ΔT 열화상 돔 + 위험 점수 기둥',
      svg: '<defs><radialGradient id="tx-th-g" cx="50%" cy="70%" r="55%"><stop offset="0" stop-color="#f43f5e" stop-opacity=".95"/><stop offset=".45" stop-color="#f97316" stop-opacity=".6"/><stop offset=".8" stop-color="#eab308" stop-opacity=".2"/><stop offset="1" stop-color="#eab308" stop-opacity="0"/></radialGradient></defs>' +
        '<rect width="120" height="66" fill="#0b1628"/><path d="M14 48 L60 32 L106 48 L60 64Z" fill="#14253f" stroke="#334155" stroke-width=".8"/>' +
        '<ellipse cx="46" cy="44" rx="26" ry="14" fill="url(#tx-th-g)"/>' +
        [[74, 46, 26, '#f43f5e'], [86, 50, 14, '#f97316'], [62, 54, 9, '#10b981'], [32, 52, 6, '#10b981']].map(function (b) {
          return '<rect x="' + (b[0] - 3) + '" y="' + (b[1] - b[2]) + '" width="6" height="' + b[2] + '" rx="1" fill="' + b[3] + '" opacity=".9"/>'; }).join('') }
  ];

  /* ---------------- 내부 상태 ---------------- */
  var ui = null;                // TwinX.ui
  var R = {};                   // DOM 참조
  var built = false, openPop = null, lastFocus = null;
  var split = 0.5;
  try { var sv = parseFloat(localStorage.getItem(SPLIT_KEY)); if (sv >= 0.15 && sv <= 0.85) split = sv; } catch (e) { }
  var scrollLock = null;
  var lastInspSig = '';

  function S() { return TwinX.state; }
  function M() { return TwinX.model; }
  function isMobile() { return window.matchMedia && window.matchMedia(MQ_MOBILE).matches; }
  function gradeOf(a) { return a && C.GRADE[a.grade] ? a.grade : 'NONE'; }
  function gcss(g) { return (C.GRADE[g] || C.GRADE.NONE).css; }
  function worstOf(list) {
    var best = 4;
    list.forEach(function (a) { var i = GORDER.indexOf(gradeOf(a)); if (i >= 0 && i < best) best = i; });
    return list.length ? GORDER[best] : 'NONE';
  }
  function floorShort(f) {
    if (!f) return '—';
    if (typeof f.level === 'number' && f.level !== 0) return f.level > 0 ? f.level + 'F' : 'B' + (-f.level);
    return f.name || f.code;
  }
  function floorName(code) { var f = TwinX.floor(code); return f ? (f.name || floorShort(f)) : (code || '—'); }
  function scopeAssets() {
    var m = M(); if (!m) return [];
    return S().stack ? m.assets : TwinX.assetsOf(S().floor);
  }
  function countGrades(list) {
    var c = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0, NONE: 0 };
    list.forEach(function (a) { c[gradeOf(a)]++; });
    return c;
  }
  function roomName(id) { var r = id && TwinX.room(id); return r ? r.name : ''; }

  /* ---------------- resize 발행 (디바운스 100ms) ---------------- */
  var emitResize = U.debounce(function () {
    if (!ui || !S().open) return;
    var r2 = R.view2d.getBoundingClientRect(), r3 = R.view3d.getBoundingClientRect();
    TwinX.emit('resize', { view: S().view, size2d: { w: Math.round(r2.width), h: Math.round(r2.height) }, size3d: { w: Math.round(r3.width), h: Math.round(r3.height) } });
  }, 100);

  /* ============================================================
     DOM 생성 (최초 1회)
     ============================================================ */
  function segHTML(cls) {
    return '<div class="tx-seg ' + (cls || '') + '" role="group" aria-label="보기 전환">' +
      '<button type="button" class="tx-seg-btn" data-set="view:2d" title="2D CAD 도면 (1)">' + ic('map', 16) + '<span class="tx-lbl-full">2D CAD</span><span class="tx-lbl-short">2D</span></button>' +
      '<button type="button" class="tx-seg-btn" data-set="view:3d" title="3D 입체 (2)">' + ic('cube', 16) + '<span>3D</span></button>' +
      '<button type="button" class="tx-seg-btn" data-set="view:split" title="2D+3D 분할 (3)">' + ic('split', 16) + '<span>분할</span></button>' +
      '</div>';
  }
  function tbtn(pop, icon, label, title) {
    return '<button type="button" class="tx-tbtn" data-pop="' + pop + '" aria-haspopup="dialog" aria-expanded="false" aria-controls="tx-pop-' + pop + '" title="' + esc(title) + '">' +
      ic(icon, 17) + '<span class="tx-tbtn-lbl" data-lbl="' + pop + '">' + esc(label) + '</span>' + ic('down', 13).replace('tx-ic', 'tx-ic tx-caret') + '</button>';
  }

  /* 팝오버/시트 공용 본문 */
  function bodyConcept() {
    return '<div class="tx-concepts">' + CONCEPTS.map(function (c) {
      return '<button type="button" class="tx-concept" data-set="concept:' + c.k + '" aria-label="시안 ' + c.k + ' ' + esc(c.t) + '">' +
        '<svg class="tx-concept-thumb" viewBox="0 0 120 66" aria-hidden="true">' + c.svg + '</svg>' +
        '<span class="tx-concept-meta"><b><i>' + c.k + '</i>' + esc(c.t) + '</b><small>' + esc(c.d) + '</small></span></button>';
    }).join('') + '</div><p class="tx-pop-note">' + ic('info', 13) + '3D 보기에서 표현 방식을 전환합니다. 2D 보기 중이면 3D로 바뀝니다.</p>';
  }
  function swRow(key, icon, label, sub) {
    return '<button type="button" class="tx-sw" data-toggle="' + key + '" role="switch">' +
      '<span class="tx-sw-ic">' + ic(icon, 16) + '</span><span class="tx-sw-txt"><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span><span class="tx-sw-track"><span></span></span></button>';
  }
  function bodyDoll() {
    return '<div class="tx-sw-list">' +
      swRow('stack', 'stack', '전층 적층', '모든 층을 위아래로 쌓아 보기') +
      swRow('ghost', 'ghost', '비선택 층 고스트', '현재 층 외 반투명') +
      swRow('riser', 'riser', '수직 라이저', 'TPS·EPS 층간 간선') +
      swRow('labels', 'tag', '실·설비 라벨', '') +
      swRow('walk', 'walk', '1인칭 워크스루', 'WASD/방향키 이동 · Esc 해제') +
      '</div><label class="tx-range"><span class="tx-range-head">' + ic('spread', 16) + '<b>층간격</b><output data-out="explode">1.5×</output></span>' +
      '<input type="range" min="1" max="2.4" step="0.05" data-range="explode" aria-label="층간격 배율"><span class="tx-range-ticks"><i>1.0</i><i>1.7</i><i>2.4</i></span></label>';
  }
  function bodyLayers() {
    var L = [['tray', 'tray', '케이블 트레이', '#94a3b8'], ['links', 'links', '결선', C.LINK.data.css], ['thermal', 'thermo', '열화상', C.GRADE.ORANGE.css], ['ground', 'ground', '접지 경고', C.LINK.ground.css], ['measure', 'clip', '실측 배지', '#3e63db']];
    return '<div class="tx-chips">' + L.map(function (l) {
      return '<button type="button" class="tx-chip" data-layer="' + l[0] + '" style="--tx-chip:' + l[3] + '">' + ic(l[1], 15) + '<span>' + l[2] + '</span></button>';
    }).join('') + '</div><p class="tx-pop-note">' + ic('info', 13) + '실측 배지는 ADMIN 정기점검 실측 자료 기준입니다 (센서 자동 수집 아님).</p>';
  }
  function bodyCamera() {
    var B = [['iso', 'iso', '아이소'], ['front', 'front', '정면'], ['top', 'top', '평면'], ['reset', 'reset', '초기화'], ['focus', 'focus', '선택 설비로']];
    return '<div class="tx-cams">' + B.map(function (b) {
      return '<button type="button" class="tx-cam' + (b[0] === 'focus' ? ' tx-cam-wide' : '') + '" data-cam="' + b[0] + '">' + ic(b[1], 18) + '<span>' + b[2] + '</span></button>';
    }).join('') + '</div>';
  }
  function bodyExport() {
    var B = [['svg', 'file', '2D 도면 SVG', '벡터 · CAD 편집용'], ['png', 'image', '2D 도면 PNG', '고해상도 이미지'], ['snap', 'camera', '3D 스냅샷 PNG', '현재 3D 화면 캡처']];
    return '<div class="tx-menu">' + B.map(function (b) {
      return '<button type="button" class="tx-menu-item" data-export="' + b[0] + '">' + ic(b[1], 17) + '<span><b>' + b[2] + '</b><small data-exp-sub="' + b[0] + '">' + b[3] + '</small></span></button>';
    }).join('') + '</div>';
  }
  function popHTML(id, title, body, wide) {
    return '<div class="tx-pop' + (wide ? ' tx-pop-wide' : '') + '" id="tx-pop-' + id + '" role="dialog" aria-label="' + esc(title) + '" hidden>' +
      '<div class="tx-pop-head"><b>' + esc(title) + '</b></div>' + body + '</div>';
  }
  function searchHTML(cls) {
    return '<div class="tx-search ' + (cls || '') + '" role="combobox" aria-haspopup="listbox" aria-expanded="false">' + ic('search', 16) +
      '<input type="search" class="tx-search-input" placeholder="설비 ID·이름 검색" autocomplete="off" spellcheck="false" aria-label="설비 검색">' +
      '<div class="tx-search-list" role="listbox" hidden></div></div>';
  }

  function build() {
    if (built) return;
    built = true;
    var root = U.el('div', 'tx-root');
    root.id = 'tx-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '2D·3D 통합 도면 뷰어');
    root.hidden = true;
    root.innerHTML =
      '<header class="tx-toolbar">' +
        '<div class="tx-tb-left">' +
          '<span class="tx-brand" aria-hidden="true">' + ic('cube', 18) + '</span>' +
          '<div class="tx-title"><b>디지털 트윈 통합 뷰어</b><span class="tx-crumb"><span data-r="site"></span><i>·</i><span class="tx-crumb-floor" data-r="floor"></span></span></div>' +
        '</div>' +
        '<div class="tx-tb-center">' + segHTML() + '<span class="tx-tb-sep"></span>' +
          '<div class="tx-groups">' +
            tbtn('concept', 'wand', '시안 A', '3D 입체 구성도 시안 A~D') +
            tbtn('doll', 'building', '돌하우스·층', '돌하우스 층별·간선 제어') +
            tbtn('layers', 'layers', '레이어', '시각화 레이어') +
            tbtn('camera', 'camera', '카메라', '카메라 프리셋') +
            '<button type="button" class="tx-tbtn tx-tbtn-fault" data-act="fault" aria-pressed="false" title="선택 설비를 발생원으로 장애 파급 시뮬레이션">' + ic('zap', 17) + '<span class="tx-tbtn-lbl">장애 시뮬레이션</span></button>' +
            tbtn('export', 'download', '내보내기', '도면·스냅샷 내보내기') +
          '</div>' +
        '</div>' +
        '<div class="tx-tb-right">' + searchHTML('tx-search-tb') +
          '<button type="button" class="tx-ibtn tx-menu-btn" data-act="menu" aria-label="메뉴" aria-expanded="false">' + ic('menu', 19) + '</button>' +
          '<button type="button" class="tx-ibtn tx-fs-btn" data-act="fullscreen" aria-label="전체화면 (F)" title="전체화면 (F)">' + ic('max', 18) + '</button>' +
          '<button type="button" class="tx-ibtn tx-close-btn" data-act="close" aria-label="뷰어 닫기 (Esc)" title="닫기 (Esc)">' + ic('x', 19) + '</button>' +
        '</div>' +
      '</header>' +
      '<main class="tx-viewport">' +
        '<div class="tx-views">' +
          '<section class="tx-pane tx-pane-2d" aria-label="2D CAD 도면"><div class="tx-view tx-view-2d"></div>' +
            '<div class="tx-empty" data-empty="2d"><span class="tx-empty-ic">' + ic('map', 30) + '</span><b>2D CAD 도면</b><small data-empty-msg="2d"></small></div></section>' +
          '<div class="tx-splitter" role="separator" tabindex="0" aria-label="2D·3D 분할 크기 조절 (방향키)" aria-valuemin="15" aria-valuemax="85"><span></span></div>' +
          '<section class="tx-pane tx-pane-3d" aria-label="3D 입체 뷰"><div class="tx-view tx-view-3d"></div>' +
            '<div class="tx-empty" data-empty="3d"><span class="tx-empty-ic">' + ic('cube', 30) + '</span><b>3D 입체 구성도</b><small data-empty-msg="3d"></small></div></section>' +
        '</div>' +
        '<nav class="tx-rail" aria-label="층 선택">' +
          '<button type="button" class="tx-rail-toggle" data-act="rail" aria-label="층 레일 접기/펴기">' + ic('layers', 15) + '<span data-r="railcur"></span>' + ic('left', 14).replace('tx-ic', 'tx-ic tx-rail-chev') + '</button>' +
          '<div class="tx-rail-list"></div>' +
        '</nav>' +
        '<div class="tx-legend">' +
          '<button type="button" class="tx-legend-btn" data-act="legend" aria-expanded="true">' + ic('legend', 14) + '<span>범례</span>' + ic('down', 12).replace('tx-ic', 'tx-ic tx-caret') + '</button>' +
          '<div class="tx-legend-body"></div>' +
        '</div>' +
        '<aside class="tx-insp" aria-label="설비 상세">' +
          '<button type="button" class="tx-insp-tab" data-act="insp" aria-label="상세 패널 열기/닫기">' + ic('right', 16).replace('tx-ic', 'tx-ic tx-insp-chev') + '<span>상세</span></button>' +
          '<div class="tx-insp-grab" data-act="insp" aria-hidden="true"><span></span></div>' +
          '<div class="tx-insp-body"></div>' +
        '</aside>' +
        popHTML('concept', '3D 입체 구성도 시안', bodyConcept(), true) +
        popHTML('doll', '돌하우스 층별 · 간선 제어', bodyDoll()) +
        popHTML('layers', '시각화 레이어', bodyLayers()) +
        popHTML('camera', '카메라', bodyCamera()) +
        popHTML('export', '내보내기', bodyExport()) +
        '<div class="tx-sheet" role="dialog" aria-label="뷰어 메뉴" hidden>' +
          '<div class="tx-sheet-head"><b>뷰어 메뉴</b><button type="button" class="tx-ibtn" data-act="menu" aria-label="메뉴 닫기">' + ic('x', 18) + '</button></div>' +
          '<div class="tx-sheet-body">' + searchHTML('tx-search-sheet') +
            '<section><h4>보기</h4>' + segHTML('tx-seg-block') + '</section>' +
            '<section><h4>3D 시안</h4>' + bodyConcept() + '</section>' +
            '<section><h4>돌하우스 · 층</h4>' + bodyDoll() + '</section>' +
            '<section><h4>레이어</h4>' + bodyLayers() + '</section>' +
            '<section><h4>카메라</h4>' + bodyCamera() + '</section>' +
            '<section><h4>장애 시뮬레이션</h4><button type="button" class="tx-fault-block" data-act="fault" aria-pressed="false">' + ic('zap', 17) + '<span data-r="faultlbl">선택 설비를 발생원으로 시작</span></button></section>' +
            '<section><h4>내보내기</h4>' + bodyExport() + '</section>' +
          '</div>' +
        '</div>' +
      '</main>' +
      '<footer class="tx-status" role="status" aria-live="polite">' +
        '<span class="tx-st-item tx-st-src" data-r="src"></span>' +
        '<span class="tx-st-item tx-st-loc" data-r="loc"></span>' +
        '<span class="tx-st-item tx-st-grades" data-r="grades"></span>' +
        '<span class="tx-st-item tx-st-fault" data-r="fault"></span>' +
        '<span class="tx-st-hint"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 보기 <kbd>[</kbd><kbd>]</kbd> 층 <kbd>F</kbd> 전체화면 <kbd>Esc</kbd> 닫기</span>' +
      '</footer>' +
      '<div class="tx-toasts" aria-live="polite"></div>';
    document.body.appendChild(root);

    var q = function (s) { return root.querySelector(s); };
    R = {
      root: root, toolbar: q('.tx-toolbar'), viewport: q('.tx-viewport'), views: q('.tx-views'),
      pane2d: q('.tx-pane-2d'), pane3d: q('.tx-pane-3d'), view2d: q('.tx-view-2d'), view3d: q('.tx-view-3d'),
      splitter: q('.tx-splitter'), rail: q('.tx-rail'), railList: q('.tx-rail-list'),
      legend: q('.tx-legend'), legendBody: q('.tx-legend-body'),
      insp: q('.tx-insp'), inspBody: q('.tx-insp-body'), status: q('.tx-status'), toasts: q('.tx-toasts'),
      sheet: q('.tx-sheet')
    };
    R.view2d.id = 'tx-view2d'; R.view3d.id = 'tx-view3d';

    ui = TwinX.ui = {
      root: root, toolbar: R.toolbar, viewport: R.viewport, view2d: R.view2d, view3d: R.view3d,
      floorRail: R.rail, inspector: R.insp, statusbar: R.status,
      toast: showToast,
      isVisible: function (v) { var s = S(); return !!(s.open && (s.view === v || s.view === 'split')); }
    };

    R.legendBody.innerHTML = legendHTML();
    wire();
    applySplit();
    // 렌더러가 mount 하면 안내 레이어 숨김 (view2d/view3d 내부 DOM은 T3/T4 소유)
    if (window.MutationObserver) {
      [R.view2d, R.view3d].forEach(function (v) { new MutationObserver(updateEmpty).observe(v, { childList: true }); });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { emitResize(); }).observe(R.viewport);
  }

  function legendHTML() {
    return '<div class="tx-lg-group"><h5>설비 등급</h5>' + GORDER.map(function (g) {
      return '<span class="tx-lg-row"><i class="tx-dot" style="background:' + gcss(g) + '"></i>' + esc(C.GRADE[g].name) + '</span>';
    }).join('') + '</div><div class="tx-lg-group"><h5>결선 유형</h5>' + Object.keys(C.LINK).map(function (k) {
      var l = C.LINK[k];
      return '<span class="tx-lg-row"><svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke="' + l.css + '" stroke-width="2.4" ' + (l.dash ? 'stroke-dasharray="4 3"' : '') + ' stroke-linecap="round"/></svg>' + esc(l.name) + '</span>';
    }).join('') + '</div>';
  }

  /* ============================================================
     이벤트 배선
     ============================================================ */
  function wire() {
    var root = R.root;
    root.addEventListener('click', onClick);
    root.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches && t.matches('[data-range="explode"]')) {
        var v = Math.round(U.clamp(parseFloat(t.value), 1, 2.4) * 100) / 100;
        root.querySelectorAll('[data-out="explode"]').forEach(function (o) { o.textContent = v.toFixed(2).replace(/0$/, '') + '×'; });
        TwinX.setState({ explode: v });
      }
    });
    // 팝오버 바깥 클릭 닫기
    document.addEventListener('pointerdown', function (e) {
      if (!openPop) return;
      var pop = openPop.pop, trig = openPop.trig;
      if (pop.contains(e.target) || trig.contains(e.target)) return;
      closePop(false);
    }, true);
    // 검색 (툴바 + 모바일 시트)
    root.querySelectorAll('.tx-search').forEach(wireSearch);
    // 분할선 드래그
    wireSplitter();
    window.addEventListener('resize', function () { if (S().open) { applySplit(); placePop(); emitResize(); } });
    document.addEventListener('fullscreenchange', function () {
      var on = document.fullscreenElement === R.root;
      var b = R.root.querySelector('.tx-fs-btn');
      if (b) { b.innerHTML = ic(on ? 'min' : 'max', 18); b.setAttribute('aria-label', on ? '전체화면 해제 (F)' : '전체화면 (F)'); }
      emitResize();
    });
  }

  function onClick(e) {
    var t = e.target.closest('[data-set],[data-toggle],[data-layer],[data-cam],[data-export],[data-act],[data-floor],[data-select],[data-pop]');
    if (!t || !R.root.contains(t) || t.disabled) return;
    var s = S(), d = t.dataset;
    if (d.pop) { togglePop(d.pop, t); return; }
    if (d.set) {
      var kv = d.set.split(':'), patch = {};
      patch[kv[0]] = kv[1];
      if (kv[0] === 'concept' && s.view === '2d') patch.view = '3d';
      TwinX.setState(patch);
      if (kv[0] === 'concept' && openPop) closePop(true);
      return;
    }
    if (d.toggle) {
      var p2 = {}; p2[d.toggle] = !s[d.toggle];
      if (d.toggle === 'walk' && p2.walk && s.view === '2d') p2.view = '3d';
      TwinX.setState(p2);
      if (d.toggle === 'walk' && p2.walk) { closePop(false); closeSheet(); showToast('1인칭 워크스루: WASD/방향키로 이동, Esc로 해제', 'info'); }
      return;
    }
    if (d.layer) { var lp = {}; lp[d.layer] = !s.layers[d.layer]; TwinX.setState({ layers: lp }); return; }
    if (d.cam) {
      if (d.cam === 'focus' && !s.selected) { showToast('먼저 설비를 선택하세요', 'warn'); return; }
      if (s.view === '2d') TwinX.setState({ view: '3d' });
      TwinX.camera(d.cam);
      closePop(false); closeSheet();
      return;
    }
    if (d.export) { doExport(d.export); closePop(false); closeSheet(); return; }
    if (d.floor) {
      if (d.floor === '*') TwinX.setState({ stack: !s.stack });
      else TwinX.setState({ floor: d.floor, stack: false });
      return;
    }
    if (d.select != null) { TwinX.select(d.select || null); return; }
    switch (d.act) {
      case 'close': TwinX.close(); break;
      case 'fullscreen': toggleFullscreen(); break;
      case 'menu': toggleSheet(); break;
      case 'fault': toggleFault(); closeSheet(); break;
      case 'fault-here': if (d.id) { TwinX.select(d.id); TwinX.setState({ fault: { active: true, source: d.id } }); } break;
      case 'fault-off': TwinX.setState({ fault: { active: false, source: null } }); break;
      case 'focus': if (s.view === '2d') TwinX.setState({ view: '3d' }); TwinX.camera('focus'); break;
      case 'rail': TwinX.setState({ panel: { floors: !s.panel.floors } }); break;
      case 'legend': TwinX.setState({ panel: { legend: !s.panel.legend } }); break;
      case 'insp': TwinX.setState({ panel: { inspector: !s.panel.inspector } }); break;
    }
  }

  function toggleFault() {
    var s = S();
    if (s.fault && s.fault.active) { TwinX.setState({ fault: { active: false, source: null } }); showToast('장애 시뮬레이션을 해제했습니다', 'info'); return; }
    if (!s.selected) { showToast('발생원으로 쓸 설비를 먼저 선택하세요 (도면 클릭 또는 검색)', 'warn'); return; }
    TwinX.setState({ fault: { active: true, source: s.selected } });
    var a = TwinX.asset(s.selected);
    showToast('장애 시뮬레이션 시작 · 발생원 ' + (a ? a.name + ' (' + a.id + ')' : s.selected), 'error');
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (R.root.requestFullscreen) R.root.requestFullscreen().catch(function () { showToast('이 브라우저에서는 전체화면을 쓸 수 없습니다', 'warn'); });
    } catch (e) { showToast('전체화면 전환 실패', 'warn'); }
  }

  /* ---------------- 내보내기 ---------------- */
  function exportAvail(k) {
    if (k === 'svg') return !!(TwinX.cad2d && typeof TwinX.cad2d.exportSvg === 'function');
    if (k === 'png') return !!(TwinX.cad2d && typeof TwinX.cad2d.exportPng === 'function');
    if (k === 'snap') return !!(TwinX.scene3d && typeof TwinX.scene3d.snapshot === 'function');
    return false;
  }
  function doExport(k) {
    if (!exportAvail(k)) { showToast('이 내보내기 기능을 사용할 수 없습니다', 'warn'); return; }
    var base = 'TwinX_' + (S().stack ? 'ALL' : (S().floor || 'floor')) + '_' + U.today();
    var name = base + (k === 'svg' ? '_2D.svg' : k === 'png' ? '_2D.png' : '_3D.png');
    function save(r) {
      if (!r) return; // 모듈이 직접 다운로드한 경우
      if (r instanceof Blob) U.download(r, name);
      else if (typeof r === 'string') {
        if (/^data:/.test(r)) { var a = document.createElement('a'); a.href = r; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
        else if (/<svg/i.test(r)) U.download(new Blob([r], { type: 'image/svg+xml' }), name);
      }
      showToast('내보내기 완료 · ' + name, 'success');
    }
    try {
      var fn = k === 'svg' ? TwinX.cad2d.exportSvg : k === 'png' ? TwinX.cad2d.exportPng : TwinX.scene3d.snapshot;
      var host = k === 'snap' ? TwinX.scene3d : TwinX.cad2d;
      var r = fn.call(host);
      if (r && typeof r.then === 'function') r.then(save, function (err) { showToast('내보내기 실패: ' + (err && err.message || err), 'error'); });
      else save(r);
    } catch (err) { showToast('내보내기 실패: ' + (err && err.message || err), 'error'); }
  }

  /* ---------------- 팝오버 ---------------- */
  function togglePop(id, trig) {
    if (openPop && openPop.id === id) { closePop(true); return; }
    closePop(false);
    var pop = R.root.querySelector('#tx-pop-' + id);
    if (!pop) return;
    pop.hidden = false;
    trig.setAttribute('aria-expanded', 'true');
    trig.classList.add('tx-open');
    openPop = { id: id, pop: pop, trig: trig };
    refreshControls(pop);
    placePop();
    var f = pop.querySelector('.tx-on:not([disabled])') || pop.querySelector('button:not([disabled]),input');
    if (f) f.focus({ preventScroll: true });
  }
  function placePop() {
    if (!openPop) return;
    var pop = openPop.pop, tr = openPop.trig.getBoundingClientRect(), vp = R.viewport.getBoundingClientRect();
    var w = pop.offsetWidth, W = window.innerWidth;
    var left = U.clamp(tr.left + tr.width / 2 - w / 2, 8, W - w - 8);
    pop.style.left = (left - vp.left) + 'px';
    pop.style.top = '8px';
    pop.style.setProperty('--tx-arrow', U.clamp(tr.left + tr.width / 2 - left, 18, w - 18) + 'px');
  }
  function closePop(refocus) {
    if (!openPop) return false;
    openPop.pop.hidden = true;
    openPop.trig.setAttribute('aria-expanded', 'false');
    openPop.trig.classList.remove('tx-open');
    if (refocus) openPop.trig.focus({ preventScroll: true });
    openPop = null;
    return true;
  }
  function toggleSheet() { if (R.sheet.hidden) openSheet(); else closeSheet(); }
  function openSheet() {
    closePop(false);
    R.sheet.hidden = false;
    refreshControls(R.sheet);
    var b = R.root.querySelector('.tx-menu-btn'); if (b) b.setAttribute('aria-expanded', 'true');
  }
  function closeSheet() {
    if (!R.sheet || R.sheet.hidden) return false;
    R.sheet.hidden = true;
    var b = R.root.querySelector('.tx-menu-btn'); if (b) b.setAttribute('aria-expanded', 'false');
    return true;
  }

  /* ---------------- 검색 자동완성 ---------------- */
  function wireSearch(box) {
    var input = box.querySelector('input'), list = box.querySelector('.tx-search-list'), items = [], active = -1;
    function render() {
      var qv = input.value.trim().toLowerCase(), m = M();
      if (!qv || !m) { hide(); return; }
      var scored = [];
      m.assets.forEach(function (a) {
        var id = String(a.id).toLowerCase(), nm = String(a.name || '').toLowerCase(), cat = String(a.category || '').toLowerCase(), rn = roomName(a.room).toLowerCase();
        var sc = id === qv ? 0 : id.indexOf(qv) === 0 ? 1 : nm.indexOf(qv) === 0 ? 2 : nm.indexOf(qv) >= 0 ? 3 : id.indexOf(qv) >= 0 ? 4 : (cat.indexOf(qv) >= 0 || rn.indexOf(qv) >= 0) ? 5 : -1;
        if (sc >= 0) scored.push([sc, a]);
      });
      scored.sort(function (x, y) { return x[0] - y[0] || GORDER.indexOf(gradeOf(x[1])) - GORDER.indexOf(gradeOf(y[1])); });
      items = scored.slice(0, 8).map(function (x) { return x[1]; });
      active = items.length ? 0 : -1;
      list.innerHTML = items.length ? items.map(function (a, i) {
        return '<button type="button" role="option" class="tx-sr' + (i === active ? ' tx-active' : '') + '" data-i="' + i + '" tabindex="-1">' +
          '<i class="tx-dot" style="background:' + gcss(gradeOf(a)) + '"></i><span class="tx-sr-main"><b>' + esc(a.name) + '</b><small>' + esc(floorName(a.floor)) + ' · ' + esc(roomName(a.room) || '-') + '</small></span><code>' + esc(a.id) + '</code></button>';
      }).join('') : '<div class="tx-sr-empty">일치하는 설비가 없습니다</div>';
      list.hidden = false; box.setAttribute('aria-expanded', 'true');
    }
    function hide() { list.hidden = true; box.setAttribute('aria-expanded', 'false'); items = []; active = -1; }
    function pick(i) {
      var a = items[i]; if (!a) return;
      input.value = ''; hide(); input.blur(); closeSheet();
      TwinX.select(a.id);
      if (!S().panel.inspector) TwinX.setState({ panel: { inspector: true } });
    }
    function mark() { list.querySelectorAll('.tx-sr').forEach(function (b, i) { b.classList.toggle('tx-active', i === active); if (i === active) b.scrollIntoView({ block: 'nearest' }); }); }
    input.addEventListener('input', render);
    input.addEventListener('focus', function () { if (input.value) render(); });
    input.addEventListener('blur', function () { setTimeout(hide, 150); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active = (active + 1) % items.length; mark(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active = (active - 1 + items.length) % items.length; mark(); } }
      else if (e.key === 'Enter') { e.preventDefault(); pick(active < 0 ? 0 : active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (input.value) { input.value = ''; hide(); } else input.blur(); }
    });
    list.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) { var b = e.target.closest('.tx-sr'); if (b) pick(+b.dataset.i); });
  }

  /* ---------------- 분할선 ---------------- */
  function splitRows() { return isMobile() || (window.innerHeight > window.innerWidth && window.innerWidth < 1024); }
  function applySplit() {
    if (!R.root) return;
    var rows = splitRows();
    R.root.classList.toggle('tx-split-rows', rows);
    R.pane2d.style.flexBasis = (split * 100) + '%';
    R.splitter.setAttribute('aria-orientation', rows ? 'horizontal' : 'vertical');
    R.splitter.setAttribute('aria-valuenow', String(Math.round(split * 100)));
  }
  function setSplit(v) {
    split = U.clamp(v, 0.15, 0.85);
    applySplit();
    try { localStorage.setItem(SPLIT_KEY, String(split)); } catch (e) { }
    emitResize();
  }
  function wireSplitter() {
    var sp = R.splitter, dragging = false;
    sp.addEventListener('pointerdown', function (e) {
      dragging = true; sp.setPointerCapture(e.pointerId); R.root.classList.add('tx-dragging'); e.preventDefault();
    });
    sp.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var r = R.views.getBoundingClientRect(), rows = splitRows();
      setSplit(rows ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width);
    });
    function end(e) { if (!dragging) return; dragging = false; try { sp.releasePointerCapture(e.pointerId); } catch (x) { } R.root.classList.remove('tx-dragging'); emitResize(); }
    sp.addEventListener('pointerup', end);
    sp.addEventListener('pointercancel', end);
    sp.addEventListener('dblclick', function () { setSplit(0.5); });
    sp.addEventListener('keydown', function (e) {
      var k = e.key, d = 0;
      if (k === 'ArrowLeft' || k === 'ArrowUp') d = -0.03; else if (k === 'ArrowRight' || k === 'ArrowDown') d = 0.03; else if (k === 'Home') { setSplit(0.15); e.preventDefault(); return; } else if (k === 'End') { setSplit(0.85); e.preventDefault(); return; }
      if (d) { e.preventDefault(); e.stopPropagation(); setSplit(split + d); }
    });
  }

  /* ============================================================
     렌더 / 동기화
     ============================================================ */
  function setOn(el, on) {
    el.classList.toggle('tx-on', !!on);
    if (el.getAttribute('role') === 'switch') el.setAttribute('aria-checked', on ? 'true' : 'false');
    else el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function refreshControls(scope) {
    var s = S();
    scope.querySelectorAll('[data-set]').forEach(function (el) { var kv = el.dataset.set.split(':'); setOn(el, String(s[kv[0]]) === kv[1]); });
    scope.querySelectorAll('[data-toggle]').forEach(function (el) { setOn(el, !!s[el.dataset.toggle]); });
    scope.querySelectorAll('[data-layer]').forEach(function (el) { setOn(el, !!(s.layers && s.layers[el.dataset.layer])); });
    scope.querySelectorAll('[data-range="explode"]').forEach(function (el) { if (document.activeElement !== el) el.value = s.explode; });
    scope.querySelectorAll('[data-out="explode"]').forEach(function (el) { el.textContent = (+s.explode).toFixed(2).replace(/0$/, '') + '×'; });
    scope.querySelectorAll('[data-cam="focus"]').forEach(function (el) { el.disabled = !s.selected; el.title = s.selected ? '' : '설비를 선택하면 사용할 수 있습니다'; });
    scope.querySelectorAll('[data-export]').forEach(function (el) {
      var ok = exportAvail(el.dataset.export); el.disabled = !ok;
      var sub = el.querySelector('[data-exp-sub]');
      if (sub) { if (!sub.dataset.def) sub.dataset.def = sub.textContent; sub.textContent = ok ? sub.dataset.def : '모듈 미탑재 · 사용 불가'; }
    });
    var fa = !!(s.fault && s.fault.active);
    scope.querySelectorAll('[data-act="fault"]').forEach(function (el) { setOn(el, fa); el.classList.toggle('tx-need-sel', !fa && !s.selected); });
    scope.querySelectorAll('[data-r="faultlbl"]').forEach(function (el) { el.textContent = fa ? '시뮬레이션 해제' : (s.selected ? '선택 설비를 발생원으로 시작' : '설비를 먼저 선택하세요'); });
  }

  function syncLayout() {
    var s = S(), r = R.root;
    ['2d', '3d', 'split'].forEach(function (v) { r.classList.toggle('tx-v-' + v, s.view === v); });
    r.classList.toggle('tx-insp-open', !!s.panel.inspector);
    r.classList.toggle('tx-rail-closed', !s.panel.floors);
    r.classList.toggle('tx-legend-closed', !s.panel.legend);
    r.classList.toggle('tx-faulting', !!(s.fault && s.fault.active));
    r.classList.toggle('tx-walking', !!s.walk);
    var lb = r.querySelector('.tx-legend-btn'); if (lb) lb.setAttribute('aria-expanded', s.panel.legend ? 'true' : 'false');
    var it = r.querySelector('.tx-insp-tab'); if (it) it.setAttribute('aria-expanded', s.panel.inspector ? 'true' : 'false');
    var cl = r.querySelector('[data-lbl="concept"]'); if (cl) cl.textContent = '시안 ' + s.concept;
    updateEmpty();
  }

  function syncHeader() {
    var m = M(), s = S(), r = R.root;
    r.querySelector('[data-r="site"]').textContent = m ? (m.site && (m.site.name || m.site.building)) || '사이트' : '데이터 불러오는 중';
    r.querySelector('[data-r="floor"]').textContent = s.stack ? '전층 적층' : floorName(s.floor);
    var rc = r.querySelector('[data-r="railcur"]'); if (rc) rc.textContent = s.stack ? 'ALL' : floorShort(TwinX.floor(s.floor));
  }

  function syncRail() {
    var m = M(), s = S();
    if (!m || !m.floors.length) { R.railList.innerHTML = '<div class="tx-rail-empty">층 없음</div>'; return; }
    var all = m.assets, wa = worstOf(all.filter(function (a) { return /RED|ORANGE|YELLOW/.test(gradeOf(a)); }));
    var html = '<button type="button" class="tx-floor tx-floor-all' + (s.stack ? ' tx-on' : '') + '" data-floor="*" aria-pressed="' + !!s.stack + '" title="전층 적층 보기 (토글)">' +
      '<b>ALL</b><small>전층 ' + all.length + '</small>' + (wa !== 'NONE' ? '<i class="tx-dot" style="background:' + gcss(wa) + '"></i>' : '') + '</button><span class="tx-rail-sep"></span>';
    html += m.floors.map(function (f) {
      var list = TwinX.assetsOf(f.code), bad = list.filter(function (a) { return /RED|ORANGE|YELLOW/.test(gradeOf(a)); });
      var w = bad.length ? worstOf(bad) : (list.length ? worstOf(list) : 'NONE');
      var on = !s.stack && s.floor === f.code, cur = s.stack && s.floor === f.code;
      return '<button type="button" class="tx-floor' + (on ? ' tx-on' : '') + (cur ? ' tx-cur' : '') + (bad.length ? ' tx-has-bad' : '') + '" data-floor="' + esc(f.code) + '" aria-pressed="' + on + '" title="' + esc((f.name || f.code) + ' · 설비 ' + list.length + '대' + (bad.length ? ' · 조치 ' + bad.length + '건' : '')) + '">' +
        '<b>' + esc(floorShort(f)) + '</b><small>' + list.length + '대</small>' +
        '<i class="tx-dot' + (w === 'RED' ? ' tx-pulse' : '') + '" style="background:' + gcss(w) + '"></i>' + (bad.length ? '<em>' + bad.length + '</em>' : '') + '</button>';
    }).join('');
    R.railList.innerHTML = html;
  }

  function syncStatus() {
    var m = M(), s = S(), r = R.root;
    var src = r.querySelector('[data-r="src"]');
    if (!m) src.innerHTML = '<i class="tx-dot" style="background:#94a3b8"></i>데이터 대기';
    else if (m.source === 'admin') src.innerHTML = '<i class="tx-dot" style="background:#10b981"></i>ADMIN 실데이터';
    else src.innerHTML = '<i class="tx-dot" style="background:#eab308"></i>시범 데이터';
    src.title = m && m.updatedAt ? '갱신 ' + String(m.updatedAt).replace('T', ' ').slice(0, 16) : '';
    r.querySelector('[data-r="loc"]').textContent = m ? ((m.site && m.site.name) || '') + ' · ' + (s.stack ? '전층' : floorName(s.floor)) : '—';
    var c = countGrades(scopeAssets());
    r.querySelector('[data-r="grades"]').innerHTML = GORDER.filter(function (g) { return c[g]; }).map(function (g) {
      return '<span title="' + esc(C.GRADE[g].name) + '"><i class="tx-dot" style="background:' + gcss(g) + '"></i>' + c[g] + '</span>';
    }).join('') || '<span>설비 0</span>';
    var fe = r.querySelector('[data-r="fault"]');
    if (s.fault && s.fault.active) {
      var a = TwinX.asset(s.fault.source), n = TwinX.fault && TwinX.fault.impact && TwinX.fault.source === s.fault.source ? TwinX.fault.impact.size : null;
      fe.innerHTML = ic('zap', 13) + '장애 시뮬레이션 · ' + esc(a ? a.name : s.fault.source || '-') + (n != null ? ' · 영향 ' + Math.max(0, n - (TwinX.fault.impact.has(s.fault.source) ? 1 : 0)) + '대' : '');
      fe.classList.add('tx-st-fault-on');
    } else { fe.innerHTML = ic('zap', 13) + '시뮬레이션 꺼짐'; fe.classList.remove('tx-st-fault-on'); }
  }

  /* ---------- 인스펙터 ---------- */
  function judgeCss(j) { return j === 'good' ? C.GRADE.GREEN.css : j === 'bad' ? C.GRADE.RED.css : C.GRADE.NONE.css; }
  function judgeName(j) { return j === 'good' ? '적합' : j === 'bad' ? '부적합' : j === 'na' ? '해당없음' : '미판정'; }
  function gradeBadge(g) { return '<span class="tx-badge" style="--tx-b:' + gcss(g) + '"><i class="tx-dot" style="background:' + gcss(g) + '"></i>' + esc((C.GRADE[g] || C.GRADE.NONE).name) + '</span>'; }

  function impactSummary(id) {
    if (!(TwinX.analysis && typeof TwinX.analysis.impact === 'function')) return null;
    var r; try { r = TwinX.analysis.impact(id); } catch (e) { return null; }
    if (!r) return null;
    var out = { down: 0, risk: 0, ids: [] };
    function bucket(v) {
      var t = typeof v === 'string' ? v : v && typeof v === 'object' ? (v.level || v.state || v.kind || v.type || v.status || '') : '';
      t = String(t).toLowerCase();
      if (/source|origin|발생/.test(t)) return 'src';
      if (/down|stop|outage|fail|cut|중단|정지/.test(t)) return 'down';
      return 'risk';
    }
    function add(k, v) { if (k === id) return; var b = bucket(v); if (b === 'src') return; out[b]++; out.ids.push([k, b]); }
    var map = r instanceof Map ? r : r.impact instanceof Map ? r.impact : null;
    if (map) map.forEach(function (v, k) { add(k, v); });
    else if (Array.isArray(r.down) || Array.isArray(r.risk)) {
      (r.down || []).forEach(function (x) { add(x && x.id || x, 'down'); });
      (r.risk || []).forEach(function (x) { add(x && x.id || x, 'risk'); });
    } else if (typeof r.down === 'number' || typeof r.risk === 'number') { out.down = r.down || 0; out.risk = r.risk || 0; }
    else if (typeof r === 'object') Object.keys(r).forEach(function (k) { if (TwinX.asset(k)) add(k, r[k]); });
    return out;
  }
  function riskInfo(a) {
    if (!(TwinX.analysis && typeof TwinX.analysis.risk === 'function')) return null;
    var r; try { r = TwinX.analysis.risk(a); } catch (e) { return null; }
    if (r == null) return null;
    if (typeof r === 'number') return { score: r, factors: [] };
    var score = r.score != null ? r.score : r.total != null ? r.total : r.value;
    if (score == null) return null;
    var fs = r.parts || r.factors || r.reasons || r.items || r.breakdown || [];
    if (!Array.isArray(fs)) fs = typeof fs === 'object' ? Object.keys(fs).map(function (k) { return { label: k, value: fs[k] }; }) : [];
    return {
      score: +score, level: r.triage || (typeof r.level === 'string' ? r.level : ''), grade: C.GRADE[r.grade] ? r.grade : null,
      basis: typeof r.basis === 'string' ? r.basis : '',
      factors: fs.map(function (f) {
        if (typeof f === 'string') return { label: f, value: null };
        return { label: f.k || f.label || f.name || f.key || f.reason || '', value: f.v != null ? f.v : f.value != null ? f.value : f.score != null ? f.score : f.weight != null ? f.weight : f.points, max: f.max, note: f.note || f.detail || '' };
      }).filter(function (f) { return f.label; })
    };
  }
  function riskColor(v) { return v >= 60 ? C.GRADE.RED.css : v >= 40 ? C.GRADE.ORANGE.css : v >= 20 ? C.GRADE.YELLOW.css : C.GRADE.GREEN.css; }

  function linkRow(l, otherId, dir) {
    var o = TwinX.asset(otherId), lt = C.LINK[l.type] || C.LINK.path;
    return '<button type="button" class="tx-link" data-select="' + esc(otherId) + '" title="' + esc(lt.name) + (l.cable ? ' · ' + esc(l.cable) : '') + '">' +
      '<span class="tx-link-bar" style="background:' + lt.css + (lt.dash ? ';background:repeating-linear-gradient(180deg,' + lt.css + ' 0 4px,transparent 4px 7px)' : '') + '"></span>' +
      '<span class="tx-link-dir">' + ic(dir === 'up' ? 'arrowUp' : 'arrowDown', 13) + '</span>' +
      '<span class="tx-link-main"><b>' + esc(o ? o.name : otherId) + '</b><small>' + esc(otherId) + ' · ' + esc(lt.name) + (l.cable ? ' · ' + esc(l.cable) : '') + '</small></span>' +
      (o ? '<i class="tx-dot" style="background:' + gcss(gradeOf(o)) + '"></i>' : '') + ic('right', 14) + '</button>';
  }

  function inspAsset(a) {
    var s = S(), m = M(), g = gradeOf(a), f = TwinX.floor(a.floor), rm = TwinX.room(a.room);
    var h = '<div class="tx-insp-hero" style="--tx-g:' + gcss(g) + '">' +
      '<span class="tx-kind">' + ic(KIND_IC[a.kind] || 'box', 22) + '</span>' +
      '<div class="tx-hero-txt"><span class="tx-eyebrow">설비 상세</span><h3>' + esc(a.name) + '</h3>' +
      '<div class="tx-hero-meta"><code>' + esc(a.id) + '</code>' + gradeBadge(g) + (a.status ? '<span class="tx-status-txt">' + esc(a.status) + '</span>' : '') + '</div></div>' +
      '<button type="button" class="tx-ibtn tx-ibtn-sm" data-select="" aria-label="선택 해제" title="선택 해제">' + ic('x', 16) + '</button></div>' +
      '<div class="tx-loc">' + ic('pin', 14) + '<span>' + esc(f ? f.name || floorShort(f) : a.floor) + (rm ? ' · ' + esc(rm.name) : '') + (rm && rm.building ? ' <em>' + esc(rm.building) + '</em>' : '') + '</span></div>' +
      '<div class="tx-actions">' +
        '<button type="button" class="tx-btn" data-act="focus">' + ic('focus', 15) + '설비로 이동</button>' +
        ((s.fault && s.fault.active && s.fault.source === a.id)
          ? '<button type="button" class="tx-btn tx-btn-danger tx-on" data-act="fault-off">' + ic('zap', 15) + '시뮬레이션 해제</button>'
          : '<button type="button" class="tx-btn tx-btn-danger" data-act="fault-here" data-id="' + esc(a.id) + '">' + ic('zap', 15) + '장애 시뮬레이션</button>') +
      '</div>';

    // 장애 시뮬레이션 영향 배너 (T5 계산 결과)
    if (s.fault && s.fault.active && TwinX.fault && TwinX.fault.impact && TwinX.fault.impact.has && TwinX.fault.impact.has(a.id) && s.fault.source !== a.id) {
      var src = TwinX.asset(s.fault.source);
      h += '<div class="tx-banner tx-banner-danger">' + ic('alert', 15) + '<span>장애 파급 영향권 · 발생원 <b>' + esc(src ? src.name : s.fault.source) + '</b></span></div>';
    }

    var rows = [['설비구분', a.category], ['종류', KIND_NAME[a.kind] || a.kind], ['모델', a.model], ['제조사', a.maker], ['규격', a.spec],
      ['랙 · U', a.rack ? [a.rack.name, a.rack.u].filter(Boolean).join(' · ') : '']];
    h += '<section class="tx-sec"><h4>기본 정보</h4><dl class="tx-dl">' + rows.map(function (r) {
      return '<dt>' + r[0] + '</dt><dd' + (r[1] ? '' : ' class="tx-muted"') + '>' + esc(r[1] || '—') + '</dd>';
    }).join('') + '</dl></section>';

    // 실측
    var ms = (a.measures || []).slice().sort(function (x, y) { var o = { bad: 0, none: 1, na: 2, good: 3 }; return (o[x.judge] || 1) - (o[y.judge] || 1); });
    var bad = ms.filter(function (x) { return x.judge === 'bad'; }).length;
    h += '<section class="tx-sec"><h4>정기점검 실측 <span class="tx-count">' + ms.length + '</span>' + (bad ? '<span class="tx-count tx-count-bad">부적합 ' + bad + '</span>' : '') + '</h4>';
    if (ms.length) {
      h += '<ul class="tx-meas">' + ms.map(function (x) {
        var std = x.std && C.STD[x.std];
        return '<li style="--tx-j:' + judgeCss(x.judge) + '"><span class="tx-meas-l">' + (std ? '<i class="tx-std">' + esc(std) + '</i>' : '') + '<b>' + esc(x.item || '-') + '</b>' + (x.date ? '<small>' + esc(x.date) + '</small>' : '') + '</span>' +
          '<span class="tx-meas-r"><b>' + esc(x.value == null ? '-' : x.value) + (x.unit ? '<u>' + esc(x.unit) + '</u>' : '') + '</b><em>' + judgeName(x.judge) + '</em></span></li>';
      }).join('') + '</ul><p class="tx-src-note">ADMIN 정기점검 실측 자료 · 기술기준 판정 (자동 수집 아님)</p>';
    } else h += '<p class="tx-empty-line">등록된 정기점검 실측 자료가 없습니다</p>';
    h += '</section>';

    // 연결
    var ups = m.links.filter(function (l) { return l.to === a.id; }), dns = m.links.filter(function (l) { return l.from === a.id; });
    h += '<section class="tx-sec"><h4>연결 관계 <span class="tx-count">' + (ups.length + dns.length) + '</span></h4>';
    if (ups.length + dns.length) {
      if (ups.length) h += '<div class="tx-sub">상위 · 공급 ' + ups.length + '</div>' + ups.map(function (l) { return linkRow(l, l.from, 'up'); }).join('');
      if (dns.length) h += '<div class="tx-sub">하위 · 의존 ' + dns.length + '</div>' + dns.map(function (l) { return linkRow(l, l.to, 'down'); }).join('');
    } else h += '<p class="tx-empty-line">등록된 결선이 없습니다</p>';
    h += '</section>';

    // 장애 영향 요약
    var imp = impactSummary(a.id);
    if (imp) {
      h += '<section class="tx-sec"><h4>장애 영향 요약</h4><div class="tx-kpis">' +
        '<div class="tx-kpi" style="--tx-k:' + C.GRADE.RED.css + '"><b>' + imp.down + '</b><small>서비스 중단</small></div>' +
        '<div class="tx-kpi" style="--tx-k:' + C.GRADE.ORANGE.css + '"><b>' + imp.risk + '</b><small>위험 · 영향</small></div></div>';
      if (imp.ids.length) h += '<div class="tx-impact-list">' + imp.ids.slice(0, 6).map(function (x) {
        var o = TwinX.asset(x[0]);
        return '<button type="button" class="tx-mini" data-select="' + esc(x[0]) + '"><i class="tx-dot" style="background:' + (x[1] === 'down' ? C.GRADE.RED.css : C.GRADE.ORANGE.css) + '"></i>' + esc(o ? o.name : x[0]) + '</button>';
      }).join('') + (imp.ids.length > 6 ? '<span class="tx-more">외 ' + (imp.ids.length - 6) + '대</span>' : '') + '</div>';
      h += '<p class="tx-src-note">이 설비 장애 시 하위 결선을 따라 계산한 추정치입니다</p></section>';
    }
    // 위험 점수
    var rk = riskInfo(a);
    if (rk) {
      var mx = Math.max.apply(null, rk.factors.map(function (f) { return +f.value || 0; }).concat([1]));
      h += '<section class="tx-sec"><h4>위험 점수</h4><div class="tx-risk" style="--tx-r:' + (rk.grade ? gcss(rk.grade) : riskColor(rk.score)) + '">' +
        '<div class="tx-risk-score"><b>' + Math.round(rk.score) + '</b><small>/ 100' + (rk.level ? ' · ' + esc(rk.level) : '') + '</small></div>' +
        '<div class="tx-risk-bar"><span style="width:' + U.clamp(rk.score, 0, 100) + '%"></span></div></div>';
      if (rk.factors.length) h += '<ul class="tx-factors">' + rk.factors.map(function (f) {
        var v = +f.value || 0, fm = +f.max || mx, pct = fm ? v / fm * 100 : 0;
        return '<li><span class="tx-f-l">' + esc(f.label) + (f.note ? '<small>' + esc(f.note) + '</small>' : '') + '</span><span class="tx-f-bar"><span style="width:' + (f.value == null || !v ? 0 : U.clamp(pct, 3, 100)) + '%;background:' + riskColor(pct) + '"></span></span><b>' + (f.value == null ? '' : esc(Math.round(v * 10) / 10) + (f.max ? '<small>/' + esc(f.max) + '</small>' : '')) + '</b></li>';
      }).join('') + '</ul>';
      if (rk.basis) h += '<p class="tx-src-note">' + esc(rk.basis) + '</p>';
      h += '</section>';
    }
    return h;
  }

  function inspSummary() {
    var m = M(), s = S();
    if (!m) return '<div class="tx-insp-hero"><span class="tx-kind">' + ic('info', 22) + '</span><div class="tx-hero-txt"><span class="tx-eyebrow">요약</span><h3>데이터 불러오는 중</h3></div></div>';
    var f = TwinX.floor(s.floor), list = scopeAssets(), rooms = s.stack ? m.rooms : TwinX.roomsOf(s.floor), c = countGrades(list);
    var title = s.stack ? '전층 요약' : (f ? (f.name || floorShort(f)) + ' 요약' : '층 요약');
    var h = '<div class="tx-insp-hero"><span class="tx-kind">' + ic(s.stack ? 'stack' : 'building', 22) + '</span><div class="tx-hero-txt"><span class="tx-eyebrow">' + esc((m.site && m.site.name) || '') + '</span><h3>' + esc(title) + '</h3>' +
      '<div class="tx-hero-meta"><span class="tx-status-txt">실 ' + rooms.length + ' · 설비 ' + list.length + '대' + (s.stack ? ' · ' + m.floors.length + '개 층' : '') + '</span></div></div></div>';
    var tot = list.length || 1;
    h += '<section class="tx-sec"><h4>등급 분포</h4><div class="tx-dist">' + GORDER.map(function (g) {
      return c[g] ? '<span style="flex:' + c[g] + ';background:' + gcss(g) + '" title="' + esc(C.GRADE[g].name) + ' ' + c[g] + '"></span>' : '';
    }).join('') + (list.length ? '' : '<span style="flex:1;background:#e1e7ee"></span>') + '</div><div class="tx-dist-legend">' + GORDER.map(function (g) {
      return '<span class="' + (c[g] ? '' : 'tx-zero') + '"><i class="tx-dot" style="background:' + gcss(g) + '"></i>' + esc(C.GRADE[g].name) + '<b>' + c[g] + '</b><small>' + Math.round(c[g] / tot * 100) + '%</small></span>';
    }).join('') + '</div></section>';
    var bad = list.filter(function (a) { return /RED|ORANGE|YELLOW/.test(gradeOf(a)); }).sort(function (x, y) { return GORDER.indexOf(gradeOf(x)) - GORDER.indexOf(gradeOf(y)); });
    h += '<section class="tx-sec"><h4>조치 필요 설비 <span class="tx-count' + (bad.length ? ' tx-count-bad' : '') + '">' + bad.length + '</span></h4>';
    h += bad.length ? '<div class="tx-alist">' + bad.map(function (a) {
      var g = gradeOf(a);
      return '<button type="button" class="tx-arow" data-select="' + esc(a.id) + '" style="--tx-g:' + gcss(g) + '"><span class="tx-arow-ic">' + ic(KIND_IC[a.kind] || 'box', 16) + '</span><span class="tx-arow-main"><b>' + esc(a.name) + '</b><small>' + esc(a.id) + ' · ' + esc(s.stack ? floorShort(TwinX.floor(a.floor)) + ' · ' : '') + esc(roomName(a.room) || '-') + '</small></span>' + gradeBadge(g) + '</button>';
    }).join('') + '</div>' : '<p class="tx-empty-line tx-ok">' + ic('clip', 15) + '이상·주의 설비가 없습니다</p>';
    h += '</section><p class="tx-hint">' + ic('info', 13) + '도면에서 설비를 클릭하거나 상단 검색으로 찾으면 상세가 표시됩니다.</p>';
    return h;
  }

  function syncInspector(force) {
    var s = S(), a = s.selected ? TwinX.asset(s.selected) : null;
    var fi = TwinX.fault && TwinX.fault.impact ? TwinX.fault.impact.size : 0;
    var sig = [a ? a.id : '-', s.floor, s.stack, JSON.stringify(s.fault), fi, M() ? M().updatedAt + ':' + M().assets.length : 'x', !!TwinX.analysis].join('|');
    if (!force && sig === lastInspSig) return;
    var sameAsset = lastInspSig.split('|')[0] === (a ? a.id : '-');
    lastInspSig = sig;
    var st = sameAsset ? R.inspBody.scrollTop : 0;
    R.inspBody.innerHTML = a ? inspAsset(a) : inspSummary();
    R.inspBody.scrollTop = st;
    R.insp.classList.toggle('tx-has-sel', !!a);
  }

  function updateEmpty() {
    if (!R.root) return;
    var m = M();
    [['2d', R.view2d, TwinX.cad2d, '2D CAD 렌더러'], ['3d', R.view3d, TwinX.scene3d, '3D 엔진']].forEach(function (x) {
      var em = R.root.querySelector('[data-empty="' + x[0] + '"]'), msg = R.root.querySelector('[data-empty-msg="' + x[0] + '"]');
      var mounted = x[1].childElementCount > 0;
      em.hidden = mounted;
      if (!mounted) msg.textContent = !m ? '설비 데이터를 불러오는 중입니다…' : x[2] ? '도면을 준비하는 중입니다…' : x[3] + '가 이 빌드에 아직 연결되지 않았습니다. 연결되면 이 영역에 표시됩니다.';
    });
  }

  function syncAll() {
    if (!built) return;
    syncLayout(); syncHeader(); syncRail(); syncStatus(); syncInspector();
    refreshControls(R.root);
  }

  /* ---------------- 토스트 ---------------- */
  function showToast(msg, kind) {
    if (!built) return;
    kind = kind || 'info';
    var icn = kind === 'error' ? 'alert' : kind === 'warn' ? 'alert' : kind === 'success' ? 'clip' : 'info';
    var t = U.el('div', 'tx-toast tx-toast-' + kind, ic(icn, 16) + '<span>' + esc(msg) + '</span>');
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    R.toasts.appendChild(t);
    while (R.toasts.children.length > 4) R.toasts.firstChild.remove();
    requestAnimationFrame(function () { t.classList.add('tx-in'); });
    setTimeout(function () { t.classList.remove('tx-in'); setTimeout(function () { t.remove(); }, 260); }, kind === 'error' ? 4200 : 2800);
  }

  /* ============================================================
     열기 / 닫기
     ============================================================ */
  function onOpen() {
    var first = !built;
    build();
    var m = M(), s = S();
    // T1 데이터 모듈이 없는 단독 시험 환경 → 시범 모델로 대체
    if (!m && !TwinX.data && TwinX.demoModel) setTimeout(function () { if (!TwinX.model) TwinX.setModel(TwinX.demoModel()); }, 0);
    if (m && s.floor && !TwinX.floor(s.floor) && m.floors.length) TwinX.setState({ floor: m.floors[0].code });
    if (isMobile() && first) TwinX.setState({ panel: { inspector: false, legend: false } });
    if (!scrollLock) {
      scrollLock = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
    lastFocus = document.activeElement;
    R.root.hidden = false;
    R.root.classList.remove('tx-closing');
    applySplit();
    lastInspSig = '';
    syncAll();
    requestAnimationFrame(function () { R.root.classList.add('tx-shown'); });
    var cb = R.root.querySelector('.tx-close-btn'); if (cb) cb.focus({ preventScroll: true });
    if (first) TwinX.emit('ui-ready', TwinX.ui);
    emitResize();
  }
  function onClose() {
    if (!built) return;
    closePop(false); closeSheet();
    if (document.fullscreenElement === R.root) { try { document.exitFullscreen(); } catch (e) { } }
    R.root.classList.remove('tx-shown');
    R.root.hidden = true;
    if (scrollLock) {
      document.documentElement.style.overflow = scrollLock.html;
      document.body.style.overflow = scrollLock.body;
      scrollLock = null;
    }
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { } }
  }

  /* ---------------- 코어 이벤트 구독 ---------------- */
  TwinX.on('open', onOpen);
  TwinX.on('close', onClose);
  TwinX.on('state', function (p) {
    if (!built) return;
    var ch = p && p.changed || [];
    syncAll();
    if (ch.indexOf('view') >= 0 || ch.indexOf('panel') >= 0) emitResize();
    if (ch.indexOf('view') >= 0 && openPop) placePop();
  });
  TwinX.on('model', function () { if (built) { lastInspSig = ''; syncAll(); } });
  TwinX.on('select', function (id) {
    if (!built) return;
    if (id && !S().panel.inspector && S().open) TwinX.setState({ panel: { inspector: true } });
    syncInspector(true);
    if (R.inspBody && id) R.inspBody.scrollTop = 0;
  });
  TwinX.on('fault', function () { if (built) { syncStatus(); syncInspector(true); } });
  TwinX.on('toast', function (t) { if (t) showToast(t.msg || String(t), t.kind); });

  /* ---------------- 키보드 ---------------- */
  function isTyping(t) {
    if (!t || !t.tagName) return false;
    var tg = t.tagName;
    if (t.isContentEditable) return true;
    if (tg === 'TEXTAREA' || tg === 'SELECT') return true;
    if (tg === 'INPUT') return !/^(checkbox|radio|button|range|submit|reset|color)$/i.test(t.type || '');
    return false;
  }
  window.addEventListener('keydown', function (e) {
    var s = S();
    if (e.defaultPrevented && e.key !== 'Escape') return;
    // 전역 Shift+T: 뷰어 열기/닫기
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'T' || e.key === 't') && !isTyping(e.target)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (s.open) TwinX.close(); else TwinX.open({ floor: adminFloor() || s.floor });
      return;
    }
    if (!s.open || !built) return;
    var k = e.key, handled = true;
    if (k === 'Escape') {
      if (isTyping(e.target)) return; // 검색창 자체 처리
      if (closePop(true)) { }
      else if (closeSheet()) { }
      else if (document.fullscreenElement === R.root) { document.exitFullscreen(); }
      else if (s.walk) TwinX.setState({ walk: false });
      else if (s.panel.inspector) TwinX.setState({ panel: { inspector: false } });
      else TwinX.close();
    } else if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === '1') TwinX.setState({ view: '2d' });
    else if (k === '2') TwinX.setState({ view: '3d' });
    else if (k === '3') TwinX.setState({ view: 'split' });
    else if (k === 'f' || k === 'F') { if (e.shiftKey) return; toggleFullscreen(); }
    else if (k === '[' || k === ']') stepFloor(k === '[' ? -1 : 1);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  function stepFloor(d) {
    var m = M(), s = S(); if (!m || !m.floors.length) return;
    var i = m.floors.findIndex(function (f) { return f.code === s.floor; });
    if (i < 0) i = 0; else if (!s.stack) i = U.clamp(i + d, 0, m.floors.length - 1);
    TwinX.setState({ floor: m.floors[i].code, stack: false });
  }

  /* ============================================================
     ADMIN 진입점 주입 (React 재렌더링에도 유지, 중복·무한 루프 방지)
     ============================================================ */
  function adminFloor() {
    var sel = document.querySelector('.work-area > .canvas-panel select.floor-select');
    return sel && sel.value ? sel.value : null;
  }
  function openFromAdmin(e) {
    if (e) { e.preventDefault(); }
    var f = adminFloor(), opts = {};
    if (f) opts.floor = f;
    TwinX.open(opts);
  }
  function ensureEntry() {
    // 1) 「디지털 트윈」 캔버스 헤딩 버튼 — 없을 때만 추가하므로 관찰자 재호출 시 no-op
    var heading = document.querySelector('.work-area > .canvas-panel > .panel-heading');
    if (heading && !heading.querySelector('.tx-entry-btn')) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tx-entry-btn';
      b.title = '도면을 전체화면으로 크게 보기 · 2D CAD / 3D 입체 / 분할 (Shift+T)';
      b.innerHTML = '<span aria-hidden="true">🧊</span><span>2D·3D 통합 뷰어</span><kbd>⇧T</kbd>';
      b.addEventListener('click', openFromAdmin);
      heading.appendChild(b);
    }
    // 2) 사이드바 「디지털 트윈」 메뉴 옆 보조 배지
    var navBtn = null, nb = document.querySelectorAll('.sidebar nav button');
    for (var i = 0; i < nb.length; i++) { if ((nb[i].textContent || '').indexOf('디지털 트윈') >= 0) { navBtn = nb[i]; break; } }
    if (navBtn && !navBtn.querySelector('.tx-nav-badge')) {
      var bd = document.createElement('span');
      bd.className = 'tx-nav-badge';
      bd.setAttribute('role', 'button');
      bd.setAttribute('tabindex', '0');
      bd.setAttribute('aria-label', '2D·3D 통합 뷰어 열기');
      bd.title = '2D·3D 통합 뷰어 (Shift+T)';
      bd.textContent = '3D';
      bd.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); openFromAdmin(); });
      bd.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); openFromAdmin(); } });
      navBtn.appendChild(bd);
    }
  }
  var entryQueued = false;
  function scheduleEntry() {
    if (entryQueued) return;
    entryQueued = true;
    requestAnimationFrame(function () { entryQueued = false; try { ensureEntry(); } catch (e) { } });
  }
  function initEntry() {
    var root = document.getElementById('root');
    if (root && window.MutationObserver) new MutationObserver(scheduleEntry).observe(root, { childList: true, subtree: true });
    scheduleEntry();
    setInterval(function () { try { ensureEntry(); } catch (e) { } }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initEntry); else initEntry();

  /* ---------------- 공개 API ---------------- */
  TwinX.shell = {
    version: '1.0.0',
    /* 뷰포트에서 떠 있는 패널이 가리는 영역(px) — 렌더러의 fit-to-view 여백용 */
    insets: function () {
      if (!built || !S().open) return { top: 0, right: 0, bottom: 0, left: 0 };
      var vp = R.viewport.getBoundingClientRect(), s = S(), mob = isMobile();
      var rr = R.rail.getBoundingClientRect(), ir = R.insp.getBoundingClientRect();
      return {
        top: 0,
        left: s.panel.floors && !mob ? Math.round(rr.right - vp.left) : 0,
        right: s.panel.inspector && !mob ? Math.round(vp.right - ir.left) : 0,
        bottom: s.panel.inspector && mob ? Math.round(vp.bottom - ir.top) : 0
      };
    },
    refresh: function () { lastInspSig = ''; syncAll(); emitResize(); },
    toast: function (m, k) { showToast(m, k); },
    openFromAdmin: openFromAdmin
  };
})();
