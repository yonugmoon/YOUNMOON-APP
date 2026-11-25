# TwinX 통합 계약서 (5개 팀 공용)

ADMIN_5(`base/ICT_Twin_ADMIN_5.html`)는 **빌드된 React 번들 + 덧붙인 레이어(fs/role/v14)** 구조입니다.
번들은 절대 수정하지 않고, ADMIN_5와 같은 방식으로 **TwinX 레이어**를 `</body>` 앞에 덧붙여
`ICT_Twin_ADMIN_6.html`을 만듭니다 (`python3 twin-admin/build.py`).

목표: ADMIN의 「디지털 트윈」 메뉴에 **전체화면 2D/3D 통합 도면 뷰어**를 추가.
사용자 불만 = "구성이 너무 많아 도면 창이 좁다" → **도면(뷰포트)이 화면의 대부분**을 차지하고,
시안 4종·돌하우스 제어·레이어 등 컨트롤은 상단 툴바 팝오버/서랍으로 접어 넣습니다.

## 1. 파일 소유권 (자기 파일만 수정)
| 팀 | 파일 | 전역 API |
|---|---|---|
| 통합 리드 | `src/00-core.js`, `build.py`, `CONTRACT.md` | `TwinX` (코어) |
| T1 데이터·연동 | `src/10-data.js` | `TwinX.data` |
| T2 UX·셸 | `src/20-shell.js`, `src/20-shell.css` | `TwinX.ui`, `TwinX.shell` |
| T3 2D CAD | `src/30-cad2d.js`, `src/30-cad2d.css`(선택) | `TwinX.cad2d` |
| T4 3D 엔진 | `src/40-scene3d.js`, `src/40-scene3d.css`(선택) | `TwinX.scene3d` |
| T5 분석·QA | `src/50-analysis.js`, `test/*` | `TwinX.analysis` |

- 다른 팀 파일·`base/`·`vendor/`는 수정 금지. 계약 변경이 필요하면 최종 보고에 "계약 변경 요청"으로 적으세요.
- 빌드 순서: CSS 전부(파일명순) → three r128(인라인, 전역 `THREE`) → JS 파일명순(00→50). 
  로드 순서와 무관하게 동작하도록 **이벤트로 결합**하고, 다른 팀 API는 호출 시점에 존재 여부를 확인(`TwinX.analysis && ...`).
- 모든 CSS 클래스·id는 `tx-` 접두어 (ADMIN CSS와 충돌 방지). 전역 변수 추가 금지(IIFE).
- 자동 수집(센서) 값은 없습니다. 측정값은 ADMIN에 등록된 **정기점검 실측 자료**만 사용하고, 화면에 "실측/정기점검" 등 출처를 정직하게 표기.

