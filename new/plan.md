# FlightPlan 표고 프로필 수정 작업 지시서

> **작업 대상 코드베이스**: `saydals/bf` (Betaflight Configurator 포크)
> **수정 범위**: `src/components/tabs/FlightPlan/`, `src/composables/useFlightPlan.js`, `src/stores/settings.js`, `locales/`
> **작업 순서**: 표고 프로필(ElevationProfile.vue) 수정 → 웨이포인트 목록(WaypointList.vue) 수정 → CLI 수정
> **우선순위**: HIGH

---

## 0. 참고 사항

### 0.1 지도창 모바일 터치 조작 참조

`FlightPlanMap.vue`에서 구현된 **안드로이드 모바일 터치** 패턴을 그대로 참조할 것. 이 패턴은 이미 모바일에서 검증됨:

- `pointerdown` → 드래그 시작 감지, `DragPan` interaction 일시 비활성화
- `pointermove` → 실시간 좌표 업데이트, 좌표 유효성 검사 (`isFinite`, `|coord| > 3e7` 가드)
- `pointerup` / `pointercancel` → 드래그 종료, `DragPan` 재활성화
- 클릭(이동 거리 ≤ 3px)과 드래그를 명확히 구분

표고 프로필의 드래그 구현도 동일한 pointer event 패턴을 사용할 것.

### 0.2 기존 단위 시스템 (변경 금지)

| 항목 | Storage 단위 | Display (nautical) | Display (metric) | CLI 프로토콜 |
|------|-------------|-------------------|------------------|-------------|
| altitude | **feet** | ft | m | cm |
| speed | **knots** | kt | km/h | cm/s |
| distance | **meters** (Haversine) | nm | km | — |

- Storage 단위(feet/knots)는 절대 변경하지 말 것. CLI 변환 상수(`FEET_TO_CM=30.48`, `KNOTS_TO_CMS=51.4444`)가 이를 기준으로 함.
- `settings.formatAltitude(ft)` 는 storage feet → display string 변환
- `settings.formatSpeed(kt)` 는 storage knots → display string 변환
- **단, 속도 표시는 이번 작업에서 m/s 기준으로 추가 변경이 필요함 (문제 3 참조)**

### 0.3 파일 구조

```
src/components/tabs/FlightPlanTab.vue     — 부모 탭, 툴바(Save/Load/Clear 버튼)
src/components/tabs/FlightPlan/
  ├── ElevationProfile.vue                — 표고 프로필 SVG 차트 (주 수정 대상)
  ├── WaypointList.vue                    — 웨이포인트 목록 리스트
  ├── WaypointEditor.vue                  — 웨이포인트 편집 다이얼로그
  └── FlightPlanMap.vue                   — 지도 (참조용, 터치 패턴)
src/composables/useFlightPlan.js          — 데이터 모델, CLI 통신
src/stores/settings.js                    — 단위 변환 (formatAltitude, formatSpeed 등)
locales/ko/messages.json                  — 한국어 i18n
locales/en/messages.json                  — 영어 i18n
```

---

## 1. 문제 1: 해발고도(AMSL) → 지상고도(AGL) 시스템 전환

### 1.1 문제 설명

RC 기체는 기압계를 사용하므로 **해발고도(AMSL)**가 아닌 **지상고도(AGL)**를 사용한다. 현재 코드는 모든 고도를 AMSL로 취급하고 있어, 고지대에서 비행 시 기체가 계속 상승하려 하는 문제가 발생한다.

### 1.2 설계 원칙

**`wp.altitude` (storage)는 "WP1 지표고도 기준 상대고도(AGL)"를 저장한다.**

- **WP1**: `wp.altitude` = 기체해발고도(AMSL) - WP1 지표고도 = 지상고도(AGL)
- **WP2 이후**: `wp.altitude` = WP1 기준 상대고도. 즉, WP2의 실제 기체 해발고도 = `wp.altitude + WP1_지표고도`
  - 단, WP2의 지표고도가 WP1보다 높으면 지상간격(AGL)이 줄어듦. 충돌 방지를 위해 **각 WP의 최소 입력값은 해당 WP 지표고도 - WP1 지표고도가 되어야 함** (문제 2에서 상세)

### 1.3 데이터 모델 변경 (`useFlightPlan.js`)

기존 `wp.altitude`의 의미를 AMSL에서 AGL(WP1 기준)로 변경. **storage 단위는 여전히 feet**.

이 변경은 **선언적**으로 처리 — `wp.altitude` 값 자체의 의미가 바뀌는 것이므로 데이터 구조(schema) 변경은 없음. 대신:

1. **`addWaypointAtLocation`**: 새 WP 생성 시 기본고도를 기존 `DEFAULT_ALTITUDE = 400` (feet)에서 **100 feet (약 30m)** 로 변경. RC 비행에 더 적절한 기본값.
   ```js
   const DEFAULT_ALTITUDE = 100; // feet AGL (약 30m)
   ```

