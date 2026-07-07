# FlightPlan 표고 프로필 수정 작업 지시서

> **대상 코드**: `src/components/tabs/FlightPlan/ElevationProfile.vue` (주파일)
> **관련 코드**: `src/components/tabs/FlightPlan/WaypointEditor.vue`
> **펌웨어 참조**: `autopilot/src/main/flight/gps_rescue.c`
> **작성일**: 2026-07-07

---

## 사용자에게 문제 제기 (논리적 오류 검토 결과)

### 제기 1 — 문제 4: 속도 변경 방식 설명의 모순

**사용자 설명**: *"속도의 변화는 포인트가 움직인 양이 아니고 중심에서 벗어나 좌우로 벗어나 있는 시간에 따라 변화한다. 변화량은 기존코드대로 사용하면 되지만"*

**현존 코드의 실제 동작** (`handleSpeedDragMove`):
```javascript
const deltaX = event.clientX - dragState.value.startX;  // ← 거리 기반
const speedDeltaMps = Math.round(deltaX / 10);            // ← 10px당 1m/s
```

현재 코드는 **거리(distance) 기반**입니다. 마우스를 멈추면 `deltaX`가 0이 되어 속도 변화도 멈춥니다. 사용자가 원하는 **시간(time) 기반** 동작(한쪽 방향으로 유지하면 시간에 비례해 속도가 계속 변함)과 다릅니다.

**확인 필요**: "변화량은 기존코드대로"라는 표현이 (A) 500ms 간격과 1m/s 단위 변화량만 재사용한다는 의미인지, 아니면 (B) 현재의 deltaX 거리 기반 로직 그대로 유지하되 툴팁만 빠르게 갱신하라는 의미인지 명확히 해주세요.

> **본 지시서는 (A) 해석으로 작성**했습니다. 시간 기반 속도 변경 + 기존 1m/s/500ms 변화량 유지 + 툴팁 실시간 갱신으로 반영했습니다. (B)의 경우 수정 범위가 툴팁 갱신으로 축소됩니다.

### 제기 2 — 문제 3: Y축 라벨 "해발고도" 표시에 대한 보완 필요

사용자는 *"제일 왼쪽에 표시되는 고도는 해발고도로 여겨지는데 수정하지 않는것이 좋다. 다만 해발고도라고 표시해주는것이 혼란 방지"*라고 했습니다.

현재 Y축 라벨은 단위만 표시합니다 (예: `0`, `500`, `1000` ft). "해발고도"라는 명칭을 어디에 표시할지 구체적인 위치가 필요합니다:
- (A) Y축 최상단 라벨 옆에 "(해발고도)" 텍스트 추가
- (B) Y축 타이틀을 별도로 추가 (그래프 좌측 세로 방향)
- (C) 통계 영역에 "Y축: 해발고도(AMSL)" 안내 문구 추가

> **본 지시서는 (A) 방식**을 기본으로 기술합니다. 선호하는 방식을 알려주세요.

### 논리 오류 없음으로 확인된 항목

| 항목 | 판정 | 이유 |
|------|------|------|
| 문제 1: 드래그 방향 판별 | 정상 | `DRAG_DIRECTION_THRESHOLD` + `absDy > absDx` 판별은 이미 구현됨 |
| 문제 2: 음수 고도 정책 | ~~정상~~ **수정 필요** | 초기 분석에서 펌웨어 미지원으로 판단했으나, 사용자 정정: WP 이후 FLY_HOME 전환 시 CLI altitude(항상 양수) 추종하므로 음수 고도 문제되지 않음 → 0 제한 제거 |
| 문제 3: 평균 지면표고 → WP별 상대표고 변경 | 정상 | 요구사항 명확 |
| WP1 = 홈포인트 해발고도 가정 | 정상 | 사용자 주의 사항으로 명시됨 |

---

## 펌웨어 분석 결과: 음수 고도 처리

### 결론: **음수 고도 지원 — 0 제한 제거**

`gps_rescue.c` 분석 + **사용자 정정** 결과:

