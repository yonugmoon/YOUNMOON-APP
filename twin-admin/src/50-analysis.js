/* ============================================================
   TwinX.analysis (T5 분석·QA팀) — 장애 파급 · 위험도 · 기술기준 요약 · 정적 경보
   - 링크 방향 from → to = 상위(공급) → 하위(의존)
   - data / optical / power  : 서비스 중단(outage) 전파
   - ground / path           : 잠재위험(degraded) 전파
   - 측정값은 ADMIN 정기점검 실측 자료만 사용 (센서 아님). 근거가 없으면 0점 + "자료 없음".
   포팅 원본: ICT_Twin.html computeImpact / relationDepth / computeRisk / triageFor / ALARM_RULES
   ============================================================ */
(function () {
  'use strict';
  var TwinX = window.TwinX;
  if (!TwinX || TwinX.analysis) return;

  var OUTAGE_TYPES = { data: 1, optical: 1, power: 1 };
  var RANK = { degraded: 1, outage: 2 };
  var EMPTY_MAP = function () { return new Map(); };

  /* ---------- 기술기준 (ADMIN STD 5종) ---------- */
  // 판정(judge)은 ADMIN 원본 행의 '판정' 해석값을 그대로 존중하고, 아래 기준은
  // 불량 '심각도'(기준 초과 정도)와 경계값 근접(관찰) 산정에만 사용합니다.
  var STD = {
    gnd:  { name: '접지', desc: '접지저항 10Ω 이하' },
    heat: { name: '발열', desc: '열화상 ΔT 20℃ 이내' },
    pwr:  { name: '전원', desc: 'AC 220V ±10%' },
    sig:  { name: '신호', desc: '이상 소음 65dB(A) 이하 · 신호 품질' },
    env:  { name: '환경', desc: '온도 18~27℃ · 습도 40~60%RH · 조도 300lx' }
  };
  var STD_KEYS = ['gnd', 'heat', 'pwr', 'sig', 'env'];

  function num(v) { return TwinX.util && TwinX.util.num ? TwinX.util.num(v) : (v == null ? null : (String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/) || [null])[0] * 1); }

  /* 측정 1건의 허용 범위 [lo, hi] 와 설명. 모르면 null */
  function limitOf(m) {
    var item = String(m.item || ''), unit = String(m.unit || '');
    var raw = m.raw || {};
    // '설치 환경 확인(습도, 온도) — 습도' 처럼 대시 뒤가 실제 측정 대상
    var tail = item.split(/\s[—–-]\s/).pop();
    if (tail) item = tail;
    switch (m.std) {
      case 'gnd': return { lo: null, hi: 10, text: '10Ω 이하' };
      case 'heat':
        if (/주위/.test(item)) return null;             // 주위온도는 기준값 아님 (ΔT 산정용)
        if (/ΔT|델타|온도차/i.test(item)) return { lo: null, hi: 20, text: 'ΔT 20℃ 이내' };
        return null;                                     // 최고온도 단독은 ΔT 쌍으로 평가
      case 'pwr': {
        var v = num(m.value);
        if (/DC/i.test(item + unit) && !/AC/i.test(item + unit)) return null;
        if (v != null && v > 150 && v < 300) return { lo: 198, hi: 242, text: 'AC 220V ±10%' };
        return null;
      }
      case 'sig':
        if (/소음/.test(item) || /dB\(?A/i.test(unit)) return { lo: null, hi: 65, text: '65dB(A) 이하' };
        return parseCriterion(raw['기준'] || raw.기준);
      case 'env':
        if (/습도/.test(item) || /%/.test(unit)) return { lo: 40, hi: 60, text: '습도 40~60%RH' };
        if (/조도|조명|lx|룩스/i.test(item + unit)) return num(m.value) != null ? { lo: 300, hi: null, text: '조도 300lx 이상' } : null;
        if (/온도/.test(item) || /℃|°C/.test(unit)) return { lo: 18, hi: 27, text: '온도 18~27℃' };
        return null;
    }
    return parseCriterion(raw['기준'] || raw.기준);
  }
  /* ADMIN 행의 '기준' 문자열 해석: '57~80dBμV', '10Ω 이하', '300lx 이상' */
  function parseCriterion(s) {
    if (!s) return null;
    s = String(s);
    var r = s.match(/(-?\d+(?:\.\d+)?)\s*[~∼\-–]\s*(-?\d+(?:\.\d+)?)/);
    if (r) return { lo: +r[1], hi: +r[2], text: s };
    var n = num(s);
    if (n == null) return null;
    if (/이하|미만|≤|<|이내/.test(s)) return { lo: null, hi: n, text: s };
    if (/이상|초과|≥|>/.test(s)) return { lo: n, hi: null, text: s };
    return null;
  }

  /* 기준 대비 초과율 (0 = 경계, >0 초과, <0 여유). 값/기준 없으면 null */
  function excessOf(value, lim) {
    if (value == null || !lim) return null;
    var e = -Infinity;
    if (lim.hi != null) e = Math.max(e, (value - lim.hi) / Math.max(Math.abs(lim.hi), 1));
    if (lim.lo != null) e = Math.max(e, (lim.lo - value) / Math.max(Math.abs(lim.lo), 1));
    return e === -Infinity ? null : e;
  }

  /* 측정 목록 평가 → [{m, std, judge, value, limit, excess, near, sev}] (열화상은 최고/주위 쌍으로 ΔT 산정) */
  function evaluate(measures) {
    var out = [];
    var heatPairs = {};
    (measures || []).forEach(function (m) {
      if (!m) return;
      if (m.std === 'heat') {
        var key = (m.date || '') + '|' + (m.assetId || m.roomId || '');
        var hp = heatPairs[key] || (heatPairs[key] = {});
        if (/주위/.test(m.item || '')) hp.amb = m; else if (/최고|표면|ΔT|온도차/i.test(m.item || '')) hp.max = m; else hp.other = m;
        if (/ΔT|온도차/i.test(m.item || '')) hp.dt = m;
      }
    });
    (measures || []).forEach(function (m) {
      if (!m) return;
      var value = num(m.value), lim = limitOf(m), shown = value, item = m.item;
      if (m.std === 'heat') {
        var hp = heatPairs[(m.date || '') + '|' + (m.assetId || m.roomId || '')];
        if (/주위/.test(m.item || '') && hp && hp.max) return;          // 쌍의 최고온도 쪽에서 평가
        if (hp && hp.max === m && hp.amb && !hp.dt) {
          var a = num(hp.amb.value);
          if (value != null && a != null) { shown = Math.round((value - a) * 10) / 10; lim = { lo: null, hi: 20, text: 'ΔT 20℃ 이내' }; item = '열화상 ΔT(최고−주위)'; }
        }
      }
      var ex = excessOf(shown, lim);
      var j = m.judge || 'none';
      var near = j !== 'bad' && ex != null && ex > -0.1 && ex <= 0;   // 기준 10% 이내 근접 = 관찰
      var sev = 0;
      if (j === 'bad') sev = ex == null ? 0.5 : Math.min(1, 0.3 + Math.max(0, ex));   // 0.3~1.0
      out.push({ m: m, std: m.std || null, item: item, judge: j, value: shown, unit: m.std === 'heat' && item !== m.item ? '℃' : (m.unit || ''),
                 limit: lim, excess: ex, near: near, sev: sev, date: m.date || null, live: m.src === 'live' });
    });
    return out;
  }

  /* ---------- 그래프 캐시 (인접 리스트) ---------- */
  var G = null;           // { model, nLinks, down: Map(id→[link]), up: Map(id→[link]) }
  var impactCache = new Map();
  var riskCache = new Map();

  function graph() {
    var m = TwinX.model;
    var links = (m && m.links) || [];
    if (G && G.model === m && G.nLinks === links.length && G.links === links) return G;
    var down = new Map(), up = new Map();
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (!l || l.from == null || l.to == null || l.from === l.to) continue;
      var d = down.get(l.from); if (!d) down.set(l.from, d = []); d.push(l);
      var u = up.get(l.to); if (!u) up.set(l.to, u = []); u.push(l);
    }
    G = { model: m, links: links, nLinks: links.length, down: down, up: up };
    impactCache.clear(); riskCache.clear();
    return G;
  }
  function invalidate() { G = null; impactCache.clear(); riskCache.clear(); }

  function upstream(id) { return (graph().up.get(id) || []).slice(); }
  function downstream(id) { return (graph().down.get(id) || []).slice(); }

  /* 장애 파급 BFS → Map(id → {sev, depth, via}). 발생원 자신은 제외, 순환 안전(노드당 최대 2회 갱신) */
  function impact(sourceId) {
    var g = graph();
    if (sourceId == null) return new Map();
    var hit = impactCache.get(sourceId);
    if (hit) return new Map(hit);
    var out = new Map();
    var q = [{ id: sourceId, sev: 'outage', depth: 0 }], qi = 0;
    while (qi < q.length) {
      var cur = q[qi++];
      var ls = g.down.get(cur.id);
      if (!ls) continue;
      for (var i = 0; i < ls.length; i++) {
        var rel = ls[i];
        if (rel.to === sourceId) continue;
        var sev = (cur.sev === 'outage' && OUTAGE_TYPES[rel.type]) ? 'outage' : 'degraded';
        var prev = out.get(rel.to);
        if (!prev || RANK[sev] > RANK[prev.sev]) {
          var rec = { sev: sev, depth: cur.depth + 1, via: rel };
          out.set(rel.to, rec);
          q.push({ id: rel.to, sev: sev, depth: rec.depth });
        }
      }
    }
    impactCache.set(sourceId, out);
    return new Map(out);
  }

  /* 상위 공급 계층 깊이 (data/optical/power 만) */
  function relationDepth(id) {
    var g = graph(), memo = new Map();
    function d(x, stack) {
      if (memo.has(x)) return memo.get(x);
      if (stack.has(x)) return 0;
      stack.add(x);
      var best = 0, ups = g.up.get(x) || [];
      for (var i = 0; i < ups.length; i++) if (OUTAGE_TYPES[ups[i].type]) best = Math.max(best, 1 + d(ups[i].from, stack));
      stack.delete(x); memo.set(x, best);
      return best;
    }
    return d(id, new Set());
  }

  /* ---------- 위험도 (100점) ---------- */
  // ① 상태 25 ② 실측 불량·심각도 30 ③ 중요도(하위 의존) 20 ④ 점검 경과 10 ⑤ 단일 장애점 15
  var W = { status: 25, measure: 30, crit: 20, age: 10, spof: 15 };
  var BAD_STATUS = /이상|불량|고장|장애/;
  var WARN_STATUS = /주의|경고|관찰/;

  function parseDate(s) {
    if (!s) return null;
    var m = String(s).match(/(\d{4})[-./년\s]*(\d{1,2})(?:[-./월\s]*(\d{1,2}))?/);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
    return isNaN(d.getTime()) ? null : d;
  }
  function measuresOfAsset(a) { return (a && a.measures) || []; }

  function gradeOf(total) { return total >= 60 ? 'RED' : total >= 40 ? 'ORANGE' : total >= 20 ? 'YELLOW' : 'GREEN'; }
  function triage(grade) {
    return grade === 'RED' ? 'A등급 (즉시 조치)'
      : grade === 'ORANGE' ? 'B등급 (단기 개선 권장)'
      : grade === 'YELLOW' ? 'C등급 (관찰·중장기 계획)'
      : grade === 'NONE' ? '미점검 (자료 확보 필요)'
      : '정상 (정기 모니터링)';
  }

  function risk(asset, opts) {
    if (typeof asset === 'string') asset = TwinX.asset(asset);
    if (!asset) return { total: 0, grade: 'NONE', triage: triage('NONE'), parts: [] };
    graph();
    var now = (opts && opts.now) ? new Date(opts.now) : new Date();
    var cacheKey = asset.id + '|' + now.toISOString().slice(0, 10);
    var c = riskCache.get(cacheKey);
    if (c && c.asset === asset && c.nMeas === measuresOfAsset(asset).length && c.status === asset.status) return c.result;

    var parts = [];
    // ① 상태
    var st = String(asset.status || '').trim();
    var p1 = BAD_STATUS.test(st) ? W.status : WARN_STATUS.test(st) ? Math.round(W.status * 0.5) : 0;
    parts.push({ k: '① 상태', v: p1, max: W.status, note: st ? ('ADMIN 등록 상태 「' + st + '」') : '자료 없음' });

    // ② 실측 불량 건수·심각도
    var ev = evaluate(measuresOfAsset(asset));
    var bads = ev.filter(function (e) { return e.judge === 'bad'; });
    var nears = ev.filter(function (e) { return e.near; });
    var p2 = 0, note2;
    if (!ev.length) note2 = '자료 없음 (연결된 정기점검 실측 없음)';
    else {
      var s = 0;
      bads.forEach(function (e) { s += 6 + 9 * e.sev; });   // 1건 = 8.7~15점
      s += nears.length * 2;
      p2 = Math.min(W.measure, Math.round(s));
      var byStd = {};
      bads.forEach(function (e) { var k = STD[e.std] ? STD[e.std].name : '기타'; byStd[k] = (byStd[k] || 0) + 1; });
      note2 = '실측 ' + ev.length + '건 중 불량 ' + bads.length + '건' +
        (bads.length ? ' (' + Object.keys(byStd).map(function (k) { return k + ' ' + byStd[k]; }).join('·') + ')' : '') +
        (nears.length ? ', 기준 근접 ' + nears.length + '건' : '');
      var worst = bads.filter(function (e) { return e.excess != null; }).sort(function (a, b) { return b.excess - a.excess; })[0];
      if (worst) note2 += ' · 최대 초과 ' + worst.item + ' ' + worst.value + (worst.unit || '') + ' (기준 ' + worst.limit.text + ')';
    }
    parts.push({ k: '② 실측 불량', v: p2, max: W.measure, note: note2 });

    // ③ 중요도 (하위 의존 설비 수)
    var imp = impact(asset.id), out = 0, deg = 0;
    imp.forEach(function (v) { if (v.sev === 'outage') out++; else deg++; });
    var p3 = Math.min(W.crit, out * 3 + deg);
    parts.push({ k: '③ 중요도', v: p3, max: W.crit, note: (out || deg) ? ('하위 중단 ' + out + '대 · 잠재위험 ' + deg + '대') : '하위 의존 설비 없음' });

    // ④ 점검 이력 경과
    var last = null;
    measuresOfAsset(asset).forEach(function (m) { var d = parseDate(m.date); if (d && (!last || d > last)) last = d; });
    var raw = asset.raw || {};
    [raw['최근점검일'], raw['점검일'], raw.lastInspection, asset.lastInspection].forEach(function (x) { var d = parseDate(x); if (d && (!last || d > last)) last = d; });
    var p4 = 0, note4 = '자료 없음';
    if (last) {
      var months = Math.max(0, (now - last) / (30.44 * 864e5));
      p4 = months <= 6 ? 0 : months <= 12 ? 3 : months <= 18 ? 6 : months <= 24 ? 8 : 10;
      var p = function (x) { return (x < 10 ? '0' : '') + x; };
      note4 = '최근 점검 ' + last.getFullYear() + '-' + p(last.getMonth() + 1) + '-' + p(last.getDate()) + ' (' + months.toFixed(1) + '개월 경과)';
    }
    parts.push({ k: '④ 점검 경과', v: p4, max: W.age, note: note4 });

    // ⑤ 단일 장애점 (하위가 있는데 상위 공급 경로가 1개)
    var ups = upstream(asset.id).filter(function (l) { return OUTAGE_TYPES[l.type]; });
    var upFrom = {}; ups.forEach(function (l) { upFrom[l.from] = 1; });
    var nUp = Object.keys(upFrom).length;
    var p5 = 0, note5;
    if (!out) note5 = '하위 중단 의존 설비 없음';
    else if (nUp === 1) { p5 = out >= 3 ? W.spof : Math.round(W.spof * 0.67); note5 = '상위 공급 경로 1개 (' + ups[0].from + ') · 하위 ' + out + '대 단일 의존'; }
    else if (nUp === 0) note5 = '자료 없음 (상위 공급 경로 미등록)';
    else note5 = '상위 공급 경로 ' + nUp + '개 (이중화)';
    parts.push({ k: '⑤ 단일 장애점', v: p5, max: W.spof, note: note5 });

    var total = Math.min(100, p1 + p2 + p3 + p4 + p5);
    var grade = gradeOf(total);
    var result = { id: asset.id, total: total, grade: grade, triage: triage(grade), dependents: out, degradedDeps: deg,
                   spof: p5 > 0, bad: bads.length, parts: parts, basis: '정기점검 실측·ADMIN 등록 자료 기준 (센서 아님)' };
    riskCache.set(cacheKey, { asset: asset, nMeas: measuresOfAsset(asset).length, status: asset.status, result: result });
    return result;
  }

  /* ---------- 요약 ---------- */
  function allMeasures(floorCode) {
    var m = TwinX.model; if (!m) return [];
    var assetFloor = {}, roomFloor = {};
    (m.assets || []).forEach(function (a) { assetFloor[a.id] = a.floor; });
    (m.rooms || []).forEach(function (r) { roomFloor[r.id] = r.floor; });
    var seen = new Set(), list = [];
    function add(x, fl) { if (!x || seen.has(x)) return; seen.add(x); list.push({ m: x, floor: fl }); }
    (m.measurements || []).forEach(function (x) { add(x, x.assetId ? assetFloor[x.assetId] : x.roomId ? roomFloor[x.roomId] : null); });
    (m.assets || []).forEach(function (a) { (a.measures || []).forEach(function (x) { add(x, a.floor); }); });
    (m.rooms || []).forEach(function (r) { (r.measures || []).forEach(function (x) { add(x, r.floor); }); });
    return list.filter(function (e) { return !floorCode || e.floor === floorCode; }).map(function (e) { return e.m; });
  }

  function summary(floorCode) {
    var m = TwinX.model;
    var assets = m ? (m.assets || []).filter(function (a) { return !floorCode || a.floor === floorCode; }) : [];
    var byGrade = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0, NONE: 0 };
    var byRisk = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 };
    var faulty = [];
    assets.forEach(function (a) {
      byGrade[a.grade in byGrade ? a.grade : 'NONE']++;
      var r = risk(a); byRisk[r.grade]++;
      var bad = (a.measures || []).filter(function (x) { return x.judge === 'bad'; }).length;
      if (BAD_STATUS.test(a.status || '') || WARN_STATUS.test(a.status || '') || bad) {
        faulty.push({ id: a.id, name: a.name, floor: a.floor, status: a.status, grade: a.grade, bad: bad, risk: r.total, riskGrade: r.grade });
      }
    });
    faulty.sort(function (x, y) { return y.risk - x.risk; });
    var std = {};
    STD_KEYS.forEach(function (k) { std[k] = { name: STD[k].name, desc: STD[k].desc, good: 0, bad: 0, na: 0, none: 0, total: 0, rate: null }; });
    std.etc = { name: '기타', desc: '기술기준 미분류', good: 0, bad: 0, na: 0, none: 0, total: 0, rate: null };
    var ms = allMeasures(floorCode);
    ms.forEach(function (x) {
      var s = std[x.std] || std.etc, j = x.judge in s ? x.judge : 'none';
      s[j]++; s.total++;
    });
    Object.keys(std).forEach(function (k) { var s = std[k], d = s.good + s.bad; s.rate = d ? Math.round(s.good / d * 1000) / 10 : null; });
    return { floor: floorCode || null, assets: assets.length, byGrade: byGrade, byRisk: byRisk, faulty: faulty,
             std: std, measures: ms.length, basis: '정기점검 실측 자료 기준' };
  }

  /* ---------- 정적 경보 (정기점검 실측 기반 · 센서 아님) ---------- */
  function alarms(floorCode) {
    var m = TwinX.model; if (!m) return [];
    var list = [];
    var lvlRank = { CRIT: 3, WARN: 2, INFO: 1 };
    function push(o) { list.push(o); }
    (m.assets || []).forEach(function (a) {
      if (floorCode && a.floor !== floorCode) return;
      var st = String(a.status || '');
      if (BAD_STATUS.test(st)) push({ id: a.id + '|status', assetId: a.id, roomId: a.room, floor: a.floor, level: 'CRIT', std: null, msg: a.name + ' — ADMIN 상태 「' + st + '」', date: null, source: 'ADMIN 등록 상태' });
      else if (WARN_STATUS.test(st)) push({ id: a.id + '|status', assetId: a.id, roomId: a.room, floor: a.floor, level: 'WARN', std: null, msg: a.name + ' — ADMIN 상태 「' + st + '」', date: null, source: 'ADMIN 등록 상태' });
      evaluate(a.measures).forEach(function (e, i) { addMeasureAlarm(push, e, a.id, a.room, a.floor, a.name, i); });
    });
    (m.rooms || []).forEach(function (r) {
      if (floorCode && r.floor !== floorCode) return;
      evaluate(r.measures).forEach(function (e, i) { addMeasureAlarm(push, e, null, r.id, r.floor, r.name, i); });
    });
    list.sort(function (x, y) { return (lvlRank[y.level] - lvlRank[x.level]) || String(y.date || '').localeCompare(String(x.date || '')); });
    return list;
  }
  function addMeasureAlarm(push, e, assetId, roomId, floor, name, i) {
    if (e.judge !== 'bad' && !e.near) return;
    var lvl = e.judge === 'bad' ? (e.sev >= 0.6 ? 'CRIT' : 'WARN') : 'INFO';
    var v = e.value != null ? (' ' + e.value + (e.unit || '')) : '';
    var lim = e.limit ? ' (기준 ' + e.limit.text + ')' : '';
    push({ id: (assetId || roomId) + '|m' + i, assetId: assetId, roomId: roomId, floor: floor, level: lvl, std: e.std,
           msg: name + ' — ' + (STD[e.std] ? STD[e.std].name + ' ' : '') + (e.item || '측정') + v + (e.judge === 'bad' ? ' 불량' : ' 기준 근접') + lim,
           date: e.date, source: e.live ? '수집값(live)' : '정기점검 실측' });
  }

  /* ---------- 센서 연동 훅 (향후용 · 최소 구현) ---------- */
  // sample = { assetId | roomId, std?, item, value, unit?, date?, judge? }
  function ingest(sample) {
    if (!sample || !TwinX.model) return null;
    var target = sample.assetId ? TwinX.asset(sample.assetId) : sample.roomId ? TwinX.room(sample.roomId) : null;
    if (!target) return null;
    var meas = { std: sample.std || null, item: sample.item || '', value: sample.value, unit: sample.unit || '',
                 judge: sample.judge || 'none', date: sample.date || new Date().toISOString(), assetId: sample.assetId || undefined,
                 roomId: sample.roomId || undefined, raw: sample, src: 'live' };
    if (!sample.judge) {
      var e = evaluate([meas])[0];
      if (e && e.excess != null) meas.judge = e.excess > 0 ? 'bad' : 'good';
    }
    (target.measures = target.measures || []).push(meas);
    if (sample.assetId) riskCache.forEach(function (v, k) { if (k.indexOf(sample.assetId + '|') === 0) riskCache.delete(k); });
    TwinX.emit('live', { target: sample.assetId ? 'asset' : 'room', id: sample.assetId || sample.roomId, measure: meas });
    return meas;
  }

  /* ---------- 상태 연동: state.fault → TwinX.fault + 'fault' 이벤트 ---------- */
  var lastSig = null;
  function recomputeFault(force) {
    var f = (TwinX.state && TwinX.state.fault) || {};
    var src = f.active ? f.source : null;
    if (f.active && !src && TwinX.state.selected) {
      // 발생원 미지정 → 현재 선택 설비를 발생원으로 확정 (이후 선택이 바뀌어도 유지)
      TwinX.setState({ fault: { active: true, source: TwinX.state.selected } });
      return;
    }
    if (src && TwinX.model && !TwinX.asset(src)) src = null;
    var imp = src ? impact(src) : new Map();
    var sig = (src || '') + '#' + imp.size + '#' + (G ? G.nLinks : 0);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    TwinX.fault = { source: src, impact: imp };
    TwinX.emit('fault', TwinX.fault);
  }

  TwinX.on('state', function (e) {
    if (e && e.changed && e.changed.indexOf('fault') >= 0) recomputeFault(false);
  });
  TwinX.on('model', function () { invalidate(); recomputeFault(true); });

  // 핵심 계약: 센서 연동 훅
  if (!TwinX.ingest) TwinX.ingest = ingest;

  TwinX.analysis = {
    impact: impact,
    upstream: upstream,
    downstream: downstream,
    relationDepth: relationDepth,
    risk: risk,
    triage: triage,
    gradeOf: gradeOf,
    summary: summary,
    alarms: alarms,
    evaluate: evaluate,
    limitOf: limitOf,
    ingest: ingest,
    invalidate: invalidate,
    recomputeFault: function () { recomputeFault(true); },
    STD: STD,
    WEIGHTS: W
  };

  if (TwinX.model) recomputeFault(true);
})();
