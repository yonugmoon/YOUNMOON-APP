/* ============================================================
   TwinX 71-reset (통합 리드) — 데이터 관리 센터 : 출처 확인 · 백업/복원 · 목적별 초기화 · ADMIN 층 단위 반영
   · 출처: ADMIN 시범 자료(건물코드 DEMO / 비고 '시범 데이터') · 사용자 등록 자료 · 간이 현행화 초안
   · 초기화 4종 (실행 전 대상·개수 표시, 복원용 백업 자동 저장)
       ① 시범 데이터 제거        ② 선택 층 공간·설비 새로 작성 (도면 유지)
       ③ 선택 층 배치만 초기화 (설비 대장·연결 유지, 위치 해제 → 미배치)   ④ 프로젝트 전체 초기화
   · ADMIN 자료 변경은 항상 ADMIN 「데이터 관리 → 엑셀 등록」 검증·적용 창을 거침 (직접 저장소를 건드리지 않음)
   · 빈 층은 「실 미지정」 자리표시 실(<층코드>-UNASSIGNED, 실유형 '미지정')로 유지 → 도면·층은 남고 임의 실·설비는 생기지 않음
   TwinX.adminSync = {raw, sheets, push, merge, placeholder} — 65-quick 층 단위 반영, 70-topo 연결 반영에서 사용
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.adminSync) return;
  var U = TX.util, esc = U.esc;
  function toast(m, k) { TX.emit('toast', { msg: m, kind: k || 'info' }); }
  function root() { return (TX.ui && TX.ui.root) || document.body; }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); }

  var COLS = {
    rooms: ['실코드', '건물코드', '건물명', '층코드', '층명', '실명', '실유형', 'X', 'Y', 'W', 'H'],
    assets: ['설비ID', '소속실', '설비명', '설비구분', '모델명', '제조사', '규격', '사진URL', 'X', 'Y', '상태', '설치일', '교체주기(개월)'],
    links: ['연결ID', '출발설비ID', '도착설비ID', '연결유형', '케이블번호', '출발단자', '도착단자', '연결상태'],
    history: ['점검ID', '설비ID', '점검일', '점검자', '상태', '측정항목', '측정값', '단위', '비고', '작업구분'],
    maps: ['층코드', '도면파일경로', '축척', '기준점X', '기준점Y', '도면너비', '도면높이'],
    rules: ['규칙ID', '상태코드', '색상코드', '측정항목', '연산자', '임계값', '단위']
  };
  var SHEET = { rooms: '01_건물층실', assets: '02_설비마스터', links: '03_연결관계', history: '04_점검이력', maps: '05_도면매핑', rules: '06_상태규칙' };
  var ORDER = ['rooms', 'assets', 'links', 'history', 'maps', 'rules'];
  function s(v) { return v == null ? '' : String(v).trim(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function raw() {
    var d = TX.data && TX.data.raw && TX.data.raw();
    if (!d || !d.twin) return null;
    var t = {}; ORDER.forEach(function (k) { t[k] = clone(d.twin[k] || []); });
    t._rows = (d.rows || []).length;
    return t;
  }
  function sheets(t) { return ORDER.map(function (k) { return [SHEET[k], [COLS[k]].concat((t[k] || []).map(function (o) { return COLS[k].map(function (c) { return o[c] == null ? '' : o[c]; }); }))]; }); }
  /** ADMIN 데이터 관리 → 엑셀 등록 으로 전달 (ADMIN 검증 창에서 「전체 교체 적용」을 눌러야 반영) */
  function push(t, msg, o) {
    var q = TX.quick && TX.quick._; if (!q || !TX.pipe || !TX.pipe.adminUpload) { toast('전달 모듈이 없습니다', 'error'); return; }
    var blob = q.xlsx(sheets(t)), file = new File([blob], 'ICT_Twin_Admin_' + stamp() + '.xlsx', { type: blob.type });
    if (TX.data_expect) TX.data_expect((t.rooms || []).length);
    if (!(o && o.keepQuick) && TX.quick.active && TX.quick.active()) TX.quick.close(false);
    if (TX.state.open) TX.close();
    TX.pipe.adminUpload(/데이터\s*관리/, function () { return Array.prototype.slice.call(document.querySelectorAll('.data-action button, button')).find(function (b) { return /엑셀\s*등록/.test(b.textContent) && !/측정/.test(b.textContent); }); }, file,
      msg || 'ADMIN에 전달했습니다 · 「검증 완료」 확인 후 「전체 교체 적용」을 누르면 반영됩니다', o);
  }
  /** 층 자리표시 실 */
  function placeholder(t, code, info) {
    var mp = (t.maps || []).find(function (m) { return s(m.층코드) === code; }) || {};
    return { 실코드: code + '-UNASSIGNED', 건물코드: info.건물코드 || '', 건물명: info.건물명 || '', 층코드: code, 층명: info.층명 || code, 실명: '실 미지정', 실유형: '미지정', X: (+mp.기준점X || 0) + 10, Y: (+mp.기준점Y || 0) + 10, W: 100, H: 100 };
  }
  function floorInfo(t, code) { var r = (t.rooms || []).find(function (x) { return s(x.층코드) === code; }); return r ? { 건물코드: r.건물코드, 건물명: r.건물명, 층명: r.층명 } : { 층명: code }; }
  /** 연결·이력 정리: 남은 설비만 */
  function tidy(t) {
    var ids = {}; t.assets.forEach(function (a) { ids[s(a.설비ID)] = 1; });
    t.links = t.links.filter(function (l) { return ids[s(l.출발설비ID)] && ids[s(l.도착설비ID)]; });
    t.history = t.history.filter(function (h) { return ids[s(h.설비ID)]; });
    var used = {}; t.rooms.forEach(function (r) { used[s(r.층코드)] = 1; });
    t.maps = t.maps.filter(function (m) { return used[s(m.층코드)]; });
    return t;
  }
  /** 간이 현행화 초안(sheetsData 형식)을 ADMIN 원본과 층 단위로 병합: 초안에 있는 층만 교체, 다른 층은 유지 */
  function merge(t, draftSheets) {
    var get = function (name) { var x = draftSheets.find(function (q) { return q[0] === name; }); return x ? x[1] : [[]]; };
    var toObj = function (rows) { var h = rows[0] || []; return rows.slice(1).map(function (r) { var o = {}; h.forEach(function (c, i) { o[c] = r[i]; }); return o; }); };
    var dr = toObj(get(SHEET.rooms)), da = toObj(get(SHEET.assets)), dl = toObj(get(SHEET.links)), dm = toObj(get(SHEET.maps));
    var codes = {}; dr.forEach(function (r) { codes[s(r.층코드)] = 1; });
    var oldRooms = {}; t.rooms.forEach(function (r) { if (codes[s(r.층코드)]) oldRooms[s(r.실코드)] = 1; });
    var newIds = {}; da.forEach(function (a) { newIds[s(a.설비ID)] = 1; });
    t.rooms = t.rooms.filter(function (r) { return !codes[s(r.층코드)]; }).concat(dr);
    t._oldAssets = t.assets.filter(function (a) { return oldRooms[s(a.소속실)]; }).map(function (a) { return s(a.설비ID); });
    t.assets = t.assets.filter(function (a) { return !oldRooms[s(a.소속실)] && !newIds[s(a.설비ID)]; }).concat(da);
    // 초안 층 설비에 닿는 기존 연결은 초안 연결로 대체 (같은 연결 중복 방지)
    var oldIds = {}; (t._oldAssets || []).forEach(function (id) { oldIds[id] = 1; });
    var inD = function (id) { return newIds[id] || oldIds[id]; };
    // 초안 층 안쪽 연결만 초안 값으로 교체, 다른 층과 이어진 연결은 유지 (끝점이 사라진 연결은 tidy 에서 정리)
    t.links = t.links.filter(function (l) { return !(inD(s(l.출발설비ID)) && inD(s(l.도착설비ID))); });
    var lid = {}, pair = {}; t.links.forEach(function (l) { lid[s(l.연결ID)] = 1; pair[s(l.출발설비ID) + '>' + s(l.도착설비ID) + '>' + s(l.연결유형)] = 1; });
    dl.forEach(function (l) { var k0 = s(l.출발설비ID) + '>' + s(l.도착설비ID) + '>' + s(l.연결유형); if (pair[k0]) return; pair[k0] = 1; var id = s(l.연결ID), k = 1; while (lid[id]) id = s(l.연결ID) + '-' + (k++); lid[id] = 1; l.연결ID = id; t.links.push(l); });
    delete t._oldAssets;
    // 도면매핑: 기존 값이 초안 실을 모두 담으면 유지, 아니면 초안 값
    dm.forEach(function (m) {
      var code = s(m.층코드), old = t.maps.find(function (q) { return s(q.층코드) === code; });
      if (!old) { t.maps.push(m); return; }
      var sc = +old.축척 || 10, x0 = +old.기준점X || 0, y0 = +old.기준점Y || 0, x1 = x0 + (+old.도면너비 || 0) * sc, y1 = y0 + (+old.도면높이 || 0) * sc;
      var fits = dr.filter(function (r) { return s(r.층코드) === code; }).every(function (r) { return +r.X >= x0 && +r.Y >= y0 && +r.X + +r.W <= x1 && +r.Y + +r.H <= y1; });
      if (!fits) Object.assign(old, m);
    });
    // 같은 실코드 중복(초안이 ADMIN 실코드를 그대로 쓴 경우)
    var seen = {}; t.rooms = t.rooms.filter(function (r) { var k = s(r.실코드); if (seen[k]) return false; seen[k] = 1; return true; });
    // 초안 층에 다른 층 설비가 남아 있으면 정리
    return tidy(t);
  }

  /* ---------- 출처 분석 ---------- */
  function isDemoRoom(r) { return /^DEMO$/i.test(s(r.건물코드)) || s(r.건물명) === '시범 통신센터'; }
  function isDemoAsset(a, demoRooms) { return demoRooms[s(a.소속실)] || s(a.제조사) === '시범 제조사'; }
  function analyze(t) {
    var demoRooms = {}; t.rooms.forEach(function (r) { if (isDemoRoom(r)) demoRooms[s(r.실코드)] = 1; });
    var floors = {}, order = [];
    t.rooms.forEach(function (r) {
      var c = s(r.층코드); if (!floors[c]) { floors[c] = { code: c, b: s(r.건물명), name: s(r.층명) || c, rooms: 0, ph: 0, assets: 0, unplaced: 0, links: 0, demo: 0, user: 0 }; order.push(c); }
      if (/미지정/.test(s(r.실유형))) floors[c].ph++; else floors[c].rooms++;
      if (isDemoRoom(r)) floors[c].demo++; else floors[c].user++;
    });
    var roomFloor = {}; t.rooms.forEach(function (r) { roomFloor[s(r.실코드)] = s(r.층코드); });
    var assetFloor = {};
    t.assets.forEach(function (a) { var c = roomFloor[s(a.소속실)]; assetFloor[s(a.설비ID)] = c; if (!floors[c]) return; floors[c].assets++; if (/UNASSIGNED$/.test(s(a.소속실))) floors[c].unplaced++; if (isDemoAsset(a, demoRooms)) floors[c].demo++; else floors[c].user++; });
    t.links.forEach(function (l) { var c = assetFloor[s(l.출발설비ID)]; if (floors[c]) floors[c].links++; });
    var nDemo = { rooms: Object.keys(demoRooms).length, assets: t.assets.filter(function (a) { return isDemoAsset(a, demoRooms); }).length };
    return { floors: order.map(function (c) { return floors[c]; }), demo: nDemo, demoRooms: demoRooms };
  }

  /* ---------- 초기화 계산 (미리보기 + 실행) ---------- */
  function planDemo(t) {
    var a = analyze(t), dr = a.demoRooms, rmA = {};
    t.assets.forEach(function (x) { if (isDemoAsset(x, dr)) rmA[s(x.설비ID)] = 1; });
    var n = { rooms: t.rooms.filter(function (r) { return dr[s(r.실코드)]; }).length, assets: Object.keys(rmA).length, links: t.links.filter(function (l) { return rmA[s(l.출발설비ID)] || rmA[s(l.도착설비ID)]; }).length };
    var out = clone(t); out.rooms = out.rooms.filter(function (r) { return !dr[s(r.실코드)]; }); out.assets = out.assets.filter(function (x) { return !rmA[s(x.설비ID)]; });
    return { n: n, t: tidy(out) };
  }
  function planRebuild(t, codes) {
    var set = {}; codes.forEach(function (c) { set[c] = 1; });
    var out = clone(t), rmRooms = {};
    out.rooms.forEach(function (r) { if (set[s(r.층코드)]) rmRooms[s(r.실코드)] = 1; });
    var n = { rooms: out.rooms.filter(function (r) { return set[s(r.층코드)] && !/미지정/.test(s(r.실유형)); }).length, assets: out.assets.filter(function (a) { return rmRooms[s(a.소속실)]; }).length, links: 0 };
    var rmA = {}; out.assets.forEach(function (a) { if (rmRooms[s(a.소속실)]) rmA[s(a.설비ID)] = 1; });
    n.links = out.links.filter(function (l) { return rmA[s(l.출발설비ID)] || rmA[s(l.도착설비ID)]; }).length;
    var infos = {}; codes.forEach(function (c) { infos[c] = floorInfo(t, c); });
    out.rooms = out.rooms.filter(function (r) { return !rmRooms[s(r.실코드)]; }).concat(codes.map(function (c) { return placeholder(t, c, infos[c]); }));
    out.assets = out.assets.filter(function (a) { return !rmA[s(a.설비ID)]; });
    // 도면매핑은 유지 (tidy 가 지우지 않도록 자리표시 실이 층을 붙잡음)
    return { n: n, t: tidy(out) };
  }
  /** 배치 해제: ADMIN은 설비 좌표가 소속 실 안이어야 하므로, 해제된 설비는 층의 「실 미지정」 자리표시 실로 옮기고
      원래 실은 규격 칸 태그 [원위치:실코드] 로 남김 (다시 배치할 때 안내) */
  function planUnplace(t, codes, dropRooms) {
    var set = {}; codes.forEach(function (c) { set[c] = 1; });
    var out = clone(t), inFloor = {};
    out.rooms.forEach(function (r) { if (set[s(r.층코드)] && !/미지정/.test(s(r.실유형))) inFloor[s(r.실코드)] = s(r.층코드); });
    var n = { rooms: dropRooms ? Object.keys(inFloor).length : 0, assets: 0, links: 0 };
    var infos = {}; codes.forEach(function (c) { infos[c] = floorInfo(t, c); });
    var ph = {}; codes.forEach(function (c) { ph[c] = out.rooms.find(function (r) { return s(r.실코드) === c + '-UNASSIGNED'; }) || placeholder(t, c, infos[c]); });
    out.assets.forEach(function (a) {
      var c = inFloor[s(a.소속실)]; if (!c) return;
      n.assets++;
      var tag = '[원위치:' + s(a.소속실) + ']', sp = s(a.규격).replace(/\[원위치:[^\]]*\]\s*/g, '');
      a.규격 = (tag + (sp ? ' ' + sp : '')).trim();
      a.소속실 = c + '-UNASSIGNED'; a.X = +ph[c].X + 50; a.Y = +ph[c].Y + 50;
    });
    if (dropRooms) out.rooms = out.rooms.filter(function (r) { return !inFloor[s(r.실코드)]; });
    codes.forEach(function (c) { if (!out.rooms.some(function (r) { return s(r.실코드) === c + '-UNASSIGNED'; })) out.rooms.push(ph[c]); });
    return { n: n, t: out };
  }
  function planAll(t) {
    var n = { rooms: t.rooms.length, assets: t.assets.length, links: t.links.length };
    return { n: n, t: { rooms: [], assets: [], links: [], history: [], maps: [], rules: clone(t.rules || []) } };
  }

  /* ---------- 백업 / 복원 ---------- */
  var LOCAL = ['twinx_geom_v1', 'twinx_rack_v1', 'twinx_match_v1', 'twinx_quick_v1', 'twinx_dream_v1', 'twinx_riskw_v1', 'twinx_topo_layout_v1', 'twinx_match_seen_v1'];
  // 존재하는 DB만 연다 (없는 DB를 버전 없이 열면 빈 DB가 생겨 원래 모듈의 저장소 생성이 막힘)
  function idbExists(name) { return indexedDB.databases ? indexedDB.databases().then(function (l) { return l.some(function (d) { return d.name === name; }); }).catch(function () { return false; }) : Promise.resolve(false); }
  function idbAll(name, store) {
    return idbExists(name).then(function (ok) {
      if (!ok) return [];
      return new Promise(function (res) {
        try { var q = indexedDB.open(name); q.onerror = function () { res([]); }; q.onsuccess = function () { var db = q.result; if (!db.objectStoreNames.contains(store)) { db.close(); res([]); return; } var r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = function () { res(r.result || []); db.close(); }; r.onerror = function () { res([]); }; }; } catch (e) { res([]); }
      });
    });
  }
  function idbClear(name, store) {
    return idbExists(name).then(function (ok) {
      if (!ok) return;
      return new Promise(function (res) { try { var q = indexedDB.open(name); q.onerror = function () { res(); }; q.onsuccess = function () { var db = q.result; if (!db.objectStoreNames.contains(store)) { db.close(); res(); return; } var tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); tx.oncomplete = function () { db.close(); res(); }; tx.onerror = function () { res(); }; }; } catch (e) { res(); } });
    });
  }
  function blobToData(b) { return new Promise(function (res) { if (!(b instanceof Blob)) { res(b); return; } var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(b); }); }
  function backup(reason) {
    var t = raw(), loc = {};
    LOCAL.forEach(function (k) { try { var v = localStorage.getItem(k); if (v != null) loc[k] = v; } catch (e) { } });
    return idbAll('twinx_underlay_v1', 'u').then(function (ul) {
      return Promise.all(ul.map(function (r) { var o = Object.assign({}, r); delete o.img; return blobToData(r.blob || r.data || null).then(function (d) { if (d) o._data = d; delete o.blob; return o; }); }));
    }).then(function (ul) {
      var data = { _twinxBackup: 1, at: new Date().toISOString(), reason: reason || '', admin: t, local: loc, underlay: ul };
      U.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'TwinX_백업_' + stamp() + '.json');
      return data;
    });
  }
  function restore(file) {
    return file.text().then(function (txt) {
      var d = JSON.parse(txt); if (!d || !d._twinxBackup) throw new Error('TwinX 백업 파일이 아닙니다');
      Object.keys(d.local || {}).forEach(function (k) { try { localStorage.setItem(k, d.local[k]); } catch (e) { } });
      var p = Promise.resolve();
      if (d.underlay && d.underlay.length && TX.underlay && TX.underlay.load) {
        d.underlay.forEach(function (r) {
          if (!r._data || !r.floor) return;
          p = p.then(function () { return fetch(r._data).then(function (x) { return x.blob(); }).then(function (b) { return TX.underlay.load(r.floor, new File([b], r.name || 'plan.png', { type: b.type })); }).then(function () { if (r.tf) TX.underlay.update(r.floor, { tf: r.tf, opacity: r.opacity, invert: r.invert, show: r.show !== false }); }).catch(function () { }); });
        });
      }
      return p.then(function () { return d; });
    });
  }

  /* ---------- 화면 ---------- */
  var md = null, sel = {}, opt = { geom: true, dropRooms: false, photos: false };
  function close() { if (md) { md.remove(); md = null; } }
  function open() {
    if (!md) { md = U.el('div', 'tx-wb-modal tx-rs'); root().appendChild(md); bind(); }
    render();
  }
  function counts(n) { return '실 ' + n.rooms + ' · 설비 ' + n.assets + ' · 연결 ' + n.links; }
  function render() {
    var t = raw(), q = TX.quick && TX.quick.active && TX.quick.active(), D = q ? TX.quick.draft() : null;
    if (!t) { md.innerHTML = '<div class="tx-wb-dlg"><div class="tx-wb-hd"><div><b>ADMIN 자료를 읽지 못했습니다</b></div><button type="button" class="tx-wb-x" data-r="close">✕</button></div></div>'; return; }
    var an = analyze(t), codes = Object.keys(sel).filter(function (k) { return sel[k]; });
    var pDemo = planDemo(t), pReb = codes.length ? planRebuild(t, codes) : null, pUn = codes.length ? planUnplace(t, codes, opt.dropRooms) : null, pAll = planAll(t);
    var ul = function (c) { return TX.underlay && TX.underlay.get && TX.underlay.get(c); };
    var h = '<div class="tx-wb-dlg tx-rs-dlg" role="dialog" aria-modal="true" aria-label="데이터 관리 센터">' +
      '<div class="tx-wb-hd"><div><small>데이터 관리 센터 · 출처 확인 · 백업 · 초기화</small><b>현재 표시: ' + esc(TX.model && TX.model.source === 'quick' ? '간이 현행화 초안' : TX.model && TX.model.empty ? 'ADMIN 등록 자료 (비어 있음)' : 'ADMIN 등록 자료') + (an.demo.rooms ? ' · 시범 자료 포함 (실 ' + an.demo.rooms + ' · 설비 ' + an.demo.assets + ')' : '') + '</b></div><button type="button" class="tx-wb-x" data-r="close" aria-label="닫기">✕</button></div>' +
      '<div class="tx-wb-body">' +
      '<p class="tx-wb-guide">직접 작성하지 않은 실·설비는 대부분 <b>ADMIN 기본 시범 자료</b>(건물코드 DEMO · 「시범 통신센터」 · 제조사 「시범 제조사」)입니다. 아래 표의 <b>출처</b>로 먼저 확인하고, 목적에 맞는 초기화를 고르세요. 모든 초기화는 실행 직전 <b>복원용 백업(JSON)</b>을 자동 저장하고, ADMIN 확인창에서 「전체 교체 적용」을 눌러야 반영됩니다.</p>' +
      '<div class="tx-rp-tbl"><table><thead><tr><th>선택</th><th>건물 · 층</th><th>실</th><th>설비 (미배치)</th><th>연결</th><th>도면 배경</th><th>출처</th></tr></thead><tbody>' +
      an.floors.map(function (f) {
        return '<tr><td><input type="checkbox" data-r="pick" data-c="' + esc(f.code) + '"' + (sel[f.code] ? ' checked' : '') + '></td><td><b>' + esc(f.b + ' ' + f.name) + '</b><small>' + esc(f.code) + '</small></td><td>' + f.rooms + (f.ph ? ' <small>(실 미지정 자리)</small>' : '') + '</td><td>' + f.assets + (f.unplaced ? ' (' + f.unplaced + ')' : '') + '</td><td>' + f.links + '</td><td>' + (ul(f.code) ? '✔ ' + esc(ul(f.code).name || '') : '—') + '</td>' +
          '<td>' + (f.demo && !f.user ? '<em class="tx-rs-demo">시범</em>' : f.demo ? '<em class="tx-rs-demo">시범 일부</em> + 등록' : '사용자 등록') + '</td></tr>';
      }).join('') + (an.floors.length ? '' : '<tr><td colspan="7">ADMIN 등록 자료가 비어 있습니다</td></tr>') + '</tbody></table></div>' +
      (q ? '<p class="tx-wb-help">지금은 <b>간이 현행화 초안</b>(층 ' + D.floors.length + ' · 실 ' + D.rooms.length + ' · 설비 ' + D.assets.length + ')을 보고 있습니다. 초안은 ADMIN에 등록하기 전까지 ADMIN 자료와 별개입니다.</p>' : '') +
      '<div class="tx-rs-grid">' +
      card('demo', '① 시범 데이터 제거', '출처가 「시범」으로 확인된 실·설비·연결·이력만 제거합니다. 사용자 등록 자료와 도면은 유지됩니다.', pDemo.n.rooms + pDemo.n.assets ? '제거: ' + counts(pDemo.n) : '제거할 시범 자료가 없습니다', !(pDemo.n.rooms + pDemo.n.assets)) +
      card('rebuild', '② 선택 층 공간·설비 새로 작성 (도면 유지)', '선택한 층의 실·설비·연결을 비우고, 등록한 도면 배경과 도면매핑은 그대로 둡니다. 빈 층으로 간이 현행화가 시작되어 그 위에 다시 작성합니다.' +
        '<label class="tx-wb-chk"><input type="checkbox" data-r="opt" data-k="geom"' + (opt.geom ? ' checked' : '') + '> 이 층의 트레이·라이저·문 등록값도 비우기</label>', pReb ? '제거: ' + counts(pReb.n) + ' · 도면 유지' : '위 표에서 층을 선택하세요', !pReb) +
      card('unplace', '③ 선택 층 배치만 초기화', '설비 대장·연결은 유지하고 도면상의 위치만 해제합니다. 해제된 설비는 「미배치 설비」(실 미지정)로 관리되어 임의 위치에 표시되지 않고, 원래 실은 기록해 두었다가 다시 배치할 때 안내합니다.' +
        '<label class="tx-wb-chk"><input type="checkbox" data-r="opt" data-k="dropRooms"' + (opt.dropRooms ? ' checked' : '') + '> 실도 함께 삭제 (공간 경계부터 다시 그리기)</label>', pUn ? '위치 해제: 설비 ' + pUn.n.assets + (opt.dropRooms ? ' · 실 삭제 ' + pUn.n.rooms : '') : '위 표에서 층을 선택하세요', !pUn) +
      card('all', '④ 프로젝트 전체 초기화', '도면·공간·설비·연결·점검이력과 이 브라우저의 구조 입력·랙·매칭·초안·꿈꾸기 기록을 모두 비웁니다 (상태 규칙은 유지). 측정 자료(측정 대시보드)는 ADMIN에 남습니다.' +
        '<label class="tx-wb-chk"><input type="checkbox" data-r="opt" data-k="photos"' + (opt.photos ? ' checked' : '') + '> 현장 사진도 삭제</label>', '제거: ' + counts(pAll.n) + ' · 도면 배경 ' + (TX.underlay && TX.underlay.list ? TX.underlay.list().length : 0) + '개', false, true) +
      '</div></div>' +
      '<div class="tx-wb-ft"><div class="tx-wb-ft-l"><button type="button" class="tx-wb-link" data-r="backup">복원용 백업 저장</button><button type="button" class="tx-wb-link" data-r="restore">백업 복원</button></div><div><button type="button" class="tx-wb-btn" data-r="close">닫기</button></div></div></div>';
    md.innerHTML = h;
  }
  function card(k, title, desc, preview, disabled, danger) {
    return '<section class="tx-rs-card' + (danger ? ' is-danger' : '') + '"><b>' + title + '</b><p>' + desc + '</p><small>' + esc(preview) + '</small>' +
      '<button type="button" class="tx-wb-btn ' + (danger ? 'tx-wb-dangerbtn' : 'tx-wb-pri') + '" data-r="run" data-k="' + k + '"' + (disabled ? ' disabled' : '') + '>실행</button></section>';
  }
  function bind() {
    md.addEventListener('click', function (e) {
      if (e.target === md) { close(); return; }
      var b = e.target.closest('[data-r]'); if (!b) return;
      var a = b.getAttribute('data-r');
      if (a === 'close') close();
      else if (a === 'pick') { sel[b.getAttribute('data-c')] = b.checked; render(); }
      else if (a === 'opt') { opt[b.getAttribute('data-k')] = b.checked; render(); }
      else if (a === 'backup') backup('수동 백업').then(function () { toast('복원용 백업을 저장했습니다', 'success'); });
      else if (a === 'restore') pick('.json,application/json', function (f) { restore(f).then(function (d) { if (d.admin && confirm('백업의 ADMIN 자료(실 ' + d.admin.rooms.length + ' · 설비 ' + d.admin.assets.length + ')도 ADMIN에 다시 등록할까요?\n[취소]를 누르면 이 브라우저의 구조·랙·도면 배경만 복원합니다.')) { close(); push(d.admin, '백업 자료를 ADMIN에 전달했습니다 · 「전체 교체 적용」을 누르면 복원됩니다'); } else { toast('이 브라우저 자료를 복원했습니다', 'success'); if (TX.data) TX.data.refresh(true); } }).catch(function (err) { toast('복원 실패: ' + err.message, 'error'); }); });
      else if (a === 'run') runReset(b.getAttribute('data-k'));
    });
    md.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  }
  function pick(accept, cb) { var i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none'; i.onchange = function () { var f = i.files && i.files[0]; i.remove(); if (f) cb(f); }; document.body.appendChild(i); i.click(); }
  function clearGeomFloors(codes) {
    try {
      var g = JSON.parse(localStorage.getItem('twinx_geom_v1') || '{}') || {}; g.trays = g.trays || {}; g.risers = g.risers || []; g.doors = g.doors || {};
      codes.forEach(function (c) { delete g.trays[c]; });
      g.risers = g.risers.map(function (r) { if (r.floors) r.floors = r.floors.filter(function (f) { return codes.indexOf(f) < 0; }); return r; }).filter(function (r) { return !r.floors || r.floors.length; });
      Object.keys(g.doors).forEach(function (rid) { var rm = TX.room(rid); if (rm && codes.indexOf(rm.floor) >= 0) delete g.doors[rid]; });
      localStorage.setItem('twinx_geom_v1', JSON.stringify(g));
    } catch (e) { }
  }
  function runReset(k) {
    var t = raw(); if (!t) return;
    var codes = Object.keys(sel).filter(function (c) { return sel[c]; }), plan, label;
    if (k === 'demo') { plan = planDemo(t); label = '시범 데이터 제거'; }
    else if (k === 'rebuild') { plan = planRebuild(t, codes); label = codes.join(', ') + ' 공간·설비 새로 작성 (도면 유지)'; }
    else if (k === 'unplace') { plan = planUnplace(t, codes, opt.dropRooms); label = codes.join(', ') + ' 배치 초기화'; }
    else { plan = planAll(t); label = '프로젝트 전체 초기화'; }
    var msg = '「' + label + '」\n\n대상: ' + counts(plan.n) + '\n실행 전에 복원용 백업(JSON)을 저장합니다.\nADMIN 확인창에서 「전체 교체 적용」을 눌러야 실제로 반영됩니다.\n\n계속할까요?';
    if (!confirm(msg)) return;
    if (k === 'all' && !confirm('정말 전체를 비울까요? (백업 파일로만 되돌릴 수 있습니다)')) return;
    backup(label).then(function () {
      if (k === 'rebuild') {
        if (opt.geom) clearGeomFloors(codes);
        // 빈 층으로 간이 현행화 시작 (같은 층코드 → 도면 배경 그대로)
        if (TX.quick && TX.quick.startFloors) TX.quick.startFloors(codes.map(function (c) { var fi = floorInfo(t, c), f = TX.floor(c) || {}; return { code: c, building: s(fi.건물명) || f.building || '', bcode: s(fi.건물코드), name: s(fi.층명) || f.name || c, level: f.level != null ? f.level : 1 }; }));
      }
      if (k === 'unplace' && opt.dropRooms && opt.geom) clearGeomFloors(codes);
      if (k === 'all') {
        ['twinx_geom_v1', 'twinx_rack_v1', 'twinx_match_v1', 'twinx_quick_v1', 'twinx_dream_v1', 'twinx_riskw_v1', 'twinx_topo_layout_v1', 'twinx_match_seen_v1'].forEach(function (x) { try { localStorage.removeItem(x); } catch (e) { } });
        if (TX.underlay && TX.underlay.clearAll) TX.underlay.clearAll();
        if (opt.photos) idbClear('twinx_photo_v1', 'photos');
      }
      close();
      push(plan.t, '「' + label + '」 자료를 ADMIN에 전달했습니다 · 「검증 완료」 확인 후 「전체 교체 적용」을 누르세요', { keepQuick: k === 'rebuild' });
    });
  }

  /* ---------- 메뉴 ---------- */
  function injectMenu() {
    var m = document.querySelector('.tx-wb-menu'); if (!m || m.querySelector('[data-rs]')) return;
    var b = U.el('button', '', '<b>데이터 관리 센터</b><small>출처 확인 · 백업/복원 · 시범 제거 · 도면 유지 초기화 · 배치 초기화</small>');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.setAttribute('data-rs', '1');
    b.addEventListener('click', function (e) { e.stopPropagation(); m.remove(); var tb = document.querySelector('[data-act="wb-menu"]'); if (tb) tb.setAttribute('aria-expanded', 'false'); open(); });
    m.insertBefore(b, m.firstChild);
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-act="wb-menu"]')) setTimeout(injectMenu, 0); });

  // 상태 색 기준 전환 → 저장 + 모델 다시 칠하기
  var lastBasis = !!(TX.state.layers && TX.state.layers.gradeAdmin);
  TX.on('state', function () { var b = !!(TX.state.layers && TX.state.layers.gradeAdmin); if (b === lastBasis) return; lastBasis = b; try { localStorage.setItem('twinx_grade_basis', b ? 'admin' : 'merged'); } catch (e) { } if (TX.model) TX.setModel(TX.model); toast(b ? '상태 색: ADMIN 등록 상태 기준 (ADMIN 화면과 동일)' : '상태 색: 측정 판정 반영 (주의 측정 → 관찰)', 'info'); });
  TX.adminSync = { raw: raw, sheets: sheets, push: push, merge: merge, placeholder: placeholder, analyze: analyze, plan: { demo: planDemo, rebuild: planRebuild, unplace: planUnplace, all: planAll }, backup: backup, restore: restore };
  TX.dataCenter = { open: open, close: close };
})();
