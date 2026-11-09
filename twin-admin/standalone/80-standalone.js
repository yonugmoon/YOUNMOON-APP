/* ============================================================
   TwinX 80-standalone — ICT Twin 단독 운영판 (ADMIN 없이 단독 실행)
   목적: 사업장 배포 전, 우리 팀이 단독으로 운영·시험하는 프로그램
   ① 자료 등록 : 설비 엑셀(No·장비명·설비구분·모델명·제조사·수량·위치) + 점검 결과서(워드·PDF·엑셀)
   ② 도면 등록 : 도면(사진·PDF) → 축척 → 실 그리기(위치 이름이 같으면 설비 자동 배치) → 선로(연결)·트레이
   ③ 연동 표시 : 같은 설비 자료가 2D CAD · 3D · 계통도 · 설비 상세(슬롯·측정)에 함께 반영
   저장: 이 PC 브라우저 (자동 저장) + 복원용 백업 파일(도면 포함)
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX; if (!TX) return;
  var U = TX.util;
  function toast(m, k) { TX.emit('toast', { msg: m, kind: k || 'info' }); }

  /* ---------- 정보통신설비 34종 (ADMIN 「설비별 34종」과 같은 기준) ---------- */
  var TYPES = ['케이블 설비', '배관 설비', '국선인입 설비', '단자함 설비', '이동통신 구내선로 설비', '전화 설비', '방송 공동수신 안테나 시설', '종합유선방송 구내 전송선로 설비', '방송 음향 설비', '네트워크 설비',
    '전자출입(통제) 시스템', '원격검침 시스템', '주차관제 시스템', '주차유도 시스템', '무인택배 시스템', '비상벨 설비', '영상정보처리기기 시스템', '홈네트워크 설비', '빌딩 안내 시스템(BIS)', '전기시계 시스템',
    '통합 SI 시스템', '시설관리 시스템', '건물 에너지관리 시스템', '지능형 인원계수 시스템', '지능형 경계 감시 시스템', '스마트 병원 설비(의료용 너스콜)', '스마트 도난방지 시스템', '스마트 공장 시스템', '스마트 도서관 시스템', '지능형 이상음원 시스템',
    'IoT기반 지하공간 안전관리 시스템', '디지털 사이니지', '통신용 전원 설비', '통신 접지 설비'];
  var GROUP = function (i) { return i < 8 ? '통신 설비' : i === 8 ? '방송 설비' : i < 32 ? '정보 설비' : '기타 설비'; };
  var ALIAS = [[/광중계기|중계기|RU\b|기지국|이동통신|5G|LTE/i, 4], [/OFD|FDF|ODF|광분배|광케이블|케이블|UTP/i, 0], [/배관|덕트/, 1], [/국선|인입/, 2], [/MDF|IDF|단자함|패치/i, 3], [/교환|전화|PBX/i, 5],
    [/MATV|공청|안테나|8VSB|UHD|Remodulator|Processor|Divider|Combiner|Head\s*Amp|DMB|FM/i, 6], [/CATV|종합유선/i, 7], [/방송|앰프|PA\b|스피커|음향|Amplifier/i, 8], [/스위치|라우터|L2|L3|서버|스토리지|네트워크|AP\b|무선|전산/i, 9],
    [/출입|통제/, 10], [/검침/, 11], [/주차관제/, 12], [/주차유도/, 13], [/택배/, 14], [/비상벨/, 15], [/CCTV|NVR|DVR|카메라|영상/i, 16], [/홈네트워크|월패드/, 17], [/BIS|안내/i, 18], [/시계/, 19], [/SI\b|통합/i, 20], [/시설관리|FMS/i, 21], [/BEMS|에너지/i, 22],
    [/사이니지|DID/i, 31], [/UPS|정류|축전지|전원|분전|Power\s*Distributor/i, 32], [/접지/, 33]];
  function nameOf(s) {
    s = String(s || '').trim(); if (!s) return null;
    var k = s.replace(/\s+/g, '');
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].replace(/\s+/g, '') === k) return TYPES[i];
    for (var j = 0; j < ALIAS.length; j++) if (ALIAS[j][0].test(s)) return TYPES[ALIAS[j][1]];
    return null;
  }
  TX.eqTypes = { list: TYPES.map(function (n, i) { return { no: i + 1, name: n, group: GROUP(i) }; }), nameOf: nameOf };

  /* ---------- 시작: 단독 운영 모드로 뷰어·등록 패널을 항상 열어 둠 ---------- */
  function boot() {
    var D = TX.quick && TX.quick.draft(); if (!D) return;
    if (!D.active) { D.active = true; if (!D.site) D.site = ''; TX.quick._.save(); }
    TX.open({ view: '2d' });
    if (D.floors.length) TX.setModel(TX.quick.model()); else TX.setModel({ source: 'quick', site: { name: D.site || '새 사업장', building: '' }, floors: [], rooms: [], assets: [], links: [], risers: [], measurements: [], updatedAt: new Date().toISOString() });
    TX.quick.open();
    document.title = 'ICT Twin 단독 운영판' + (D.site ? ' · ' + D.site : '');
  }
  TX.on('close', function () { setTimeout(function () { if (!TX.state.open) TX.open({ view: '2d' }); }, 0); }); // 닫기 없음 (단독 앱)

  /* ---------- 「현행화 ▾」 메뉴: 단독 운영 항목 ---------- */
  function injectMenu() {
    var m = document.querySelector('.tx-wb-menu'); if (!m || m.querySelector('[data-sa]')) return;
    var items = [['panel', '설비·도면 등록 패널', '① 설비 엑셀 → ② 도면·실·배치 → ③ 연결·저장'], ['backup', '백업 저장 (도면 포함)', '이 PC 자료 전체를 파일로 · 다른 PC로 옮길 때'], ['restore', '백업 불러오기', '백업 파일로 복원'], ['reset', '전체 초기화', '이 PC의 모든 자료 삭제 (백업 먼저)']];
    items.slice().reverse().forEach(function (it) {
      var b = U.el('button', '', '<b>' + it[1] + '</b><small>' + it[2] + '</small>'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.setAttribute('data-sa', it[0]);
      b.addEventListener('click', function (e) { e.stopPropagation(); m.remove(); run(it[0]); });
      m.insertBefore(b, m.firstChild);
    });
    // ADMIN 전용 항목 숨김
    ['[data-rs]', '[data-wbm="match"]'].forEach(function (q) { var x = m.querySelector(q); if (x) x.remove(); });
    var qk = m.querySelector('[data-qk]'); if (qk) qk.remove();
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-act="wb-menu"]')) setTimeout(injectMenu, 10); });
  function pick(accept, cb) { var i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none'; i.onchange = function () { var f = i.files && i.files[0]; i.remove(); if (f) cb(f); }; document.body.appendChild(i); i.click(); }
  function run(k) {
    if (k === 'panel') TX.quick.open();
    else if (k === 'backup') { if (TX.adminSync) TX.adminSync.backup('단독 운영판 백업').then(function () { toast('백업 파일을 저장했습니다', 'success'); }); }
    else if (k === 'restore') pick('.json,application/json', function (f) { TX.adminSync.restore(f).then(function () { toast('복원했습니다 · 다시 불러옵니다', 'success'); setTimeout(function () { location.reload(); }, 800); }).catch(function (err) { toast('복원 실패: ' + err.message, 'error'); }); });
    else if (k === 'reset') {
      if (!confirm('이 PC에 저장된 설비·도면·실·연결·측정 자료를 모두 지웁니다.\n먼저 백업 파일을 저장합니다. 계속할까요?')) return;
      TX.adminSync.backup('전체 초기화 전').then(function () {
        ['twinx_quick_v1', 'twinx_geom_v1', 'twinx_rack_v1', 'twinx_match_v1', 'twinx_dream_v1', 'twinx_riskw_v1', 'twinx_topo_layout_v1'].forEach(function (x) { try { localStorage.removeItem(x); } catch (e) { } });
        if (TX.underlay && TX.underlay.clearAll) TX.underlay.clearAll();
        setTimeout(function () { location.reload(); }, 600);
      });
    }
  }

  if (document.readyState === 'complete') setTimeout(boot, 50); else window.addEventListener('load', function () { setTimeout(boot, 50); });
  TX.standalone = { boot: boot, run: run };
})();
