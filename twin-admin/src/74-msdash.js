/* ============================================================
   TwinX 74-msdash — ADMIN 「측정 대시보드」 상단을 점검결과 대시보드(73-report) 방식으로 교체
   · ADMIN 측정 대시보드 탭이 보일 때: 기존 필터·지표 카드·차트(.ms-filters/.ms-source/.ms-kpis/.ms-charts)를 숨기고
     같은 자리에 점검결과 대시보드를 내장(TX.report2.create({inline, source:'inspection'}))
   · 수치는 ADMIN 측정 시트 행(source='inspection')만 집계 → ADMIN 화면·측정목록과 건수 일치
   · 머리 줄(측정 엑셀 등록·목록 내보내기), 대시보드/측정목록 탭, 하단 분석(건물별 접지저항·층별 분포·요약·연동)은 그대로
   · 「기존 화면」으로 언제든 원래 대시보드로 전환(설정 저장: localStorage twinx_msx_v1)
   · 풀스크린 관제(fs-on) 격자에서는 개요 영역(행 2~5)을 채우고, 하단 도크의 ①② 분석·요약 섹션(data-fs-sec)에서는 숨김
   · ADMIN 자료는 읽기 전용(TwinX.data.raw/refresh) — ADMIN IndexedDB 접근 없음
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || window.TWINX_STANDALONE || !TX.report2 || !TX.report2.create || TX.msdash) return;
  var KEY = 'twinx_msx_v1';
  var on = true; // 「기존 화면」 전환 제거 (요청) — 콘솔 TwinX.msdash.off() 로만 임시 해제
  /* ADMIN 머리 줄의 사업장명·점검일 (예: <p>안양시청 <span>2026-08-10</span></p>) */
  function meta() {
    var p = document.querySelector('section.measurement-workspace .ms-heading p'); if (!p) return {};
    var sp = p.querySelector('span'), date = sp ? sp.textContent.trim() : ((p.textContent.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || '');
    var site = p.textContent.replace(date, '').trim();
    return { site: site || null, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null };
  }
  var host = null, bar = null, pill = null, sig = '', timer = null, lastFs = null;
  /* 풀스크린 관제(fs-on) 격자: 제목 줄(1행) 가운데 빈 칸에 도구 막대 배치 → 별도 머리 줄 없이 공간 절약 */
  function barEl() {
    var w = ws(); if (!w || !document.documentElement.classList.contains('fs-on')) { if (bar) { bar.remove(); bar = null; } return null; }
    if (!bar) bar = document.createElement('div');
    if (bar.parentNode !== w && !bar.classList.contains('is-inbody')) w.appendChild(bar);
    var em = w.querySelector(':scope > .ms-tabs .ms-embed'); bar.style.marginRight = (em ? em.offsetWidth + 22 : 14) + 'px'; // 「웹뷰 전용 화면」 링크를 가리지 않게
    return bar;
  }
  /* 제목 줄 빈 칸에 맞추기: 그대로 → 줄임(짧은 글자·CSV 숨김) → 그래도 넘치면 대시보드 본문 맨 위로 */
  function barFit(b, hostEl) {
    var w = ws(); if (!w || !b) return;
    b.classList.remove('is-compact', 'is-inbody');
    if (b.parentNode !== w) w.appendChild(b);
    var btns = Array.prototype.filter.call(w.querySelectorAll(':scope > .ms-tabs button'), function (x) { return x.offsetWidth > 0 && !x.closest('.tx-rp-tbar'); }), last = btns[btns.length - 1], em = w.querySelector(':scope > .ms-tabs .ms-embed');
    if (!last) return;
    var avail = (em ? em.getBoundingClientRect().left : w.getBoundingClientRect().right) - last.getBoundingClientRect().right - 40;
    if (b.scrollWidth <= avail) return;
    b.classList.add('is-compact'); if (b.scrollWidth <= avail) return;
    b.classList.remove('is-compact'); b.classList.add('is-inbody'); b.style.marginRight = ''; hostEl.insertBefore(b, hostEl.firstChild);
  }
  /* 요청: 이 화면 상단은 「측정 엑셀 등록」·「풀스크린 관제」만 → 도구 막대·머리 줄 없이, 깔끔한 발주처 보고 모드로 고정 */
  var inst = TX.report2.create({ inline: true, source: 'inspection', meta: meta, noHeader: true, pref: { mode: 'client', theme: 'light' } });

  function ws() { return document.querySelector('section.measurement-workspace'); }
  function isDash(w) { return !!(w && !w.classList.contains('mini-view') && w.querySelector(':scope > .ms-kpis')); }
  function signature() {
    try { var r = TX.data && TX.data.raw && TX.data.raw(); if (!r || !r.rows) return ''; var n = 0; r.rows.forEach(function (x) { n += String(x.판정 || '').length + String(x.측정값 || '').length; }); return r.rows.length + ':' + n; } catch (e) { return ''; }
  }
  function setOn(v) { on = v; sync(true); }
  function removeHost() { document.documentElement.classList.remove('tx-msx-page'); if (bar) { bar.remove(); bar = null; } if (host) { inst.unmount(); host.remove(); host = null; } var w = ws(); if (w) w.classList.remove('tx-msx-on'); }
  function showPill(show) {
    if (show && !pill) {
      pill = document.createElement('div'); pill.className = 'tx-msx-pill';
      pill.innerHTML = '<button type="button">새 점검결과 대시보드로 보기</button>';
      pill.querySelector('button').addEventListener('click', function () { setOn(true); });
      document.body.appendChild(pill);
    } else if (!show && pill) { pill.remove(); pill = null; }
  }
  function sync(force) {
    var w = ws(), dash = isDash(w), fsNow = document.documentElement.classList.contains('fs-on');
    if (fsNow !== lastFs) { lastFs = fsNow; force = true; } // 풀스크린 ↔ 기본 보기 전환 시 도구 막대 위치 다시 계산
    showPill(false);
    if (!dash || !on) { removeHost(); return; }
    w.classList.add('tx-msx-on'); document.documentElement.classList.add('tx-msx-page'); if (bar) { bar.remove(); bar = null; }
    var charts = w.querySelector(':scope > .ms-charts') || w.querySelector(':scope > .ms-kpis');
    if (!host) { host = document.createElement('div'); host.className = 'tx-rp tx-rp-inline'; }
    if (host.previousElementSibling !== charts) charts.parentNode.insertBefore(host, charts.nextSibling);
    var s = signature();
    if (force || s !== sig || !inst.active()) {
      if (s !== sig && sig && TX.data && TX.data.refresh) { try { TX.data.refresh(true); } catch (e) { } } // ADMIN 자료가 바뀌면 트윈 모델 갱신
      sig = s; inst.mountInline(host);
    }
  }
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; sync(false); }, 250); } // 스로틀: 잦은 DOM 변경에도 주기적으로 실행

  function start() {
    var root = document.body; // ADMIN 이 #root 를 다시 만들 수 있어 body 전체 관찰
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) { var t = list[i].target; if (host && (host === t || host.contains(t))) continue; if (bar && (bar === t || bar.contains(t))) continue; if (pill && pill.contains(t)) continue; schedule(); return; } // 내 화면 변경은 무시
    }).observe(root, { childList: true, subtree: true });
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    TX.on('model', function () { if (host && inst.active()) inst.render(); });
    sync(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);

  TX.msdash = { on: function () { setOn(true); }, off: function () { setOn(false); }, active: function () { return !!host; }, sync: function () { sync(true); } };
})();
