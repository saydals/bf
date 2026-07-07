# FlightPlan 표고 프로필 개선 작업 지시서 v3

> **작성일**: 2026-07-08
> **대상 저장소**: `saydals/bf` (Betaflight Configurator 포크)
> **근거 문서**: `요구사항.txt` 기반, `plan1.md` + `plan2.md` 장점 결합
> **기반 코드**: 2026-07-08 커밋 `84dfe394` (AGL 시스템 1차 구현 완료 상태)
> **수정 범위**: `ElevationProfile.vue`, `useFlightPlan.js`, `WaypointEditor.vue`, `locales/`

---

## 0. 현재 상태 (기구현 사항)

아래 내용은 `plan.md`에 따라 **이미 구현 완료**된 상태입니다. 이 문서의 나머지 문제들은 이 기반 위에서 추가 개선합니다.

### 0.1 AGL 시스템

| 항목 | 상태 |
|------|:----:|
| `wp.altitude` = WP1 지표고도 기준 상대고도(AGL) | ✅ |
| `DEFAULT_ALTITUDE = 100` feet AGL | ✅ |
| `profilePoints`에 `altitudeAMSL` 필드 (Y축 스케일링용) | ✅ |
| `wp1GroundElevation` computed | ✅ |
| `getGroundElevAtPoint(distance)` 헬퍼 함수 | ✅ |
| `minAllowedAGL` computed (WP별) | ✅ |
| `maxAllowedAGL = 10000` feet | ✅ |
| `combinedMax` - `altitudeAMSL` 기준으로 계산 | ✅ |
| `scaledProfilePoints` - `scaleY(point.altitudeAMSL)` | ✅ |

### 0.2 저장/CLI

| 항목 | 상태 |
|------|:----:|
| `buildCliArgs(wp)` 분리 | ✅ |
| `saveToFC` update/insert 혼합 방식 | ✅ |
| `DEFAULT_ALTITUDE = 100` | ✅ |

### 0.3 UI

| 항목 | 상태 |
|------|:----:|
| 마커 r=10, pointerdown 이벤트 | ✅ |
| `getMarkerColor`/`getMarkerStroke`/`getMarkerStrokeWidth` | ✅ |
| 상하 드래그: `handleAltDragMove` (1ft per 2px) | ✅ |
| 좌우 드래그: `handleSpeedDragMove` (10px당 1m/s, 500ms 쓰로틀) | ✅ |
| `setPointerCapture` / `releasePointerCapture` | ✅ |
| WP 라벨 위치 y-14 | ✅ |
| CSS hover 확대 제거 | ✅ |
| 속도 m/s 표시 (WaypointList, WaypointEditor) | ✅ |
| AMSL → AGL 레이블 변경 | ✅ |
| `formatSpeedMps`, `mpsToStorage`, `storageToMps` 함수 (settings.js) | ✅ |

### 0.4 i18n

| 키 | 한글 | 영어 | 상태 |
|----|------|------|:----:|
| `flightPlanRelativeAlt` | AGL | AGL | ✅ |
| `flightPlanSpeedMps` | 속도 (m/s) | Speed (m/s) | ✅ |
| `flightPlanAltitude` | ft AGL | ft AGL | ✅ |
| `flightPlanSpeed` | m/s | m/s | ✅ |

---

## 1. 사용자 논리 검증 및 확인 필요 사항

### 1.1 문제 4 해석: "시간 기반" vs "거리 기반" 속도 변경

> **사용자 요구**: "속도의 변화는 포인트가 움직인 양이 아니고 중심에서 벗어나 좌우로 벗어나 있는 **시간**에 따라 변화한다"

**현재 코드** (기구현, `handleSpeedDragMove`):
```javascript
// ElevationProfile.vue L753-755 (현재)
const deltaX = event.clientX - dragState.value.startX;  // ← 거리(distance) 기반
const speedDeltaMps = Math.round(deltaX / 10);            // ← 10px당 1m/s
```

현재 코드는 **거리 기반**입니다. 마우스를 멈추면 `deltaX`가 0이 되어 속도 변화도 멈춥니다. 사용자가 원하는 **시간 기반** 동작(한쪽 방향으로 유지하면 시간에 비례해 속도가 계속 변함)과 다릅니다.

> **본 문서의 해석**: 사용자의 설명을 **(A) 시간 기반**으로 해석하여 작성합니다. 즉, 마우스를 좌/우 어느 한 방향으로 유지하면 정해진 시간 간격마다 속도가 ±1 m/s씩 계속 변화합니다. 변화량(1 m/s)과 간격(500ms)은 기존 코드대로 유지하되, `deltaX` 대신 방향(direction)에 기반한 시간 누적 방식으로 변경합니다.

해석이 틀렸다면 사용자에게 알려주세요.

### 1.2 Y축 "해발고도" 라벨 표시 방식

> **사용자 요구**: "제일 왼쪽에 표시되는 고도는 해발고도로 여겨지는데 수정하지 않는것이 좋다. 다만 해발고도라고 표시"