| 항목 | 결과 |
|------|------|
| `currentAltitudeCm` 음수 가능 여부 | 가능 (기압계 기준, 홈 아래 비행 시) |
| `targetAltitudeCm`에 음수 설정 가능 여부 | **제한 없음** (PID 수학적 동작 정상) |
| 코드상 음수 clamp | **없음** |
| WP 미션 완료 후 동작 | `RESCUE_FLY_HOME` 전환 → **CLI altitude(항상 양수) 추종** |
| `getAltitude()` 반환값 | 홈(아밍) 지점 기준 상대고도 (cm) |

**사용자 정정 내용**:
> 코드상 음수를 clamp 하는 부분은 없다. waypoint를 모두 지난 후에는 rescue flyhome 상태로 가며 이때 사용자가 미리 입력한 cli altitude를 추종하게 되어 있어 (항상 양수) waypoint 지날 때 음수 고도가 문제가 되지 않는다.

**따라서 WP2 이후 고도에서 `Math.max(0, ...)` 제한을 제거하고 음수 고도를 허용합니다.**

> **작업 지시**: 문제 2는 `minAllowedAGL`의 0 제한 제거 + `WaypointEditor.vue`의 `:min` 음수 허용으로 코드 변경 필요.

---

## 문제 1: WP 드래그 반응성 개선

### 현상 분석

**파일**: `ElevationProfile.vue`

**고도 드래그 (수직)** — 반응이 느려 보이는 원인:

현재 드래그 감도는 고정값 `1ft per 2px` (screen pixel)입니다:
```javascript
const altitudeDelta = Math.round(deltaY / 2);
```

하지만 SVG의 Y축 스케일은 고도 범위에 따라 동적으로 변합니다. `scaleY()` 함수는 `combinedMax` 값에 따라 1px(SVG)이 몇 ft에 해당하는지 결정합니다. 예를 들어:
- 차트 플롯 영역: `chartHeight(150) - padding.top(20) - padding.bottom(35) = 95` SVG 단위
- 고도 범위가 0~1000ft일 때: 1 SVG 단위 ≈ 10.5ft
- CSS 렌더링 비율이 1.5x라면: 1 screen pixel ≈ 15.8ft
- 하지만 드래그 감도는 1 screen pixel = 0.5ft

**결과**: 마우스를 10px 움직여도 고도가 5ft만 변하고, 시각적으로는 약 0.3px밖에 움직이지 않습니다. **마커가 거의 따라오지 않는 것처럼 보입니다.**

**속도 드래그 (수평)** — 마커가 전혀 움직이지 않는 원인:

WP 마커의 X 좌표는 누적 거리에 의해 고정되어 있으며, 수평 드래그는 속도 값만 변경합니다. 마커의 시각적 X 위치는 변하지 않아 사용자 피드백이 없습니다.

### 수정 사항

#### 1-1. 고도 드래그 감도를 차트 스케일에 동기화

**위치**: `handleAltDragMove` 함수

**현재 코드**:
```javascript
const handleAltDragMove = (event) => {
    const deltaY = dragState.value.startY - event.clientY;
    const currentWp = waypoints.value.find((wp) => wp.uid === dragState.value.wpUid);
    if (!currentWp) return;
    const altitudeDelta = Math.round(deltaY / 2);
    const minAlt = minAllowedAGL.value[dragState.value.wpUid] ?? 0;
    const newAlt = Math.max(minAlt, Math.min(maxAllowedAGL, currentWp.altitude + altitudeDelta));
    if (newAlt !== currentWp.altitude) {
        updateWaypoint(dragState.value.wpUid, { altitude: newAlt });
        dragState.value.startY = event.clientY;
    }
};
```

**수정 방향**:
- `event.clientY`의 deltaY (screen pixel)를 SVG 좌표계의 deltaY로 변환
- SVG deltaY를 고도 값(ft)으로 변환하여 `updateWaypoint` 호출
- 이렇게 하면 **마우스 움직임과 마커 움직임이 1:1로 일치**

