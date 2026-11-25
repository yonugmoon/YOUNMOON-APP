/* ============================================================
   TwinX 75-autoplan — 도면 사진 자동 인식 (실 위치 핀 → 실 생성, 클릭 한 번으로 실 인식)
   · 현장수집 앱(RepiQ) 「실 위치」 이미지: 핀 색 = 실 유형 (MDF 파랑 · IDF 청록 · TPS 보라 · EPS 주황 · 통신 초록 · 전산 짙은 청록)
     → 핀마다 그 자리에 실을 만들고(벽이 닫힌 실이면 윤곽, 아니면 표준 3×3m) 점검내역 위치명과 같은 이름으로 연동
   · 휴대폰 화면 캡처면 앱 화면 테두리를 잘라 도면만 사용(autoCrop)
   · 깨끗한 CAD·PDF 도면: 실 안을 한 번 클릭하면 벽으로 닫힌 영역을 찾아 실 사각형 생성(roomAt)
   · 모두 브라우저 안에서 픽셀 분석(외부 전송 없음). 사진 도면은 정확한 벽 인식이 어려워 결과를 손잡이로 다듬는 전제
   ============================================================ */
(function () {
  'use strict';
  var TX = window.TwinX;
  if (!TX || TX.autoplan) return;
  var PINS = [['MDF실', [37, 99, 235]], ['IDF실', [8, 145, 178]], ['TPS실', [124, 58, 237]], ['EPS실', [234, 88, 12]], ['통신실', [22, 163, 74]], ['전산실', [15, 118, 110]]];

  function loadImg(src) { return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('이미지를 읽지 못했습니다')); }; im.src = src; }); }
  function pixels(img, w, h, max) {
    var k = Math.min(1, (max || 1400) / Math.max(w, h)), W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    var c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, W, H);
    return { d: g.getImageData(0, 0, W, H).data, W: W, H: H, k: k };
  }

  /* ---------- 1) 화면 캡처 테두리 자르기: 밝은 종이 영역의 가장 긴 연속 행·열 ---------- */
  function cropBox(P) {
    var W = P.W, H = P.H, d = P.d, rowF = new Float32Array(H), colF = new Float32Array(W);
    var bright = function (i) { return (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 > 70; }; // 앱 화면(어두운 남색) 이 아닌 곳 = 종이 도면 (도면 선은 가늘어 비율에 영향 적음)
    for (var y = 0; y < H; y++) { var n = 0; for (var x = 0; x < W; x++) if (bright((y * W + x) * 4)) n++; rowF[y] = n / W; }
    var run = function (arr, th) { var bs = 0, be = -1, s = -1; for (var i = 0; i <= arr.length; i++) { if (i < arr.length && arr[i] >= th) { if (s < 0) s = i; } else if (s >= 0) { if (i - s > be - bs) { bs = s; be = i; } s = -1; } } return [bs, be]; };
    var ry = run(rowF, 0.7); if (ry[1] - ry[0] < H * 0.25) return null;
    for (var x2 = 0; x2 < W; x2++) { var m = 0; for (var y2 = ry[0]; y2 < ry[1]; y2++) if (bright((y2 * W + x2) * 4)) m++; colF[x2] = m / (ry[1] - ry[0]); }
    var rx = run(colF, 0.7); if (rx[1] - rx[0] < W * 0.25) return null;
    var area = (rx[1] - rx[0]) * (ry[1] - ry[0]) / (W * H);
    if (area > 0.92) return null; // 이미 도면만 있음
    return { x: rx[0] / P.k, y: ry[0] / P.k, w: (rx[1] - rx[0]) / P.k, h: (ry[1] - ry[0]) / P.k };
  }
  function autoCrop(file) {
    if (!file || !/^image\//.test(file.type || '') && !/\.(png|jpe?g|webp|bmp)$/i.test(file.name || '')) return Promise.resolve({ file: file, cropped: false });
    var u = URL.createObjectURL(file);
    return loadImg(u).then(function (img) {
      var b = cropBox(pixels(img, img.naturalWidth, img.naturalHeight, 900));
      if (!b) { URL.revokeObjectURL(u); return { file: file, cropped: false }; }
      var c = document.createElement('canvas'); c.width = Math.round(b.w); c.height = Math.round(b.h);
      c.getContext('2d').drawImage(img, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      return new Promise(function (res) { c.toBlob(function (bl) { res({ file: new File([bl], (file.name || '도면').replace(/\.[^.]+$/, '') + '_도면.png', { type: 'image/png' }), cropped: true }); }, 'image/png'); });
    }).catch(function () { URL.revokeObjectURL(u); return { file: file, cropped: false }; });
  }

  /* ---------- 2) 실 위치 핀 찾기 (핀 색 = 실 유형) ---------- */
  function detectPins(rec) {
    if (!rec || !rec.img) return [];
    var P = pixels(rec.img, rec.w, rec.h, 1600), W = P.W, H = P.H, d = P.d, out = [];
    PINS.forEach(function (pc) {
      var c = pc[1], seen = new Uint8Array(W * H), ok = function (i) { var j = i * 4, a = d[j] - c[0], b = d[j + 1] - c[1], e = d[j + 2] - c[2]; return a * a + b * b + e * e < 2025; };
      for (var i = 0; i < W * H; i++) {
        if (seen[i] || !ok(i)) continue;
        var q = [i], n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0; seen[i] = 1;
        while (q.length) { var p = q.pop(), x = p % W, y = (p / W) | 0; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          [p - 1, p + 1, p - W, p + W].forEach(function (nb) { if (nb >= 0 && nb < W * H && !seen[nb] && Math.abs((nb % W) - x) <= 1 && ok(nb)) { seen[nb] = 1; q.push(nb); } }); }
        var bw = x1 - x0 + 1, bh = y1 - y0 + 1, fillR = n / (bw * bh), sz = Math.max(W, H);
        // 핀 모양: 세로로 긴 물방울(가로:세로 ≈ 1:1.2~2.4), 채움 35~85%, 크기 도면 장변의 0.8~6%
        // 핀 머리 가운데의 흰 구멍(앱 핀 모양) 확인 → 비상구 표지·소화기 같은 색 아이콘 제외
        var hx = Math.round(x0 + bw / 2), hy = Math.round(y0 + bh * 0.33), hj = (hy * W + hx) * 4, hole = (d[hj] * 299 + d[hj + 1] * 587 + d[hj + 2] * 114) / 1000 > 190 && Math.max(d[hj], d[hj + 1], d[hj + 2]) - Math.min(d[hj], d[hj + 1], d[hj + 2]) < 50;
        if (hole && bh / bw >= 1.15 && bh / bw <= 2.6 && fillR >= 0.33 && fillR <= 0.88 && bh >= sz * 0.008 && bh <= sz * 0.06 && n >= 40)
          out.push({ type: pc[0], x: (x0 + bw / 2) / P.k, y: (y1 + 1) / P.k, h: bh / P.k });
      }
    });
    return out;
  }

  /* ---------- 3) 클릭 지점의 닫힌 실 영역 (벽 = 어둡고 무채색, 문틈은 벽 두께를 키워 막음) ---------- */
  function roomAt(rec, ix, iy) {
    if (!rec || !rec.img) return null;
    var P = pixels(rec.img, rec.w, rec.h, 1400), W = P.W, H = P.H, d = P.d, N = W * H, sx = Math.round(ix * P.k), sy = Math.round(iy * P.k);
    if (sx < 1 || sy < 1 || sx >= W - 1 || sy >= H - 1) return null;
    var hist = new Array(256).fill(0), gray = new Uint8Array(N), sat = new Uint8Array(N);
    for (var i = 0; i < N; i++) { var j = i * 4, r = d[j], g = d[j + 1], b = d[j + 2]; gray[i] = (r * 299 + g * 587 + b * 114) / 1000; sat[i] = Math.max(r, g, b) - Math.min(r, g, b); hist[gray[i]]++; }
    var sum = 0; for (var t = 0; t < 256; t++) sum += t * hist[t];
    var wB = 0, sB = 0, best = 0, th = 128; for (t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; var wF = N - wB; if (!wF) break; sB += t * hist[t]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = t; } }
    th = Math.min(th, 160);
    var wall = new Uint8Array(N); for (i = 0; i < N; i++) wall[i] = gray[i] < th && sat[i] < 60 ? 1 : 0;
    var dilate = function (m, rr) { // 가로·세로 분리 팽창
      var a = new Uint8Array(N), o = new Uint8Array(N), x, y, k;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { if (!m[y * W + x]) continue; for (k = -rr; k <= rr; k++) { var xx = x + k; if (xx >= 0 && xx < W) a[y * W + xx] = 1; } }
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { if (!a[y * W + x]) continue; for (k = -rr; k <= rr; k++) { var yy = y + k; if (yy >= 0 && yy < H) o[yy * W + x] = 1; } }
      return o;
    };
    var maxD = Math.max(2, Math.round(Math.max(W, H) / 220));
    for (var rr = 1; rr <= maxD; rr++) {
      var m = dilate(wall, rr), s0 = sy * W + sx; if (m[s0]) continue;
      var seen = new Uint8Array(N), q = [s0], n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, edge = false; seen[s0] = 1;
      while (q.length) { var p = q.pop(), x = p % W, y = (p / W) | 0; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        if (n > N * 0.12) break;
        if (x > 0 && !seen[p - 1] && !m[p - 1]) { seen[p - 1] = 1; q.push(p - 1); } if (x < W - 1 && !seen[p + 1] && !m[p + 1]) { seen[p + 1] = 1; q.push(p + 1); }
        if (y > 0 && !seen[p - W] && !m[p - W]) { seen[p - W] = 1; q.push(p - W); } if (y < H - 1 && !seen[p + W] && !m[p + W]) { seen[p + W] = 1; q.push(p + W); } }
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1, frac = n / N, fillR = n / (bw * bh);
      if (edge || frac > 0.1 || q.length) continue;            // 바깥으로 새어 나감 → 벽을 더 두껍게
      if (frac < 0.0004 || bw < 6 || bh < 6 || bw / bh > 8 || bh / bw > 8 || fillR < 0.45) return null; // 너무 작거나 실 모양이 아님
      return { x: (x0 - rr) / P.k, y: (y0 - rr) / P.k, w: (bw + 2 * rr) / P.k, h: (bh + 2 * rr) / P.k, how: 'outline' };
    }
    return null;
  }

  /* ---------- 좌표 변환 (도면 이미지 px ↔ 층 mm) ---------- */
  function toWorld(rec, x, y) { var t = rec.tf, c = Math.cos(t.rot || 0), s = Math.sin(t.rot || 0); return { x: t.tx + t.s * (c * x - s * y), y: t.ty + t.s * (s * x + c * y) }; }
  function toImg(rec, mx, my) { var t = rec.tf, dx = mx - t.tx, dy = my - t.ty, c = Math.cos(-(t.rot || 0)), s = Math.sin(-(t.rot || 0)); return { x: (c * dx - s * dy) / t.s, y: (s * dx + c * dy) / t.s }; }
  function boxWorld(rec, b) {
    var ps = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(function (p) { return toWorld(rec, p[0], p[1]); });
    var xs = ps.map(function (p) { return p.x; }), ys = ps.map(function (p) { return p.y; });
    var x0 = Math.round(Math.min.apply(null, xs) / 100) * 100, y0 = Math.round(Math.min.apply(null, ys) / 100) * 100;
    return { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.max(600, Math.round((Math.max.apply(null, xs) - x0) / 100) * 100), h: Math.max(600, Math.round((Math.max.apply(null, ys) - y0) / 100) * 100) };
  }
  /** 층 mm 좌표를 클릭 → 닫힌 실 영역(mm) 또는 null */
  function roomAtWorld(code, mm) { var rec = TX.underlay && TX.underlay.get(code); if (!rec) return null; var p = toImg(rec, mm.x, mm.y); if (p.x < 0 || p.y < 0 || p.x > rec.w || p.y > rec.h) return null; var b = roomAt(rec, p.x, p.y); return b ? boxWorld(rec, b) : null; }
  /** 핀 → 실 후보 [{type, box(mm), how, at(mm)}] */
  function pinRooms(code) {
    var rec = TX.underlay && TX.underlay.get(code); if (!rec) return [];
    return detectPins(rec).map(function (p) {
      var tip = toWorld(rec, p.x, p.y), b = roomAt(rec, p.x, p.y - p.h * 0.05);
      var box = b && b.w > p.h * 1.6 && b.h > p.h * 1.2 ? boxWorld(rec, b) : null; // 핀 자체 주변만 잡힌 작은 영역은 무시
      if (!box) box = { x: Math.max(0, Math.round((tip.x - 1500) / 100) * 100), y: Math.max(0, Math.round((tip.y - 1500) / 100) * 100), w: 3000, h: 3000 };
      return { type: p.type, box: box, how: b && box.w !== 3000 ? 'outline' : 'standard', at: tip };
    });
  }

  TX.autoplan = { autoCrop: autoCrop, detectPins: detectPins, roomAt: roomAt, roomAtWorld: roomAtWorld, pinRooms: pinRooms, PINS: PINS };
})();
