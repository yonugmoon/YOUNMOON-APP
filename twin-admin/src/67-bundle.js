/* ============================================================
   TwinX 67-bundle (통합 리드) — 설비 묶음 편집
   같은 층·같은 위치에 같은 장비가 모듈만 여러 개인 경우(예: PA SYSTEM 랙의 앰프 8대)
   → 하나의 묶음(랙)으로 지정해 2D·3D 공간에는 1개로 배치하고, 슬롯 목록에서 모듈을 본다.
   저장: ADMIN 자료는 랙 입력(twinx_rack_v1, bundle:true) · 간이 현행화 초안은 초안 설비의 bundle 필드
   ADMIN 규격 칸의 [묶음:이름] / [묶음:이름:U03-04] 태그도 같은 묶음으로 인식 (00-core applyBundles)
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.bundleEdit) return;
  var U = TX.util, esc = U.esc;
  function toast(m, k) { TX.emit('toast', { msg: m, kind: k || 'info' }); }
  function root() { return (TX.ui && TX.ui.root) || document.body; }
  function quick() { return TX.quick && TX.quick.active && TX.quick.active() ? TX.quick : null; }
  function baseName(s) { return String(s || '').replace(/\s*#\s*\d+\s*$/, '').replace(/\s*\(\d+\)\s*$/, '').trim(); }

  /** 같은 실에서 이름(번호 제외)이 같은 설비 2대 이상 = 묶음 후보 */
  function suggestions(floor) {
    var M = TX.model; if (!M) return [];
    var g = {};
    M.assets.forEach(function (a) {
      if (floor && a.floor !== floor) return;
      if (a.bundle) return;
      var k = (a.room || a.floor) + '|' + baseName(a.name);
      (g[k] = g[k] || []).push(a);
    });
    return Object.keys(g).filter(function (k) { return g[k].length >= 2; }).map(function (k) { var l = g[k]; return { room: l[0].room, floor: l[0].floor, name: baseName(l[0].name), ids: l.map(function (a) { return a.id; }) }; });
  }

  /** 저장: ids → 묶음 이름 / 모듈별 U (null 허용) */
  function save(name, size, mods, removed) {
    var q = quick();
    if (q) {
      var D = q.draft();
      mods.forEach(function (m) { var a = D.assets.find(function (x) { return x.id === m.id; }); if (a) { a.bundle = name; a.u0 = m.u0; a.u1 = m.u1; } });
      (removed || []).forEach(function (id) { var a = D.assets.find(function (x) { return x.id === id; }); if (a) { delete a.bundle; delete a.u0; delete a.u1; } });
      // 묶음은 한 자리: 대표(첫 모듈)가 배치돼 있으면 나머지도 같은 실·좌표로
      var ms = mods.map(function (m) { return D.assets.find(function (x) { return x.id === m.id; }); }).filter(Boolean), lead = ms.slice().sort(function (x, y) { return x.id.localeCompare(y.id); }).find(function (x) { return x.room; }) || null;
      if (lead) ms.forEach(function (a) { a.room = lead.room; a.x = lead.x; a.y = lead.y; });
      q._.save(); q._.apply();
      return;
    }
    var map = {};
    mods.forEach(function (m) { map[m.id] = { name: name, size: size, u0: m.u0, u1: m.u1, face: '전면', bundle: true }; });
    (removed || []).forEach(function (id) { map[id] = null; });
    TX.rack.setMany(map);
  }

  var md = null, ctx = null;
  function close() { if (md) { md.remove(); md = null; } }
  /** id: 기준 설비 (묶음 소속이면 그 묶음 편집, 아니면 새 묶음) */
  function open(id) {
    var M = TX.model, a = TX.asset(id); if (!M || !a) return;
    var pool = M.assets.filter(function (x) { return a.room ? x.room === a.room : x.floor === a.floor; });
    var cur = a.bundle ? a.bundle.ids.slice() : pool.filter(function (x) { return !x.bundle && baseName(x.name) === baseName(a.name); }).map(function (x) { return x.id; });
    if (cur.indexOf(a.id) < 0) cur.unshift(a.id);
    ctx = { id: id, room: a.room, pool: pool, sel: cur, was: a.bundle ? a.bundle.ids.slice() : [], name: a.bundle ? a.bundle.name : baseName(a.name), size: (a.rack && a.rack.size) || 42 };
    if (!md) { md = U.el('div', 'tx-wb-modal tx-bd'); root().appendChild(md); bind(); }
    render();
  }
  function uOf(x) { return x.rack && x.rack.bundle ? [x.rack.u0, x.rack.u1] : quick() ? (function () { var d = TX.quick.draft().assets.find(function (q) { return q.id === x.id; }); return d ? [d.u0, d.u1] : [null, null]; })() : [null, null]; }
  function render() {
    var rm = ctx.room && TX.room(ctx.room);
    var h = '<div class="tx-wb-dlg tx-bd-dlg" role="dialog" aria-modal="true" aria-label="설비 묶음 편집">' +
      '<div class="tx-wb-hd"><div><small>설비 묶음 · 같은 위치의 모듈을 1개로 배치</small><b>' + esc(rm ? rm.name : '같은 층') + ' · 설비 ' + ctx.pool.length + '대</b></div><button type="button" class="tx-wb-x" data-b="close" aria-label="닫기">✕</button></div>' +
      '<div class="tx-wb-body">' +
      '<p class="tx-wb-guide">한 랙(함체)에 들어 있는 모듈을 체크하고 <b>묶음 이름</b>을 정하세요. 2D·3D에는 랙 1개로 표시되고, 설비 상세의 <b>묶음 슬롯</b>에서 모듈별 상태·측정값을 봅니다. U 위치는 알 때만 입력하세요.</p>' +
      '<div class="tx-wb-row2"><label>묶음(랙) 이름<input type="text" data-f="name" value="' + esc(ctx.name) + '" placeholder="예: PA SYSTEM"></label>' +
      '<label>랙 규격<select data-f="size">' + [42, 45, 47, 36, 24, 12].map(function (n) { return '<option value="' + n + '"' + (ctx.size === n ? ' selected' : '') + '>' + n + 'U</option>'; }).join('') + '</select></label></div>' +
      '<div class="tx-bd-tbl"><table><thead><tr><th></th><th>설비</th><th>모델</th><th>U 시작</th><th>U 끝</th></tr></thead><tbody>' +
      ctx.pool.map(function (x) {
        var on = ctx.sel.indexOf(x.id) >= 0, u = uOf(x), other = x.bundle && ctx.was.indexOf(x.id) < 0;
        return '<tr class="' + (on ? 'is-on' : '') + '"><td><input type="checkbox" data-b="pick" data-id="' + esc(x.id) + '"' + (on ? ' checked' : '') + '></td>' +
          '<td><b>' + esc(x.name) + '</b><small>' + esc(x.id) + (other ? ' · 다른 묶음 「' + esc(x.bundle.name) + '」' : '') + '</small></td><td>' + esc(x.model || '—') + '</td>' +
          '<td><input type="number" min="1" max="47" data-u="0" data-id="' + esc(x.id) + '" value="' + (u[0] == null ? '' : u[0]) + '"></td><td><input type="number" min="1" max="47" data-u="1" data-id="' + esc(x.id) + '" value="' + (u[1] == null ? '' : u[1]) + '"></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="tx-wb-msg" data-r="msg"></p></div>' +
      '<div class="tx-wb-ft"><div class="tx-wb-ft-l">' + (ctx.was.length ? '<button type="button" class="tx-wb-link tx-wb-danger" data-b="unbundle">묶음 해제</button>' : '') + '</div>' +
      '<div><button type="button" class="tx-wb-btn" data-b="close">취소</button><button type="button" class="tx-wb-btn tx-wb-pri" data-b="save">묶음 저장</button></div></div></div>';
    md.innerHTML = h;
  }
  function bind() {
    md.addEventListener('click', function (e) {
      if (e.target === md) { close(); return; }
      var b = e.target.closest('[data-b]'); if (!b) return;
      var a = b.getAttribute('data-b');
      if (a === 'close') close();
      else if (a === 'pick') { var id = b.getAttribute('data-id'), i = ctx.sel.indexOf(id); if (b.checked && i < 0) ctx.sel.push(id); else if (!b.checked && i >= 0) ctx.sel.splice(i, 1); b.closest('tr').classList.toggle('is-on', b.checked); }
      else if (a === 'unbundle') { if (!confirm('「' + ctx.name + '」 묶음을 해제할까요? 모듈은 각각 따로 표시됩니다.')) return; save(ctx.name, ctx.size, [], ctx.was); close(); toast('묶음을 해제했습니다', 'info'); }
      else if (a === 'save') doSave();
    });
    md.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  }
  function doSave() {
    var name = md.querySelector('[data-f="name"]').value.trim(), size = +md.querySelector('[data-f="size"]').value || 42, msg = md.querySelector('[data-r="msg"]');
    if (!name) { msg.textContent = '묶음 이름을 입력하세요'; return; }
    if (ctx.sel.length < 2) { msg.textContent = '모듈을 2개 이상 체크하세요'; return; }
    var mods = ctx.sel.map(function (id) {
      var g = function (k) { var i = md.querySelector('[data-u="' + k + '"][data-id="' + CSS.escape(id) + '"]'); var v = i && i.value !== '' ? parseInt(i.value, 10) : null; return v; };
      var u0 = g(0), u1 = g(1); if (u0 != null && u1 == null) u1 = u0; if (u0 != null && u1 != null && u0 > u1) { var t = u0; u0 = u1; u1 = t; }
      return { id: id, u0: u0, u1: u1 };
    });
    var bad = mods.filter(function (m) { return m.u0 != null && (m.u0 < 1 || m.u1 > size); });
    if (bad.length) { msg.textContent = 'U 위치가 랙 규격(' + size + 'U)을 벗어난 모듈이 있습니다'; return; }
    var removed = ctx.was.filter(function (id) { return ctx.sel.indexOf(id) < 0; });
    save(name, size, mods, removed);
    close();
    toast('「' + name + '」 묶음 저장 · 모듈 ' + mods.length + '개 → 도면에는 1개로 표시', 'success');
    var lead = mods.map(function (m) { return m.id; }).sort()[0];
    setTimeout(function () { if (TX.asset(lead)) TX.select(lead); }, 120);
  }

  /** 이 층 자동 묶기 제안 → 한 번에 저장 */
  function autoBundle(floor) {
    var sg = suggestions(floor);
    if (!sg.length) { toast('이 층에는 묶을 후보(같은 실 · 같은 이름 2대 이상)가 없습니다', 'info'); return 0; }
    if (!confirm('같은 실에 같은 이름의 설비가 여러 대인 ' + sg.length + '개 그룹을 묶음으로 만들까요?\n\n' + sg.map(function (g) { return '· ' + g.name + ' (' + g.ids.length + '개)'; }).join('\n'))) return 0;
    sg.forEach(function (g) { save(g.name, 42, g.ids.map(function (id) { return { id: id, u0: null, u1: null }; }), []); });
    toast('묶음 ' + sg.length + '개를 만들었습니다', 'success');
    return sg.length;
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="bundle-edit"]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation(); open(b.getAttribute('data-id'));
  }, true);

  TX.bundleEdit = { open: open, close: close, suggestions: suggestions, auto: autoBundle, save: save };
})();
