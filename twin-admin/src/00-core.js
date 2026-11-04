/* ============================================================
   TwinX 코어 (통합 리드 소유) — 모든 팀 모듈의 공통 기반
   - 네임스페이스 window.TwinX, 이벤트 버스, 공유 UI 상태, 유틸, 상수
   - 데모 모델: ADMIN React 상태를 못 읽을 때(단독 시험 등) 사용
   * 계약(인터페이스)은 twin-admin/CONTRACT.md 참조. 이 파일은 통합 리드만 수정합니다.
   ============================================================ */
(function () {
  'use strict';
  if (window.TwinX) return;

  var listeners = {};
  var UI_KEY = 'twinx_ui_v1';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var DEFAULT_STATE = {
    open: false,            // 통합 뷰어 오버레이 열림
    view: '3d',             // '2d' | '3d' | 'split'
    concept: 'A',           // 3D 시안 'A'(돌하우스 적층) | 'B'(룸·랙 투시) | 'C'(홀로그램 계통) | 'D'(열화상·위험기둥)
    floor: null,            // 현재 층 코드 (model.floors[].code)
    stack: false,           // 전층 3D 적층
    ghost: true,            // 비선택 층 반투명
    riser: true,            // 수직 라이저 표시
    labels: true,           // 실·설비 라벨
    explode: 1.5,           // 층간격 배율 1.0~2.4
    walk: false,            // 1인칭 워크스루
    layers: { tray: true, links: true, thermal: false, ground: true, measure: true },
    selected: null,         // 선택 설비 ID (model.assets[].id)
    room: null,             // 선택 실 ID (model.rooms[].id)
    fault: { active: false, source: null }, // 장애 파급 시뮬레이션
    panel: { inspector: true, floors: true, legend: true }
  };

  var TwinX = window.TwinX = {
    version: '1.0.0',
    model: null,
    fault: { source: null, impact: new Map() }, // 분석팀(T5)이 채움
    ui: null,                                    // 셸팀(T2)이 'open' 직전에 채움
    state: clone(DEFAULT_STATE),

    /* ---------- 이벤트 버스 ---------- */
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return fn; },
    off: function (ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); },
    emit: function (ev, payload) {
      (listeners[ev] || []).slice().forEach(function (fn) {
        try { fn(payload); } catch (e) { console.error('[TwinX] listener error on "' + ev + '":', e); }
      });
    },

    /* ---------- 상태 ---------- */
    setState: function (patch) {
      var s = this.state, changed = [];
      Object.keys(patch || {}).forEach(function (k) {
        var v = patch[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && s[k] && typeof s[k] === 'object') {
          var merged = Object.assign({}, s[k], v);
          if (JSON.stringify(merged) !== JSON.stringify(s[k])) { s[k] = merged; changed.push(k); }
        } else if (s[k] !== v) { s[k] = v; changed.push(k); }
      });
      if (!changed.length) return;
      try {
        var keep = {};
        ['view', 'concept', 'stack', 'ghost', 'riser', 'labels', 'explode', 'layers', 'panel'].forEach(function (k) { keep[k] = s[k]; });
        localStorage.setItem(UI_KEY, JSON.stringify(keep));
      } catch (e) { /* 저장 불가 환경 */ }
      this.emit('state', { state: s, changed: changed });
    },
    resetState: function () { this.state = clone(DEFAULT_STATE); this.emit('state', { state: this.state, changed: Object.keys(DEFAULT_STATE) }); },

    /* ---------- 모델 ---------- */
    setModel: function (m) {
      this.model = m;
      var s = this.state;
      if (!s.floor || !m.floors.some(function (f) { return f.code === s.floor; })) s.floor = m.floors.length ? m.floors[0].code : null;
      if (s.selected && !this.asset(s.selected)) s.selected = null;
      this.emit('model', m);
    },
    asset: function (id) { return this.model ? this.model.assets.find(function (a) { return a.id === id; }) || null : null; },
    room: function (id) { return this.model ? this.model.rooms.find(function (r) { return r.id === id; }) || null : null; },
    floor: function (code) { return this.model ? this.model.floors.find(function (f) { return f.code === code; }) || null : null; },
    roomsOf: function (floor) { return this.model ? this.model.rooms.filter(function (r) { return r.floor === floor; }) : []; },
    assetsOf: function (floor) { return this.model ? this.model.assets.filter(function (a) { return a.floor === floor; }) : []; },

    /* 설비 선택: 다른 층이면 층 전환, 'select' 이벤트 발행 */
    select: function (id) {
      var a = id ? this.asset(id) : null;
      var patch = { selected: a ? a.id : null };
      if (a) { patch.room = a.room; if (!this.state.stack && a.floor !== this.state.floor) patch.floor = a.floor; }
      this.setState(patch);
      this.emit('select', patch.selected);
    },

    /* 뷰어 열기/닫기 — 실제 DOM은 셸팀(T2)이 'open'/'close' 이벤트를 받아 처리 */
    open: function (opts) { this.setState(Object.assign({ open: true }, opts || {})); this.emit('open', this.state); },
    close: function () { this.setState({ open: false, walk: false }); this.emit('close', this.state); },

    /* 카메라 명령 (3D팀 처리): preset 'iso'|'front'|'top'|'reset'|'focus' */
    camera: function (preset) { this.emit('camera', { preset: preset }); },

    /* ---------- 유틸 ---------- */
    util: {
      esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); },
      el: function (tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; },
      svg: function (tag, attrs) { var n = document.createElementNS('http://www.w3.org/2000/svg', tag); if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k])); return n; },
      clamp: function (v, a, b) { return Math.max(a, Math.min(b, v)); },
      num: function (v) { if (v == null) return null; var m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; },
      hash: function (s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; },
      debounce: function (fn, ms) { var t; return function () { var a = arguments, me = this; clearTimeout(t); t = setTimeout(function () { fn.apply(me, a); }, ms); }; },
      download: function (blob, name) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1500); },
      today: function () { var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
    },

    /* ---------- 공용 상수 (모든 렌더러가 같은 색을 써야 함) ---------- */
    C: {
      GRADE: {
        RED:    { css: '#f43f5e', hex: 0xf43f5e, name: '이상·불량' },
        ORANGE: { css: '#f97316', hex: 0xf97316, name: '주의' },
        YELLOW: { css: '#eab308', hex: 0xeab308, name: '관찰' },
        GREEN:  { css: '#10b981', hex: 0x10b981, name: '정상' },
        NONE:   { css: '#94a3b8', hex: 0x94a3b8, name: '미점검' }
      },
      LINK: {
        data:    { css: '#22d3ee', hex: 0x22d3ee, name: '통신(UTP)', dash: false },
        optical: { css: '#a78bfa', hex: 0xa78bfa, name: '광케이블', dash: false },
        power:   { css: '#f43f5e', hex: 0xf43f5e, name: '전원', dash: false },
        ground:  { css: '#eab308', hex: 0xeab308, name: '접지', dash: true },
        path:    { css: '#94a3b8', hex: 0x94a3b8, name: '경로', dash: true }
      },
      ROOM: { // 실 유형별 바닥색(밝은 건축 톤) · 해치색
        telecom: { fill: '#f6c490', hatch: '#ea580c', label: '통신실·TPS·EPS' },
        server:  { fill: '#c7d2fe', hatch: '#4f46e5', label: '서버실' },
        control: { fill: '#cfd8e6', hatch: null,      label: '관제·방재실' },
        power:   { fill: '#f3b4b4', hatch: '#e11d48', label: '전원·UPS실' },
        elec:    { fill: '#cdd6e0', hatch: '#64748b', label: '전기실' },
        mech:    { fill: '#c9d4cf', hatch: null,      label: '기계실' },
        corr:    { fill: '#ece5d6', hatch: null,      label: '복도' },
        lobby:   { fill: '#e2d2b4', hatch: null,      label: '로비' },
        office:  { fill: '#dcc8a4', hatch: null,      label: '사무·일반' },
        store:   { fill: '#ddd5c6', hatch: null,      label: '창고' },
        stair:   { fill: '#d2cdc3', hatch: null,      label: '계단·승강기' },
        wc:      { fill: '#c4dbe3', hatch: null,      label: '화장실' },
        park:    { fill: '#cfcfcf', hatch: null,      label: '주차장' }
      },
      STD: { gnd: '접지', heat: '발열', pwr: '전원', sig: '신호', env: '환경' }
    }
  };

  // 저장된 UI 선호값 복원
  try {
    var saved = JSON.parse(localStorage.getItem(UI_KEY) || 'null');
    if (saved) Object.keys(saved).forEach(function (k) { if (k in TwinX.state) TwinX.state[k] = (typeof saved[k] === 'object' && saved[k]) ? Object.assign({}, TwinX.state[k], saved[k]) : saved[k]; });
  } catch (e) { }

  /* ============================================================
     데모 모델 (계약 스키마 예시 · ADMIN 데이터를 못 읽을 때 대체)
     좌표: mm, 층 평면 좌상단 원점, x→동, y→남
     ============================================================ */
  TwinX.demoModel = function () {
    var floors = [
      { code: 'F04', name: '4층', level: 4, elevation: 12.6 },
      { code: 'F03', name: '3층', level: 3, elevation: 8.4 },
      { code: 'F02', name: '2층', level: 2, elevation: 4.2 },
      { code: 'F01', name: '1층', level: 1, elevation: 0 },
      { code: 'B01', name: '지하1층', level: -1, elevation: -4.2 }
    ];
    var rooms = [], assets = [], links = [];
    function R(id, floor, name, type, x, y, w, h) { rooms.push({ id: id, floor: floor, building: '시범 통신센터', name: name, type: type, x: x, y: y, w: w, h: h, measures: [], raw: null }); }
    function A(id, room, name, category, kind, x, y, status, extra) {
      var r = rooms.find(function (q) { return q.id === room; });
      assets.push(Object.assign({ id: id, room: room, floor: r.floor, name: name, category: category, kind: kind, model: '', maker: '시범 제조사', spec: '', x: x, y: y, status: status, grade: status === '이상' ? 'RED' : status === '주의' ? 'ORANGE' : 'GREEN', measures: [], raw: null }, extra || {}));
    }
    // 4층: MDF실 · 서버실 · 관제실 + 복도
    R('F04-R1', 'F04', 'MDF실', 'telecom', 1300, 1500, 9700, 11600);
    R('F04-R2', 'F04', '서버실', 'server', 12300, 1500, 10300, 5100);
    R('F04-R3', 'F04', '관제실', 'control', 12300, 7900, 10300, 5200);
    R('F04-C', 'F04', '4층 복도', 'corr', 1300, 13600, 21300, 2400);
    ['F03', 'F02', 'F01'].forEach(function (f, i) {
      R(f + '-R1', f, (3 - i) + '층 TPS실', 'telecom', 1300, 1500, 4200, 5200);
      R(f + '-R2', f, (3 - i) + '층 사무실', 'office', 6000, 1500, 16600, 11600);
      R(f + '-C', f, (3 - i) + '층 복도', 'corr', 1300, 13600, 21300, 2400);
    });
    R('B01-R1', 'B01', '방재실(상황실)', 'control', 1300, 1500, 9700, 6000);
    R('B01-R2', 'B01', 'UPS·축전지실', 'power', 12300, 1500, 10300, 6000);
    R('B01-R3', 'B01', '주차관제실', 'office', 1300, 8000, 21300, 5100);
    R('B01-C', 'B01', '지하1층 복도', 'corr', 1300, 13600, 21300, 2400);
    A('A001', 'F04-R1', '주배선반 MDF', '전화설비', 'rack', 3600, 4200, '정상');
    A('A002', 'F04-R1', '코어 스위치', '네트워크설비', 'rack', 7900, 4200, '정상');
    A('A003', 'F04-R1', '광분배반 ODF', '케이블설비', 'rack', 3600, 9200, '정상');
    A('A004', 'F04-R1', 'UPS 전원장치', '전원설비', 'power', 7900, 9200, '주의');
    A('A005', 'F04-R2', '운영 서버', '서버설비', 'rack', 15000, 4100, '정상');
    A('A006', 'F04-R2', '스토리지', '서버설비', 'rack', 19500, 4100, '이상');
    A('A007', 'F04-R3', '관제 콘솔', '방송설비', 'rack', 15000, 10400, '정상');
    A('A008', 'F04-R3', 'IP 카메라 NVR', '영상설비', 'video', 19500, 10400, '정상');
    A('A009', 'B01-R1', '방재 통합반', '방재설비', 'rack', 4000, 4500, '이상');
    A('A010', 'B01-R2', '정류기·축전지', '전원설비', 'power', 17000, 4500, '정상');
    A('A013', 'F03-R1', '3층 PoE 스위치', '네트워크설비', 'rack', 3400, 4000, '정상');
    A('A014', 'F02-R1', '2층 PoE 스위치', '네트워크설비', 'rack', 3400, 4000, '주의');
    A('A015', 'F01-R1', '1층 PoE 스위치', '네트워크설비', 'rack', 3400, 4000, '정상');
    A('A016', 'F02-R2', '2층 무선 AP', '무선설비', 'ap', 14000, 7300, '정상');
    [['A001', 'A002', 'data'], ['A003', 'A002', 'optical'], ['A004', 'A002', 'power'], ['A002', 'A005', 'data'], ['A005', 'A006', 'optical'],
     ['A002', 'A007', 'optical'], ['A007', 'A008', 'data'], ['A002', 'A009', 'optical'], ['A004', 'A005', 'power'], ['A010', 'A004', 'power'],
     ['A002', 'A013', 'optical'], ['A002', 'A014', 'optical'], ['A002', 'A015', 'optical'], ['A014', 'A016', 'power']].forEach(function (t, i) {
      links.push({ id: 'L' + (i + 1), from: t[0], to: t[1], type: t[2], label: '', cable: 'CB-' + String(i + 1).padStart(3, '0') });
    });
    floors.forEach(function (f) {
      var rs = rooms.filter(function (r) { return r.floor === f.code; });
      f.bounds = { x0: Math.min.apply(null, rs.map(function (r) { return r.x; })), y0: Math.min.apply(null, rs.map(function (r) { return r.y; })),
                   x1: Math.max.apply(null, rs.map(function (r) { return r.x + r.w; })), y1: Math.max.apply(null, rs.map(function (r) { return r.y + r.h; })) };
      f.trays = [{ a: [f.bounds.x0 + 400, 14800], b: [f.bounds.x1 - 400, 14800], main: true }];
    });
    var risers = [{ id: 'R-1', name: '주 EPS 라이저', x: 2200, y: 13000, floors: floors.map(function (f) { return f.code; }) }];
    return { source: 'demo', site: { name: '시범 통신센터', building: '시범 통신센터' }, floors: floors, rooms: rooms, assets: assets, links: links, risers: risers, measurements: [], updatedAt: new Date().toISOString() };
  };
})();
