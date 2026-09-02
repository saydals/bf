# 블랙박스 맵뷰어 버튼을 비행계획 맵뷰와 통일

## 목표
비행계획 맵뷰(`FlightPlanMap.vue`, OpenLayers)의 맵 컨트롤 레이아웃을 블랙박스 뷰어 맵(`graph_map.js`, Leaflet)에 이식하여 두 맵뷰의 버튼 배치를 통일한다. 블랙박스 전용 "손바닥(✋) 지도끌기" 버튼은 유지하되 하단좌측 그룹의 맨 오른쪽에 배치한다.

## 결정 사항 (사용자 확인됨)
1. **회전/나침반**: Leaflet은 지도 회전을 기본 지원하지 않으므로 `leaflet-rotate` 플러그인(Raruto, `map.setBearing()/getBearing()`)을 새 의존성으로 추가해 실제 회전 구현.
2. **전체화면(⛶)**: 블랙박스 기존 브라우저 Fullscreen API 유지(모달 가림 문제 없음). FlightPlan의 CSS 방식으로 변경하지 않음.

## 대상 파일
- `src/blackbox-viewer/vendor.js` — `leaflet-rotate` import 추가
- `package.json` (root) — `leaflet-rotate` dependency 추가
- `src/blackbox-viewer/graph_map.js` — 기존 컨트롤 삭제/교체, 새 컨트롤 + 회전/나침반 로직 추가
- `src/blackbox-viewer/css/main.css` — compass/rotate/zoom 컨트롤 스타일 추가(기존 `.leaflet-control-custom-map-actions` 재사용)
- (참고) `src/images/compass.svg` — `/images/compass.svg` 경로로 블랙박스에서도 동일하게 사용 가능(동일 origin)

## 구현 단계

### 1. 의존성 추가
- `package.json` root deps에 `"leaflet-rotate": "^0.2.8"` 추가.
- `src/blackbox-viewer/vendor.js` 상단에 `import "leaflet-rotate";` 추가(leaflet/marker-rotation 뒤).
- `npm install` 실행 후 빌드에서 `setBearing/getBearing` 사용 가능 확인.

### 2. 기존 블랙박스 컨트롤 삭제
- `graph_map.js` `initialize()`에서 `L.map("mapContainer", { ... zoomControl: false })` 로 기본 Leaflet 줌 컨트롤 비활성화(기존 "확대축소" 버튼 제거).
- `L.Control.MapActions`(R, S, 🏠, ⛶) 컨트롤 전체 삭제 — 아래 통합 컨트롤로 대체.
- `L.Control.MapDrag`(✋)는 별도 컨트롤로 두되, 3단계 하단좌측 통합 컨트롤 안으로 병합.

### 3. 상단좌측 컨트롤: 회전 + 확대 (FlightPlan 상단좌측과 동일)
새 `L.Control.MapTopLeft`(position: "topleft") 생성. 버튼 순서: ↺ ↻ | + −
- 회전: `myMap.setBearing(getBearing() ± 15)` (클릭, FlightPlan의 Math.PI/12 = 15°).
  - 마우스 홀드 시 3.75°(Math.PI/48)씩 반복(timer, FlightPlan 패턴 `startRotateLeft/Right`, `stopRotate`, `handleRotate*MouseUp` 참조).
- 확대/축소: `myMap.zoomIn()` / `myMap.zoomOut()` (클릭 = 1레벨). 홀드 시 반복 타이머.
- `L.DomEvent.on(btn, "click", L.DomEvent.stopPropagation)` 로 지도 클릭 전파 차단.