2. **`loadFromFC` / `saveToFC`**: CLI 통신은 **이미 AGL cm**를 주고받으므로 변환 로직 변경 없음. FC가 보내는 고도값은 기압계 기준(AGL)임.

3. **`parseWaypointLine`**: 기존대로 `altCm / FEET_TO_CM`로 feet AGL로 변환. 변경 없음.

4. **`waypointToCliCommand`**: 기존대로 `wp.altitude * FEET_TO_CM`으로 cm로 변환. 변경 없음.

### 1.4 ElevationProfile.vue 변경

이것이 가장 핵심적인 변경이다.

#### 1.4.1 WP별 지표고도(AMSL) 조회 함수 추가

기존 `terrainSamples` 배열에는 거리별 지표고도가 들어있으나, WP별 지표고도를 직접 조회할 방법이 필요하다.

```js
// WP 위치와 가장 가까운 terrain sample을 찾아 지표고도를 반환 (feet AMSL)
const getGroundElevationAtWaypoint = (wp) => {
    if (terrainSamples.value.length === 0) return 0;

    let closest = terrainSamples.value[0];
    let minDist = Infinity;

    for (const sample of terrainSamples.value) {
        const d = Math.abs(sample.distance - /* wp의 cumulative distance */);
        if (d < minDist) {
            minDist = d;
            closest = sample;
        }
    }

    // 500m 이상 떨어진 샘플은 신뢰도 낮음
    return minDist < 500 ? closest.elevation : 0;
};
```

더 나은 방법: `profilePoints` computed에서 각 WP의 cumulative distance를 이미 계산하므로, 이를 활용:

```js
// WP 인덱스에 해당하는 profilePoint의 distance를 사용해 terrainSamples에서 근접값 검색
const getGroundElevAtPoint = (distance) => {
    if (terrainSamples.value.length === 0) return 0;

    // binary search 또는 linear scan으로 가장 가까운 sample 찾기
    let closest = terrainSamples.value[0];
    let minDist = Infinity;
    for (const sample of terrainSamples.value) {
        const d = Math.abs(sample.distance - distance);
        if (d < minDist) {
            minDist = d;
            closest = sample;
        }
    }
    return minDist < 500 ? closest.elevation : 0;
};
```

#### 1.4.2 WP1 기준 지표고도 computed 추가

```js
// WP1(첫 번째 위치 웨이포인트)의 지표고도 (feet AMSL)
const wp1GroundElevation = computed(() => {
    if (profilePoints.value.length === 0) return 0;
    const firstPoint = profilePoints.value[0];
    return getGroundElevAtPoint(firstPoint.distance);
});
```

#### 1.4.3 Y축 스케일 변경: AMSL 기준 유지 (지형 가시성)

**Y축은 계속 AMSL 기준으로 표시**한다. 이렇게 해야 지형과 비행 경로의 관계(지형 회피 여부)를 시각적으로 확인할 수 있다.

각 WP의 **AMSL 표시 고도** = `wp.altitude(AGL, feet) + wp1GroundElevation(feet)`

```js
// profilePoints computed 수정 — AMSL 값을 추가
const profilePoints = computed(() => {
    if (waypoints.value.length === 0) return [];

    const wp1Ground = wp1GroundElevation.value; // 첫 번째 WP의 지표고도

    let cumulativeDistance = 0;
    const points = waypoints.value.map((wp, index) => {
        if (index > 0) {
            const prevWp = waypoints.value[index - 1];
            cumulativeDistance += calculateDistance(prevWp.latitude, prevWp.longitude, wp.latitude, wp.longitude);
        }

        // AMSL = AGL(WP1 기준 상대고도) + WP1 지표고도
        const altitudeAMSL = wp.altitude + wp1Ground;

        return {
            uid: wp.uid,
            order: wp.order,
            altitude: wp.altitude,          // storage: AGL (feet)
            altitudeAMSL,                   // AMSL 표시용 (feet)
            speed: wp.speed || 0,
            distance: cumulativeDistance,
            latitude: wp.latitude,
            longitude: wp.longitude,
        };
    });

    return points;
});
```

#### 1.4.4 scaledProfilePoints 수정 — AMSL 기준으로 Y 스케일링

```js
const scaledProfilePoints = computed(() => {
    return profilePoints.value.map((point) => ({
        ...point,
        x: scaleX(point.distance),
        y: scaleY(point.altitudeAMSL),  // AMSL 기준으로 Y 위치 계산
    }));
});
```

#### 1.4.5 linePath / areaPath 수정

`scaledProfilePoints`가 이미 AMSL 기준 Y 좌표를 가지고 있으므로 `linePath`와 `areaPath`는 **변경 없음**. 자동으로 AMSL 기준으로 렌더링됨.

#### 1.4.6 Stats Bar 변경

기존 stats는 AMSL 기준이었으나, 이제 **AGL(상대고도) 기준**으로 표시:

```html
<span class="stat">
    <strong>{{ $t("flightPlanMinAlt") }}:</strong> {{ formatAltitude(minAltitude) }}
</span>
<span class="stat">
    <strong>{{ $t("flightPlanMaxAlt") }}:</strong> {{ formatAltitude(maxAltitude) }}
</span>
```

`minAltitude` / `maxAltitude` computed는 `wp.altitude` (AGL)를 사용하므로 **변경 없음**. 자동으로 AGL 기준 최소/최대 고도가 표시됨.

#### 1.4.7 Tooltip 변경

```html
<Teleport to="body">
    <div v-if="tooltipData.visible" class="global-wp-tooltip"
         :style="{ left: tooltipData.x + 'px', top: tooltipData.y + 'px' }">
        <div>WP{{ tooltipData.order }}</div>
        <div><span v-html="$t('flightPlanRelativeAlt')"></span>: {{ formatAltitude(tooltipData.relativeAlt) }}</div>
        <div><span v-html="$t('flightPlanSpeed')"></span>: {{ formatSpeedMps(tooltipData.speed) }}</div>
    </div>
</Teleport>
```

- `flightPlanAlt` → `flightPlanRelativeAlt` (상대고도)
- `formatSpeed` → `formatSpeedMps` (문제 3에서 m/s로 변경)

`tooltipData` 업데이트 로직도 수정:

```js
tooltipData.value = {
    visible: true,
    x: posX,
    y: posY,
    order: (wpData.order ?? 0) + 1,
    relativeAlt: wpData.altitude ?? 0,   // AGL 값 (feet)
    speed: wpData.speed ?? 0,
};
```

#### 1.4.8 WaypointList.vue 표시 변경

기존:
```html
{{ settings.formatAltitude(waypoint.altitude) }} AMSL
```

변경:
```html
{{ settings.formatAltitude(waypoint.altitude) }}
```

"AMSL" 표기를 제거. 이제 `waypoint.altitude`는 AGL(상대고도)이므로.

#### 1.4.9 WaypointEditor.vue 라벨 변경

i18n 키 `flightPlanAltitude`의 메시지를 변경:

**ko/messages.json:**
```json
"flightPlanAltitude": {
    "message": "상대고도 <span class=\"units\">ft AGL</span>"
}
```

**en/messages.json:**
```json
"flightPlanAltitude": {
    "message": "Relative Alt <span class=\"units\">ft AGL</span>"
}
```

#### 1.4.10 주의사항

WP1을 생성할 때 홈포인트(이륙 지점) 근처에 생성해야 WP1의 지표고도가 실제 홈포인트 지표고도와 근사하게 됨. 이는 사용자의 책임이며, UI에 안내 문구를 추가하면 좋음:

```json
"flightPlanWp1Warning": {
    "message": "WP1은 이륙 지점(홈포인트) 근처에 생성하세요. 고도는 WP1 지표고도를 기준으로 계산됩니다."
}
```

---

## 2. 문제 2: 표고 프로필 포인트 상하 드래그로 고도 조절

### 2.1 요구사항

- WP 마커를 **클릭 후 상하로 드래그**하여 고도(AGL)를 직접 조절
- **하한**: 해당 WP 위치의 지표고도 - WP1 지표고도 (즉, 지면과 동일한 높이 = AGL 0이 아니라, 해당 WP의 지표고도와 WP1 지표고도의 차이만큼이 최소)
  - 예: WP1 지표고도 100m, WP2 지표고도 200m → WP2의 최소 AGL = 200 - 100 = 100m. 즉, WP2가 지면과 같은 높이가 되려면 AGL이 +100m가 필요.
- **상한**: 전체 경로의 최대 지표고도 - WP1 지표고도 + 300m (미터를 feet로 변환)
  - 300m = 300 / 0.3048 ≈ 984 feet
- 드래그 중 최소/최대 도달 시 **더 이상 움직이지 않음** (clamping)

### 2.2 구현 지침 (`ElevationProfile.vue`)

#### 2.2.1 드래그 상태 ref 추가

```js
// 상하 드래그 상태
const isDraggingAltitude = ref(false);
const draggingUid = ref(null);
const dragStartY = ref(0);
const dragStartAltitude = ref(0); // 드래그 시작 시의 AGL 고도 (feet)
```

#### 2.2.2 최소/최대 고도 computed 추가

