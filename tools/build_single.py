"""AR_설비점검.html + lib/*.js → dist/index.html (GitHub Pages에 파일 하나만 올리면 되는 배포판)"""
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)) + "/..")
src = open("AR_설비점검.html", encoding="utf-8").read()
def inline(path):
    js = open(path, encoding="utf-8").read().replace("</script", "<\\/script")
    return f"<script>\n/* {path} (inlined) */\n{js}\n</script>"
for lib in ("lib/jsQR.js", "lib/qrcode.js"):
    tag = f'<script src="{lib}"></script>'
    assert tag in src, tag
    src = src.replace(tag, inline(lib))
src = src.replace('<!-- 오프라인 동작을 위해 라이브러리를 저장소에 포함(lib/) -->',
                  '<!-- 단일 파일 배포판: QR 라이브러리 내장 (jsQR Apache-2.0, qrcode-generator MIT) -->')
sw = 'if("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("service-worker.js").catch(()=>{});'
assert sw in src
src = src.replace(sw, "")
os.makedirs("dist", exist_ok=True)
open("dist/index.html", "w", encoding="utf-8").write(src)
print("dist/index.html", len(src.encode()), "bytes")
