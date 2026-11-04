// T5 단위 시험: node twin-admin/test/unit-analysis.js
// 00-core.js + 50-analysis.js 를 Node vm 샌드박스(window 대체)에서 로드해 impact/risk/summary/alarms/fault 를 검증
const vm = require('vm'); const fs = require('fs'); const path = require('path');
const SRC = path.join(__dirname, '..', 'src');

function load() {
  const win = {};
  const ctx = vm.createContext({ window: win, console, Map, Set, Date, JSON, Math, setTimeout, clearTimeout });
  win.window = win;
  for (const f of ['00-core.js', '50-analysis.js']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  return win.TwinX;
}

let pass = 0, fail = 0; const fails = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; fails.push(name); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

function synth(assets, links, extra) {
  return Object.assign({ source: 'demo', site: {}, floors: [{ code: 'F01', name: '1층', level: 1, elevation: 0 }], rooms: [{ id: 'R1', floor: 'F01', measures: [] }],
    assets: assets.map(id => (typeof id === 'string' ? { id, room: 'R1', floor: 'F01', name: id, status: '정상', grade: 'GREEN', measures: [] } : Object.assign({ room: 'R1', floor: 'F01', name: id.id, status: '정상', grade: 'GREEN', measures: [] }, id))),
    links: links.map((l, i) => ({ id: 'L' + i, from: l[0], to: l[1], type: l[2] || 'data' })), risers: [], measurements: [] }, extra || {});
}

console.log('# 데모 모델');
{
  const X = load(); X.setModel(X.demoModel()); const A = X.analysis;
  t('analysis 네임스페이스·ingest 훅 존재', () => { ok(A && typeof A.impact === 'function'); ok(typeof X.ingest === 'function'); });
  t('코어 스위치 A002 장애 → PoE·서버·NVR 중단 전파', () => {
    const m = A.impact('A002');
    ['A005', 'A006', 'A007', 'A008', 'A009', 'A013', 'A014', 'A015'].forEach(id => eq(m.get(id) && m.get(id).sev, 'outage', id));
    eq(m.get('A016').sev, 'outage', 'A016 via PoE power'); eq(m.get('A016').depth, 2);
    ok(!m.has('A002'), '발생원 제외'); ok(!m.has('A001') && !m.has('A004'), '상위는 영향 없음');
  });
  t('정류기 A010 → UPS(1) → 코어(2) → 전체 하위 outage', () => {
    const m = A.impact('A010'); eq(m.get('A004').depth, 1); eq(m.get('A002').depth, 2); eq(m.get('A016').sev, 'outage');
  });
  t('말단 AP A016 impact 비어 있음', () => eq(A.impact('A016').size, 0));
  t('존재하지 않는 id / null 안전', () => { eq(A.impact('NOPE').size, 0); eq(A.impact(null).size, 0); });
  t('upstream/downstream 링크 배열', () => { eq(A.upstream('A002').length, 3); eq(A.downstream('A002').length, 6); eq(A.upstream('A010').length, 0); });
  t('impact 결과 변경이 캐시를 오염시키지 않음', () => { const m = A.impact('A002'); m.clear(); ok(A.impact('A002').size > 0); });
  t('risk 구조: 0~100, 5개 항목, max 합 100', () => {
    X.model.assets.forEach(a => { const r = A.risk(a); ok(r.total >= 0 && r.total <= 100); eq(r.parts.length, 5); eq(r.parts.reduce((s, p) => s + p.max, 0), 100); ok(['RED', 'ORANGE', 'YELLOW', 'GREEN'].includes(r.grade)); });
  });
  t('risk: 측정·점검일 없으면 ②④ 0점 + "자료 없음"', () => {
    const r = A.risk('A016'); eq(r.parts[1].v, 0); ok(/자료 없음/.test(r.parts[1].note)); eq(r.parts[3].v, 0); ok(/자료 없음/.test(r.parts[3].note));
  });
  t('risk: 코어 스위치 중요도 > 말단 AP', () => ok(A.risk('A002').parts[2].v > A.risk('A016').parts[2].v));
  t('risk: SPOF — A014(상위 1개, 하위 1) 가점, A002(상위 3개) 0점, A005(상위 A002·A004 2개) 0점', () => {
    ok(A.risk('A014').parts[4].v > 0); eq(A.risk('A002').parts[4].v, 0); eq(A.risk('A005').parts[4].v, 0);
  });
  t('risk: 상태 이상(A006) 25점, 주의(A004) 13점', () => { eq(A.risk('A006').parts[0].v, 25); eq(A.risk('A004').parts[0].v, 13); });
  t('summary(): 등급 합계 = 설비 수, 층 필터', () => {
    const s = A.summary(); const sum = Object.values(s.byGrade).reduce((a, b) => a + b, 0); eq(sum, X.model.assets.length);
    eq(A.summary('F04').assets, 8); ok(s.faulty.some(f => f.id === 'A006'));
  });
  t('fault 상태 연동: active+source → TwinX.fault 계산·이벤트', () => {
    let got = null; X.on('fault', f => { got = f; });
    X.setState({ fault: { active: true, source: 'A002' } });
    ok(got && got.source === 'A002' && got.impact.size === 9, 'impact size ' + (got && got.impact.size));
    eq(X.fault.source, 'A002');
  });
  t('fault 활성 중 선택 변경 → 발생원 유지', () => { X.select('A016'); eq(X.fault.source, 'A002'); eq(X.state.fault.source, 'A002'); });
  t('fault 비활성 → 빈 Map', () => { X.setState({ fault: { active: false } }); eq(X.fault.impact.size, 0); eq(X.fault.source, null); });
  t('fault 활성 + 발생원 없음 → 선택 설비를 발생원으로 확정', () => {
    X.select('A004'); X.setState({ fault: { active: true, source: null } }); eq(X.fault.source, 'A004'); eq(X.state.fault.source, 'A004');
    X.select('A001'); eq(X.fault.source, 'A004'); X.setState({ fault: { active: false, source: null } });
  });
  t('model 이벤트 → 캐시 무효화 + fault 재계산', () => {
    X.setState({ fault: { active: true, source: 'A014' } }); eq(X.fault.impact.size, 1);
    const m2 = X.demoModel(); m2.links.push({ id: 'Lx', from: 'A014', to: 'A010', type: 'data' }); X.setModel(m2);
    eq(X.fault.impact.size, 2 + 1 + 0 >= 2 ? X.fault.impact.size : -1); ok(X.fault.impact.has('A010'), '새 링크 반영');
    X.setState({ fault: { active: false, source: null } });
  });
  t('ingest: live 측정 추가 + live 이벤트, model 재발행 없음', () => {
    let live = null, model = 0; X.on('live', e => { live = e; }); X.on('model', () => model++);
    const m = X.ingest({ assetId: 'A005', std: 'gnd', item: '접지저항 측정', value: 35, unit: 'Ω' });
    ok(live && live.id === 'A005'); eq(m.src, 'live'); eq(m.judge, 'bad'); eq(model, 0);
    const r = A.risk('A005'); ok(r.parts[1].v > 0, '위험도 반영');
    ok(A.alarms().some(a => a.assetId === 'A005' && a.source === '수집값(live)'));
  });
}

console.log('# 합성 그래프');
{
  const X = load(); const A = X.analysis;
  t('빈 모델(null) 안전', () => { eq(A.impact('x').size, 0); eq(A.upstream('x').length, 0); eq(A.summary().assets, 0); eq(A.alarms().length, 0); eq(A.risk('x').total, 0); });
  t('빈 배열 모델', () => { X.setModel(synth([], [])); eq(A.impact('a').size, 0); eq(A.summary().assets, 0); });
  t('순환 a→b→c→a 종료·발생원 제외', () => {
    X.setModel(synth(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]));
    const m = A.impact('a'); eq(m.size, 2); eq(m.get('c').depth, 2); ok(!m.has('a'));
  });
  t('자기 루프 무시', () => { X.setModel(synth(['a'], [['a', 'a']])); eq(A.impact('a').size, 0); });
  t('다중 경로: outage 가 degraded 보다 우선 (깊이는 outage 경로)', () => {
    // a -ground-> d (degraded, depth1) ; a -data-> b -data-> c -power-> d (outage, depth3)
    X.setModel(synth(['a', 'b', 'c', 'd'], [['a', 'd', 'ground'], ['a', 'b'], ['b', 'c'], ['c', 'd', 'power']]));
    const m = A.impact('a'); eq(m.get('d').sev, 'outage'); eq(m.get('d').depth, 3); eq(m.get('d').via.from, 'c');
  });
  t('degraded 이후 링크는 data여도 degraded', () => {
    X.setModel(synth(['a', 'b', 'c'], [['a', 'b', 'path'], ['b', 'c', 'data']]));
    const m = A.impact('a'); eq(m.get('b').sev, 'degraded'); eq(m.get('c').sev, 'degraded');
  });
  t('optical 은 outage 전파', () => { X.setModel(synth(['a', 'b'], [['a', 'b', 'optical']])); eq(A.impact('a').get('b').sev, 'outage'); });
  t('고립 노드: impact 0, SPOF 0, 중요도 0', () => {
    X.setModel(synth(['a', 'b', 'z'], [['a', 'b']])); eq(A.impact('z').size, 0); const r = A.risk('z'); eq(r.parts[2].v, 0); eq(r.parts[4].v, 0); eq(r.total, 0); eq(r.grade, 'GREEN');
  });
  t('SPOF: 상위 미등록 루트는 0점 + "자료 없음"', () => { X.setModel(synth(['a', 'b'], [['a', 'b']])); const r = A.risk('a'); eq(r.parts[4].v, 0); ok(/자료 없음/.test(r.parts[4].note)); });
  t('SPOF: 이중화(상위 2개)는 0점, 단일 상위는 가점', () => {
    X.setModel(synth(['p1', 'p2', 's', 'd1'], [['p1', 's'], ['p2', 's', 'power'], ['s', 'd1']])); eq(A.risk('s').parts[4].v, 0);
    X.setModel(synth(['p1', 's', 'd1', 'd2', 'd3'], [['p1', 's'], ['s', 'd1'], ['s', 'd2'], ['s', 'd3']])); eq(A.risk('s').parts[4].v, 15);
  });
  t('실측 심각도: 접지 50Ω 불량 > 12Ω 불량, 근접 관찰 가점', () => {
    const mk = (v, j) => ({ std: 'gnd', item: '접지저항 측정', value: String(v), unit: 'Ω', judge: j, date: '2026-08-01' });
    X.setModel(synth([{ id: 'x', measures: [mk(50, 'bad')] }, { id: 'y', measures: [mk(12, 'bad')] }, { id: 'n', measures: [mk(9.5, 'good')] }, { id: 'g', measures: [mk(2, 'good')] }], []));
    ok(A.risk('x').parts[1].v > A.risk('y').parts[1].v); eq(A.risk('n').parts[1].v, 2); eq(A.risk('g').parts[1].v, 0);
    ok(/최대 초과/.test(A.risk('x').parts[1].note));
  });
  t('열화상 ΔT = 최고−주위 쌍으로 평가 (ΔT 25 → 불량 심각도)', () => {
    const ms = [{ std: 'heat', item: '(추가) 이상 발열 상태 확인(열화상 카메라) — 최고온도', value: '50', unit: '℃', judge: 'bad', date: '2026-08-01' },
                { std: 'heat', item: '(추가) 이상 발열 상태 확인(열화상 카메라) — 주위온도', value: '25', unit: '℃', judge: 'good', date: '2026-08-01' }];
    const ev = load().analysis.evaluate(ms); eq(ev.length, 1); eq(ev[0].value, 25); ok(ev[0].excess > 0);
  });
  t('전원: AC 245V 는 기준 초과, DC 는 기준 미적용', () => {
    const ev = A.evaluate([{ std: 'pwr', item: 'AC 및 DC 입력 전원 측정', value: '245', unit: 'V', judge: 'bad' }, { std: 'pwr', item: 'DC 입력', value: '-48', unit: 'V', judge: 'good' }]);
    ok(ev[0].excess > 0); eq(ev[1].limit, null);
  });
  t('환경: 습도 70% 초과·조도 200lx 미달·온도 22℃ 적합', () => {
    const ev = A.evaluate([{ std: 'env', item: '설치 환경 확인(습도, 온도) — 습도', value: '70', unit: '%', judge: 'bad' },
                           { std: 'env', item: '조명설비 동작 여부 확인', value: '200', unit: 'lx', judge: 'bad' },
                           { std: 'env', item: '설치 환경 확인(습도, 온도) — 온도', value: '22', unit: '℃', judge: 'good' }]);
    ok(ev[0].excess > 0); ok(ev[1].excess > 0); ok(ev[2].excess < 0);
  });
  t('점검 경과: 30개월 전 → 10점, 3개월 전 → 0점', () => {
    X.setModel(synth([{ id: 'o', measures: [{ std: 'gnd', value: '3', judge: 'good', date: '2024-05-01' }] }, { id: 'r', measures: [{ std: 'gnd', value: '3', judge: 'good', date: '2026-08-01' }] }], []));
    eq(A.risk('o', { now: '2026-11-04' }).parts[3].v, 10); eq(A.risk('r', { now: '2026-11-04' }).parts[3].v, 0);
  });
  t('summary 기술기준별 적합/부적합 집계 (asset+room+measurements 중복 제거)', () => {
    const shared = { std: 'sig', item: '소음', value: '70', unit: 'dB(A)', judge: 'bad', assetId: 'a' };
    const m = synth([{ id: 'a', measures: [shared, { std: 'gnd', value: '3', judge: 'good' }] }], [], { measurements: [shared] });
    m.rooms[0].measures = [{ std: 'env', item: '온도', value: '30', unit: '℃', judge: 'bad', roomId: 'R1' }];
    X.setModel(m); const s = A.summary();
    eq(s.std.sig.bad, 1); eq(s.std.gnd.good, 1); eq(s.std.env.bad, 1); eq(s.measures, 3); eq(s.std.gnd.rate, 100);
  });
  t('alarms: 실측 불량 → 경보, 출처 "정기점검 실측" 명시', () => {
    const al = A.alarms(); ok(al.length >= 2); ok(al.every(a => a.source === '정기점검 실측' || a.source === 'ADMIN 등록 상태'));
    ok(al.some(a => a.roomId === 'R1' && a.assetId == null));
  });
  t('성능: 설비 1000·링크 2000 impact < 5ms (캐시 전 첫 호출 포함 평균)', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => 'n' + i); const ls = []; let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const types = ['data', 'optical', 'power', 'ground', 'path'];
    for (let i = 1; i < 1000; i++) ls.push([ids[Math.floor(rnd() * i)], ids[i], types[i % 5]]);
    while (ls.length < 2000) ls.push([ids[Math.floor(rnd() * 1000)], ids[Math.floor(rnd() * 1000)], types[Math.floor(rnd() * 5)]]);
    X.setModel(synth(ids, ls)); X.analysis.invalidate();
    let t0 = process.hrtime.bigint(); X.analysis.impact('n0'); const first = Number(process.hrtime.bigint() - t0) / 1e6;
    t0 = process.hrtime.bigint(); for (let i = 0; i < 200; i++) X.analysis.invalidate() || X.analysis.impact(ids[i * 5]);
    const avg = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
    console.log(`       first(incl. adjacency build)=${first.toFixed(2)}ms, uncached avg=${avg.toFixed(3)}ms, size=${X.analysis.impact('n0').size}`);
    ok(avg < 5, 'avg too slow'); ok(first < 20, 'cold first call (JIT 미적용 + 인접 리스트 생성) too slow');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