구현 방식 옵션:
- **(A)** Y축 최상단 라벨 옆에 "(AMSL)" 텍스트 추가 — 본 문서는 이 방식으로 기술
- **(B)** Y축 타이틀을 별도로 추가 (그래프 좌측 세로 방향)
- **(C)** 통계 영역에 "Y축: 해발고도(AMSL)" 안내 문구 추가

선호하는 방식을 알려주세요.

---

## 2. 문제 1: WP 드래그 반응성 개선

### 2.1 현상 분석

#### 2.1.1 고도 드래그 (수직) — 느리게 따라오는 현상

**원인 1: `savePlan()` 동기 I/O 블로킹** (plan1.md L52-53)

`useFlightPlan.js`의 `updateWaypoint()` 함수 (L219)는 매 호출마다 `savePlan()` → `localStorage.setItem()`을 실행합니다. 드래그 이벤트는 고빈도(60fps 이상)로 발생하므로, 매 프레임마다 동기 I/O가 발생해 Vue 반응형 갱신이 블로킹됩니다.

```javascript
// useFlightPlan.js L218-219 (현재)
Object.assign(waypoint, updates);
savePlan();  // ← 매 드래그 이벤트마다 localStorage.setItem() 호출
```

**원인 2: 드래그 감도와 SVG 스케일 불일치** (plan2.md L81-92)

현재 드래그 감도는 고정값 `1ft per 2px (screen pixel)`입니다:
```javascript
// ElevationProfile.vue L732 (현재)
const altitudeDelta = Math.round(deltaY / 2);  // ← 2px 당 1ft 고정
```

하지만 SVG의 Y축 스케일은 고도 범위에 따라 동적으로 변합니다. `scaleY()` 함수는 `combinedMax` 값에 따라 1 SVG단위가 몇 ft에 해당하는지 결정합니다:

| 고도 범위 | 플롯 높이(SVG) | 1 SVG단위 ≈ | CSS 1.5x 시 1화면px ≈ |
|----------|---------------|-------------|----------------------|
| 0~500ft | 95px | 5.8ft | 8.7ft |
| 0~1000ft | 95px | 11.6ft | 17.4ft |
| 0~5000ft | 95px | 57.9ft | 86.8ft |

- 고도 1000ft 범위에서: 1px 이동 = 17.4ft, 하지만 드래그 감도는 1px = 0.5ft
- **결과**: 마우스를 10px 움직여도 고도가 5ft만 변하고, 시각적으로는 약 0.3px밖에 움직이지 않음 → **마커가 거의 따라오지 않는 것처럼 보임**

#### 2.1.2 속도 드래그 (수평) — 마커가 전혀 움직이지 않음

WP 마커의 X 좌표는 누적 거리에 의해 고정되어 있으며, 수평 드래그는 속도 값만 변경합니다. 마커의 시각적 X 위치가 변하지 않아 사용자 피드백이 전혀 없습니다.

### 2.2 수정 사항

#### 2.2.1 savePlan debounce 처리 (plan1.md 제안)

**파일**: `src/composables/useFlightPlan.js`

**변경 내용**: 드래그 중 매 프레임마다 localStorage 쓰기를 방지하기 위해 debounce 적용.
`updateWaypoint()` 내에서 `savePlan()`을 즉시 호출하지 않고 300ms debounce 합니다.
`Object.assign(waypoint, updates)`는 즉시 실행되므로 Vue 반응형 갱신은 영향을 받지 않습니다.

```javascript
// useFlightPlan.js — 파일 상단에 타이머 변수 추가
let savePlanTimeout = null;

// useFlightPlan.js — updateWaypoint() 함수 내 (L218-219)
// 변경 전:
Object.assign(waypoint, updates);
savePlan();

// 변경 후:
Object.assign(waypoint, updates);
if (savePlanTimeout) clearTimeout(savePlanTimeout);
savePlanTimeout = setTimeout(() => {
    savePlan();
    savePlanTimeout = null;
}, 300);
```

**효과**: 드래그 중에는 300ms 내에 다시 호출되면 이전 타이머가 취소되어, localStorage 쓰기가 마지막 드래그 이벤트 300ms 후에 1번만 실행됩니다. Object.assign은 즉시 실행되므로 Vue 반응형은 즉시 갱신됩니다.

#### 2.2.2 고도 드래그 감도를 차트 스케일에 동기화 (plan2.md 제안)

**파일**: `src/components/tabs/FlightPlan/ElevationProfile.vue`

**위치**: `handleAltDragMove()` 함수 (L730-743)

**변경 내용**: 고도 변화량을 `deltaY / 2` (화면픽셀 고정) 대신 SVG 좌표계 기준으로 계산하여 마커가 마우스를 정확히 따라가도록 합니다.