```js
const METERS_TO_FEET = 3.28084;

// 전체 경로 최대 지표고도 (feet AMSL) — 기존 maxGroundElevation 활용
// WP별 최소 허용 AGL (feet)
const minAllowedAGL = computed(() => {
    const wp1Ground = wp1GroundElevation.value;
    const minMap = new Map(); // uid → minAGL (feet)

    for (const point of profilePoints.value) {
        const wpGroundElev = getGroundElevAtPoint(point.distance);
        // 해당 WP의 지표고도 - WP1 지표고도 = 최소 AGL
        const minAGL = Math.max(0, wpGroundElev - wp1Ground);
        minMap.set(point.uid, minAGL);
    }

    return minMap;
});

// 전체 최대 허용 AGL (feet)
const maxAllowedAGL = computed(() => {
    const wp1Ground = wp1GroundElevation.value;
    const maxGround = maxGroundElevation.value;
    const buffer = 300 * METERS_TO_FEET; // 300m in feet
    return Math.max(0, (maxGround - wp1Ground) + buffer);
});
```

#### 2.2.3 WP 마커에 pointer event 바인딩

기존 `<circle>`를 다음과 같이 변경:

```html
<circle
    v-for="(point, index) in scaledProfilePoints"
    :key="`marker-${index}`"
    :cx="point.x"
    :cy="point.y"
    :r="10"
    :fill="getMarkerColor(point)"
    :stroke="point.uid === selectedWaypointUid ? '#FFF' : 'var(--surface-50)'"
    :stroke-width="point.uid === selectedWaypointUid ? 3 : 1.5"
    class="waypoint-marker"
    :class="{ selected: point.uid === selectedWaypointUid }"
    @pointerdown.prevent="handleAltDragStart($event, point)"
/>
```

#### 2.2.4 드래그 핸들러

```js
const handleAltDragStart = (event, point) => {
    isDraggingAltitude.value = true;
    draggingUid.value = point.uid;
    dragStartY.value = event.clientY;
    dragStartAltitude.value = point.altitude; // AGL (feet)

    // pointer capture로 마우스 이탈 방지
    event.target.setPointerCapture(event.pointerId);
};

const handleAltDragMove = (event) => {
    if (!isDraggingAltitude.value || !draggingUid.value) return;

    const deltaY = dragStartY.value - event.clientY; // 위로 드래그 = 양수
    const plotHeight = chartHeight - padding.top - padding.bottom;
    const paddedMax = combinedMax.value + (combinedMax.value - 0) * 0.1;
    const paddedRange = paddedMax - 0;

    // deltaY 픽셀 → 고도 feet 변환
    const altDelta = (deltaY / plotHeight) * paddedRange;

    // 최소/최대 clamping
    const minAGL = minAllowedAGL.value.get(draggingUid.value) ?? 0;
    const maxAGL = maxAllowedAGL.value;

    const newAltitude = Math.max(minAGL, Math.min(maxAGL, dragStartAltitude.value + altDelta));

    // waypoint 업데이트 (storage에 AGL feet 저장)
    updateWaypoint(draggingUid.value, { altitude: Math.round(newAltitude) });
};

const handleAltDragEnd = () => {
    isDraggingAltitude.value = false;
    draggingUid.value = null;
};
```

SVG에 글로벌 이벤트 바인딩:

```html
<svg ... @pointermove="handleAltDragMove" @pointerup="handleAltDragEnd" @pointerleave="handleAltDragEnd">
```

#### 2.2.5 드래그 중 시각적 피드백

드래그 중인 마커는 **붉은색**으로 표시 (문제 4의 색상 규칙과 일치):

```js
const getMarkerColor = (point) => {
    if (isDraggingAltitude.value && point.uid === draggingUid.value) return '#FF0000';
    if (isDraggingSpeed.value && point.uid === draggingUid.value) return '#FF0000';
    if (point.uid === selectedWaypointUid.value) return '#00CC00'; // 활성: 녹색
    return '#FFD700'; // 비활성: 노란색
};
```

---

## 3. 문제 3: 좌우 드래그로 속도 조절 및 m/s 표시

### 3.1 요구사항

- WP 마커를 **좌우로 드래그**하여 속도 조절
- 속도 범위: **5 m/s ~ 25 m/s** (순항값 15 m/s 기준)
- **속도 단위를 km/h → m/s로 변경**
- 드래그 감도: **0.5초당 1 m/s** 변화 (너무 예민하지 않게)
- 상하 드래그와 구분: **명확한 수평 드래그 의도**가 있어야 시작

### 3.2 속도 단위 시스템 변경

#### 3.2.1 `settings.js`에 m/s 포맷 함수 추가

기존 `formatSpeed(kt)`는 kt 또는 km/h를 반환. m/s 포맷 함수를 추가:

```js
/**
 * Format speed from storage (knots) to m/s display string.
 * @param {number} kt - speed in knots (storage unit)
 * @returns {string} e.g. "5.1m/s"
 */
function formatSpeedMps(kt) {
    // 1 knot = 0.514444 m/s
    const mps = kt * 0.514444;
    return `${mps.toFixed(1)}m/s`;
}
```

export에 `formatSpeedMps` 추가.

#### 3.2.2 m/s ↔ storage(knots) 변환 함수 추가