**계산 공식**:
```
SVG 플롯 높이 = chartHeight - padding.top - padding.bottom  // 95 SVG 단위
고도 범위 = combinedMax (ft)

// screen pixel → SVG 단위 변환
svgDeltaY = screenDeltaY × (SVG 플롯 높이 / chart 실제 렌더링 높이 px)
// SVG 단위 → 고도 변환
altitudeDelta = svgDeltaY × (고도 범위 / SVG 플롯 높이)
```

**구현 참고**:
```javascript
const handleAltDragMove = (event) => {
    const deltaY = dragState.value.startY - event.clientY; // screen pixels (위로 드래그 = 양수)
    
    // chartSvg 엘리먼트의 실제 렌더링 크기와 viewBox 비율로 변환
    const svgElement = chartSvg.value;
    if (!svgElement) return;
    const viewBox = svgElement.viewBox.baseVal;
    const clientRect = svgElement.getBoundingClientRect();
    const scaleFactor = viewBox.height / clientRect.height; // SVG unit per screen pixel
    
    // screen pixel → SVG pixel → altitude (ft)
    const svgDeltaY = deltaY * scaleFactor;
    const plotHeight = chartHeight - padding.top - padding.bottom; // 95
    const altRange = combinedMax.value * 1.1; // scaleY의 paddedMax와 동일
    const altitudeDelta = Math.round((svgDeltaY / plotHeight) * altRange);
    
    const currentWp = waypoints.value.find((wp) => wp.uid === dragState.value.wpUid);
    if (!currentWp) return;
    
    const minAlt = minAllowedAGL.value[dragState.value.wpUid] ?? 0;
    const newAlt = Math.max(minAlt, Math.min(maxAllowedAGL, currentWp.altitude + altitudeDelta));
    
    if (newAlt !== currentWp.altitude) {
        updateWaypoint(dragState.value.wpUid, { altitude: newAlt });
        dragState.value.startY = event.clientY;
    }
};
```

**주의**: `combinedMax.value * 1.1`은 `scaleY()` 함수의 `paddedMax` 계산과 정확히 일치해야 합니다. `scaleY`의 구현을 확인하여 동일한 패딩 계산을 사용하세요.

#### 1-2. 속도 드래그 시 마커 시각 피드백 (미세 좌우 이동)

**위치**: `handleSpeedDragMove` 함수 + `handlePointerMove` + SVG 템플릿

**현재 코드**: 수평 드래그 시 마커가 움직이지 않음

**수정 방향**:
- 수평 드래그 중일 때, 드래그 방향으로 마커를 ±3~5 SVG 단위 시각적으로 이동
- 이位移는 속도 값에는 영향을 주지 않는 **순수 시각 효과**
- `dragState`에 `visualOffsetX` 필드 추가
- `scaledProfilePoints` 계산 시 `visualOffsetX`를 반영

**구현 참고**:

`dragState` 확장:
```javascript
const dragState = ref({
    active: false,
    type: null,        // 'altitude' | 'speed'
    wpUid: null,
    startX: 0,
    startY: 0,
    lastValue: 0,
    lastMoveTime: 0,
    visualOffsetX: 0,  // ★ 추가: 속도 드래그 시 시각적 X 오프셋 (SVG 단위)
});
```

`handleSpeedDragMove`에서 시각 오프셋 계산:
```javascript
const handleSpeedDragMove = (event) => {
    const deltaX = event.clientX - dragState.value.startX;
    // 시각적 오프셋: 최대 ±5 SVG 단위로 제한 (방향만 표시)
    const maxVisualOffset = 5;
    dragState.value.visualOffsetX = Math.sign(deltaX) * 
        Math.min(Math.abs(deltaX) * 0.1, maxVisualOffset);
    
    // ... 기존 속도 변경 로직 (문제 4에서 시간 기반으로 변경됨)
};
```

`handlePointerUp`에서 오프셋 초기화:
```javascript
const handlePointerUp = (event) => {
    // ... 기존 로직
    dragState.value.visualOffsetX = 0;  // ★ 추가
};
```