```javascript
// ElevationProfile.vue — handleAltDragMove()

// 변경 전:
const handleAltDragMove = (event) => {
    const deltaY = dragState.value.startY - event.clientY;
    // ...
    const altitudeDelta = Math.round(deltaY / 2);

// 변경 후:
const handleAltDragMove = (event) => {
    // SVG 요소의 DOMRect를 가져와 화면픽셀 → SVG좌표 변환
    const svgEl = chartSvg.value;
    const svgRect = svgEl.getBoundingClientRect();
    const svgScaleY = (chartHeight - padding.top - padding.bottom) / svgRect.height;
    
    const deltaScreenY = dragState.value.startY - event.clientY;
    const deltaSvgY = deltaScreenY * svgScaleY;
    
    // SVG Y 좌표 변화량을 고도 변화량으로 변환 (scaleY 역변환)
    const currentWp = waypoints.value.find(wp => wp.uid === dragState.value.wpUid);
    if (!currentWp) return;
    
    const currentSvgY = scaleY(currentWp.altitude + wp1GroundElevation.value);
    const targetSvgY = currentSvgY - deltaSvgY;
    
    // 역 scaleY 계산으로 목표 AMSL 고도 구하기
    const min = 0;
    const max = combinedMax.value;
    const range = max - min || 100;
    const paddedMax = max + range * 0.1;
    const paddedRange = paddedMax - min;
    const plotHeight = chartHeight - padding.top - padding.bottom;
    const targetAMSL = paddedMax - ((targetSvgY - padding.top) / plotHeight) * paddedRange;
    
    // AMSL → AGL 변환
    const newAlt = Math.round(targetAMSL - wp1GroundElevation.value);
    
    // clamp
    const minAlt = minAllowedAGL.value[dragState.value.wpUid] ?? 0;
    const clampedAlt = Math.max(minAlt, Math.min(maxAllowedAGL, newAlt));
    
    if (clampedAlt !== currentWp.altitude) {
        updateWaypoint(dragState.value.wpUid, { altitude: clampedAlt });
        dragState.value.startY = event.clientY;
    }
};
```

**효과**: 차트의 Y축 스케일과 드래그 변화량이 일치하여, 마우스를 10px 움직이면 마커도 시각적으로 정확히 10px 따라갑니다.

**주의**: `combinedMax`가 0인 경우(웨이포인트 1개, 지형 데이터 없음) division by zero 방지를 위해 `altRange`에 최소값(예: 100ft)을 보장해야 합니다:
```javascript
const combinedMax = computed(() => {
    const maxAmsl = profilePoints.value.length > 0
        ? Math.max(...profilePoints.value.map(p => p.altitudeAMSL))
        : 0;
    return Math.max(maxAmsl, maxGroundElevation.value, 100); // ← 최소 100ft 보장
});
```

#### 2.2.3 좌우 드래그 시 마커 시각 오프셋 (plan1.md + plan2.md)

**파일**: `src/components/tabs/FlightPlan/ElevationProfile.vue`

**변경 내용**: 속도 드래그 시 마커의 X 좌표에 작은 오프셋을 추가하여 속도 조절 중임을 시각적으로 표시합니다.

**2.2.3a**: `dragState`에 `speedVisualOffsetX` 필드 추가

```javascript
// ElevationProfile.vue — dragState 정의 (L337-346 근처)
const dragState = ref({
    active: false,
    type: null,
    wpUid: null,
    startX: 0,
    startY: 0,
    lastValue: 0,
    lastMoveTime: 0,
    speedVisualOffsetX: 0,  // ★ 추가
});
```

**2.2.3b**: `handlePointerMove()`에서 시각적 오프셋 계산 (쓰로틀과 무관하게 즉시 반영)

```javascript
// ElevationProfile.vue — handlePointerMove() 내
// 속도 드래그 타입 판별 후, 쓰로틀 검사 전에:

if (dragState.value.type === 'speed') {
    const visualDeltaX = event.clientX - dragState.value.startX;
    // 실제 드래그량의 50%, 최대 15px로 제한 (살짝만 움직이게)
    dragState.value.speedVisualOffsetX = Math.sign(visualDeltaX) * Math.min(Math.abs(visualDeltaX) * 0.5, 15);
}
```

**2.2.3c**: `scaledProfilePoints`에서 오프셋 적용

```javascript
// ElevationProfile.vue — scaledProfilePoints computed (L504-510 근처)
const scaledProfilePoints = computed(() => {
    return profilePoints.value.map((point) => {
        const baseX = scaleX(point.distance);
        // 현재 드래그 중인 WP에만 오프셋 적용
        const offsetX = (dragState.value.active && dragState.value.type === 'speed' && dragState.value.wpUid === point.uid)
            ? dragState.value.speedVisualOffsetX
            : 0;
        return {
            ...point,
            x: baseX + offsetX,
            y: scaleY(point.altitudeAMSL),
        };
    });
});
```

**2.2.3d**: 드래그 종료 시 `speedVisualOffsetX` 초기화

```javascript
// ElevationProfile.vue — handlePointerUp() 내
dragState.value.speedVisualOffsetX = 0;
```

---

## 3. 문제 2: 음수 고도 및 지면표고 처리

