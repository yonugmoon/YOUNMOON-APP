// T5 통합 스모크 시험
//   node twin-admin/test/smoke.js <admin6.html> <outDir> [해상도목록 예: 1600x900,1280x720,390x844]
// 각 해상도마다 ADMIN 「디지털 트윈」 → 진입 버튼 → 뷰어(2D/3D/분할, 시안 A~D, 층, 적층, 레이어, 검색·선택, 장애 시뮬레이션,
// 내보내기, ESC 닫기, 재열기) → ADMIN 회귀 를 실행. 단계별 스크린샷·콘솔 오류·뷰포트 면적 비율·3D 메모리 기록.
// 팀 모듈이 없으면 SKIP(실패 아님). 결과: <outDir>/smoke-results.json, <outDir>/smoke-results.md
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');

const [htmlArg, outArg = '.', resArg = '1600x900,1280x720,390x844'] = process.argv.slice(2);
if (!htmlArg) { console.error('usage: node smoke.js <html> <outDir> [WxH,...]'); process.exit(2); }
const HTML = path.resolve(htmlArg); const OUT = path.resolve(outArg);
fs.mkdirSync(OUT, { recursive: true });
const RES = resArg.split(',').map(s => s.split('x').map(Number));
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Skip extends Error {}
const skip = m => { throw new Skip(m); };
const must = (c, m) => { if (!c) throw new Error(m); };

