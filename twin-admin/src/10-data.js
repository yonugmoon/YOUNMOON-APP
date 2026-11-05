/* ============================================================
   T1 데이터·연동 — TwinX.data
   ADMIN React 상태(읽기 전용 fiber walk) → 계약 §2 정규화 모델
   - twin = {rooms, assets, links, history, maps, rules}  (React 훅 상태)
   - 측정 행 = '설비' in row && '판정' in row 인 배열 (정기점검 실측 자료)
   * React 상태는 절대 수정하지 않습니다(읽고 복사만).
   ============================================================ */
(function () {
  'use strict';
  var TwinX = window.TwinX;
  if (!TwinX || TwinX.data) return;

  var FLOOR_H = 4.2;          // m, 층고
  var BOUNDS_PAD = 1000;      // mm, 층 외곽 여유
  var RISER_TOL = 3000;       // mm, 라이저 층간 위치 허용 오차
  var CACHE_MS = 1500;
  var GRACE_MS = 5000;        // 로드 직후 React 마운트 대기(이후 데모 폴백)
  var POLL_OPEN = 2000, POLL_CLOSED = 6000;

  /* ---------------- 공통 유틸 ---------------- */
  function str(v) { return v == null ? '' : String(v).trim(); }
  function numOrNull(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  function copy(o) { return o && typeof o === 'object' ? Object.assign({}, o) : o; }
  function hashStr(s) { // FNV-1a 32bit
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  /* ---------------- 1. React 상태 읽기 (읽기 전용) ---------------- */
  function walk() {
    var root = document.getElementById('root');
    if (!root) return null;
    var key = Object.keys(root).find(function (k) { return k.indexOf('__reactContainer') === 0; });
    if (!key) return null;
    var twin = null, rows = null, stack = [root[key]], seen = new Set(), guard = 0;
    while (stack.length && guard++ < 80000) {
      var f = stack.pop();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      if (typeof f.type === 'function') {
        for (var h = f.memoizedState, n = 0; h && typeof h === 'object' && 'next' in h && n < 240; h = h.next, n++) {
          var v = h.memoizedState;
          if (!v || typeof v !== 'object') continue;
          if (!twin && Array.isArray(v.assets) && Array.isArray(v.rooms)) twin = v;
          var arr = Array.isArray(v) ? v : (Array.isArray(v.rows) ? v.rows : null);
          if (arr && arr.length && arr[0] && typeof arr[0] === 'object' && '설비' in arr[0] && '판정' in arr[0]) {
            if (!rows || arr.length > rows.length) rows = arr;
          }
        }
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return { twin: twin, rows: rows || [] };
  }

  /* ---------------- 2. 분류 규칙 ---------------- */
  var STD = [
    { id: 'gnd', re: /접지/ },
    { id: 'heat', re: /열화상|발열|표면\s*온도/ },
    { id: 'pwr', re: /전원|전압|전류|(^|[^a-z])(ac|dc)(?![a-z])|ups|배터리|축전지/i },
    { id: 'sig', re: /소음|신호|회선|레벨|손실|통신\s*상태|단선|광\s*파워|dBm/i },
    { id: 'env', re: /환경|온도|습도|조도|조명|먼지|청결/ }
  ];
  function stdOf(item, crit) {
    var s = str(item);
    for (var i = 0; i < STD.length; i++) if (STD[i].re.test(s)) return STD[i].id;
    s = str(crit);
    for (i = 0; i < STD.length; i++) if (STD[i].re.test(s)) return STD[i].id;
    return null;
  }
  /* 판정 해석 → {judge, warn} */
  function judgeOf(v) {
    var s = str(v);
    if (/불량|부적합|초과|미달|이상|고장|불합격|fail|ng\b/i.test(s)) return { judge: 'bad', warn: false };
    if (/주의|경고|관찰|보수|권고|warn/i.test(s)) return { judge: 'good', warn: true };
    if (/해당\s*없음|n\/?a\b|비해당|제외/i.test(s)) return { judge: 'na', warn: false };
    if (/양호|적합|정상|합격|ok|pass/i.test(s)) return { judge: 'good', warn: false };
    return { judge: 'none', warn: false };
  }
  /* 상태 문자열 → 등급 후보 */
  function statusGrade(s) {
    s = str(s);
    if (!s) return null;
    if (/이상|불량|고장|장애|불능|파손|위험|단선|에러|error|fault|down|offline|미작동|정지|폐기/i.test(s)) return 'RED';
    if (/주의|경고|점검\s*필요|요점검|보수|교체|노후|warn/i.test(s)) return 'ORANGE';
    if (/관찰|확인\s*필요/.test(s)) return 'YELLOW';
    if (/정상|양호|적합|ok|normal|가동|운영|사용/i.test(s)) return 'GREEN';
    return null;
  }

  var ROOM_RULES = [
    ['telecom', /MDF|IDF|TPS|EPS|통신|광/i],
    ['server', /서버|전산|server|데이터\s*센터|IDC/i],
    ['control', /관제|방재|상황|중앙\s*감시|모니터/],
    ['power', /UPS|축전지|정류|발전|배터리/i],
    ['elec', /전기|수배전|변전/],
    ['mech', /기계|공조|펌프/],
    ['corr', /복도|홀|corridor|통로/i],
    ['lobby', /로비|lobby|현관/i],
    ['stair', /계단|승강|E\/?V\b|엘리베이터|elevator/i],
    ['wc', /화장실|wc\b|toilet/i],
    ['store', /창고|저장/],
    ['park', /주차/]
  ];
  function roomTypeOf(text) {
    var s = str(text);
    for (var i = 0; i < ROOM_RULES.length; i++) if (ROOM_RULES[i][1].test(s)) return ROOM_RULES[i][0];
    return 'office';
  }

  var KIND_RULES = [
    ['power', /전원|UPS|정류|축전지|배터리|PDU|분전반?\s*전원/i],
    ['ap', /무선|(^|[^A-Za-z])AP([^A-Za-z]|$)|액세스\s*포인트|wi-?fi/i],
    ['video', /NVR|DVR|VMS|녹화/i],
    ['cctv', /CCTV|카메라|camera/i],
    ['video', /영상/],
    ['ground', /접지/],
    ['tray', /트레이|배관|덕트|tray/i],
    ['server', /서버|스토리지|storage|server|NAS\b/i],
    ['panel', /분전|단자함|패널|panel/i]
  ];
  function kindOf(name, cat) {
    var s = str(name) + ' ' + str(cat);
    for (var i = 0; i < KIND_RULES.length; i++) if (KIND_RULES[i][1].test(s)) return KIND_RULES[i][0];
    return 'rack';
  }

  function linkTypeOf(s) {
    s = str(s);
    if (/광|ODF|\bFO\b|fiber|optic|SMF|MMF/i.test(s)) return 'optical';
    if (/접지|ground|earth/i.test(s)) return 'ground';
    if (/전원|전력|\bDC\b|\bAC\b|power|UPS/i.test(s)) return 'power';
    if (/케이블|UTP|STP|랜|LAN|cat\.?\s*\d|data|통신|동축/i.test(s)) return 'data';
    return 'path';
  }

  /* 층 레벨: 'F04'→4, 'B01'→-1, 'B2'→-2, '지하1층'→-1, '8층'/'8F'→8, 'RF'/'옥상'→null(후처리) */
  function levelOf(s) {
    var t = str(s).toUpperCase().replace(/\s/g, '');
    if (!t) return null;
    var m;
    if ((m = t.match(/^(?:B|지하|BF|B-)(\d+)/)) || (m = t.match(/^(\d+)B$/)) || (m = t.match(/^지하(\d+)/))) return -Number(m[1]);
    if (/^(RF|PH|옥상|ROOF)/.test(t)) return null;
    if ((m = t.match(/^(?:F|L|지상)?(\d+)(?:F|층|L)?$/))) return Number(m[1]) || 1;
    if ((m = t.match(/^(\d+)/))) return Number(m[1]) || 1;
    return null;
  }
  /* 층 비교 키(측정 행 '8층'/'B1층' ↔ 층코드·층명) */
  function floorKey(s) {
    var t = str(s).toUpperCase().replace(/\s/g, '');
    if (!t) return '';
    if (/^(B|지하)/.test(t)) { var b = t.match(/\d+/); return 'B' + (b ? Number(b[0]) : 1); }
    var m = t.match(/\d+/);
    return m ? String(Number(m[0])) : t;
  }
  function isFloorCodeLike(s) { return /^(F|B|L)?\d{1,3}F?$/i.test(str(s)) || /^(B|지하)\d/i.test(str(s)); }

  /* ---------------- v14 레이어 하드코딩 시범값(보조) ----------------
     출처: base ADMIN_5 v14-layer ASSET_META (클로저 내부라 런타임 접근 불가 → 사본)
     시범 데이터의 동일 설비(같은 ID + 같은 소속실)일 때만 사용, raw.source='v14-ASSET_META' */
  var V14_META = {
    A001: { room: 'F04-R1', rack: 'MDF실 Main Rack #1', u: '20U~24U', gnd: '1.70 Ω (양호)', th: '28.4 / 24.8℃ (양호)', noise: '52.1 dB (양호)', lux: '734 lx (양호)' },
    A002: { room: 'F04-R1', rack: 'MDF실 Main Rack #1', u: '10U~14U', pwr: '218.6 V (양호)', gnd: '1.70 Ω (양호)', th: '38.2 / 25.1℃ (양호)', noise: '61.4 dB (양호)', lux: '734 lx (양호)' },
    A003: { room: 'F04-R1', rack: 'MDF실 Main Rack #1', u: '15U~19U', gnd: '1.70 Ω (양호)', th: '27.9 / 24.8℃ (양호)', noise: '50.2 dB (양호)', lux: '734 lx (양호)' },
    A004: { room: 'F04-R1', rack: 'MDF실 Main Rack #1', u: '01U~04U', pwr: '218.4 V (양호)', gnd: '1.70 Ω (양호)', th: '36.2 / 28.1℃ (양호)', noise: '58.4 dB (양호)', lux: '209 lx (주의)' },
    A005: { room: 'F04-R2', rack: '서버실 Server Rack #1', u: '12U~15U', pwr: '219.2 V (양호)', gnd: '1.70 Ω (양호)', th: '41.0 / 28.5℃ (양호)', noise: '64.2 dB (양호)', lux: '209 lx (주의)' },
    A006: { room: 'F04-R2', rack: '서버실 Server Rack #1', u: '04U~09U', pwr: '218.9 V (양호)', gnd: '1.70 Ω (양호)', th: '46.3 / 31.2℃ (양호)', noise: '72.9 dB (기준초과)', lux: '209 lx (주의)' },
    A007: { room: 'F04-R3', rack: 'TPS실 벽부형 함체 #1', u: '05U~08U', pwr: '217.5 V (양호)', gnd: '0.36 Ω (양호)', th: '34.5 / 26.5℃ (양호)', noise: '55.8 dB (양호)', lux: '32 lx (조도보수)' },
    A008: { room: 'F04-R3', rack: 'TPS실 벽부형 함체 #1', u: '09U~12U', gnd: '0.36 Ω (양호)', th: '27.1 / 26.5℃ (양호)', noise: '48.0 dB (양호)', lux: '32 lx (조도보수)' },
    A009: { room: 'B01-R1', rack: 'B1 방재실 Console #1', u: '06U~09U', pwr: '216.8 V (양호)', gnd: '29.4 Ω (접지불량)', th: '36.8 / 28.3℃ (양호)', noise: '62.0 dB (양호)', lux: '185 lx (양호)' },
    A010: { room: 'B01-R1', rack: 'B1 방재실 Console #1', u: '01U~05U', pwr: '217.0 V (양호)', gnd: '29.9 Ω (접지불량)', th: '34.3 / 28.3℃ (양호)', noise: '59.1 dB (양호)', lux: '185 lx (양호)' }
  };
  var V14_ITEMS = { pwr: ['pwr', '입력 전원(AC)'], gnd: ['gnd', '접지저항'], th: ['heat', '열화상 표면/주변 온도'], noise: ['sig', '이상 소음'], lux: ['env', '조도'] };
  function parseURange(u) {
    var m = str(u).match(/(\d+)\s*U?\s*[~\-]\s*(\d+)/i);
    if (!m) { var one = numOrNull(u); return one == null ? null : { u0: one, u1: one }; }
    var a = Number(m[1]), b = Number(m[2]);
    return { u0: Math.min(a, b), u1: Math.max(a, b) };
  }

  /* ---------------- 3. 변환 ---------------- */
  function convert(d) {
    var twin = d.twin, rowsIn = d.rows || [];
    var R = (twin.rooms || []).filter(function (r) { return r && typeof r === 'object' && str(r.실코드); });
    if (!R.length) return null;
    var A = (twin.assets || []).filter(function (a) { return a && typeof a === 'object' && str(a.설비ID); });
    var L = (twin.links || []).filter(function (l) { return l && typeof l === 'object'; });
    var H = (twin.history || []).filter(function (h) { return h && typeof h === 'object'; });
    var RULES = (twin.rules || []).filter(function (r) { return r && typeof r === 'object' && str(r.측정항목); });
    var dropped = { assets: 0, links: 0 };

    /* --- 층 --- */
    var floorMap = {}, floorOrder = [];
    R.forEach(function (r) {
      var code = str(r.층코드) || ('F' + (floorKey(r.층명) || '1'));
      if (!floorMap[code]) {
        var lv = isFloorCodeLike(code) ? levelOf(code) : null;
        if (lv == null) lv = levelOf(r.층명);
        if (lv == null) lv = levelOf(code);
        floorMap[code] = { code: code, name: str(r.층명) || code, building: str(r.건물명), buildingCode: str(r.건물코드), level: lv, rooms: [] };
        floorOrder.push(code);
      }
    });
    // 레벨 미상(RF/옥상 등) → 최상층+1
    var knownMax = floorOrder.reduce(function (m, c) { var l = floorMap[c].level; return l != null && l > m ? l : m; }, 0);
    floorOrder.forEach(function (c) { if (floorMap[c].level == null) floorMap[c].level = ++knownMax; });

    /* --- 실 --- */
    var rooms = [], roomById = {};
    R.forEach(function (r) {
      var code = str(r.층코드) || ('F' + (floorKey(r.층명) || '1'));
      var x = numOrNull(r.X), y = numOrNull(r.Y), w = numOrNull(r.W), h = numOrNull(r.H);
      var room = {
        id: str(r.실코드), floor: code, building: str(r.건물명), name: str(r.실명) || str(r.실코드),
        type: roomTypeOf(str(r.실유형) + ' ' + str(r.실명)),
        x: x == null ? null : x, y: y == null ? null : y, w: w > 0 ? w : null, h: h > 0 ? h : null,
        door: null, measures: [], raw: copy(r)
      };
      if (roomById[room.id]) return; // 실코드 중복 → 첫 행 사용
      roomById[room.id] = room; rooms.push(room); floorMap[code].rooms.push(room);
    });
    // 좌표 없는 실 → 같은 층 외곽 오른쪽에 4m×4m 로 나열(추정)
    floorOrder.forEach(function (c) {
      var rs = floorMap[c].rooms, ok = rs.filter(function (r) { return r.x != null && r.y != null && r.w && r.h; });
      var maxX = ok.length ? Math.max.apply(null, ok.map(function (r) { return r.x + r.w; })) : 0;
      var minY = ok.length ? Math.min.apply(null, ok.map(function (r) { return r.y; })) : 0;
      var k = 0;
      rs.forEach(function (r) {
        if (r.x != null && r.y != null && r.w && r.h) return;
        r.w = r.w || 4000; r.h = r.h || 4000;
        r.x = maxX + 1000 + (k % 3) * (r.w + 1000); r.y = minY + Math.floor(k / 3) * (r.h + 1000); k++;
        r.geomEstimated = true;
      });
    });

    var floors = floorOrder.map(function (c) {
      var f = floorMap[c], rs = f.rooms;
      var x0 = Math.min.apply(null, rs.map(function (r) { return r.x; })), y0 = Math.min.apply(null, rs.map(function (r) { return r.y; }));
      var x1 = Math.max.apply(null, rs.map(function (r) { return r.x + r.w; })), y1 = Math.max.apply(null, rs.map(function (r) { return r.y + r.h; }));
      return {
        code: c, name: f.name, building: f.building, level: f.level,
        // 계약 예시(demoModel)와 동일: 지상 (level-1)×4.2m, 지하 level×4.2m
        elevation: Math.round((f.level > 0 ? (f.level - 1) : f.level) * FLOOR_H * 100) / 100,
        bounds: { x0: x0 - BOUNDS_PAD, y0: y0 - BOUNDS_PAD, x1: x1 + BOUNDS_PAD, y1: y1 + BOUNDS_PAD },
        trays: []
      };
    });
    floors.sort(function (a, b) { return b.level - a.level || a.building.localeCompare(b.building) || a.code.localeCompare(b.code); });
    var floorByCode = {}; floors.forEach(function (f) { floorByCode[f.code] = f; });

    /* --- 문 방향 --- */
    function roomCenter(r) { return [r.x + r.w / 2, r.y + r.h / 2]; }
    function sideGap(r, c) { // 실 r 의 각 변과 복도 c 의 간격(겹침이 있어야 유효)
      var ox = Math.min(r.x + r.w, c.x + c.w) - Math.max(r.x, c.x), oy = Math.min(r.y + r.h, c.y + c.h) - Math.max(r.y, c.y);
      var g = {};
      if (ox > 0) { g.S = Math.abs(c.y - (r.y + r.h)); g.N = Math.abs(r.y - (c.y + c.h)); if (c.y < r.y + r.h / 2) delete g.S; else delete g.N; }
      if (oy > 0) { g.E = Math.abs(c.x - (r.x + r.w)); g.W = Math.abs(r.x - (c.x + c.w)); if (c.x < r.x + r.w / 2) delete g.E; else delete g.W; }
      return g;
    }
    floors.forEach(function (f) {
      var rs = floorMap[f.code].rooms, corrs = rs.filter(function (r) { return r.type === 'corr'; });
      var fc = [(f.bounds.x0 + f.bounds.x1) / 2, (f.bounds.y0 + f.bounds.y1) / 2];
      rs.forEach(function (r) {
        var best = null, bestG = Infinity;
        if (r.type !== 'corr') corrs.forEach(function (c) {
          var g = sideGap(r, c);
          Object.keys(g).forEach(function (s) { if (g[s] < bestG) { bestG = g[s]; best = s; } });
        });
        if (!best) { // 복도 없음 / 맞닿지 않음 → 층 중심 방향
          var rc = roomCenter(r), dx = fc[0] - rc[0], dy = fc[1] - rc[1];
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) best = 'S';
          else best = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
        }
        r.door = best;
      });
    });

    /* --- 설비 --- */
    var assets = [], assetById = {};
    A.forEach(function (a) {
      var room = roomById[str(a.소속실)];
      if (!room) { dropped.assets++; return; }
      var id = str(a.설비ID);
      if (assetById[id]) { dropped.assets++; return; }
      var x = numOrNull(a.X), y = numOrNull(a.Y);
      var asset = {
        id: id, room: room.id, floor: room.floor, name: str(a.설비명) || id, category: str(a.설비구분),
        kind: kindOf(a.설비명, a.설비구분), model: str(a.모델명), maker: str(a.제조사), spec: str(a.규격),
        x: x, y: y, status: str(a.상태), grade: 'NONE', measures: [], raw: copy(a)
      };
      assets.push(asset); assetById[id] = asset;
    });
    // 좌표 보정: 실 밖/없음 → (상대좌표면 환산) → 실 내부 격자
    var INSET = 500;
    function inside(r, x, y, m) { m = m || 0; return x != null && y != null && x >= r.x + m && x <= r.x + r.w - m && y >= r.y + m && y <= r.y + r.h - m; }
    rooms.forEach(function (r) {
      var list = assets.filter(function (a) { return a.room === r.id; });
      var fix = [];
      list.forEach(function (a) {
        if (inside(r, a.x, a.y)) return;
        if (a.x != null && a.y != null && inside(r, r.x + a.x, r.y + a.y)) { a.x = r.x + a.x; a.y = r.y + a.y; a.posAdjusted = 'relative'; return; }
        fix.push(a);
      });
      if (!fix.length) return;
      var placed = list.filter(function (a) { return fix.indexOf(a) < 0; });
      var iw = Math.max(r.w - INSET * 2, 1), ih = Math.max(r.h - INSET * 2, 1);
      var need = fix.length + placed.length;
      var cols = Math.max(1, Math.ceil(Math.sqrt(need * iw / ih))), rowsN = Math.max(1, Math.ceil(need / cols));
      while (cols * rowsN < need + placed.length) rowsN++;
      var cw = iw / cols, ch = ih / rowsN, minD = Math.min(cw, ch) * 0.6, cells = [];
      for (var j = 0; j < rowsN; j++) for (var i = 0; i < cols; i++) cells.push([r.x + INSET + cw * (i + 0.5), r.y + INSET + ch * (j + 0.5)]);
      cells = cells.filter(function (c) { return !placed.some(function (p) { return Math.hypot(p.x - c[0], p.y - c[1]) < minD; }); });
      fix.forEach(function (a, k) {
        var c = cells[k] || [r.x + r.w / 2 + ((k % 5) - 2) * 300, r.y + r.h / 2 + Math.floor(k / 5) * 300];
        a.x = Math.round(c[0]); a.y = Math.round(c[1]); a.posAdjusted = 'grid';
      });
    });
    // 랙/U (v14 시범값, 같은 ID+같은 실일 때만)
    assets.forEach(function (a) {
      var m = V14_META[a.id];
      if (m && m.room === a.room) {
        var ur = parseURange(m.u);
        a.rack = { name: m.rack, u: m.u, u0: ur ? ur.u0 : null, u1: ur ? ur.u1 : null, source: 'v14-ASSET_META' };
      }
    });
    // 사용자 랙·U 입력(60-workbench, localStorage) — v14 시범값보다 우선, 빈 이름은 '랙 정보 없음'
    var userRack = readRackStore();
    assets.forEach(function (a) {
      var r = userRack[a.id];
      if (!r) return;
      if (!r.name) { delete a.rack; return; }
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      a.rack = { name: r.name, u: (r.u0 != null && r.u1 != null) ? pad(r.u0) + 'U~' + pad(r.u1) + 'U' : '', u0: r.u0 != null ? r.u0 : null, u1: r.u1 != null ? r.u1 : null,
                 size: r.size || 42, face: r.face || '전면', source: 'user', at: r.at || null };
    });

    /* --- 측정 행 → Measure --- */
    function norm(s) { return str(s).replace(/\s+/g, '').replace(/(설비|시스템|기기|장치)/g, ''); }
    function catSimilar(a, b) {
      a = norm(a); b = norm(b);
      if (a.length < 2 || b.length < 2) return false;
      if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
      var n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++;
      return n >= 3;
    }
    function roomCore(nm) { return str(nm).replace(/\s*(실|룸|room)$/i, ''); }
    function applyRules(meas) {
      if (meas.value == null || typeof meas.value !== 'number') return;
      RULES.forEach(function (ru) {
        if (str(meas.item).indexOf(str(ru.측정항목)) < 0) return;
        var t = numOrNull(ru.임계값); if (t == null) return;
        var op = str(ru.연산자) || '>=', v = meas.value;
        var hit = op === '>=' ? v >= t : op === '>' ? v > t : op === '<=' ? v <= t : op === '<' ? v < t : op === '=' || op === '==' ? v === t : false;
        if (!hit) return;
        var g = statusGrade(ru.상태코드);
        if (g === 'RED') { if (meas.judge === 'none' || meas.judge === 'good') meas.judge = 'bad'; }
        else meas.warn = true;
        meas.rule = str(ru.규칙ID);
      });
    }
    function matchAssetByText(text) {
      for (var i = 0; i < assets.length; i++) {
        var a = assets[i], nm = a.name, id = a.id;
        if ((nm.length >= 3 && text.indexOf(nm) >= 0) || (id.length >= 3 && text.indexOf(id) >= 0)) return a;
      }
      return null;
    }
    function matchRoom(row) {
      var place = str(row['점검 위치']), loc = place + ' ' + str(row.설비);
      var fk = floorKey(row.층) || floorKey((place.match(/(지하\s*\d+|B\d+|\d+)\s*(층|F)/i) || [])[0]);
      var bd = str(row.건물), placeType = roomTypeOf(place.replace(str(row.건물), ''));
      var best = null, bestScore = 0, how = null;
      for (var i = 0; i < rooms.length; i++) {
        var r = rooms[i], nm = r.name, core = roomCore(nm), sc = 0, h = null;
        var floorHit = fk && (floorKey(r.raw.층코드) === fk || floorKey(r.raw.층명) === fk || floorKey(floorMap[r.floor].name) === fk);
        if (nm.length >= 2 && loc.indexOf(nm) >= 0) { sc = 3 + nm.length / 50; h = 'name'; }
        else if (core.length >= 2 && place.indexOf(core) >= 0 && (floorHit || !fk)) { sc = 2 + core.length / 50; h = 'name-core'; }
        else if (placeType !== 'office' && placeType === r.type && floorHit) { sc = 1; h = 'type'; }
        if (!sc) continue;
        if (floorHit) sc += 2;
        if (bd && r.building && (r.building.indexOf(bd) >= 0 || bd.indexOf(r.building) >= 0)) sc += 1.5;
        if (sc > bestScore) { bestScore = sc; best = r; how = h; }
      }
      return best ? { room: best, how: how } : null;
    }

    var measurements = [], matched = { asset: 0, room: 0, none: 0, manual: 0, ignored: 0 };
    var matchOv = readMatchStore(); // 측정 매칭 수동 지정(60-workbench): {그룹키:{assetId|roomId|ignore}}
    rowsIn.forEach(function (row, idx) {
      if (!row || typeof row !== 'object') return;
      var item = str(row['측정 항목'] || row.측정항목 || row['점검 항목'] || row.항목);
      var jv = judgeOf(row.판정);
      var value = numOrNull(row.측정값);
      var m = {
        std: stdOf(item, row.기준), item: item, value: value != null ? value : (str(row.측정값) || null), unit: str(row.단위) || null,
        judge: jv.judge, date: str(row.점검일 || row.측정일 || row.일자 || row.date) || null,
        assetId: null, roomId: null, raw: copy(row),
        id: str(row.id) || ('M' + (idx + 1)), location: str(row['점검 위치']), equip: str(row.설비), criterion: str(row.기준),
        building: str(row.건물), floorText: str(row.층), source: 'inspection', match: null
      };
      if (jv.warn) m.warn = true;
      applyRules(m);
      m.groupKey = [m.building, m.floorText, m.location, m.equip].join('|');
      var a = null, r = null, ov = matchOv[m.groupKey];
      if (ov && ov.ignore) { m.match = 'ignored'; matched.ignored++; measurements.push(m); return; }
      if (ov && ov.assetId && assetById[ov.assetId]) { a = assetById[ov.assetId]; m.match = 'manual'; }
      else if (ov && ov.roomId && roomById[ov.roomId]) { r = roomById[ov.roomId]; m.match = 'manual'; }
      if (m.match === 'manual') matched.manual++;
      if (!a && !r && str(row.assetId) && assetById[str(row.assetId)]) { a = assetById[str(row.assetId)]; m.match = 'explicit'; }
      if (!a && !r) { a = matchAssetByText(str(row['점검 위치']) + ' ' + str(row.설비) + ' ' + item); if (a) m.match = 'asset-name'; }
      if (a) r = roomById[a.room];
      if (!r && str(row.roomId) && roomById[str(row.roomId)]) { r = roomById[str(row.roomId)]; m.match = 'explicit'; }
      if (!r) { var mr = matchRoom(row); if (mr) { r = mr.room; m.match = 'room-' + mr.how; } }
      if (r && !a && m.match !== 'manual') { // 같은 실의 설비구분 유사 설비
        var cand = assets.filter(function (x) { return x.room === r.id && (catSimilar(x.category, row.설비) || catSimilar(x.name, row.설비)); });
        if (cand.length) { a = cand[0]; m.match += '+category'; }
      }
      if (a) { m.assetId = a.id; a.measures.push(m); matched.asset++; }
      if (r) { m.roomId = r.id; r.measures.push(m); if (!a) matched.room++; }
      if (!a && !r) matched.none++;
      measurements.push(m);
    });
    // 점검이력(history) 중 측정값이 있는 행 → Measure(source:'history')
    H.forEach(function (h) {
      var a = assetById[str(h.설비ID)];
      if (!a || !str(h.측정항목)) return;
      var v = numOrNull(h.측정값), jv = judgeOf(h.상태);
      var m = { std: stdOf(h.측정항목), item: str(h.측정항목), value: v != null ? v : (str(h.측정값) || null), unit: str(h.단위) || null,
        judge: jv.judge, date: str(h.점검일) || null, assetId: a.id, roomId: a.room, raw: copy(h), id: str(h.점검ID), source: 'history', match: 'explicit' };
      if (jv.warn) m.warn = true;
      applyRules(m);
      a.measures.push(m); roomById[a.room].measures.push(m); measurements.push(m);
    });
    // 최근 점검일 · 이력 상태
    var lastHist = {};
    H.forEach(function (h) { var id = str(h.설비ID), dt = str(h.점검일); if (!lastHist[id] || dt > lastHist[id].date) lastHist[id] = { date: dt, status: str(h.상태) }; });
    // 실측 행이 없는 설비만 v14 시범 요약값으로 보조
    assets.forEach(function (a) {
      if (lastHist[a.id]) a.lastInspection = lastHist[a.id].date;
      var meta = V14_META[a.id];
      if (a.measures.length || !meta || meta.room !== a.room) return;
      Object.keys(V14_ITEMS).forEach(function (k) {
        if (!meta[k]) return;
        var txt = meta[k], v = numOrNull(txt); if (v == null) return;
        var jt = (txt.match(/\(([^)]+)\)/) || [])[1] || '', jv = judgeOf(jt);
        var unit = (txt.replace(/\([^)]*\)/, '').match(/(Ω|℃|dB|lx|V)/) || [])[1] || null;
        var m = { std: V14_ITEMS[k][0], item: V14_ITEMS[k][1], value: v, unit: unit, judge: jv.judge, date: '2026-08-10',
          assetId: a.id, roomId: a.room, raw: { source: 'v14-ASSET_META', text: txt }, id: 'V14-' + a.id + '-' + k, source: 'v14-snapshot', match: 'v14' };
        if (jv.warn) m.warn = true;
        a.measures.push(m); roomById[a.room].measures.push(m); measurements.push(m);
      });
    });

    /* --- 등급 --- */
    assets.forEach(function (a) {
      var sg = statusGrade(a.status), ms = a.measures;
      var bad = ms.some(function (m) { return m.judge === 'bad'; });
      var warn = ms.some(function (m) { return m.warn; });
      var good = ms.some(function (m) { return m.judge === 'good'; });
      var roomBad = roomById[a.room].measures.some(function (m) { return !m.assetId && (m.judge === 'bad' || m.warn); });
      var g, why;
      if (sg === 'RED' || bad) { g = 'RED'; why = sg === 'RED' ? '상태 ' + a.status : '실측 불량'; }
      else if (sg === 'ORANGE') { g = 'ORANGE'; why = '상태 ' + a.status; }
      else if (sg === 'YELLOW' || warn || roomBad) { g = 'YELLOW'; why = warn ? '실측 주의' : roomBad ? '설치 공간 실측 불량' : '상태 ' + a.status; }
      else if (sg === 'GREEN' || good) { g = 'GREEN'; why = sg ? '상태 ' + a.status : '실측 양호'; }
      else { g = 'NONE'; why = '자료 없음'; }
      a.grade = g; a.gradeReason = why;
    });

    /* --- 링크 --- */
    var links = [];
    L.forEach(function (l, i) {
      var f = str(l.출발설비ID), t = str(l.도착설비ID);
      if (!assetById[f] || !assetById[t] || f === t) { dropped.links++; return; }
      var type = linkTypeOf(l.연결유형);
      links.push({
        id: str(l.연결ID) || ('L' + (i + 1)), from: f, to: t, type: type,
        label: str(l.연결유형) + (str(l.출발단자) || str(l.도착단자) ? ' ' + (str(l.출발단자) || '?') + '→' + (str(l.도착단자) || '?') : ''),
        cable: str(l.케이블번호), status: str(l.연결상태), raw: copy(l)
      });
    });

    /* --- 라이저 (telecom 실 층간 묶음) --- */
    function doorPoint(r, inset) {
      inset = Math.min(inset, r.w / 3, r.h / 3);
      switch (r.door) {
        case 'N': return [r.x + r.w / 2, r.y + inset];
        case 'S': return [r.x + r.w / 2, r.y + r.h - inset];
        case 'E': return [r.x + r.w - inset, r.y + r.h / 2];
        default: return [r.x + inset, r.y + r.h / 2];
      }
    }
    var tele = rooms.filter(function (r) { return r.type === 'telecom'; });
    var clusters = [];
    tele.forEach(function (r) {
      var p = doorPoint(r, 700), c = null;
      for (var i = 0; i < clusters.length; i++) {
        var k = clusters[i];
        if (k.building === r.building && Math.abs(k.x - p[0]) <= RISER_TOL && Math.abs(k.y - p[1]) <= RISER_TOL && !k.floorSet[r.floor]) { c = k; break; }
      }
      if (!c) { c = { building: r.building, x: p[0], y: p[1], pts: [], rooms: [], floorSet: {} }; clusters.push(c); }
      c.pts.push(p); c.rooms.push(r); c.floorSet[r.floor] = true;
      c.x = c.pts.reduce(function (s, q) { return s + q[0]; }, 0) / c.pts.length;
      c.y = c.pts.reduce(function (s, q) { return s + q[1]; }, 0) / c.pts.length;
    });
    var good = clusters.filter(function (c) { return c.rooms.length >= 2; });
    if (!good.length && clusters.length) { // 공통 층 최다 telecom 실 1개
      clusters.sort(function (a, b) { return b.rooms.length - a.rooms.length; });
      good = [clusters[0]];
    }
    var lvOf = function (code) { return floorByCode[code] ? floorByCode[code].level : 0; };
    var risers = good.map(function (c, i) {
      var fl = Object.keys(c.floorSet).sort(function (a, b) { return lvOf(b) - lvOf(a); });
      var names = {}; c.rooms.forEach(function (r) { names[roomCore(r.name)] = 1; });
      return { id: 'RS-' + (i + 1), name: Object.keys(names).slice(0, 2).join('·') + ' 수직 간선(추정)', x: Math.round(c.x), y: Math.round(c.y),
        floors: fl, rooms: c.rooms.map(function (r) { return r.id; }), building: c.building, estimated: true };
    });
    // 사용자 등록 구조(60-workbench, localStorage 'twinx_geom_v1') — 추정값보다 우선
    var geom = readGeomStore();
    var floorCodes = floors.map(function (f) { return f.code; });
    if (geom.risers && geom.risers.length) {
      risers = geom.risers.map(function (r, i) {
        return { id: r.id || ('RU-' + (i + 1)), name: r.name || ('EPS 라이저 ' + (i + 1)), x: Math.round(+r.x), y: Math.round(+r.y),
          floors: (r.floors && r.floors.length ? r.floors : floorCodes).filter(function (c) { return floorCodes.indexOf(c) >= 0; })
            .sort(function (a, b) { return lvOf(b) - lvOf(a); }), rooms: [], building: r.building || null, estimated: false, source: 'user' };
      }).filter(function (r) { return isFinite(r.x) && isFinite(r.y) && r.floors.length; });
    }
    Object.keys(geom.doors || {}).forEach(function (rid) {
      var r = rooms.find(function (q) { return q.id === rid; }), d = geom.doors[rid];
      if (!r || !d) return;
      r.door = d.side; r.doorAt = d.side === 'none' ? null : (d.at != null ? +d.at : null); r.doorW = d.w ? +d.w : null; r.doorSrc = 'user';
    });

    /* --- 트레이 (층별 추정 경로) --- */
    floors.forEach(function (f) {
      var rs = floorMap[f.code].rooms, corrs = rs.filter(function (r) { return r.type === 'corr'; });
      var trays = [], key = {};
      function add(a, b, main, kind) {
        a = [Math.round(a[0]), Math.round(a[1])]; b = [Math.round(b[0]), Math.round(b[1])];
        if (Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1) return;
        var k = a.concat(b).join(','), k2 = b.concat(a).join(',');
        if (key[k] || key[k2]) return;
        key[k] = 1; trays.push({ a: a, b: b, main: !!main, kind: kind });
      }
      function ortho(p, q, main, kind) { // L자 직교 경로
        if (Math.abs(p[0] - q[0]) < 1 || Math.abs(p[1] - q[1]) < 1) { add(p, q, main, kind); return; }
        var mid = [q[0], p[1]]; add(p, mid, main, kind); add(mid, q, main, kind);
      }
      if (corrs.length) {
        var spines = corrs.map(function (c) {
          var horiz = c.w >= c.h, m = Math.min(300, (horiz ? c.w : c.h) / 10);
          var a = horiz ? [c.x + m, c.y + c.h / 2] : [c.x + c.w / 2, c.y + m];
          var b = horiz ? [c.x + c.w - m, c.y + c.h / 2] : [c.x + c.w / 2, c.y + c.h - m];
          add(a, b, true, 'corridor');
          return { c: c, horiz: horiz, a: a, b: b };
        });
        rs.forEach(function (r) {
          if (['telecom', 'server', 'power'].indexOf(r.type) < 0) return;
          var cen = [r.x + r.w / 2, r.y + r.h / 2], best = null, bd = Infinity;
          spines.forEach(function (s) { // 문 변 중점 → 복도 중심선 투영점
            var dp = doorPoint(r, 0), proj;
            if (s.horiz) proj = [Math.max(s.a[0], Math.min(s.b[0], dp[0])), s.a[1]];
            else proj = [s.a[0], Math.max(s.a[1], Math.min(s.b[1], dp[1]))];
            var dd = Math.hypot(proj[0] - dp[0], proj[1] - dp[1]);
            if (dd < bd) { bd = dd; best = { proj: proj, dp: dp, s: s }; }
          });
          if (!best) return;
          var end = [cen[0] + (best.dp[0] - cen[0]) * 0.25, cen[1] + (best.dp[1] - cen[1]) * 0.25];
          if (best.s.horiz) { ortho(best.proj, [best.proj[0], end[1]], false, 'branch'); if (Math.abs(best.proj[0] - end[0]) > 1) add([best.proj[0], end[1]], end, false, 'branch'); }
          else { ortho(best.proj, [end[0], best.proj[1]], false, 'branch'); if (Math.abs(best.proj[1] - end[1]) > 1) add([end[0], best.proj[1]], end, false, 'branch'); }
        });
      } else {
        // 복도 없음: 같은 층 링크 설비를 직교 경로로, 층간 링크 설비는 그 층 라이저로
        var fa = {}; assets.forEach(function (a) { if (a.floor === f.code) fa[a.id] = a; });
        var fr = risers.filter(function (r) { return r.floors.indexOf(f.code) >= 0; });
        // 이 층에 라이저가 없으면 같은 건물 라이저의 평면 위치(샤프트 연장 가정)로 연결
        if (!fr.length) fr = risers.filter(function (r) { return r.building === f.building; });
        links.forEach(function (l) {
          var a = assetById[l.from], b = assetById[l.to];
          if (fa[a.id] && fa[b.id]) { ortho([a.x, a.y], [b.x, b.y], a.room !== b.room, 'link'); return; }
          var here = fa[a.id] || fa[b.id];
          if (!here || !fr.length) return;
          var near = fr.slice().sort(function (p, q) { return Math.hypot(p.x - here.x, p.y - here.y) - Math.hypot(q.x - here.x, q.y - here.y); })[0];
          ortho([here.x, here.y], [near.x, near.y], true, 'riser');
        });
      }
      f.trays = trays;
      var ut = geom.trays && geom.trays[f.code];
      if (ut && ut.length) f.trays = ut.map(function (t) { return { a: [+t.a[0], +t.a[1]], b: [+t.b[0], +t.b[1]], main: !!t.main, kind: 'user', path: t.path || null, source: 'user' }; });
    });

    /* --- 사이트 --- */
    var bnames = []; rooms.forEach(function (r) { if (r.building && bnames.indexOf(r.building) < 0) bnames.push(r.building); });
    var site = { name: bnames.length > 1 ? bnames[0] + ' 외 ' + (bnames.length - 1) + '개 동' : (bnames[0] || 'ADMIN 트윈'), building: bnames[0] || '', buildings: bnames };

    return {
      source: 'admin', site: site, floors: floors, rooms: rooms, assets: assets, links: links, risers: risers,
      measurements: measurements, updatedAt: new Date().toISOString(),
      meta: { matched: matched, dropped: dropped, rows: rowsIn.length }
    };
  }

  /* ---------------- 4. 캐시 · 서명 ---------------- */
  var walkCache = { t: 0, v: null };
  var conv = { twin: null, rows: null, sig: null, model: null };
  function extraSig() { return ['twinx_rack_v1', 'twinx_geom_v1', 'twinx_match_v1'].map(function (k) { return localStorage.getItem(k) || ''; }).join('|'); }
  function readMatchStore() { try { return JSON.parse(localStorage.getItem('twinx_match_v1') || '{}') || {}; } catch (e) { return {}; } }
  function readGeomStore() { try { return JSON.parse(localStorage.getItem('twinx_geom_v1') || '{}') || {}; } catch (e) { return {}; } }
  function readRackStore() { try { return JSON.parse(localStorage.getItem('twinx_rack_v1') || '{}') || {}; } catch (e) { return {}; } }
  function signatureOf(d) {
    var t = d.twin || {};
    try {
      return hashStr(JSON.stringify([t.rooms, t.assets, t.links, t.history, t.rules, d.rows, localStorage.getItem('twinx_rack_v1') || '', localStorage.getItem('twinx_geom_v1') || '', localStorage.getItem('twinx_match_v1') || '']));
    } catch (e) { return String(Date.now()); }
  }
  function read(force) {
    var now = Date.now();
    if (!force && walkCache.v !== null && now - walkCache.t < CACHE_MS) return walkCache.v.model;
    var d = null;
    try { d = walk(); } catch (e) { console.warn('[TwinX.data] walk 실패', e); }
    var model = null, sig = null;
    if (d && d.twin) {
      // 같은 참조면 서명 재계산 생략 (React 불변 갱신)
      if (conv.model && conv.twin === d.twin && conv.rows === d.rows && conv.twinSnap === snap(d.twin) && conv.rackSig === extraSig()) { model = conv.model; sig = conv.sig; }
      else {
        sig = signatureOf(d);
        if (conv.model && sig === conv.sig) model = conv.model;
        else {
          try { model = convert(d); } catch (e) { console.error('[TwinX.data] 변환 실패', e); model = null; }
        }
        conv = { twin: d.twin, rows: d.rows, twinSnap: snap(d.twin), rackSig: extraSig(), sig: sig, model: model };
      }
    }
    walkCache = { t: now, v: { model: model, sig: sig } };
    return model;
  }
  function snap(t) { // 제자리 변경 감지용 경량 지문(배열 길이)
    return ['rooms', 'assets', 'links', 'history'].map(function (k) { return Array.isArray(t[k]) ? t[k].length : -1; }).join('|');
  }

  /* ---------------- 5. refresh · 폴링 ---------------- */
  var lastSig = null, demoShown = false, pendingToast = false, startedAt = Date.now();
  function toastDemo() {
    if (demoShown) return;
    if (TwinX.state.open || TwinX.ui) { demoShown = true; pendingToast = false; TwinX.emit('toast', { msg: 'ADMIN 트윈 데이터를 찾지 못해 시범 데이터로 표시합니다.', kind: 'warn' }); }
    else pendingToast = true;
  }
  function refresh(force) {
    var m = read(force);
    if (m) {
      var sig = walkCache.v && walkCache.v.sig;
      if (sig !== lastSig || !TwinX.model || TwinX.model.source !== 'admin') {
        lastSig = sig;
        TwinX.setModel(m);
        return { changed: true, source: 'admin' };
      }
      return { changed: false, source: 'admin' };
    }
    // 읽기 실패: 기존 admin 모델은 유지, 없으면(유예 후 또는 강제) 데모 대체
    if (TwinX.model && TwinX.model.source === 'admin') return { changed: false, source: 'admin' };
    if (!TwinX.model && (force || Date.now() - startedAt > GRACE_MS)) {
      lastSig = 'demo';
      TwinX.setModel(TwinX.demoModel());
      toastDemo();
      return { changed: true, source: 'demo' };
    }
    if (TwinX.model && TwinX.model.source === 'demo' && force) toastDemo();
    return { changed: false, source: TwinX.model ? TwinX.model.source : null };
  }

  function stats() {
    var m = TwinX.model;
    if (!m) return { floors: 0, rooms: 0, assets: 0, links: 0, measures: 0, badAssets: 0, source: null };
    return {
      floors: m.floors.length, rooms: m.rooms.length, assets: m.assets.length, links: m.links.length,
      measures: (m.measurements || []).length,
      badAssets: m.assets.filter(function (a) { return a.grade === 'RED'; }).length,
      source: m.source,
      matched: m.meta ? m.meta.matched : null
    };
  }

  var timer = null;
  function loop() {
    clearTimeout(timer);
    try { if (!document.hidden || !TwinX.model) refresh(false); } catch (e) { console.error('[TwinX.data] refresh 오류', e); }
    timer = setTimeout(loop, TwinX.state.open ? POLL_OPEN : POLL_CLOSED);
  }
  function start() {
    startedAt = Date.now();
    // React(모듈 스크립트)가 이 레이어보다 늦게 마운트되므로 짧게 재시도
    var tries = 0;
    (function early() {
      var r = refresh(false);
      if (r.source === 'admin' || ++tries > 12) { loop(); return; }
      timer = setTimeout(early, 500);
    })();
  }

  TwinX.on('open', function () { refresh(true); clearTimeout(timer); timer = setTimeout(loop, POLL_OPEN); });
  TwinX.on('ui-ready', function () { if (pendingToast) toastDemo(); });

  TwinX.data = {
    read: function () { return read(false); },
    refresh: refresh,
    stats: stats,
    signature: function () { return lastSig; },
    // 시험·타 팀 재사용용 순수 함수
    _util: { levelOf: levelOf, floorKey: floorKey, roomTypeOf: roomTypeOf, kindOf: kindOf, linkTypeOf: linkTypeOf, statusGrade: statusGrade, judgeOf: judgeOf, stdOf: stdOf, convert: convert }
  };

  if (document.readyState === 'complete') setTimeout(start, 0);
  else window.addEventListener('load', function () { setTimeout(start, 0); });
})();