### 3.1 펌웨어 분석 결과

`autopilot/src/main/flight/gps_rescue.c` 분석 결과:

| 검증 항목 | 결과 |
|-----------|------|
| `mission.h` L46: `float altitude;` | 부호 있는 float, 음수 제한 없음 |
| `mission.c` L153: `rescueState.intent.targetAltitudeCm = wp->altitude;` | clamp 없이 직접 대입 |
| `gps_rescue.c` L324-380: `calculateAltitudePitch()` | `altErrM` 연산이 부호 무관하게 동작 |
| `position.c` L164: `zeroedAltitudeCm = gpsAltCm - gpsAltOffsetCm;` | 시동 지점보다 낮으면 음수 반환 |
| OSD 음수 고도 표시 | 사용자 확인 완료 |
| WP 미션 완료 후 `RESCUE_FLY_HOME` 전환 | CLI altitude(항상 양수) 추종하므로 음수 문제 없음 |

> **결론**: 펌웨어는 음수 `targetAltitudeCm`을 정상 처리합니다. **WP2 이후 고도에서 음수를 허용해야 합니다.**

### 3.2 수정 사항

#### 3.2.1 minAllowedAGL에서 0 clamp 제거

**파일**: `src/components/tabs/FlightPlan/ElevationProfile.vue`

```javascript
// ElevationProfile.vue — minAllowedAGL computed (L323-331 근처)
// 변경 전:
result[point.uid] = Math.max(0, groundAtPoint - wp1GroundElevation.value);

// 변경 후:
result[point.uid] = groundAtPoint - wp1GroundElevation.value;  // 0 clamp 제거
// 단, WP1은 WP1 지표고도 - WP1 지표고도 = 0 (항상)
```

> **WP1 제외**: `getGroundElevAtPoint(0)`은 WP1의 해발고도를 반환하고, `wp1GroundElevation.value`와 같으므로 WP1의 `minAllowedAGL`은 항상 0입니다. 이는 의도된 동작입니다 (WP1 = 출발 지점 지면).

#### 3.2.2 WaypointEditor 고도 입력 음수 허용

**파일**: `src/components/tabs/FlightPlan/WaypointEditor.vue`

```vue
<!-- WaypointEditor.vue L36 (현재) -->
<!-- 변경 전: -->
:min="0"

<!-- 변경 후: WP2 이후만 음수 허용 (WP1은 항상 0 이상) -->
:min="waypoint.order === 0 ? 0 : -5000"
```

그러나 Editor는 신규 생성용(add)이므로 `order`가 아직 없습니다. 따라서 **모든 WP에 대해 음수 허용**하는 것이 안전합니다:

```vue
<!-- WaypointEditor.vue L36 -->
<!-- 변경 후: -->
:min="-5000"
```

> WP1의 고도가 음수가 될 수 있지만, `validateWaypoint`나 `updateWaypoint`에서 별도로 WP1 고도 ≥ 0 검증을 추가할 수 있습니다. 다만 WP1이 음수로 설정되어도 `wp1GroundElevation` 기준이므로, Y축에는 `0 + wp1GroundElevation` = 해발고도로 표시되어 문제가 되지 않습니다.

#### 3.2.3 validateWaypoint 음수 허용

**파일**: `src/composables/useFlightPlan.js`

```javascript
// useFlightPlan.js L93-97 (현재)
if (waypointData.type === "alt_change") {
    if (!Number.isFinite(waypointData.altitude) || waypointData.altitude < 0) {
        // 변경: 음수 허용
        // if (!Number.isFinite(waypointData.altitude)) {
        gui_log(i18n.getMessage("flightPlanInvalidAltitude") || "Altitude must be valid");
        return false;
    }
}
```

> `alt_change` 타입은 고도만 변경하는 modifier이므로 음수도 허용합니다. WP1의 `latitude=0, longitude=0`인 경우 실제 WP로 사용되지 않으므로 일반 WP의 좌표 검증과 분리되어 있습니다.

---

## 4. 문제 3: 지면표고 표시 개선

### 4.1 WP별 상대지면표고 표시

**파일**: `src/components/tabs/FlightPlan/ElevationProfile.vue`

**변경 내용**: 통계 영역에서 평균 지면표고(`groundElevation`) 대신 선택된 WP의 상대지면표고와 전체 최대 상대지면표고를 표시합니다.

#### 4.1.1 선택된 WP의 상대지면표고 computed 추가

```javascript
// ElevationProfile.vue — script setup

// 선택된 WP의 상대지면표고 (WP1 지표고도 기준)
const selectedWpRelativeGroundElev = computed(() => {
    if (!selectedWaypointUid.value) return 0;
    const point = profilePoints.value.find(p => p.uid === selectedWaypointUid.value);
    if (!point) return 0;
    return getGroundElevAtPoint(point.distance) - wp1GroundElevation.value;
});
```

#### 4.1.2 최대 상대지면표고 computed 추가

