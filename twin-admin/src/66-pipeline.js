/* ============================================================
   TwinX 66-pipeline (통합 리드) — 디지털트윈 제작 파이프라인 보강
   [상위 목표] 현장에서 확보 가능한 자료만으로 「대시보드와 연계된 트윈」을 만든다.
   1단계 구조화 : 현장 사진 조사(전경·명판·모듈) · PDF 도면 · 도면이 없으면 자동 작도
   2단계 검증   : 사진·명판·모델명 누락, 측정 행 숫자·판정 검사 (추측값은 채우지 않음)
   3단계 산출   : 라이저도·개통도(SVG/PNG), 현장 사진 ZIP(표준 파일명), 점검 결과서 → ADMIN 측정 엑셀
   외부 네트워크 없이 동작: pdf.js 는 빌드 시 인라인(text/plain)되어 필요할 때만 실행.
   저장소: IndexedDB 'twinx_photo_v1' (사진)
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.pipe) return;
  var U = TX.util, esc = U.esc;
  function toast(m, k) { TX.emit('toast', { msg: m, kind: k || 'info' }); }
  function root() { return (TX.ui && TX.ui.root) || document.body; }
  function Q() { return TX.quick && TX.quick._; }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function stamp() { var d = new Date(); return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2); }
  function pickFile(accept, cb, opt) {
    var i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none';
    if (opt && opt.capture) i.setAttribute('capture', 'environment');
    if (opt && opt.multiple) i.multiple = true;
    i.onchange = function () { var fs = Array.prototype.slice.call(i.files || []); i.remove(); if (fs.length) cb(opt && opt.many ? fs : fs[0]); };
    document.body.appendChild(i); i.click();
  }

  /* ================= pdf.js (오프라인 인라인, 지연 로딩) ================= */
  var pdfP = null;
  function pdfLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfP) return pdfP;
    pdfP = new Promise(function (res, rej) {
      var lib = document.getElementById('twinx-pdfjs'), wk = document.getElementById('twinx-pdfworker');
      if (!lib || !wk) { rej(new Error('PDF 엔진이 포함되지 않은 빌드입니다')); return; }
      var s = document.createElement('script');
      s.src = URL.createObjectURL(new Blob([lib.textContent], { type: 'text/javascript' }));
      s.onload = function () {
        var L = window.pdfjsLib || (window['pdfjs-dist/build/pdf']);
        if (!L) { rej(new Error('PDF 엔진 초기화 실패')); return; }
        window.pdfjsLib = L;
        L.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([wk.textContent], { type: 'text/javascript' }));
        res(L);
      };
      s.onerror = function () { rej(new Error('PDF 엔진 로딩 실패')); };
      document.head.appendChild(s);
    });
    pdfP.catch(function () { pdfP = null; });
    return pdfP;
  }
  // 한글 CID 글꼴용 CMap (Adobe-Korea1 · KSC · UniKS) — 빌드 시 인라인, 네트워크 요청 없음
  var cmaps = null;
  function InlineCMaps() { }
  InlineCMaps.prototype.fetch = function (o) {
    if (!cmaps) { try { cmaps = JSON.parse((document.getElementById('twinx-pdfcmaps') || {}).textContent || '{}'); } catch (e) { cmaps = {}; } }
    var b = cmaps[o.name]; if (!b) return Promise.reject(new Error('CMap 없음: ' + o.name));
    var bin = atob(b), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return Promise.resolve({ cMapData: u, compressionType: 1 });
  };
  function openPdf(file) { return Promise.all([pdfLib(), file.arrayBuffer()]).then(function (r) { return r[0].getDocument({ data: new Uint8Array(r[1]), isEvalSupported: false, cMapUrl: 'inline/', cMapPacked: true, CMapReaderFactory: InlineCMaps, useWorkerFetch: false }).promise; }); }
  /** PDF 한 페이지 → PNG File (장변 최대 4000px) */
  function pdfToImage(file, pageNo) {
    return openPdf(file).then(function (doc) {
      var n = pageNo;
      if (!n) { n = 1; if (doc.numPages > 1) { var a = prompt('PDF가 ' + doc.numPages + '쪽입니다. 도면으로 쓸 페이지 번호를 입력하세요', '1'); if (a === null) return null; n = Math.min(doc.numPages, Math.max(1, parseInt(a, 10) || 1)); } }
      return doc.getPage(n).then(function (pg) {
        var v1 = pg.getViewport({ scale: 1 }), sc = Math.min(6, 4000 / Math.max(v1.width, v1.height)), vp = pg.getViewport({ scale: sc });
        var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        return pg.render({ canvasContext: g, viewport: vp }).promise.then(function () {
          return new Promise(function (res) { c.toBlob(function (b) { res(new File([b], file.name.replace(/\.pdf$/i, '') + '_p' + n + '.png', { type: 'image/png' })); }, 'image/png'); });
        });
      });
    });
  }
  /** PDF 텍스트 → 표(행·열) 추정: 같은 높이 글자 = 한 행, 가로 간격이 크면 다음 칸 */
  function pdfTables(file) {
    return openPdf(file).then(function (doc) {
      var pages = []; for (var i = 1; i <= Math.min(doc.numPages, 60); i++) pages.push(i);
      return Promise.all(pages.map(function (n) { return doc.getPage(n).then(function (p) { return p.getTextContent(); }); })).then(function (cs) {
        var rows = [];
        cs.forEach(function (tc) {
          var items = tc.items.filter(function (it) { return it.str && it.str.trim(); }).map(function (it) { return { s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || it.str.length * 5, h: Math.abs(it.transform[3]) || 8 }; });
          items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
          var lines = [];
          items.forEach(function (it) { var L = lines.find(function (l) { return Math.abs(l.y - it.y) <= Math.max(2.5, it.h * 0.35); }); if (L) L.items.push(it); else lines.push({ y: it.y, items: [it] }); });
          lines.forEach(function (l) {
            l.items.sort(function (a, b) { return a.x - b.x; });
            var cells = [], cur = null;
            l.items.forEach(function (it) {
              if (cur && it.x - (cur.x1) < Math.max(4, it.h * 0.9)) { cur.s += (it.x - cur.x1 > it.h * 0.2 ? ' ' : '') + it.s; cur.x1 = it.x + it.w; }
              else { cur = { s: it.s, x0: it.x, x1: it.x + it.w }; cells.push(cur); }
            });
            rows.push(cells.map(function (c) { return c.s.trim(); }));
          });
        });
        return [{ name: 'PDF 본문 (' + doc.numPages + '쪽)', rows: rows }];
      });
    });
  }

  /* ================= ZIP 읽기 (xlsx · docx) — DecompressionStream 사용 ================= */
  function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('이 브라우저는 압축 해제를 지원하지 않습니다 (최신 Chrome·Edge 사용)'));
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter(); w.write(u8); w.close();
    return new Response(ds.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function unzip(buf, want) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error('압축 파일 형식이 아닙니다 (.xls/.hwp 는 .xlsx/.pdf 로 저장 후 올리세요)'));
    var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true), out = {}, jobs = [], dec = new TextDecoder();
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), loff = dv.getUint32(off + 42, true);
      var name = dec.decode(u8.subarray(off + 46, off + 46 + nlen));
      off += 46 + nlen + elen + clen;
      if (want && !want(name)) continue;
      var ds = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true), data = u8.subarray(ds, ds + csize);
      (function (name, method, data) { jobs.push((method === 0 ? Promise.resolve(data) : method === 8 ? inflateRaw(data) : Promise.reject(new Error('지원하지 않는 압축 방식'))).then(function (d) { out[name] = d; })); })(name, method, data);
    }
    return Promise.all(jobs).then(function () { return out; });
  }
  function xml(u8) { return new DOMParser().parseFromString(new TextDecoder().decode(u8), 'application/xml'); }
  function byTag(node, tag) { return Array.prototype.slice.call(node.getElementsByTagNameNS('*', tag)); }
  function colIdx(ref) { var m = /^([A-Z]+)/.exec(ref || ''), n = 0; if (!m) return -1; for (var i = 0; i < m[1].length; i++) n = n * 26 + m[1].charCodeAt(i) - 64; return n - 1; }
  function readXlsx(buf) {
    return unzip(buf, function (n) { return /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n); }).then(function (f) {
      if (!f['xl/workbook.xml']) throw new Error('엑셀(xlsx) 파일이 아닙니다');
      var ss = f['xl/sharedStrings.xml'] ? byTag(xml(f['xl/sharedStrings.xml']), 'si').map(function (si) { return byTag(si, 't').map(function (t) { return t.textContent; }).join(''); }) : [];
      var rel = {}; if (f['xl/_rels/workbook.xml.rels']) byTag(xml(f['xl/_rels/workbook.xml.rels']), 'Relationship').forEach(function (r) { rel[r.getAttribute('Id')] = r.getAttribute('Target'); });
      return byTag(xml(f['xl/workbook.xml']), 'sheet').map(function (s) {
        var rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        var t = (rel[rid] || '').replace(/^\/?xl\//, '').replace(/^\//, ''), d = f['xl/' + t];
        var rows = [];
        if (d) byTag(xml(d), 'row').forEach(function (r) {
          var ri = (parseInt(r.getAttribute('r'), 10) || rows.length + 1) - 1, row = [];
          byTag(r, 'c').forEach(function (c) {
            var ty = c.getAttribute('t'), v = byTag(c, 'v')[0], val;
            if (ty === 's') val = v ? ss[+v.textContent] || '' : '';
            else if (ty === 'inlineStr') val = byTag(c, 't').map(function (t) { return t.textContent; }).join('');
            else if (ty === 'b') val = v && v.textContent === '1' ? 'TRUE' : 'FALSE';
            else val = v ? v.textContent : '';
            var ci = colIdx(c.getAttribute('r')); if (ci < 0) ci = row.length;
            row[ci] = val;
          });
          for (var j = 0; j < row.length; j++) if (row[j] == null) row[j] = '';
          rows[ri] = row;
        });
        for (var j = 0; j < rows.length; j++) if (!rows[j]) rows[j] = [];
        return { name: s.getAttribute('name'), rows: rows };
      });
    });
  }
  function readDocx(buf) {
    return unzip(buf, function (n) { return n === 'word/document.xml'; }).then(function (f) {
      if (!f['word/document.xml']) throw new Error('워드(docx) 파일이 아닙니다');
      var doc = xml(f['word/document.xml']), out = [];
      byTag(doc, 'tbl').forEach(function (tb, ti) {
        for (var an = tb.parentNode; an; an = an.parentNode) if (an.localName === 'tc') return; // 중첩표 생략
        var rows = [], prev = [];
        Array.prototype.slice.call(tb.childNodes).filter(function (n) { return n.localName === 'tr'; }).forEach(function (tr) {
          var row = [];
          Array.prototype.slice.call(tr.childNodes).filter(function (n) { return n.localName === 'tc'; }).forEach(function (tc) {
            var txt = byTag(tc, 'p').map(function (p) { return byTag(p, 't').map(function (t) { return t.textContent; }).join(''); }).filter(Boolean).join(' ').trim();
            var gs = byTag(tc, 'gridSpan')[0], span = gs ? parseInt(gs.getAttribute('w:val') || gs.getAttributeNS('*', 'val') || '1', 10) || 1 : 1;
            var vm = byTag(tc, 'vMerge')[0], cont = vm && (vm.getAttribute('w:val') || 'continue') === 'continue';
            if (cont && !txt) txt = prev[row.length] || '';
            row.push(txt); for (var s = 1; s < span; s++) row.push(txt);
          });
          rows.push(row); prev = row;
        });
        if (rows.length) out.push({ name: '표 ' + (ti + 1) + ' (' + rows.length + '행)', rows: rows });
      });
      if (!out.length) throw new Error('워드 문서에서 표를 찾지 못했습니다');
      return out;
    });
  }
  function readCsv(text) {
    var rows = [], row = [], cur = '', q = false, sep = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return [{ name: 'CSV', rows: rows }];
  }
  function readAny(file) {
    var n = file.name.toLowerCase();
    if (/\.pdf$/.test(n)) return pdfTables(file);
    if (/\.csv$|\.tsv$|\.txt$/.test(n)) return file.text().then(readCsv);
    if (/\.docx$/.test(n)) return file.arrayBuffer().then(readDocx);
    if (/\.xlsx$|\.xlsm$/.test(n)) return file.arrayBuffer().then(readXlsx);
    if (/\.xls$/.test(n)) return Promise.reject(new Error('구형 .xls 는 엑셀에서 「다른 이름으로 저장 → .xlsx」 후 올려 주세요'));
    if (/\.hwp$|\.hwpx$/.test(n)) return Promise.reject(new Error('한글(HWP) 문서는 「PDF로 저장」 후 올려 주세요'));
    if (/\.doc$/.test(n)) return Promise.reject(new Error('구형 .doc 는 워드에서 .docx 로 저장 후 올려 주세요'));
    return Promise.reject(new Error('지원 형식: xlsx · csv · docx · pdf'));
  }

  /* ================= 현장 사진 조사 (전경 · 명판 · 모듈 모델명) ================= */
  var SLOTS = [['full', '설비 전경', '설비 전체가 한 장에 들어오게 (랙이면 전면 전체)', 1], ['plate', '명판', '모델명·S/N·제조사가 읽히도록 정면 근접 촬영', 2], ['module', '모듈 모델명', '카드·모듈별 모델명 표기 (최대 8장)', 8]];
  var SLOT_NO = { full: '01_전경', plate: '02_명판', module: '03_모듈' };
  var dbP = null, index = {}; // index[assetId] = {full:n, plate:n, module:n}
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('IndexedDB 없음')); return; }
      var r = indexedDB.open('twinx_photo_v1', 1);
      r.onupgradeneeded = function () { var s = r.result.createObjectStore('photos', { keyPath: 'key' }); s.createIndex('asset', 'asset'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return dbP;
  }
  function tx(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('photos', mode), s = t.objectStore('photos'), out = fn(s); t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { rej(t.error); }; }); }); }
  function allPhotos() { return tx('readonly', function (s) { return s.getAll(); }); }
  function photosOf(id) { return db().then(function (d) { return new Promise(function (res) { var r = d.transaction('photos').objectStore('photos').index('asset').getAll(id); r.onsuccess = function () { res(r.result || []); }; r.onerror = function () { res([]); }; }); }); }
  function reindex() { return allPhotos().then(function (all) { index = {}; all.forEach(function (p) { var o = index[p.asset] = index[p.asset] || { full: 0, plate: 0, module: 0 }; o[p.slot]++; }); }).catch(function () { }); }
  function count(id) { var o = index[id] || { full: 0, plate: 0, module: 0 }; return { full: o.full, plate: o.plate, module: o.module, total: o.full + o.plate + o.module }; }
  function shrink(file, max) {
    return new Promise(function (res, rej) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, (max || 1600) / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u); c.toBlob(function (b) { res({ blob: b, w: c.width, h: c.height }); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('이미지를 읽지 못했습니다')); };
      img.src = u;
    });
  }
  function addPhotos(id, slot, files) {
    return photosOf(id).then(function (have) {
      var lim = SLOTS.find(function (s) { return s[0] === slot; })[3], cur = have.filter(function (p) { return p.slot === slot; });
      var room = Math.max(0, lim - (lim === 1 ? 0 : cur.length)); files = files.slice(0, lim === 1 ? 1 : room);
      if (!files.length) { toast('이 항목은 최대 ' + lim + '장입니다', 'warn'); return 0; }
      return Promise.all(files.map(function (f) { return shrink(f, slot === 'full' ? 1600 : 2000); })).then(function (imgs) {
        return tx('readwrite', function (s) {
          if (lim === 1) cur.forEach(function (p) { s.delete(p.key); });
          var n0 = lim === 1 ? 0 : cur.reduce(function (m, p) { return Math.max(m, p.n); }, 0);
          imgs.forEach(function (im, i) { var n = lim === 1 ? 1 : n0 + i + 1; s.put({ key: id + '|' + slot + '|' + n, asset: id, slot: slot, n: n, blob: im.blob, w: im.w, h: im.h, at: new Date().toISOString(), src: files[i].name }); });
        }).then(function () { return imgs.length; });
      });
    }).then(function (n) { return reindex().then(function () { return n; }); });
  }
  function delPhoto(key) { return tx('readwrite', function (s) { s.delete(key); }).then(reindex); }

  var pm = null, pmId = null, urls = [];
  function closePhotos() { if (pm) { pm.remove(); pm = null; } urls.forEach(URL.revokeObjectURL); urls = []; var q = Q(); if (q) q.refresh(); }
  function draftAsset(id) { var D = TX.quick && TX.quick.draft(); return D && D.assets.find(function (a) { return a.id === id; }); }
  function openPhotos(id) {
    pmId = id; if (!pm) { pm = U.el('div', 'tx-wb-modal tx-pp'); root().appendChild(pm); bindPhotos(); }
    renderPhotos();
  }
  function renderPhotos() {
    if (!pm) return;
    var a = draftAsset(pmId) || TX.asset(pmId) || { id: pmId, name: pmId };
    photosOf(pmId).then(function (ps) {
      urls.forEach(URL.revokeObjectURL); urls = [];
      var h = '<div class="tx-wb-dlg tx-pp-dlg" role="dialog" aria-modal="true" aria-label="현장 사진 조사">' +
        '<div class="tx-wb-hd"><div><small>현장 사진 조사 · 설비 현행화</small><b>' + esc(a.name) + ' <span class="tx-wb-id">' + esc(a.id) + '</span></b></div><button type="button" class="tx-wb-x" data-p="close" aria-label="닫기">✕</button></div>' +
        '<div class="tx-wb-body">' +
        '<p class="tx-wb-guide">촬영 기준: <b>① 전경</b> 설비 전체 1장 → <b>② 명판</b> 모델명·S/N이 읽히게 1장 → <b>③ 모듈</b> 카드·모듈 모델명 표기마다 1장. 휴대폰에서는 버튼을 누르면 바로 카메라가 열립니다.</p>' +
        '<div class="tx-pp-grid">' + SLOTS.map(function (s) {
          var mine = ps.filter(function (p) { return p.slot === s[0]; }).sort(function (x, y) { return x.n - y.n; });
          return '<section class="tx-pp-slot' + (mine.length ? ' is-ok' : '') + '"><header><b>' + s[1] + '</b><span>' + mine.length + '/' + s[3] + '</span></header><small>' + s[2] + '</small>' +
            '<div class="tx-pp-th">' + mine.map(function (p) { var u = URL.createObjectURL(p.blob); urls.push(u); return '<figure><img src="' + u + '" alt="' + esc(s[1]) + '"><figcaption>' + esc(fileName(a.id, p)) + '</figcaption><button type="button" class="tx-pp-del" data-p="del" data-k="' + esc(p.key) + '" aria-label="삭제">✕</button></figure>'; }).join('') + '</div>' +
            '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn' + (mine.length ? '' : ' tx-wb-pri') + '" data-p="cam" data-s="' + s[0] + '">📷 촬영</button><button type="button" class="tx-wb-link" data-p="file" data-s="' + s[0] + '">파일 선택</button></div></section>';
        }).join('') + '</div>' +
        (draftAsset(pmId) ? '<h5>명판에서 옮겨 적기 <small>(현행화표의 「확인불가」를 채웁니다 · 읽히지 않으면 비워 두세요)</small></h5>' +
          '<div class="tx-pp-form"><label>모델명<input type="text" data-f="model" value="' + esc(a.model || '') + '"></label><label>제조사<input type="text" data-f="maker" value="' + esc(a.maker || '') + '"></label>' +
          '<label>S/N (제조번호)<input type="text" data-f="serial" value="' + esc(a.serial || '') + '"></label><label>제조·설치연도<input type="text" data-f="year" value="' + esc(a.year || '') + '" placeholder="예: 2019"></label>' +
          '<label class="tx-wb-chk"><input type="checkbox" data-f="plateOk"' + (a.plateOk ? ' checked' : '') + '> 명판 대조 완료 (사진과 입력값 일치 확인)</label></div>' : '') +
        '</div><div class="tx-wb-ft"><div class="tx-wb-ft-l"><small>사진은 이 브라우저에만 보관됩니다 · ⑤에서 「현장 사진 ZIP」으로 내보내 보관하세요</small></div><div><button type="button" class="tx-wb-btn tx-wb-pri" data-p="close">완료</button></div></div></div>';
      pm.innerHTML = h;
    });
  }
  function bindPhotos() {
    pm.addEventListener('click', function (e) {
      if (e.target === pm) { closePhotos(); return; }
      var b = e.target.closest('[data-p]'); if (!b) return;
      var a = b.getAttribute('data-p'), s = b.getAttribute('data-s');
      if (a === 'close') closePhotos();
      else if (a === 'cam' || a === 'file') pickFile('image/*', function (fs) { addPhotos(pmId, s, fs).then(function (n) { if (n) toast('사진 ' + n + '장 저장', 'success'); renderPhotos(); }).catch(function (err) { toast('사진 저장 실패: ' + err.message, 'error'); }); }, { capture: a === 'cam', multiple: s === 'module', many: true });
      else if (a === 'del') delPhoto(b.getAttribute('data-k')).then(renderPhotos);
    });
    pm.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-f'), as = draftAsset(pmId); if (!k || !as) return;
      as[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
      var q = Q(); q.save(); q.apply();
    });
    pm.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closePhotos(); } });
  }
  function fileName(id, p) { return id + '_' + SLOT_NO[p.slot] + (p.slot === 'module' ? '-' + p.n : '') + '.jpg'; }
  function photoSheet(D) {
    var rows = [['설비ID', '설비명', '설치 위치', '전경', '명판', '모듈 수', '명판 대조', '모델명', 'S/N', '사진 파일명']];
    D.assets.forEach(function (a) { var c = count(a.id); rows.push([a.id, a.name, a.srcLoc || '', c.full ? 'O' : 'X', c.plate ? 'O' : 'X', c.module, a.plateOk ? '완료' : '미완료', a.model || '', a.serial || '', '']); });
    return rows;
  }
  function exportZip(D) {
    allPhotos().then(function (all) {
      var ids = {}; D.assets.forEach(function (a) { ids[a.id] = a; });
      var mine = all.filter(function (p) { return ids[p.asset]; });
      if (!mine.length) { toast('저장된 현장 사진이 없습니다 (설비별 📷 버튼)', 'warn'); return; }
      return Promise.all(mine.map(function (p) { return p.blob.arrayBuffer().then(function (b) { return { name: fileName(p.asset, p), data: new Uint8Array(b) }; }); })).then(function (files) {
        var list = ['설비ID,설비명,구분,파일명,촬영(등록)일시'].concat(mine.map(function (p) { return [p.asset, '"' + ids[p.asset].name.replace(/"/g, '""') + '"', SLOT_NO[p.slot], fileName(p.asset, p), p.at].join(','); }));
        files.push({ name: '사진목록.csv', data: new TextEncoder().encode('﻿' + list.join('\r\n')) });
        files.mime = 'application/zip';
        U.download(Q().zip(files), 'ICT_Twin_Photos_' + stamp() + '.zip');
        toast('현장 사진 ' + mine.length + '장을 표준 파일명으로 내보냈습니다', 'success');
      });
    });
  }
  function checks(D) {
    var n = D.assets.length; if (!n) return [];
    var full = D.assets.filter(function (a) { return count(a.id).full; }).length, plate = D.assets.filter(function (a) { return count(a.id).plate; }).length;
    var model = D.assets.filter(function (a) { return a.model; }).length, ok = D.assets.filter(function (a) { return a.plateOk; }).length;
    return [['설비 전경 사진 (' + full + '/' + n + ')', full === n], ['명판 사진 (' + plate + '/' + n + ')', plate === n], ['모델명 확인 (' + model + '/' + n + ')', model === n], ['명판 대조 완료 (' + ok + '/' + n + ')', ok === n]];
  }

  /* ================= 라이저도 · 개통도 자동 작도 (현재 모델 기준) ================= */
  var LC = function (t) { return (TX.C && TX.C.LINK && TX.C.LINK[t] ? TX.C.LINK[t].css : '#64748b'); };
  var LN = { optical: '광', data: 'UTP', power: '전원', ground: '접지', path: '경로' };
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function T(x, y, s, o) { o = o || {}; return '<text x="' + x + '" y="' + y + '" font-size="' + (o.size || 11) + '"' + (o.bold ? ' font-weight="700"' : '') + ' fill="' + (o.fill || '#1e293b') + '"' + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') + '>' + esc(s) + '</text>'; }
  function titleBlock(W, H, kind) {
    var M = TX.model, site = (M && M.site && M.site.name) || '사업장';
    return '<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#334155" stroke-width="1.5"/>' +
      '<rect x="' + (W - 341) + '" y="' + (H - 61) + '" width="340" height="60" fill="#fff" stroke="#334155"/>' +
      T(W - 331, H - 40, site, { bold: true, size: 13 }) + T(W - 331, H - 22, kind + ' · 현행화 기반 자체 작도', { size: 11, fill: '#475569' }) + T(W - 331, H - 8, '작성일 ' + U.today() + ' · 축척 없음(계통 표현)', { size: 10, fill: '#64748b' });
  }
  function legend(x, y) {
    return ['optical', 'data', 'power'].map(function (t, i) { return '<line x1="' + (x + i * 90) + '" y1="' + y + '" x2="' + (x + i * 90 + 26) + '" y2="' + y + '" stroke="' + LC(t) + '" stroke-width="3"/>' + T(x + i * 90 + 32, y + 4, LN[t], { size: 11 }); }).join('');
  }
  function riserSVG() {
    var M = TX.model; if (!M || !M.assets.length) return null;
    var blds = []; M.floors.forEach(function (f) { if (blds.indexOf(f.building) < 0) blds.push(f.building); });
    var levels = []; M.floors.forEach(function (f) { if (levels.indexOf(f.level) < 0) levels.push(f.level); }); levels.sort(function (a, b) { return b - a; });
    var byFloor = {}; M.assets.forEach(function (a) { (byFloor[a.floor] = byFloor[a.floor] || []).push(a); });
    var colW = {}, CH = 26, CW = 168;
    blds.forEach(function (b) { var mx = 1; M.floors.filter(function (f) { return f.building === b; }).forEach(function (f) { mx = Math.max(mx, Math.min(4, (byFloor[f.code] || []).length)); }); colW[b] = 70 + Math.max(1, Math.min(2, Math.ceil(mx / 2) + (mx > 1 ? 1 : 0))) * (CW + 10); });
    var rowH = {}; levels.forEach(function (lv) { var mx = 1; M.floors.filter(function (f) { return f.level === lv; }).forEach(function (f) { var n = (byFloor[f.code] || []).length, per = Math.max(1, Math.floor((colW[f.building] - 70) / (CW + 10))); mx = Math.max(mx, Math.ceil(n / per)); }); rowH[lv] = 34 + mx * (CH + 8); });
    var X0 = 90, Y0 = 80, W = X0 + blds.reduce(function (s, b) { return s + colW[b] + 30; }, 0) + 30, H = Y0 + levels.reduce(function (s, l) { return s + rowH[l]; }, 0) + 100;
    W = Math.max(W, 760);
    var pos = {}, o = [], y = Y0, colX = {}, cx = X0;
    blds.forEach(function (b) { colX[b] = cx; cx += colW[b] + 30; });
    o.push(T(24, 36, '라이저도 (수직 간선 계통)', { size: 18, bold: true }), legend(W - 300, 32));
    blds.forEach(function (b) { o.push('<rect x="' + colX[b] + '" y="' + (Y0 - 30) + '" width="' + colW[b] + '" height="24" rx="4" fill="#0f2a4a"/>', T(colX[b] + colW[b] / 2, Y0 - 13, b, { fill: '#fff', bold: true, anchor: 'middle', size: 12 }), T(colX[b] + colW[b] - 8, Y0 - 14, 'EPS/TPS 간선', { fill: '#93c5fd', anchor: 'end', size: 9 })); });
    var spans = {};
    levels.forEach(function (lv) {
      var h = rowH[lv];
      o.push('<line x1="20" y1="' + (y + h) + '" x2="' + (W - 20) + '" y2="' + (y + h) + '" stroke="#cbd5e1" stroke-width="1"/>');
      var nm = (M.floors.find(function (f) { return f.level === lv; }) || {}).name || (lv + '층');
      o.push(T(30, y + h / 2 + 4, nm, { bold: true, size: 13 }));
      blds.forEach(function (b) {
        var f = M.floors.find(function (q) { return q.building === b && q.level === lv; }); if (!f) return;
        var list = byFloor[f.code] || [], rx = colX[b] + 40;
        o.push('<rect x="' + (colX[b] + 22) + '" y="' + (y + h / 2 - 5) + '" width="10" height="10" fill="#0f2a4a"/>');
        spans[b] = spans[b] || [y + h / 2, y + h / 2]; spans[b][0] = Math.min(spans[b][0], y + h / 2); spans[b][1] = Math.max(spans[b][1], y + h / 2);
        var per = Math.max(1, Math.floor((colW[b] - 70) / (CW + 10)));
        list.forEach(function (a, i) {
          var ax = rx + 18 + (i % per) * (CW + 10), ay = y + 17 + Math.floor(i / per) * (CH + 8);
          pos[a.id] = { x: ax, y: ay, cx: ax + CW / 2, cy: ay + CH / 2, l: ax, r: ax + CW };
          var col = a.grade === 'RED' ? '#f43f5e' : a.grade === 'ORANGE' ? '#f59e0b' : '#3e63db';
          o.push('<g><rect x="' + ax + '" y="' + ay + '" width="' + CW + '" height="' + CH + '" rx="4" fill="#fff" stroke="' + col + '" stroke-width="1.4"/><rect x="' + ax + '" y="' + ay + '" width="5" height="' + CH + '" rx="2" fill="' + col + '"/>' +
            T(ax + 10, ay + 11, short(a.name, 20), { size: 10, bold: true }) + T(ax + 10, ay + 22, short([a.model, (M.rooms.find(function (r) { return r.id === a.room; }) || {}).name].filter(Boolean).join(' · '), 26), { size: 8.5, fill: '#64748b' }) + '</g>');
          o.push('<line x1="' + (colX[b] + 32) + '" y1="' + (y + h / 2) + '" x2="' + rx + '" y2="' + (y + h / 2) + '" stroke="#94a3b8" stroke-dasharray="3 2"/>');
        });
      });
      y += h;
    });
    blds.forEach(function (b) { if (spans[b]) o.unshift('<line x1="' + (colX[b] + 27) + '" y1="' + (spans[b][0] - 14) + '" x2="' + (colX[b] + 27) + '" y2="' + (spans[b][1] + 14) + '" stroke="#0f2a4a" stroke-width="5" stroke-linecap="round"/>' ); });
    // 층간 연결만 간선(라이저)을 따라 표시 — 층 내 연결은 개통도에서 확인
    var aF = {}; M.assets.forEach(function (a) { aF[a.id] = a.floor; });
    var cross = M.links.filter(function (l) { return pos[l.from] && pos[l.to] && aF[l.from] !== aF[l.to]; }), inner = M.links.length - cross.length;
    cross.forEach(function (l, i) {
      var a = pos[l.from], b = pos[l.to], fa = M.floors.find(function (f) { return f.code === aF[l.from]; }) || {};
      var tx = colX[fa.building] + 36 + (i % 4) * 4, c = LC(l.type);
      o.push('<path d="M' + a.l + ',' + (a.cy + 3) + ' H' + tx + ' V' + (b.cy + 3) + ' H' + b.l + '" fill="none" stroke="' + c + '" stroke-width="2.2"/><circle cx="' + b.l + '" cy="' + (b.cy + 3) + '" r="3" fill="' + c + '"/>');
    });
    o.push(T(24, H - 20, '층간 연결 ' + cross.length + '건 표시 · 층 내 연결 ' + inner + '건은 개통도 참조', { size: 11, fill: '#475569' }));
    o.push(titleBlock(W, H, '라이저도'));
    return { w: W, h: H, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Arial, \'Noto Sans KR\', sans-serif"><rect width="100%" height="100%" fill="#fff"/>' + o.join('') + '</svg>' };
  }
  function topoSVG() {
    var M = TX.model; if (!M || !M.assets.length) return null;
    var ids = {}; M.assets.forEach(function (a) { ids[a.id] = a; });
    var L = M.links.filter(function (l) { return ids[l.from] && ids[l.to]; });
    var inc = {}, out = {}; L.forEach(function (l) { inc[l.to] = (inc[l.to] || 0) + 1; (out[l.from] = out[l.from] || []).push(l.to); });
    var linked = {}; L.forEach(function (l) { linked[l.from] = linked[l.to] = 1; });
    var depth = {}, roots = M.assets.filter(function (a) { return linked[a.id] && !inc[a.id]; });
    if (!roots.length && L.length) roots = [ids[L[0].from]];
    var qq = roots.map(function (a) { depth[a.id] = 0; return a.id; });
    while (qq.length) { var c = qq.shift(); (out[c] || []).forEach(function (t) { if (depth[t] == null) { depth[t] = depth[c] + 1; qq.push(t); } }); }
    M.assets.forEach(function (a) { if (linked[a.id] && depth[a.id] == null) depth[a.id] = 0; });
    var cols = []; Object.keys(depth).forEach(function (id) { (cols[depth[id]] = cols[depth[id]] || []).push(ids[id]); });
    var fl = function (a) { var f = M.floors.find(function (q) { return q.code === a.floor; }) || {}; return (f.building || '') + ' ' + (f.name || ''); };
    cols.forEach(function (c) { c.sort(function (a, b) { return fl(a).localeCompare(fl(b)) || a.name.localeCompare(b.name); }); });
    var lone = M.assets.filter(function (a) { return !linked[a.id]; });
    var BW = 200, BH = 44, GX = 90, GY = 16, X0 = 40, Y0 = 90;
    var maxRows = Math.max(1, cols.reduce(function (m, c) { return Math.max(m, c.length); }, 0));
    var W = Math.max(760, X0 + cols.length * (BW + GX) + 40 + (lone.length ? BW + 60 : 0)), H = Y0 + Math.max(maxRows, Math.ceil(lone.length)) * (BH + GY) + 110;
    var pos = {}, o = [T(24, 36, '개통도 (설비 연결 계통)', { size: 18, bold: true }), legend(W - 300, 32)];
    var names = ['상위(출발)', '1차 분기', '2차 분기', '3차 분기', '4차 분기'];
    cols.forEach(function (c, ci) {
      var x = X0 + ci * (BW + GX);
      o.push(T(x, Y0 - 14, names[ci] || (ci + '차 분기'), { size: 11, bold: true, fill: '#475569' }));
      c.forEach(function (a, ri) { pos[a.id] = { x: x, y: Y0 + ri * (BH + GY) }; });
    });
    L.forEach(function (l, i) {
      var a = pos[l.from], b = pos[l.to]; if (!a || !b) return;
      var x1 = a.x + BW, y1 = a.y + BH / 2, x2 = b.x, y2 = b.y + BH / 2, mx = x2 > x1 ? (x1 + x2) / 2 : x1 + 30;
      var d = x2 > x1 ? 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 : 'M' + x1 + ',' + y1 + ' H' + (x1 + 20 + i % 4 * 4) + ' V' + (Math.max(a.y, b.y) + BH + 8) + ' H' + (x2 - 20) + ' V' + y2 + ' H' + x2;
      o.push('<path d="' + d + '" fill="none" stroke="' + LC(l.type) + '" stroke-width="2.2"/>' + '<circle cx="' + x2 + '" cy="' + y2 + '" r="3" fill="' + LC(l.type) + '"/>');
      if (l.cable) o.push(T((x1 + x2) / 2, (y1 + y2) / 2 - 4, short(l.cable, 14), { size: 9, fill: '#64748b', anchor: 'middle' }));
    });
    function box(a, x, y, dim) {
      var col = a.grade === 'RED' ? '#f43f5e' : a.grade === 'ORANGE' ? '#f59e0b' : dim ? '#94a3b8' : '#0f2a4a';
      return '<g><rect x="' + x + '" y="' + y + '" width="' + BW + '" height="' + BH + '" rx="6" fill="' + (dim ? '#f8fafc' : '#fff') + '" stroke="' + col + '" stroke-width="1.5"/><rect x="' + x + '" y="' + y + '" width="6" height="' + BH + '" rx="3" fill="' + col + '"/>' +
        T(x + 12, y + 15, short(a.name, 22), { size: 11, bold: true }) + T(x + 12, y + 28, short(a.model || '모델 미확인', 28), { size: 9, fill: a.model ? '#475569' : '#f43f5e' }) + T(x + 12, y + 39, short(fl(a) + ' · ' + a.id, 32), { size: 8.5, fill: '#94a3b8' }) + '</g>';
    }
    Object.keys(pos).forEach(function (id) { o.push(box(ids[id], pos[id].x, pos[id].y)); });
    if (lone.length) {
      var lx = W - BW - 40; o.push(T(lx, Y0 - 14, '미연결 설비 ' + lone.length + '대 (연결 정보 필요)', { size: 11, bold: true, fill: '#f43f5e' }));
      lone.forEach(function (a, i) { o.push(box(a, lx, Y0 + i * (BH + GY), true)); });
    }
    o.push(titleBlock(W, H, '개통도'));
    return { w: W, h: H, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Arial, \'Noto Sans KR\', sans-serif"><rect width="100%" height="100%" fill="#fff"/>' + o.join('') + '</svg>' };
  }
  var dg = null, dgTab = 'riser';
  function openDiagrams(tab) {
    if (tab) dgTab = tab;
    if (!dg) {
      dg = U.el('div', 'tx-wb-modal tx-dg'); root().appendChild(dg);
      dg.addEventListener('click', function (e) {
        if (e.target === dg) { dg.remove(); dg = null; return; }
        var b = e.target.closest('[data-d]'); if (!b) return; var a = b.getAttribute('data-d');
        if (a === 'close') { dg.remove(); dg = null; }
        else if (a === 'tab') { dgTab = b.getAttribute('data-k'); renderDiagrams(); }
        else if (a === 'svg' || a === 'png') exportDiagram(a);
      });
      dg.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); dg.remove(); dg = null; } });
    }
    renderDiagrams();
  }
  function curDiagram() { return dgTab === 'riser' ? riserSVG() : topoSVG(); }
  function renderDiagrams() {
    var d = curDiagram(), M = TX.model;
    dg.innerHTML = '<div class="tx-wb-dlg tx-dg-dlg" role="dialog" aria-modal="true" aria-label="라이저도·개통도">' +
      '<div class="tx-wb-hd"><div><small>현행화 자료 기반 자동 작도 · ' + esc((M && M.source) === 'quick' ? '간이 현행화 초안' : 'ADMIN 등록 자료') + '</small><b>' + (dgTab === 'riser' ? '라이저도 (층별 간선 계통)' : '개통도 (설비 연결 계통)') + '</b></div><button type="button" class="tx-wb-x" data-d="close" aria-label="닫기">✕</button></div>' +
      '<div class="tx-dg-tabs"><button type="button" data-d="tab" data-k="riser" class="' + (dgTab === 'riser' ? 'is-on' : '') + '">라이저도</button><button type="button" data-d="tab" data-k="topo" class="' + (dgTab === 'topo' ? 'is-on' : '') + '">개통도</button></div>' +
      '<div class="tx-wb-body tx-dg-body">' + (d ? d.svg : '<p class="tx-wb-empty">설비가 없습니다</p>') + '</div>' +
      '<div class="tx-wb-ft"><div class="tx-wb-ft-l"><small>모델명 미확인 설비는 붉게, 연결이 없는 설비는 「미연결」로 따로 표시됩니다 (추정 연결은 그리지 않음)</small></div><div><button type="button" class="tx-wb-btn" data-d="svg">SVG 저장</button><button type="button" class="tx-wb-btn tx-wb-pri" data-d="png">PNG 저장</button></div></div></div>';
  }
  function exportDiagram(kind) {
    var d = curDiagram(); if (!d) return;
    var name = 'ICT_Twin_' + (dgTab === 'riser' ? 'Riser' : 'Topology') + '_' + stamp();
    if (kind === 'svg') { U.download(new Blob([d.svg], { type: 'image/svg+xml' }), name + '.svg'); return; }
    var img = new Image(), u = URL.createObjectURL(new Blob([d.svg], { type: 'image/svg+xml' }));
    img.onload = function () { var c = document.createElement('canvas'), k = 2; c.width = d.w * k; c.height = d.h * k; var g = c.getContext('2d'); g.scale(k, k); g.drawImage(img, 0, 0); URL.revokeObjectURL(u); c.toBlob(function (b) { U.download(b, name + '.png'); }, 'image/png'); };
    img.src = u;
  }

  /* ================= 점검 결과서 (Word · PDF · 엑셀) → ADMIN 측정 엑셀 ================= */
  var MCOLS = ['건물', '층', '점검 위치', '설비', '측정 항목', '측정값', '단위', '기준', '판정'];
  var SYN = { '건물': /건물|동\b|관\b/, '층': /^층$|층수|층\s*명|floor/i, '점검 위치': /위치|장소|실\s*명|구역|점검\s*개소/, '설비': /설비|장비|시스템|기기/, '측정 항목': /항목|측정\s*내용|점검\s*내용|시험\s*항목/, '측정값': /측정\s*값|측정치|결과\s*값|측정\s*결과|^값$|수치/, '단위': /단위/, '기준': /기준|허용|규격\s*값|판정\s*기준/, '판정': /판정|적부|합부|결과$|양호|적합\s*여부/ };
  function headerRow(rows) {
    var best = -1, bs = 0;
    for (var i = 0; i < Math.min(rows.length, 20); i++) {
      var sc = 0, used = {};
      (rows[i] || []).forEach(function (v) { v = String(v || '').trim(); if (!v || v.length > 20) return; MCOLS.forEach(function (k) { if (!used[k] && SYN[k].test(v)) { used[k] = 1; sc++; } }); });
      if (sc > bs) { bs = sc; best = i; }
    }
    return bs >= 2 ? best : -1;
  }
  function guessMap(head) {
    var map = {}, taken = {};
    ['측정값', '측정 항목', '판정', '기준', '단위', '점검 위치', '설비', '층', '건물'].forEach(function (k) {
      var i = head.findIndex(function (v, j) { return !taken[j] && SYN[k].test(String(v || '').trim()); });
      if (i >= 0) { map[k] = i; taken[i] = 1; }
    });
    return map;
  }
  function normJudge(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^(양호|적합|정상|합격|이상\s*없음|ok|pass|o|○)$/i.test(v)) return '양호';
    if (/^(불량|부적합|불합격|ng|fail|x|×|이상)$/i.test(v)) return '불량';
    if (/주의|경고|관찰|보통/.test(v)) return '주의';
    if (/해당\s*없음|n\/?a|^-$|미측정|제외/i.test(v)) return '해당없음';
    return v;
  }
  var R = { file: null, tables: [], ti: 0, hi: 0, map: {}, def: { building: '', floor: '', location: '', equip: '' }, rows: [], match: {} };
  function convert() {
    var t = R.tables[R.ti]; if (!t) { R.rows = []; return; }
    var body = t.rows.slice(R.hi + 1), out = [], M = TX.model, last = {};
    body.forEach(function (r, i) {
      if (!r || !r.some(function (v) { return String(v || '').trim(); })) return;
      var g = function (k) { return R.map[k] != null ? String(r[R.map[k]] == null ? '' : r[R.map[k]]).trim() : ''; };
      var o = { src: i + R.hi + 2, issues: [] };
      o['건물'] = g('건물') || R.def.building; o['층'] = g('층') || R.def.floor; o['점검 위치'] = g('점검 위치') || R.def.location; o['설비'] = g('설비') || R.def.equip;
      // 「본관 7층 EPS실」처럼 위치 한 칸에 건물·층이 함께 적힌 결과서
      if (R.map['건물'] == null && R.map['층'] == null && o['점검 위치'] && /(\d+\s*층|지하\s*\d|B\d+|옥상)/i.test(o['점검 위치']) && TX.quick) {
        var L = TX.quick.parseLoc(o['점검 위치']); o['건물'] = L.building || o['건물']; o['층'] = L.floorName; o['점검 위치'] = L.room || o['점검 위치'];
      }
      // 병합 셀(빈칸) → 위 행 값 이어받기 (문서 표에서 흔함)
      ['건물', '층', '점검 위치', '설비'].forEach(function (k) { if (!o[k] && last[k]) o[k] = last[k]; last[k] = o[k]; });
      o['측정 항목'] = g('측정 항목');
      var raw = g('측정값'), num = U.num(raw), unit = g('단위');
      if (!unit && raw && num != null) unit = raw.replace(/,/g, '').replace(/-?\d+(\.\d+)?/, '').replace(/^\s+|\s+$/g, '').slice(0, 8);
      o['측정값'] = num; o['단위'] = unit; o['기준'] = g('기준'); o['판정'] = normJudge(g('판정'));
      o.raw = raw;
      if (!o['측정 항목']) o.issues.push('측정 항목 없음');
      if (num == null) o.issues.push(raw ? '측정값이 숫자가 아님(' + short(raw, 12) + ')' : '측정값 없음');
      if (!o['판정']) { o.issues.push('판정 없음 → 「해당없음」'); o['판정'] = '해당없음'; }
      else if (['양호', '불량', '주의', '해당없음'].indexOf(o['판정']) < 0) o.issues.push('판정값 「' + o['판정'] + '」 확인 필요');
      if (!o['건물'] || !o['층']) o.issues.push('건물·층 없음 (기본값 입력)');
      o.ok = !!o['측정 항목'] && num != null && ['양호', '불량', '주의', '해당없음'].indexOf(o['판정']) >= 0 && !!o['건물'] && !!o['층'];
      o.asset = M ? matchAsset(o, M) : null;
      out.push(o);
    });
    R.rows = out;
  }
  function tokens(s) { return String(s || '').toLowerCase().replace(/[()\[\]#·,\/]/g, ' ').split(/\s+/).filter(function (t) { return t.length >= 2; }); }
  function matchAsset(o, M) {
    var key = [o['건물'], o['층'], o['점검 위치'], o['설비']].join('|');
    if (R.match[key] !== undefined) return R.match[key];
    var lv = (TX.quick && TX.quick.parseLoc) ? TX.quick.parseLoc(o['건물'] + ' ' + o['층']).level : null;
    var et = tokens(o['설비'] + ' ' + o['점검 위치']), best = null, bs = 0;
    M.assets.forEach(function (a) {
      var f = M.floors.find(function (q) { return q.code === a.floor; }) || {}, r = M.rooms.find(function (q) { return q.id === a.room; }) || {};
      var sc = 0;
      if (f.building && o['건물'] && (f.building.indexOf(o['건물']) >= 0 || o['건물'].indexOf(f.building) >= 0)) sc += 2;
      if (lv != null && f.level === lv) sc += 2;
      if (r.name && o['점검 위치'] && (r.name.indexOf(o['점검 위치']) >= 0 || o['점검 위치'].indexOf(r.name) >= 0)) sc += 2;
      var at = tokens(a.name + ' ' + (a.model || '') + ' ' + (a.category || ''));
      et.forEach(function (t) { if (at.some(function (x) { return x.indexOf(t) >= 0 || t.indexOf(x) >= 0; })) sc += 3; });
      var no = /#\s*(\d+)/.exec(o['설비'] || ''), an = /#\s*(\d+)/.exec(a.name || '');
      if (no && an) sc += no[1] === an[1] ? 2 : -2;
      if (o['설비'] && a.name === o['설비']) sc += 3;
      if (sc > bs) { bs = sc; best = a.id; }
    });
    var v = bs >= 5 ? best : null; R.match[key] = v; return v;
  }
  function measureSheets() {
    var ok = R.rows.filter(function (o) { return o.ok; }), M = TX.model;
    var meas = [MCOLS.slice()], link = [['원본키', '측정행', '측정ID', '설비ID', '실코드']], bad = [['원본 행', '측정 항목', '측정값(원문)', '문제']];
    ok.forEach(function (o, i) {
      var vals = MCOLS.map(function (k) { return o[k] == null ? '' : o[k]; });
      meas.push(vals);
      var a = o.asset && M && M.assets.find(function (x) { return x.id === o.asset; });
      link.push([JSON.stringify(vals.map(function (v) { return String(v); })), i + 2, '', a ? a.id : '', a ? a.room || '' : '']);
    });
    R.rows.forEach(function (o) { if (o.issues.length) bad.push([o.src, o['측정 항목'] || '', o.raw || '', o.issues.join(' / ') + (o.ok ? ' (등록됨)' : ' (제외)')]); });
    return [['측정값 데이터', meas], ['트윈연결', link], ['변환검증', bad]];
  }
  var rp = null;
  function openReport() {
    if (!rp) { rp = U.el('div', 'tx-wb-modal tx-rp'); root().appendChild(rp); bindReport(); }
    var M = TX.model; if (M && M.floors[0] && !R.def.building) R.def.building = M.floors[0].building || '';
    renderReport();
  }
  function closeReport() { if (rp) { rp.remove(); rp = null; } }
  function renderReport() {
    if (!rp) return;
    var t = R.tables[R.ti], head = t ? t.rows[R.hi] || [] : [], ok = R.rows.filter(function (o) { return o.ok; }).length, iss = R.rows.filter(function (o) { return o.issues.length; }).length, mt = R.rows.filter(function (o) { return o.ok && o.asset; }).length;
    var M = TX.model, opts = function (sel) { return '<option value="">—</option>' + (M ? M.assets.map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(short(a.name, 24) + ' · ' + a.id) + '</option>'; }).join('') : ''); };
    var h = '<div class="tx-wb-dlg tx-rp-dlg" role="dialog" aria-modal="true" aria-label="점검 결과서 변환">' +
      '<div class="tx-wb-hd"><div><small>점검 결과서(워드·PDF·엑셀) → ADMIN 측정 엑셀 · 대시보드 연계</small><b>' + (R.file ? esc(R.file.name) : '점검 결과서 변환') + '</b></div><button type="button" class="tx-wb-x" data-r="close" aria-label="닫기">✕</button></div>' +
      '<div class="tx-wb-body">' +
      '<ol class="tx-rp-flow"><li class="' + (R.file ? 'ok' : 'on') + '">① 파일 읽기</li><li class="' + (R.file ? 'on' : '') + '">② 열 맞춤</li><li class="' + (R.rows.length ? 'on' : '') + '">③ 검증·설비 연결</li><li>④ 측정 엑셀 → ADMIN 등록</li></ol>';
    if (!R.file) {
      h += '<p class="tx-wb-guide">점검 결과서 파일을 올리세요. <b>엑셀(xlsx·csv)</b>은 그대로, <b>워드(docx)</b>는 문서 안의 표를, <b>PDF</b>는 글자 위치로 표를 복원합니다. 한글(HWP)은 PDF로 저장 후 올리세요. 스캔(사진) PDF는 글자가 없어 읽을 수 없습니다.</p>' +
        '<div class="tx-wb-acts"><button type="button" class="tx-wb-btn tx-wb-pri" data-r="file">결과서 파일 선택</button></div>';
    } else {
      h += '<div class="tx-rp-row"><label>표 선택<select data-r="table">' + R.tables.map(function (x, i) { return '<option value="' + i + '"' + (i === R.ti ? ' selected' : '') + '>' + esc(x.name) + ' · ' + x.rows.length + '행</option>'; }).join('') + '</select></label>' +
        '<label>머리글 행<input type="number" min="1" data-r="hi" value="' + (R.hi + 1) + '"></label><button type="button" class="tx-wb-link" data-r="file">다른 파일</button></div>' +
        '<h5>열 맞춤 <small>(머리글: ' + esc(head.filter(Boolean).slice(0, 10).join(' | ')) + ')</small></h5>' +
        '<div class="tx-rp-map">' + MCOLS.map(function (k) { return '<label>' + k + '<select data-r="map" data-k="' + k + '"><option value="">(없음)</option>' + head.map(function (v, i) { return '<option value="' + i + '"' + (R.map[k] === i ? ' selected' : '') + '>' + esc(colLetter(i) + ' · ' + short(v || '', 14)) + '</option>'; }).join('') + '</select></label>'; }).join('') + '</div>' +
        '<div class="tx-rp-row"><label>기본 건물<input type="text" data-r="def" data-k="building" value="' + esc(R.def.building) + '" placeholder="열이 없을 때"></label><label>기본 층<input type="text" data-r="def" data-k="floor" value="' + esc(R.def.floor) + '" placeholder="예: 7층"></label>' +
        '<label>기본 점검 위치<input type="text" data-r="def" data-k="location" value="' + esc(R.def.location) + '"></label><label>기본 설비<input type="text" data-r="def" data-k="equip" value="' + esc(R.def.equip) + '"></label></div>' +
        '<div class="tx-rp-sum"><span class="ok">등록 가능 ' + ok + '</span><span class="ng">제외 ' + (R.rows.length - ok) + '</span><span class="warn">확인 사항 ' + iss + '</span><span>설비 연결 ' + mt + '/' + ok + '</span></div>' +
        '<div class="tx-rp-tbl"><table><thead><tr><th>행</th>' + MCOLS.map(function (k) { return '<th>' + k + '</th>'; }).join('') + '<th>트윈 설비</th><th>검증</th></tr></thead><tbody>' +
        R.rows.slice(0, 200).map(function (o, i) {
          return '<tr class="' + (o.ok ? '' : 'is-bad') + '"><td>' + o.src + '</td>' + MCOLS.map(function (k) { return '<td>' + esc(o[k] == null ? '' : o[k]) + '</td>'; }).join('') +
            '<td>' + (o.ok ? '<select data-r="asset" data-i="' + i + '">' + opts(o.asset) + '</select>' : '') + '</td><td class="tx-rp-iss">' + esc(o.issues.join(' / ') || '✔') + '</td></tr>';
        }).join('') + '</tbody></table>' + (R.rows.length > 200 ? '<p class="tx-wb-help">앞 200행만 표시 (내보내기는 전체)</p>' : '') + '</div>' +
        '<p class="tx-wb-help">추정값을 채우지 않습니다: 숫자가 아닌 측정값·측정 항목이 없는 행은 제외되고 「변환검증」 시트에 사유가 남습니다. 판정이 비어 있으면 「해당없음」으로 등록됩니다.</p>';
    }
    h += '</div><div class="tx-wb-ft"><div class="tx-wb-ft-l"><small>ADMIN 측정 엑셀 등록은 기존 측정자료를 교체합니다 (등록 전 확인창에서 점검일 선택)</small></div><div>' +
      '<button type="button" class="tx-wb-btn" data-r="xlsx"' + (ok ? '' : ' disabled') + '>측정 엑셀 저장</button><button type="button" class="tx-wb-btn tx-wb-pri" data-r="admin"' + (ok ? '' : ' disabled') + '>ADMIN 측정 등록으로 보내기</button></div></div></div>';
    rp.innerHTML = h;
  }
  function colLetter(i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function loadReport(file) {
    toast('결과서를 읽는 중…');
    readAny(file).then(function (tables) {
      tables = tables.filter(function (t) { return t.rows.length > 1; });
      if (!tables.length) throw new Error('표 형태의 내용을 찾지 못했습니다');
      // 머리글이 가장 잘 맞는 표를 기본 선택
      var best = 0, bs = -1;
      tables.forEach(function (t, i) { var hi = headerRow(t.rows); var sc = hi >= 0 ? Object.keys(guessMap(t.rows[hi])).length * 1000 + t.rows.length : t.rows.length; if (sc > bs) { bs = sc; best = i; } });
      R.file = file; R.tables = tables; R.match = {}; setTable(best);
      toast('표 ' + tables.length + '개를 읽었습니다', 'success');
    }).catch(function (err) { toast('읽기 실패: ' + err.message, 'error'); });
  }
  function setTable(i) { R.ti = i; var t = R.tables[i]; R.hi = Math.max(0, headerRow(t.rows)); R.map = guessMap(t.rows[R.hi] || []); convert(); renderReport(); }
  function bindReport() {
    rp.addEventListener('click', function (e) {
      if (e.target === rp) { closeReport(); return; }
      var b = e.target.closest('[data-r]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
      var a = b.getAttribute('data-r');
      if (a === 'close') closeReport();
      else if (a === 'file') pickFile('.xlsx,.xlsm,.csv,.tsv,.docx,.pdf,.xls,.hwp,.doc', loadReport);
      else if (a === 'xlsx') U.download(Q() ? Q().xlsx(measureSheets()) : null, 'ICT_Twin_Measure_' + stamp() + '.xlsx');
      else if (a === 'admin') sendToAdmin();
    });
    rp.addEventListener('change', function (e) {
      var t = e.target, a = t.getAttribute('data-r'), k = t.getAttribute('data-k');
      if (a === 'table') setTable(+t.value);
      else if (a === 'hi') { R.hi = Math.max(0, (+t.value || 1) - 1); R.map = guessMap(R.tables[R.ti].rows[R.hi] || []); convert(); renderReport(); }
      else if (a === 'map') { if (t.value === '') delete R.map[k]; else R.map[k] = +t.value; convert(); renderReport(); }
      else if (a === 'def') { R.def[k] = t.value.trim(); R.match = {}; convert(); renderReport(); }
      else if (a === 'asset') { var o = R.rows[+t.getAttribute('data-i')]; R.match[[o['건물'], o['층'], o['점검 위치'], o['설비']].join('|')] = t.value || null; convert(); renderReport(); }
    });
    rp.addEventListener('keydown', function (e) { if (e.key === 'Escape' && e.target.tagName !== 'SELECT') { e.stopPropagation(); closeReport(); } });
  }
  /** ADMIN 「측정 대시보드 → 측정 엑셀 등록」에 변환 파일을 그대로 넘김 (ADMIN 검증·교체 확인창은 그대로 사용) */
  function sendToAdmin() {
    if (TX.quick && TX.quick.active()) { if (!confirm('간이 현행화 초안 작업 중입니다. 측정 설비 연결은 ADMIN에 등록된 설비 기준으로 이뤄집니다.\n초안을 먼저 ADMIN에 등록(엑셀 등록 → 전체 교체 적용)했나요?\n\n[확인] 계속 · [취소] 돌아가기')) return; }
    var blob = Q().xlsx(measureSheets()), file = new File([blob], 'ICT_Twin_Measure_' + stamp() + '.xlsx', { type: blob.type });
    closeReport(); if (TX.quick && TX.quick.active()) TX.quick.close(false); if (TX.state.open) TX.close();
    var nav = Array.prototype.slice.call(document.querySelectorAll('.sidebar nav button, nav button')).find(function (b) { return /측정\s*대시보드/.test(b.textContent); });
    if (!nav) { U.download(blob, file.name); toast('ADMIN 측정 화면을 찾지 못해 파일로 저장했습니다 · 측정 엑셀 등록으로 올리세요', 'warn'); return; }
    nav.click();
    var tries = 0;
    (function go() {
      var btn = Array.prototype.slice.call(document.querySelectorAll('button')).find(function (b) { return b.textContent.trim() === '측정 엑셀 등록'; });
      if (!btn) { if (++tries < 25) return setTimeout(go, 200); U.download(blob, file.name); toast('측정 엑셀 등록 버튼을 찾지 못해 파일로 저장했습니다', 'warn'); return; }
      var orig = HTMLInputElement.prototype.click, done = false;
      HTMLInputElement.prototype.click = function () {
        if (!done && this.type === 'file') {
          done = true; HTMLInputElement.prototype.click = orig;
          var dt = new DataTransfer(); dt.items.add(file); this.files = dt.files;
          this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        return orig.apply(this, arguments);
      };
      try { btn.click(); } finally { setTimeout(function () { if (!done) { HTMLInputElement.prototype.click = orig; U.download(blob, file.name); toast('자동 전달이 되지 않아 파일로 저장했습니다 · 측정 엑셀 등록으로 올리세요', 'warn'); } }, 600); }
      if (done) toast('측정 엑셀을 ADMIN에 전달했습니다 · 확인창에서 점검일을 고르고 「검증된 측정자료로 교체」를 누르세요', 'success');
    })();
  }

  /* ================= 메뉴 연결 ================= */
  function injectMenu() {
    var m = document.querySelector('.tx-wb-menu'); if (!m || m.querySelector('[data-pp]')) return;
    [['diag', '라이저도 · 개통도', '현행화 자료로 층별 간선·연결 계통을 자동 작도 (SVG·PNG)'], ['report', '점검 결과서 변환', '워드·PDF·엑셀 결과서 → ADMIN 측정 엑셀 · 설비 연결']].forEach(function (it) {
      var b = U.el('button', '', '<b>' + it[1] + '</b><small>' + it[2] + '</small>'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.setAttribute('data-pp', it[0]);
      b.addEventListener('click', function (e) { e.stopPropagation(); m.remove(); var t = document.querySelector('[data-act="wb-menu"]'); if (t) t.setAttribute('aria-expanded', 'false'); if (it[0] === 'diag') openDiagrams(); else openReport(); });
      m.appendChild(b);
    });
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-act="wb-menu"]')) setTimeout(injectMenu, 0); });
  TX.on('model', function () { if (dg) renderDiagrams(); });
  TX.on('close', function () { if (dg) { dg.remove(); dg = null; } });
  reindex().then(function () { var q = Q(); if (q) q.refresh(); });

  TX.pipe = {
    pdfToImage: pdfToImage, pdfTables: pdfTables, readAny: readAny, readXlsx: readXlsx, readDocx: readDocx, unzip: unzip,
    photos: { open: openPhotos, close: closePhotos, count: count, add: addPhotos, all: allPhotos, exportZip: exportZip, reindex: reindex },
    photoSheet: photoSheet, checks: checks,
    diagrams: { open: openDiagrams, riser: riserSVG, topo: topoSVG },
    report: { open: openReport, load: loadReport, state: function () { return R; }, sheets: measureSheets, send: sendToAdmin }
  };
})();