### 4. 상단우측 컨트롤: 나침반 (FlightPlan 상단우측과 동일)
새 `L.Control.Compass`(position: "topright") 생성.
- 컨테이너에 `<img src="/images/compass.svg" class="bb-compass-needle">` 삽입.
- `transform: rotate(${bearing}rad)` 로 바늘 회전(bearing = `myMap.getBearing()`).
- 클릭/터치 시 `myMap.setBearing(0)` (정북 리셋, FlightPlan `resetNorth` 동일).
- `myMap.on("rotate" ...)` 또는 bearing 변경 시 바늘 갱신하는 헬퍼 `updateCompass()` 추가(플러그인이 `rotate` 이벤트를 발생시키는지 확인 — 아니면 setBearing 래퍼에서 호출).

### 5. 하단좌측 통합 컨트롤: S H R ⛶ 🏠 + ✋(우측)
새 `L.Control.MapBottomLeft`(position: "bottomleft") 생성. 버튼 순서(FlightPlan 하단좌측과 동일, ✋만 추가):
`[S][H][R] | [⛶ 전체화면] [🏠 홈] | [✋ 드래그]`
- **레이어 S/H/R**: `labels = { satellite:"S", hybrid:"H", street:"R" }`. 기존 `layers=["street","satellite"]` 에 `"hybrid"` 추가(layerUrls에 이미 존재).
  - 활성 상태 표시는 기존 `.active`/`.map-btn-active` 스타일 유지(`setLayer(key)` 호출).
- **⛶ 전체화면**: 기존 `toggleFullscreen()`(브라우저 Fullscreen API) 그대로 연결.
- **🏠 홈**: 기존 `zoomHome()`(로그 GPS 홈 위치로 줌) 그대로 연결.
- **✋ 드래그**: 기존 `startMapDrag()` 로직 그대로 연결(지도 프레임 CSS 이동). 기존 `L.Control.MapDrag` 코드는 이 컨트롤 안의 버튼으로 통합하고 별도 컨트롤은 제거.

### 6. 스타일 (`main.css`)
- 기존 `.leaflet-control-custom-map-actions`(flex 컨테이너) 재사용. 모든 새 컨트롤에 동일 클래스 적용.
- `.bb-compass-needle { width:60px; height:60px; pointer-events:none; transition: transform .2s ease; }` 추가(컨테이너는 반투명 원 배경, FlightPlan `.compass-overlay` 참조).
- rotate/zoom 버튼은 기존 `button` 스타일(30×30, hover/active) 그대로 사용.
- 활성 레이어는 기존 `button.active`(`--primary`) 유지.

## 충돌/검토 필요 항목 (구현 시 확인)
- **마커 방향**: 지도 회전 시 `leaflet-rotate` 가 마커 pane도 함께 회전시키는지 확인. craft 마커(`L.rotatedMarker`, `groundCourse` 기준)가 회전 후에도 올바른 방향/위치에 표시되는지 검증하고, 필요 시 `setRotationAngle(groundCourse - bearing)` 로 보정. 웨이포인트 라벨도 upright 유지 확인.
- **나침반 갱신 이벤트**: `leaflet-rotate` 가 bearing 변경 이벤트를 제공하는지 확인하고, 없으면 `setBearing` 래퍼에서 `updateCompass()` 직접 호출.
- **기본 레이어**: 블랙박스 기존 기본값 `street` 유지(사용자 지정 없음). 필요 시 FlightPlan처럼 `satellite` 기본으로 변경 가능 — 미지정.

## 검증
- `npm run build` 및 `npm run dev` 로 블랙박스 뷰어 로드.
- 블랙박스: 상단좌측 ↺/↻ 회전, +/− 줌 동작, 상단우측 나침반 회전·클릭 시 정북 리셋, 하단좌측 S/H/R 레이어 전환·활성 표시, ⛶ 전체화면, 🏠 홈 줌, ✋ 프레임 드래그가 모두 동작하는지 확인.
- 기존 기본 줌 컨트롤과 예전 MapActions(R/S/🏠/⛶) 가 사라졌는지 확인.
- 비행계획 맵뷰 동작에 회귀 없음 확인(해당 파일은 수정하지 않음).
- `npm run lint` 통과.