`scaledProfilePoints`에 오프셋 반영:
```javascript
const scaledProfilePoints = computed(() => {
    return profilePoints.value.map((point) => ({
        ...point,
        x: scaleX(point.distance) + 
           (dragState.value.active && dragState.value.type === 'speed' && point.uid === dragState.value.wpUid
               ? dragState.value.visualOffsetX : 0),
        y: scaleY(point.altitudeAMSL),
    }));
});
```

---

## 문제 2: 음수 고도 허용 (0 제한 제거)

### 결론: `Math.max(0, ...)` 제거 → 음수 고도 허용

펌웨어에 음수 clamp가 없고, WP 미션 완료 후 FLY_HOME에서는 CLI altitude(양수)를 추종하므로, **WP 진행 중 음수 고도는 문제가 없습니다.**

#### 2-1. `minAllowedAGL`에서 0 제한 제거

**파일**: `ElevationProfile.vue`

**현재 코드**:
```javascript
const minAllowedAGL = computed(() => {
    if (profilePoints.value.length === 0) return {};
    const result = {};
    for (const point of profilePoints.value) {
        const groundAtPoint = getGroundElevAtPoint(point.distance);
        result[point.uid] = Math.max(0, groundAtPoint - wp1GroundElevation.value);  // ← 0 제한
    }
    return result;
});
```

**수정 코드**:
```javascript
const minAllowedAGL = computed(() => {
    if (profilePoints.value.length === 0) return {};
    const result = {};
    for (const point of profilePoints.value) {
        const groundAtPoint = getGroundElevAtPoint(point.distance);
        result[point.uid] = groundAtPoint - wp1GroundElevation.value;  // ★ Math.max(0, ...) 제거
    }
    return result;
});
```

**변경 후 동작**:
- WP2 이후 고도가 음수 가능 (예: WP1이 고지대이고 WP2가 계곡인 경우)
- 최소 고도 = 해당 WP 위치의 상대지면표고 (WP1 지면 기준)
- WP1 자체의 최소 고도는 여전히 0 (WP1의 `groundAtPoint - wp1GroundElevation` = 0)

#### 2-2. `WaypointEditor.vue`에서 음수 고도 입력 허용

**파일**: `WaypointEditor.vue`

**현재 코드**:
```html
<UInputNumber
    v-model="form.altitude"
    :step="1"
    :min="0"
    :max="50000"
    ... />
```

**수정**: `:min` 값을 음수 허용으로 변경. WP1은 0 이상이어야 하므로, WP1인지 WP2+인지에 따라 동적으로 제어하는 것이 이상적이지만, 단순 구현을 위해 `:min="-5000"` 등 안전한 음수 범위로 설정할 수 있습니다.

**최소한의 수정 (권장)**:
```html
<UInputNumber
    v-model="form.altitude"
    :step="1"
    :min="-5000"
    :max="50000"
    ... />
```

**더 정교한 수정 (WP1 = 0 제한 유지, WP2+ = 음수 허용)**:
```html
<UInputNumber
    v-model="form.altitude"
    :step="1"
    :min="editingWaypoint && editingWaypoint.order > 0 ? -5000 : 0"
    :max="50000"
    ... />
```

> `editingWaypoint`는 이미 `useFlightPlan()` composable에서 가져옵니다. `order === 0`이면 WP1이므로 최소값 0 유지, `order > 0`이면 음수 허용.

#### 2-3. `handleAltDragMove`에서 음수 최소값 동작 확인

문제 1의 수정으로 `handleAltDragMove`가 변경되지만, `minAlt` 참조는 그대로 유지됩니다:
```javascript
const minAlt = minAllowedAGL.value[dragState.value.wpUid] ?? 0;
const newAlt = Math.max(minAlt, Math.min(maxAllowedAGL, currentWp.altitude + altitudeDelta));
```

`minAllowedAGL`이 이제 음수를 반환할 수 있으므로, `Math.max(minAlt, ...)`는 음수 값을 허용하게 됩니다. **이 부분은 추가 수정 없이 자동으로 동작**합니다.