```js
/**
 * Convert m/s display value to storage (knots).
 * @param {number} mps - speed in m/s
 * @returns {number} value in knots
 */
function mpsToStorage(mps) {
    return mps / 0.514444;
}

/**
 * Convert storage (knots) to m/s display value.
 * @param {number} kt - speed in knots
 * @returns {number} speed in m/s
 */
function storageToMps(kt) {
    return kt * 0.514444;
}
```

export에 `mpsToStorage`, `storageToMps` 추가.

#### 3.2.3 속도 범위 상수

```js
const SPEED_MIN_MS = 5;   // m/s
const SPEED_MAX_MS = 25;  // m/s
const SPEED_DEFAULT_MS = 15; // m/s (순항값)

// storage (knots) 기준
const SPEED_MIN_KT = mpsToStorage(SPEED_MIN_MS);   // ≈ 9.72 kt
const SPEED_MAX_KT = mpsToStorage(SPEED_MAX_MS);   // ≈ 48.6 kt
```

### 3.3 "속도 노트" → "속도" 수정 (i18n)

**ko/messages.json:**
```json
"flightPlanSpeed": {
    "message": "속도 <span class=\"units\">m/s</span>"
}
```

**en/messages.json:**
```json
"flightPlanSpeed": {
    "message": "Speed <span class=\"units\">m/s</span>"
}
```

### 3.4 ElevationProfile.vue 좌우 드래그 구현

#### 3.4.1 드래그 상태 ref 추가

```js
const isDraggingSpeed = ref(false);
const speedDraggingUid = ref(null);
const speedDragStartTime = ref(0);
const speedDragStartX = ref(0);
const speedDragStartSpeed = ref(0); // storage knots
let speedDragDirectionDecided = false;
let speedDragAccumX = 0;
let speedDragLastTickTime = 0;
```

#### 3.4.2 방향 판별 로직

상하 드래그와 좌우 드래그를 구분하기 위해, 처음 10px 이동 방향으로 판별:

```js
const DRAG_DIRECTION_THRESHOLD = 10; // 10px 이동 후 방향 결정

const handlePointerDown = (event, point) => {
    dragStartY.value = event.clientY;
    dragStartX.value = event.clientX;
    dragStartAltitude.value = point.altitude;
    speedDragStartSpeed.value = point.speed;
    speedDragStartTime.value = Date.now();
    speedDragDirectionDecided = false;
    speedDragAccumX = 0;
    speedDragLastTickTime = 0;

    draggingUid.value = point.uid;

    event.target.setPointerCapture(event.pointerId);
};
```

`@pointermove` 핸들러에서 방향 판별 후 분기:

```js
const handlePointerMove = (event) => {
    if (!draggingUid.value) return;

    const dx = event.clientX - dragStartX.value;
    const dy = dragStartY.value - event.clientY; // 위 = 양수

    if (!speedDragDirectionDecided) {
        // 방향 결정: |dx| > |dy| 이면 수평 드래그로 판정
        if (Math.abs(dx) > DRAG_DIRECTION_THRESHOLD || Math.abs(dy) > DRAG_DIRECTION_THRESHOLD) {
            speedDragDirectionDecided = true;
            if (Math.abs(dx) > Math.abs(dy)) {
                isDraggingSpeed.value = true;
            } else {
                isDraggingAltitude.value = true;
            }
        }
        return; // 방향 미결정 시 대기
    }

    if (isDraggingSpeed.value) {
        handleSpeedDragMove(event);
    } else if (isDraggingAltitude.value) {
        handleAltDragMove(event);
    }
};
```

#### 3.4.3 속도 드래그 핸들러

```js
const SPEED_TICK_INTERVAL_MS = 500; // 0.5초당 1 m/s
const SPEED_TICK_PX_THRESHOLD = 3;  // 3px 이동 시 1 tick

const handleSpeedDragMove = (event) => {
    const dx = event.clientX - dragStartX.value;
    const now = Date.now();

    // 0.5초 간격으로만 값 변화 (예민도 감소)
    if (now - speedDragLastTickTime < SPEED_TICK_INTERVAL_MS) {
        // 시간 간격 미달이어도 방향 전환은 감지
        speedDragAccumX = dx;
        return;
    }

    const prevAccumX = speedDragAccumX;
    speedDragAccumX = dx;

    const tickDelta = Math.round((speedDragAccumX - prevAccumX) / SPEED_TICK_PX_THRESHOLD);
    if (tickDelta === 0) return;

    speedDragLastTickTime = now;

    // m/s 단위로 계산
    const currentMps = storageToMps(speedDragStartSpeed.value);
    let newMps = currentMps + tickDelta;

    // clamping
    newMps = Math.max(SPEED_MIN_MS, Math.min(SPEED_MAX_MS, newMps));

    // storage (knots)로 변환하여 업데이트
    const newKnots = mpsToStorage(newMps);
    updateWaypoint(speedDraggingUid.value, { speed: Math.round(newKnots * 10) / 10 });
};
```

