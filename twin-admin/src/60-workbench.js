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

  /* =========================================================
     3. 구조 편집: 문 · 케이블 트레이 · EPS 라이저 직접 등록
        localStorage 'twinx_geom_v1' {doors:{실ID:{side,at,w}}, trays:{층코드:[{a,b,main,path}]}, risers:[{id,name,x,y,floors}]}
        → 10-data가 추정값보다 우선 적용 (트레이: 층 단위 교체, 라이저: 하나라도 있으면 전체 교체)
     ========================================================= */
  var GEOM_KEY = 'twinx_geom_v1';
  function geomStore() { try { var g = JSON.parse(localStorage.getItem(GEOM_KEY) || '{}') || {}; g.doors = g.doors || {}; g.trays = g.trays || {}; g.risers = g.risers || []; return g; } catch (e) { return { doors: {}, trays: {}, risers: [] }; } }
  function geomSave(g) { try { localStorage.setItem(GEOM_KEY, JSON.stringify(g)); reloadModel(); return true; } catch (e) { toast('브라우저 저장공간에 저장하지 못했습니다', 'error'); return false; } }
  var SIDE_NAME = { N: '북측', S: '남측', E: '동측', W: '서측', none: '문 없음' };

  TX.geom = {
    all: geomStore,
    setDoor: function (roomId, d) { var g = geomStore(); g.doors[roomId] = d; geomSave(g); },
    clearDoor: function (roomId) { var g = geomStore(); delete g.doors[roomId]; geomSave(g); },
    addTrayPath: function (floor, pts, main) {
      var g = geomStore(), path = 'P' + Date.now().toString(36), list = g.trays[floor] = g.trays[floor] || [];
      for (var i = 1; i < pts.length; i++) list.push({ a: pts[i - 1], b: pts[i], main: !!main, path: path });
      geomSave(g); return path;
    },
    removeTrayPath: function (floor, path) { var g = geomStore(); g.trays[floor] = (g.trays[floor] || []).filter(function (t) { return t.path !== path; }); if (!g.trays[floor].length) delete g.trays[floor]; geomSave(g); },
    clearTrays: function (floor) { var g = geomStore(); delete g.trays[floor]; geomSave(g); },
    addRiser: function (r) { var g = geomStore(); r.id = 'RU-' + Date.now().toString(36); g.risers.push(r); geomSave(g); return r.id; },
    updateRiser: function (id, patch) { var g = geomStore(); g.risers.forEach(function (r) { if (r.id === id) Object.assign(r, patch); }); geomSave(g); },
    removeRiser: function (id) { var g = geomStore(); g.risers = g.risers.filter(function (r) { return r.id !== id; }); geomSave(g); },
    exportJSON: function () { U.download(new Blob([JSON.stringify({ _twinxGeom: 1, exportedAt: new Date().toISOString(), site: TX.model && TX.model.site, geom: geomStore() }, null, 1)], { type: 'application/json' }), 'TwinX_구조입력_' + U.today() + '.json'); },
    importJSON: function (text) {
      var d = JSON.parse(text); if (!d || !d._twinxGeom || !d.geom) throw new Error('TwinX 구조 입력 파일이 아닙니다');
      var g = geomStore(); Object.assign(g.doors, d.geom.doors || {}); Object.keys(d.geom.trays || {}).forEach(function (k) { g.trays[k] = d.geom.trays[k]; });
      (d.geom.risers || []).forEach(function (r) { if (!g.risers.some(function (q) { return q.id === r.id; })) g.risers.push(r); });
      geomSave(g);
    }
  };

  var gp = null; // 구조 편집 패널
  var tool = { kind: 'door', pts: [], main: true, doorW: 900, noDoor: false, free: false, cursor: null, selRiser: null };
  function toggleGeom(force) {
    var open = force != null ? force : !gp;
    if (!open) { if (gp) gp.remove(); gp = null; stopTool(); return; }
    if (panel) togglePanel(false);
    if (TX.state.view === '3d') TX.setState({ view: '2d' });
    if (!gp) { gp = U.el('div', 'tx-wb-panel tx-wb-geom'); root().appendChild(gp); bindGeom(); }
    startTool(); renderGeom();
  }
  function renderGeom() {
    if (!gp) return;
    var code = curFloor(), g = geomStore(), M = TX.model;
    var rooms = TX.roomsOf(code), fl = TX.floor(code);
    var tabs = [['door', '문'], ['tray', '케이블 트레이'], ['riser', 'EPS 라이저']];
    var h = '<div class="tx-wb-hd"><div><small>구조 편집 · 현장 현행화</small><b>' + esc(floorName(code)) + ' 문·트레이·라이저</b></div><button type="button" class="tx-wb-x" data-g="close" aria-label="닫기">✕</button></div>' +
      '<div class="tx-wb-tabs">' + tabs.map(function (t) { return '<button type="button" data-g="tab" data-k="' + t[0] + '" class="' + (tool.kind === t[0] ? 'is-on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div class="tx-wb-body">';
    if (tool.kind === 'door') {
      var ud = rooms.filter(function (r) { return g.doors[r.id]; });
      h += '<p class="tx-wb-guide">도면에서 <b>실 벽 근처를 클릭</b>하면 가장 가까운 벽에 문이 놓입니다.</p>' +
        '<div class="tx-wb-row2"><label>문 폭 (mm)<input type="number" min="500" max="3000" step="50" data-gi="doorW" value="' + tool.doorW + '"></label>' +
        '<label class="tx-wb-chk"><input type="checkbox" data-gi="noDoor"' + (tool.noDoor ? ' checked' : '') + '> 클릭한 실을 「문 없음」으로</label></div>' +
        '<h5>등록된 문 <span class="tx-count">' + ud.length + '</span></h5>' +
        (ud.length ? '<ul class="tx-wb-list">' + ud.map(function (r) { var d = g.doors[r.id]; return '<li><span><b>' + esc(r.name) + '</b><small>' + SIDE_NAME[d.side] + (d.side !== 'none' ? ' · 폭 ' + d.w + 'mm' : '') + '</small></span><button type="button" class="tx-wb-link tx-wb-danger" data-g="door-del" data-id="' + esc(r.id) + '">삭제</button></li>'; }).join('') + '</ul>'
          : '<p class="tx-wb-empty">아직 없음 · 문 위치는 복도 방향으로 추정 중</p>');
    } else if (tool.kind === 'tray') {
      var ut = g.trays[code] || [], paths = {};
      ut.forEach(function (t) { var p = paths[t.path] = paths[t.path] || { n: 0, len: 0, main: t.main }; p.n++; p.len += Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]); });
      h += '<p class="tx-wb-guide">도면에서 경로의 꺾이는 점을 차례로 클릭하고 <b>더블클릭 또는 Enter</b>로 완료합니다. 직각으로 자동 정렬되며(Shift: 자유 각도), 기존 경로 끝점에 자동으로 붙습니다. Esc: 그리던 경로 취소.</p>' +
        '<div class="tx-wb-row2"><label class="tx-wb-chk"><input type="checkbox" data-gi="main"' + (tool.main ? ' checked' : '') + '> 간선(메인) 트레이</label>' +
        '<span class="tx-wb-pts">' + (tool.pts.length ? '그리는 중 · 점 ' + tool.pts.length + '개 <button type="button" class="tx-wb-link" data-g="tray-done">완료</button>' : '') + '</span></div>' +
        '<h5>등록된 경로 <span class="tx-count">' + Object.keys(paths).length + '</span></h5>' +
        (Object.keys(paths).length ? '<ul class="tx-wb-list">' + Object.keys(paths).map(function (k, i) { var p = paths[k]; return '<li><span><b>경로 ' + (i + 1) + (p.main ? ' · 간선' : ' · 지선') + '</b><small>' + p.n + '구간 · ' + (p.len / 1000).toFixed(1) + 'm</small></span><button type="button" class="tx-wb-link tx-wb-danger" data-g="tray-del" data-id="' + k + '">삭제</button></li>'; }).join('') + '</ul>' +
          '<button type="button" class="tx-wb-link tx-wb-danger" data-g="tray-clear">이 층 등록 경로 모두 지우기 (추정 경로로 복귀)</button>'
          : '<p class="tx-wb-empty">아직 없음 · 이 층은 추정 경로로 표시 중 (등록하면 추정 경로를 대체합니다)</p>');
    } else {
      var floorsAll = (M ? M.floors : []);
      h += '<p class="tx-wb-guide">도면에서 <b>라이저(EPS 샤프트) 위치를 클릭</b>해 추가하고, 관통하는 층을 선택하세요. 등록 라이저가 하나라도 있으면 추정 라이저 대신 등록값을 씁니다.</p>' +
        '<h5>등록된 라이저 <span class="tx-count">' + g.risers.length + '</span></h5>' +
        (g.risers.length ? '<ul class="tx-wb-list tx-wb-rlist">' + g.risers.map(function (r) {
          var fs = r.floors && r.floors.length ? r.floors : floorsAll.map(function (f) { return f.code; });
          return '<li class="' + (tool.selRiser === r.id ? 'is-sel' : '') + '"><div class="tx-wb-rtop"><input type="text" data-gr="name" data-id="' + esc(r.id) + '" value="' + esc(r.name || '') + '" aria-label="라이저 이름"><button type="button" class="tx-wb-link tx-wb-danger" data-g="riser-del" data-id="' + esc(r.id) + '">삭제</button></div>' +
            '<div class="tx-wb-fchips">' + floorsAll.map(function (f) { return '<button type="button" data-g="riser-floor" data-id="' + esc(r.id) + '" data-f="' + esc(f.code) + '" class="' + (fs.indexOf(f.code) >= 0 ? 'is-on' : '') + '">' + esc(f.name) + '</button>'; }).join('') + '</div>' +
            '<small>X ' + Math.round(r.x) + ' · Y ' + Math.round(r.y) + ' mm</small></li>';
        }).join('') + '</ul>' : '<p class="tx-wb-empty">아직 없음 · TPS/EPS 실 위치로 추정 중' + (M && M.risers && M.risers.length ? ' (추정 ' + M.risers.length + '개)' : '') + '</p>');
    }
    h += '<div class="tx-wb-acts tx-wb-acts-2"><button type="button" class="tx-wb-link" data-g="g-export">구조 입력 내보내기</button><button type="button" class="tx-wb-link" data-g="g-import">가져오기</button></div></div>';
    gp.innerHTML = h;
    void fl;
  }
  function bindGeom() {
    gp.addEventListener('click', function (e) {
      var b = e.target.closest('[data-g]'); if (!b) return;
      var a = b.getAttribute('data-g'), code = curFloor(), id = b.getAttribute('data-id');
      if (a === 'close') toggleGeom(false);
      else if (a === 'tab') { tool.kind = b.getAttribute('data-k'); tool.pts = []; drawPreview(); renderGeom(); }
      else if (a === 'door-del') { TX.geom.clearDoor(id); toast('문을 추정 위치로 되돌렸습니다', 'info'); }
      else if (a === 'tray-done') finishTray();
      else if (a === 'tray-del') TX.geom.removeTrayPath(code, id);
      else if (a === 'tray-clear') { if (confirm(floorName(code) + ' 등록 트레이 경로를 모두 지울까요?')) TX.geom.clearTrays(code); }
      else if (a === 'riser-del') { TX.geom.removeRiser(id); }
      else if (a === 'riser-floor') {
        var r = geomStore().risers.find(function (q) { return q.id === id; }); if (!r) return;
        var all = TX.model.floors.map(function (f) { return f.code; }), fs = (r.floors && r.floors.length ? r.floors : all).slice(), f = b.getAttribute('data-f'), i = fs.indexOf(f);
        if (i >= 0) fs.splice(i, 1); else fs.push(f);
        if (!fs.length) { toast('라이저는 최소 1개 층을 관통해야 합니다', 'warn'); return; }
        TX.geom.updateRiser(id, { floors: fs });
      }
      else if (a === 'g-export') TX.geom.exportJSON();
      else if (a === 'g-import') pickFile('application/json', function (file) { file.text().then(function (t) { try { TX.geom.importJSON(t); toast('구조 입력을 가져왔습니다', 'success'); } catch (err) { toast('가져오기 실패: ' + err.message, 'error'); } }); });
    });
    gp.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.gi === 'doorW') tool.doorW = U.clamp(parseInt(t.value, 10) || 900, 500, 3000);
      else if (t.dataset.gi === 'noDoor') tool.noDoor = t.checked;
      else if (t.dataset.gi === 'main') tool.main = t.checked;
      else if (t.dataset.gr === 'name') TX.geom.updateRiser(t.dataset.id, { name: t.value.trim() || 'EPS 라이저' });
    });
    gp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); toggleGeom(false); } });
  }

  /* ---- 도면 클릭 캡처 + 미리보기 오버레이 ---- */
  var gcap = null;
  function startTool() {
    stopTool();
    var host = TX.ui && TX.ui.view2d; if (!host || !TX.cad2d || !TX.cad2d.screenToMm) { toast('2D 도면 모듈이 없어 구조 편집을 할 수 없습니다', 'error'); return; }
    gcap = { host: host, down: null };
    gcap.svg = U.svg('svg', { class: 'tx-wb-gprev' }); host.appendChild(gcap.svg);
    host.classList.add('tx-wb-calib');
    gcap.onDown = function (e) { gcap.down = { x: e.clientX, y: e.clientY }; };
    gcap.onClick = function (e) {
      if (!gp || (gp.contains && gp.contains(e.target))) return;
      if (e.target.closest && e.target.closest('.tx-wb-calbar,.tx-cad-zoom,button')) return;
      e.stopPropagation(); e.preventDefault();
      if (gcap.down && Math.abs(e.clientX - gcap.down.x) + Math.abs(e.clientY - gcap.down.y) > 5) return;
      var mm = TX.cad2d.screenToMm(e.clientX, e.clientY); if (!mm) return;
      if (tool.kind === 'door') placeDoor(mm);
      else if (tool.kind === 'tray') { if (e.detail >= 2) { finishTray(); return; } addTrayPoint(mm, e.shiftKey); }
      else placeRiser(mm);
    };
    gcap.onMove = function (e) { tool.free = e.shiftKey; tool.cursor = TX.cad2d.screenToMm(e.clientX, e.clientY); if (tool.kind === 'tray' && tool.pts.length) drawPreview(); };
    gcap.onKey = function (e) {
      if (!gp || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
      if (tool.kind === 'tray' && e.key === 'Enter' && tool.pts.length) { e.preventDefault(); finishTray(); }
      else if (tool.kind === 'tray' && e.key === 'Escape' && tool.pts.length) { e.preventDefault(); e.stopPropagation(); tool.pts = []; drawPreview(); renderGeom(); }
    };
    host.addEventListener('pointerdown', gcap.onDown, true);
    host.addEventListener('click', gcap.onClick, true);
    host.addEventListener('pointermove', gcap.onMove);
    window.addEventListener('keydown', gcap.onKey, true);
  }
  function stopTool() {
    if (!gcap) return;
    gcap.host.removeEventListener('pointerdown', gcap.onDown, true);
    gcap.host.removeEventListener('click', gcap.onClick, true);
    gcap.host.removeEventListener('pointermove', gcap.onMove);
    window.removeEventListener('keydown', gcap.onKey, true);
    gcap.host.classList.remove('tx-wb-calib'); gcap.svg.remove(); gcap = null; tool.pts = [];
  }
  function snapPt(mm, free) {
    var p = [Math.round(mm.x / 50) * 50, Math.round(mm.y / 50) * 50];
    // 기존 트레이 끝점·라이저에 자석 스냅 (400mm)
    var code = curFloor(), best = null, bd = 400;
    var cands = [];
    ((TX.floor(code) || {}).trays || []).forEach(function (t) { cands.push(t.a, t.b); });
    (TX.model.risers || []).forEach(function (r) { if (r.floors.indexOf(code) >= 0) cands.push([r.x, r.y]); });
    if (tool.pts.length > 1) cands.push(tool.pts[0]); // 경로 닫기용 시작점만 (직전 점 제외)
    cands.forEach(function (c) { var d = Math.hypot(c[0] - mm.x, c[1] - mm.y); if (d < bd) { bd = d; best = c; } });
    if (best) return [Math.round(best[0]), Math.round(best[1])];
    if (!free && tool.pts.length) { var l = tool.pts[tool.pts.length - 1]; if (Math.abs(p[0] - l[0]) > Math.abs(p[1] - l[1])) p[1] = l[1]; else p[0] = l[0]; }
    return p;
  }
  function addTrayPoint(mm, free) {
    var p = snapPt(mm, free), l = tool.pts[tool.pts.length - 1];
    if (l && Math.hypot(p[0] - l[0], p[1] - l[1]) < 100) return;
    tool.pts.push(p); drawPreview(); renderGeom();
  }
  function finishTray() {
    if (tool.pts.length < 2) { toast('경로에는 점이 2개 이상 필요합니다', 'warn'); return; }
    var code = curFloor(), n = tool.pts.length - 1;
    TX.geom.addTrayPath(code, tool.pts.slice(), tool.main);
    tool.pts = []; drawPreview();
    toast('케이블 트레이 경로를 등록했습니다 · ' + n + '구간', 'success');
  }
  function placeDoor(mm) {
    var code = curFloor(), best = null;
    TX.roomsOf(code).forEach(function (r) {
      if (r.type === 'corr') return;
      var inX = mm.x >= r.x - 600 && mm.x <= r.x + r.w + 600, inY = mm.y >= r.y - 600 && mm.y <= r.y + r.h + 600;
      if (!inX || !inY) return;
      [['N', Math.abs(mm.y - r.y), mm.x >= r.x && mm.x <= r.x + r.w], ['S', Math.abs(mm.y - (r.y + r.h)), mm.x >= r.x && mm.x <= r.x + r.w],
       ['W', Math.abs(mm.x - r.x), mm.y >= r.y && mm.y <= r.y + r.h], ['E', Math.abs(mm.x - (r.x + r.w)), mm.y >= r.y && mm.y <= r.y + r.h]].forEach(function (c) {
        if (c[2] && c[1] <= 900 && (!best || c[1] < best.d)) best = { r: r, side: c[0], d: c[1] };
      });
    });
    if (!best) { toast('실 벽 가까이(0.9m 이내)를 클릭하세요', 'warn'); return; }
    var r = best.r;
    if (tool.noDoor) { TX.geom.setDoor(r.id, { side: 'none' }); toast(r.name + ' · 문 없음으로 지정', 'success'); return; }
    var along = best.side === 'N' || best.side === 'S', lo = along ? r.x : r.y, len = along ? r.w : r.h, w = Math.min(tool.doorW, len - 200);
    var at = Math.round(U.clamp(along ? mm.x : mm.y, lo + w / 2 + 50, lo + len - w / 2 - 50));
    TX.geom.setDoor(r.id, { side: best.side, at: at, w: Math.round(w) });
    toast(r.name + ' · ' + SIDE_NAME[best.side] + ' 벽에 문 등록 (폭 ' + Math.round(w) + 'mm)', 'success');
  }
  function placeRiser(mm) {
    var p = [Math.round(mm.x / 50) * 50, Math.round(mm.y / 50) * 50];
    var code = curFloor(), rm = TX.roomsOf(code).find(function (r) { return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h; });
    var n = geomStore().risers.length + 1;
    var id = TX.geom.addRiser({ name: (rm ? rm.name + ' ' : '') + 'EPS 라이저 ' + n, x: p[0], y: p[1], floors: TX.model.floors.map(function (f) { return f.code; }) });
    tool.selRiser = id;
    toast('라이저를 추가했습니다 · 패널에서 관통 층을 확인하세요', 'success');
  }
  function drawPreview() {
    if (!gcap) return;
    var svg = gcap.svg, hr = gcap.host.getBoundingClientRect();
    if (tool.kind !== 'tray' || !tool.pts.length) { svg.innerHTML = ''; return; }
    var pts = tool.pts.slice();
    if (tool.cursor) pts.push(snapPt(tool.cursor, tool.free));
    var sc = pts.map(function (p) { var q = TX.cad2d.mmToScreen(p[0], p[1]); return q ? [q.x - hr.left, q.y - hr.top] : null; }).filter(Boolean);
    var last = pts[pts.length - 1], prev = pts[pts.length - 2], len = prev ? Math.hypot(last[0] - prev[0], last[1] - prev[1]) : 0;
    svg.innerHTML = '<polyline points="' + sc.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '" fill="none" stroke="#facc15" stroke-width="5" stroke-opacity="0.35"/>' +
      '<polyline points="' + sc.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '" fill="none" stroke="#facc15" stroke-width="1.6" stroke-dasharray="6 4"/>' +
      sc.slice(0, tool.pts.length).map(function (q) { return '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="4.5" fill="#facc15" stroke="#0b1220" stroke-width="1.5"/>'; }).join('') +
      (sc.length > 1 ? '<text x="' + (sc[sc.length - 1][0] + 10).toFixed(1) + '" y="' + (sc[sc.length - 1][1] - 10).toFixed(1) + '" fill="#fde68a" font-size="12" font-weight="700" style="paint-order:stroke;stroke:#0b1220;stroke-width:3px">' + (len / 1000).toFixed(2) + ' m</text>' : '');
  }
  TX.on('resize', function () { drawPreview(); });

  /* =========================================================
     4. 측정 매칭 확인: 업로드된 측정 행 ↔ 설비ID/실 자동 매칭 결과 검토·수동 지정
        localStorage 'twinx_match_v1' {그룹키(건물|층|점검 위치|설비):{assetId}|{roomId}|{ignore:true}}
        → 10-data가 자동 매칭보다 먼저 적용 (match:'manual'·'ignored')
     ========================================================= */
  var MATCH_KEY = 'twinx_match_v1', SEEN_KEY = 'twinx_match_seen_v1';
  function matchStore() { try { return JSON.parse(localStorage.getItem(MATCH_KEY) || '{}') || {}; } catch (e) { return {}; } }
  var matchSaveTimer = null;
  function matchSave(o) { try { localStorage.setItem(MATCH_KEY, JSON.stringify(o)); } catch (e) { toast('브라우저 저장공간에 저장하지 못했습니다', 'error'); return; } clearTimeout(matchSaveTimer); matchSaveTimer = setTimeout(reloadModel, 250); }
  var HOW = {
    manual: ['확정', '수동 지정', 'ok'], explicit: ['확정', '설비ID·실코드 일치', 'ok'],
    'asset-name': ['추정', '설비명/ID 포함', 'est'], 'room-name': ['추정', '실명 일치', 'est'], 'room-name-core': ['추정', '실명 핵심어+층', 'est'], 'room-type': ['추정', '실 유형+층', 'est'],
    ignored: ['제외', '트윈 대상 아님', 'ign']
  };
  function howOf(m) {
    if (!m.match) return ['미매칭', '연결 대상 없음', 'none'];
    var base = m.match.replace('+category', ''), h = HOW[base] || ['추정', base, 'est'];
    return [h[0], h[1] + (m.match.indexOf('+category') >= 0 ? ' → 설비구분 유사' : ''), h[2]];
  }
  /* 측정 행을 「건물|층|점검 위치|설비」 그룹으로 묶음 (같은 위치의 여러 항목을 한 번에 지정) */
  function matchGroups() {
    var M = TX.model, gs = {}, order = [];
    (M && M.measurements || []).forEach(function (m) {
      if (m.source && m.source !== 'inspection') return;
      var k = m.groupKey || [m.building, m.floorText, m.location, m.equip].join('|');
      var g = gs[k];
      if (!g) { g = gs[k] = { key: k, building: m.building, floor: m.floorText, location: m.location, equip: m.equip, rows: [], bad: 0, m: m }; order.push(g); }
      g.rows.push(m); if (m.judge === 'bad') g.bad++;
    });
    order.forEach(function (g) { g.how = howOf(g.m); g.assetId = g.m.assetId; g.roomId = g.m.roomId; });
    return order;
  }
  function matchStats(groups) {
    var s = { rows: 0, ok: 0, est: 0, room: 0, none: 0, ign: 0, groups: groups.length };
    groups.forEach(function (g) {
      var n = g.rows.length; s.rows += n;
      if (g.how[2] === 'ok') s.ok += n; else if (g.how[2] === 'ign') s.ign += n; else if (g.how[2] === 'none') s.none += n;
      else if (!g.assetId) s.room += n; else s.est += n;
    });
    return s;
  }
  function targetOptions(sel) {
    var M = TX.model; if (!M) return '';
    var o = ['<option value="">자동 매칭에 맡기기</option>', '<option value="x"' + (sel === 'x' ? ' selected' : '') + '>측정 제외 (트윈 대상 아님)</option>'];
    M.floors.forEach(function (f) {
      var rs = M.rooms.filter(function (r) { return r.floor === f.code; });
      if (!rs.length) return;
      o.push('<optgroup label="' + esc(f.name + (f.building ? ' · ' + f.building : '')) + '">');
      rs.forEach(function (r) {
        o.push('<option value="r:' + esc(r.id) + '"' + (sel === 'r:' + r.id ? ' selected' : '') + '>[실] ' + esc(r.name) + ' (' + esc(r.id) + ')</option>');
        M.assets.filter(function (a) { return a.room === r.id; }).forEach(function (a) {
          o.push('<option value="a:' + esc(a.id) + '"' + (sel === 'a:' + a.id ? ' selected' : '') + '>　' + esc(a.id) + ' ' + esc(a.name) + '</option>');
        });
      });
      o.push('</optgroup>');
    });
    return o.join('');
  }
  var mm = null, mmFilter = 'todo', mmQuery = '';
  function closeMatch() { if (mm) { mm.remove(); mm = null; } }
  function openMatch() {
    closeWbMenu(); closeModal(); dismissNotice();
    if (!TX.state.open) TX.open();
    if (!mm) { mm = U.el('div', 'tx-wb-modal tx-wb-mm'); root().appendChild(mm); bindMatch(); }
    renderMatch();
    markSeen();
  }
  function renderMatch() {
    if (!mm) return;
    var groups = matchGroups(), st = matchStats(groups), ov = matchStore();
    var F = { all: '전체', todo: '확인 필요', none: '미매칭', est: '추정', room: '실만 연결', ok: '확정', ign: '제외' };
    var q = mmQuery.toLowerCase();
    var vis = groups.filter(function (g) {
      var k = g.how[2] === 'ok' ? 'ok' : g.how[2] === 'ign' ? 'ign' : g.how[2] === 'none' ? 'none' : !g.assetId ? 'room' : 'est';
      var pass = mmFilter === 'all' || mmFilter === k || (mmFilter === 'todo' && (k === 'none' || k === 'est' || k === 'room'));
      return pass && (!q || (g.building + ' ' + g.floor + ' ' + g.location + ' ' + g.equip).toLowerCase().indexOf(q) >= 0);
    });
    var pct = function (n) { return st.rows ? Math.round(n / st.rows * 1000) / 10 : 0; };
    var bar = [['ok', st.ok, '#10b981'], ['est', st.est, '#3e63db'], ['room', st.room, '#eab308'], ['none', st.none, '#f43f5e'], ['ign', st.ign, '#94a3b8']];
    var h = '<div class="tx-wb-dlg tx-wb-mmdlg" role="dialog" aria-modal="true" aria-label="측정 매칭 확인">' +
      '<div class="tx-wb-hd"><div><small>측정 업로드 · 설비ID 자동 매칭 확인</small><b>측정 자료 ' + st.rows + '건 · 위치 그룹 ' + st.groups + '개</b></div><button type="button" class="tx-wb-x" data-m="close" aria-label="닫기">✕</button></div>' +
      '<div class="tx-wb-body">' +
        '<div class="tx-mm-bar">' + bar.map(function (b) { return b[1] ? '<i style="width:' + pct(b[1]) + '%;background:' + b[2] + '"></i>' : ''; }).join('') + '</div>' +
        '<div class="tx-mm-legend">' +
          '<span><i style="background:#10b981"></i>확정 ' + st.ok + '건</span><span><i style="background:#3e63db"></i>설비 추정 ' + st.est + '건</span>' +
          '<span><i style="background:#eab308"></i>실만 연결 ' + st.room + '건</span><span><i style="background:#f43f5e"></i>미매칭 ' + st.none + '건</span><span><i style="background:#94a3b8"></i>제외 ' + st.ign + '건</span>' +
          '<b class="tx-mm-rate">설비 연결률 ' + pct(st.ok + st.est) + '%</b></div>' +
        '<div class="tx-mm-tools"><div class="tx-mm-seg">' + Object.keys(F).map(function (k) { return '<button type="button" data-m="f" data-k="' + k + '" class="' + (mmFilter === k ? 'is-on' : '') + '">' + F[k] + '</button>'; }).join('') + '</div>' +
          '<input type="search" data-m="q" placeholder="건물·층·점검 위치·설비 검색" value="' + esc(mmQuery) + '"></div>' +
        '<div class="tx-mm-tablewrap"><table class="tx-mm-table"><thead><tr><th>건물 · 층</th><th>점검 위치 · 설비 (측정표 기재)</th><th>항목</th><th>현재 매칭</th><th>연결 대상 지정</th><th></th></tr></thead><tbody>' +
        (vis.length ? vis.map(function (g) {
          var cur = ov[g.key], sel = cur ? (cur.ignore ? 'x' : cur.assetId ? 'a:' + cur.assetId : cur.roomId ? 'r:' + cur.roomId : '') : '';
          var a = g.assetId && TX.asset(g.assetId), r = g.roomId && TX.room(g.roomId);
          var tgt = a ? '<b>' + esc(a.id) + '</b> ' + esc(a.name) : r ? '<b>[실]</b> ' + esc(r.name) : '<span class="tx-muted">—</span>';
          var canApprove = !cur && (a || r);
          return '<tr data-key="' + esc(g.key) + '" class="tx-mm-' + g.how[2] + '"><td>' + esc(g.building || '—') + '<small>' + esc(g.floor || '층 미기재') + '</small></td>' +
            '<td><b>' + esc(g.location || '(점검 위치 없음)') + '</b><small>' + esc(g.equip || '') + '</small></td>' +
            '<td class="tx-mm-n">' + g.rows.length + (g.bad ? '<em>불량 ' + g.bad + '</em>' : '') + '</td>' +
            '<td><span class="tx-mm-badge tx-mm-b-' + g.how[2] + '">' + g.how[0] + '</span><div class="tx-mm-tgt">' + tgt + '</div><small>' + esc(g.how[1]) + '</small></td>' +
            '<td><select data-m="sel" aria-label="연결 대상">' + targetOptions(sel) + '</select></td>' +
            '<td>' + (canApprove ? '<button type="button" class="tx-wb-link" data-m="approve">추정 승인</button>' : cur ? '<button type="button" class="tx-wb-link tx-wb-danger" data-m="reset">자동으로</button>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="6" class="tx-mm-empty">해당하는 측정 위치가 없습니다</td></tr>') +
        '</tbody></table></div>' +
        '<p class="tx-wb-help">같은 <b>건물·층·점검 위치·설비</b>의 측정 항목은 한 그룹으로 묶여 한 번에 지정됩니다. 지정 내용은 다음 업로드에도 그대로 적용됩니다. 가장 확실한 방법은 측정 엑셀에 <b>설비ID 열</b>을 넣는 것이며, 아래 「설비ID 매핑표」를 내려받아 활용하세요.</p>' +
      '</div>' +
      '<div class="tx-wb-ft"><div class="tx-wb-ft-l"><button type="button" class="tx-wb-link" data-m="csv">설비ID 매핑표 내보내기 (CSV)</button><button type="button" class="tx-wb-link" data-m="mexport">지정 내용 내보내기</button><button type="button" class="tx-wb-link" data-m="mimport">가져오기</button></div>' +
        '<div><button type="button" class="tx-wb-btn" data-m="approve-all" title="현재 목록의 추정 매칭을 모두 확정합니다">보이는 추정 모두 승인</button><button type="button" class="tx-wb-btn tx-wb-pri" data-m="close">완료</button></div></div>' +
      '</div>';
    var sc = mm.querySelector('.tx-mm-tablewrap'), top = sc ? sc.scrollTop : 0;
    mm.innerHTML = h;
    var sc2 = mm.querySelector('.tx-mm-tablewrap'); if (sc2) sc2.scrollTop = top;
  }
  function setOverride(key, val) {
    var o = matchStore();
    if (!val) delete o[key];
    else if (val === 'x') o[key] = { ignore: true };
    else if (val.indexOf('a:') === 0) o[key] = { assetId: val.slice(2) };
    else if (val.indexOf('r:') === 0) o[key] = { roomId: val.slice(2) };
    matchSave(o);
  }
  function bindMatch() {
    mm.addEventListener('click', function (e) {
      if (e.target === mm) { closeMatch(); return; }
      var b = e.target.closest('[data-m]'); if (!b) return;
      var a = b.getAttribute('data-m'), tr = b.closest('tr'), key = tr && tr.getAttribute('data-key');
      if (a === 'close') closeMatch();
      else if (a === 'f') { mmFilter = b.getAttribute('data-k'); renderMatch(); }
      else if (a === 'approve' || a === 'reset') {
        var g = matchGroups().find(function (x) { return x.key === key; }); if (!g) return;
        setOverride(key, a === 'reset' ? '' : g.assetId ? 'a:' + g.assetId : 'r:' + g.roomId);
      } else if (a === 'approve-all') {
        var o = matchStore(), n = 0;
        Array.prototype.forEach.call(mm.querySelectorAll('tbody tr[data-key]'), function (row) {
          var k = row.getAttribute('data-key'), g = matchGroups().find(function (x) { return x.key === k; });
          if (g && !o[k] && (g.assetId || g.roomId) && g.how[2] !== 'ok') { o[k] = g.assetId ? { assetId: g.assetId } : { roomId: g.roomId }; n++; }
        });
        if (!n) { toast('승인할 추정 매칭이 없습니다', 'info'); return; }
        matchSave(o); toast('추정 매칭 ' + n + '개 그룹을 확정했습니다', 'success');
      } else if (a === 'csv') exportMatchCSV();
      else if (a === 'mexport') U.download(new Blob([JSON.stringify({ _twinxMatch: 1, exportedAt: new Date().toISOString(), site: TX.model && TX.model.site, map: matchStore() }, null, 1)], { type: 'application/json' }), 'TwinX_측정매칭_' + U.today() + '.json');
      else if (a === 'mimport') pickFile('application/json', function (file) {
        file.text().then(function (t) { try { var d = JSON.parse(t); if (!d || !d._twinxMatch) throw new Error('TwinX 측정 매칭 파일이 아닙니다'); var o = matchStore(); Object.assign(o, d.map || {}); matchSave(o); toast('매칭 지정 ' + Object.keys(d.map || {}).length + '건을 가져왔습니다', 'success'); } catch (err) { toast('가져오기 실패: ' + err.message, 'error'); } });
      });
    });
    mm.addEventListener('change', function (e) {
      var t = e.target; if (t.getAttribute('data-m') !== 'sel') return;
      var tr = t.closest('tr'); setOverride(tr.getAttribute('data-key'), t.value);
    });
    mm.addEventListener('input', U.debounce(function (e) { if (e.target.getAttribute('data-m') === 'q') { mmQuery = e.target.value; renderMatch(); var q = mm.querySelector('[data-m="q"]'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } } }, 200));
    mm.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeMatch(); } });
  }
  function exportMatchCSV() {
    var rows = [['건물', '층', '점검 위치', '설비(측정표)', '측정 항목 수', '설비ID', '설비명', '실코드', '실명', '매칭 상태', '매칭 근거']];
    matchGroups().forEach(function (g) {
      var a = g.assetId && TX.asset(g.assetId), r = g.roomId && TX.room(g.roomId);
      rows.push([g.building, g.floor, g.location, g.equip, g.rows.length, a ? a.id : '', a ? a.name : '', r ? r.id : '', r ? r.name : '', g.how[0], g.how[1]]);
    });
    var csv = '﻿' + rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
    U.download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'TwinX_설비ID매핑표_' + U.today() + '.csv');
  }

  /* ---- 측정 업로드 감지 → 알림 (뷰어 밖 ADMIN 화면에서도 표시) ---- */
  var notice = null, lastSig = null;
  function inspSig() { var ms = (TX.model && TX.model.measurements || []).filter(function (m) { return !m.source || m.source === 'inspection'; }); return ms.length + ':' + U.hash(ms.map(function (m) { return m.groupKey + '/' + m.item; }).join('\n')); }
  function markSeen() { try { localStorage.setItem(SEEN_KEY, inspSig()); } catch (e) { } dismissNotice(); }
  function dismissNotice() { if (notice) { notice.remove(); notice = null; } }
  function checkUpload() {
    if (!TX.model || TX.model.source !== 'admin') return;
    var sig = inspSig(); if (sig === lastSig) return; lastSig = sig;
    var seen = null; try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { }
    if (seen === sig) return;
    var st = matchStats(matchGroups()), todo = st.none + st.est + st.room;
    if (!st.rows) return;
    if (!todo) { markSeen(); return; }
    dismissNotice();
    notice = U.el('div', 'tx-wb-notice');
    notice.innerHTML = '<div><b>측정 자료 ' + st.rows + '건 · 설비 매칭 확인이 필요합니다</b><span>미매칭 ' + st.none + '건 · 추정 ' + (st.est + st.room) + '건 · 설비 연결률 ' + (st.rows ? Math.round((st.ok + st.est) / st.rows * 100) : 0) + '%</span></div>' +
      '<button type="button" class="tx-wb-btn tx-wb-pri" data-n="open">매칭 확인</button><button type="button" class="tx-wb-x" data-n="later" aria-label="나중에">✕</button>';
    document.body.appendChild(notice);
    notice.addEventListener('click', function (e) {
      var b = e.target.closest('[data-n]'); if (!b) return;
      if (b.getAttribute('data-n') === 'open') openMatch(); else markSeen();
    });
  }
  TX.on('model', function () { setTimeout(checkUpload, 300); if (mm) renderMatch(); });
  // 첫 모델이 이 모듈보다 먼저 들어온 경우 대비: 페이지 로드 후에도 확인
  function lateCheck() { [1500, 4000, 8000].forEach(function (t) { setTimeout(checkUpload, t); }); }
  if (document.readyState === 'complete') lateCheck(); else window.addEventListener('load', lateCheck);
  TX.matching = { open: openMatch, groups: matchGroups, stats: function () { return matchStats(matchGroups()); }, set: setOverride, exportCSV: exportMatchCSV };

  /* ---------- 「현행화」 드롭다운 ---------- */
  var wbMenu = null, wbBtn = null;
  function openWbMenu(btn) {
    closeWbMenu(); wbBtn = btn;
    var r = btn.getBoundingClientRect(), code = curFloor();
    var g = geomStore(), ul = TX.underlay.get(code), nd = TX.roomsOf(code).filter(function (q) { return g.doors[q.id]; }).length, nt = (g.trays[code] || []).length;
    var nr = Object.keys(rackStore()).length;
    wbMenu = U.el('div', 'tx-wb-menu');
    wbMenu.setAttribute('role', 'menu');
    wbMenu.innerHTML =
      '<button type="button" role="menuitem" data-wbm="underlay"><b>도면 배경 (CAD 겹쳐 보기)</b><small>' + (ul ? '등록됨 · ' + esc(ul.name || '') : '층 평면도 이미지 올리기 · 2점 맞춤') + '</small></button>' +
      '<button type="button" role="menuitem" data-wbm="geom"><b>구조 편집 (문·트레이·라이저)</b><small>' + (nd || nt || g.risers.length ? '이 층 문 ' + nd + ' · 트레이 ' + nt + '구간 · 라이저 ' + g.risers.length : '2D 도면에서 직접 등록') + '</small></button>' +
      (function () { var st = matchStats(matchGroups()), todo = st.none + st.est + st.room; return '<button type="button" role="menuitem" data-wbm="match"><b>측정 매칭 확인' + (todo ? ' <em class="tx-wb-mbadge">' + todo + '</em>' : '') + '</b><small>' + (st.rows ? '측정 ' + st.rows + '건 · 설비 연결률 ' + Math.round((st.ok + st.est) / st.rows * 100) + '% · 미매칭 ' + st.none + '건' : '업로드된 측정 자료 없음') + '</small></button>'; })() +
      '<button type="button" role="menuitem" data-wbm="rack"><b>랙·U 입력</b><small>' + (nr ? '입력 ' + nr + '대 · ' : '') + '설비 선택 후 인스펙터 「랙 · U」 편집</small></button>';
    root().appendChild(wbMenu);
    wbMenu.style.top = (r.bottom + 6) + 'px';
    wbMenu.style.left = Math.max(8, Math.min(window.innerWidth - 300, r.left)) + 'px';
    btn.setAttribute('aria-expanded', 'true');
  }
  function closeWbMenu() { if (wbMenu) { wbMenu.remove(); wbMenu = null; } if (wbBtn) { wbBtn.setAttribute('aria-expanded', 'false'); wbBtn = null; } }
  function rackHint() {
    var id = TX.state.selected;
    if (id) openRackEditor(id);
    else { toast('랙을 입력할 설비를 도면에서 선택하거나 상단 검색으로 찾아 주세요', 'info'); TX.setState({ panel: { inspector: true } }); }
  }
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && wbMenu) { e.stopPropagation(); closeWbMenu(); } }, true);

  /* ---------- 진입점 (셸 버튼 · 인스펙터 버튼) ---------- */
  document.addEventListener('click', function (e) {
    var mi = e.target.closest && e.target.closest('[data-wbm]');
    if (mi) { var k = mi.getAttribute('data-wbm'); closeWbMenu(); if (k === 'underlay') { if (gp) toggleGeom(false); togglePanel(true); } else if (k === 'geom') toggleGeom(true); else if (k === 'rack') rackHint(); else if (k === 'match') openMatch(); return; }
    if (wbMenu && !(e.target.closest && e.target.closest('.tx-wb-menu,[data-act="wb-menu"]'))) closeWbMenu();
    var b = e.target.closest && e.target.closest('[data-act="rack-edit"],[data-act="underlay"],[data-act="geom"],[data-act="wb-menu"]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'wb-menu') { if (wbMenu) closeWbMenu(); else openWbMenu(b); return; }
    if (act === 'rack-edit') openRackEditor(b.getAttribute('data-id'));
    else if (act === 'geom') toggleGeom();
    else { if (gp) toggleGeom(false); togglePanel(); }
  });
  TX.on('state', function (p) {
    var ch = (p && p.changed) || [];
    if (ch.indexOf('floor') >= 0) { stopCalib(); renderPanel(); tool.pts = []; drawPreview(); renderGeom(); }
    if (ch.indexOf('view') >= 0 && gp && TX.state.view === '3d') toggleGeom(false);
  });
  TX.on('close', function () { togglePanel(false); toggleGeom(false); closeModal(); closeMatch(); });
  TX.on('model', function () { if (panel) renderPanel(); if (gp) renderGeom(); });

  TX.workbench = { openRackEditor: openRackEditor, toggleUnderlayPanel: togglePanel, startCalibration: startCalib, toggleGeomPanel: toggleGeom };
})();