#### 2-4. Y축 스케일이 음수 고도를 표시할 수 있도록 확인

현재 `scaleY` 함수는 `min = 0` (해수면)에서 시작합니다:
```javascript
const scaleY = (altitude) => {
    const min = 0;
    const max = combinedMax.value;
    const range = max - min || 100;
    // ...
};
```

음수 고도가 설정되면 `altitudeAMSL`이 0보다 작아질 수 있습니다 (예: WP1 해발 1000ft, WP2 상대고도 -200ft → AMSL 800ft → 여전히 양수).

**일반적인 경우**: `altitudeAMSL = wp.altitude + wp1GroundElevation`이므로, WP1 해발고도가 충분히 높다면 AMSL 값은 항상 양수입니다. Y축 `min = 0` 유지가 가능합니다.

**극단적인 경우** (WP1 해발고도가 매우 낮고 상대고도가 큰 음수): `altitudeAMSL`이 음수가 될 수 있습니다. 이 경우 Y축 `min = 0`이면 마커가 차트 영역 밖으로 벗어납니다.

**대응**: `scaleY`와 `yAxisTicks`의 `min` 값을 `combinedMin` computed로 동적화하는 것을 검토하세요. 단, 이는 극단적인 엣지 케이스이므로 1차 구현에서는 `min = 0` 유지 후 필요 시 2차에서 대응해도 무방합니다.

---

## 문제 3: 지면표고 표시를 WP별 상대값으로 변경

### 현상 분석

**현재 코드** (`ElevationProfile.vue` 통계 영역):
```html
<span class="stat">
    <strong>{{ $t("flightPlanGroundElev") }}:</strong> {{ formatAltitude(groundElevation) }}
</span>
<span class="stat">
    <strong>{{ $t("flightPlanMaxGroundElev") }}:</strong> {{ formatAltitude(maxGroundElevation) }}
</span>
```

- `groundElevation`: 전체 terrain 샘플의 **평균** 해발고도 (AMSL, feet)
- `maxGroundElevation`: 전체 terrain 샘플의 **최대** 해발고도 (AMSL, feet)
- 둘 다 AMSL 기준이며, 평균값은 그래프 상의 점선(`flightPlanAvgGround`)으로 이미 표시됨

### 수정 사항

#### 3-1. 통계 영역: "지면표고" → 선택한 WP의 상대지면표고

**현재**: 전체 구간 평균 해발고도 (AMSL)
**변경**: 선택한 WP 위치의 지면고도 - WP1 지면고도 (상대값)

**수정 위치**: `profile-stats` 영역의 `groundElevation` 표시

**필요한 computed 속성 추가**:
```javascript
// 선택한 WP의 상대 지면표고 (WP1 지면 기준)
const selectedWpRelativeGroundElev = computed(() => {
    if (!selectedWaypointUid.value || terrainSamples.value.length === 0) {
        return 0;
    }
    // 선택한 WP의 거리 찾기
    const selectedPoint = profilePoints.value.find(
        (p) => p.uid === selectedWaypointUid.value
    );
    if (!selectedPoint) return 0;
    
    // 해당 거리의 지면고도 (AMSL)
    const groundAtWp = getGroundElevAtPoint(selectedPoint.distance);
    // WP1 지면고도로부터의 상대값
    return Math.round(groundAtWp - wp1GroundElevation.value);
});
```

**템플릿 변경**:
```html
<span class="stat">
    <strong>{{ $t("flightPlanRelativeGroundElev") }}:</strong> 
    {{ formatAltitude(selectedWpRelativeGroundElev) }}
</span>
```

> **i18n 키 추가 필요**: `flightPlanRelativeGroundElev` = `"상대지면표고"` (또는 기존 키 수정)

#### 3-2. "최대 지면표고" → "상대 최대 지면표고"

