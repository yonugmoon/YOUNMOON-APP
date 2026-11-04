/* ============================================================
   TwinX 60-workbench (통합 리드) — 현행화 작업 도구
   1) 랙·U 입력 : 인스펙터 「랙 · U」 → 편집 모달 (랙 입면 미리보기·중복 U 경고)
      저장소 localStorage 'twinx_rack_v1' {설비ID:{name,size,u0,u1,face,at}} → 10-data가 v14 시범값보다 우선 적용
   2) CAD 배경 겹쳐 보기 : 층별 평면도 이미지(PNG/JPG/SVG) 업로드 → 2D 도면 아래 · 3D 바닥 텍스처에 투영
      2점 맞춤(이미지 기준점 → 실제 위치) · 투명도 · 다크 반전 · 미세 조정 · IndexedDB 'twinx_underlay_v1' 저장
   * 모두 이 브라우저에만 저장됩니다(ADMIN 이관 ZIP에는 포함되지 않음 → 내보내기/가져오기 제공).
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.underlay) return;
  var U = TX.util, esc = U.esc;

  function toast(msg, kind) { TX.emit('toast', { msg: msg, kind: kind || 'info' }); }
  function root() { return (TX.ui && TX.ui.root) || document.body; }

  /* =========================================================
     1. 랙·U 입력
     ========================================================= */
  var RACK_KEY = 'twinx_rack_v1';
  function rackStore() { try { return JSON.parse(localStorage.getItem(RACK_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function rackSave(o) { try { localStorage.setItem(RACK_KEY, JSON.stringify(o)); return true; } catch (e) { toast('브라우저 저장공간에 저장하지 못했습니다', 'error'); return false; } }
  function reloadModel() {
    if (TX.data && TX.data.refresh) { TX.data.refresh(true); return; }
    // 데이터 모듈이 없는 시험 환경: 현재 모델에 직접 반영
    var st = rackStore();
    (TX.model && TX.model.assets || []).forEach(function (a) {
      var r = st[a.id]; if (!r) return;
      if (!r.name) delete a.rack; else a.rack = { name: r.name, u: r.u0 + 'U~' + r.u1 + 'U', u0: r.u0, u1: r.u1, size: r.size, face: r.face, source: 'user' };
    });
    if (TX.model) TX.setModel(TX.model);
  }

  TX.rack = {
    all: rackStore,
    get: function (id) { return rackStore()[id] || null; },
    set: function (id, v) {
      var st = rackStore();
      st[id] = { name: String(v.name || '').trim(), size: +v.size || 42, u0: v.u0 == null ? null : +v.u0, u1: v.u1 == null ? null : +v.u1, face: v.face || '전면', at: new Date().toISOString() };
      if (rackSave(st)) reloadModel();
    },
    remove: function (id) { var st = rackStore(); delete st[id]; if (rackSave(st)) reloadModel(); },
    exportJSON: function () {
      var blob = new Blob([JSON.stringify({ _twinxRack: 1, exportedAt: new Date().toISOString(), site: TX.model && TX.model.site, racks: rackStore() }, null, 1)], { type: 'application/json' });
      U.download(blob, 'TwinX_랙입력_' + U.today() + '.json');
    },
    importJSON: function (text) {
      var d = JSON.parse(text);
      if (!d || !d._twinxRack || typeof d.racks !== 'object') throw new Error('TwinX 랙 입력 파일이 아닙니다');
      var st = rackStore(); Object.keys(d.racks).forEach(function (k) { st[k] = d.racks[k]; });
      if (rackSave(st)) reloadModel();
      return Object.keys(d.racks).length;
    }
  };

  /* 같은 랙에 실장된 다른 설비 (모델 기준) */
  function rackMates(name, exceptId) {
    return (TX.model ? TX.model.assets : []).filter(function (a) { return a.id !== exceptId && a.rack && a.rack.name === name && a.rack.u0 != null; });
  }
  function rackNames(floor) {
    var seen = {}, out = [];
    (TX.model ? TX.model.assets : []).forEach(function (a) { if (a.rack && a.rack.name && !seen[a.rack.name]) { seen[a.rack.name] = 1; out.push({ name: a.rack.name, floor: a.floor }); } });
    out.sort(function (x, y) { return (x.floor === floor ? 0 : 1) - (y.floor === floor ? 0 : 1) || x.name.localeCompare(y.name); });
    return out;
  }

  function rackPreviewSVG(size, u0, u1, mates, curName) {
    var H = 300, top = 8, slot = (H - top * 2) / size, W = 150, x0 = 34, rw = 100;
    var o = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="tx-wb-rack">'];
    o.push('<rect x="' + (x0 - 4) + '" y="' + (top - 4) + '" width="' + (rw + 8) + '" height="' + (H - top * 2 + 8) + '" rx="4" fill="#1f2937"/>');
    for (var u = 1; u <= size; u++) {
      var y = top + (size - u) * slot;
      o.push('<rect x="' + x0 + '" y="' + y.toFixed(1) + '" width="' + rw + '" height="' + (slot - 0.6).toFixed(1) + '" fill="#0f172a"/>');
      if (u % 5 === 0 || u === 1) o.push('<text x="' + (x0 - 7) + '" y="' + (y + slot * 0.75).toFixed(1) + '" text-anchor="end" font-size="8" fill="#94a3b8">' + u + '</text>');
    }
    var conflict = false;
    mates.forEach(function (m) {
      var a0 = Math.max(1, m.rack.u0), a1 = Math.min(size, m.rack.u1 == null ? m.rack.u0 : m.rack.u1);
      var hit = u0 != null && u1 != null && !(u1 < a0 || u0 > a1);
      if (hit) conflict = true;
      o.push('<rect x="' + (x0 + 2) + '" y="' + (top + (size - a1) * slot + 0.5).toFixed(1) + '" width="' + (rw - 4) + '" height="' + ((a1 - a0 + 1) * slot - 1.5).toFixed(1) + '" rx="1.5" fill="' + (hit ? '#7f1d1d' : '#334155') + '" stroke="' + (hit ? '#f43f5e' : '#64748b') + '"/>' +
        '<text x="' + (x0 + rw / 2) + '" y="' + (top + (size - (a0 + a1) / 2) * slot + 3).toFixed(1) + '" text-anchor="middle" font-size="7.5" fill="#e2e8f0">' + esc(m.id) + '</text>');
    });
    if (u0 != null && u1 != null && u0 >= 1 && u1 <= size && u0 <= u1) {
      o.push('<rect x="' + (x0 + 1) + '" y="' + (top + (size - u1) * slot).toFixed(1) + '" width="' + (rw - 2) + '" height="' + ((u1 - u0 + 1) * slot - 0.6).toFixed(1) + '" rx="2" fill="#3e63db" fill-opacity="0.85" stroke="#93c5fd" stroke-width="1.4"/>' +
        '<text x="' + (x0 + rw / 2) + '" y="' + (top + (size - (u0 + u1) / 2) * slot + 3).toFixed(1) + '" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">이 설비</text>');
    }
    o.push('<text x="' + (x0 + rw / 2) + '" y="' + (H - 0.5) + '" text-anchor="middle" font-size="8" fill="#64748b">' + esc(curName || '랙') + ' · ' + size + 'U</text></svg>');
    return { svg: o.join(''), conflict: conflict };
  }

  var modal = null;
  function closeModal() { if (modal) { modal.remove(); modal = null; } }
  function openRackEditor(id) {
    var a = TX.asset(id); if (!a) return;
    closeModal();
    var cur = TX.rack.get(id) || (a.rack ? { name: a.rack.name, size: a.rack.size || 42, u0: a.rack.u0, u1: a.rack.u1, face: a.rack.face || '전면' } : { name: '', size: 42, u0: null, u1: null, face: '전면' });
    var names = rackNames(a.floor);
    modal = U.el('div', 'tx-wb-modal');
    modal.innerHTML =
      '<div class="tx-wb-dlg" role="dialog" aria-modal="true" aria-label="랙·U 위치 입력">' +
        '<div class="tx-wb-hd"><div><small>랙 실장 위치 입력 · 현장 현행화</small><b>' + esc(a.name) + ' <span class="tx-wb-id">' + esc(a.id) + '</span></b></div><button type="button" class="tx-wb-x" data-wb="close" aria-label="닫기">✕</button></div>' +
        '<div class="tx-wb-body tx-wb-cols">' +
          '<div class="tx-wb-form">' +
            '<label>랙 이름<input type="text" data-f="name" list="tx-wb-racks" placeholder="예: MDF실 Main Rack #1" value="' + esc(cur.name || '') + '"></label>' +
            '<datalist id="tx-wb-racks">' + names.map(function (n) { return '<option value="' + esc(n.name) + '">'; }).join('') + '</datalist>' +
            '<div class="tx-wb-row"><label>랙 규격<select data-f="size">' + [42, 45, 47, 36, 24, 12, 6].map(function (n) { return '<option value="' + n + '"' + ((+cur.size || 42) === n ? ' selected' : '') + '>' + n + 'U</option>'; }).join('') + '</select></label>' +
              '<label>실장면<select data-f="face"><option' + (cur.face !== '후면' ? ' selected' : '') + '>전면</option><option' + (cur.face === '후면' ? ' selected' : '') + '>후면</option></select></label></div>' +
            '<div class="tx-wb-row"><label>시작 U (하단)<input type="number" min="1" max="47" data-f="u0" value="' + (cur.u0 == null ? '' : cur.u0) + '"></label>' +
              '<label>끝 U (상단)<input type="number" min="1" max="47" data-f="u1" value="' + (cur.u1 == null ? '' : cur.u1) + '"></label></div>' +
            '<p class="tx-wb-msg" data-r="msg"></p>' +
            '<p class="tx-wb-help">랙 맨 아래가 1U입니다. 같은 랙 이름의 다른 설비와 U가 겹치면 붉게 표시됩니다. 입력값은 시범값보다 우선하며 2D 인스펙터·3D 시안 B(룸·랙 투시)에 바로 반영됩니다.</p>' +
          '</div>' +
          '<div class="tx-wb-prev" data-r="prev"></div>' +
        '</div>' +
        '<div class="tx-wb-ft">' +
          '<div class="tx-wb-ft-l"><button type="button" class="tx-wb-link" data-wb="rk-export">랙 입력 내보내기</button><button type="button" class="tx-wb-link" data-wb="rk-import">가져오기</button>' +
            (TX.rack.get(id) ? '<button type="button" class="tx-wb-link tx-wb-danger" data-wb="rk-reset">입력 지우기</button>' : '') + '</div>' +
          '<div><button type="button" class="tx-wb-btn" data-wb="close">취소</button><button type="button" class="tx-wb-btn tx-wb-pri" data-wb="rk-save">저장</button></div>' +
        '</div>' +
      '</div>';
    root().appendChild(modal);
    var f = function (k) { return modal.querySelector('[data-f="' + k + '"]'); };
    function readForm() {
      var u0 = f('u0').value === '' ? null : parseInt(f('u0').value, 10), u1 = f('u1').value === '' ? null : parseInt(f('u1').value, 10);
      if (u0 != null && u1 == null) u1 = u0;
      return { name: f('name').value.trim(), size: parseInt(f('size').value, 10), face: f('face').value, u0: u0, u1: u1 };
    }
    function refresh() {
      var v = readForm(), msg = modal.querySelector('[data-r="msg"]'), err = '';
      if (v.u0 != null && (v.u0 < 1 || v.u1 > v.size || v.u0 > v.u1)) err = 'U 범위가 올바르지 않습니다 (1 ~ ' + v.size + ', 시작 ≤ 끝).';
      var p = rackPreviewSVG(v.size, err ? null : v.u0, err ? null : v.u1, v.name ? rackMates(v.name, id) : [], v.name);
      modal.querySelector('[data-r="prev"]').innerHTML = p.svg;
      msg.textContent = err || (p.conflict ? '⚠ 같은 랙의 다른 설비와 U 위치가 겹칩니다. 현장 실장 상태를 확인하세요.' : (v.name && v.u0 != null ? v.name + ' · ' + v.u0 + 'U~' + v.u1 + 'U (' + (v.u1 - v.u0 + 1) + 'U)' : '랙 이름과 U 위치를 입력하세요.'));
      msg.className = 'tx-wb-msg' + (err ? ' is-err' : p.conflict ? ' is-warn' : '');
      return !err;
    }
    modal.addEventListener('input', refresh);
    modal.addEventListener('change', refresh);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) { closeModal(); return; }
      var b = e.target.closest('[data-wb]'); if (!b) return;
      var act = b.getAttribute('data-wb');
      if (act === 'close') closeModal();
      else if (act === 'rk-save') {
        if (!refresh()) return;
        var v = readForm();
        if (!v.name) { toast('랙 이름을 입력하세요', 'warn'); return; }
        TX.rack.set(id, v); closeModal(); toast('랙 실장 위치를 저장했습니다 · ' + v.name + (v.u0 != null ? ' ' + v.u0 + 'U~' + v.u1 + 'U' : ''), 'success');
      } else if (act === 'rk-reset') { TX.rack.remove(id); closeModal(); toast('현장 입력을 지웠습니다 (시범값/미등록으로 복귀)', 'info'); }
      else if (act === 'rk-export') TX.rack.exportJSON();
      else if (act === 'rk-import') pickFile('application/json', function (file) {
        file.text().then(function (t) { try { var n = TX.rack.importJSON(t); toast('랙 입력 ' + n + '건을 가져왔습니다', 'success'); closeModal(); } catch (err) { toast('가져오기 실패: ' + err.message, 'error'); } });
      });
    });
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } });
    refresh();
    setTimeout(function () { f('name').focus(); }, 30);
  }

  function pickFile(accept, cb) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
    inp.addEventListener('change', function () { var file = inp.files && inp.files[0]; inp.remove(); if (file) cb(file); });
    document.body.appendChild(inp); inp.click();
  }

  /* =========================================================
     2. CAD 배경 겹쳐 보기
     ========================================================= */
  var DB_NAME = 'twinx_underlay_v1', STORE = 'u';
  var mem = {}; // key → {floor, key, name, blob, url, dataURL, img, w, h, tf:{s,rot,tx,ty}, opacity, show, invert, at}
  function keyOf(code) {
    var f = TX.floor(code);
    return ((f && f.building) || (TX.model && TX.model.site && TX.model.site.name) || '') + '|' + code;
  }
  function idb() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('IndexedDB 미지원'));
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'key' }); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function dbPut(rec) {
    var o = { key: rec.key, floor: rec.floor, name: rec.name, blob: rec.blob, w: rec.w, h: rec.h, tf: rec.tf, opacity: rec.opacity, show: rec.show, invert: rec.invert, at: rec.at };
    return idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(o); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); })
      .catch(function (e) { toast('배경을 저장하지 못했습니다: ' + e.message, 'error'); });
  }
  function dbDel(key) { return idb().then(function (db) { db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); }).catch(function () { }); }
  function dbAll() { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); q.onsuccess = function () { res(q.result || []); }; q.onerror = function () { res([]); }; }); }).catch(function () { return []; }); }
  function blobToDataURL(b) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(b); }); }

  function hydrate(rec) {
    rec.url = URL.createObjectURL(rec.blob);
    var img = new Image();
    img.onload = function () { rec.img = img; TX.emit('underlay', { floor: rec.floor }); };
    img.src = rec.url;
    blobToDataURL(rec.blob).then(function (d) { rec.dataURL = d; });
    mem[rec.key] = rec;
    return rec;
  }
  dbAll().then(function (list) { list.forEach(hydrate); if (list.length) TX.emit('underlay', { floor: null }); });

  TX.underlay = {
    get: function (code) { return code ? mem[keyOf(code)] || null : null; },
    image: function (code) { var r = this.get(code); return r && r.img ? r.img : null; },
    list: function () { return Object.keys(mem).map(function (k) { return mem[k]; }); },
    update: function (code, patch) {
      var r = this.get(code); if (!r) return;
      Object.keys(patch).forEach(function (k) { r[k] = k === 'tf' ? Object.assign({}, r.tf, patch.tf) : patch[k]; });
      r.at = new Date().toISOString();
      TX.emit('underlay', { floor: code }); saveSoon(r);
    },
    remove: function (code) {
      var r = this.get(code); if (!r) return;
      if (r.url) URL.revokeObjectURL(r.url);
      delete mem[r.key]; dbDel(r.key); TX.emit('underlay', { floor: code });
    },
    fitToFloor: function (code) {
      var r = this.get(code), f = TX.floor(code); if (!r || !f || !f.bounds) return;
      var b = f.bounds, s = Math.min((b.x1 - b.x0) / r.w, (b.y1 - b.y0) / r.h);
      this.update(code, { tf: { s: s, rot: 0, tx: b.x0 + ((b.x1 - b.x0) - r.w * s) / 2, ty: b.y0 + ((b.y1 - b.y0) - r.h * s) / 2 } });
    },
    load: function (code, file) { return loadFile(code, file); }
  };
  var saveTimers = {};
  function saveSoon(r) { clearTimeout(saveTimers[r.key]); saveTimers[r.key] = setTimeout(function () { dbPut(r); }, 400); }

  function loadFile(code, file) {
    var nm = file.name || '', type = file.type || '';
    if (/\.pdf$/i.test(nm) || type === 'application/pdf') { toast('PDF는 바로 올릴 수 없습니다. PDF 뷰어/CAD에서 해당 층을 PNG(300dpi 이상)로 내보낸 뒤 올려 주세요.', 'warn'); return Promise.resolve(false); }
    if (/\.(dwg|dxf)$/i.test(nm)) { toast('DWG/DXF는 CAD에서 「PNG/JPG로 플롯(내보내기)」한 뒤 올려 주세요.', 'warn'); return Promise.resolve(false); }
    if (!/^image\//.test(type) && !/\.(png|jpe?g|webp|svg|gif|bmp)$/i.test(nm)) { toast('이미지 파일(PNG·JPG·SVG)만 올릴 수 있습니다', 'warn'); return Promise.resolve(false); }
    return new Promise(function (res) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || 2000, h = img.naturalHeight || 1400, MAX = 4096, k = Math.min(1, MAX / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
        var c = document.createElement('canvas'); c.width = cw; c.height = ch;
        var g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, cw, ch); g.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(u);
        var mime = /jpe?g/i.test(type) ? 'image/jpeg' : 'image/png';
        c.toBlob(function (blob) {
          if (!blob) { toast('이미지를 처리하지 못했습니다', 'error'); return res(false); }
          var old = TX.underlay.get(code); if (old) TX.underlay.remove(code);
          var rec = hydrate({ key: keyOf(code), floor: code, name: nm, blob: blob, w: cw, h: ch, tf: { s: 10, rot: 0, tx: 0, ty: 0 }, opacity: 0.55, show: true, invert: true, at: new Date().toISOString() });
          TX.underlay.fitToFloor(code);
          dbPut(rec);
          toast('도면 배경을 올렸습니다 · 「2점 맞춤」으로 실제 위치에 정렬하세요', 'success');
          res(true);
        }, mime, 0.92);
      };
      img.onerror = function () { URL.revokeObjectURL(u); toast('이미지를 열 수 없습니다', 'error'); res(false); };
      img.src = u;
    });
  }

  /* ---------- 도면 배경 패널 ---------- */
  var panel = null;
  function curFloor() { return TX.state.floor || (TX.model && TX.model.floors[0] && TX.model.floors[0].code); }
  function floorName(code) { var f = TX.floor(code); return f ? f.name : code; }
  function togglePanel(force) {
    var open = force != null ? force : !panel;
    if (!open) { if (panel) panel.remove(); panel = null; stopCalib(); return; }
    if (!panel) { panel = U.el('div', 'tx-wb-panel'); root().appendChild(panel); bindPanel(); }
    renderPanel();
  }
  function renderPanel() {
    if (!panel) return;
    var code = curFloor(), r = TX.underlay.get(code);
    var deg = r ? Math.round(r.tf.rot * 180 / Math.PI * 10) / 10 : 0;
    panel.innerHTML =
      '<div class="tx-wb-hd"><div><small>CAD 배경 겹쳐 보기</small><b>' + esc(floorName(code)) + ' 도면 배경</b></div><button type="button" class="tx-wb-x" data-wb="pclose" aria-label="닫기">✕</button></div>' +
      '<div class="tx-wb-body">' +
      (!r ? (
        '<div class="tx-wb-drop" data-wb="upload" tabindex="0"><b>평면도 이미지 올리기</b><span>PNG · JPG · SVG (끌어다 놓기 가능)</span></div>' +
        '<p class="tx-wb-help">CAD(DWG)·PDF 도면은 해당 층을 <b>PNG로 내보낸 뒤</b> 올려 주세요(300dpi 이상, 축척 표기 포함 권장). 올린 이미지는 층 외곽에 자동으로 맞춰지며, 「2점 맞춤」으로 정확히 정렬합니다. 이 브라우저에만 저장됩니다.</p>'
      ) : (
        '<div class="tx-wb-file"><b title="' + esc(r.name) + '">' + esc(r.name || '도면 이미지') + '</b><span>' + r.w + '×' + r.h + 'px · 1px = ' + r.tf.s.toFixed(1) + 'mm</span></div>' +
        '<div class="tx-wb-tg"><label><input type="checkbox" data-u="show"' + (r.show ? ' checked' : '') + '> 배경 표시</label><label><input type="checkbox" data-u="invert"' + (r.invert ? ' checked' : '') + '> 2D 다크 반전</label></div>' +
        '<label class="tx-wb-rng">투명도 <input type="range" min="10" max="100" step="5" data-u="opacity" value="' + Math.round(r.opacity * 100) + '"><output>' + Math.round(r.opacity * 100) + '%</output></label>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn tx-wb-pri" data-wb="calib">2점 맞춤</button><button type="button" class="tx-wb-btn" data-wb="fit">층 외곽에 맞춤</button><button type="button" class="tx-wb-btn" data-wb="rot90">90° 회전</button></div>' +
        '<details class="tx-wb-fine"><summary>미세 조정 (mm)</summary><div class="tx-wb-grid">' +
          '<label>X 위치<input type="number" step="10" data-t="tx" value="' + Math.round(r.tf.tx) + '"></label>' +
          '<label>Y 위치<input type="number" step="10" data-t="ty" value="' + Math.round(r.tf.ty) + '"></label>' +
          '<label>축척 (mm/px)<input type="number" step="0.1" min="0.01" data-t="s" value="' + r.tf.s.toFixed(3) + '"></label>' +
          '<label>회전 (°)<input type="number" step="0.5" data-t="rot" value="' + deg + '"></label>' +
        '</div></details>' +
        '<div class="tx-wb-acts tx-wb-acts-2"><button type="button" class="tx-wb-link" data-wb="upload">다른 이미지로 교체</button><button type="button" class="tx-wb-link tx-wb-danger" data-wb="remove">배경 삭제</button></div>' +
        '<p class="tx-wb-help"><b>2점 맞춤</b>: 배경 이미지의 기준점(기둥·벽 모서리) → 그 점의 실제 위치(도면의 실 경계·그리드)를 차례로 클릭, 서로 멀리 떨어진 두 점으로 2회 반복합니다. 축척·회전·위치가 자동 계산됩니다.</p>'
      )) +
      '</div>';
  }
  function bindPanel() {
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-wb]'); if (!b) return;
      var act = b.getAttribute('data-wb'), code = curFloor();
      if (act === 'pclose') togglePanel(false);
      else if (act === 'upload') pickFile('image/*,.svg,.pdf,.dwg,.dxf', function (file) { loadFile(code, file).then(renderPanel); });
      else if (act === 'fit') { TX.underlay.fitToFloor(code); renderPanel(); }
      else if (act === 'rot90') { var r = TX.underlay.get(code); if (r) rotateAboutCenter(code, Math.PI / 2); renderPanel(); }
      else if (act === 'remove') { if (confirm(floorName(code) + ' 도면 배경을 삭제할까요?')) { TX.underlay.remove(code); renderPanel(); } }
      else if (act === 'calib') startCalib();
    });
    panel.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tx-wb-drop')) { e.preventDefault(); e.target.click(); } if (e.key === 'Escape') { e.stopPropagation(); togglePanel(false); } });
    panel.addEventListener('input', function (e) {
      var code = curFloor(), t = e.target;
      if (t.dataset.u === 'opacity') { TX.underlay.update(code, { opacity: +t.value / 100 }); var o = t.parentNode.querySelector('output'); if (o) o.textContent = t.value + '%'; }
    });
    panel.addEventListener('change', function (e) {
      var code = curFloor(), t = e.target;
      if (t.dataset.u === 'show') TX.underlay.update(code, { show: t.checked });
      else if (t.dataset.u === 'invert') TX.underlay.update(code, { invert: t.checked });
      else if (t.dataset.t) {
        var v = parseFloat(t.value); if (!isFinite(v)) return;
        var p = {}; p[t.dataset.t] = t.dataset.t === 'rot' ? v * Math.PI / 180 : t.dataset.t === 's' ? Math.max(0.001, v) : v;
        TX.underlay.update(code, { tf: p }); renderPanel();
      }
    });
    panel.addEventListener('dragover', function (e) { e.preventDefault(); panel.classList.add('is-drag'); });
    panel.addEventListener('dragleave', function () { panel.classList.remove('is-drag'); });
    panel.addEventListener('drop', function (e) {
      e.preventDefault(); panel.classList.remove('is-drag');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (file) loadFile(curFloor(), file).then(renderPanel);
    });
  }
  function rotateAboutCenter(code, d) {
    var r = TX.underlay.get(code), t = r.tf;
    var cx = r.w / 2, cy = r.h / 2, c = Math.cos(t.rot), s = Math.sin(t.rot);
    var mx = t.tx + t.s * (c * cx - s * cy), my = t.ty + t.s * (s * cx + c * cy); // 이미지 중심의 mm 위치 유지
    var nr = t.rot + d, nc = Math.cos(nr), ns = Math.sin(nr);
    TX.underlay.update(code, { tf: { rot: nr, tx: mx - t.s * (nc * cx - ns * cy), ty: my - t.s * (ns * cx + nc * cy) } });
  }

  /* ---------- 2점 맞춤 ---------- */
  var cal = null;
  var STEP_TXT = ['① 배경 이미지에서 기준점 1(기둥·벽 모서리)을 클릭하세요', '② 그 점이 있어야 할 실제 위치를 도면에서 클릭하세요', '③ 멀리 떨어진 기준점 2를 배경 이미지에서 클릭하세요', '④ 기준점 2의 실제 위치를 도면에서 클릭하세요'];
  function imgPxOf(r, mm) { // mm → 이미지 px (현재 변환의 역)
    var t = r.tf, dx = mm.x - t.tx, dy = mm.y - t.ty, c = Math.cos(-t.rot), s = Math.sin(-t.rot);
    return { x: (c * dx - s * dy) / t.s, y: (s * dx + c * dy) / t.s };
  }
  function startCalib() {
    var code = curFloor(); if (!TX.underlay.get(code)) return;
    if (!TX.cad2d || !TX.cad2d.screenToMm) { toast('2D 도면 모듈이 없어 맞춤을 할 수 없습니다', 'error'); return; }
    if (TX.state.view === '3d') TX.setState({ view: '2d' });
    stopCalib();
    var host = TX.ui && TX.ui.view2d; if (!host) return;
    cal = { code: code, step: 0, pts: [], host: host, marks: [], down: null };
    cal.bar = U.el('div', 'tx-wb-calbar');
    cal.bar.innerHTML = '<b data-r="step"></b><span>휠 확대 · 드래그 이동 가능</span><button type="button" data-wb="calcancel">취소</button>';
    host.appendChild(cal.bar);
    cal.bar.querySelector('[data-wb="calcancel"]').onclick = function () { stopCalib(); toast('2점 맞춤을 취소했습니다', 'info'); };
    host.classList.add('tx-wb-calib');
    if (panel) panel.style.display = 'none'; // 패널이 도면 일부를 가리지 않도록 맞춤 중에는 숨김
    cal.onDown = function (e) { cal.down = { x: e.clientX, y: e.clientY }; };
    cal.onClick = function (e) {
      if (cal.bar.contains(e.target)) return;
      e.stopPropagation(); e.preventDefault();
      if (cal.down && Math.abs(e.clientX - cal.down.x) + Math.abs(e.clientY - cal.down.y) > 5) return; // 드래그(팬)는 무시
      var mm = TX.cad2d.screenToMm(e.clientX, e.clientY); if (!mm) return;
      cal.pts.push(mm); mark(e.clientX, e.clientY, cal.step % 2 === 0 ? 'src' : 'dst', Math.floor(cal.step / 2) + 1);
      cal.step++;
      if (cal.step >= 4) finishCalib(); else stepText();
    };
    host.addEventListener('pointerdown', cal.onDown, true);
    host.addEventListener('click', cal.onClick, true);
    stepText();
  }
  function stepText() { if (cal) cal.bar.querySelector('[data-r="step"]').textContent = STEP_TXT[cal.step]; }
  function mark(cx, cy, kind, n) {
    var hr = cal.host.getBoundingClientRect(), m = U.el('div', 'tx-wb-mark tx-wb-mark-' + kind, String(n));
    m.style.left = (cx - hr.left) + 'px'; m.style.top = (cy - hr.top) + 'px';
    cal.host.appendChild(m); cal.marks.push(m);
  }
  function finishCalib() {
    var r = TX.underlay.get(cal.code), P = cal.pts;
    var p1 = imgPxOf(r, P[0]), q1 = P[1], p2 = imgPxOf(r, P[2]), q2 = P[3];
    var dpx = p2.x - p1.x, dpy = p2.y - p1.y, dqx = q2.x - q1.x, dqy = q2.y - q1.y;
    var lp = Math.hypot(dpx, dpy), lq = Math.hypot(dqx, dqy);
    var code = cal.code;
    stopCalib();
    if (lp < 2 || lq < 50) { toast('두 기준점이 너무 가깝습니다. 멀리 떨어진 두 점으로 다시 해 주세요.', 'warn'); return; }
    var s = lq / lp, rot = Math.atan2(dqy, dqx) - Math.atan2(dpy, dpx);
    var c = Math.cos(rot), sn = Math.sin(rot);
    var tx = q1.x - s * (c * p1.x - sn * p1.y), ty = q1.y - s * (sn * p1.x + c * p1.y);
    TX.underlay.update(code, { tf: { s: s, rot: rot, tx: tx, ty: ty } });
    renderPanel();
    toast('2점 맞춤 완료 · 축척 1px=' + s.toFixed(2) + 'mm · 회전 ' + (rot * 180 / Math.PI).toFixed(1) + '°', 'success');
  }
  function stopCalib() {
    if (!cal) return;
    cal.host.removeEventListener('pointerdown', cal.onDown, true);
    cal.host.removeEventListener('click', cal.onClick, true);
    cal.host.classList.remove('tx-wb-calib');
    cal.bar.remove(); cal.marks.forEach(function (m) { m.remove(); });
    if (panel) panel.style.display = '';
    cal = null;
  }

  /* ---------- 진입점 (셸 버튼 · 인스펙터 버튼) ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="rack-edit"],[data-act="underlay"]');
    if (!b) return;
    if (b.getAttribute('data-act') === 'rack-edit') openRackEditor(b.getAttribute('data-id'));
    else togglePanel();
  });
  TX.on('state', function (p) {
    var ch = (p && p.changed) || [];
    if (ch.indexOf('floor') >= 0) { stopCalib(); renderPanel(); }
  });
  TX.on('close', function () { togglePanel(false); closeModal(); });
  TX.on('model', function () { if (panel) renderPanel(); });

  TX.workbench = { openRackEditor: openRackEditor, toggleUnderlayPanel: togglePanel, startCalibration: startCalib };
})();