```javascript
// ElevationProfile.vue — script setup

// 전체 최대 상대지면표고
const relativeMaxGroundElevation = computed(() => {
    if (terrainSamples.value.length === 0) return 0;
    const maxAmbl = Math.max(...terrainSamples.value.map(s => s.elevation));
    return maxAmbl - wp1GroundElevation.value;
});
```

#### 4.1.3 템플릿 통계 영역 변경

```vue
<!-- ElevationProfile.vue — profile-stats 영역 (L17-22 근처) -->
<!-- 변경 전: -->
<span class="stat">
    <strong>{{ $t("flightPlanGroundElev") }}:</strong> {{ formatAltitude(groundElevation) }}
</span>
<span class="stat">
    <strong>{{ $t("flightPlanMaxGroundElev") }}:</strong> {{ formatAltitude(maxGroundElevation) }}
</span>

<!-- 변경 후: -->
<span class="stat">
    <strong>{{ $t("flightPlanRelativeGroundElev") }}:</strong> {{ formatAltitude(selectedWpRelativeGroundElev) }}
    <span class="stat-note">(WP{{ (selectedWaypointUid ? profilePoints.find(p=>p.uid===selectedWaypointUid)?.order ?? 0 : 0) + 1 }})</span>
</span>
<span class="stat">
    <strong>{{ $t("flightPlanRelativeMaxGroundElev") }}:</strong> {{ formatAltitude(relativeMaxGroundElevation) }}
</span>
```

> **참고**: WP가 선택되지 않았으면 WP1 기준으로 표시합니다. 상대지면표고가 음수일 수 있으며(선택 WP가 WP1보다 낮은 지형), `formatAltitude`가 자동으로 변환합니다.

### 4.2 Y축 "해발고도 (AMSL)" 라벨 추가

**파일**: `src/components/tabs/FlightPlan/ElevationProfile.vue`

**위치**: Y축 최상단 라벨 옆 (옵션 A)

```vue
<!-- ElevationProfile.vue — Y축 라벨 그룹 내 (L44-54 근처) -->
<!-- Y축 최상단 tick 라벨 옆에 "(AMSL)" 추가 -->
<text
    v-for="tick in yAxisTicks"
    :key="`y-label-${tick.value}`"
    :x="padding.left - 9"
    :y="tick.y + 3"
    class="axis-label"
    text-anchor="end"
>
    {{ formatAltitude(tick.value) }}
    <!-- 최상단 tick에만 AMSL 라벨 추가 -->
    <tspan v-if="tick === yAxisTicks[yAxisTicks.length - 1]" class="amsl-label"> (AMSL)</tspan>
</text>
```

CSS 추가:
```css
.amsl-label {
    fill: var(--surface-600);
    font-size: 6px;
}
```

### 4.3 i18n 키 추가

**파일**: `locales/ko/messages.json`, `locales/en/messages.json`

```json
// ko
"flightPlanRelativeGroundElev": {
    "message": "상대지면표고"
},
"flightPlanRelativeMaxGroundElev": {
    "message": "상대 최대지면표고"
},

// en
"flightPlanRelativeGroundElev": {
    "message": "Rel. Ground Elev"
},
"flightPlanRelativeMaxGroundElev": {
    "message": "Rel. Max Ground"
}
```

---

## 5. 문제 4: 툴팁 개선 및 시간 기반 속도 변경

### 5.1 툴팁 라벨 변경

**파일**: `src/components/tabs/FlightPlan/ElevationProfile.vue`

```vue
<!-- ElevationProfile.vue — tooltip 템플릿 (L167-170 근현) -->
<!-- 변경 전: -->
<div>WP{{ tooltipData.order }}</div>
<div><span v-html="$t('flightPlanAlt')"></span>: {{ formatAltitude(tooltipData.altitude) }} <span v-html="$t('flightPlanRelativeAlt')"></span></div>
<div><span v-html="$t('flightPlanSpeed')"></span>: {{ formatSpeedMps(tooltipData.speed) }}</div>

<!-- 변경 후: -->
<div>WP{{ tooltipData.order }}</div>
<div>{{ $t('flightPlanRelativeAltLabel') }}: {{ formatAltitude(tooltipData.altitude) }}</div>
<div>{{ $t('flightPlanSpeedLabel') }}: {{ formatSpeedMps(tooltipData.speed) }} m/s</div>
```

### 5.2 i18n 키 추가

```json
// ko
"flightPlanRelativeAltLabel": {
    "message": "상대고도"
},
"flightPlanSpeedLabel": {
    "message": "속도"
},

// en
"flightPlanRelativeAltLabel": {
    "message": "Rel. Alt"
},
"flightPlanSpeedLabel": {
    "message": "Speed"
}
```

### 5.3 드래그 중 툴팁 실시간 갱신

**파일**: `src/components/tabs/FlightPlan/ElevationProfile.vue`

#### 5.3.1 고도 드래그 시 즉시 갱신