**현재**: `maxGroundElevation` = 전체 terrain 샘플 중 최대 해발고도 (AMSL)
**변경**: 전체 terrain 샘플 중 최대 (해발고도 - WP1 해발고도) = 상대 최대 지면표고

**필요한 computed 속성 추가**:
```javascript
// 상대 최대 지면표고 (WP1 지면 기준)
const relativeMaxGroundElevation = computed(() => {
    if (terrainSamples.value.length === 0) return 0;
    return Math.round(Math.max(
        ...terrainSamples.value.map((s) => s.elevation - wp1GroundElevation.value)
    ));
});
```

**템플릿 변경**:
```html
<span class="stat">
    <strong>{{ $t("flightPlanRelativeMaxGroundElev") }}:</strong> 
    {{ formatAltitude(relativeMaxGroundElevation) }}
</span>
```

> **i18n 키 추가 필요**: `flightPlanRelativeMaxGroundElev` = `"상대 최대 지면표고"`

#### 3-3. Y축 라벨에 "해발고도" 명시

**현재**: Y축 라벨은 숫자만 표시 (예: `0`, `500`, `1000` ft)

**변경**: Y축 최상단 라벨 옆에 해발고도 임을 나타내는 텍스트 추가

**위치**: SVG `y-axis` 그룹 내, 첫 번째 tick 라벨 옆

**구현 참고**:
```html
<g class="y-axis">
    <!-- 기존 tick 라벨들... -->
    <text
        :x="padding.left - 9"
        :y="padding.top - 5"
        class="axis-label-ytitle"
        text-anchor="end"
    >
        {{ $t("flightPlanAMSL") }}
    </text>
    <!-- ... -->
</g>
```

> **i18n 키 추가 필요**: `flightPlanAMSL` = `"해발고도"` 또는 `"(해발고도)"`

**CSS 추가**:
```css
.axis-label-ytitle {
    fill: var(--surface-700);
    font-size: 7px;
    font-style: italic;
    font-family: sans-serif;
}
```

#### 3-4. 기존 평균/최대 해발고도 기준선은 그래프 상에서 유지

그래프 내의 `ground-line` (평균 지면고도 기준선)과 `max-ground-line` (최대 지면고도 기준선)은 AMSL 기준으로 유지합니다. 이 선들은 지형의 절대 높이를 보여주는 용도로 그대로 유지하는 것이 직관적입니다.

**단**, 라벨 텍스트는 명확화를 위해 변경을 검토할 수 있습니다:
- `flightPlanAvgGround` → 유지 (그래프 상에서 평균 지면표고 임을 알 수 있음)
- `flightPlanMaxGround` → 유지

---

## 문제 4: 툴팁 표시 및 속도 갱신 개선

### 현상 분석

#### 4-1. 툴팁 라벨 변경

**현재 툴팁 템플릿**:
```html
<div>
    <span v-html="$t('flightPlanAlt')"></span>: {{ formatAltitude(tooltipData.altitude) }}
    <span v-html="$t('flightPlanRelativeAlt')"></span>
</div>
```

**변경**: "고도 : 00 m AGL" → "상대고도 : 00 m"

**수정**:
```html
<div>
    {{ $t("flightPlanRelativeAltLabel") }}: {{ formatAltitude(tooltipData.altitude) }}
</div>
```

> **i18n 키 추가/수정 필요**: `flightPlanRelativeAltLabel` = `"상대고도"`

#### 4-2. 드래그 중 툴팁 실시간 갱신

**현재 문제**: `tooltipData`는 `handlePointerDown`에서만 설정되고, 드래그 중에는 갱신되지 않습니다. 반면 `WaypointList.vue`는 `waypoints` store의 변경을 반응적으로 표시하므로 갱신 속도 차이가 발생합니다.

**수정 위치**: `handleAltDragMove`와 `handleSpeedDragMove` 내부

**고도 드래그 시 툴팁 갱신 추가** (`handleAltDragMove` 끝에):
```javascript
if (newAlt !== currentWp.altitude) {
    updateWaypoint(dragState.value.wpUid, { altitude: newAlt });
    dragState.value.startY = event.clientY;
    
    // ★ 툴팁 실시간 갱신
    tooltipData.value.altitude = newAlt;
}
```

