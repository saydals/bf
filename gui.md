# Setup 탭 GUI 비행기 모델 및 자세 제어 조사 결과

## 1. GUI 비행기 모델 경로

- **모델 파일**: `resources/models/airplane.gltf`
- **모델 선택 로직**: `src/js/model.js`의 `mixerList` 배열에서 `mixer` 값에 따라 결정
  - Airplane은 `pos: 13` (mixer 값 14)에 해당
  - `model: "airplane"`으로 설정되어 있어 `airplane.gltf` 파일을 로드

## 2. 비행기 자세를 제어하는 값들 (실시간 - MSP_ATTITUDE)

`SetupTab.vue`의 `renderModel()` 함수에서 다음 값들을 사용:

```javascript
function renderModel() {
    const x = fcStore.sensorData.kinematics[1] * -1 * 0.017453292519943295;  // Pitch (라디안)
    const y = (fcStore.sensorData.kinematics[2] * -1 - yaw_fix.value) * 0.017453292519943295;  // Yaw/Heading (라디안)
    const z = fcStore.sensorData.kinematics[0] * -1 * 0.017453292519943295;  // Roll (라디안)
    modelInstance.rotateTo(x, y, z);
}
```

**데이터 소스**: `fcStore.sensorData.kinematics` 배열 (FC에서 MSP_ATTITUDE 메시지로 수신)
- `kinematics[0]`: Roll (롤) - 도 단위
- `kinematics[1]`: Pitch (피치) - 도 단위
- `kinematics[2]`: Yaw/Heading (요/헤딩) - 도 단위

## 3. 데이터 흐름 (실시간)

1. `SetupTab.vue`에서 33ms 간격으로 `MSP_ATTITUDE` 요청 (`get_fast_data` 함수)
2. FC에서 응답 수신 → `fcStore.sensorData.kinematics` 업데이트
3. `renderModel()` 호출 → Three.js 모델에 회전 적용
4. `Model.prototype.rotateTo(x, y, z)`에서:
   - `model.rotation.x = x` (Pitch)
   - `modelWrapper.rotation.y = y` (Yaw)
   - `model.rotation.z = z` (Roll)

> **중요**: SetupTab은 부호를 모두 반전(`*-1`)해서 적용한다. 이 부호 규칙을 블랙박스 리플레이에도 동일하게 적용해야 한다.

---

# 맵뷰 비행기 위젯 구현 결과 (최종 적용)

블랙박스 뷰어 맵 좌하단에 비행기 자세 + 프로펠러 회전 위젯을 추가했다.

## A. 위치 / 크기 / 스타일

- **위치**: 지도 좌하단(`bottomleft`). 수직 스택 순서(위→아래):
  ```
  [비행기 위젯]
  [✋ 드래그 버튼] [고도 버튼]
  ```
  - Leaflet `bottomleft`는 **먼저 addControl한 컨트롤이 맨 아래**에 쌓이므로, 툴 행(drag+altitude)을 먼저, 비행기를 나중에 addControl해 비행기가 위로 오게 했다.
- **크기**: 일반 120×120px, 지도 전체화면 시 240×240px (`.fullscreen` 클래스 토글)
- **모양**: 원형(`border-radius: 50%`), 파란 배경(`#1e6fd9`), 흰 테두리
- **관련 코드**: `graph_map.js`의 `L.Control.MapAirplane`(마운트 포인트 `#mapAirplaneMount` 제공) / `L.Control.MapTools`(드래그+고도 한 줄), `css/main.css`의 `.leaflet-control-custom-map-airplane` / `.leaflet-control-custom-map-tools`

## B. 렌더링 구조

- Three.js를 직접 사용 (SetupTab의 `Model` 클래스는 미사용 — FC mixer 의존성 회피).
  - `src/blackbox-viewer/components/MapAirplane.vue` (Vue 컴포넌트, canvas + Three.js 래퍼)
  - WebGL 우선, 미지원 시 기존 `CanvasRenderer`(`src/js/utils/three/CanvasRenderer.js`) 폴백
  - `airplane.gltf`를 `GLTFLoader`로 직접 로드, `scale.set(15,15,15)`
