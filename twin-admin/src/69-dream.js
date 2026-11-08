/* ============================================================
   TwinX 69-dream (통합 리드) — 4층 기억 구조 + 꿈꾸기(Dreaming) 현행화 점검 + 위험도 국소 보정
   참고: 「꿈꾸기 + 가중치 공간 프로그래밍」 프롬프트 가이드 (사용자 제공)
   · 1층 원본 기록  : ADMIN 측정 행 · 설비/점검이력 원본 · 현장 사진 (수정하지 않음, 개수·용량만 집계)
   · 2층 기억 메모  : 설비별 '변한 것'만 남긴 경량 노트 (상태·등급·위치·모델·불량 항목 변화, 경고 승격/해소)
   · 3층 지식 지도  : 실·설비·연결(asset_relation)·라이저 토폴로지 점검 (끊긴 연결, 고립 설비, 랙 U 중복)
   · 4층 핵심 컨텍스트 : 뷰어 첫 화면용 MEMORY.md (고위험 Top 10 · 층별 요약 · 교정 필요) ≤ 200줄 / 25KB
   · 꿈꾸기 루프   : 데이터가 바뀌거나 하루가 지나면 1층 원본과 2·3층을 대조해 불일치(교정 필요)를 찾고,
                     반복·고위험만 4층으로 승격, 해소된 경고는 내림 (자동 수정은 하지 않고 '교정 제안'만)
   · 국소 보정(10%) : 트윈에는 신경망이 없으므로, 위험도 점수(50-analysis) 가중치 5개 중 '하나만' 바꿔
                     실측 결과와 어긋난 사례를 줄이는 최소 수정안을 수정 전후 비교로 제시 → 승인 시 적용
   저장: localStorage 'twinx_dream_v1' {lastRun, snap, notes, alerts}, 'twinx_riskw_v1' (가중치 보정)
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.dream) return;
  var U = TX.util, esc = U.esc;
  var KEY = 'twinx_dream_v1', WKEY = 'twinx_riskw_v1';
  var MAX_LINES = 200, MAX_BYTES = 25 * 1024;
  function toast(m, k) { TX.emit('toast', { msg: m, kind: k || 'info' }); }
  function root() { return (TX.ui && TX.ui.root) || document.body; }
  function load() { try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && d.snap ? d : { lastRun: null, snap: {}, notes: {}, alerts: {}, history: [] }; } catch (e) { return { lastRun: null, snap: {}, notes: {}, alerts: {}, history: [] }; } }
  function store(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { toast('브라우저 저장공간이 부족해 꿈꾸기 기록을 저장하지 못했습니다', 'warn'); } }
  function bytes(s) { return new TextEncoder().encode(s).length; }
  function kb(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }
  function pd(s) { if (!s) return null; var m = String(s).match(/(\d{4})[-./년\s]*(\d{1,2})(?:[-./월\s]*(\d{1,2}))?/); if (!m) return null; var d = new Date(+m[1], +m[2] - 1, m[3] ? +m[3] : 1); return isNaN(d) ? null : d; }
  function ymd(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function fname(code) { var f = TX.floor(code); return f ? (f.name || code) : (code || '—'); }
  function rname(id) { var r = id && TX.room(id); return r ? r.name : ''; }
  function riskOf(a) { return TX.analysis && TX.analysis.risk ? TX.analysis.risk(a) : { total: 0, grade: a.grade || 'NONE', parts: [] }; }

  /* ---------- 위험도 가중치 보정값 (승인된 것만) ---------- */
  var BASEW = null;
  function applyW() {
    if (!TX.analysis || !TX.analysis.WEIGHTS) return;
    var W = TX.analysis.WEIGHTS; if (!BASEW) BASEW = Object.assign({}, W);
    var o = null; try { o = JSON.parse(localStorage.getItem(WKEY) || 'null'); } catch (e) { }
    Object.keys(BASEW).forEach(function (k) { W[k] = o && o.w && typeof o.w[k] === 'number' ? o.w[k] : BASEW[k]; });
    if (TX.analysis.invalidate) TX.analysis.invalidate();
  }

  /* ---------- 측정 항목별 최신 판정 · 반복 불량 ---------- */
  function measInfo(a) {
    var ms = a.measures || [], by = {};
    ms.forEach(function (m) { var k = m.item || m.std || '측정'; (by[k] = by[k] || []).push(m); });
    var latestBad = [], repeat = [], last = null;
    Object.keys(by).forEach(function (k) {
      var l = by[k].slice().sort(function (x, y) { return String(y.date || '').localeCompare(String(x.date || '')); });
      if (l[0].judge === 'bad') latestBad.push(k);
      var badDates = {}; l.forEach(function (m) { if (m.judge === 'bad') badDates[m.date || '?'] = 1; });
      if (Object.keys(badDates).length >= 2) repeat.push(k);
    });
    ms.forEach(function (m) { var d = pd(m.date); if (d && (!last || d > last)) last = d; });
    return { n: ms.length, latestBad: latestBad, repeat: repeat, last: last, gnd: ms.some(function (m) { return m.std === 'gnd' && m.judge === 'bad'; }), heat: ms.some(function (m) { return m.std === 'heat' && m.judge === 'bad'; }) };
  }
  function eolOf(a) {
    var r = a.raw || {}, d = pd(r['설치일']), c = parseInt(r['교체주기(개월)'], 10);
    if (!d || !(c > 0)) return null;
    var due = new Date(d.getFullYear(), d.getMonth() + c, d.getDate());
    return { due: due, over: due < new Date(), months: Math.round((new Date() - due) / (30.44 * 864e5)) };
  }

  /* ---------- 꿈꾸기 실행 ---------- */
  var last = null; // 마지막 결과 (메모리)
  function run(opts) {
    var M = TX.model; if (!M) return null;
    applyW();
    var D = load(), now = new Date(), nowIso = now.toISOString(), snap = {}, notes = D.notes || {}, alerts = {}, fixes = [], changes = [];
    function note(id, kind, text, level) {
      var l = notes[id] = notes[id] || [];
      l.unshift({ at: nowIso, kind: kind, text: text, level: level || 'info' });
      if (l.length > 20) l.length = 20;
      changes.push({ id: id, kind: kind, text: text, level: level || 'info' });
    }
    var first = !D.lastRun;
    // ---- 자산별: 스냅샷 대조(2층) + 불일치(교정 필요) + 중요도(Salience) ----
    M.assets.forEach(function (a) {
      var mi = measInfo(a), rk = riskOf(a), eol = eolOf(a);
      var s = { st: a.status || '', g: a.grade || 'NONE', rg: rk.grade, room: a.room || '', model: a.model || '', rack: a.rack ? (a.rack.name + ' ' + (a.rack.u || '')) : '', bad: mi.latestBad.slice().sort().join('|') };
      snap[a.id] = s;
      var p = D.snap && D.snap[a.id];
      if (!first) {
        if (!p) note(a.id, 'new', '신규 등록 · ' + fname(a.floor) + ' ' + rname(a.room), 'info');
        else {
          if (p.st !== s.st) note(a.id, 'status', '상태 변경 「' + (p.st || '—') + '」 → 「' + (s.st || '—') + '」', /이상|불량/.test(s.st) ? 'high' : 'info');
          if (p.room !== s.room) note(a.id, 'move', '위치 변경 ' + (rname(p.room) || p.room || '—') + ' → ' + (rname(s.room) || '—'), 'mid');
          if (p.model !== s.model) note(a.id, 'model', '모델명 변경 「' + (p.model || '—') + '」 → 「' + (s.model || '—') + '」', 'mid');
          if (p.rack !== s.rack) note(a.id, 'rack', '랙·U 변경 ' + (p.rack || '—') + ' → ' + (s.rack || '—'), 'info');
          if (p.bad !== s.bad) {
            var pb = p.bad ? p.bad.split('|') : [], nb = mi.latestBad;
            nb.filter(function (x) { return pb.indexOf(x) < 0; }).forEach(function (x) { note(a.id, 'bad', '신규 불량 「' + x + '」', 'high'); });
            pb.filter(function (x) { return x && nb.indexOf(x) < 0; }).forEach(function (x) { note(a.id, 'fixed', '불량 해소 「' + x + '」', 'info'); });
          }
        }
      }
      // 교정 필요 (DB ↔ 현장 원본 불일치) — 자동 수정하지 않고 제안
      var st = String(a.status || '');
      if (mi.latestBad.length && !/이상|불량|고장|장애|주의/.test(st)) fixes.push({ id: a.id, lv: 'high', t: '상태-실측 불일치', d: 'ADMIN 상태 「' + (st || '—') + '」인데 최근 측정 불량: ' + mi.latestBad.join(', '), act: 'ADMIN 설비 상태를 「이상」 또는 「주의」로 갱신 검토' });
      if (/이상|불량|고장|장애/.test(st) && mi.n && !mi.latestBad.length) fixes.push({ id: a.id, lv: 'mid', t: '상태-실측 불일치', d: 'ADMIN 상태 「' + st + '」인데 최근 측정은 모두 양호', act: '조치 완료 여부 확인 후 상태 해제 검토' });
      if (eol && eol.over) fixes.push({ id: a.id, lv: eol.months >= 12 ? 'high' : 'mid', t: '교체주기 초과', d: '교체 예정일 ' + ymd(eol.due) + ' (' + eol.months + '개월 경과)', act: '교체 계획·예산 반영 또는 교체주기 재확인' });
      if (!mi.n) fixes.push({ id: a.id, lv: 'low', t: '미점검', d: '연결된 정기점검 측정 없음', act: '다음 점검 대상에 포함 · 측정 매칭 확인' });
      else if (mi.last && (now - mi.last) / (30.44 * 864e5) > 12) fixes.push({ id: a.id, lv: 'mid', t: '점검 경과', d: '최근 측정 ' + ymd(mi.last) + ' (12개월 초과)', act: '재점검 일정 수립' });
      if (!a.model) fixes.push({ id: a.id, lv: 'low', t: '모델명 없음', d: '명판 미확인', act: '명판 사진 촬영 후 모델명 입력' });
      if (a.posAdjusted) fixes.push({ id: a.id, lv: 'low', t: '좌표 추정', d: '도면 좌표가 없거나 실 밖이어서 자동 배치됨', act: '간이 현행화 ④ 또는 ADMIN 좌표 입력' });
      // 4층 승격 판단: 안전·장애 파급·비용 영향 기준 Salience
      var sal = rk.total + (mi.gnd ? 15 : 0) + (mi.heat ? 10 : 0) + (mi.repeat.length ? 10 : 0) + (eol && eol.over ? 8 : 0) + (rk.dependents ? Math.min(10, rk.dependents * 2) : 0);
      if (rk.grade === 'RED' || mi.latestBad.length || sal >= 55) {
        var why = [];
        if (mi.latestBad.length) why.push('불량 ' + mi.latestBad.join('·'));
        if (mi.repeat.length) why.push('반복 ' + mi.repeat.join('·'));
        if (eol && eol.over) why.push('교체주기 초과');
        if (rk.dependents) why.push('하위 ' + rk.dependents + '대 영향');
        alerts[a.id] = { sal: Math.round(sal), risk: Math.round(rk.total), grade: rk.grade, why: why.join(' · ') || rk.triage, since: (D.alerts && D.alerts[a.id] && D.alerts[a.id].since) || nowIso };
      }
    });
    // 승격 / 내림 기록 (2층 노트)
    if (!first) {
      Object.keys(alerts).forEach(function (id) { if (!D.alerts || !D.alerts[id]) note(id, 'promote', '핵심 경고로 승격 (중요도 ' + alerts[id].sal + ' · ' + alerts[id].why + ')', 'high'); });
      Object.keys(D.alerts || {}).forEach(function (id) { if (!alerts[id]) note(id, 'demote', '핵심 경고에서 내림 (해소 또는 중요도 하락)', 'info'); });
    }
    // ---- 3층 지식 지도: 토폴로지 점검 ----
    var ids = {}; M.assets.forEach(function (a) { ids[a.id] = a; });
    var linked = {}; (M.links || []).forEach(function (l) { linked[l.from] = linked[l.to] = 1; if (!ids[l.from] || !ids[l.to]) fixes.push({ id: ids[l.from] ? l.from : l.to, lv: 'mid', t: '끊긴 연결', d: '연결 ' + (l.id || '') + ' 의 ' + (!ids[l.from] ? '출발 ' + l.from : '도착 ' + l.to) + ' 설비가 없음', act: 'ADMIN 03_연결관계 수정' }); });
    M.assets.forEach(function (a) {
      if (!linked[a.id] && /네트워크|스위치|중계기|RU|OFD|광|전원|UPS|정류/.test((a.category || '') + ' ' + (a.name || '')) && !(a.bundle && a.bundle.lead !== a.id)) fixes.push({ id: a.id, lv: 'low', t: '고립 설비', d: '상위·하위 연결이 하나도 없음', act: '상위 전원·간선 연결(asset_relation) 등록' });
    });
    var racks = {};
    M.assets.forEach(function (a) { if (a.rack && a.rack.name && a.rack.u0 != null) (racks[(a.room || '') + '|' + a.rack.name] = racks[(a.room || '') + '|' + a.rack.name] || []).push(a); });
    Object.keys(racks).forEach(function (k) {
      var l = racks[k];
      for (var i = 0; i < l.length; i++) for (var j = i + 1; j < l.length; j++) {
        var x = l[i].rack, y = l[j].rack, x1 = x.u1 != null ? x.u1 : x.u0, y1 = y.u1 != null ? y.u1 : y.u0;
        if (!(x1 < y.u0 || y1 < x.u0)) fixes.push({ id: l[i].id, lv: 'mid', t: '랙 U 중복', d: x.name + ' · ' + l[i].id + '(' + (x.u || x.u0) + ') ↔ ' + l[j].id + '(' + (y.u || y.u0) + ')', act: '랙·U 입력 수정' });
      }
    });
    var mst = TX.matching && TX.matching.stats ? TX.matching.stats() : null;
    if (mst && mst.rows && mst.none) fixes.push({ id: null, lv: mst.none / mst.rows > 0.3 ? 'high' : 'mid', t: '측정 미매칭', d: '측정 ' + mst.rows + '건 중 설비·실 연결 없음 ' + mst.none + '건 (추정 ' + mst.est + '건)', act: '현행화 ▾ → 측정 매칭 확인' });
    var LV = { high: 0, mid: 1, low: 2 };
    fixes.sort(function (x, y) { return LV[x.lv] - LV[y.lv] || String(x.t).localeCompare(y.t); });
    // ---- 저장 ----
    D.lastRun = nowIso; D.snap = snap; D.notes = notes; D.alerts = alerts;
    D.history = (D.history || []).concat([{ at: nowIso, fixes: fixes.length, alerts: Object.keys(alerts).length, changes: changes.length }]).slice(-30);
    store(D);
    var res = { at: nowIso, first: first, fixes: fixes, changes: changes, alerts: alerts, D: D };
    res.memory = memoryMd(res);
    res.layers = layers(res);
    last = res;
    TX.emit('dream', res);
    if (dm) renderModal();
    return res;
  }

  /* ---------- 4층: MEMORY.md (뷰어 첫 화면용 요약) ---------- */
  function memoryMd(res) {
    var M = TX.model, L = [], site = (M.site && M.site.name) || '사업장';
    L.push('# 디지털트윈 핵심 컨텍스트 (MEMORY.md)', '', '- 사업장: ' + site + ' · 생성: ' + res.at.slice(0, 16).replace('T', ' ') + ' · 자료: ' + (M.source === 'admin' ? 'ADMIN 등록 자료' : M.source === 'quick' ? '간이 현행화 초안' : '시범 자료'), '');
    var top = Object.keys(res.alerts).map(function (id) { return [id, res.alerts[id]]; }).sort(function (x, y) { return y[1].sal - x[1].sal; }).slice(0, 10);
    L.push('## 즉시 확인 (고위험 Top ' + top.length + ')');
    if (!top.length) L.push('- 없음');
    top.forEach(function (t) { var a = TX.asset(t[0]); L.push('- [중요도 ' + t[1].sal + ' · 위험 ' + t[1].risk + '] ' + t[0] + ' ' + (a ? a.name : '') + ' · ' + fname(a && a.floor) + ' ' + rname(a && a.room) + ' — ' + t[1].why); });
    L.push('', '## 층별 상태');
    M.floors.forEach(function (f) {
      var as = M.assets.filter(function (a) { return a.floor === f.code; }); if (!as.length) return;
      var c = { RED: 0, ORANGE: 0, YELLOW: 0, NONE: 0 }; as.forEach(function (a) { if (c[a.grade] != null) c[a.grade]++; });
      L.push('- ' + (f.building ? f.building + ' ' : '') + (f.name || f.code) + ': 설비 ' + as.length + ' · 이상 ' + c.RED + ' · 주의 ' + c.ORANGE + ' · 관찰 ' + c.YELLOW + ' · 미점검 ' + c.NONE);
    });
    var by = {}; res.fixes.forEach(function (x) { by[x.t] = (by[x.t] || 0) + 1; });
    L.push('', '## 교정 필요 (DB ↔ 현장 원본)');
    if (!res.fixes.length) L.push('- 없음'); else L.push('- ' + Object.keys(by).map(function (k) { return k + ' ' + by[k]; }).join(' · '));
    res.fixes.filter(function (x) { return x.lv === 'high'; }).slice(0, 10).forEach(function (x) { L.push('  - ' + (x.id || '') + ' ' + x.t + ': ' + x.d); });
    var dem = res.changes.filter(function (c) { return c.kind === 'demote' || c.kind === 'fixed'; });
    if (dem.length) { L.push('', '## 내려간 경고 (해소)'); dem.slice(0, 10).forEach(function (c) { L.push('- ' + c.id + ' ' + c.text); }); }
    var s = L.join('\n');
    while ((L.length > MAX_LINES || bytes(s) > MAX_BYTES) && L.length > 10) { L.splice(L.length - 2, 1); s = L.join('\n'); }
    return s;
  }
  function layers(res) {
    var M = TX.model, rows = (M.measurements || []).length, full = bytes(JSON.stringify({ assets: M.assets.map(function (a) { return a.raw || a; }), meas: (M.measurements || []).map(function (m) { return m.raw || m; }) }));
    var nb = 0; Object.keys(res.D.notes || {}).forEach(function (k) { nb += res.D.notes[k].length; });
    var mem = bytes(res.memory);
    return [
      { k: '1층 원본 기록', d: 'ADMIN 측정 행 · 설비 원본 · 현장 사진 (수정 없이 보관)', n: '측정 ' + rows + '행 · 설비 원본 ' + M.assets.length + '건', size: full },
      { k: '2층 기억 메모', d: '설비별로 변한 것만 (상태·위치·모델·불량·승격/해소)', n: '노트 ' + nb + '건 · 설비 ' + Object.keys(res.D.notes || {}).length + '대', size: bytes(JSON.stringify(res.D.notes || {})) },
      { k: '3층 지식 지도', d: '실·설비·연결·라이저 토폴로지', n: '실 ' + M.rooms.length + ' · 설비 ' + M.assets.length + ' · 연결 ' + (M.links || []).length + ' · 라이저 ' + (M.risers || []).length, size: bytes(JSON.stringify({ r: M.rooms.map(function (r) { return [r.id, r.floor, r.name]; }), l: (M.links || []).map(function (l) { return [l.from, l.to, l.type]; }) })) },
      { k: '4층 핵심 컨텍스트', d: '뷰어 첫 화면 · 모바일 호출 시 먼저 읽는 MEMORY.md', n: res.memory.split('\n').length + '줄 (한도 ' + MAX_LINES + '줄 · ' + kb(MAX_BYTES) + ')', size: mem, ratio: full ? Math.round(mem / full * 1000) / 10 : 0 }
    ];
  }

  /* ---------- 국소 보정: 가중치 1개만 바꿔 실측과 어긋난 사례 줄이기 ---------- */
  function caseSet() {
    var M = TX.model; if (!M) return { fn: [], fp: [] };
    var fn = [], fp = [];
    M.assets.forEach(function (a) {
      var mi = measInfo(a), r = riskOf(a);
      if (mi.latestBad.length && r.total < 40) fn.push({ id: a.id, risk: r.total, why: '최근 불량(' + mi.latestBad.join(', ') + ')인데 위험 ' + Math.round(r.total) + '점' });
      if (!mi.latestBad.length && mi.n && r.total >= 60 && !/이상|불량|고장|장애/.test(a.status || '')) fp.push({ id: a.id, risk: r.total, why: '측정 모두 양호·상태 정상인데 위험 ' + Math.round(r.total) + '점' });
    });
    return { fn: fn, fp: fp };
  }
  function calibrate() {
    if (!TX.analysis || !TX.analysis.WEIGHTS) return null;
    applyW();
    var W = TX.analysis.WEIGHTS, cur = Object.assign({}, W), base = caseSet(), bestE = null;
    var score = function (c) { return c.fn.length * 2 + c.fp.length; }; // 불량 놓침(FN)을 더 무겁게
    Object.keys(cur).forEach(function (k) {
      [-10, -5, 5, 10].forEach(function (dv) {
        var v = cur[k] + dv; if (v < 0 || v > 50) return;
        W[k] = v; TX.analysis.invalidate(); var c = caseSet();
        var gain = score(base) - score(c);
        if (gain > 0 && (!bestE || gain > bestE.gain || (gain === bestE.gain && Math.abs(dv) < Math.abs(bestE.dv)))) bestE = { k: k, dv: dv, v: v, gain: gain, after: c };
        W[k] = cur[k];
      });
    });
    TX.analysis.invalidate();
    return { cur: cur, base: base, best: bestE };
  }
  var WNAME = { status: '① 상태', measure: '② 실측 불량', crit: '③ 중요도(하위 의존)', age: '④ 점검 경과', spof: '⑤ 단일 장애점' };
  function saveW(w) { try { localStorage.setItem(WKEY, JSON.stringify({ at: new Date().toISOString(), w: w })); } catch (e) { } applyW(); TX.emit('model', TX.model); }

  /* ---------- 화면 ---------- */
  var dm = null, tab = 'mem', cal = null;
  function open(t) {
    if (t) tab = t;
    if (!last) run();
    if (!dm) { dm = U.el('div', 'tx-wb-modal tx-dr'); root().appendChild(dm); bind(); }
    renderModal();
  }
  function closeM() { if (dm) { dm.remove(); dm = null; } }
  var LVN = { high: '높음', mid: '중간', low: '낮음' };
  function renderModal() {
    if (!dm || !last) return;
    var r = last, nH = r.fixes.filter(function (x) { return x.lv === 'high'; }).length;
    var tabs = [['mem', '4층 핵심 요약'], ['fix', '교정 필요 ' + r.fixes.length], ['note', '2층 변경 노트 ' + r.changes.length], ['layer', '4층 기억 구조'], ['cal', '위험도 국소 보정']];
    var h = '<div class="tx-wb-dlg tx-dr-dlg" role="dialog" aria-modal="true" aria-label="꿈꾸기 현행화 점검">' +
      '<div class="tx-wb-hd"><div><small>꿈꾸기(Dreaming) 현행화 점검 · 1층 원본 ↔ 2·3층 대조 → 4층 핵심 요약</small><b>마지막 점검 ' + esc(r.at.slice(0, 16).replace('T', ' ')) + ' · 교정 필요 ' + r.fixes.length + ' (높음 ' + nH + ') · 핵심 경고 ' + Object.keys(r.alerts).length + '</b></div><button type="button" class="tx-wb-x" data-d="close" aria-label="닫기">✕</button></div>' +
      '<div class="tx-dg-tabs">' + tabs.map(function (t) { return '<button type="button" data-d="tab" data-k="' + t[0] + '" class="' + (tab === t[0] ? 'is-on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div class="tx-wb-body tx-dr-body">';
    if (tab === 'mem') {
      h += '<p class="tx-wb-guide">뷰어를 열 때 전체 DB 대신 먼저 보는 <b>4층 핵심 컨텍스트</b>입니다. 고위험·반복 불량·교체주기 초과만 승격하고, 해소된 경고는 내립니다. (' + r.memory.split('\n').length + '줄 · ' + kb(bytes(r.memory)) + ')</p><pre class="tx-dr-pre">' + esc(r.memory) + '</pre>';
    } else if (tab === 'fix') {
      h += '<p class="tx-wb-guide">ADMIN 등록 자료와 1층 원본(측정·이력·연결)을 대조해 어긋난 항목입니다. <b>자동으로 고치지 않고</b> 교정 제안만 합니다. 설비를 누르면 도면에서 위치를 보여 줍니다.</p>' +
        (r.fixes.length ? '<div class="tx-rp-tbl"><table><thead><tr><th>중요도</th><th>유형</th><th>설비</th><th>내용</th><th>교정 제안</th></tr></thead><tbody>' + r.fixes.slice(0, 400).map(function (x) {
          var a = x.id && TX.asset(x.id);
          return '<tr class="tx-dr-' + x.lv + '"><td>' + LVN[x.lv] + '</td><td>' + esc(x.t) + '</td><td>' + (a ? '<button type="button" class="tx-wb-link" data-d="go" data-id="' + esc(x.id) + '">' + esc(x.id) + '</button><small>' + esc(a.name) + '</small>' : '—') + '</td><td>' + esc(x.d) + '</td><td>' + esc(x.act) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="tx-wb-empty">불일치가 없습니다</p>');
    } else if (tab === 'note') {
      var all = []; Object.keys(r.D.notes || {}).forEach(function (id) { r.D.notes[id].forEach(function (n) { all.push([id, n]); }); });
      all.sort(function (x, y) { return y[1].at.localeCompare(x[1].at); });
      h += '<p class="tx-wb-guide">설비별로 <b>변한 것만</b> 남기는 경량 이력(2층)입니다. 첫 점검은 기준점만 만들고, 이후 점검부터 변경·승격·해소가 쌓입니다. 설비당 최근 20건.</p>' +
        (all.length ? '<ul class="tx-dr-notes">' + all.slice(0, 300).map(function (e) { var a = TX.asset(e[0]); return '<li class="tx-dr-' + e[1].level + '"><time>' + esc(e[1].at.slice(0, 16).replace('T', ' ')) + '</time><button type="button" class="tx-wb-link" data-d="go" data-id="' + esc(e[0]) + '">' + esc(e[0]) + '</button><span>' + esc((a ? a.name + ' · ' : '') + e[1].text) + '</span></li>'; }).join('') + '</ul>'
          : '<p class="tx-wb-empty">' + (r.first ? '첫 점검으로 기준점을 저장했습니다. 다음 점검(자료 변경 시 자동)부터 변경 노트가 쌓입니다.' : '변경 없음') + '</p>');
    } else if (tab === 'layer') {
      h += '<p class="tx-wb-guide">점검 자료를 한 표에 계속 쌓지 않고 4개 층으로 나눠 관리합니다. 상시 로딩되는 4층은 1층 원본 대비 용량 비율로 표시합니다 (목표 10% 이하).</p>' +
        '<div class="tx-dr-layers">' + r.layers.slice().reverse().map(function (l) { return '<div><b>' + esc(l.k) + '</b><span>' + esc(l.d) + '</span><em>' + esc(l.n) + ' · ' + kb(l.size) + (l.ratio != null ? ' · 1층 대비 ' + l.ratio + '%' : '') + '</em></div>'; }).join('') + '</div>' +
        '<h5>최근 꿈꾸기 기록</h5><ul class="tx-dr-notes">' + (r.D.history || []).slice().reverse().slice(0, 10).map(function (x) { return '<li><time>' + esc(x.at.slice(0, 16).replace('T', ' ')) + '</time><span>교정 필요 ' + x.fixes + ' · 핵심 경고 ' + x.alerts + ' · 변경 ' + x.changes + '</span></li>'; }).join('') + '</ul>';
    } else {
      if (!cal) cal = calibrate();
      var c = cal;
      h += '<p class="tx-wb-guide">위험도 점수(100점)는 5개 가중치로 계산합니다. 실측 결과와 어긋난 사례(불량인데 점수 낮음 = <b>놓침</b>, 양호인데 점수 높음 = <b>과대</b>)를 찾아, <b>가중치 1개만</b> 바꿔 가장 많이 줄이는 최소 수정안을 제시합니다. 다른 계산은 건드리지 않으며, 승인해야 적용됩니다.</p>';
      if (!c) h += '<p class="tx-wb-empty">위험도 모듈이 없습니다</p>';
      else {
        h += '<div class="tx-dr-w">' + Object.keys(c.cur).map(function (k) { return '<span><b>' + esc(WNAME[k] || k) + '</b>' + c.cur[k] + '점' + (c.best && c.best.k === k ? ' → <em>' + c.best.v + '점</em>' : '') + '</span>'; }).join('') + '</div>' +
          '<table class="tx-dr-cmp"><thead><tr><th></th><th>현재</th><th>수정안</th></tr></thead><tbody>' +
          '<tr><td>놓침 (불량인데 위험 40점 미만)</td><td>' + c.base.fn.length + '</td><td>' + (c.best ? c.best.after.fn.length : '—') + '</td></tr>' +
          '<tr><td>과대 (양호·정상인데 위험 60점 이상)</td><td>' + c.base.fp.length + '</td><td>' + (c.best ? c.best.after.fp.length : '—') + '</td></tr></tbody></table>' +
          (c.base.fn.length + c.base.fp.length ? '<ul class="tx-dr-notes">' + c.base.fn.concat(c.base.fp).slice(0, 12).map(function (x) { return '<li><button type="button" class="tx-wb-link" data-d="go" data-id="' + esc(x.id) + '">' + esc(x.id) + '</button><span>' + esc(x.why) + '</span></li>'; }).join('') + '</ul>' : '<p class="tx-wb-empty">실측과 어긋난 사례가 없습니다</p>') +
          '<div class="tx-wb-acts">' + (c.best ? '<button type="button" class="tx-wb-btn tx-wb-pri" data-d="wapply">수정안 적용 (' + esc(WNAME[c.best.k]) + ' ' + c.cur[c.best.k] + '→' + c.best.v + ')</button>' : '<span class="tx-wb-help">가중치 1개 변경으로 줄일 수 있는 사례가 없습니다 (자료·상태 교정이 먼저 필요)</span>') +
          '<button type="button" class="tx-wb-btn" data-d="wreset">기본 가중치로 복원</button></div>';
      }
    }
    h += '</div><div class="tx-wb-ft"><div class="tx-wb-ft-l"><button type="button" class="tx-wb-link" data-d="md">MEMORY.md 저장</button><button type="button" class="tx-wb-link" data-d="xlsx">점검 보고서(엑셀)</button></div>' +
      '<div><button type="button" class="tx-wb-btn tx-wb-pri" data-d="run">지금 다시 점검</button></div></div></div>';
    dm.innerHTML = h;
  }
  function bind() {
    dm.addEventListener('click', function (e) {
      if (e.target === dm) { closeM(); return; }
      var b = e.target.closest('[data-d]'); if (!b) return;
      var a = b.getAttribute('data-d');
      if (a === 'close') closeM();
      else if (a === 'tab') { tab = b.getAttribute('data-k'); if (tab === 'cal') cal = null; renderModal(); }
      else if (a === 'run') { cal = null; run(); toast('꿈꾸기 점검 완료 · 교정 필요 ' + last.fixes.length + '건', 'success'); }
      else if (a === 'go') { var id = b.getAttribute('data-id'); closeM(); if (!TX.state.open) TX.open(); TX.select(id); }
      else if (a === 'md') U.download(new Blob([last.memory], { type: 'text/markdown' }), 'MEMORY.md');
      else if (a === 'xlsx') exportX();
      else if (a === 'wapply' && cal && cal.best) { var w = Object.assign({}, cal.cur); w[cal.best.k] = cal.best.v; saveW(w); cal = null; run(); toast('위험도 가중치 보정 적용 · 놓침/과대 사례 재계산', 'success'); }
      else if (a === 'wreset') { try { localStorage.removeItem(WKEY); } catch (er) { } applyW(); TX.emit('model', TX.model); cal = null; run(); toast('기본 가중치로 복원했습니다', 'info'); }
    });
    dm.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeM(); } });
  }
  function exportX() {
    var q = TX.quick && TX.quick._; if (!q) return;
    var fx = [['중요도', '유형', '설비ID', '설비명', '내용', '교정 제안']].concat(last.fixes.map(function (x) { var a = x.id && TX.asset(x.id); return [LVN[x.lv], x.t, x.id || '', a ? a.name : '', x.d, x.act]; }));
    var nt = [['일시', '설비ID', '유형', '내용', '중요도']]; Object.keys(last.D.notes || {}).forEach(function (id) { last.D.notes[id].forEach(function (n) { nt.push([n.at.slice(0, 16).replace('T', ' '), id, n.kind, n.text, n.level]); }); });
    var al = [['설비ID', '설비명', '위험등급', '위험점수', '중요도', '사유', '승격 시점']].concat(Object.keys(last.alerts).map(function (id) { var a = TX.asset(id), x = last.alerts[id]; return [id, a ? a.name : '', x.grade, x.risk, x.sal, x.why, x.since.slice(0, 10)]; }));
    var ly = [['층', '설명', '내용', '용량(B)']].concat(last.layers.map(function (l) { return [l.k, l.d, l.n, l.size]; }));
    var mm = [['MEMORY.md']].concat(last.memory.split('\n').map(function (s) { return [s]; }));
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    U.download(q.xlsx([['교정필요', fx], ['핵심경고_4층', al], ['변경노트_2층', nt], ['기억구조', ly], ['MEMORY', mm]]), 'ICT_Twin_Dreaming_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.xlsx');
  }

  /* ---------- 자동 실행: 자료가 바뀌면(디바운스) · 하루 1회 요약 알림 ---------- */
  var sigLast = '';
  var auto = U.debounce(function () {
    var M = TX.model; if (!M || M.source === 'demo') return;
    var sig = M.source + '|' + M.assets.length + '|' + (M.measurements || []).length + '|' + M.assets.map(function (a) { return a.id + a.status + a.grade + (a.room || ''); }).join(',').length;
    if (sig === sigLast) return; sigLast = sig;
    var r = run();
    if (!r) return;
    var day = new Date().toISOString().slice(0, 10), seen = null; try { seen = localStorage.getItem('twinx_dream_seen'); } catch (e) { }
    var hi = r.fixes.filter(function (x) { return x.lv === 'high'; }).length, nA = Object.keys(r.alerts).length;
    if (seen !== day && (hi || nA) && TX.state.open) { try { localStorage.setItem('twinx_dream_seen', day); } catch (e) { } toast('꿈꾸기 점검 · 핵심 경고 ' + nA + ' · 교정 필요(높음) ' + hi + ' → 현행화 ▾ 「꿈꾸기 현행화 점검」', hi ? 'warn' : 'info'); }
  }, 2500);
  TX.on('model', function () { auto(); });
  TX.on('open', function () { auto(); });

  /* ---------- 메뉴 ---------- */
  function injectMenu() {
    var m = document.querySelector('.tx-wb-menu'); if (!m || m.querySelector('[data-dr]')) return;
    var n = last ? last.fixes.filter(function (x) { return x.lv === 'high'; }).length : 0;
    var b = U.el('button', '', '<b>꿈꾸기 현행화 점검' + (n ? ' <em class="tx-wb-mbadge">' + n + '</em>' : '') + '</b><small>원본 ↔ DB 대조 · 불일치 교정 제안 · 4층 핵심 요약(MEMORY.md) · 위험도 국소 보정</small>');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.setAttribute('data-dr', '1');
    b.addEventListener('click', function (e) { e.stopPropagation(); m.remove(); var t = document.querySelector('[data-act="wb-menu"]'); if (t) t.setAttribute('aria-expanded', 'false'); open(); });
    m.appendChild(b);
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-act="wb-menu"]')) setTimeout(injectMenu, 0); });
  applyW();

  TX.dream = { run: run, open: open, last: function () { return last; }, calibrate: calibrate, cases: caseSet, memory: function () { return last && last.memory; } };
})();