> **구현 팁**: 상기 로직은 0.5초당 최대 ±1 m/s 변화를 보장. 사용자가 천천히 드래그하면 변화가 적고, 빠르면 tickDelta가 커져도 시간 간격 제한으로 0.5초당 최대 ±1로 억제됨.

#### 3.4.4 WaypointEditor.vue 속도 입력 변경

속도 입력 필드의 범위와 단위를 m/s로 변경:

```html
<SettingRow v-if="showSpeed" :label="speedLabel" full-width>
    <UInputNumber
        v-model="form.speed"
        :step="0.5"
        :min="SPEED_MIN_MS"
        :max="SPEED_MAX_MS"
        required
        :aria-label="$t('flightPlanSpeed')"
        class="w-48"
    />
</SettingRow>
```

`form.speed`은 **m/s display 단위**로 값을 가짐. 저장 시 `settings.mpsToStorage(form.speed)`로 변환.

`WaypointEditor.vue`의 `watch(editingWaypoint)`에서:

```js
// storage(knots) → display(m/s) 변환
form.speed = settings.storageToMps(waypoint.speed);
```

`buildPayload()`에서:

```js
speed: settings.mpsToStorage(form.speed),
```

기본값 변경:
```js
form.speed = SPEED_DEFAULT_MS; // 15 m/s
```

#### 3.4.5 WaypointList.vue 속도 표시 변경

기존:
```html
{{ settings.formatSpeed(waypoint.speed) }}
```

변경:
```html
{{ settings.formatSpeedMps(waypoint.speed) }}
```

---

## 4. 문제 4: 포인트 크기, 색상, 표기 변경

### 4.1 포인트 크기

기존: `r="3"` (비활성), `r="4"` (활성/선택)
변경: **r="10"** (활성/비활성 동일)

SVG `<circle>`:
```html
<circle
    v-for="(point, index) in scaledProfilePoints"
    :key="`marker-${index}`"
    :cx="point.x"
    :cy="point.y"
    :r="10"
    :fill="getMarkerColor(point)"
    :stroke="getMarkerStroke(point)"
    :stroke-width="getMarkerStrokeWidth(point)"
    class="waypoint-marker"
    @pointerdown.prevent="handlePointerDown($event, point)"
    @pointermove.stop
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerUp"
/>
```

### 4.2 포인트 색상 규칙

| 상태 | 색상 | CSS 변수 / HEX |
|------|------|---------------|
| 비활성 (기본) | **노란색** | `#FFD700` |
| 활성 (선택됨) | **녹색** | `#00CC00` |
| 터치/드래그 중 | **붉은색** | `#FF0000` |

```js
const getMarkerColor = (point) => {
    if ((isDraggingAltitude.value || isDraggingSpeed.value) && point.uid === draggingUid.value) {
        return '#FF0000'; // 드래그 중: 붉은색
    }
    if (point.uid === selectedWaypointUid.value) {
        return '#00CC00'; // 선택됨: 녹색
    }
    return '#FFD700'; // 기본: 노란색
};

const getMarkerStroke = (point) => {
    if (point.uid === selectedWaypointUid.value || point.uid === draggingUid.value) {
        return '#FFFFFF';
    }
    return 'rgba(255, 255, 255, 0.6)';
};

const getMarkerStrokeWidth = (point) => {
    if (point.uid === selectedWaypointUid.value || point.uid === draggingUid.value) {
        return 3;
    }
    return 1.5;
};
```

CSS `.waypoint-marker:hover`의 `r: 4` 제거 — 더 이상 hover 확대 없음 (크기 고정 r=10).

### 4.3 표기 변경: "고도" → "상대고도", "속도 노트" → "속도"

#### Tooltip (`ElevationProfile.vue`)

기존:
```html
<div><span v-html="$t('flightPlanAlt')"></span>: {{ formatAltitude(tooltipData.altitude) }}</div>
<div><span v-html="$t('flightPlanSpeed')"></span>: {{ formatSpeed(tooltipData.speed) }}</div>
```

변경:
```html
<div><span v-html="$t('flightPlanRelativeAlt')"></span>: {{ formatAltitude(tooltipData.relativeAlt) }}</div>
<div><span v-html="$t('flightPlanSpeed')"></span>: {{ formatSpeedMps(tooltipData.speed) }}</div>
```

#### i18n 키 추가/수정

**ko/messages.json:**
```json
"flightPlanRelativeAlt": {
    "message": "상대고도"
},
"flightPlanSpeed": {
    "message": "속도 <span class=\"units\">m/s</span>"
},
"flightPlanAltitude": {
    "message": "상대고도 <span class=\"units\">ft AGL</span>"
}
```

**en/messages.json:**
```json
"flightPlanRelativeAlt": {
    "message": "Relative Alt"
},
"flightPlanSpeed": {
    "message": "Speed <span class=\"units\">m/s</span>"
},
"flightPlanAltitude": {
    "message": "Relative Alt <span class=\"units\">ft AGL</span>"
}
```