```javascript
// ElevationProfile.vue — handleAltDragMove() 내
// updateWaypoint() 호출 직후 tooltipData 갱신 추가

if (clampedAlt !== currentWp.altitude) {
    updateWaypoint(dragState.value.wpUid, { altitude: clampedAlt });
    dragState.value.startY = event.clientY;
    tooltipData.value.altitude = clampedAlt;  // ★ 툴팁 실시간 갱신
}
```

#### 5.3.2 속도 드래그 시 즉시 갱신 (시간 기반)

아래 5.4절에서 시간 기반 속도 변경과 통합하여 구현합니다.

#### 5.3.3 드래그 중 툴팁 위치도 갱신

```javascript
// ElevationProfile.vue — handlePointerMove() 내, 타입 판별 후 드래그 처리 부분

if (dragState.value.type === 'altitude') {
    handleAltDragMove(event);
} else {
    handleSpeedDragMove(event);
}

// ★ 드래그 중 항상 툴팁 위치 갱신
const draggedPoint = scaledProfilePoints.value.find(p => p.uid === dragState.value.wpUid);
if (draggedPoint) {
    updateTooltipPosition(event, draggedPoint);
}
```

### 5.4 속도 변경: 거리 기반 → 시간 기반으로 전환 (plan2.md)

**이것이 가장 중요한 변경입니다.** 사용자 요구사항인 "시간에 따라 변화"를 반영하여, 속도 드래그를 거리(deltaX) 기반에서 시간+방향 기반으로 변경합니다.

#### 5.4.1 동작 방식

- **방향 결정**: 마우스가 중심에서 왼쪽(-5px 이하)이면 감속, 오른쪽(+5px 이상)이면 가속
- **시간 기반**: 500ms마다 ±1 m/s씩 지속적으로 변화
- **방향 재설정**: 마우스가 반대 방향으로 5px 이상 움직이면 즉시 방향 전환
- **즉시 피드백**: 툴팁 속도 표시는 쓰로틀과 무관하게 즉시 갱신

#### 5.4.2 dragState 확장

```javascript
// ElevationProfile.vue — dragState 정의
const dragState = ref({
    active: false,
    type: null,
    wpUid: null,
    startX: 0,
    startY: 0,
    lastValue: 0,
    lastMoveTime: 0,
    speedVisualOffsetX: 0,   // ★ 시각적 X 오프셋 (문제 2.2.3)
    speedDirection: 0,        // ★ 속도 변경 방향 (-1: 감속, 0: 중립, +1: 가속)
});
```

#### 5.4.3 handlePointerMove 방향 감지

```javascript
// ElevationProfile.vue — handlePointerMove() 내
// 속도 드래그 타입일 때, 방향 감지 (쓰로틀과 무관하게 즉시)

if (dragState.value.type === 'speed') {
    const deltaX = event.clientX - dragState.value.startX;
    // 시각적 오프셋 (문제 2.2.3)
    dragState.value.speedVisualOffsetX = Math.sign(deltaX) * Math.min(Math.abs(deltaX) * 0.5, 15);
    
    // 방향 결정 (±5px 임계값으로 히스테리시스)
    if (Math.abs(deltaX) > 5) {
        dragState.value.speedDirection = deltaX > 0 ? 1 : -1;
    }
}
```

#### 5.4.4 handleSpeedDragMove 완전 재작성 (시간 기반)

```javascript
// ElevationProfile.vue — handleSpeedDragMove() 완전 교체

const handleSpeedDragMove = (event) => {
    const currentWp = waypoints.value.find(wp => wp.uid === dragState.value.wpUid);
    if (!currentWp) return;
    
    // ★ 시간 쓰로틀: 500ms 간격으로만 값 변경
    const now = Date.now();
    if (now - dragState.value.lastMoveTime < 500) return;
    dragState.value.lastMoveTime = now;
    
    // ★ 방향이 중립이면 변화 없음 (마우스가 중심 근처에 있음)
    if (dragState.value.speedDirection === 0) return;
    
    // ★ 시간 기반: 방향에 따라 ±1 m/s
    const currentMps = Math.round(settings.storageToMps(currentWp.speed || 10));
    const newMps = Math.max(5, Math.min(25, currentMps + dragState.value.speedDirection));
    const newKnots = settings.mpsToStorage(newMps);
    
    if (Math.abs(newKnots - currentWp.speed) > 0.01) {
        updateWaypoint(dragState.value.wpUid, { speed: newKnots });
        tooltipData.value.speed = newKnots;  // ★ 툴팁 갱신
    }
};
```

#### 5.4.5 handlePointerDown 초기화

```javascript
// ElevationProfile.vue — handlePointerDown() 내 dragState 초기값
dragState.value = {
    active: true,
    type: null,
    wpUid: point.uid,
    startX: event.clientX,
    startY: event.clientY,
    lastValue: point.altitude,
    lastMoveTime: 0,
    speedVisualOffsetX: 0,   // ★
    speedDirection: 0,        // ★
};
```

### 5.5 WaypointList 속도 갱신 속도 일치 확인

