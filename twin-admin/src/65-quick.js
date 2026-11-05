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
  function blank() { return { active: false, site: '', buildings: [], floors: [], rooms: [], assets: [], links: [], autoLinks: true, source: [] }; }
  function load() { try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d ? Object.assign(blank(), d) : blank(); } catch (e) { return blank(); } }
  var D = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { toast('브라우저 저장공간에 저장하지 못했습니다', 'error'); } }

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
  var COLS = { name: /설비\s*명|장비\s*명|명칭/, model: /규격|모델/, qty: /수량/, maker: /제조/, loc: /설치\s*위치|위치/, year: /설치\s*연도|연도|년도/, note: /비고|관리|소유/ };
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
    return lines.map(function (c) {
      var g = function (k) { return idx[k] != null ? clean(c[idx[k]]) : ''; };
      var q = parseInt(String(c[idx.qty] || '1').replace(/[^\d]/g, ''), 10);
      return { name: g('name'), model: g('model'), qty: q > 0 ? Math.min(q, 200) : 1, maker: g('maker'), loc: String(c[idx.loc] || '').trim(), year: g('year'), note: g('note') };
    }).filter(function (r) { return r.name; });
  }
  function importTable(rows) {
    var made = 0;
    rows.forEach(function (r) {
      var L = parseLoc(r.loc), f = ensureFloor(L.building, L.floorName, L.level);
      var tag = tagOf(r), n = D.assets.filter(function (a) { return a.floor === f.code && a.tag === tag; }).length;
      for (var i = 0; i < r.qty; i++) {
        n++;
        D.assets.push({ id: f.code + '-' + tag + '-' + pad(n, 3), tag: tag, name: r.qty > 1 ? r.name + ' #' + (i + 1) : r.name, model: r.model, maker: r.maker, year: r.year, note: r.note,
          floor: f.code, roomHint: L.room, room: null, x: null, y: null, status: '정상', category: categoryOf(r), srcLoc: r.loc });
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
    var assets = D.assets.filter(function (a) { return a.room; }).map(function (a) {
      return { id: a.id, room: a.room, floor: a.floor, name: a.name, category: a.category, kind: kindOf(a), model: a.model, maker: a.maker, spec: '', x: a.x, y: a.y, status: a.status, grade: a.status === '이상' ? 'RED' : a.status === '주의' ? 'ORANGE' : 'GREEN', measures: [], raw: a };
    });
    var ids = {}; assets.forEach(function (a) { ids[a.id] = 1; });
    var links = D.links.filter(function (l) { return ids[l.from] && ids[l.to]; }).map(function (l) { return { id: l.id, from: l.from, to: l.to, type: l.type, label: l.auto ? '기본 규칙' : '', cable: '' }; });
    return { source: 'quick', site: { name: (D.site || '간이 현행화') + ' (초안)', building: D.buildings[0] ? D.buildings[0].name : '' }, floors: floors, rooms: rooms, assets: assets, links: links, risers: [], measurements: [], updatedAt: new Date().toISOString() };
  }
  function apply() { if (D.active && D.floors.length) TX.setModel(toModel()); renderPanel(); }

  /* ---------------- ADMIN 등록용 엑셀 (6개 표준 시트 + 원본) ---------------- */
  function sheetsData() {
    var rooms = [['실코드', '건물코드', '건물명', '층코드', '층명', '실명', '실유형', 'X', 'Y', 'W', 'H']];
    D.rooms.forEach(function (r) { var f = D.floors.find(function (q) { return q.code === r.floor; }); rooms.push([r.id, f.bcode, f.building, f.code, f.name, r.name, r.kind, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]); });
    var assets = [['설비ID', '소속실', '설비명', '설비구분', '모델명', '제조사', '규격', '사진URL', 'X', 'Y', '상태', '설치일', '교체주기(개월)']];
    D.assets.filter(function (a) { return a.room; }).forEach(function (a) { assets.push([a.id, a.room, a.name, a.category, a.model, a.maker, a.year ? '설치연도 ' + a.year : '', '', Math.round(a.x), Math.round(a.y), a.status, '', '']); });
    var ids = {}; D.assets.forEach(function (a) { if (a.room) ids[a.id] = 1; });
    var links = [['연결ID', '출발설비ID', '도착설비ID', '연결유형', '케이블번호', '출발단자', '도착단자', '연결상태']];
    D.links.filter(function (l) { return ids[l.from] && ids[l.to]; }).forEach(function (l) { links.push([l.id, l.from, l.to, { optical: '광', data: '케이블', power: '전원' }[l.type] || '광', '', '', '', '정상']); });
    var hist = [['점검ID', '설비ID', '점검일', '점검자', '상태', '측정항목', '측정값', '단위', '비고', '작업구분']];
    var maps = [['층코드', '도면파일경로', '축척', '기준점X', '기준점Y', '도면너비', '도면높이']];
    toModel().floors.forEach(function (f) { if (D.rooms.some(function (r) { return r.floor === f.code; })) maps.push([f.code, '', 10, 0, 0, Math.ceil(f.bounds.x1 / 10) + 10, Math.ceil(f.bounds.y1 / 10) + 10]); });
    var rules = [['규칙ID', '상태코드', '색상코드', '측정항목', '연산자', '임계값', '단위'], ['R01', '이상', '#f43f5e', '접지저항', '>', 10, 'Ω'], ['R02', '주의', '#f59e0b', '온도', '>=', 35, '℃']];
    var src = [['설비명', '규격(모델명)', '수량', '제조사', '설치 위치', '설치연도', '비고']];
    D.source.forEach(function (r) { src.push([r.name, r.model, r.qty, r.maker, r.loc, r.year || '확인불가', r.note]); });
    var meas = [['건물', '층', '점검 위치', '설비', '측정 항목', '측정값', '단위', '기준', '판정']];
    return [['01_건물층실', rooms], ['02_설비마스터', assets], ['03_연결관계', links], ['04_점검이력', hist], ['05_도면매핑', maps], ['06_상태규칙', rules], ['측정값 데이터', meas], ['현행화표_원본', src]];
  }
  /* 최소 XLSX 작성기 (ZIP 무압축 저장 + inlineStr) — 외부 라이브러리 없이 오프라인 동작 */
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; } function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      var head = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, data);
      central.push([[].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off)), name]);
      off += head.length + name.length + data.length;
    });
    var cdStart = off, cdLen = 0;
    central.forEach(function (c) { var h = new Uint8Array(c[0]); parts.push(h, c[1]); cdLen += h.length + c[1].length; });
    parts.push(new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(cdLen), u32(cdStart), u16(0))));
    return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
  function buildXlsx() {
    var sh = sheetsData(), files = [];
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
  function exportXlsx() {
    var unplaced = D.assets.filter(function (a) { return !a.room; }).length;
    if (!D.rooms.length) { toast('실이 없습니다. ③ 실 그리기를 먼저 진행하세요', 'warn'); return; }
    var d = new Date(), stamp = d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2);
    U.download(buildXlsx(), 'ICT_Twin_Quick_' + stamp + '.xlsx');
    toast('ADMIN 등록용 엑셀을 내보냈습니다' + (unplaced ? ' · 미배치 설비 ' + unplaced + '대는 제외됨' : ''), unplaced ? 'warn' : 'success');
  }

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
  function close(keep) { if (P) { P.remove(); P = null; } stopTool(); if (!keep && D.active) setActive(false); }
  var STEPS = ['현행화표', '도면·축척', '실 그리기', '설비 배치', '연결·내보내기'];
  function renderPanel() {
    if (!P) return;
    var f = fl(), code = f && f.code;
    var placed = D.assets.filter(function (a) { return a.room; }).length;
    var h = '<div class="tx-wb-hd"><div><small>간이 현행화 모드 · 초안 (ADMIN 등록 전)</small><b>' + esc(D.site || '사업장 미정') + '</b></div><button type="button" class="tx-wb-x" data-q="close" aria-label="닫기">✕</button></div>' +
      '<div class="tx-qk-steps">' + STEPS.map(function (s, i) { return '<button type="button" data-q="step" data-k="' + (i + 1) + '" class="' + (step === i + 1 ? 'is-on' : '') + '"><i>' + (i + 1) + '</i>' + s + '</button>'; }).join('') + '</div>' +
      '<div class="tx-qk-sum">건물 ' + D.buildings.length + ' · 층 ' + D.floors.length + ' · 실 ' + D.rooms.length + ' · 설비 ' + placed + '/' + D.assets.length + ' 배치 · 연결 ' + D.links.length + '</div>' +
      (D.floors.length && step > 1 ? '<label class="tx-qk-floor">작업 층<select data-q="floor">' + D.floors.map(function (x) { return '<option value="' + esc(x.code) + '"' + (x.code === code ? ' selected' : '') + '>' + esc(x.building + ' ' + x.name) + ' (' + esc(x.code) + ')</option>'; }).join('') + '</select></label>' : '') +
      '<div class="tx-wb-body">';
    if (step === 1) {
      h += '<p class="tx-wb-guide">설비 현행화표(설비명·규격·수량·제조사·설치 위치·설치연도·비고)를 <b>엑셀·한글 표에서 복사해 붙여넣으세요</b>. 수량만큼 설비가 만들어지고, 설치 위치(예: 「본관 7층」)로 건물·층이 자동 생성됩니다. 「확인불가」는 빈 값으로 처리합니다.</p>' +
        '<label class="tx-qk-lbl">사업장 이름<input type="text" data-q="site" value="' + esc(D.site) + '" placeholder="예: ○○청사"></label>' +
        '<textarea data-q="paste" class="tx-qk-paste" placeholder="설비명\t규격(모델명)\t수량\t제조사\t설치 위치\t설치연도\t비고\nLTE 광중계기\tKELIS(R640)\t2\t에프알텍\t본관 7층\t확인불가\tkt"></textarea>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn tx-wb-pri" data-q="import">표 불러오기</button><button type="button" class="tx-wb-btn" data-q="addfloor">층 직접 추가</button></div>' +
        (D.assets.length ? '<h5>생성된 설비 <span class="tx-count">' + D.assets.length + '</span></h5><ul class="tx-wb-list tx-qk-alist">' + D.assets.map(function (a) {
          return '<li><span><b>' + esc(a.name) + '</b><small>' + esc(a.id) + ' · ' + esc((D.floors.find(function (x) { return x.code === a.floor; }) || {}).building || '') + ' ' + esc((D.floors.find(function (x) { return x.code === a.floor; }) || {}).name || '') + (a.model ? ' · ' + esc(a.model) : '') + '</small></span><button type="button" class="tx-wb-link tx-wb-danger" data-q="adel" data-id="' + esc(a.id) + '">삭제</button></li>';
        }).join('') + '</ul>' : '');
    } else if (step === 2) {
      var ul = code && TX.underlay && TX.underlay.get(code);
      h += '<p class="tx-wb-guide">이 층의 <b>대피소 도면(또는 종이도면) 사진</b>을 올리고, 길이를 아는 두 점(벽 양 끝, 복도 길이 등)을 클릭한 뒤 <b>실측 거리(mm)</b>를 입력하면 축척이 맞춰집니다. 사진은 정면에서 찍을수록 정확합니다.</p>' +
        (ul ? '<div class="tx-wb-file"><b>' + esc(ul.name || '도면 사진') + '</b><span>' + ul.w + '×' + ul.h + 'px · 1px = ' + ul.tf.s.toFixed(2) + 'mm · 도면 ' + (ul.w * ul.tf.s / 1000).toFixed(1) + '×' + (ul.h * ul.tf.s / 1000).toFixed(1) + 'm</span></div>' : '') +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn ' + (ul ? '' : 'tx-wb-pri') + '" data-q="photo">' + (ul ? '사진 교체' : '도면 사진 올리기') + '</button>' +
        (ul ? '<button type="button" class="tx-wb-btn tx-wb-pri" data-q="scale">치수로 축척 맞춤</button><button type="button" class="tx-wb-btn" data-q="rot">90° 회전</button>' : '') + '</div>' +
        '<label class="tx-qk-lbl">실측 거리 (mm)<input type="number" min="100" step="10" data-q="dist" value="' + (tool.dist || '') + '" placeholder="예: 12000 (복도 12m)"></label>' +
        (ul ? '<label class="tx-wb-rng">사진 투명도 <input type="range" min="10" max="100" step="5" data-q="op" value="' + Math.round(ul.opacity * 100) + '"><output>' + Math.round(ul.opacity * 100) + '%</output></label>' : '') +
        '<p class="tx-wb-help">사진이 없으면 이 단계를 건너뛰고 기본 40×25m 평면에 실을 그릴 수 있습니다. 실측 치수가 없으면 종이도면의 치수 표기나 표준 문 폭(약 900mm)을 기준으로 사용해도 됩니다.</p>';
    } else if (step === 3) {
      var rs = D.rooms.filter(function (r) { return r.floor === code; });
      h += '<p class="tx-wb-guide">도면 위에서 <b>실의 한 모서리에서 대각선 모서리까지 끌어서</b> 사각형을 그립니다(100mm 단위 정렬). 그리기 전에 실 이름·유형을 정하세요. 도면 이동은 「그리기 중지」 후 드래그.</p>' +
        '<div class="tx-wb-row2"><label>실 이름<input type="text" data-q="rname" value="' + esc(tool.roomName) + '" placeholder="예: 7층 EPS실"></label>' +
        '<label>유형<select data-q="rkind">' + ROOM_TYPES.map(function (t) { return '<option' + (t[0] === tool.roomKind ? ' selected' : '') + '>' + t[0] + '</option>'; }).join('') + '</select></label></div>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn ' + (cap && cap.mode === 'room' ? 'tx-wb-pri' : '') + '" data-q="rtool">' + (cap && cap.mode === 'room' ? '■ 그리기 중지' : '✎ 실 그리기 시작') + '</button></div>' +
        '<h5>이 층의 실 <span class="tx-count">' + rs.length + '</span></h5>' +
        (rs.length ? '<ul class="tx-wb-list">' + rs.map(function (r) { return '<li><span><input type="text" class="tx-qk-rin" data-q="rren" data-id="' + esc(r.id) + '" value="' + esc(r.name) + '"><small>' + esc(r.kind) + ' · ' + (r.w / 1000).toFixed(1) + '×' + (r.h / 1000).toFixed(1) + 'm · ' + esc(r.id) + '</small></span><button type="button" class="tx-wb-link tx-wb-danger" data-q="rdel" data-id="' + esc(r.id) + '">삭제</button></li>'; }).join('') + '</ul>' : '<p class="tx-wb-empty">아직 없음 · 통신실·EPS·복도·계단 위주로 그리면 충분합니다</p>');
    } else if (step === 4) {
      var as = D.assets.filter(function (a) { return a.floor === code; });
      h += '<p class="tx-wb-guide">목록에서 설비를 고른 뒤 <b>도면의 설치 위치를 클릭</b>하세요(실 안). 배치하면 다음 미배치 설비가 자동 선택됩니다.</p>' +
        (as.length ? '<ul class="tx-wb-list tx-qk-alist">' + as.map(function (a) {
          var r = a.room && D.rooms.find(function (q) { return q.id === a.room; });
          return '<li class="' + (tool.placeId === a.id ? 'is-sel' : '') + '"><span><b>' + esc(a.name) + '</b><small>' + (r ? '📍 ' + esc(r.name) : '<em class="tx-qk-un">미배치</em>') + (a.roomHint ? ' · 표기: ' + esc(a.roomHint) : '') + (a.model ? ' · ' + esc(a.model) : '') + '</small></span>' +
            '<button type="button" class="tx-wb-link" data-q="pick" data-id="' + esc(a.id) + '">' + (tool.placeId === a.id ? '클릭 대기' : r ? '다시 배치' : '배치') + '</button></li>';
        }).join('') + '</ul>' : '<p class="tx-wb-empty">이 층의 설비가 없습니다 (① 현행화표에서 생성)</p>');
    } else {
      h += '<label class="tx-wb-chk"><input type="checkbox" data-q="auto"' + (D.autoLinks ? ' checked' : '') + '> 기본 연결 규칙: 같은 층 OFD → 광중계기·5G RU (광)</label>' +
        '<h5>연결 <span class="tx-count">' + D.links.length + '</span></h5>' +
        (D.links.length ? '<ul class="tx-wb-list">' + D.links.map(function (l) { var a = D.assets.find(function (x) { return x.id === l.from; }), b = D.assets.find(function (x) { return x.id === l.to; }); return '<li><span><b>' + esc(a ? a.name : l.from) + ' → ' + esc(b ? b.name : l.to) + '</b><small>광 · ' + (l.auto ? '기본 규칙' : '수동') + '</small></span><button type="button" class="tx-wb-link tx-wb-danger" data-q="ldel" data-id="' + esc(l.id) + '">삭제</button></li>'; }).join('') + '</ul>' : '<p class="tx-wb-empty">연결 없음 (같은 층에 OFD가 없으면 규칙이 적용되지 않습니다)</p>') +
        '<div class="tx-qk-check">' + checks().map(function (c) { return '<div class="' + (c[1] ? 'ok' : 'ng') + '">' + (c[1] ? '✔ ' : '✖ ') + esc(c[0]) + '</div>'; }).join('') + '</div>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn tx-wb-pri" data-q="export">ADMIN 등록용 엑셀 내보내기</button></div>' +
        '<p class="tx-wb-help">내보낸 파일 → ADMIN <b>데이터 관리 → 엑셀 등록 → 「전체 교체 적용」</b>. 이후 점검 결과서는 <b>측정 대시보드 → 측정 엑셀 등록</b>으로 올리고 「측정 매칭 확인」에서 연결하세요. 「현행화표_원본」 시트에 설치연도·비고 원문이 보존됩니다.</p>' +
        '<div class="tx-wb-acts tx-wb-acts-2"><button type="button" class="tx-wb-link" data-q="jexport">초안 백업(JSON)</button><button type="button" class="tx-wb-link" data-q="jimport">초안 불러오기</button><button type="button" class="tx-wb-link tx-wb-danger" data-q="reset">초안 전체 삭제</button></div>';
    }
    h += '</div><div class="tx-qk-ft"><button type="button" class="tx-wb-btn" data-q="prev"' + (step === 1 ? ' disabled' : '') + '>← 이전</button><button type="button" class="tx-wb-btn tx-wb-pri" data-q="next"' + (step === 5 ? ' disabled' : '') + '>다음 →</button></div>';
    P.innerHTML = h;
    var st = cap && cap.bar; if (st) updateBar();
  }
  function checks() {
    var placed = D.assets.filter(function (a) { return a.room; });
    var floorsWithRooms = D.floors.filter(function (f) { return D.rooms.some(function (r) { return r.floor === f.code; }); });
    return [['실이 1개 이상 있음', D.rooms.length > 0], ['모든 설비 배치 완료 (' + placed.length + '/' + D.assets.length + ')', D.assets.length > 0 && placed.length === D.assets.length],
      ['설비가 있는 모든 층에 실이 있음', D.floors.filter(function (f) { return D.assets.some(function (a) { return a.floor === f.code; }); }).every(function (f) { return floorsWithRooms.indexOf(f) >= 0; })],
      ['사업장 이름 입력', !!D.site]];
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
        if (!rows.length) { toast('붙여넣은 표에서 설비를 찾지 못했습니다 (설비명 열 필요)', 'warn'); return; }
        var n = importTable(rows); TX.setState({ floor: D.floors[0].code }); toast('설비 ' + n + '대 · 층 ' + D.floors.length + '개를 만들었습니다', 'success');
      } else if (a === 'addfloor') {
        var s = prompt('건물과 층을 입력하세요 (예: 본관 7층)'); if (!s) return;
        var L = parseLoc(s); var f = ensureFloor(L.building, L.floorName, L.level); save(); apply(); TX.setState({ floor: f.code });
      } else if (a === 'adel') { D.assets = D.assets.filter(function (x) { return x.id !== id; }); D.links = D.links.filter(function (l) { return l.from !== id && l.to !== id; }); save(); apply(); }
      else if (a === 'photo') pickImage();
      else if (a === 'scale') startScale();
      else if (a === 'rot') { var c = curFloor(); if (TX.workbench && TX.underlay.get(c)) { var r = TX.underlay.get(c); TX.underlay.update(c, { tf: { rot: r.tf.rot + Math.PI / 2 } }); } renderPanel(); }
      else if (a === 'rtool') { if (cap && cap.mode === 'room') stopTool(); else startTool('room'); renderPanel(); }
      else if (a === 'rdel') { D.rooms = D.rooms.filter(function (r) { return r.id !== id; }); D.assets.forEach(function (x) { if (x.room === id) { x.room = null; x.x = x.y = null; } }); save(); apply(); }
      else if (a === 'pick') { tool.placeId = id; startTool('place'); renderPanel(); }
      else if (a === 'ldel') { D.links = D.links.filter(function (l) { return l.id !== id; }); save(); apply(); }
      else if (a === 'export') exportXlsx();
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
      else if (a === 'rren') { var r = D.rooms.find(function (q) { return q.id === t.getAttribute('data-id'); }); if (r) { r.name = t.value.trim() || r.name; save(); apply(); } }
      else if (a === 'dist') tool.dist = parseFloat(t.value) || null;
      else if (a === 'auto') { D.autoLinks = t.checked; autoLink(); save(); apply(); }
    });
    P.addEventListener('input', function (e) { var t = e.target; if (t.getAttribute('data-q') === 'op') { TX.underlay.update(curFloor(), { opacity: +t.value / 100 }); var o = t.parentNode.querySelector('output'); if (o) o.textContent = t.value + '%'; } });
    P.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); if (cap && cap.mode) { stopTool(); renderPanel(); } else close(true); } });
  }
  function pickFile(accept, cb) { var i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none'; i.onchange = function () { var f = i.files && i.files[0]; i.remove(); if (f) cb(f); }; document.body.appendChild(i); i.click(); }
  function pickImage() {
    var code = curFloor(); if (!code) { toast('먼저 ① 현행화표로 층을 만들거나 층을 추가하세요', 'warn'); return; }
    pickFile('image/*', function (file) {
      TX.underlay.load(code, file).then(function (ok) {
        if (!ok) return;
        var r = TX.underlay.get(code); var f = fl();
        // 기본: 이미지 좌상단 = 원점, 장변 40m 가정 (치수 맞춤 전 임시)
        var s = 40000 / Math.max(r.w, r.h);
        TX.underlay.update(code, { tf: { s: s, rot: 0, tx: 0, ty: 0 }, opacity: 0.85, invert: true });
        f.w = Math.round(r.w * s); f.h = Math.round(r.h * s); save(); apply();
        toast('사진을 올렸습니다 · 「치수로 축척 맞춤」을 진행하세요', 'success');
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
      if (cap.bar.contains(e.target) || e.button !== 0) return;
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
        var x0 = Math.round(Math.min(a.x, b.x) / 100) * 100, y0 = Math.round(Math.min(a.y, b.y) / 100) * 100, x1 = Math.round(Math.max(a.x, b.x) / 100) * 100, y1 = Math.round(Math.max(a.y, b.y) / 100) * 100;
        if (x1 - x0 < 600 || y1 - y0 < 600) { toast('실은 0.6m 이상 크기로 끌어서 그려 주세요', 'warn'); return; }
        addRoom(Math.max(0, x0), Math.max(0, y0), x1 - Math.max(0, x0), y1 - Math.max(0, y0));
      }
    };
    cap.click = function (e) {
      if (cap.bar.contains(e.target)) return;
      e.stopPropagation(); e.preventDefault();
      if (cap.d0 && Math.abs(e.clientX - cap.d0.x) + Math.abs(e.clientY - cap.d0.y) > 5) return;
      var mm = TX.cad2d.screenToMm(e.clientX, e.clientY); if (!mm) return;
      if (cap.mode === 'scale') {
        cap.pts.push(mm); mark(e.clientX, e.clientY, cap.pts.length);
        if (cap.pts.length === 2) finishScale(); else updateBar();
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
    var t = cap.mode === 'scale' ? (cap.pts.length ? '② 같은 치수의 다른 끝점을 클릭하세요' : '① 길이를 아는 구간의 한쪽 끝을 클릭하세요')
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
  function addRoom(x, y, w, h) {
    var code = curFloor(), n = 1;
    while (D.rooms.some(function (r) { return r.id === code + '-R' + pad(n, 2); })) n++;
    var id = code + '-R' + pad(n, 2), f = fl();
    var name = tool.roomName || (f.name + ' ' + tool.roomKind);
    if (D.rooms.some(function (r) { return r.floor === code && r.name === name; })) name = name + ' ' + n;
    D.rooms.push({ id: id, floor: code, name: name, kind: tool.roomKind, x: x, y: y, w: w, h: h });
    tool.roomName = '';
    // 설치 위치 표기(roomHint)가 이 실 이름과 맞는 미배치 설비가 있으면 안내
    save(); apply(); startTool('room');
    toast('「' + name + '」 실을 추가했습니다 (' + (w / 1000).toFixed(1) + '×' + (h / 1000).toFixed(1) + 'm)', 'success');
  }
  function placeAt(mm) {
    var code = curFloor(), r = D.rooms.find(function (q) { return q.floor === code && mm.x >= q.x && mm.x <= q.x + q.w && mm.y >= q.y && mm.y <= q.y + q.h; });
    if (!r) { toast('실 안을 클릭하세요 (실이 없으면 ③ 실 그리기 먼저)', 'warn'); return; }
    var a = D.assets.find(function (q) { return q.id === tool.placeId; }); if (!a) return;
    a.room = r.id; a.x = Math.round(mm.x); a.y = Math.round(mm.y); save();
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
  TX.on('close', function () { close(true); });
  TX.on('open', function () { if (D.active && D.floors.length) setTimeout(function () { TX.setModel(toModel()); }, 50); });

  TX.quick = { active: function () { return !!D.active; }, open: open, close: close, draft: function () { return D; }, parseTable: parseTable, parseLoc: parseLoc, buildXlsx: buildXlsx, model: toModel };
})();