async function runRes(browser, W, H) {
  const tag = `${W}x${H}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true, hasTouch: W < 600, isMobile: false });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + (e.message || '').slice(0, 300)));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); });
  const results = []; const mem = []; let baseOverflow = null;
  const ev = (fn, arg) => pg.evaluate(fn, arg);
  const shot = async name => { const p = path.join(OUT, `${tag}_${name}.png`); await pg.screenshot({ path: p }); return p; };
  const mods = () => ev(() => window.TwinX ? ['data', 'shell', 'cad2d', 'scene3d', 'analysis'].filter(k => TwinX[k]) : []);
  const vpRatio = () => ev(() => {
    const ui = window.TwinX && TwinX.ui; if (!ui || !ui.viewport) return null;
    const r = ui.viewport.getBoundingClientRect();
    const vis = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return Math.round(vis / (innerWidth * innerHeight) * 1000) / 10;
  });
  const memory = async label => {
    const m = await ev(() => {
      const s = window.TwinX && TwinX.scene3d; if (!s) return null;
      const r = s.renderer || (s.getRenderer && s.getRenderer()) || (s._renderer);
      if (!r || !r.info) return { renderer: false };
      return { renderer: true, geometries: r.info.memory.geometries, textures: r.info.memory.textures, calls: r.info.render.calls, triangles: r.info.render.triangles,
               heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : null };
    });
    if (m) mem.push(Object.assign({ label }, m));
    return m;
  };

  async function step(name, fn, opts = {}) {
    const e0 = errs.length; const t0 = Date.now();
    const rec = { step: name, status: 'PASS', note: '', errors: [], ratio: null, shot: null, ms: 0 };
    try { const n = await fn(rec); if (n) rec.note = String(n); }
    catch (e) { if (e instanceof Skip) { rec.status = 'SKIP'; rec.note = e.message; } else { rec.status = 'FAIL'; rec.note = (e && e.message || String(e)).slice(0, 300); } }
    await sleep(opts.wait || 250);
    rec.errors = errs.slice(e0);
    if (rec.errors.length && rec.status === 'PASS') { rec.status = 'FAIL'; rec.note = (rec.note ? rec.note + ' · ' : '') + `콘솔 오류 ${rec.errors.length}건`; }
    if (rec.status !== 'SKIP' && opts.shot !== false) { try { rec.shot = await shot(name); } catch (e) { } }
    try { rec.ratio = await vpRatio(); } catch (e) { }
    rec.ms = Date.now() - t0;
    results.push(rec);
    console.log(`[${tag}] ${rec.status.padEnd(4)} ${name}${rec.ratio != null ? ' vp=' + rec.ratio + '%' : ''} ${rec.note}`);
    return rec;
  }
  const needShell = async () => { const m = await mods(); if (!m.includes('shell')) skip('T2 shell 모듈 없음'); };
  const needOpen = async () => { await needShell(); const o = await ev(() => TwinX.state.open && !!TwinX.ui); if (!o) skip('뷰어 미열림'); };

  await pg.goto('file://' + HTML);
  await sleep(1800);

  await step('01_admin_load', async () => {
    const r = await ev(() => ({ tx: !!window.TwinX, nav: document.querySelectorAll('.sidebar nav button').length, mods: window.TwinX ? ['data', 'shell', 'cad2d', 'scene3d', 'analysis'].filter(k => TwinX[k]) : [] }));
    must(r.tx, 'TwinX 전역 없음'); must(r.nav >= 3, 'ADMIN 사이드바 메뉴 없음');
    return '모듈: ' + r.mods.join(',');
  });
  await step('02_admin_twin_menu', async () => {
    const r = await ev(() => { const b = [...document.querySelectorAll('.sidebar nav button')].find(x => x.textContent.includes('디지털 트윈')); if (!b) return { b: false }; b.click(); return { b: true }; });
    must(r.b, '「디지털 트윈」 메뉴 없음'); await sleep(1000);
    const s = await ev(() => ({ work: !!document.querySelector('.work-area'), svg: [...document.querySelectorAll('.canvas-panel svg')].filter(s => s.getBoundingClientRect().width > 200).length, model: window.TwinX && TwinX.model && TwinX.model.source }));
    baseOverflow = await ev(() => getComputedStyle(document.body).overflow);
    must(s.work, '.work-area 없음'); must(s.svg >= 1, 'ADMIN 도면 SVG 없음');
    return `ADMIN SVG ${s.svg}개 · TwinX.model=${s.model || 'null'}`;
  });
  await step('03_entry_button', async () => {
    await needShell();
    const r = await ev(() => { const b = [...document.querySelectorAll('.work-area button, .panel-heading button, button')].find(x => /통합 뷰어|2D·3D/.test(x.textContent)); return b ? { t: b.textContent.trim(), inHeading: !!b.closest('.panel-heading'), vis: b.getBoundingClientRect().width > 0 } : null; });
    must(r, '"2D·3D 통합 뷰어" 버튼 없음'); must(r.vis, '버튼이 보이지 않음 (폭 0)');
    return `"${r.t}" heading=${r.inHeading}`;
  });
  await step('04_open_viewer', async () => {
    await needShell();
    const how = await ev(() => { const b = [...document.querySelectorAll('button')].find(x => /통합 뷰어|2D·3D/.test(x.textContent)); if (b) { b.click(); return 'button'; } TwinX.open({ view: '3d' }); return 'api'; });
    await sleep(2200);
    const r = await ev(() => { const ui = TwinX.ui; const rr = ui && ui.root && ui.root.getBoundingClientRect();
      const tb = ui && ui.toolbar && ui.toolbar.getBoundingClientRect(), sb = ui && ui.statusbar && ui.statusbar.getBoundingClientRect();
      return { open: TwinX.state.open, ui: !!ui, keys: ui ? ['root', 'toolbar', 'viewport', 'view2d', 'view3d', 'floorRail', 'inspector', 'statusbar'].filter(k => !ui[k]) : [], root: rr && [rr.width, rr.height], tb: tb && Math.round(tb.height), sb: sb && Math.round(sb.height),
               floor: TwinX.state.floor, model: TwinX.model && TwinX.model.source, hscroll: document.documentElement.scrollWidth > innerWidth }; });
    must(r.open && r.ui, '뷰어가 열리지 않음 (state.open/ui)');
    must(!r.keys.length, 'TwinX.ui 누락 키: ' + r.keys.join(','));
    must(r.root[0] >= innerWidthGuess(W) - 1 && r.root[1] >= H - 1, `root가 전체화면 아님 ${r.root}`);
    const notes = [`via ${how}`, `floor=${r.floor}`, `model=${r.model}`, `toolbar=${r.tb}px`, `status=${r.sb}px`];
    if (r.tb > 52 && W >= 1000) throw new Error(`툴바 높이 ${r.tb}px > 52px · ` + notes.join(' '));
    if (r.sb > 28 && W >= 1000) throw new Error(`상태바 높이 ${r.sb}px > 28px · ` + notes.join(' '));
    await memory('open');
    return notes.join(' ');
  }, { wait: 400 });
  function innerWidthGuess(w) { return w; }

  await step('05_viewport_ratio', async (rec) => {
    await needOpen();
    const r = await vpRatio(); must(r != null, 'TwinX.ui.viewport 없음');
    if (W === 1600 && r < 80) throw new Error(`뷰포트 ${r}% < 80% (계약 §5)`);
    if (W !== 1600 && r < 70) throw new Error(`뷰포트 ${r}% < 70%`);
    return `${r}%`;
  });

  for (const v of ['2d', '3d', 'split']) {
    await step('06_view_' + v, async () => {
      await needOpen();
      await ev(v => TwinX.setState({ view: v }), v); await sleep(1300);
      const r = await ev(() => { const ui = TwinX.ui; const box = el => { const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
        return { v2: ui.isVisible ? ui.isVisible('2d') : null, v3: ui.isVisible ? ui.isVisible('3d') : null, b2: box(ui.view2d), b3: box(ui.view3d),
          svg2: ui.view2d.querySelectorAll('svg').length, cv2: ui.view2d.querySelectorAll('canvas').length, cv3: ui.view3d.querySelectorAll('canvas').length,
          mods: ['cad2d', 'scene3d'].filter(k => TwinX[k]) }; });
      const n = `2d:${r.v2}[${r.b2}] svg=${r.svg2} · 3d:${r.v3}[${r.b3}] canvas=${r.cv3}`;
      if (v !== '3d') { must(r.v2 !== false && r.b2[0] > 50, '2D 컨테이너 숨김/0폭 · ' + n); if (r.mods.includes('cad2d')) must(r.svg2 + r.cv2 > 0, '2D 도면 미렌더 · ' + n); }
      if (v !== '2d') { must(r.v3 !== false && r.b3[0] > 50, '3D 컨테이너 숨김/0폭 · ' + n); if (r.mods.includes('scene3d')) must(r.cv3 > 0, '3D canvas 없음 · ' + n); }
      if (v === 'split') must(r.b2[0] > 50 && r.b3[0] > 50, '분할 시 두 뷰 모두 보여야 함 · ' + n);
      if ((v === '2d' && !r.mods.includes('cad2d')) || (v === '3d' && !r.mods.includes('scene3d'))) return 'RENDERER-SKIP ' + n;
      return n;
    });
  }

  for (const c of ['A', 'B', 'C', 'D']) {
    await step('07_concept_' + c, async () => {
      await needOpen(); const m = await mods(); if (!m.includes('scene3d')) skip('T4 scene3d 모듈 없음');
      await ev(c => TwinX.setState({ view: '3d', concept: c }), c); await sleep(1600);
      await memory('concept_' + c);
      const r = await ev(() => ({ c: TwinX.state.concept, cv: TwinX.ui.view3d.querySelector('canvas') && TwinX.ui.view3d.querySelector('canvas').width }));
      must(r.c === c && r.cv > 0, '시안 전환 실패');
    });
  }

  await step('08_floor_switch', async () => {
    await needOpen();
    const r = await ev(async () => { const fl = TwinX.model && TwinX.model.floors; if (!fl || fl.length < 2) return { n: fl ? fl.length : 0 };
      const cur = TwinX.state.floor; const nxt = fl.find(f => f.code !== cur).code;
      // 층 레일 UI 버튼 우선
      const rail = TwinX.ui.floorRail; const btn = rail && [...rail.querySelectorAll('button,[data-floor]')].find(b => (b.dataset && b.dataset.floor === nxt) || b.textContent.trim().startsWith((fl.find(f => f.code === nxt).name)));
      let how = 'api'; if (btn) { btn.click(); how = 'rail'; } else TwinX.setState({ floor: nxt, stack: false });
      TwinX.setState({ view: 'split' });
      await new Promise(r => setTimeout(r, 1500)); return { n: fl.length, from: cur, to: nxt, now: TwinX.state.floor, how }; });
    must(r.n >= 2, '층 2개 미만');
    must(r.now === r.to, `층 전환 실패 ${r.from}→${r.to} now=${r.now}`);
    return `${r.from}→${r.to} via ${r.how}`;
  });

  await step('09_stack_all', async () => {
    await needOpen(); const m = await mods(); if (!m.includes('scene3d')) skip('T4 scene3d 모듈 없음');
    await ev(() => TwinX.setState({ view: '3d', concept: 'A', stack: true })); await sleep(1800);
    await memory('stack');
    must(await ev(() => TwinX.state.stack), 'stack 상태 미반영');
  });

  await step('10_layer_toggle', async () => {
    await needOpen();
    await ev(() => TwinX.setState({ view: 'split', stack: false, layers: { tray: false, links: false, thermal: true, ground: false, measure: false } })); await sleep(900);
    const p = await shot('10_layer_toggle_off');
    await ev(() => TwinX.setState({ layers: { tray: true, links: true, thermal: false, ground: true, measure: true } })); await sleep(900);
    return 'off 상태: ' + path.basename(p);
  });

  await step('11_search_select', async () => {
    await needOpen();
    const target = await ev(() => { const A = TwinX.model && TwinX.model.assets; if (!A || !A.length) return null;
      let best = A[0], bs = -1; A.forEach(a => { const s = TwinX.analysis ? TwinX.analysis.impact(a.id).size : 0; if (s > bs) { bs = s; best = a; } }); return { id: best.id, name: best.name, floor: best.floor, n: bs }; });
    must(target, '모델에 설비 없음');
    const input = await pg.$('.tx-root input[type=search], [class*="tx-"] input[type=search], [class*="tx-"] input[placeholder*="검색"], [id^="tx-"] input');
    let how = 'api';
    if (input) {
      await input.click(); await input.fill(target.name.slice(0, 6)); await sleep(600);
      const clicked = await ev(t => { const root = TwinX.ui.root; const cand = [...root.querySelectorAll('li,button,[data-id],[data-asset]')].find(e => e.offsetParent && (e.dataset.id === t.id || e.dataset.asset === t.id || e.textContent.includes(t.name)) && !e.closest('.tx-inspector'));
        if (cand) { cand.click(); return true; } return false; }, target);
      if (!clicked) await input.press('Enter');
      await sleep(900); how = clicked ? 'search-click' : 'search-enter';
    }
    let sel = await ev(() => TwinX.state.selected);
    if (sel !== target.id && !input) { await ev(id => TwinX.select(id), target.id); await sleep(800); sel = await ev(() => TwinX.state.selected); }
    const insp = await ev(t => { const i = TwinX.ui.inspector; return i ? { txt: i.textContent.includes(t.name), vis: i.getBoundingClientRect().width > 0 } : null; }, target);
    must(input, '검색 입력창 없음 (API 선택으로 대체 확인: selected=' + sel + ')');
    must(sel === target.id, `검색 후 선택 실패 (${how}, selected=${sel}, 기대 ${target.id})`);
    return `${target.id} ${target.name} via ${how} · 인스펙터 표시=${insp && insp.txt}`;
  });

  await step('12_fault_sim', async () => {
    await needOpen();
    const m = await mods(); if (!m.includes('analysis')) skip('T5 analysis 없음');
    const r = await ev(async () => { const src = TwinX.state.selected || (TwinX.model.assets[0] || {}).id; if (!TwinX.state.selected) TwinX.select(src);
      let got = null; const h = f => { got = f; }; TwinX.on('fault', h);
      // UI 토글 우선 (툴바의 '장애' 버튼)
      const b = [...TwinX.ui.root.querySelectorAll('button')].find(x => /장애/.test(x.textContent + (x.title || '')));
      let how = 'api'; if (b) { b.click(); how = 'button'; } if (!TwinX.state.fault.active) { TwinX.setState({ fault: { active: true, source: src } }); how += '+api'; }
      TwinX.setState({ view: 'split' });
      await new Promise(r => setTimeout(r, 1500)); TwinX.off('fault', h);
      const other = TwinX.model.assets.find(a => a.id !== src); if (other) TwinX.select(other.id);
      await new Promise(r => setTimeout(r, 300));
      const keep = TwinX.fault.source; if (other) TwinX.select(src);
      return { src, how, active: TwinX.state.fault.active, fsrc: TwinX.fault.source, size: TwinX.fault.impact.size, ev: !!got, keep }; });
    must(r.active && r.ev, '장애 시뮬레이션 미동작 ' + JSON.stringify(r));
    must(r.keep === r.src, '선택 변경 시 발생원이 바뀜 ' + r.keep);
    return `source=${r.fsrc} impact=${r.size} via ${r.how}`;
  }, { wait: 600 });

  await step('13_fault_off', async () => {
    await needOpen();
    await ev(() => TwinX.setState({ fault: { active: false, source: null } })); await sleep(700);
    must(await ev(() => TwinX.fault.impact.size === 0), 'fault 해제 후 impact 남음');
  }, { shot: false });

  await step('14_export_api', async () => {
    await needOpen();
    const r = await ev(() => ({ svg: !!(TwinX.cad2d && typeof TwinX.cad2d.exportSvg === 'function'), png: !!(TwinX.cad2d && typeof TwinX.cad2d.exportPng === 'function'),
      snap: !!(TwinX.scene3d && typeof TwinX.scene3d.snapshot === 'function'), cad: !!TwinX.cad2d, s3: !!TwinX.scene3d,
      menu: !![...TwinX.ui.root.querySelectorAll('button')].find(x => /내보내기|export/i.test(x.textContent + (x.title || ''))) }));
    if (!r.cad && !r.s3) skip('T3·T4 모듈 없음');
    const miss = []; if (r.cad && !r.svg) miss.push('cad2d.exportSvg'); if (r.cad && !r.png) miss.push('cad2d.exportPng'); if (r.s3 && !r.snap) miss.push('scene3d.snapshot');
    must(!miss.length, '누락: ' + miss.join(','));
    // 실제 다운로드 1건 시도 (SVG)
    let dl = '';
    if (r.svg) { try { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 4000 }), ev(() => TwinX.cad2d.exportSvg())]); dl = d.suggestedFilename(); } catch (e) { dl = 'download 이벤트 없음'; } }
    return `exportSvg/Png/snapshot ok · 메뉴버튼=${r.menu} · SVG다운로드=${dl}`;
  }, { shot: false });

  await step('15_esc_close', async () => {
    await needOpen();
    await pg.mouse.click(Math.round(W / 2), Math.round(H / 2)).catch(() => { });
    await ev(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await pg.keyboard.press('Escape'); await sleep(400);
    let r = await ev(() => ({ open: TwinX.state.open, vis: !!(TwinX.ui && TwinX.ui.root && TwinX.ui.root.isConnected && TwinX.ui.root.getBoundingClientRect().width && getComputedStyle(TwinX.ui.root).display !== 'none' && getComputedStyle(TwinX.ui.root).visibility !== 'hidden') }));
    if (r.open) { await pg.keyboard.press('Escape'); await sleep(400); r = await ev(() => ({ open: TwinX.state.open, vis: !!(TwinX.ui && TwinX.ui.root && TwinX.ui.root.isConnected && TwinX.ui.root.getBoundingClientRect().width && getComputedStyle(TwinX.ui.root).display !== 'none') })); if (!r.open) return 'ESC 2회 필요(1회는 팝오버/선택 해제)'; }
    must(!r.open, 'ESC 후에도 state.open=true');
    must(!r.vis, 'ESC 후 오버레이 DOM이 여전히 보임');
    await memory('closed');
  });

  await step('16_reopen', async () => {
    await needShell();
    await pg.keyboard.press('Shift+T'); await sleep(1500);
    let how = 'Shift+T';
    if (!(await ev(() => TwinX.state.open))) { how = 'button'; await ev(() => { const b = [...document.querySelectorAll('button')].find(x => /통합 뷰어|2D·3D/.test(x.textContent)); b ? b.click() : TwinX.open(); }); await sleep(1500); }
    const r = await ev(() => ({ open: TwinX.state.open, roots: document.querySelectorAll('.tx-root').length, canv: TwinX.ui && TwinX.ui.view3d ? TwinX.ui.view3d.querySelectorAll('canvas').length : 0 }));
    must(r.open, '재열기 실패');
    await memory('reopen');
    const note = `via ${how} · .tx-root=${r.roots} · 3D canvas=${r.canv}`;
    if (r.canv > 1) throw new Error('3D canvas 중복 생성 ' + note);
    if (how !== 'Shift+T') return note + ' (Shift+T 미동작)';
    return note;
  });

  await step('17_close_again', async () => {
    await needShell();
    await ev(() => TwinX.close()); await sleep(600);
    must(!(await ev(() => TwinX.state.open)), 'close 실패');
  }, { shot: false });

  await step('18_admin_regression', async () => {
    const r = await ev(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const nav = [...document.querySelectorAll('.sidebar nav button')]; const visited = [];
      for (const b of nav) { b.click(); await wait(350); const main = document.querySelector('.work-area, main, .content, #root'); visited.push({ t: b.textContent.trim(), active: b.classList.contains('active') || b.getAttribute('aria-current') != null, len: (main && main.textContent.length) || 0 }); }
      const tb = nav.find(x => x.textContent.includes('디지털 트윈')); tb && tb.click(); await wait(900);
      const svg = [...document.querySelectorAll('.canvas-panel svg')].filter(s => s.getBoundingClientRect().width > 200).length;
      const overlay = [...document.querySelectorAll('[class*="tx-"]')].filter(e => { const s = getComputedStyle(e); return s.position === 'fixed' && e.getBoundingClientRect().width > innerWidth * 0.5 && s.display !== 'none' && s.visibility !== 'hidden'; }).length;
      return { visited, svg, overlay, scrollLock: getComputedStyle(document.body).overflow };
    });
    const dead = r.visited.filter(v => !v.active);
    must(r.svg >= 1, 'ADMIN 도면 SVG 사라짐');
    must(r.overlay === 0, `닫은 뒤에도 tx- 전체화면 요소 ${r.overlay}개 남음`);
    must(r.scrollLock === baseOverflow, `body overflow ${baseOverflow}→${r.scrollLock} (뷰어 닫은 뒤 원복 안 됨)`);
    must(!dead.length, '메뉴 이동 실패: ' + dead.map(d => d.t).join(','));
    return `메뉴 ${r.visited.length}개 이동 OK · ADMIN SVG ${r.svg}`;
  });

  await ctx.close();
  return { tag, results, mem, errors: errs };
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const all = [];
  for (const [W, H] of RES) { try { all.push(await runRes(browser, W, H)); } catch (e) { console.error('run failed', W, H, e); all.push({ tag: `${W}x${H}`, results: [], mem: [], errors: ['RUNNER ' + e.message] }); } }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'smoke-results.json'), JSON.stringify({ html: HTML, at: new Date().toISOString(), runs: all }, null, 1));
  // 마크다운 표
  const steps = [...new Set(all.flatMap(r => r.results.map(x => x.step)))];
  let md = `# smoke ${new Date().toISOString()}\n\n| 단계 | ${all.map(r => r.tag).join(' | ')} |\n|---|${all.map(() => '---').join('|')}|\n`;
  for (const s of steps) md += `| ${s} | ${all.map(r => { const x = r.results.find(y => y.step === s); return x ? `${x.status}${x.errors.length ? ' (err ' + x.errors.length + ')' : ''}${x.ratio != null ? ' ' + x.ratio + '%' : ''}` : '-'; }).join(' | ')} |\n`;
  md += '\n## 메모\n';
  for (const r of all) { md += `\n### ${r.tag}\n`; r.results.forEach(x => { if (x.note || x.errors.length) md += `- ${x.step} [${x.status}] ${x.note}${x.errors.length ? '\n  - ' + x.errors.slice(0, 5).join('\n  - ') : ''}\n`; }); if (r.mem.length) md += `- 3D 메모리: ${r.mem.map(m => `${m.label}: geo=${m.geometries} tex=${m.textures} calls=${m.calls}`).join(' / ')}\n`; }
  fs.writeFileSync(path.join(OUT, 'smoke-results.md'), md);
  const counts = {}; all.forEach(r => r.results.forEach(x => { counts[x.status] = (counts[x.status] || 0) + 1; }));
  console.log('\nSUMMARY', JSON.stringify(counts), '→', path.join(OUT, 'smoke-results.md'));
})();
