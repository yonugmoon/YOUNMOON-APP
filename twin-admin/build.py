#!/usr/bin/env python3
"""TwinX 레이어 빌드: base/ICT_Twin_ADMIN_5.html + vendor(three) + src/*.css + src/*.js → ICT_Twin_ADMIN_6.html

ADMIN_5 의 레이어 방식(fs-layer / role-layer / v14-layer)과 동일하게,
기존 React 번들은 건드리지 않고 </body> 직전에 <!-- twinx-layer --> 블록을 덧붙입니다.

사용: python3 twin-admin/build.py [--out 경로]
"""
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
BASE = ROOT / 'base' / 'ICT_Twin_ADMIN_5.html'
VENDOR = ROOT / 'vendor' / 'three-r128.min.js'
SRC = ROOT / 'src'
DEFAULT_OUT = ROOT.parent / 'ICT_Twin_ADMIN_6.html'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    args = ap.parse_args()

    html = BASE.read_text(encoding='utf-8')
    css_files = sorted(SRC.glob('*.css'))
    js_files = sorted(SRC.glob('*.js'))
    if not js_files:
        sys.exit('src/*.js 가 없습니다')

    def guard(text, name):
        # 인라인 <script> 안에서 문자열 '</script' 가 나오면 문서가 깨지므로 이스케이프
        return re.sub(r'</(script)', r'<\\/\1', text, flags=re.I)

    parts = ['<!-- twinx-layer:start -->']
    parts.append('<style id="twinx-css">\n' + '\n'.join(f'/* ---- {p.name} ---- */\n' + p.read_text(encoding='utf-8') for p in css_files) + '\n</style>')
    # Three.js r128 (MIT) — ADMIN 은 오프라인 단일 파일이므로 CDN 대신 인라인. 기존 전역 THREE 가 있으면 재사용.
    three = VENDOR.read_text(encoding='utf-8')
    parts.append('<script id="twinx-three">if(!window.THREE){\n' + guard(three, 'three') + '\n}</script>')
    for p in js_files:
        parts.append(f'<script id="twinx-{p.stem}">\n/* ---- {p.name} ---- */\n' + guard(p.read_text(encoding='utf-8'), p.name) + '\n</script>')
    parts.append('<!-- twinx-layer:end -->')
    block = '\n'.join(parts)

    # 재빌드 시 기존 블록 제거 후 삽입
    html = re.sub(r'<!-- twinx-layer:start -->.*?<!-- twinx-layer:end -->\n?', '', html, flags=re.S)
    idx = html.rfind('</body>')
    if idx < 0:
        sys.exit('</body> 를 찾지 못했습니다')
    html = html[:idx] + block + '\n' + html[idx:]
    # 제목에 에디션 표기
    html = html.replace('<title>정보통신설비 DB·디지털 트윈·측정 통합</title>', '<title>정보통신설비 DB·디지털 트윈·측정 통합 (ADMIN 6 · 2D/3D TwinX)</title>', 1)

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print(f'built {out} ({out.stat().st_size/1e6:.2f} MB) css={len(css_files)} js={len(js_files)}')


if __name__ == '__main__':
    main()