## 2. 정규화 모델 `TwinX.model` (T1이 생성, 모두 읽기 전용)
좌표 단위 **mm**, 층 평면 좌상단 원점, x→동(오른쪽), y→남(아래). 예시는 `TwinX.demoModel()`.
```
{
  source: 'admin' | 'demo',
  site: { name, building },
  floors: [{ code:'F04', name:'4층', level:4, building, elevation:12.6 /*m: 지상 (level-1)×4.2, 지하 level×4.2*/, bounds:{x0,y0,x1,y1} /*mm*/,
             trays:[{a:[x,y], b:[x,y], main:true}] /*추정 케이블트레이 경로 mm*/ }],   // 위층→아래층 순
  rooms:  [{ id:'F04-R1', floor:'F04', building, name:'MDF실', type /*C.ROOM 키*/, x,y,w,h /*mm*/,
             door?: 'N'|'S'|'E'|'W', measures:[Measure], raw }],
  assets: [{ id:'A001', room:'F04-R1', floor:'F04', name, category /*설비구분*/, kind, model, maker, spec,
             x,y /*mm, 층 평면 절대좌표*/, status:'정상'|'주의'|'이상'|..., grade:'GREEN'|'YELLOW'|'ORANGE'|'RED'|'NONE',
             measures:[Measure], rack?:{name, u /*표시용 '20U~24U'*/, u0, u1 /*숫자*/}, gradeReason?, raw }],
  links:  [{ id, from /*asset id*/, to, type:'data'|'optical'|'power'|'ground'|'path', label, cable }],
  risers: [{ id, name, x, y /*mm*/, floors:[floorCode...] }],         // 층간 수직 간선(TPS/EPS 기반 추정)
  measurements: [Measure],                                           // 전체 실측 행
  updatedAt
}
Measure = { std:'gnd'|'heat'|'pwr'|'sig'|'env'|null, item, value, unit?, judge:'good'|'bad'|'na'|'none', warn?:boolean,
            date /*없으면 null*/, assetId?, roomId?, match? /*매칭 근거: 'asset'|'room'|... 추정 여부 표시용*/, source? /*'row'|'history'|'v14-snapshot'*/, raw }
```
- (v1.1, T1 요청 승인) floors.building, rack.u0/u1, Measure.warn/match/source 공식화. 측정 매칭은 추정일 수 있으므로 화면에 `match`·`source` 근거를 함께 표기.
- `kind`: `'rack'|'server'|'power'|'ap'|'cctv'|'video'|'ground'|'tray'|'panel'` (3D 모델·2D 심볼 결정).
- `grade` 규칙(T1): 상태 '이상'/'불량' 또는 실측 bad → RED, '주의' → ORANGE, 실측 경고성(주의) → YELLOW, 그 외 GREEN, 자료 없음 NONE.
- 링크 방향 `from → to` = 상위(공급) → 하위(의존). ADMIN `연결유형` 매핑: 케이블→data, 광→optical, 전원→power, 접지→ground.

## 3. 공유 상태 `TwinX.state` (코어 정의, `TwinX.setState(patch)`로만 변경)
`open, view('2d'|'3d'|'split'), concept('A'|'B'|'C'|'D'), floor, stack, ghost, riser, labels, explode(1.0~2.4), walk,
layers{tray,links,thermal,ground,measure}, selected, room, fault{active,source}, panel{inspector,floors,legend}`

## 4. 이벤트 (TwinX.on / emit)
| 이벤트 | payload | 발행 | 구독 |
|---|---|---|---|
| `model` | model | T1 (`TwinX.setModel`) | 모두 |
| `state` | `{state, changed:[keys]}` | 코어 | 모두 |
| `select` | assetId\|null | 코어 `TwinX.select(id)` | T2 인스펙터, T3, T4 |
| `open` / `close` | state | 코어 `TwinX.open()/close()` | T2가 DOM 생성 후 `ui-ready` 발행 |
| `ui-ready` | TwinX.ui | T2 | T3·T4는 이때 자기 컨테이너에 mount |
| `resize` | `{view}` | T2 (레이아웃·패널 변경, 창 크기) | T3·T4 |
| `camera` | `{preset}` | 코어 `TwinX.camera(p)` | T4 ('iso','front','top','reset','focus') |
| `fault` | `{source, impact:Map}` | T5 (state.fault 변경 시 계산) | T2·T3·T4 |
| `toast` | `{msg, kind}` | 누구나 | T2가 표시 |

## 5. T2가 만드는 컨테이너 `TwinX.ui`
```
TwinX.ui = { root, toolbar, viewport, view2d, view3d, floorRail, inspector, statusbar,
             toast(msg, kind), isVisible('2d'|'3d') }
```
- `view2d`, `view3d`는 `position:relative; overflow:hidden`인 div. 렌더러는 그 안에만 그림(오버레이 라벨 포함).
- 뷰어는 `position:fixed; inset:0` 전체화면 오버레이. **뷰포트 면적 ≥ 화면의 80%** (1600×900 기준).
  인스펙터·층 레일은 뷰포트 위에 떠 있는 접이식 패널(뷰포트를 줄이지 않음), 툴바 ≤ 52px, 상태바 ≤ 28px.
- (v1.2, T2) `TwinX.ui.safeArea(view?) → {x,y,w,h}`(px): 떠 있는 레일·인스펙터·범례·시트를 뺀 빈 영역(view 지정 시 그 뷰 기준 좌표).
  `resize` payload `{view, size2d, size3d, safe2d, safe3d}`. 숨은 뷰는 `display:none`(크기 0) → `isVisible` 확인 후 렌더.
  `ui-ready`는 DOM 최초 생성 시 **1회만**, 이후 열기는 `resize`만 발행. 뷰 내부 오버레이(줌 버튼·미니맵·힌트)는 safeArea 안에 배치.