**속도 드래그 시 툴팁 갱신 추가** (`handleSpeedDragMove` 끝에):
```javascript
if (Math.abs(newKnots - currentWp.speed) > 0.1) {
    updateWaypoint(dragState.value.wpUid, { speed: newKnots });
    dragState.value.startX = event.clientX;
    
    // ★ 툴팁 실시간 갱신
    tooltipData.value.speed = newKnots;
}
```

#### 4-3. 속도 드래그를 시간 기반으로 변경 (제기 1 해결 후)

**현재 동작** (거리 기반):
- 500ms마다 `deltaX / 10`으로 속도 변화량 계산
- 마우스를 멈추면 `deltaX = 0`이 되어 속도 변경 정지

**변경 동작** (시간 기반):
- 방향 판별 후 (좌: 감속, 우: 가속), 500ms마다 ±1 m/s 자동 변경
- 마우스를 계속 움직일 필요 없음
- 방향을 바꾸려면 반대쪽으로 10px 이상 이동 (기존 `DRAG_DIRECTION_THRESHOLD` 활용)

**구현 참조**:

`dragState`에 `speedDirection` 추가:
```javascript
const dragState = ref({
    // ... 기존 필드
    speedDirection: 0,  // ★ 추가: 1 = 가속, -1 = 감속, 0 = 미결정
});
```

`handleSpeedDragMove` 전체 교체:
```javascript
const handleSpeedDragMove = (event) => {
    const now = Date.now();
    if (now - dragState.value.lastMoveTime < 500) {
        // ★ 툴팁은 더 빠르게 갱신 (100ms 간격)
        return;
    }
    dragState.value.lastMoveTime = now;

    const currentWp = waypoints.value.find((wp) => wp.uid === dragState.value.wpUid);
    if (!currentWp) return;

    // 방향 결정: startX 기준으로 좌우 판단 (최초 1회 또는 방향 전환 시)
    const deltaX = event.clientX - dragState.value.startX;
    if (Math.abs(deltaX) > 5) {
        dragState.value.speedDirection = deltaX > 0 ? 1 : -1;
    }

    // 시간 기반 ±1 m/s 변경
    const currentMps = Math.round(settings.storageToMps(currentWp.speed || 10));
    const newMps = Math.max(5, Math.min(25, currentMps + dragState.value.speedDirection));
    const newKnots = settings.mpsToStorage(newMps);

    if (Math.abs(newKnots - currentWp.speed) > 0.1) {
        updateWaypoint(dragState.value.wpUid, { speed: newKnots });
        
        // ★ 툴팁 실시간 갱신
        tooltipData.value.speed = newKnots;
    }
};
```

`handlePointerMove`에서 툴팁 빠른 갱신 분리 (속도 드래그 시):
```javascript
const handlePointerMove = (event) => {
    if (!dragState.value.active) return;
    
    // ★ 속도 드래그 중: 마우스 이동만으로 방향 전환 감지 (타이머 없이)
    if (dragState.value.type === 'speed') {
        const deltaX = event.clientX - dragState.value.startX;
        if (Math.abs(deltaX) > 5) {
            dragState.value.speedDirection = deltaX > 0 ? 1 : -1;
        }
    }
    
    // ... 기존 방향 판별 로직
};
```

`handlePointerDown`에서 `speedDirection` 초기화:
```javascript
dragState.value = {
    // ... 기존 필드
    speedDirection: 0,  // ★ 추가
};
```

---

## 수정 파일 목록 및 변경 요약