### 4.4 WP 라벨 위치 조정 (r=10에 맞춤)

기존 라벨은 마커 위 8px에 위치했으나, 마커가 커졌으므로 조정:

```html
<text
    v-for="(point, index) in scaledProfilePoints"
    :key="`label-${index}`"
    :x="point.x"
    :y="point.y - 14"
    class="waypoint-label"
    text-anchor="middle"
>
    WP{{ point.order + 1 }}
</text>
```

라벨 폰트 크기도 약간 키움:
```css
.waypoint-label {
    font-size: 9px; /* 기존 7px → 9px */
}
```

---

## 5. 문제 4 (CLI): Flight Plan 탭 Update 버튼 수정

### 5.1 현재 상태

`FlightPlanTab.vue`의 하단 툴바:
- **Clear** 버튼 → `clearPlan()` + `clearOnFC()`
- **Load** 버튼 → `loadFromFC()`
- **Save** 버튼 (표시: "저장") → `saveToFC()`

`saveToFC()`의 현재 로직:
```js
const saveToFC = async () => {
    await sendCliCommand("waypoint clear");
    for (let i = 0; i < sorted.length; i++) {
        await sendCliCommand(waypointToCliCommand(sorted[i], i));
    }
    await sendCliCommand("save");
};
```

### 5.2 문제

"Update" (저장) 버튼이 작동하지 않는다. 원인을 파악하고 수정.

### 5.3 CLI 명령어 형식 (펌웨어 사양)

```
waypoint insert <인덱스> <위도> <경도> <고도_cm> <속도_cm/s> <타입> <지속시간_ds> <패턴>
waypoint update <인덱스> <위도> <경도> <고도_cm> <속도_cm/s> <타입> <지속시간_ds> <패턴>
waypoint remove <인덱스>
waypoint clear
waypoint status
waypoint list
```

### 5.4 수정 방안

`saveToFC`를 **clear → insert 전체 교체 방식**에서 **기존 WP 개수를 확인하고 update/insert를 혼합 사용**하는 방식으로 변경:

```js
const saveToFC = async () => {
    try {
        const sorted = [...state.waypoints].sort((a, b) => a.order - b.order);

        // 1. FC의 현재 WP 개수 확인
        let fcCount = 0;
        try {
            const statusResponse = await sendCliCommand("waypoint status");
            // 응답에서 WP 개수 파싱 (형식: "Waypoint count: N" 또는 유사)
            const countLine = statusResponse.find(line => line.includes('count') || line.includes('Count'));
            if (countLine) {
                const match = countLine.match(/(\d+)/);
                if (match) fcCount = parseInt(match[1], 10);
            }
        } catch {
            // status 명령어를 지원하지 않는 경우, list로 대체
            try {
                const listResponse = await sendCliCommand("waypoint list");
                fcCount = listResponse.filter(line => line.trim().startsWith('waypoint insert')).length;
            } catch {
                fcCount = 0;
            }
        }

        // 2. 초과 WP는 remove, 기존 범위 내는 update, 신규는 insert
        if (sorted.length < fcCount) {
            // FC에 더 많은 WP가 있으면 초과분 삭제 (역순으로)
            for (let i = fcCount - 1; i >= sorted.length; i--) {
                await sendCliCommand(`waypoint remove ${i}`);
            }
        }

        // 3. 각 WP를 update 또는 insert
        for (let i = 0; i < sorted.length; i++) {
            const cmd = i < fcCount
                ? `waypoint update ${i} ${buildCliArgs(sorted[i])}`
                : `waypoint insert ${i} ${buildCliArgs(sorted[i])}`;
            await sendCliCommand(cmd);
        }

        // 4. EEPROM에 저장
        await sendCliCommand("save");

        gui_log(i18n.getMessage("flightPlanSavedToFC"));
        savePlan();
    } catch (error) {
        console.error("Failed to save flight plan to FC:", error);
        gui_log(i18n.getMessage("flightPlanFCSaveError"));
    }
};
```

#### 5.4.1 CLI 인자 빌더 함수 분리

기존 `waypointToCliCommand`를 리팩토링하여 인자 부분만 분리:

```js
// WP 데이터를 CLI 인자 문자열로 변환 (명령어 이름 제외)
const buildCliArgs = (wp) => {
    const lat = wp.latitude.toFixed(7);
    const lon = wp.longitude.toFixed(7);
    const altCm = Math.round(wp.altitude * FEET_TO_CM);
    const speedRaw = wp.type === "yaw_rate"
        ? Math.round(wp.speed)
        : Math.round(wp.speed * KNOTS_TO_CMS);
    const typeCli = TYPE_TO_CLI[wp.type] ?? "FLYOVER";
    const durationDs = Math.round(wp.duration * MINUTES_TO_DECISECONDS);
    const patternCli = PATTERN_TO_CLI[wp.pattern] ?? "ORBIT";

    return `${lat} ${lon} ${altCm} ${speedRaw} ${typeCli} ${durationDs} ${patternCli}`;
};

// 기존 함수도 buildCliArgs 사용하도록 수정
const waypointToCliCommand = (wp, index) => {
    return `waypoint insert ${index} ${buildCliArgs(wp)}`;
};
```

