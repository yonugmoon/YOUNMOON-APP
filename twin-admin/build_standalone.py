#!/usr/bin/env python3
"""ICT Twin 단독 운영판 빌드: ADMIN 없이 동작하는 단일 HTML
src/*.js|css (68-fusion 제외) + standalone/*.js|css + three.js · pdf.js(인라인) → ICT_Twin_Standalone.html
사용: python3 twin-admin/build_standalone.py [--out 경로]"""
import argparse, base64, json, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parent
SKIP = {'68-fusion.js', '68-fusion.css'}  # ADMIN 화면 융합 전용
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default=str(ROOT.parent / 'ICT_Twin_Standalone.html')); a = ap.parse_args()
    g = lambda t: re.sub(r'</(script)', r'<\\/\1', t, flags=re.I)
    css = [p for p in sorted((ROOT / 'src').glob('*.css')) if p.name not in SKIP] + sorted((ROOT / 'standalone').glob('*.css'))
    js = [p for p in sorted((ROOT / 'src').glob('*.js')) if p.name not in SKIP] + sorted((ROOT / 'standalone').glob('*.js'))
    parts = ['<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
             '<title>ICT Twin 단독 운영판</title><style>' + '\n'.join(p.read_text(encoding='utf-8') for p in css) + '</style></head><body>',
             '<script>window.TWINX_STANDALONE = true;</script>',
             '<script>' + g((ROOT / 'vendor' / 'three-r128.min.js').read_text(encoding='utf-8')) + '</script>']
    for sid, fn in (('twinx-pdfjs', 'pdfjs-3.11.174.min.js'), ('twinx-pdfworker', 'pdfjs-3.11.174.worker.min.js')):
        parts.append(f'<script type="text/plain" id="{sid}">' + g((ROOT / 'vendor' / fn).read_text(encoding='utf-8')) + '</script>')
    cm = ROOT / 'vendor' / 'pdfjs-cmaps-ko'
    parts.append('<script type="application/json" id="twinx-pdfcmaps">' + json.dumps({f.stem: base64.b64encode(f.read_bytes()).decode() for f in sorted(cm.glob('*.bcmap'))}) + '</script>')
    for p in js: parts.append(f'<script id="twinx-{p.stem}">\n/* ---- {p.name} ---- */\n' + g(p.read_text(encoding='utf-8')) + '\n</script>')
    parts.append('</body></html>')
    out = pathlib.Path(a.out); out.write_text('\n'.join(parts), encoding='utf-8')
    print(f'built {out} ({out.stat().st_size/1e6:.2f} MB) css={len(css)} js={len(js)}')
if __name__ == '__main__': main()