| 파일 | 변경 내용 | 우선순위 |
|------|-----------|----------|
| `ElevationProfile.vue` | 고도 드래그 감도를 스케일 동기화로 변경 | 높음 |
| `ElevationProfile.vue` | 속도 드래그 시 마커 시각 오프셋 추가 | 높음 |
| `ElevationProfile.vue` | `selectedWpRelativeGroundElev` computed 추가 | 높음 |
| `ElevationProfile.vue` | `relativeMaxGroundElevation` computed 추가 | 높음 |
| `ElevationProfile.vue` | 통계 영역 템플릿 변경 (상대지면표고, 상대 최대 지면표고) | 높음 |
| `ElevationProfile.vue` | Y축 "해발고도" 라벨 추가 | 중간 |
| `ElevationProfile.vue` | 툴팁 라벨 "상대고도"로 변경 | 높음 |
| `ElevationProfile.vue` | 드래그 중 툴팁 실시간 갱신 (고도+속도) | 높음 |
| `ElevationProfile.vue` | 속도 드래그를 시간 기반으로 변경 | 높음 |
| `ElevationProfile.vue` | `minAllowedAGL`에서 `Math.max(0, ...)` 제거 (음수 허용) | 높음 |
| `WaypointEditor.vue` | `:min="0"` → `:min="-5000"` (또는 WP order 조건부) | 높음 |
| i18n 파일 (각 언어) | `flightPlanRelativeGroundElev`, `flightPlanRelativeMaxGroundElev`, `flightPlanRelativeAltLabel`, `flightPlanAMSL` 키 추가 | 높음 |

## 변경 없음 (확인 완료)

| 항목 | 이유 |
|------|------|
| 드래그 방향 판별 로직 | 이미 정상 동작 (`DRAG_DIRECTION_THRESHOLD`) |
| 그래프 내 평균/최대 해발고도 기준선 | AMSL 기준 유지가 직관적 |
| Y축 `min = 0` (1차) | 일반적인 사용 시 `altitudeAMSL`이 양수이므로 유지 가능. 극단 케이스는 2차 대응 |

---

## 구현 시 주의사항

1. **`scaleY`의 `paddedMax` 계산과 드래그 감도의 일치**: `handleAltDragMove`에서 고도 변화량을 계산할 때, `scaleY`가 사용하는 것과 동일한 패딩 계산(`max + range * 0.1`)을 사용해야 마커가 마우스를 정확히 따라갑니다.

2. **`combinedMax`가 0인 경우**: WP가 1개이고 지형 데이터가 없는 경우, `combinedMax`가 0이 될 수 있습니다. division by zero 방지를 위해 `altRange`에 최소값(예: 100ft)을 보장하세요.

3. **터치 디바이스에서의 `visualOffsetX`**: 터치 이벤트에서는 `clientX`가 없을 수 있습니다. `event.touches?.[0]?.clientX` 또는 `pointerId` 기반 좌표를 사용하도록 확인하세요.

4. **i18n 키 추가 누락 방지**: 한국어, 영어 등 모든 지원 언어 파일에 새 키를 추가해야 합니다.

5. **`getGroundElevAtPoint`의 반환값**: 이 함수는 AMSL feet을 반환합니다. 상대값 계산 시 `wp1GroundElevation.value` (AMSL feet)을 빼면 올바른 상대값이 됩니다. 값이 음수가 될 수 있으며, 이는 정상 동작입니다 (WP1보다 낮은 지형).

6. **음수 고도와 Y축 스케일**: 문제 2 수정 후 `minAllowedAGL`이 음수를 반환할 수 있습니다. `altitudeAMSL = wp.altitude + wp1GroundElevation`이므로, WP1 해발고도가 충분히 높다면 AMSL 값은 양수로 유지됩니다. `scaleY`의 `min = 0`은 1차에서 유지하되, `altitudeAMSL`이 음수가 되는 극단 케이스(예: WP1 해발고도 10ft, WP2 상대고도 -200ft → AMSL -190ft)에서는 마커가 시각적으로 차트 하단으로 밀려나거나 잘릴 수 있습니다.

7. **WP1의 고도는 항상 0 이상**: WP1의 `minAllowedAGL`은 `groundAtWP1 - wp1GroundElevation = 0`이므로, WP1은 음수 고도를 가질 수 없습니다. 이는 의도된 동작입니다 (WP1 = 출발 지점 지면).