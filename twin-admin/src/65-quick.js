/* ============================================================
   TwinX 65-quick (통합 리드) — 간이 현행화 모드
   현장 보유 자료(대피소 도면 사진 · 설비 현행화표 · 점검 결과서)만으로 트윈 초안 작성
   ① 현행화표 붙여넣기 → 건물·층·설비(수량만큼) 자동 생성
   ② 층별 도면 사진 + 실측 치수 1개로 축척 맞춤 (60-workbench 도면 배경 재사용)
   ③ 사진 위에 실(방) 사각형 그리기 → 좌표 자동
   ④ 설비 클릭 배치 (실 안)
   ⑤ 기본 연결 규칙(OFD → 광중계기·RU) + ADMIN 등록용 엑셀(6개 시트) 내보내기
   초안: localStorage 'twinx_quick_v1' · 작업 중에는 뷰어가 초안 모델을 표시(10-data 갱신 보류)
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.quick) return;
  var U = TX.util, esc = U.esc;
  var KEY = 'twinx_quick_v1';
  function toast(m, k) { TX.emit('toast', { msg: m, kind: k || 'info' }); }
  function root() { return (TX.ui && TX.ui.root) || document.body; }

  /* ---------------- 초안 저장소 ---------------- */
  function blank() { return { active: false, site: '', buildings: [], floors: [], rooms: [], assets: [], links: [], autoLinks: true, bundleQty: true, source: [], savedAt: null, done: null }; }
  function load() { try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d ? Object.assign(blank(), d) : blank(); } catch (e) { return blank(); } }
  var D = load();
  function save() { D.savedAt = new Date().toISOString(); if (D.done) D.done.dirty = true; try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { toast('브라우저 저장공간에 저장하지 못했습니다', 'error'); } paintSaved(); }
  function paintSaved() { var el = P && P.querySelector('[data-r="saved"]'); if (el) el.textContent = savedText(); }
  function savedText() { if (!D.savedAt) return ''; var d = new Date(D.savedAt), p = function (n) { return (n < 10 ? '0' : '') + n; }; return '✔ 자동 저장 ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

  var ROOM_TYPES = [['통신실', 'telecom'], ['EPS실', 'telecom'], ['TPS실', 'telecom'], ['MDF실', 'telecom'], ['IDF실', 'telecom'], ['기지국 장비실', 'telecom'], ['서버실', 'server'], ['방재실', 'control'], ['관제실', 'control'], ['UPS실', 'power'], ['전기실', 'elec'], ['기계실', 'mech'], ['복도', 'corr'], ['계단실', 'stair'], ['로비', 'lobby'], ['사무실', 'office'], ['창고', 'store'], ['화장실', 'wc'], ['주차장', 'park'], ['옥상', 'office']];
  var TYPE_OF = {}; ROOM_TYPES.forEach(function (t) { TYPE_OF[t[0]] = t[1]; });
  function kindOf(a) {
    var s = (a.name || '') + ' ' + (a.model || '');
    if (/RU|안테나|AP|무선|기지국/i.test(s)) return 'ap';
    if (/OFD|FDF|ODF|광분배|광단자/i.test(s)) return 'panel';
    if (/UPS|정류|축전지|전원/i.test(s)) return 'power';
    if (/CCTV|카메라/i.test(s)) return 'cctv';
    return 'rack';
  }
  function categoryOf(a) {
    var s = (a.name || '') + ' ' + (a.model || '');
    if (/광중계기|중계기|RU|기지국|안테나/i.test(s)) return '이동통신설비';
    if (/OFD|FDF|ODF|광분배|광단자/i.test(s)) return '케이블설비';
    if (/UPS|정류|축전지|전원/i.test(s)) return '전원설비';
    if (/스위치|라우터|L2|L3/i.test(s)) return '네트워크설비';
    if (/CCTV|카메라/i.test(s)) return 'CCTV설비';
    return '통신설비';
  }
  function tagOf(a) {
    var s = (a.name || '') + ' ' + (a.model || '');
    if (/광중계기|중계기/.test(s)) return 'REP';
    if (/RU|기지국/i.test(s)) return 'RU';
    if (/OFD|FDF|ODF|광분배/i.test(s)) return 'OFD';
    if (/UPS|정류|축전지/i.test(s)) return 'PWR';
    return 'EQ';
  }
  var clean = function (v) { v = String(v == null ? '' : v).trim(); return /^(확인\s*불가|미상|불명|-|—|N\/?A)$/i.test(v) ? '' : v; };

  /* ---------------- 위치 해석: "본관 7층", "북관 B1층", "지하1층 방재실" ---------------- */
  function parseLoc(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    var m = s.match(/^(.*?)\s*(지하\s*\d+\s*층?|B\s*\d+\s*(?:층|F)?|\d+\s*(?:층|F)|옥상|RF|PH)\s*(.*)$/i);
    if (!m) return { building: s || '본관', floorName: '1층', level: 1, room: '' };
    var f = m[2].replace(/\s/g, '').toUpperCase(), level, fname;
    if (/^(지하|B)/.test(f)) { level = -Number((f.match(/\d+/) || [1])[0]); fname = '지하' + (-level) + '층'; }
    else if (/옥상|RF|PH/.test(f)) { level = 99; fname = '옥상'; }
    else { level = Number((f.match(/\d+/) || [1])[0]); fname = level + '층'; }
    return { building: (m[1] || '').trim() || '본관', floorName: fname, level: level, room: (m[3] || '').trim() };
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function ensureBuilding(name) {
    var b = D.buildings.find(function (x) { return x.name === name; });
    if (!b) { b = { code: 'BD' + pad(D.buildings.length + 1, 2), name: name }; D.buildings.push(b); }
    return b;
  }
  function floorCode(b, level) { return b.code + '-' + (level < 0 ? 'B' + pad(-level, 2) : level === 99 ? 'RF' : 'F' + pad(level, 2)); }
  function ensureFloor(bname, fname, level) {
    var b = ensureBuilding(bname), code = floorCode(b, level);
    var f = D.floors.find(function (x) { return x.code === code; });
    if (!f) { f = { code: code, building: b.name, bcode: b.code, name: fname, level: level, w: 40000, h: 25000 }; D.floors.push(f); }
    return f;
  }

  /* ---------------- ① 현행화표 붙여넣기 ---------------- */
  var COLS = { name: /설비\s*명|장비\s*명|명칭/, category: /설비\s*구분|분류|종류|설비\s*유형/, model: /규격|모델/, qty: /수량/, maker: /제조/, loc: /설치\s*위치|위치/, year: /설치\s*연도|연도|년도/, note: /비고|관리|소유/, bundle: /묶음|랙\s*명|함체/ };
  function parseTable(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.split('\t'); }).filter(function (c) { return c.some(function (v) { return v.trim(); }); });
    if (!lines.length) return [];
    var idx = { name: 0, model: 1, qty: 2, maker: 3, loc: 4, year: 5, note: 6 };
    var hi = lines.findIndex(function (c) { return c.some(function (v) { return COLS.name.test(v); }); });
    if (hi >= 0) {
      var h = lines[hi]; idx = {};
      Object.keys(COLS).forEach(function (k) { var i = h.findIndex(function (v) { return COLS[k].test(v); }); if (i >= 0) idx[k] = i; });
      lines = lines.slice(hi + 1);
    }
    parseTable.hasLoc = idx.loc != null;
    return lines.map(function (c) {
      var g = function (k) { return idx[k] != null ? clean(c[idx[k]]) : ''; };
      var q = parseInt(String(c[idx.qty] || '1').replace(/[^\d]/g, ''), 10);
      return { name: g('name'), model: g('model'), qty: q > 0 ? Math.min(q, 200) : 1, maker: g('maker'), loc: String(c[idx.loc] || '').trim(), year: g('year'), note: g('note'), bundle: g('bundle'), category: g('category') };
    }).filter(function (r) { return r.name; });
  }
  /** opts: {loc: '본관 3층 통신실'(모든 행 공통 위치), room: 실ID, group: 'one'|'perRow'|'none', bname} */
  function importTable(rows, opts) {
    var made = 0; opts = opts || {};
    var fixedRoom = opts.room ? D.rooms.find(function (q) { return q.id === opts.room; }) : null;
    rows.forEach(function (r) {
      var loc = opts.loc || r.loc;
      var L = parseLoc(loc), f = fixedRoom ? D.floors.find(function (q) { return q.code === fixedRoom.floor; }) : (opts.floor ? D.floors.find(function (q) { return q.code === opts.floor; }) : null) || ensureFloor(L.building, L.floorName, L.level);
      var tag = tagOf(r), n = D.assets.filter(function (a) { return a.floor === f.code && a.tag === tag; }).length;
      for (var i = 0; i < r.qty; i++) {
        n++;
        var na = { id: f.code + '-' + tag + '-' + pad(n, 3), tag: tag, name: r.qty > 1 ? r.name + ' #' + (i + 1) : r.name, model: r.model, maker: r.maker, year: r.year, note: r.note,
          floor: f.code, roomHint: L.room, room: null, x: null, y: null, status: '정상', category: (TX.eqTypes && TX.eqTypes.nameOf(r.category || r.name + ' ' + r.model)) || r.category || categoryOf(r), srcLoc: r.loc };
        // 묶음: 표의 「묶음」 열 > 등록 창에서 고른 방식(하나의 랙 / 같은 장비끼리 / 묶지 않음)
        var grp = opts.group || (D.bundleQty !== false ? 'perRow' : 'none');
        if (r.bundle) na.bundle = r.bundle; else if (grp === 'one') na.bundle = opts.bname || '랙 1'; else if (grp === 'perRow' && r.qty > 1) na.bundle = r.name;
        if (fixedRoom) { na.room = fixedRoom.id; na.roomHint = fixedRoom.name; na.x = Math.round(fixedRoom.x + fixedRoom.w / 2); na.y = Math.round(fixedRoom.y + fixedRoom.h / 2); }
        D.assets.push(na);
        made++;
      }
      D.source.push(r);
    });
    if (!D.site && D.buildings[0]) D.site = D.buildings[0].name + (D.buildings.length > 1 ? ' 외' : '');
    save(); autoLink(); apply();
    return made;
  }

  /* ---------------- ⑤ 기본 연결 규칙: 같은 층 OFD → 광중계기·RU (광) ---------------- */
  function autoLink() {
    D.links = D.links.filter(function (l) { return !l.auto; });
    if (!D.autoLinks) return;
    var n = D.links.length;
    D.floors.forEach(function (f) {
      var on = D.assets.filter(function (a) { return a.floor === f.code; });
      var ofd = on.filter(function (a) { return a.tag === 'OFD'; });
      if (!ofd.length) return;
      on.filter(function (a) { return a.tag === 'REP' || a.tag === 'RU'; }).forEach(function (a, i) {
        var src = ofd[i % ofd.length];
        n++; D.links.push({ id: 'L' + pad(n, 3), from: src.id, to: a.id, type: 'optical', auto: true });
      });
    });
  }

  /* ---------------- 초안 → TwinX 모델 (미리보기) ---------------- */
  function toModel() {
    var floors = D.floors.slice().sort(function (a, b) { return b.level - a.level || a.building.localeCompare(b.building); }).map(function (f) {
      var rs = D.rooms.filter(function (r) { return r.floor === f.code; });
      var x1 = Math.max.apply(null, [f.w].concat(rs.map(function (r) { return r.x + r.w; }))), y1 = Math.max.apply(null, [f.h].concat(rs.map(function (r) { return r.y + r.h; })));
      return { code: f.code, name: f.name, building: f.building, level: f.level === 99 ? 50 : f.level, elevation: (f.level > 0 ? f.level - 1 : f.level) * 4.2,
        bounds: { x0: 0, y0: 0, x1: x1, y1: y1 }, trays: [] };
    });
    var rooms = D.rooms.map(function (r) { var f = D.floors.find(function (q) { return q.code === r.floor; }); return { id: r.id, floor: r.floor, building: f ? f.building : '', name: r.name, type: TYPE_OF[r.kind] || 'office', x: r.x, y: r.y, w: r.w, h: r.h, measures: [], raw: { 실유형: r.kind } }; });
    // 점검 결과(측정) → 설비·실에 연결, 판정으로 상태 색 결정
    var MS = (D.measurements || []).map(function (m) { return { id: m.id, item: m.item, value: m.value, unit: m.unit, std: m.std || null, judge: m.judge, warn: !!m.warn, date: m.date, crit: m.crit, assetId: m.assetId || null, roomId: m.roomId || null, match: m.assetId ? 'explicit' : m.roomId ? 'room' : 'none', source: 'report', raw: m.raw || m }; });
    var msBy = {}, msRoom = {}; MS.forEach(function (m) { if (m.assetId) (msBy[m.assetId] = msBy[m.assetId] || []).push(m); else if (m.roomId) (msRoom[m.roomId] = msRoom[m.roomId] || []).push(m); });
    rooms.forEach(function (r) { r.measures = msRoom[r.id] || []; });
    var gradeOf = function (a, ms) {
      if (ms.some(function (m) { return m.judge === 'bad'; })) return 'RED';
      if (ms.some(function (m) { return m.warn; })) return 'YELLOW';
      if (a.status === '이상') return 'RED'; if (a.status === '주의') return 'ORANGE';
      return ms.length ? 'GREEN' : (window.TWINX_STANDALONE ? 'NONE' : 'GREEN');
    };
    var assets = D.assets.filter(function (a) { return a.room; }).map(function (a) {
      var rk = a.bundle ? { name: a.bundle, u: a.u0 != null ? pad(a.u0, 2) + 'U~' + pad(a.u1 != null ? a.u1 : a.u0, 2) + 'U' : '', u0: a.u0 != null ? a.u0 : null, u1: a.u0 != null ? (a.u1 != null ? a.u1 : a.u0) : null, size: 42, source: 'quick', bundle: true } : undefined;
      return { id: a.id, room: a.room, floor: a.floor, name: a.name, category: a.category, kind: kindOf(a), model: a.model, maker: a.maker, spec: '', x: a.x, y: a.y, status: a.status, grade: gradeOf(a, msBy[a.id] || []), measures: msBy[a.id] || [], rack: rk, raw: a };
    });
    var ids = {}; assets.forEach(function (a) { ids[a.id] = 1; });
    var links = D.links.filter(function (l) { return ids[l.from] && ids[l.to]; }).map(function (l) { return { id: l.id, from: l.from, to: l.to, type: l.type, label: l.auto ? '기본 규칙' : '', cable: '' }; });
    var m = { source: 'quick', site: { name: (D.site || '간이 현행화') + (window.TWINX_STANDALONE ? '' : ' (초안)'), building: D.buildings[0] ? D.buildings[0].name : '' }, floors: floors, rooms: rooms, assets: assets, links: links, risers: [], measurements: MS, updatedAt: new Date().toISOString() };
    applyGeom(m);
    return m;
  }
  /* 구조 편집(문·트레이·라이저, localStorage 'twinx_geom_v1')을 초안 모델에도 반영 — ADMIN 자료(10-data)와 같은 규칙 */
  function applyGeom(m) {
    var g = null; try { g = JSON.parse(localStorage.getItem('twinx_geom_v1') || 'null'); } catch (e) { }
    // 랙·U 입력(twinx_rack_v1)도 초안 설비에 반영 (묶음 설비는 초안 값 우선)
    var rk = null; try { rk = JSON.parse(localStorage.getItem('twinx_rack_v1') || 'null'); } catch (e) { }
    if (rk) m.assets.forEach(function (a) { var r = rk[a.id]; if (!r || a.rack) return; if (r.name) a.rack = { name: r.name, u: r.u0 != null ? pad(r.u0, 2) + 'U~' + pad(r.u1 != null ? r.u1 : r.u0, 2) + 'U' : '', u0: r.u0, u1: r.u1, size: r.size || 42, face: r.face, source: 'user', bundle: !!r.bundle }; });
    if (!g) return;
    var codes = m.floors.map(function (f) { return f.code; });
    Object.keys(g.doors || {}).forEach(function (rid) {
      var r = m.rooms.find(function (q) { return q.id === rid; }), d = g.doors[rid]; if (!r || !d) return;
      r.door = d.side; r.doorAt = d.side === 'none' ? null : (d.at != null ? +d.at : null); r.doorW = d.w ? +d.w : null; r.doorSrc = 'user';
    });
    m.floors.forEach(function (f) {
      var ut = g.trays && g.trays[f.code];
      if (ut && ut.length) f.trays = ut.map(function (t) { return { a: [+t.a[0], +t.a[1]], b: [+t.b[0], +t.b[1]], main: !!t.main, kind: 'user', path: t.path || null, source: 'user' }; });
    });
    if (g.risers && g.risers.length) m.risers = g.risers.map(function (r, i) {
      return { id: r.id || ('RU-' + (i + 1)), name: r.name || ('EPS 라이저 ' + (i + 1)), x: Math.round(+r.x), y: Math.round(+r.y), floors: (r.floors && r.floors.length ? r.floors : codes).filter(function (c) { return codes.indexOf(c) >= 0; }), rooms: [], estimated: false, source: 'user' };
    }).filter(function (r) { return isFinite(r.x) && isFinite(r.y) && r.floors.length; });
  }
  function apply() { if (D.active && D.floors.length) TX.setModel(toModel()); renderPanel(); }

  /* ---------------- ADMIN 등록용 엑셀 (6개 표준 시트 + 원본) ---------------- */
  function sheetsData() {
    var rooms = [['실코드', '건물코드', '건물명', '층코드', '층명', '실명', '실유형', 'X', 'Y', 'W', 'H']];
    D.rooms.forEach(function (r) { var f = D.floors.find(function (q) { return q.code === r.floor; }); rooms.push([r.id, f.bcode, f.building, f.code, f.name, r.name, r.kind, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]); });
    var assets = [['설비ID', '소속실', '설비명', '설비구분', '모델명', '제조사', '규격', '사진URL', 'X', 'Y', '상태', '설치일', '교체주기(개월)']];
    // 미배치 설비도 대장에는 남김: 실 없음 → 「실 미지정」 자리표시 실, 좌표 없음 → X·Y = -1 (ADMIN 필수값)
    var phFloors = {};
    D.assets.filter(function (a) { return !a.room; }).forEach(function (a) { phFloors[a.floor] = 1; });
    D.assets.forEach(function (a) { if (a.room && a.x == null) phFloors[a.floor] = 1; });
    // ADMIN 은 묶음을 모르므로, 묶음 모듈은 ADMIN 화면에서 겹치지 않게 실 안에 격자로 펼쳐 저장 (트윈은 대표 1개로 표시)
    var spread = {}, bgrp = {};
    D.assets.forEach(function (a) { if (a.bundle && a.room && a.x != null) (bgrp[a.room + '|' + a.bundle] = bgrp[a.room + '|' + a.bundle] || []).push(a); });
    Object.keys(bgrp).forEach(function (k) {
      var l = bgrp[k], r = D.rooms.find(function (q) { return q.id === l[0].room; }); if (!r || l.length < 2) return;
      var cols = Math.ceil(Math.sqrt(l.length * r.w / Math.max(1, r.h))), rows = Math.ceil(l.length / cols), cw = (r.w - 400) / cols, ch = (r.h - 400) / rows;
      l.forEach(function (a, i) { spread[a.id] = [Math.round(r.x + 200 + cw * ((i % cols) + 0.5)), Math.round(r.y + 200 + ch * (Math.floor(i / cols) + 0.5))]; });
    });
    D.assets.forEach(function (a) { var u = !a.room || a.x == null, sp = spread[a.id]; if (sp && !u) { a = Object.assign({}, a, { x: sp[0], y: sp[1] }); } assets.push([a.id, u ? a.floor + '-UNASSIGNED' : a.room, a.name, a.category, a.model, a.maker, [a.bundle ? '[묶음:' + a.bundle + (a.u0 != null ? ':U' + pad(a.u0, 2) + '-' + pad(a.u1 != null ? a.u1 : a.u0, 2) : '') + ']' : '', a.spec || '', a.year ? '설치연도 ' + a.year : '', a.serial ? 'S/N ' + a.serial : ''].filter(Boolean).join(' · '), a.photo || '', u ? 60 : Math.round(a.x), u ? 60 : Math.round(a.y), a.status, a.installed || '', a.cycle || '']); });
    Object.keys(phFloors).forEach(function (c) { var f = D.floors.find(function (q) { return q.code === c; }); if (f) rooms.push([c + '-UNASSIGNED', f.bcode, f.building, f.code, f.name, '실 미지정', '미지정', 10, 10, 100, 100]); });
    var ids = {}; D.assets.forEach(function (a) { ids[a.id] = 1; });
    var links = [['연결ID', '출발설비ID', '도착설비ID', '연결유형', '케이블번호', '출발단자', '도착단자', '연결상태']];
    D.links.filter(function (l) { return ids[l.from] && ids[l.to]; }).forEach(function (l) { links.push([l.id, l.from, l.to, l.rawType || { optical: '광', data: 'UTP', power: '전원' }[l.type] || '광', l.cable || '', l.p1 || '', l.p2 || '', l.lstatus || '정상']); });
    var hist = [['점검ID', '설비ID', '점검일', '점검자', '상태', '측정항목', '측정값', '단위', '비고', '작업구분']];
    var maps = [['층코드', '도면파일경로', '축척', '기준점X', '기준점Y', '도면너비', '도면높이']];
    // 05_도면매핑 = 실 범위 + 여유 2m (ADMIN 토폴로지 화면이 실 위주로 보이게). 도면 배경 전체 크기는 트윈이 따로 반영
    D.floors.forEach(function (f) {
      var rs = D.rooms.filter(function (r) { return r.floor === f.code; }).map(function (r) { return [r.x, r.y, r.x + r.w, r.y + r.h]; });
      if (phFloors[f.code]) rs.push([10, 10, 110, 110]);
      if (!rs.length) return;
      var x0 = Math.max(0, Math.min.apply(null, rs.map(function (q) { return q[0]; })) - 2000), y0 = Math.max(0, Math.min.apply(null, rs.map(function (q) { return q[1]; })) - 2000);
      var x1 = Math.max.apply(null, rs.map(function (q) { return q[2]; })) + 2000, y1 = Math.max.apply(null, rs.map(function (q) { return q[3]; })) + 2000;
      x0 = Math.floor(x0 / 10) * 10; y0 = Math.floor(y0 / 10) * 10;
      maps.push([f.code, '', 10, x0, y0, Math.ceil((x1 - x0) / 10), Math.ceil((y1 - y0) / 10)]);
    });
    var rules = [['규칙ID', '상태코드', '색상코드', '측정항목', '연산자', '임계값', '단위'], ['R01', '이상', '#f43f5e', '접지저항', '>', 10, 'Ω'], ['R02', '주의', '#f59e0b', '온도', '>=', 35, '℃']];
    var src = [['설비명', '규격(모델명)', '수량', '제조사', '설치 위치', '설치연도', '비고']];
    D.source.forEach(function (r) { src.push([r.name, r.model, r.qty, r.maker, r.loc, r.year || '확인불가', r.note]); });
    var meas = [['건물', '층', '점검 위치', '설비', '측정 항목', '측정값', '단위', '기준', '판정']];
    var out = [['01_건물층실', rooms], ['02_설비마스터', assets], ['03_연결관계', links], ['04_점검이력', hist], ['05_도면매핑', maps], ['06_상태규칙', rules], ['측정값 데이터', meas], ['현행화표_원본', src]];
    if (TX.pipe && TX.pipe.photoSheet) out.push(['현장사진_목록', TX.pipe.photoSheet(D)]);
    return out;
  }
  /* 최소 XLSX 작성기 (ZIP 무압축 저장 + inlineStr) — 외부 라이브러리 없이 오프라인 동작 */
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; } function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data || enc.encode(f.text), crc = crc32(data);
      var head = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, data);
      central.push([[].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off)), name]);
      off += head.length + name.length + data.length;
    });
    var cdStart = off, cdLen = 0;
    central.forEach(function (c) { var h = new Uint8Array(c[0]); parts.push(h, c[1]); cdLen += h.length + c[1].length; });
    parts.push(new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(cdLen), u32(cdStart), u16(0))));
    return new Blob(parts, { type: files.mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function colName(i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function xmlEsc(v) { return String(v).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function sheetXML(rows) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rows.map(function (r, ri) {
        return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) {
          var ref = colName(ci) + (ri + 1);
          if (v === '' || v == null) return '';
          if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + (ri === 0 ? ' s="1"' : '') + '><v>' + v + '</v></c>';
          return '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
        }).join('') + '</row>';
      }).join('') + '</sheetData></worksheet>';
  }
  function buildXlsx(sheets) {
    var sh = sheets || sheetsData(), files = [];
    files.push({ name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sh.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>' });
    files.push({ name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sh.map(function (s, i) { return '<sheet name="' + xmlEsc(s[0]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sh.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sh.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
    files.push({ name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>' });
    sh.forEach(function (s, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXML(s[1]) }); });
    return zip(files);
  }
  function exportXlsx(silent) {
    var unplaced = D.assets.filter(function (a) { return !a.room; }).length;
    if (!D.rooms.length) { toast('실이 없습니다. ③ 실 그리기를 먼저 진행하세요', 'warn'); return null; }
    var d = new Date(), stamp = d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2), name = 'ICT_Twin_Quick_' + stamp + '.xlsx';
    U.download(buildXlsx(), name);
    if (!silent) toast('ADMIN 등록용 엑셀을 내보냈습니다' + (unplaced ? ' · 미배치 설비 ' + unplaced + '대는 「미배치」로 등록 (도면에는 표시 안 함)' : ''), 'success');
    return name;
  }

  /* ---------------- ADMIN 층 → 초안 (같은 층코드 유지 → 도면 배경·구조 입력 그대로) ---------------- */
  function startFloors(list, keepDraft) {
    if (!keepDraft) { D = blank(); }
    D.active = true;
    list.forEach(function (f) {
      if (D.floors.some(function (x) { return x.code === f.code; })) return;
      var b = D.buildings.find(function (x) { return x.name === f.building; });
      if (!b) { b = { code: f.bcode || 'BD' + pad(D.buildings.length + 1, 2), name: f.building || '본관' }; D.buildings.push(b); }
      // 등록된 도면 배경이 있으면 층 크기 = 도면 크기 (실 하나 크기로 줄지 않게)
      var ul = TX.underlay && TX.underlay.get && TX.underlay.get(f.code), uw = 0, uh = 0;
      if (ul && ul.tf) { uw = Math.round(ul.tf.tx + ul.w * ul.tf.s); uh = Math.round(ul.tf.ty + ul.h * ul.tf.s); }
      D.floors.push({ code: f.code, building: b.name, bcode: b.code, name: f.name, level: f.level, w: Math.max(f.w || 40000, uw), h: Math.max(f.h || 25000, uh) });
    });
    if (!D.site && D.buildings[0]) D.site = D.buildings[0].name;
    save();
  }
  /** 현재 ADMIN 자료의 층을 초안으로 불러와 편집 (실·설비·연결 ID 유지 → 등록 시 그 층만 교체) */
  function loadFromAdmin(codes) {
    var M = (TX.model && TX.model.source === 'admin') ? TX.model : (TX.data && TX.data.read && TX.data.read());
    if (!M) { toast('ADMIN 자료를 읽지 못했습니다', 'error'); return 0; }
    var set = {}; codes.forEach(function (c) { set[c] = 1; });
    startFloors(M.floors.filter(function (f) { return set[f.code]; }).map(function (f) { var b = f.bounds || {}; return { code: f.code, building: f.building, name: f.name, level: f.level, w: Math.max(40000, (b.x1 || 0)), h: Math.max(25000, (b.y1 || 0)) }; }), D.active && D.floors.length);
    var KIND = {}; ROOM_TYPES.forEach(function (t) { KIND[t[1]] = KIND[t[1]] || t[0]; });
    M.rooms.filter(function (r) { return set[r.floor]; }).forEach(function (r) {
      if (D.rooms.some(function (x) { return x.id === r.id; })) return;
      var raw = r.raw || {}; D.rooms.push({ id: r.id, floor: r.floor, name: r.name, kind: raw.실유형 || KIND[r.type] || '통신실', x: r.x, y: r.y, w: r.w, h: r.h });
    });
    var ids = {};
    M.assets.filter(function (a) { return set[a.floor]; }).forEach(function (a) {
      if (D.assets.some(function (x) { return x.id === a.id; })) return;
      var raw = a.raw || {}; ids[a.id] = 1;
      D.assets.push({ id: a.id, tag: tagOf(a), name: a.name, model: a.model, maker: a.maker, year: '', note: '', floor: a.floor, room: a.unplaced ? null : a.room, x: a.unplaced ? null : a.x, y: a.unplaced ? null : a.y,
        status: a.status || '정상', category: a.category, srcLoc: '', roomHint: (function () { var m = /\[원위치:([^\]]+)\]/.exec(raw.규격 || ''); var r0 = m && M.rooms.find(function (q) { return q.id === m[1]; }); return r0 ? r0.name : (m ? m[1] : ''); })(), spec: String(raw.규격 || '').replace(/\[묶음[^\]]*\]\s*(·\s*)?/, '').replace(/\[원위치:[^\]]*\]\s*/g, '').trim(), photo: raw.사진URL || '', installed: raw.설치일 || '', cycle: raw['교체주기(개월)'] || '',
        bundle: a.rack && a.rack.bundle ? a.rack.name : undefined, u0: a.rack && a.rack.bundle ? a.rack.u0 : undefined, u1: a.rack && a.rack.bundle ? a.rack.u1 : undefined });
    });
    M.links.filter(function (l) { return ids[l.from] && ids[l.to]; }).forEach(function (l) { var raw = l.raw || {}; D.links.push({ id: l.id, from: l.from, to: l.to, type: l.type, auto: false, cable: l.cable, rawType: raw.연결유형, p1: raw.출발단자, p2: raw.도착단자, lstatus: raw.연결상태 }); });
    D.autoLinks = false;
    save(); apply();
    return D.assets.length;
  }

  /* ---------------- 도면이 없을 때: 현행화표 기반 자동 작도 ---------------- */

  function autoDraw(codes, all) {
    var made = { rooms: 0, assets: 0, skipped: 0 };
    codes.forEach(function (code) {
      var f = D.floors.find(function (x) { return x.code === code; }); if (!f) return;
      var hasPlan = TX.underlay && TX.underlay.get(code);
      // 전체 작도: 도면(사진·PDF)이 있는데 실이 아직 없는 층은 사용자가 도면 위에 그리도록 건너뜀
      if (all && hasPlan && !D.rooms.some(function (r) { return r.floor === code; })) { made.skipped++; return; }
      var un = D.assets.filter(function (a) { return a.floor === code && !a.room; });
      var have = D.rooms.filter(function (r) { return r.floor === code; });
      var groups = {}, order = [];
      var mates = {};
      un = un.filter(function (a) { if (!a.bundle) return true; if (mates[a.bundle]) { mates[a.bundle].push(a); return false; } mates[a.bundle] = [a]; return true; });
      un.forEach(function (a) { var g = (a.roomHint || '').trim() || '통신실'; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(a); });
      var CELL = 1500, x = 2000, Y0 = 2000, maxH = 4200, newRooms = [];
      if (!have.length) {
        order.forEach(function (g) {
          var n = groups[g].length, cols = Math.max(2, Math.ceil(Math.sqrt(n))), rows = Math.ceil(n / cols);
          var w = Math.max(4200, cols * CELL + 1200), h = Math.max(4200, rows * CELL + 1200);
          var kind = (ROOM_TYPES.find(function (t) { return g.indexOf(t[0].replace('실', '')) >= 0; }) || ['통신실'])[0];
          newRooms.push({ name: g.indexOf(f.name) === 0 ? g : f.name + ' ' + g, kind: kind, x: x, y: Y0, w: w, h: h, list: groups[g] });
          x += w + 600; maxH = Math.max(maxH, h);
        });
        if (!newRooms.length) newRooms.push({ name: f.name + ' 통신실', kind: '통신실', x: x, y: Y0, w: 3600, h: 3600, list: [] }), x += 4200;
        newRooms.push({ name: f.name + ' 계단실', kind: '계단실', x: x, y: Y0, w: 3000, h: maxH, list: [] }); x += 3000;
        newRooms.push({ name: f.name + ' 복도', kind: '복도', x: 2000, y: Y0 + maxH, w: x - 2000, h: 1800, list: [] });
        newRooms.forEach(function (r) {
          var n = 1; while (D.rooms.some(function (q) { return q.id === code + '-R' + pad(n, 2); })) n++;
          r.id = code + '-R' + pad(n, 2); D.rooms.push({ id: r.id, floor: code, name: r.name, kind: r.kind, x: r.x, y: r.y, w: r.w, h: r.h, auto: true }); made.rooms++;
        });
        if (hasPlan) { f.w = Math.max(f.w, x + 2000); f.h = Math.max(f.h, Y0 + maxH + 1800 + 2000); } else { f.w = x + 2000; f.h = Y0 + maxH + 1800 + 2000; } f.auto = true;
      } else {
        var tel = have.find(function (r) { return TYPE_OF[r.kind] === 'telecom'; }) || have[0];
        order.forEach(function (g) { var r = have.find(function (q) { return q.name.indexOf(g) >= 0 || g.indexOf(q.name) >= 0; }) || tel; newRooms.push({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, list: groups[g] }); });
      }
      newRooms.forEach(function (r) {
        var n = r.list.length; if (!n) return;
        var cols = Math.max(1, Math.floor((r.w - 600) / CELL)), sx = r.x + 600 + CELL / 2 - CELL / 2, sy = r.y + 600;
        r.list.forEach(function (a, i) {
          a.room = r.id; a.x = Math.round(Math.min(r.x + r.w - 300, sx + (i % cols) * CELL + 300)); a.y = Math.round(Math.min(r.y + r.h - 300, sy + Math.floor(i / cols) * CELL + 300)); made.assets++;
          if (a.bundle && mates[a.bundle]) mates[a.bundle].forEach(function (m) { m.room = a.room; m.x = a.x; m.y = a.y; });
        });
      });
    });
    autoLink(); save(); apply();
    if (TX.cad2d && TX.cad2d.fit) setTimeout(TX.cad2d.fit, 60);
    return made;
  }
  function photoBtn(a) {
    if (!TX.pipe) return '';
    var c = TX.pipe.photos.count(a.id), ok = c.full && c.plate;
    return '<button type="button" class="tx-wb-link tx-qk-ph' + (ok ? ' is-ok' : c.total ? ' is-part' : '') + '" data-q="ph" data-id="' + esc(a.id) + '" title="전경·명판·모듈 사진">📷 ' + c.total + (a.plateOk ? ' ✔' : '') + '</button>';
  }
  function assetOpts() { return D.assets.map(function (a) { var f = D.floors.find(function (x) { return x.code === a.floor; }) || {}; return '<option value="' + esc(a.id) + '">' + esc((f.building || '') + ' ' + (f.name || '') + ' · ' + a.name) + '</option>'; }).join(''); }

  /* ---------------- 패널 ---------------- */
  var P = null, step = 1, sel = null, cap = null;
  var tool = { roomName: '', roomKind: '통신실', placeId: null };
  function curFloor() { var f = TX.state.floor; return D.floors.find(function (x) { return x.code === f; }) ? f : (D.floors[0] && D.floors[0].code); }
  function fl() { return D.floors.find(function (x) { return x.code === curFloor(); }); }
  function setActive(on) {
    D.active = !!on; save();
    if (on) { if (D.floors.length) { TX.setModel(toModel()); TX.setState({ floor: curFloor(), view: TX.state.view === '3d' ? '2d' : TX.state.view }); } }
    else { stopTool(); if (TX.data && TX.data.refresh) TX.data.refresh(true); }
  }
  function open() {
    if (!TX.state.open) TX.open({ view: '2d' });
    if (!P) { P = U.el('div', 'tx-wb-panel tx-qk'); root().appendChild(P); bind(); }
    // 패널은 우측(인스펙터 자리)에 두고 인스펙터를 접어 도면 작업 영역 확보
    if (TX.state.panel && TX.state.panel.inspector) TX.setState({ panel: { inspector: false } });
    setTimeout(function () { if (TX.cad2d && TX.cad2d.fit) TX.cad2d.fit(); }, 350);
    if (!D.active) setActive(true);
    if (TX.state.view === '3d') TX.setState({ view: '2d' });
    renderPanel(); startTool();
  }
  function close(keep) { closeEd(true); if (P) { P.remove(); P = null; } stopTool(); if (!keep && D.active && !window.TWINX_STANDALONE) setActive(false); }
  var STEPS = ['현행화·사진', '도면 확보', '실 그리기', '설비 배치', '검증·내보내기'];
  function renderPanel() {
    if (!P) return;
    if (ed && step !== 3) closeEd(true);
    var f = fl(), code = f && f.code;
    var placed = D.assets.filter(function (a) { return a.room; }).length;
    var h = '<div class="tx-wb-hd"><div><small>' + (window.TWINX_STANDALONE ? '설비·도면 등록 · 단독 운영판' : '간이 현행화 모드 · 초안 (ADMIN 등록 전)') + '</small><b>' + esc(D.site || '사업장 미정') + '</b><span class="tx-qk-saved" data-r="saved">' + savedText() + '</span></div><button type="button" class="tx-wb-x" data-q="close" aria-label="닫기">✕</button></div>' +
      '<div class="tx-qk-steps">' + STEPS.map(function (s, i) { var dn = stepDone(i + 1); return '<button type="button" data-q="step" data-k="' + (i + 1) + '" class="' + (step === i + 1 ? 'is-on' : '') + (dn ? ' is-done' : '') + '"><i>' + (dn ? '✔' : i + 1) + '</i>' + s + '</button>'; }).join('') + '</div>' +
      '<div class="tx-qk-sum">건물 ' + D.buildings.length + ' · 층 ' + D.floors.length + ' · 실 ' + D.rooms.length + ' · 설비 ' + placed + '/' + D.assets.length + ' 배치 · 연결 ' + D.links.length + '</div>' +
      (D.floors.length && step > 1 ? '<label class="tx-qk-floor">작업 층<select data-q="floor">' + D.floors.map(function (x) { return '<option value="' + esc(x.code) + '"' + (x.code === code ? ' selected' : '') + '>' + esc(x.building + ' ' + x.name) + ' (' + esc(x.code) + ')</option>'; }).join('') + '</select></label>' : '') +
      '<div class="tx-wb-body">';
    if (step === 1) {
      h += '<p class="tx-wb-guide">설비 현행화표(설비명·규격·수량·제조사·설치 위치·설치연도·비고)를 <b>엑셀·한글 표에서 복사해 붙여넣으세요</b>. 수량만큼 설비가 만들어지고, 설치 위치(예: 「본관 7층」)로 건물·층이 자동 생성됩니다. 「확인불가」는 빈 값으로 처리합니다. 설비마다 <b>📷 사진</b>(전경·명판·모듈)을 붙이고 명판의 모델명·S/N을 옮겨 적으면 「확인불가」가 채워집니다.</p>' +
        '<label class="tx-qk-lbl">사업장 이름<input type="text" data-q="site" value="' + esc(D.site) + '" placeholder="예: ○○청사"></label>' +
        '<textarea data-q="paste" class="tx-qk-paste" placeholder="장비명(설비명)\t모델명\t제조사\t수량\t(설치 위치)\nDivider\tSKC-DV508\tMplus\t1\n8VSB Remodulator\tSKRM-510\tMplus\t5"></textarea>' +
        pvHTML() +
        '<label class="tx-wb-chk"><input type="checkbox" data-q="bundleQty"' + (D.bundleQty !== false ? ' checked' : '') + '> 수량 2대 이상(같은 위치·같은 장비)은 <b>묶음 1개</b>로 배치 · 모듈은 슬롯에 표시</label>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn tx-wb-pri" data-q="import">표 불러오기</button><button type="button" class="tx-wb-btn" data-q="addfloor">층 직접 추가</button>' + (window.TWINX_STANDALONE ? '' : '<button type="button" class="tx-wb-btn" data-q="fromadmin">ADMIN 층 불러와 편집</button>') + '</div>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn tx-wb-pri" data-q="xlsfile">엑셀 파일 올리기</button><button type="button" class="tx-wb-link" data-q="tpl">등록 양식 받기 (설비 34종 포함)</button></div>' +
        (D.assets.length ? '<h5>생성된 설비 <span class="tx-count">' + D.assets.length + '</span></h5><ul class="tx-wb-list tx-qk-alist">' + D.assets.map(function (a) {
          return '<li><span><b>' + esc(a.name) + (a.bundle ? ' <em class="tx-qk-bn" title="묶음: 도면에는 1개로 배치">▣ ' + esc(a.bundle) + '</em>' : '') + '</b><small>' + esc(a.id) + ' · ' + esc((D.floors.find(function (x) { return x.code === a.floor; }) || {}).building || '') + ' ' + esc((D.floors.find(function (x) { return x.code === a.floor; }) || {}).name || '') + (a.model ? ' · ' + esc(a.model) : '') + '</small></span>' + photoBtn(a) + '<button type="button" class="tx-wb-link tx-wb-danger" data-q="adel" data-id="' + esc(a.id) + '">삭제</button></li>';
        }).join('') + '</ul>' : '');
    } else if (step === 2) {
      var ul = code && TX.underlay && TX.underlay.get(code);
      h += '<p class="tx-wb-guide">이 층의 <b>대피소 도면(또는 종이도면) 사진</b>을 올리고, 길이를 아는 두 점(벽 양 끝, 복도 길이 등)을 클릭한 뒤 <b>실측 거리(mm)</b>를 입력하면 축척이 맞춰집니다. 사진은 정면에서 찍을수록 정확합니다.</p>' +
        (ul ? '<div class="tx-wb-file"><b>' + esc(ul.name || '도면 사진') + '</b><span>' + ul.w + '×' + ul.h + 'px · 1px = ' + ul.tf.s.toFixed(2) + 'mm · 도면 ' + (ul.w * ul.tf.s / 1000).toFixed(1) + '×' + (ul.h * ul.tf.s / 1000).toFixed(1) + 'm</span></div>' : '') +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn ' + (ul ? '' : 'tx-wb-pri') + '" data-q="photo">' + (ul ? '도면 교체' : '도면 올리기 (사진·PDF)') + '</button>' +
        (ul ? '<button type="button" class="tx-wb-btn tx-wb-pri" data-q="scale">치수로 축척 맞춤</button><button type="button" class="tx-wb-btn" data-q="rot">90° 회전</button>' : '') + '</div>' +
        '<label class="tx-qk-lbl">실측 거리 (mm)<input type="number" min="100" step="10" data-q="dist" value="' + (tool.dist || '') + '" placeholder="예: 12000 (복도 12m)"></label>' +
        (ul ? '<label class="tx-wb-rng">사진 투명도 <input type="range" min="10" max="100" step="5" data-q="op" value="' + Math.round(ul.opacity * 100) + '"><output>' + Math.round(ul.opacity * 100) + '%</output></label>' : '') +
        '<p class="tx-wb-help">실측 치수가 없으면 종이도면의 치수 표기나 표준 문 폭(약 900mm)을 기준으로 사용해도 됩니다. PDF 도면은 선택한 페이지를 고해상도 이미지로 바꿔 올립니다.</p>' +
        (function () {
          var nR = D.rooms.filter(function (r) { return r.floor === code; }).length, out = outsideCount(code);
          if (!ul || !nR) return '';
          return '<div class="tx-qk-alt tx-qk-align"><b>기존 실·설비를 도면에 맞추기 (좌표 정합)</b><span>이 층에 이미 실 ' + nR + '개가 있습니다' + (out ? ' · <em>도면 밖 실 ' + out + '개</em>' : ' · 모두 도면 범위 안') + '. 도면 사진을 먼저 축척 맞춤한 뒤, 데이터 기준점 A·B와 도면상 위치 A′·B′를 차례로 찍으면 실·설비·트레이가 함께 이동·축척됩니다 (도곽·여백이 아닌 건물 외벽·기둥을 기준으로).</span>' +
            '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn tx-wb-pri" data-q="align">4점으로 맞추기</button>' + (D._alignUndo ? '<button type="button" class="tx-wb-btn" data-q="alignundo">되돌리기</button>' : '') + '</div></div>';
        })() +
        '<div class="tx-qk-alt"><b>도면이 전혀 없나요?</b><span>현행화표의 설치 위치를 기준으로 층마다 통신실(또는 표기된 실)·복도·계단실을 자동으로 만들고 설비를 격자로 배치합니다. 이후 ③·④에서 고칠 수 있고, ⑤에서 라이저도·개통도를 자동 작도합니다.</span>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn" data-q="autodraw">이 층 자동 작도</button><button type="button" class="tx-wb-btn" data-q="autodrawall">전체 층 자동 작도</button></div></div>';
    } else if (step === 3) {
      var rs = D.rooms.filter(function (r) { return r.floor === code; });
      h += '<p class="tx-wb-guide">도면 위에서 <b>실의 한 모서리에서 대각선 모서리까지 끌어서</b> 사각형을 그립니다(100mm 단위 정렬). 그리기 전에 실 이름·유형을 정하세요. 도면 이동은 「그리기 중지」 후 드래그. <b>그린 실을 클릭</b>하면 형틀 크기·위치와 출입문을 고칠 수 있습니다.</p>' +
        '<div class="tx-wb-row2"><label>실 이름<input type="text" data-q="rname" value="' + esc(tool.roomName) + '" placeholder="예: 7층 EPS실"></label>' +
        '<label>유형<select data-q="rkind">' + ROOM_TYPES.map(function (t) { return '<option' + (t[0] === tool.roomKind ? ' selected' : '') + '>' + t[0] + '</option>'; }).join('') + '</select></label></div>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn ' + (cap && cap.mode === 'room' ? 'tx-wb-pri' : '') + '" data-q="rtool">' + (cap && cap.mode === 'room' ? '■ 그리기 중지' : '✎ 실 그리기 시작') + '</button></div>' +
        edPanel() +
        '<h5>이 층의 실 <span class="tx-count">' + rs.length + '</span></h5>' +
        (rs.length ? '<ul class="tx-wb-list">' + rs.map(function (r) { return '<li><span><input type="text" class="tx-qk-rin" data-q="rren" data-id="' + esc(r.id) + '" value="' + esc(r.name) + '"><small>' + esc(r.kind) + ' · ' + (r.w / 1000).toFixed(1) + '×' + (r.h / 1000).toFixed(1) + 'm · ' + esc(r.id) + '</small></span><button type="button" class="tx-wb-link' + (ed && ed.id === r.id ? ' is-on' : '') + '" data-q="red" data-id="' + esc(r.id) + '">' + (ed && ed.id === r.id ? '편집 중' : '형틀·문 편집') + '</button><button type="button" class="tx-wb-link tx-wb-danger" data-q="rdel" data-id="' + esc(r.id) + '">삭제</button></li>'; }).join('') + '</ul>' : '<p class="tx-wb-empty">아직 없음 · 통신실·EPS·복도·계단 위주로 그리면 충분합니다</p>');
    } else if (step === 4) {
      var seenB = {}, as = D.assets.filter(function (a) { if (a.floor !== code) return false; if (!a.bundle) return true; if (seenB[a.bundle]) { seenB[a.bundle]++; return false; } seenB[a.bundle] = 1; return true; });
      h += '<p class="tx-wb-guide">목록에서 설비를 고른 뒤 <b>도면의 설치 위치를 클릭</b>하세요(실 안). 배치하면 다음 미배치 설비가 자동 선택됩니다.</p>' +
        (as.length ? '<ul class="tx-wb-list tx-qk-alist">' + as.map(function (a) {
          var r = a.room && D.rooms.find(function (q) { return q.id === a.room; });
          return '<li class="' + (tool.placeId === a.id ? 'is-sel' : '') + '"><span><b>' + (a.bundle ? '▣ ' + esc(a.bundle) + ' <em class="tx-qk-bn">모듈 ' + seenB[a.bundle] + '</em>' : esc(a.name)) + '</b><small>' + (r ? '📍 ' + esc(r.name) : '<em class="tx-qk-un">미배치</em>') + (a.roomHint ? ' · 표기: ' + esc(a.roomHint) : '') + (a.model ? ' · ' + esc(a.model) : '') + '</small></span>' +
            photoBtn(a) + '<button type="button" class="tx-wb-link" data-q="pick" data-id="' + esc(a.id) + '">' + (tool.placeId === a.id ? '클릭 대기' : r ? '다시 배치' : '배치') + '</button></li>';
        }).join('') + '</ul>' : '<p class="tx-wb-empty">이 층의 설비가 없습니다 (① 현행화표에서 생성)</p>');
    } else {
      h += '<label class="tx-wb-chk"><input type="checkbox" data-q="auto"' + (D.autoLinks ? ' checked' : '') + '> 기본 연결 규칙: 같은 층 OFD → 광중계기·5G RU (광)</label>' +
        '<h5>연결 <span class="tx-count">' + D.links.length + '</span></h5>' +
        (D.assets.length > 1 ? '<div class="tx-qk-link"><select data-q="lfrom">' + assetOpts() + '</select><span>→</span><select data-q="lto">' + assetOpts() + '</select><select data-q="ltype"><option value="optical">광</option><option value="data">UTP</option><option value="power">전원</option></select><button type="button" class="tx-wb-btn" data-q="ladd">연결 추가</button></div>' : '') +
        (D.links.length ? '<ul class="tx-wb-list">' + D.links.map(function (l) { var a = D.assets.find(function (x) { return x.id === l.from; }), b = D.assets.find(function (x) { return x.id === l.to; }); return '<li><span><b>' + esc(a ? a.name : l.from) + ' → ' + esc(b ? b.name : l.to) + '</b><small>' + ({ optical: '광', data: 'UTP', power: '전원' }[l.type] || '광') + ' · ' + (l.auto ? '기본 규칙' : '수동') + (a && b && a.floor !== b.floor ? ' · 층간(라이저)' : '') + '</small></span><button type="button" class="tx-wb-link tx-wb-danger" data-q="ldel" data-id="' + esc(l.id) + '">삭제</button></li>'; }).join('') + '</ul>' : '<p class="tx-wb-empty">연결 없음 (같은 층에 OFD가 없으면 규칙이 적용되지 않습니다)</p>') +
        '<div class="tx-qk-check">' + checks().map(function (c) { return '<div class="' + (c[1] ? 'ok' : 'ng') + '">' + (c[1] ? '✔ ' : '✖ ') + esc(c[0]) + '</div>'; }).join('') + '</div>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn" data-q="diag">라이저도·개통도 자동 작도</button>' + (TX.pipe ? '<button type="button" class="tx-wb-btn" data-q="phzip">현장 사진 ZIP</button>' : '') + '</div>' +
        finishCard() +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn" data-q="export">엑셀만 내보내기</button>' + (TX.pipe ? '<button type="button" class="tx-wb-btn" data-q="report">점검 결과서 변환</button>' : '') + '</div>' +
        '<p class="tx-wb-help">내보낸 파일 → ADMIN <b>데이터 관리 → 엑셀 등록 → 「전체 교체 적용」</b>. 이후 점검 결과서는 <b>측정 대시보드 → 측정 엑셀 등록</b>으로 올리고 「측정 매칭 확인」에서 연결하세요. 「현행화표_원본」 시트에 설치연도·비고 원문이 보존됩니다.</p>' +
        '<div class="tx-wb-acts tx-wb-acts-2"><button type="button" class="tx-wb-link" data-q="jexport">초안 백업(JSON)</button><button type="button" class="tx-wb-link" data-q="jimport">초안 불러오기</button><button type="button" class="tx-wb-link tx-wb-danger" data-q="reset">초안 전체 삭제</button></div>';
    }
    h += '</div><div class="tx-qk-ft"><button type="button" class="tx-wb-btn" data-q="prev"' + (step === 1 ? ' disabled' : '') + '>← 이전</button><button type="button" class="tx-wb-btn tx-wb-pri" data-q="next"' + (step === 5 ? ' disabled' : '') + '>다음 →</button></div>';
    P.innerHTML = h;
    var st = cap && cap.bar; if (st) updateBar();
  }
  /* ---------------- 단계 완료 표시 · 최종 완료(저장·적용) ---------------- */
  function stepDone(n) {
    var used = D.floors.filter(function (f) { return D.assets.some(function (a) { return a.floor === f.code; }); });
    if (n === 1) return D.assets.length > 0;
    if (n === 2) return used.length > 0 && used.every(function (f) { return f.auto || (TX.underlay && TX.underlay.get(f.code)) || D.rooms.some(function (r) { return r.floor === f.code; }); });
    if (n === 3) return used.length > 0 && used.every(function (f) { return D.rooms.some(function (r) { return r.floor === f.code; }); });
    if (n === 4) return D.assets.length > 0 && D.assets.every(function (a) { return a.room; });
    return !!(D.done && !D.done.dirty);
  }
  /* 붙여넣은 표 미리보기 · 설치 위치 · 랙(묶음) 지정 */
  function pvHTML() {
    var pv = tool.pv; if (!pv) return '';
    var units = pv.rows.reduce(function (n, r) { return n + r.qty; }, 0);
    var needLoc = !pv.hasLoc || pv.forceLoc, fr = D.rooms.filter(function (r) { return r.floor === pv.floor; });
    return '<div class="tx-qk-pv"><b>등록 미리보기 · ' + pv.rows.length + '종 ' + units + '대</b>' +
      '<div class="tx-qk-pvt"><table><thead><tr><th>장비명</th><th>모델명</th><th>제조사</th><th>수량</th>' + (pv.hasLoc ? '<th>위치</th>' : '') + '</tr></thead><tbody>' +
      pv.rows.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.model) + '</td><td>' + esc(r.maker) + '</td><td>' + r.qty + '</td>' + (pv.hasLoc ? '<td>' + esc(r.loc) + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' +
      '<h5>이 장비들은 같은 랙 설비인가요?</h5>' +
      '<label class="tx-wb-chk"><input type="radio" name="pvg" data-q="pvgroup" value="one"' + (pv.group === 'one' ? ' checked' : '') + '> <b>예, 하나의 랙(묶음)</b> — 도면에는 설비 1개, 선택하면 모듈 ' + units + '개를 슬롯별로 표시</label>' +
      (pv.group === 'one' ? '<label class="tx-qk-lbl">랙(묶음) 이름<input type="text" data-q="pvbname" value="' + esc(pv.bname) + '" placeholder="예: UHD 방송 랙 #1"></label>' : '') +
      '<label class="tx-wb-chk"><input type="radio" name="pvg" data-q="pvgroup" value="perRow"' + (pv.group === 'perRow' ? ' checked' : '') + '> 같은 장비(수량 2대 이상)끼리만 묶기</label>' +
      '<label class="tx-wb-chk"><input type="radio" name="pvg" data-q="pvgroup" value="none"' + (pv.group === 'none' ? ' checked' : '') + '> 묶지 않기 (1대씩 따로 배치)</label>' +
      (pv.hasLoc ? '<label class="tx-wb-chk"><input type="checkbox" data-q="pvforce"' + (pv.forceLoc ? ' checked' : '') + '> 표의 위치 대신 아래 위치로 모두 등록</label>' : '<p class="tx-wb-help">표에 설치 위치 열이 없어 아래에서 위치를 고릅니다.</p>') +
      (needLoc ? '<div class="tx-wb-row2"><label>설치 층<select data-q="pvfloor">' + D.floors.map(function (f) { return '<option value="' + esc(f.code) + '"' + (f.code === pv.floor ? ' selected' : '') + '>' + esc(f.building + ' ' + f.name) + '</option>'; }).join('') + '<option value="__new"' + (pv.floor === '__new' || !D.floors.length ? ' selected' : '') + '>새 위치 입력…</option></select></label>' +
        (pv.floor === '__new' || !D.floors.length ? '<label>건물·층·실<input type="text" data-q="pvnew" value="' + esc(pv.newLoc) + '" placeholder="예: 본관 3층 통신실"></label>' : '<label>실 (선택 시 바로 배치)<select data-q="pvroom"><option value="">나중에 배치</option>' + fr.map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === pv.room ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') + '</select></label>') + '</div>' : '') +
      '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn tx-wb-pri" data-q="pvok">등록</button><button type="button" class="tx-wb-btn" data-q="pvcancel">취소</button></div></div>';
  }
  /** 단독 운영판: 이 PC 에 저장(자동 저장은 항상) + 복원용 백업 파일 */
  function saveLocal() {
    var cs = checks(), must = [cs[0], cs[2]].filter(function (c) { return !c[1]; });
    if (must.length) { toast('완료할 수 없습니다: ' + must.map(function (c) { return c[0]; }).join(' / '), 'warn'); return; }
    var nb = {}; D.assets.forEach(function (a) { if (a.bundle) nb[a.floor + '|' + a.bundle] = 1; });
    save();
    D.done = { at: new Date().toISOString(), dirty: false, file: '이 PC 저장소', summary: '건물 ' + D.buildings.length + ' · 층 ' + D.floors.length + ' · 실 ' + D.rooms.length + ' · 설비 ' + D.assets.length + '대 (묶음 ' + Object.keys(nb).length + ') · 연결 ' + D.links.length + ' · 측정 ' + (D.measurements || []).length };
    try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { }
    renderPanel();
    if (TX.adminSync && TX.adminSync.backup && confirm('저장했습니다.\n복원용 백업 파일(도면 포함)도 내려받을까요?')) TX.adminSync.backup('단독 운영판 저장');
    else toast('저장했습니다 (이 PC · 자동 저장)', 'success');
  }
  function downloadTemplate() {
    var T = (TX.eqTypes && TX.eqTypes.list) || [];
    var reg = [['No', '장비명', '설비구분', '모델명', '제조사', '수량', '위치', '설치연도', '비고'],
      [1, 'L2 스위치', '네트워크 설비', 'SW-24P', '시범 제조사', 1, '본관 3층 통신실', 2021, ''],
      [2, '8VSB Remodulator', '방송 공동수신 안테나 시설', 'SKRM-510', 'Mplus', 5, '본관 3층 방송실', '', '같은 랙이면 등록 창에서 「하나의 랙」 선택'],
      [3, 'UPS', '통신용 전원 설비', 'UPS-3K', '', 1, '본관 B1층 전기실', '', '']];
    var types = [['No', '설비구분 (정보통신설비 34종)', '분류']].concat(T.map(function (t) { return [t.no, t.name, t.group]; }));
    var guide = [['항목', '작성 방법'], ['장비명', '필수 · 명판 기준 장비 이름'], ['설비구분', '「설비구분_34종」 시트의 이름 그대로 (예: 네트워크 설비). 비우면 장비명으로 추정'],
      ['수량', '같은 장비 여러 대는 숫자로 (등록 창에서 하나의 랙으로 묶을 수 있음)'], ['위치', '「건물 층 실」 순서 (예: 본관 3층 통신실). 도면에 같은 이름의 실을 그리면 설비가 자동 배치'],
      ['결과서', '점검 결과서(워드·PDF·엑셀)는 「현행화 ▾ → 점검 결과서 변환」에서 올리면 설비에 연결되어 상태 색으로 표시']];
    U.download(buildXlsx([['설비등록', reg], ['설비구분_34종', types], ['작성안내', guide]]), 'ICT_Twin_Equipment_Form.xlsx');
  }
  /** 한 번에: 점검 → (층 단위 병합) → ADMIN 검증·적용 자동 진행 → 결과 확인 */
  function saveAdmin() {
    var cs = checks(), must = [cs[0], cs[2]].filter(function (c) { return !c[1]; });
    if (must.length) { toast('저장할 수 없습니다: ' + must.map(function (c) { return c[0]; }).join(' / '), 'warn'); return; }
    var sync = TX.adminSync; if (!sync) { toast('저장 모듈이 없습니다', 'error'); return; }
    var rawT = sync.raw(), codes = D.floors.map(function (f) { return f.building + ' ' + f.name; }).join(', ');
    var unpl = D.assets.filter(function (a) { return !a.room || a.x == null; }).length;
    if (!confirm('ADMIN에 저장합니다.\n\n· 대상 층: ' + codes + ' (이 층만 교체, 다른 층은 유지)\n· 설비 ' + D.assets.length + '대' + (unpl ? ' (미배치 ' + unpl + '대는 「미배치」로 저장)' : '') + ' · 실 ' + D.rooms.length + ' · 연결 ' + D.links.length + '\n· 실행 전 복원용 백업을 저장합니다\n\n계속할까요?')) return;
    var t = rawT && rawT.rooms.length ? sync.merge(rawT, sheetsData()) : null;
    if (!t) { t = { rooms: [], assets: [], links: [], history: [], maps: [], rules: (rawT && rawT.rules) || [] }; t = sync.merge(t, sheetsData()); if (!t.rules.length) t.rules = [{ 규칙ID: 'R01', 상태코드: '이상', 색상코드: '#f43f5e', 측정항목: '접지저항', 연산자: '>', 임계값: 10, 단위: 'Ω' }]; }
    var nb = {}; D.assets.forEach(function (a) { if (a.bundle) nb[a.floor + '|' + a.bundle] = 1; });
    D.done = { at: new Date().toISOString(), dirty: false, file: '(ADMIN 직접 저장)', summary: '건물 ' + D.buildings.length + ' · 층 ' + D.floors.length + ' · 실 ' + D.rooms.length + ' · 설비 ' + D.assets.length + '대 (묶음 ' + Object.keys(nb).length + ') · 연결 ' + D.links.length, sent: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { }
    var firstFloor = D.floors[0] && D.floors[0].code;
    sync.backup('ADMIN 저장 전').then(function () {
      sync.push(t, '검증 중…', { autoApply: true, onDone: function (ok, msg) {
        if (!ok) { alert('ADMIN 검증에서 오류가 있어 저장하지 못했습니다.\n\n' + (msg || '') + '\n\nADMIN 확인창의 오류 내용을 확인하세요.'); return; }
        setTimeout(function () { if (TX.data) TX.data.refresh(true); TX.open({ view: '2d', floor: firstFloor }); setTimeout(function () { toast('ADMIN에 저장되었습니다 · 설비 목록·2D·3D에 반영됨', 'success'); }, 600); }, 900);
      } });
    });
  }
  function finishCard() {
    var dd = D.done;
    if (dd && !dd.dirty) {
      return '<div class="tx-qk-done"><b>✔ 현행화 완료 · ' + esc(fmtTime(dd.at)) + '</b><span>' + esc(dd.summary) + '</span><span>엑셀 저장: <code>' + esc(dd.file) + '</code></span>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn tx-wb-pri" data-q="saveadmin">' + (window.TWINX_STANDALONE ? '다시 저장' : 'ADMIN에 다시 저장') + '</button></div></div>';
    }
    if (window.TWINX_STANDALONE) return '<div class="tx-qk-fin"><button type="button" class="tx-wb-btn tx-wb-pri tx-qk-finbtn" data-q="saveadmin">✔ 검증 후 저장</button><small>입력은 이 PC에 자동 저장됩니다 · 완료 표시와 복원용 백업 파일을 만듭니다</small></div>';
    return '<div class="tx-qk-fin"><button type="button" class="tx-wb-btn tx-wb-pri tx-qk-finbtn" data-q="saveadmin">✔ 검증 후 ADMIN에 저장</button>' +
      '<small>' + (dd && dd.dirty ? '저장 후 수정된 내용이 있습니다 · 다시 저장하세요' : 'ADMIN 검증을 통과하면 바로 저장되어 설비 목록·2D·3D에 나타납니다 (이 층만 교체 · 실행 전 백업 저장)') + '</small></div>';
  }
  function fmtTime(iso) { var d = new Date(iso), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function finish() {
    var cs = checks(), must = [cs[0], cs[2]].filter(function (c) { return !c[1]; }), warn = [cs[1]].concat(cs.slice(3)).filter(function (c) { return !c[1]; });
    if (must.length) { toast('완료할 수 없습니다: ' + must.map(function (c) { return c[0]; }).join(' / '), 'warn'); return; }
    if (warn.length && !confirm('아래 항목이 아직 남아 있습니다. 이대로 완료할까요?\n\n' + warn.map(function (c) { return '· ' + c[0]; }).join('\n'))) return;
    var nb = {}; D.assets.forEach(function (a) { if (a.bundle) nb[a.floor + '|' + a.bundle] = 1; });
    var file = exportXlsx(true);
    if (!file) return;
    save();
    D.done = { at: new Date().toISOString(), dirty: false, file: file,
      summary: '건물 ' + D.buildings.length + ' · 층 ' + D.floors.length + ' · 실 ' + D.rooms.length + ' · 설비 ' + D.assets.length + '대 (묶음 ' + Object.keys(nb).length + ') · 연결 ' + D.links.length };
    try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { }
    renderPanel();
    toast('현행화 완료 · 엑셀 저장됨 → 「ADMIN에 등록(적용)하기」를 누르세요', 'success');
  }
  /** ADMIN 데이터 관리 → 엑셀 등록 에 완료 엑셀을 그대로 전달 (ADMIN 검증·적용 창 사용) */
  function toAdmin() {
    var sync = TX.adminSync, rawT = sync && sync.raw();
    var codes = D.floors.map(function (f) { return f.code; }).join(', ');
    if (sync && rawT && rawT.rooms.length) {
      if (!confirm('초안의 층(' + codes + ')만 ADMIN 자료에서 교체하고, 다른 층 자료는 그대로 유지합니다.\n실행 전 복원용 백업을 저장합니다.\n\n계속할까요?')) return;
      var merged = sync.merge(rawT, sheetsData());
      D.done = D.done || {}; D.done.sent = new Date().toISOString(); try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { }
      sync.backup('간이 현행화 등록 전').then(function () { sync.push(merged, '초안 층(' + codes + ')을 ADMIN에 전달했습니다 · 다른 층은 유지 · 「전체 교체 적용」을 누르면 반영됩니다'); });
      return;
    }
    if (!confirm('ADMIN 「전체 교체 적용」은 기존 ADMIN 자료 6개 시트를 이 현행화 자료로 바꿉니다.\n기존 자료가 필요하면 먼저 ADMIN에서 내보내기 하세요.\n\n계속할까요?')) return;
    var blob = buildXlsx(), file = new File([blob], D.done && D.done.file || 'ICT_Twin_Quick.xlsx', { type: blob.type });
    var up = TX.pipe && TX.pipe.adminUpload;
    if (!up) { U.download(blob, file.name); toast('데이터 관리 → 엑셀 등록으로 올려 주세요', 'info'); return; }
    D.done.sent = new Date().toISOString(); try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { }
    close(false); if (TX.state.open) TX.close();
    up(/데이터\s*관리/, function () { return Array.prototype.slice.call(document.querySelectorAll('.data-action button, button')).find(function (b) { return /엑셀\s*등록/.test(b.textContent) && !/측정/.test(b.textContent); }); }, file,
      'ADMIN에 전달했습니다 · 「검증 완료」 확인 후 「전체 교체 적용」을 누르면 반영됩니다');
  }
  function checks() {
    var placed = D.assets.filter(function (a) { return a.room; });
    var floorsWithRooms = D.floors.filter(function (f) { return D.rooms.some(function (r) { return r.floor === f.code; }); });
    return [['실이 1개 이상 있음', D.rooms.length > 0], ['모든 설비 배치 완료 (' + placed.length + '/' + D.assets.length + ')', D.assets.length > 0 && placed.length === D.assets.length],
      ['설비가 있는 모든 층에 실이 있음', D.floors.filter(function (f) { return D.assets.some(function (a) { return a.floor === f.code; }); }).every(function (f) { return floorsWithRooms.indexOf(f) >= 0; })],
      ['사업장 이름 입력', !!D.site]].concat(TX.pipe && TX.pipe.checks ? TX.pipe.checks(D) : []);
  }
  function bind() {
    P.addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA') return;
      var a = b.getAttribute('data-q'), id = b.getAttribute('data-id');
      if (a === 'close') close(false);
      else if (a === 'step') { step = +b.getAttribute('data-k'); startTool(); renderPanel(); }
      else if (a === 'prev') { step = Math.max(1, step - 1); startTool(); renderPanel(); }
      else if (a === 'next') { step = Math.min(5, step + 1); startTool(); renderPanel(); }
      else if (a === 'import') {
        var rows = parseTable(P.querySelector('[data-q="paste"]').value);
        if (!rows.length) { toast('붙여넣은 표에서 설비를 찾지 못했습니다 (설비명·장비명 열 필요)', 'warn'); return; }
        var makers = {}; rows.forEach(function (r) { if (r.maker) makers[r.maker.replace(/\(.*\)/, '').trim()] = 1; });
        var mk = Object.keys(makers);
        tool.pv = { rows: rows, hasLoc: parseTable.hasLoc, group: parseTable.hasLoc ? 'perRow' : 'one', bname: (mk.length === 1 ? mk[0] + ' ' : '') + '랙 #1', floor: (D.floors.find(function (x) { return x.code === curFloor(); }) || D.floors[0] || {}).code || '', newLoc: '', room: '' };
        renderPanel();
      }
      else if (a === 'pvcancel') { tool.pv = null; renderPanel(); }
      else if (a === 'pvok') {
        var pv = tool.pv; if (!pv) return;
        var opts = { group: pv.group, bname: pv.bname };
        if (!pv.hasLoc || pv.forceLoc) {
          if (pv.floor === '__new') { if (!pv.newLoc) { toast('설치 위치(건물·층)를 입력하세요 (예: 본관 3층 통신실)', 'warn'); return; } opts.loc = pv.newLoc; }
          else if (pv.floor) { opts.floor = pv.floor; if (pv.room) opts.room = pv.room; }
          else { toast('설치할 층을 고르거나 입력하세요', 'warn'); return; }
        }
        tool.pv = null; var n = importTable(pv.rows, opts); renderPanel();
        TX.setState({ floor: (opts.room && D.rooms.find(function (q) { return q.id === opts.room; }).floor) || opts.floor || D.floors[D.floors.length - 1].code });
        toast('설비 ' + n + '대 등록' + (opts.group === 'one' ? ' · 「' + opts.bname + '」 1개 랙(묶음)으로' : '') + (opts.room ? ' · 실에 바로 배치' : ''), 'success');
      }
      else if (a === 'saveadmin') { if (window.TWINX_STANDALONE) saveLocal(); else saveAdmin(); }
      else if (a === 'xlsfile') pickFile('.xlsx,.xlsm,.csv,.tsv', function (file) {
        if (!TX.pipe || !TX.pipe.readAny) { toast('엑셀 읽기 모듈이 없습니다', 'error'); return; }
        TX.pipe.readAny(file).then(function (tables) {
          var best = tables.find(function (t) { return t.rows.slice(0, 15).some(function (r) { return (r || []).some(function (v) { return COLS.name.test(String(v || '')); }); }); }) || tables[0];
          if (!best) throw new Error('시트가 없습니다');
          var text = best.rows.map(function (r) { return (r || []).map(function (v) { return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '); }).join('\t'); }).join('\n');
          var ta = P.querySelector('[data-q="paste"]'); if (ta) ta.value = text;
          var ib = P.querySelector('[data-q="import"]'); if (ib) ib.click();
        }).catch(function (err) { toast('엑셀을 읽지 못했습니다: ' + err.message, 'error'); });
      });
      else if (a === 'tpl') downloadTemplate(); else if (a === 'addfloor') {
        var s = prompt('건물과 층을 입력하세요 (예: 본관 7층)'); if (!s) return;
        var L = parseLoc(s); var f = ensureFloor(L.building, L.floorName, L.level); save(); apply(); TX.setState({ floor: f.code });
      } else if (a === 'adel') { D.assets = D.assets.filter(function (x) { return x.id !== id; }); D.links = D.links.filter(function (l) { return l.from !== id && l.to !== id; }); save(); apply(); }
      else if (a === 'photo') pickImage();
      else if (a === 'scale') startScale();
      else if (a === 'rot') { var c = curFloor(); if (TX.workbench && TX.underlay.get(c)) { var r = TX.underlay.get(c); TX.underlay.update(c, { tf: { rot: r.tf.rot + Math.PI / 2 } }); } renderPanel(); }
      else if (a === 'rtool') { if (cap && cap.mode === 'room') stopTool(); else startTool('room'); renderPanel(); }
      else if (a === 'red') openEd(id);
      else if (a === 'ed-close') { closeEd(); toast('실 편집을 마쳤습니다 (자동 저장됨)', 'success'); }
      else if (a === 'ed-undo') edUndo();
      else if (a === 'ed-rot') { var er = edRoom(); if (er) { var cx = er.x + er.w / 2, cy = er.y + er.h / 2; edCommit({ x: Math.max(0, Math.round((cx - er.h / 2) / 100) * 100), y: Math.max(0, Math.round((cy - er.w / 2) / 100) * 100), w: er.h, h: er.w }); } }
      else if (a === 'rdel') { if (ed && ed.id === id) closeEd(true); doorWrite(id, null); D.rooms = D.rooms.filter(function (r) { return r.id !== id; }); D.assets.forEach(function (x) { if (x.room === id) { x.room = null; x.x = x.y = null; } }); save(); apply(); }
      else if (a === 'pick') { tool.placeId = id; startTool('place'); renderPanel(); }
      else if (a === 'ldel') { D.links = D.links.filter(function (l) { return l.id !== id; }); save(); apply(); }
      else if (a === 'export') exportXlsx();
      else if (a === 'finish') finish();
      else if (a === 'align') { stopTool(); startTool('align'); }
      else if (a === 'alignundo') undoAlign();
      else if (a === 'fromadmin') {
        var AM = TX.data && TX.data.read && TX.data.read();
        if (!AM || !AM.floors.length) { toast('불러올 ADMIN 층이 없습니다', 'warn'); return; }
        var list = AM.floors.map(function (f, i) { return (i + 1) + ') ' + (f.building ? f.building + ' ' : '') + f.name + ' [' + f.code + '] 실 ' + AM.rooms.filter(function (r) { return r.floor === f.code; }).length + ' · 설비 ' + AM.assets.filter(function (x) { return x.floor === f.code; }).length; }).join('\n');
        var ans = prompt('편집할 ADMIN 층 번호를 입력하세요 (여러 층은 쉼표로)\n\n' + list, '1'); if (!ans) return;
        var pickC = ans.split(/[,\s]+/).map(function (x) { var f = AM.floors[parseInt(x, 10) - 1]; return f && f.code; }).filter(Boolean);
        if (!pickC.length) return;
        var n = loadFromAdmin(pickC); TX.setState({ floor: pickC[0] }); toast('ADMIN ' + pickC.join(', ') + ' 층을 불러왔습니다 · 설비 ' + n + '대 (등록 시 이 층만 교체)', 'success');
      }

      else if (a === 'toadmin') toAdmin();
      else if (a === 'ph') { if (TX.pipe) TX.pipe.photos.open(id); }
      else if (a === 'autodraw' || a === 'autodrawall') { var nn = autoDraw(a === 'autodraw' ? [curFloor()] : D.floors.map(function (x) { return x.code; }), a === 'autodrawall'); toast('자동 작도: 실 ' + nn.rooms + '개 · 설비 ' + nn.assets + '대 배치' + (nn.skipped ? ' · 도면이 있는 ' + nn.skipped + '개 층은 건너뜀(도면 위에 직접 그리기)' : ''), 'success'); }
      else if (a === 'ladd') { var fr = P.querySelector('[data-q="lfrom"]').value, to = P.querySelector('[data-q="lto"]').value, ty = P.querySelector('[data-q="ltype"]').value; if (fr === to) { toast('출발과 도착 설비가 같습니다', 'warn'); return; } if (D.links.some(function (l) { return l.from === fr && l.to === to; })) { toast('이미 있는 연결입니다', 'warn'); return; } var k = 1; while (D.links.some(function (l) { return l.id === 'L' + pad(k, 3); })) k++; D.links.push({ id: 'L' + pad(k, 3), from: fr, to: to, type: ty, auto: false }); save(); apply(); }
      else if (a === 'diag') { if (TX.pipe) TX.pipe.diagrams.open(); }
      else if (a === 'phzip') { if (TX.pipe) TX.pipe.photos.exportZip(D); }
      else if (a === 'report') { if (TX.pipe) TX.pipe.report.open(); }
      else if (a === 'jexport') U.download(new Blob([JSON.stringify({ _twinxQuick: 1, draft: D }, null, 1)], { type: 'application/json' }), 'TwinX_간이현행화_초안_' + U.today() + '.json');
      else if (a === 'jimport') pickFile('application/json', function (file) { file.text().then(function (t) { try { var d = JSON.parse(t); if (!d._twinxQuick) throw new Error('초안 파일이 아닙니다'); D = Object.assign(blank(), d.draft, { active: true }); save(); apply(); toast('초안을 불러왔습니다', 'success'); } catch (err) { toast('불러오기 실패: ' + err.message, 'error'); } }); });
      else if (a === 'reset') { if (confirm('간이 현행화 초안을 모두 삭제할까요? (ADMIN 등록 자료에는 영향 없음)')) { D = blank(); D.active = true; save(); TX.setModel(TX.demoModel()); renderPanel(); } }
    });
    P.addEventListener('change', function (e) {
      var t = e.target, a = t.getAttribute('data-q');
      if (a === 'site') { D.site = t.value.trim(); save(); apply(); }
      else if (a === 'floor') { TX.setState({ floor: t.value }); tool.placeId = null; renderPanel(); }
      else if (a === 'rkind') { tool.roomKind = t.value; if (!tool.roomName) tool.roomName = ''; }
      else if (a === 'rname') tool.roomName = t.value.trim();
      else if (a === 'rren') { var r = D.rooms.find(function (q) { return q.id === t.getAttribute('data-id'); }); if (r) { r.name = t.value.trim() || r.name; var pn = autoPlaceRoom(r); save(); apply(); if (pn) toast('위치가 「' + r.name + '」인 설비 ' + pn + '대를 자동 배치했습니다', 'success'); } }
      else if (a && a.indexOf('ed-') === 0) edField(a.slice(3), t.value, t);
      else if (a === 'dist') tool.dist = parseFloat(t.value) || null;
      else if (a === 'auto') { D.autoLinks = t.checked; autoLink(); save(); apply(); }
      else if (a === 'bundleQty') { D.bundleQty = t.checked; save(); }
      else if (a === 'pvgroup') { tool.pv.group = t.value; renderPanel(); }
      else if (a === 'pvbname') tool.pv.bname = t.value.trim();
      else if (a === 'pvfloor') { tool.pv.floor = t.value; tool.pv.room = ''; renderPanel(); }
      else if (a === 'pvnew') tool.pv.newLoc = t.value.trim();
      else if (a === 'pvroom') tool.pv.room = t.value;
      else if (a === 'pvforce') { tool.pv.forceLoc = t.checked; renderPanel(); }
    });
    P.addEventListener('input', function (e) { var t = e.target; if (t.getAttribute('data-q') === 'ed-dpos') { var o2 = t.parentNode.querySelector('output'); if (o2) o2.textContent = t.value + '%'; } if (t.getAttribute('data-q') === 'op') { TX.underlay.update(curFloor(), { opacity: +t.value / 100 }); var o = t.parentNode.querySelector('output'); if (o) o.textContent = t.value + '%'; } });
    P.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); if (cap && cap.mode) { stopTool(); renderPanel(); } else close(true); } });
  }
  function pickFile(accept, cb) { var i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none'; i.onchange = function () { var f = i.files && i.files[0]; i.remove(); if (f) cb(f); }; document.body.appendChild(i); i.click(); }
  function pickImage() {
    var code = curFloor(); if (!code) { toast('먼저 ① 현행화표로 층을 만들거나 층을 추가하세요', 'warn'); return; }
    pickFile('image/*,application/pdf,.pdf', function (file0) {
      var pr = /\.pdf$/i.test(file0.name) || file0.type === 'application/pdf' ? (TX.pipe ? TX.pipe.pdfToImage(file0) : Promise.reject(new Error('PDF 모듈 없음'))) : Promise.resolve(file0);
      pr.then(function (file) { return file && TX.underlay.load(code, file); }).catch(function (err) { toast('도면을 읽지 못했습니다: ' + err.message, 'error'); return false; }).then(function (ok) {
        if (!ok) return;
        var r = TX.underlay.get(code); var f = fl();
        // 기본: 이미지 좌상단 = 원점, 장변 40m 가정 (치수 맞춤 전 임시)
        var s = 40000 / Math.max(r.w, r.h);
        TX.underlay.update(code, { tf: { s: s, rot: 0, tx: 0, ty: 0 }, opacity: 0.85, invert: true });
        f.w = Math.round(r.w * s); f.h = Math.round(r.h * s); save(); apply();
        toast('도면을 올렸습니다 · 「치수로 축척 맞춤」을 진행하세요', 'success');
      });
    });
  }

  /* ---------------- 도면 클릭/드래그 캡처 (축척 · 실 그리기 · 배치) ---------------- */
  function startTool(mode) {
    stopTool();
    if (!mode) mode = step === 3 ? null : step === 4 && tool.placeId ? 'place' : null;
    if (!mode) return;
    var host = TX.ui && TX.ui.view2d; if (!host || !TX.cad2d || !TX.cad2d.screenToMm) return;
    if (TX.state.view === '3d') TX.setState({ view: '2d' });
    cap = { mode: mode, host: host, pts: [], marks: [] };
    cap.svg = U.svg('svg', { class: 'tx-wb-gprev' }); host.appendChild(cap.svg);
    cap.bar = U.el('div', 'tx-wb-calbar'); host.appendChild(cap.bar); updateBar();
    host.classList.add('tx-wb-calib');
    cap.down = function (e) {
      if (cap.bar.contains(e.target) || e.button !== 0 || (ed && ed.svg.contains(e.target))) return;
      cap.d0 = { x: e.clientX, y: e.clientY };
      if (cap.mode === 'room') { e.stopPropagation(); e.preventDefault(); cap.r0 = TX.cad2d.screenToMm(e.clientX, e.clientY); host.setPointerCapture && host.setPointerCapture(e.pointerId); }
    };
    cap.move = function (e) {
      if (cap.mode === 'room' && cap.r0) { e.stopPropagation(); var p = TX.cad2d.screenToMm(e.clientX, e.clientY); drawRect(cap.r0, p); }
    };
    cap.up = function (e) {
      if (cap.mode === 'room' && cap.r0) {
        e.stopPropagation();
        var a = cap.r0, b = TX.cad2d.screenToMm(e.clientX, e.clientY); cap.r0 = null; cap.svg.innerHTML = '';
        if (!b) return;
        if (cap.d0 && Math.abs(e.clientX - cap.d0.x) + Math.abs(e.clientY - cap.d0.y) <= 5) return; // 클릭은 실 선택(편집)으로 처리
        var x0 = Math.round(Math.min(a.x, b.x) / 100) * 100, y0 = Math.round(Math.min(a.y, b.y) / 100) * 100, x1 = Math.round(Math.max(a.x, b.x) / 100) * 100, y1 = Math.round(Math.max(a.y, b.y) / 100) * 100;
        if (x1 - x0 < 600 || y1 - y0 < 600) { toast('실은 0.6m 이상 크기로 끌어서 그려 주세요', 'warn'); return; }
        addRoom(Math.max(0, x0), Math.max(0, y0), x1 - Math.max(0, x0), y1 - Math.max(0, y0));
      }
    };
    cap.click = function (e) {
      if (cap.bar.contains(e.target) || (ed && ed.svg.contains(e.target))) return;
      e.stopPropagation(); e.preventDefault();
      if (cap.d0 && Math.abs(e.clientX - cap.d0.x) + Math.abs(e.clientY - cap.d0.y) > 5) return;
      var mm = TX.cad2d.screenToMm(e.clientX, e.clientY); if (!mm) return;
      if (cap.mode === 'room') { var hit = D.rooms.filter(function (q) { return q.floor === curFloor() && mm.x >= q.x && mm.x <= q.x + q.w && mm.y >= q.y && mm.y <= q.y + q.h; }).sort(function (p, q) { return p.w * p.h - q.w * q.h; })[0]; if (hit) openEd(hit.id); return; }
      if (cap.mode === 'scale') {
        cap.pts.push(mm); mark(e.clientX, e.clientY, cap.pts.length);
        if (cap.pts.length === 2) finishScale(); else updateBar();
      } else if (cap.mode === 'align') {
        cap.pts.push(mm); mark(e.clientX, e.clientY, ['A', "A'", 'B', "B'"][cap.pts.length - 1]);
        if (cap.pts.length === 4) finishAlign(); else updateBar();
      } else if (cap.mode === 'place') placeAt(mm);
    };
    host.addEventListener('pointerdown', cap.down, true);
    host.addEventListener('pointermove', cap.move, true);
    host.addEventListener('pointerup', cap.up, true);
    host.addEventListener('click', cap.click, true);
  }
  function stopTool() {
    if (!cap) return;
    var h = cap.host;
    h.removeEventListener('pointerdown', cap.down, true); h.removeEventListener('pointermove', cap.move, true);
    h.removeEventListener('pointerup', cap.up, true); h.removeEventListener('click', cap.click, true);
    h.classList.remove('tx-wb-calib'); cap.svg.remove(); cap.bar.remove(); cap.marks.forEach(function (m) { m.remove(); });
    cap = null;
  }
  function updateBar() {
    if (!cap) return;
    var t = cap.mode === 'align' ? ['A: 현재 그려진 실(데이터)의 기준점(예: 외곽 실 모서리)을 클릭', "A': 그 점이 도면 사진에서 있어야 할 위치를 클릭", 'B: 멀리 떨어진 두 번째 데이터 기준점을 클릭', "B': 그 점의 도면상 위치를 클릭"][cap.pts.length]
      : cap.mode === 'scale' ? (cap.pts.length ? '② 같은 치수의 다른 끝점을 클릭하세요' : '① 길이를 아는 구간의 한쪽 끝을 클릭하세요')
      : cap.mode === 'room' ? '실 그리기: 모서리에서 대각선으로 끌기 · 「' + (tool.roomName || '이름 미정') + '」 (' + tool.roomKind + ')'
      : '배치: 「' + ((D.assets.find(function (a) { return a.id === tool.placeId; }) || {}).name || '') + '」 설치 위치를 클릭';
    cap.bar.innerHTML = '<b>' + esc(t) + '</b><button type="button">중지</button>';
    cap.bar.querySelector('button').onclick = function () { stopTool(); renderPanel(); };
  }
  function mark(cx, cy, n) { var hr = cap.host.getBoundingClientRect(), m = U.el('div', 'tx-wb-mark tx-wb-mark-src', String(n)); m.style.left = (cx - hr.left) + 'px'; m.style.top = (cy - hr.top) + 'px'; cap.host.appendChild(m); cap.marks.push(m); }
  function drawRect(a, b) {
    if (!a || !b) return;
    var hr = cap.host.getBoundingClientRect(), p = TX.cad2d.mmToScreen(Math.min(a.x, b.x), Math.min(a.y, b.y)), q = TX.cad2d.mmToScreen(Math.max(a.x, b.x), Math.max(a.y, b.y));
    var w = Math.abs(b.x - a.x) / 1000, h = Math.abs(b.y - a.y) / 1000;
    cap.svg.innerHTML = '<rect x="' + (p.x - hr.left) + '" y="' + (p.y - hr.top) + '" width="' + (q.x - p.x) + '" height="' + (q.y - p.y) + '" fill="#3e63db" fill-opacity="0.18" stroke="#93c5fd" stroke-width="2" stroke-dasharray="6 4"/>' +
      '<text x="' + (q.x - hr.left + 8) + '" y="' + (q.y - hr.top) + '" fill="#dbeafe" font-size="12" font-weight="700" style="paint-order:stroke;stroke:#0b1220;stroke-width:3px">' + w.toFixed(1) + ' × ' + h.toFixed(1) + ' m</text>';
  }
  function startScale() {
    var dist = tool.dist || parseFloat((P.querySelector('[data-q="dist"]') || {}).value);
    if (!dist || dist < 100) { toast('실측 거리(mm)를 먼저 입력하세요', 'warn'); var i = P.querySelector('[data-q="dist"]'); if (i) i.focus(); return; }
    tool.dist = dist; startTool('scale');
  }
  function finishScale() {
    var code = curFloor(), r = TX.underlay.get(code), t = r.tf, A = cap.pts[0], B = cap.pts[1];
    var inv = function (m) { var dx = m.x - t.tx, dy = m.y - t.ty, c = Math.cos(-t.rot), s = Math.sin(-t.rot); return { x: (c * dx - s * dy) / t.s, y: (s * dx + c * dy) / t.s }; };
    var pa = inv(A), pb = inv(B), px = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    stopTool();
    if (px < 5) { toast('두 점이 너무 가깝습니다', 'warn'); return; }
    var s = tool.dist / px;
    // 회전은 유지, 이미지 외곽이 원점(0,0)에서 시작하도록 위치 재설정
    var c = Math.cos(t.rot), sn = Math.sin(t.rot), corners = [[0, 0], [r.w, 0], [0, r.h], [r.w, r.h]].map(function (p) { return [s * (c * p[0] - sn * p[1]), s * (sn * p[0] + c * p[1])]; });
    var mx = Math.min.apply(null, corners.map(function (p) { return p[0]; })), my = Math.min.apply(null, corners.map(function (p) { return p[1]; }));
    var Mx = Math.max.apply(null, corners.map(function (p) { return p[0]; })), My = Math.max.apply(null, corners.map(function (p) { return p[1]; }));
    // 기존 실·설비 좌표도 같은 비율로 보정
    var k = s / t.s, ox = t.tx, oy = t.ty;
    D.rooms.filter(function (q) { return q.floor === code; }).forEach(function (q) { q.x = Math.round((q.x - ox) * k - mx); q.y = Math.round((q.y - oy) * k - my); q.w = Math.round(q.w * k); q.h = Math.round(q.h * k); });
    D.assets.filter(function (q) { return q.floor === code && q.x != null; }).forEach(function (q) { q.x = Math.round((q.x - ox) * k - mx); q.y = Math.round((q.y - oy) * k - my); });
    TX.underlay.update(code, { tf: { s: s, tx: -mx, ty: -my } });
    var f = fl(); f.w = Math.round(Mx - mx); f.h = Math.round(My - my); save(); apply();
    toast('축척 맞춤 완료 · 1px = ' + s.toFixed(2) + 'mm · 도면 ' + (f.w / 1000).toFixed(1) + '×' + (f.h / 1000).toFixed(1) + 'm', 'success');
  }
  /** 기존 실·설비(데이터)를 도면 사진에 맞춤: A→A', B→B' (이동+축척, 회전 없음 — 실 직사각형 유지) */
  function finishAlign() {
    var p = cap.pts, code = curFloor(); stopTool();
    var d0 = Math.hypot(p[2].x - p[0].x, p[2].y - p[0].y), d1 = Math.hypot(p[3].x - p[1].x, p[3].y - p[1].y);
    if (d0 < 300) { toast('A와 B를 더 멀리 떨어진 점으로 지정하세요', 'warn'); renderPanel(); return; }
    var k = d1 / d0, T = function (x, y) { return [Math.round(p[1].x + (x - p[0].x) * k), Math.round(p[1].y + (y - p[0].y) * k)]; };
    var before = JSON.stringify({ r: D.rooms.filter(function (r) { return r.floor === code; }), a: D.assets.filter(function (a) { return a.floor === code; }).map(function (a) { return [a.id, a.x, a.y]; }) });
    D._alignUndo = { code: code, data: before };
    D.rooms.filter(function (r) { return r.floor === code; }).forEach(function (r) { var q = T(r.x, r.y); r.x = q[0]; r.y = q[1]; r.w = Math.round(r.w * k); r.h = Math.round(r.h * k); });
    D.assets.filter(function (a) { return a.floor === code && a.x != null; }).forEach(function (a) { var q = T(a.x, a.y); a.x = q[0]; a.y = q[1]; });
    // 같은 층 구조 입력(트레이·라이저)도 같은 변환
    try {
      var g = JSON.parse(localStorage.getItem('twinx_geom_v1') || 'null');
      if (g) { (g.trays && g.trays[code] || []).forEach(function (t) { t.a = T(t.a[0], t.a[1]); t.b = T(t.b[0], t.b[1]); }); (g.risers || []).forEach(function (r) { if (!r.floors || r.floors.indexOf(code) >= 0) { var q = T(r.x, r.y); r.x = q[0]; r.y = q[1]; } }); localStorage.setItem('twinx_geom_v1', JSON.stringify(g)); }
    } catch (e) { }
    var f = fl(); if (f) { var mx = Math.max.apply(null, [f.w].concat(D.rooms.filter(function (r) { return r.floor === code; }).map(function (r) { return r.x + r.w + 2000; }))), my = Math.max.apply(null, [f.h].concat(D.rooms.filter(function (r) { return r.floor === code; }).map(function (r) { return r.y + r.h + 2000; }))); f.w = mx; f.h = my; }
    save(); apply();
    toast('실·설비를 도면에 맞췄습니다 · 축척 ×' + k.toFixed(3) + ' (되돌리기 가능)', 'success');
  }
  function undoAlign() {
    var u = D._alignUndo; if (!u) return;
    var o = JSON.parse(u.data);
    D.rooms = D.rooms.filter(function (r) { return r.floor !== u.code; }).concat(o.r);
    o.a.forEach(function (x) { var a = D.assets.find(function (q) { return q.id === x[0]; }); if (a) { a.x = x[1]; a.y = x[2]; } });
    delete D._alignUndo; save(); apply(); toast('도면 맞춤을 되돌렸습니다 (구조 입력은 그대로)', 'info');
  }
  function outsideCount(code) {
    var ul = TX.underlay && TX.underlay.get(code); if (!ul) return null;
    var t = ul.tf, x1 = t.tx + ul.w * t.s, y1 = t.ty + ul.h * t.s;
    return D.rooms.filter(function (r) { return r.floor === code && (r.x < t.tx - 100 || r.y < t.ty - 100 || r.x + r.w > x1 + 100 || r.y + r.h > y1 + 100); }).length;
  }
  function addRoom(x, y, w, h) {
    var code = curFloor(), n = 1;
    while (D.rooms.some(function (r) { return r.id === code + '-R' + pad(n, 2); })) n++;
    var id = code + '-R' + pad(n, 2), f = fl();
    var name = tool.roomName || (f.name + ' ' + tool.roomKind);
    if (D.rooms.some(function (r) { return r.floor === code && r.name === name; })) name = name + ' ' + n;
    D.rooms.push({ id: id, floor: code, name: name, kind: tool.roomKind, x: x, y: y, w: w, h: h });
    tool.roomName = '';
    var placedN = autoPlaceRoom(D.rooms[D.rooms.length - 1]);
    save(); apply(); startTool('room'); openEd(id);
    toast('「' + name + '」 실을 추가했습니다 (' + (w / 1000).toFixed(1) + '×' + (h / 1000).toFixed(1) + 'm) · 흰 손잡이로 도면에 맞추고 주황 「문」으로 출입문 위치 조정' + (placedN ? ' · 위치가 「' + name + '」인 설비 ' + placedN + '대 자동 배치' : ''), 'success');
  }
  /* ---------- 실 형틀·출입문 편집: 모서리/변 끌어 크기, 안쪽 끌어 이동, 주황 문 손잡이를 벽 따라 끌기 ---------- */
  var ed = null;
  var SIDE_KO = { N: '위(북)', E: '오른쪽(동)', S: '아래(남)', W: '왼쪽(서)', none: '문 없음' };
  function geomAll() { try { var g = JSON.parse(localStorage.getItem('twinx_geom_v1') || '{}') || {}; g.doors = g.doors || {}; return g; } catch (e) { return { doors: {} }; } }
  function doorGet(id) { return geomAll().doors[id] || null; }
  function doorWrite(id, d) { var g = geomAll(); if (d) g.doors[id] = d; else delete g.doors[id]; try { localStorage.setItem('twinx_geom_v1', JSON.stringify(g)); } catch (e) { } }
  function edRoom() { return ed && D.rooms.find(function (r) { return r.id === ed.id; }); }
  function wallSpan(g, side) { var along = side === 'N' || side === 'S'; return { along: along, lo: along ? g.x : g.y, len: along ? g.w : g.h }; }
  function fitDoor(d, g) {
    if (!d || d.side === 'none' || !d.side) return d;
    var s = wallSpan(g, d.side), w = Math.max(500, Math.min(d.w || 900, s.len - 200)), at = d.at == null ? s.lo + s.len / 2 : d.at;
    return { side: d.side, w: Math.round(w), at: Math.round(U.clamp(at, s.lo + w / 2 + 50, s.lo + s.len - w / 2 - 50)) };
  }
  function doorPt(d, g) {
    var s = wallSpan(g, d.side), at = d.at == null ? s.lo + s.len / 2 : d.at;
    return d.side === 'N' ? [at, g.y] : d.side === 'S' ? [at, g.y + g.h] : d.side === 'W' ? [g.x, at] : [g.x + g.w, at];
  }
  function openEd(id) {
    var r = D.rooms.find(function (q) { return q.id === id; }); if (!r) return;
    var host = TX.ui && TX.ui.view2d; if (!host || !TX.cad2d || !TX.cad2d.mmToScreen) return;
    if (ed && ed.id === id) return;
    closeEd(true);
    if (TX.state.view === '3d') TX.setState({ view: '2d' });
    ed = { id: id, host: host, undo: [], key: '' };
    ed.svg = U.svg('svg', { class: 'tx-qk-edsvg' }); host.appendChild(ed.svg); host.classList.add('tx-qk-editing');
    ed.svg.addEventListener('pointerdown', edDown);
    var loop = function () { if (!ed) return; edPaint(); ed.raf = requestAnimationFrame(loop); }; loop();
    renderPanel();
  }
  function closeEd(silent) {
    if (!ed) return;
    cancelAnimationFrame(ed.raf); ed.svg.remove(); ed.host.classList.remove('tx-qk-editing'); ed = null;
    window.removeEventListener('pointermove', edMove); window.removeEventListener('pointerup', edUp);
    if (!silent) renderPanel();
  }
  function edPaint() {
    var r = edRoom(), host = TX.ui && TX.ui.view2d;
    if (!r || !host || TX.state.view === '3d' || r.floor !== curFloor()) { closeEd(); return; }
    if (ed.svg.parentNode !== host) { host.appendChild(ed.svg); ed.host = host; host.classList.add('tx-qk-editing'); }
    var dg = ed.drag && ed.drag.g, g = dg || r, door = ed.drag && ed.drag.door !== undefined ? ed.drag.door : doorGet(r.id);
    var hr = host.getBoundingClientRect(), a = TX.cad2d.mmToScreen(g.x, g.y), b = TX.cad2d.mmToScreen(g.x + g.w, g.y + g.h); if (!a || !b) return;
    var x0 = Math.min(a.x, b.x) - hr.left, y0 = Math.min(a.y, b.y) - hr.top, x1 = Math.max(a.x, b.x) - hr.left, y1 = Math.max(a.y, b.y) - hr.top;
    var key = [x0, y0, x1, y1].map(function (v) { return Math.round(v); }).join(',') + JSON.stringify(door) + (ed.drag ? 1 : 0);
    if (key === ed.key) return; ed.key = key;
    var xm = (x0 + x1) / 2, ym = (y0 + y1) / 2, H = 12, o = [];
    o.push('<rect data-h="move" x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '" fill="#38bdf8" fill-opacity="0.10" stroke="#38bdf8" stroke-width="2.5" stroke-dasharray="7 4" style="cursor:move"/>');
    [['nw', x0, y0, 'nwse'], ['n', xm, y0, 'ns'], ['ne', x1, y0, 'nesw'], ['e', x1, ym, 'ew'], ['se', x1, y1, 'nwse'], ['s', xm, y1, 'ns'], ['sw', x0, y1, 'nesw'], ['w', x0, ym, 'ew']].forEach(function (h) {
      o.push('<rect data-h="' + h[0] + '" x="' + (h[1] - H / 2) + '" y="' + (h[2] - H / 2) + '" width="' + H + '" height="' + H + '" rx="2" fill="#fff" stroke="#0284c7" stroke-width="2" style="cursor:' + h[3] + '-resize"/>');
    });
    var lab = (g.w / 1000).toFixed(2) + ' × ' + (g.h / 1000).toFixed(2) + ' m';
    o.push('<text x="' + xm + '" y="' + (y0 - 10) + '" text-anchor="middle" fill="#e0f2fe" font-size="12" font-weight="700" style="paint-order:stroke;stroke:#0b1220;stroke-width:3px;pointer-events:none">' + esc(r.name) + ' · ' + lab + '</text>');
    var dd = door && door.side && door.side !== 'none' ? door : { side: 'S', at: null, w: 900, ghost: true };
    if (!(door && door.side === 'none')) {
      var p = doorPt(dd, g), sp = TX.cad2d.mmToScreen(p[0], p[1]), s = wallSpan(g, dd.side), kk = (x1 - x0) / (g.w || 1), half = (dd.w || 900) / 2 * kk;
      if (sp) {
        var px = sp.x - hr.left, py = sp.y - hr.top;
        if (!dd.ghost) o.push('<line x1="' + (s.along ? px - half : px) + '" y1="' + (s.along ? py : py - half) + '" x2="' + (s.along ? px + half : px) + '" y2="' + (s.along ? py : py + half) + '" stroke="#f97316" stroke-width="6" stroke-linecap="round" style="pointer-events:none"/>');
        o.push('<circle data-h="door" cx="' + px + '" cy="' + py + '" r="10" fill="' + (dd.ghost ? '#0b1220' : '#f97316') + '" stroke="#fed7aa" stroke-width="2"' + (dd.ghost ? ' stroke-dasharray="3 2"' : '') + ' style="cursor:grab"/>' +
          '<text x="' + px + '" y="' + (py + 4) + '" text-anchor="middle" fill="#fff" font-size="10" font-weight="800" style="pointer-events:none">문</text>');
      }
    }
    ed.svg.innerHTML = o.join('');
  }
  function snapV(v, e) { var k = e && e.altKey ? 10 : 100; return Math.round(v / k) * k; }
  function edDown(e) {
    var h = e.target.getAttribute && e.target.getAttribute('data-h'); if (!h || e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    var r = edRoom(); if (!r) return;
    ed.drag = { h: h, s0: TX.cad2d.screenToMm(e.clientX, e.clientY), c0: [e.clientX, e.clientY], r0: { x: r.x, y: r.y, w: r.w, h: r.h }, g: { x: r.x, y: r.y, w: r.w, h: r.h }, moved: false };
    if (h === 'door') ed.drag.door = doorGet(r.id) || null;
    window.addEventListener('pointermove', edMove); window.addEventListener('pointerup', edUp);
  }
  function edMove(e) {
    var d = ed && ed.drag; if (!d || !d.s0) return;
    if (!d.moved && Math.abs(e.clientX - d.c0[0]) + Math.abs(e.clientY - d.c0[1]) < 3) return;
    d.moved = true;
    var p = TX.cad2d.screenToMm(e.clientX, e.clientY); if (!p) return;
    var dx = p.x - d.s0.x, dy = p.y - d.s0.y, r0 = d.r0, X0 = r0.x, Y0 = r0.y, X1 = r0.x + r0.w, Y1 = r0.y + r0.h, MIN = 600;
    if (d.h === 'move') { d.g = { x: Math.max(0, snapV(X0 + dx, e)), y: Math.max(0, snapV(Y0 + dy, e)), w: r0.w, h: r0.h }; return; }
    if (d.h === 'door') {
      var g = r0, c = [['N', Math.abs(p.y - g.y)], ['S', Math.abs(p.y - (g.y + g.h))], ['W', Math.abs(p.x - g.x)], ['E', Math.abs(p.x - (g.x + g.w))]].sort(function (a, b) { return a[1] - b[1]; })[0][0];
      var k = e.altKey ? 10 : 50, along = c === 'N' || c === 'S';
      d.door = fitDoor({ side: c, w: (d.door && d.door.w) || 900, at: Math.round((along ? p.x : p.y) / k) * k }, g); return;
    }
    if (d.h.indexOf('w') >= 0) X0 = Math.min(Math.max(0, snapV(r0.x + dx, e)), X1 - MIN);
    if (d.h.indexOf('e') >= 0) X1 = Math.max(snapV(r0.x + r0.w + dx, e), X0 + MIN);
    if (d.h.indexOf('n') >= 0) Y0 = Math.min(Math.max(0, snapV(r0.y + dy, e)), Y1 - MIN);
    if (d.h.indexOf('s') >= 0) Y1 = Math.max(snapV(r0.y + r0.h + dy, e), Y0 + MIN);
    d.g = { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 };
  }
  function edUp() {
    window.removeEventListener('pointermove', edMove); window.removeEventListener('pointerup', edUp);
    var d = ed && ed.drag; if (!d) return; ed.drag = null; ed.key = '';
    if (!d.moved) return;
    if (d.h === 'door') edCommit(null, d.door);
    else edCommit(d.g);
  }
  /** 형틀(g)·문(door) 변경을 저장: 이동이면 실 안 설비·문도 함께 이동, 크기 변경이면 설비·문을 실 안으로 */
  function edCommit(g, door) {
    var r = edRoom(); if (!r) return;
    var cur = doorGet(r.id);
    if (g && g.x === r.x && g.y === r.y && g.w === r.w && g.h === r.h) g = null;
    if (door !== undefined && JSON.stringify(door || null) === JSON.stringify(cur || null)) door = undefined;
    if (!g && door === undefined) return; // 변경 없음 → 되돌리기 기록도 남기지 않음
    ed.undo.push({ r: { x: r.x, y: r.y, w: r.w, h: r.h }, door: cur ? JSON.parse(JSON.stringify(cur)) : null, a: D.assets.filter(function (a) { return a.room === r.id; }).map(function (a) { return [a.id, a.x, a.y]; }) });
    if (ed.undo.length > 30) ed.undo.shift();
    if (g) {
      var dx = g.x - r.x, dy = g.y - r.y, moveOnly = g.w === r.w && g.h === r.h;
      D.assets.forEach(function (a) {
        if (a.room !== r.id || a.x == null) return;
        if (moveOnly) { a.x += dx; a.y += dy; }
        else { a.x = Math.round(U.clamp(a.x, g.x + 200, g.x + g.w - 200)); a.y = Math.round(U.clamp(a.y, g.y + 200, g.y + g.h - 200)); }
      });
      if (cur && cur.side && cur.side !== 'none') {
        var nd = Object.assign({}, cur);
        if (moveOnly && nd.at != null) nd.at += (nd.side === 'N' || nd.side === 'S') ? dx : dy;
        door = fitDoor(nd, g);
      }
      r.x = g.x; r.y = g.y; r.w = g.w; r.h = g.h;
      var f = fl(); if (f) { f.w = Math.max(f.w, r.x + r.w + 2000); f.h = Math.max(f.h, r.y + r.h + 2000); }
    }
    if (door !== undefined) doorWrite(r.id, door);
    save(); apply();
  }
  function edUndo() {
    var r = edRoom(), u = ed && ed.undo.pop(); if (!r || !u) return;
    Object.assign(r, u.r); doorWrite(r.id, u.door);
    u.a.forEach(function (x) { var a = D.assets.find(function (q) { return q.id === x[0]; }); if (a) { a.x = x[1]; a.y = x[2]; } });
    save(); apply(); toast('직전 편집을 되돌렸습니다', 'info');
  }
  function edPanel() {
    var r = edRoom(); if (!r) return '';
    var d = doorGet(r.id), side = d ? d.side : '', s = d && d.side !== 'none' ? wallSpan(r, d.side) : null;
    var pos = s && d.at != null ? Math.round((d.at - s.lo) / s.len * 100) : 50;
    var num = function (k, lab, v) { return '<label>' + lab + '<input type="number" step="100" min="0" data-q="ed-' + k + '" value="' + Math.round(v) + '"></label>'; };
    return '<div class="tx-qk-ed"><div class="tx-qk-ed-hd"><b>✎ 실 편집 · ' + esc(r.name) + '</b><button type="button" class="tx-wb-link" data-q="ed-close">편집 끝</button></div>' +
      '<small>도면 위 <b>흰 손잡이</b>(모서리·변)를 끌면 크기, <b>점선 안쪽</b>을 끌면 이동, <b>주황 「문」</b>을 벽을 따라 끌면 출입문 위치가 바뀝니다. 다른 벽으로 끌면 그 벽으로 옮겨집니다. (100mm 단위 · Alt 누르면 10mm 정밀)</small>' +
      '<div class="tx-qk-ed-grid">' + num('x', '왼쪽 X (mm)', r.x) + num('y', '위쪽 Y (mm)', r.y) + num('w', '가로 (mm)', r.w) + num('h', '세로 (mm)', r.h) + '</div>' +
      '<div class="tx-qk-ed-grid"><label>출입문 벽<select data-q="ed-dside"><option value="">자동 추정</option>' + ['N', 'E', 'S', 'W', 'none'].map(function (k) { return '<option value="' + k + '"' + (k === side ? ' selected' : '') + '>' + SIDE_KO[k] + '</option>'; }).join('') + '</select></label>' +
      '<label>문 폭 (mm)<input type="number" min="500" max="3000" step="50" data-q="ed-dw" value="' + ((d && d.w) || 900) + '"' + (s ? '' : ' disabled') + '></label></div>' +
      (s ? '<label class="tx-wb-rng">벽 위 문 위치 <input type="range" min="0" max="100" step="1" data-q="ed-dpos" value="' + pos + '"><output>' + pos + '%</output></label>' : '') +
      '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn" data-q="ed-rot">가로↔세로 바꾸기</button><button type="button" class="tx-wb-btn" data-q="ed-undo"' + (ed.undo.length ? '' : ' disabled') + '>↶ 되돌리기' + (ed.undo.length ? ' (' + ed.undo.length + ')' : '') + '</button><button type="button" class="tx-wb-btn tx-wb-pri" data-q="ed-close">✔ 편집 완료</button></div></div>';
  }
  function edField(k, v, el) {
    var r = edRoom(); if (!r) return;
    if (k === 'x' || k === 'y' || k === 'w' || k === 'h') {
      var g = { x: r.x, y: r.y, w: r.w, h: r.h }; v = Math.round(+v); if (!isFinite(v)) return;
      g[k] = (k === 'w' || k === 'h') ? Math.max(600, v) : Math.max(0, v); edCommit(g); return;
    }
    var d = doorGet(r.id);
    if (k === 'dside') { if (!v) edCommit(null, null); else if (v === 'none') edCommit(null, { side: 'none' }); else edCommit(null, fitDoor({ side: v, w: (d && d.w) || 900, at: d && d.side === v ? d.at : null }, r)); }
    else if (k === 'dw' && d && d.side !== 'none') edCommit(null, fitDoor(Object.assign({}, d, { w: +v || 900 }), r));
    else if (k === 'dpos' && d && d.side !== 'none') { var s = wallSpan(r, d.side); edCommit(null, fitDoor(Object.assign({}, d, { at: s.lo + s.len * (+v) / 100 }), r)); }
  }
  document.addEventListener('keydown', function (e) {
    if (!ed || !P) return;
    var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    var r = edRoom(); if (!r) return;
    if (e.key === 'Escape') { closeEd(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); edUndo(); return; }
    var k = e.shiftKey ? 10 : 100, m = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }[e.key]; if (!m) return;
    e.preventDefault(); edCommit({ x: Math.max(0, r.x + m[0]), y: Math.max(0, r.y + m[1]), w: r.w, h: r.h });
  });
  /** 엑셀 「위치」의 실 이름과 같은 실을 그리면, 그 층의 미배치 설비를 실 안에 자동 배치 (묶음은 한 자리) */
  function nm(s) { return String(s || '').replace(/\s+/g, '').replace(/^(지하)?\d+층|^B\d+F?|^\d+F/i, '').toLowerCase(); }
  function autoPlaceRoom(r) {
    if (!r) return 0;
    var rn = nm(r.name); if (!rn) return 0;
    var list = D.assets.filter(function (a) { return a.floor === r.floor && !a.room && a.roomHint && (nm(a.roomHint) === rn || (nm(a.roomHint).length >= 2 && (rn.indexOf(nm(a.roomHint)) >= 0 || nm(a.roomHint).indexOf(rn) >= 0))); });
    if (!list.length) return 0;
    var units = [], seen = {};
    list.forEach(function (a) { if (a.bundle) { if (seen[a.bundle]) return; seen[a.bundle] = 1; } units.push(a); });
    var cols = Math.max(1, Math.ceil(Math.sqrt(units.length * r.w / Math.max(1, r.h)))), rows = Math.ceil(units.length / cols), cw = r.w / cols, ch = r.h / rows;
    units.forEach(function (u, i) {
      var x = Math.round(r.x + cw * ((i % cols) + 0.5)), y = Math.round(r.y + ch * (Math.floor(i / cols) + 0.5));
      list.forEach(function (a) { if (a === u || (u.bundle && a.bundle === u.bundle)) { a.room = r.id; a.x = x; a.y = y; } });
    });
    autoLink();
    return list.length;
  }
  function placeAt(mm) {
    var code = curFloor(), r = D.rooms.find(function (q) { return q.floor === code && mm.x >= q.x && mm.x <= q.x + q.w && mm.y >= q.y && mm.y <= q.y + q.h; });
    if (!r) { toast('실 안을 클릭하세요 (실이 없으면 ③ 실 그리기 먼저)', 'warn'); return; }
    var a = D.assets.find(function (q) { return q.id === tool.placeId; }); if (!a) return;
    a.room = r.id; a.x = Math.round(mm.x); a.y = Math.round(mm.y);
    // 묶음: 모듈 전체를 같은 자리에 (도면에는 1개)
    if (a.bundle) D.assets.forEach(function (q) { if (q.floor === a.floor && q.bundle === a.bundle) { q.room = a.room; q.x = a.x; q.y = a.y; } });
    save();
    var next = D.assets.find(function (q) { return q.floor === code && !q.room; });
    tool.placeId = next ? next.id : null;
    autoLink(); save(); apply();
    if (tool.placeId) startTool('place'); else { stopTool(); toast('이 층의 설비를 모두 배치했습니다', 'success'); renderPanel(); }
  }

  /* ---------------- 진입점: 「현행화 ▾」 메뉴에 항목 추가 ---------------- */
  function injectMenu() {
    var m = document.querySelector('.tx-wb-menu');
    if (!m || m.querySelector('[data-qk]')) return;
    var b = U.el('button', '', '<b>간이 현행화 모드 ' + (D.active ? '<em class="tx-wb-mbadge" style="background:#3e63db">작업 중</em>' : '') + '</b><small>도면 사진 + 설비 현행화표만으로 트윈 초안 작성 → ADMIN 엑셀</small>');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.setAttribute('data-qk', '1');
    b.addEventListener('click', function (e) { e.stopPropagation(); m.remove(); var t = document.querySelector('[data-act="wb-menu"]'); if (t) t.setAttribute('aria-expanded', 'false'); open(); });
    m.insertBefore(b, m.firstChild);
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-act="wb-menu"]')) setTimeout(injectMenu, 0); });
  TX.on('state', function (p) { var ch = (p && p.changed) || []; if (P && ch.indexOf('floor') >= 0) { stopTool(); renderPanel(); startTool(); } });
  TX.on('state', function (p) { var ch = (p && p.changed) || []; if (P && step === 3 && ch.indexOf('room') >= 0 && TX.state.room && D.rooms.some(function (q) { return q.id === TX.state.room; })) openEd(TX.state.room); });
  TX.on('close', function () { close(true); });
  TX.on('open', function () { if (D.active && D.floors.length) setTimeout(function () { TX.setModel(toModel()); }, 50); });

  TX.quick = { active: function () { return !!D.active; }, open: open, close: close, draft: function () { return D; }, parseTable: parseTable, parseLoc: parseLoc, buildXlsx: buildXlsx, model: toModel, autoDraw: autoDraw, startFloors: startFloors, loadFromAdmin: loadFromAdmin,
    // 66-pipeline 확장용 내부 접근점
    setMeasurements: function (list, mode) { D.measurements = mode === 'append' ? (D.measurements || []).concat(list) : list; save(); apply(); return D.measurements.length; },
    _: { save: function () { save(); }, apply: apply, refresh: renderPanel, zip: zip, pad: pad, xlsx: function (sheets) { return buildXlsx(sheets); } } };
})();
