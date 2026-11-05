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