`WaypointList.vue`는 `updateWaypoint()` 호출 시 Vue 반응형으로 즉시 갱신됩니다 (2.2.1의 debounce는 localStorage만 해당). 따라서 표고 프로필과 WaypointList의 속도 갱신 타이밍은 이미 일치합니다. 별도 수정 불필요.

---

## 6. 추가 개선 사항

### 6.1 드래그 방향 판별 임계값 튜닝

현재 `DRAG_DIRECTION_THRESHOLD = 10`은 모바일 터치에서 다소 클 수 있습니다. 필요시 조정:

```javascript
// ElevationProfile.vue L207
const DRAG_DIRECTION_THRESHOLD = 10; // 실험적 조정 가능 (8~12 권장)
```

- 너무 작으면: 상하/좌우 구분이 어려움 (손떨림 오인식)
- 너무 크면: 드래그 시작 반응이 둔해짐

### 6.2 터치 디바이스 대응

`setPointerCapture`를 이미 사용하고 있으므로 드래그 중 마우스/터치가 마커를 벗어나도 이벤트가 정상 수신됩니다. `FlightPlanMap.vue`의 모바일 터치 패턴(pointerdown → pointermove → pointerup)을 참조하여 구현 완료된 상태입니다.

---

## 7. 수정 대상 파일 및 변경 요약

| # | 파일 | 변경 내용 | 우선순위 |
|---|------|----------|:---:|
| 1 | `useFlightPlan.js` | `updateWaypoint()`에 savePlan debounce 300ms 추가 | 🔴 HIGH |
| 2 | `useFlightPlan.js` | `validateWaypoint` 음수 고도 허용 (0 clamp 제거) | 🔴 HIGH |
| 3 | `ElevationProfile.vue` | `combinedMax` 최소값 100ft 보장 (div-by-zero 방지) | 🔴 HIGH |
| 4 | `ElevationProfile.vue` | `handleAltDragMove`를 SVG 스케일 동기화로 변경 | 🔴 HIGH |
| 5 | `ElevationProfile.vue` | `handleSpeedDragMove`를 시간 기반으로 완전 재작성 | 🔴 HIGH |
| 6 | `ElevationProfile.vue` | `dragState`에 `speedVisualOffsetX`, `speedDirection` 추가 | 🔴 HIGH |
| 7 | `ElevationProfile.vue` | `handlePointerMove`에 시각 오프셋 계산 추가 | 🔴 HIGH |
| 8 | `ElevationProfile.vue` | `scaledProfilePoints`에 오프셋 적용 | 🔴 HIGH |
| 9 | `ElevationProfile.vue` | `minAllowedAGL`에서 0 clamp 제거 (음수 허용) | 🔴 HIGH |
| 10 | `ElevationProfile.vue` | `selectedWpRelativeGroundElev` computed 추가 | 🟡 MED |
| 11 | `ElevationProfile.vue` | `relativeMaxGroundElevation` computed 추가 | 🟡 MED |
| 12 | `ElevationProfile.vue` | 통계 영역 템플릿: 상대지면표고/상대 최대지면표고로 변경 | 🟡 MED |
| 13 | `ElevationProfile.vue` | Y축 최상단 "(AMSL)" 라벨 추가 | 🟡 MED |
| 14 | `ElevationProfile.vue` | 툴팁 라벨 "상대고도"/"속도"로 변경 | 🟡 MED |
| 15 | `ElevationProfile.vue` | 드래그 중 툴팁 실시간 갱신 (고도+속도) | 🔴 HIGH |
| 16 | `ElevationProfile.vue` | 드래그 중 툴팁 위치도 갱신 | 🟡 MED |
| 17 | `WaypointEditor.vue` | 고도 `:min="0"` → `:min="-5000"` | 🔴 HIGH |
| 18 | `locales/ko/messages.json` | `flightPlanRelativeGroundElev`, `flightPlanRelativeMaxGroundElev`, `flightPlanRelativeAltLabel`, `flightPlanSpeedLabel` 추가 | 🟡 MED |
| 19 | `locales/en/messages.json` | 동일 | 🟡 MED |

---

## 8. 구현 순서

| 단계 | 파일 | 작업 |
|:---:|------|------|
| 1 | `useFlightPlan.js` | savePlan debounce 추가 |
| 2 | `useFlightPlan.js` | validateWaypoint 음수 고도 허용 |
| 3 | `ElevationProfile.vue` | dragState 확장 (speedVisualOffsetX, speedDirection) |
| 4 | `ElevationProfile.vue` | `handlePointerDown` 초기화 업데이트 |
| 5 | `ElevationProfile.vue` | `handlePointerMove` 방향 감지 + 시각 오프셋 추가 |
| 6 | `ElevationProfile.vue` | `handleAltDragMove` SVG 스케일 동기화로 변경 |
| 7 | `ElevationProfile.vue` | `handleSpeedDragMove` 시간 기반으로 완전 재작성 |
| 8 | `ElevationProfile.vue` | `combinedMax` 최소값 100ft 보장 |
| 9 | `ElevationProfile.vue` | `minAllowedAGL` 0 clamp 제거 |
| 10 | `ElevationProfile.vue` | `scaledProfilePoints` 오프셋 적용 |
| 11 | `ElevationProfile.vue` | `selectedWpRelativeGroundElev`, `relativeMaxGroundElevation` computed 추가 |
| 12 | `ElevationProfile.vue` | 통계 영역 템플릿 변경 |
| 13 | `ElevationProfile.vue` | Y축 AMSL 라벨 + CSS 추가 |
| 14 | `ElevationProfile.vue` | 툴팁 라벨 변경 + 실시간 갱신 |
| 15 | `WaypointEditor.vue` | 고도 `:min="-5000"` |
| 16 | `locales/` | 각 언어 i18n 키 4개씩 추가 |