- 내보내기 메뉴는 `TwinX.cad2d.exportSvg()/exportPng()`, `TwinX.scene3d.snapshot()`(PNG Blob 다운로드)을 호출.

## 6. 진입점
- ADMIN 「디지털 트윈」 화면(`.work-area > .canvas-panel .panel-heading`)에 T2가 **"2D·3D 통합 뷰어"** 버튼 주입,
  ADMIN의 현재 층(`select.floor-select` 값 = 층코드)으로 열기. 홈/어디서나 단축키 `Shift+T`(입력창 포커스 제외).
- `TwinX.open({floor:'F04', view:'3d'})` 코드 호출로도 열림.

## 7. 디자인 토큰
- 크롬(툴바·패널): ADMIN 톤 — 네이비 `#14293f`, 블루 `#3e63db`, 텍스트 `#22374d`, 보더 `#e1e7ee`, 폰트 `Arial,"Noto Sans KR","Malgun Gothic",sans-serif`.
- 뷰포트 캔버스: 다크 블루프린트 `#06101f`(2D 도면 용지) / 3D 배경 `#070c18`.
- 등급·링크·실 유형 색은 반드시 `TwinX.C.GRADE / C.LINK / C.ROOM` 사용.

## 8. 참고 구현 (포팅 원본)
`/home/user/YOUNMOON-APP/ICT_Twin.html` — 이미 시연 품질로 검증된 단독판. 함수 위치:
- 2D CAD: `render2DCadBlueprint`, `cadSymbol`, `cadDefs`, `initCadInteractions` (구조 그리드, 치수선, 해치, 문, 트레이, 라이저, 심볼, 인출 태그, 범례, 표제란, 팬/줌, SVG/PNG)
- 3D: `buildDollhouse3DScene`, `floorPlanTexture`, `addDollhouseRoomWallWithDoor`, `addLadderTray`, `addEquipmentModel`, `addRelationArcs3D`,
  `addImpactRing3D`, `renderProjectedRoomLabels`, `renderMinimap`, `initThreeScene`(포인터·핀치·워크·fly-to), 시안 B/C/D 는 `build3DFloorObjects`
- 분석: `computeImpact`, `computeRisk`, `RELATIONS`
단독판은 고정 데이터(DOLLHOUSE_ROOMS 단위 2.5m)를 쓰지만, ADMIN판은 **임의 개수의 층·실·설비(mm 좌표)** 를 받아야 합니다.

## 9. 시험 방법
- 빌드: `python3 twin-admin/build.py --out /tmp/claude-0/-home-user-YOUNMOON-APP/8ea51f00-feb0-54ed-8321-7e2e1600c56e/scratchpad/<팀>/admin6.html`
  (팀별 출력 경로를 써서 서로 덮어쓰지 않게)
- 브라우저: Playwright(`require('playwright')`, `chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']})`).
  ADMIN은 외부 리소스가 없어 `file://`로 바로 열림. `await page.evaluate(()=>TwinX.open({view:'3d'}))`.
- 공용 헬퍼: `node twin-admin/test/shot.js <html> <outDir> [view] [concept]` (T5가 확장 가능) — 콘솔 오류 출력 + 스크린샷.
- 스크린샷은 직접 열어 눈으로 품질을 확인하세요 (Read 도구로 PNG 확인).
- git 커밋·푸시는 하지 마세요 (통합 리드가 함).

## 10. v1.3 현행화 도구 (`src/60-workbench.js`, 통합 리드)
- **랙·U 입력** `TwinX.rack = {get,set,remove,all,exportJSON,importJSON}` — localStorage `twinx_rack_v1` `{설비ID:{name,size,u0,u1,face,at}}`.
  T1(10-data)이 v14 시범값보다 우선 적용(`asset.rack.source:'user'`), 빈 name은 랙 정보 삭제. 인스펙터 「랙 · U」 행의 `[data-act="rack-edit"]` 버튼으로 편집.