- 카메라: `PerspectiveCamera(fov 60)`, `camera.position.z = 135`
- 마운트 지점: `BlackboxViewerTab.vue`가 `#mapAirplaneMount`(Leaflet 컨트롤 div)에 `MapAirplane`을 `createApp`으로 마운트. (맵 컨테이너 `#mapContainer`는 `BlackboxViewerTab.vue`에 있음 — `MapView.vue`는 고아 컴포넌트라 사용 안 함)
- 공유 Pinia 인스턴스(`pinia_instance.js`)로 `graphStore.mapGrapher` 접근

## C. 자세 데이터 (heading 직접 사용)

- 소스: 블랙박스 `heading[0..2]` (Roll/Pitch/Yaw, 라디안, 북=0)
- `graph_map.js`의 `setFlightLogIndexs()`에서 `heading[0/1/2]` 인덱스 추출
- 매 프레임 `setCurrentTime()` → `updateAirplaneAttitude()`에서 프레임 추출:
  - `heading` 있으면 그대로 사용
  - 없으면 `GPS_ground_course`(÷10)로 yaw만, roll/pitch=0
- **Yaw 보정 없음**: 아밍 시점 yaw를 잡아 북쪽에 정렬하던 로직은 제거. 로그에 기록된 실제 heading을 그대로 따라가야 방향이 맞음.
- 적용(SetupTab과 동일한 부호 반전):
  ```javascript
  model.rotation.x  = pitch * -1;   // Pitch
  modelWrapper.rotation.y = yaw * -1;  // Yaw
  model.rotation.z  = roll  * -1;   // Roll
  ```
- **초기 프레임 누락 방지**: GLTF 로드가 비동기라 첫 attitude가 사라지므로, `pendingAttitude`에 최신 값 보관 → 로드 완료 즉시 적용. 위젯 마운트 직후 `setCurrentTime(getCurrentTime())` 한 번 호출해 현재 프레임 즉시 반영.

## D. 프로펠러 회전 (쓰로틀 비례)

- 쓰로틀 추출: `throttle` 또는 `rcCommand[3]` 인덱스 → 0~1 정규화(1000~2000 스케일 시프트) → 콜백에 `throttle` 포함
- `airplane.gltf` 프로펠러 노드: `Cylinder_0`(전면), `Cylinder001_3`(후면). 이름 prefix `^cylinder`로 매칭 (`Circle_4`는 제외 — 카메라/기타)
- `requestAnimationFrame` 렌더 루프로 지속 회전:
  ```javascript
  const maxRpm = 400;                    // rad/s @ full throttle
  const speed = 20 + throttle * maxRpm;  // idle 틱(20) + 쓰로틀 비례
  propAngle += speed * dt;
  p.rotation.y = propAngle;              // 회전축 = Y (이 모델 기준)
  ```
- 속도는 쓰로틀에 비례, idle에서도 미세 회전.

## E. 주요 파일

| 파일 | 역할 |
|------|------|
| `src/blackbox-viewer/components/MapAirplane.vue` | Three.js 캔버스, 자세/프로펠러 렌더, throttle prop |
| `src/blackbox-viewer/graph_map.js` | `L.Control.MapAirplane`/`MapTools` 컨트롤, heading/throttle 추출, `onAirplaneAttitude` 콜백, `getCurrentTime()` |
| `src/components/tabs/BlackboxViewerTab.vue` | 위젯 마운트/언마운트, 콜백 연결, 현재 프레임 강제 갱신 |
| `src/blackbox-viewer/css/main.css` | 위젯 크기/원형/파랑/툴 행 레이아웃 |
| `resources/models/airplane.gltf` | 비행기 모델 (프로펠러 = `Cylinder_0`, `Cylinder001_3`) |

## F. 알려진 특이사항

- 프로펠러 매칭은 모델 파일의 노드 이름(`Cylinder`)에 의존. 모델 교체 시 `findPropellerNodes()` 패턴 갱신 필요.
- `airplane.gltf` 노드 이름이 의미 없음(`Object_4` 등)이나, 프로펠러는 `Cylinder_0`/`Cylinder001_3`로 식별됨.
- 맵 탭이 비동기 초기화되므로 `#mapAirplaneMount` 생성 전까지 `BlackboxViewerTab.vue`가 200ms 폴링.
