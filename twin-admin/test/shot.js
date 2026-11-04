// 공용 시험 헬퍼: node twin-admin/test/shot.js <html> <outDir> [view=3d] [concept=A] [w=1600] [h=900]
// ADMIN_6를 열어 「디지털 트윈」 메뉴로 이동 → TwinX.open() → 스크린샷 + 콘솔 오류 출력
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
(async () => {
  const [html, outDir = '.', view = '3d', concept = 'A', w = '1600', h = '900'] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: +w, height: +h } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); });
  await pg.goto('file://' + path.resolve(html));
  await pg.waitForTimeout(1500);
  // ADMIN 사이드바 「디지털 트윈」 이동 (실패해도 계속)
  await pg.evaluate(() => { const b = [...document.querySelectorAll('.sidebar nav button')].find(x => x.textContent.includes('디지털 트윈')); if (b) b.click(); });
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: path.join(outDir, 'admin_twin_page.png') });
  const info = await pg.evaluate(async (args) => {
    if (!window.TwinX) return { twinx: false };
    TwinX.open({ view: args.view, concept: args.concept });
    await new Promise(r => setTimeout(r, 2500));
    return { twinx: true, source: TwinX.model && TwinX.model.source, floors: TwinX.model ? TwinX.model.floors.length : 0,
             rooms: TwinX.model ? TwinX.model.rooms.length : 0, assets: TwinX.model ? TwinX.model.assets.length : 0,
             ui: !!TwinX.ui, modules: ['data', 'shell', 'cad2d', 'scene3d', 'analysis'].filter(k => TwinX[k]) };
  }, { view, concept });
  await pg.screenshot({ path: path.join(outDir, `viewer_${view}_${concept}.png`) });
  console.log(JSON.stringify(info));
  console.log('errors', JSON.stringify(errs, null, 1));
  await b.close();
})();