- **CAD 배경** `TwinX.underlay = {get(floor), image(floor), update, remove, fitToFloor, load(floor,File), list}` — IndexedDB `twinx_underlay_v1`.
  레코드 `{floor, name, w, h /*px*/, tf:{s /*mm/px*/, rot /*rad*/, tx, ty /*mm*/}, opacity, show, invert}`; 이미지 px→평면 mm = R(rot)·s·p + t.
  변경 시 `underlay` 이벤트. T3는 실 바닥 위·열화상 아래에 `<image>`(내보내기 시 dataURL), T4는 층 텍스처에 곱하기 합성. `state.layers.underlay`로 일괄 숨김.
- T3 추가 API: `TwinX.cad2d.screenToMm(clientX, clientY)`, `mmToScreen(x, y)` (2점 맞춤용).
- **구조 편집(v1.4)** `TwinX.geom = {all,setDoor,clearDoor,addTrayPath,removeTrayPath,clearTrays,addRiser,updateRiser,removeRiser,exportJSON,importJSON}` —
  localStorage `twinx_geom_v1` `{doors:{실ID:{side:'N'|'S'|'E'|'W'|'none', at /*벽 방향 mm(N/S=x, E/W=y)*/, w /*mm*/}}, trays:{층코드:[{a,b,main,path}]}, risers:[{id,name,x,y,floors}]}`.
  T1 적용: `room.door/doorAt/doorW/doorSrc:'user'` (`door:'none'` = 문 없음), 층에 등록 트레이가 있으면 `floor.trays` 교체(`source:'user'`),
  등록 라이저가 하나라도 있으면 `model.risers` 전체 교체(`source:'user'`, `estimated:false`). T3·T4는 `doorAt`/`doorW`가 있으면 그 위치·폭으로 그림.
- 툴바 「현행화 ▾」(`data-act="wb-menu"`) → 도면 배경 / 구조 편집 / 랙·U 입력.
- **측정 매칭 확인(v1.5)** `TwinX.matching = {open, groups, stats, set, exportCSV}` — localStorage `twinx_match_v1`
  `{그룹키 "건물|층|점검 위치|설비": {assetId}|{roomId}|{ignore:true}}`. T1이 자동 매칭보다 먼저 적용(`Measure.match:'manual'|'ignored'`, `Measure.groupKey`).
  측정 행 서명이 바뀌면(업로드) ADMIN 화면 우하단에 확인 알림(`twinx_match_seen_v1`로 1회 표시), 툴바 「현행화 ▾ → 측정 매칭 확인」.