---

## 6. 작업 순서 요약

| 단계 | 파일 | 작업 내용 |
|------|------|----------|
| 1 | `src/stores/settings.js` | `formatSpeedMps`, `mpsToStorage`, `storageToMps` 함수 추가 |
| 2 | `src/composables/useFlightPlan.js` | `DEFAULT_ALTITUDE = 100` 변경, `buildCliArgs` 분리, `saveToFC` update/insert 혼합 방식으로 수정 |
| 3 | `locales/ko/messages.json` | `flightPlanRelativeAlt` 추가, `flightPlanSpeed`/`flightPlanAltitude` 메시지 수정 |
| 4 | `locales/en/messages.json` | 동일 |
| 5 | `src/components/tabs/FlightPlan/ElevationProfile.vue` | **핵심 수정** — AGL 시스템, 상하/좌우 드래그, 마커 크기/색상, tooltip |
| 6 | `src/components/tabs/FlightPlan/WaypointList.vue` | AMSL 제거, 속도 m/s 표시 |
| 7 | `src/components/tabs/FlightPlan/WaypointEditor.vue` | 속도 m/s 입력, 범위 5~25 m/s, 기본값 15 m/s |

### 단계 5 (ElevationProfile.vue) 상세 체크리스트

- [ ] `wp1GroundElevation` computed 추가
- [ ] `getGroundElevAtPoint(distance)` 헬퍼 함수 추가
- [ ] `profilePoints`에 `altitudeAMSL` 필드 추가
- [ ] `scaledProfilePoints`가 `altitudeAMSL`으로 Y 스케일링
- [ ] `minAllowedAGL` computed (WP별)
- [ ] `maxAllowedAGL` computed
- [ ] WP 마커 `r=10`, `pointerdown` 이벤트 바인딩
- [ ] `getMarkerColor` / `getMarkerStroke` / `getMarkerStrokeWidth` 함수
- [ ] 상하 드래그: `handlePointerDown` → 방향 판별 → `handleAltDragMove`
- [ ] 좌우 드래그: `handleSpeedDragMove` (0.5초당 1 m/s)
- [ ] Tooltip: `flightPlanRelativeAlt` + `formatSpeedMps`
- [ ] WP 라벨 위치 조정 (y - 14)
- [ ] pointer capture / release 관리
- [ ] CSS: hover 확대 제거, `.waypoint-marker` transition 유지

---

## 7. 검증 항목

1. **고지대 시나리오**: WP1을 해발 1000m 산 정상에 생성 → AGL 0이 아닌 지표고도 기준으로 정상 표시
2. **지형 충돌 방지**: WP2 지표고도가 WP1보다 200m 높을 때, AGL을 100으로 설정하면 지면과 100m 간격 유지 (실제 AMSL은 WP1+100)
3. **드래그 클램핑**: 상한/하한 도달 시 마커가 더 이상 움직이지 않는지 확인
4. **속도 범위**: 5 m/s ~ 25 m/s 범위 내에서만 변경되는지 확인
5. **모바일 터치**: 안드로이드에서 마커 터치 후 상하/좌우 드래그가 정상 동작하는지 확인
6. **CLI save**: FC에 연결 후 Save 버튼으로 `waypoint update` / `waypoint insert`가 정상 전송되는지 확인
7. **단위 전환**: 단위 토글(nm/ft/kt ↔ km/m/kmh) 시 표시만 변경되고 storage 값은 유지되는지 확인. 단, **속도는 항상 m/s 표시** (단위 토글과 무관)

---

## 8. 주의사항

- **Storage 단위 변경 금지**: altitude는 항상 feet, speed는 항상 knots로 저장. m/s는 순수 표시/입력 레이어에서만 사용.
- **기존 데이터 호환성**: localStorage에 이미 AMSL 기준으로 저장된 기존 비행 계획이 있을 수 있음. 이전 데이터는 WP1 지표고도를 알 수 없으므로, 기존 데이터를 로드할 때 지표고도를 0으로 가정하거나, 마이그레이션 로직을 추가할 것.
- **방향 판별 임계값**: `DRAG_DIRECTION_THRESHOLD = 10`은 실험적으로 조정 필요. 모바일 터치에서 너무 크면 반응이 둔해지고, 너무 작으면 상하/좌우 구분이 안 됨.
- **pointer capture**: `setPointerCapture`를 사용하여 드래그 중 마우스/터치가 마커를 벗어나도 이벤트를 수신하도록 할 것. `FlightPlanMap.vue`는 이를 사용하지 않으나, ElevationProfile의 작은 마커에서는 필수.