---

## 9. 검증 항목

1. **드래그 반응성**: 마커를 상하로 드래그할 때 마우스와 마커가 **즉시** 같은 속도로 움직이는지 확인
2. **속도 시간 기반**: 마커를 좌/우로 드래그하고 유지하면 500ms마다 ±1 m/s씩 **계속** 변화하는지 확인
3. **시각적 속도 피드백**: 좌우 드래그 시 마커가 **살짝 좌우로 움직이는지** 확인
4. **음수 고도**: WP1이 해발 1000m일 때 WP2 상대고도를 -200ft로 설정 가능한지 확인
5. **WP별 상대지면표고**: WP 선택 시 해당 지점의 상대지면표고가 표시되고, WP1보다 낮으면 음수 표시되는지 확인
6. **Y축 AMSL**: Y축 최상단에 "(AMSL)"이 표시되는지 확인
7. **툴팁 실시간**: 드래그 중 툴팁의 고도/속도가 즉시 갱신되는지 확인
8. **단위 토글**: m/ft, m/s 전환 시 값이 올바르게 변환되는지 확인
9. **savePlan**: 드래그 후 300ms 이내에 localStorage에 저장되는지 확인
10. **모바일 터치**: 안드로이드에서 마커 터치 후 상하/좌우 드래그가 의도대로 동작하는지 확인

---

## 10. 주의사항

1. **scaleY 역변환 정밀도**: SVG 스케일 동기화 구현 시 `scaleY`와 `paddedMax` 계산이 `scaleY` 함수 자체(`L484-494`)와 정확히 동일해야 합니다. 미세한 불일치가 마커 떨림을 유발할 수 있습니다.

2. **`combinedMax`가 0인 엣지 케이스**: WP가 1개이고 지형 데이터가 없는 경우, division by zero를 방지하기 위해 `Math.max(..., 100)`을 보장합니다.

3. **시간 기반 속도와 방향 재설정**: 마우스가 반대 방향으로 5px 이상 움직이면 즉시 방향 전환합니다. 이 임계값(5px)은 너무 작지도 크지도 않게 조정 필요할 수 있습니다.

4. **savePlan debounce와 다른 savePlan() 호출**: `addWaypoint`, `removeWaypoint`, `clearPlan`, `saveToFC` 등 다른 함수들도 `savePlan()`을 호출합니다. debounce 타이머를 공유하지 않도록, debounce는 `updateWaypoint` 내에서만 동작하게 합니다.

5. **WP1 고도 0 보장**: WP1의 `minAllowedAGL`은 `groundElevAtWP1 - wp1GroundElevation = 0`이므로 항상 0입니다. WP1에 음수 고도를 입력할 수는 있지만(Editor에서 허용), 지면 아래로 내려가므로 실제로는 0 이상으로 유지하는 것이 안전합니다.

6. **i18n 키 누락 방지**: 모든 지원 언어 파일에 새 키 4개(`flightPlanRelativeGroundElev`, `flightPlanRelativeMaxGroundElev`, `flightPlanRelativeAltLabel`, `flightPlanSpeedLabel`)를 추가해야 합니다.

7. **`speedVisualOffsetX` 성능**: `scaledProfilePoints`는 computed이므로 `speedVisualOffsetX` 변경 시 전체 프로필 포인트가 재계산됩니다. 현재 최대 15개 WP로는 성능 문제가 없지만, 향후 WP가 많아지면 `dragState`를 별도 ref로 분리하여 computed 의존성을 줄이는 것을 검토할 수 있습니다.

8. **터치 이벤트 호환성**: `setPointerCapture`는 모든 pointer 이벤트(마우스+터치)를 통합 처리합니다. `FlightPlanMap.vue` 패턴을 그대로 사용하므로 교차 검증이 가능합니다.

9. **기존 localStorage 데이터**: 이미 AMSL 기준으로 저장된 이전 비행 계획은 WP1 지표고도를 알 수 없습니다. 기존 데이터를 로드할 때 `wp1GroundElevation`을 0으로 가정합니다.

10. **CSS `tspan` 스타일**: `.amsl-label` 클래스가 SVG 내에서 올바르게 렌더링되려면 scoped CSS가 아닌 global CSS나 `:deep()` 선택자를 사용해야 할 수 있습니다.