- **간이 현행화 모드(v1.6)** `TwinX.quick = {active, open, close, draft, parseTable, parseLoc, buildXlsx, model}` (`src/65-quick.js`) —
  현장 자료(설비 현행화표 + 대피소/종이 도면 사진)만으로 초안 모델을 만든다. localStorage `twinx_quick_v1`
  `{active, site, buildings[{code,name}], floors[{code,building,bcode,name,level,w,h}], rooms[{id,floor,name,kind,x,y,w,h}], assets[{id,tag,name,model,maker,year,note,floor,room,x,y,status,category,srcLoc}], links, autoLinks, source[]}`.
  5단계: ① 현행화표 붙여넣기(TSV, 수량 → #1·#2 전개, 「확인불가」→빈칸) ② 도면 사진(`TwinX.underlay.load`) + 2점 치수 축척 ③ 실 사각형 그리기(100mm 스냅)
  ④ 클릭 배치(실 내부만) ⑤ 같은 층 OFD→중계기/RU 광 자동연결 · 점검 · ADMIN 엑셀(01~06 + 측정값 데이터 + 현행화표_원본) 내보내기.
  작업 중(`TwinX.quick.active()`)에는 T1 `refresh()`가 ADMIN 데이터로 덮어쓰지 않고 `source:'quick'` 초안 모델을 유지. 메뉴 「현행화 ▾ → 간이 현행화 모드」.
- **제작 파이프라인(v1.7)** `TwinX.pipe` (`src/66-pipeline.js`) —
  `pdfToImage(file,page)` · `pdfTables(file)` (pdf.js 3.11.174 + 한글 CMap, 빌드 시 `text/plain`/JSON 인라인 → 필요할 때 Blob 로딩),
  `readAny/readXlsx/readDocx/unzip` (DecompressionStream, 외부 라이브러리 없음),
  `photos = {open,count,add,all,exportZip}` — IndexedDB `twinx_photo_v1` `{key:"설비ID|full|plate|module|n", asset, slot, n, blob(JPEG), w, h, at}`,
  `diagrams = {open, riser(), topo()}` (현재 `TwinX.model` 기준 SVG), `report = {open, load, sheets, send}` — 결과서 → 9열 측정 + 트윈연결 + 변환검증,
  `send()`는 ADMIN 「측정 엑셀 등록」의 파일 선택을 가로채 변환 파일을 전달(실패 시 다운로드).
  `TwinX.quick` 추가: `autoDraw(codes, all)`, 초안 설비 필드 `serial`, `plateOk`, 링크 `type: optical|data|power`(수동 층간 연결), 내부 접근점 `TwinX.quick._`.
- **화면 융합(v1.8)** `TwinX.fusion = {dock, undock, expand, setMode('full'|'side'), docked, mode}` (`src/68-fusion.js`) —
  ADMIN 「설비 디지털 트윈」 상단 탭에 `[data-dtmode="twin"]` 「4. 입체 트윈」 추가. 선택 시 `#tx-root`를 `.canvas-panel > .tx-dock-host`로 옮겨 `.tx-docked`(position:absolute)로 표시,
  `side` 모드는 `.drawing-wrap` 폭을 줄여 ADMIN 토폴로지와 나란히. 동기화: `select.floor-select` ↔ `state.floor`, `g.equipment` 클릭 ↔ `TwinX.select`(ADMIN 상세 패널 갱신, 카드 강조 `.tx-fuse-sel`).
  도킹 중 뷰어 단축키는 뷰어 안에 초점이 있을 때만(20-shell), 뷰어 ✕/ESC → 탭 1 복귀, 「⛶ 크게」 → 기존 전체화면. 너비는 컨테이너 기준 클래스 `tx-cq-m/s/xs`. localStorage `twinx_fusion_mode_v1`.
- **설비 묶음(v1.9)** 00-core `applyBundles(model)`(setModel 시 자동) — `a.rack.bundle` (랙 입력 `bundle:true`, 간이 현행화 `bundle`) 또는 ADMIN 규격 태그 `[묶음:이름]`·`[묶음:이름:U03-04]` →
  같은 실·같은 이름이면 `a.bundle = {key,name,lead,ids,n}`. `TwinX.bundleLead(id)`, `TwinX.bundleView(a)`(이름=묶음, 등급=최악, kind=rack, 실측 합산).
  T3 2D·T4 3D(A·D)는 대표 1개만 배치하고 모듈은 같은 위치로 별칭(선택 링·연결·카메라), 묶음 내부 연결은 생략. 시안 B는 기존 랙 실장으로 모듈 표시. 인스펙터 「묶음 슬롯」.
  편집 `TwinX.bundleEdit = {open,save,auto,suggestions}` (`src/67-bundle.js`), `TwinX.rack.setMany`.
- **구조 편집 v2** 클릭 모드는 버튼으로 시작(`tool.active`), 문·라이저는 1회 지정 후 종료, 트레이는 도면 위 바 「✔ 경로 완료 / ↶ 점 취소 / ✖ 취소」, 하단 「✔ 저장됨 시각 · 편집 완료」.
- **간이 현행화 완료** 단계 ✔ 표시, 「✔ 현행화 완료 · 저장」(점검→엑셀) → 「ADMIN에 등록(적용)하기」(`TwinX.pipe.adminUpload`로 데이터 관리 엑셀 등록에 전달). 초안 `savedAt`, `done{at,file,summary,dirty}`.
- **꿈꾸기 현행화 점검(v2.0)** `TwinX.dream = {run, open, last, calibrate, cases, memory}` (`src/69-dream.js`) — 4층 기억 구조:
  1층 원본(측정 행·설비 원본, 수정 없음) · 2층 변경 노트(`twinx_dream_v1.notes`, 설비당 20건) · 3층 토폴로지 점검(끊긴 연결·고립 설비·랙 U 중복) · 4층 MEMORY.md(≤200줄/25KB).
  자료 변경 시(디바운스 2.5s, demo 제외) 자동 실행 → 스냅샷 대조로 변경 노트, 불일치 `fixes[{id,lv,t,d,act}]`(자동 수정 없음), 중요도(Salience) 기반 승격/해소. 이벤트 `dream`.
  위험도 국소 보정: `TwinX.analysis.WEIGHTS` 중 1개만 ±5/10 변경해 놓침(불량인데 <40)·과대(양호인데 ≥60) 최소화 → 승인 시 `twinx_riskw_v1` 저장.
- **데이터 관리·계통도·정합(v2.1)**
  - `src/71-reset.js` `TwinX.adminSync = {raw, sheets, push(t,msg,{keepQuick}), merge(t,draftSheets), plan:{demo,rebuild,unplace,all}, backup, restore}` · `TwinX.dataCenter.open()`.
    ADMIN 변경은 항상 ADMIN 엑셀 등록 검증·적용 창 경유. 빈 층은 자리표시 실 `<층코드>-UNASSIGNED`(실유형 '미지정') — 10-data 는 그리지 않고 소속 설비를 `unplaced:'room'`.
    ADMIN 은 설비 X·Y 필수 + 소속 실 범위 검증 → 배치 해제는 자리표시 실로 이동 + 규격 `[원위치:실코드]`.
  - 10-data: 등록 자료가 비면 빈 모델(`empty:true`, 데모로 대체 안 함), 좌표 없는 설비 `unplaced:'pos'`(임의 격자 배치 안 함), `TwinX.data.raw()`.
    **ADMIN IndexedDB 를 직접 열지 않음**(동시 접근 시 ADMIN 저장 자료 불러오기 실패 재현) — 기대 실 개수 `twinx_admin_expect_v1` 로 새로고침 직후 시범 자료 오인 방지, 60·66 IndexedDB 초기 읽기 1.5~1.8s 지연.
  - `src/70-topo.js` 보기 `view:'topo'` (단축키 4) · 노드 배치 `twinx_topo_layout_v1`(설치 좌표와 별개) · 연결 추가/삭제 → 초안 즉시 / ADMIN 대기 후 반영.
  - 65-quick: `startFloors`, `loadFromAdmin(codes)`(ID 유지), 등록 시 `adminSync.merge` 로 **초안 층만 교체**, 4점 정합(A→A′, B→B′ 이동+축척, 트레이·라이저 동반), 미배치 설비도 대장에 보존.
  - 표시: 기본 간단 라벨(`layers.tagDetail` 켬 = 상세), 상태 색 기준 `layers.gradeAdmin`(ADMIN 등록 상태만, `twinx_grade_basis`), 원래 값 `asset.gradeMeas`.
- **설비 표 등록 · 한 번에 저장(v2.2)** 65-quick ①: 표 붙여넣기 → 미리보기(`tool.pv`) — 「이 장비들은 같은 랙 설비인가요?」 하나의 랙(묶음)/같은 장비끼리/묶지 않음,
  설치 위치 열이 없으면 층·실 선택(실 선택 시 바로 배치). `importTable(rows, {loc, floor, room, group, bname})`.
  ⑤ 「✔ 검증 후 ADMIN에 저장」 = 점검 → 백업 → 층 단위 병합 → `adminUpload(..., {autoApply, onDone})` 가 ADMIN 「검증 완료」 시 「전체 교체 적용」 자동 → 뷰어 재열기.
- **관제 대시보드(v2.3)** `TwinX.dash = {open, close, toggle, active, data}` (`src/72-dash.js`) — 툴바 「관제」: `state.dash=true` + view 3d·전층 적층,
  우측 차트 패널(정상률 도넛·연결 계통·층별 설비·측정 추이·기술기준 적합률·조치 우선 설비), 3D 위 지표 카드 6개(실제 설비·실로 연결선 = `TwinX.scene3d.project(id)`),
  3D 표현 전환(히트맵 D / 투시 A+ghost / 돌하우스 A / 계통 C), 하단 바로가기. 수치는 등록·점검 자료 기준(실시간 센서 아님 명시).
  T4: `state.dash` 일 때 시안 D 가 실 바닥 기본색 + 위험도 지점 히트맵, 슬래브 어두운 색, 이상·주의 설비만 라벨.

## v2.4 — 점검 결과 대시보드 (73-report)
- 툴바 「점검결과」 → `TwinX.report2.open(view?)` (1 종합 · 2 측정목록 · 3 현장 증빙·조치), `close()`, `active()`, `data()`.
- 데이터: `TwinX.model.measurements` + 설비/실 `measures` 를 매번 집계(하드코딩 없음). 판정은 측정의 `judge`(bad/good/na/none)·`warn` 그대로.
- 측정 행 → 설비·실 연결 시 「2D/3D에서 보기」로 대시보드를 닫고 해당 층·설비 선택.
- 조치 상태(접수→조치 계획→조치 중→조치 완료→재측정 확인)·메모: localStorage `twinx_action_v1` (키 = `설비ID|측정ID`). 화면 설정: `twinx_rp_pref_v1` {theme, mode}.
- 증빙 사진 첨부는 `TX.pipe.photos.add(assetId, 'full', [file])` (설비 사진과 같은 저장소).

## v2.5 — ADMIN 측정 대시보드 교체 (74-msdash)
- `TwinX.report2.create(opts)` — 점검결과 화면 인스턴스. opts: `inline`(내장), `source`('inspection' = ADMIN 측정 시트 행만), `meta()`({site, date} 머리 줄), `onLegacy()`.
- 74-msdash: ADMIN `section.measurement-workspace`(대시보드 탭)에서 `.ms-filters/.ms-source/.ms-kpis/.ms-charts` 를 숨기고 그 자리에 내장(`.tx-rp-inline`).
  머리 줄·탭·하단 분석(①② 분석·요약 = `data-fs-sec`)은 ADMIN 그대로. fs-on 격자에서는 행 2~5 차지.
  `TwinX.msdash = {on, off, active, sync}` · 설정 `localStorage twinx_msx_v1` ('off' 이면 기존 화면, 화면 하단 알약 버튼으로 복귀).
- 건물·층·위치·설비는 원본 측정 행 값을 우선(ADMIN 묶음과 일치), 트윈 매칭 값은 보조. 행 점검일이 없으면 ADMIN 머리 줄 점검일 사용.
- 운영 지표 카드: ADMIN v14 와 같은 `localStorage ict_twin_v14_ops` 를 읽고 엔지니어 모드에서 같은 형식으로 추가.

## v2.6 — 도면 사진 자동 인식 (75-autoplan)
- `TwinX.autoplan = {autoCrop(file), detectPins(rec), roomAt(rec, ix, iy), roomAtWorld(floor, mm), pinRooms(floor), PINS}` — 브라우저 픽셀 분석(외부 전송 없음).
- 현장수집 앱 「실 위치」 핀: 색 = 실 유형 (MDF #2563EB · IDF #0891B2 · TPS #7C3AED · EPS #EA580C · 통신 #16A34A · 전산 #0F766E), 세로 물방울 + 머리 흰 구멍 조건.
  핀마다 실 생성(닫힌 벽 윤곽이면 윤곽, 아니면 표준 3×3m). 같은 유형 실이 핀을 덮고 있으면 건너뜀.
- `TX.quick.attachPlan(file, floor)` — 사진/PDF/캡처 → 앱 화면 테두리 자르기 → 배경 도면 → 핀 인식. ② 도면 올리기와 「점검 결과서 변환」(이미지 동시 선택, 워드 안의 큰 그림)에서 사용.
- ③ 실 그리기: 실 유형 칩(MDF·IDF·TPS·EPS·통신·전산), 「◎ 클릭으로 실 인식」(cap mode 'autoroom'), 「📍 실 위치 핀 인식」. ROOM_TYPES 에 '전산실'(server) 추가.
