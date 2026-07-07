# FlightPlan 탭 단위(Unit) 시스템 수정 작업 지시서

> **작업 대상 코드베이스**: `saydals/bf` (Betaflight Configurator 포크)
> **수정 범위**: `src/components/tabs/FlightPlan/` 및 연관 파일
> **수행 AI**: DeepSeek V4 Flash
> **작성일**: 2026-07-07
> **우선순위**: HIGH (기능 결함)

---

## 1. 작업 개요

### 1.1 문제 요약

FlightPlan 탭의 단위 시스템이 부분적으로만 구현되어 있어, 사용자가 하단 툴바의 **단위 토글 버튼(nm/ft/kt ↔ km/m/kmh)**을 눌러도 일부 창(Map, WaypointList, WaypointEditor, ElevationProfile의 일부 수치)은 단위가 전환되지 않는다. 또한 `ElevationProfile.vue`의 `formatAltitude()` / `formatSpeed()` 함수는 **입력 단위를 잘못 가정**하고 있어 표시되는 숫자 자체가 틀린 상태다.

### 1.2 목표

1. 단위 토글 버튼 클릭 시 **모든 자식 컴포넌트의 표시 단위가 즉시 일괄 전환**될 것.
2. `ElevationProfile.vue`의 단위 변환 수학 오류를 수정하여 표시값이 실제 물리량과 일치할 것.
3. `WaypointEditor.vue` 입력 필드에 **현재 단위 라벨**을 표시하고, 입력값을 storage 단위로 변환하여 저장할 것.
4. CLI 펌웨어 통신(`useFlightPlan.js`의 `loadFromFC` / `saveToFC`)은 **storage 단위가 변경되지 않으므로 영향을 받지 않도록** 보장할 것.

### 1.3 핵심 설계 원칙 (반드시 지킬 것)

> **Storage 단위는 항상 고정, Display 단위만 변환한다.**

| 항목 | Storage 단위 (변경 금지) | Display 단위 (nautical) | Display 단위 (metric) | CLI 프로토콜 단위 |
|---|---|---|---|---|
| altitude | **feet** | ft | m | cm |
| speed | **knots** | kt | km/h | cm/s |
| yaw_rate.speed | deg/s | °/s | °/s | deg/s |
| duration | minutes | min | min | deciseconds |
| distance (계산용) | meters (Haversine 결과) | nm | km | (CLI에 distance 없음) |

**이유**: CLI 변환 상수(`FEET_TO_CM`, `KNOTS_TO_CMS`, `MINUTES_TO_DECISECONDS`)는 storage 단위를 기준으로 작성되어 있다. Storage 단위를 바꾸면 CLI round-trip이 깨진다. 따라서 **storage는 ft/kt/min으로 고정**하고, 단위 토글은 순수하게 표시/입력 레이어에서만 변환을 수행한다.

---

## 2. 현재 코드 분석 (문제 진단)

### 2.1 단위 Store 현황

**파일**: `src/stores/settings.js` (정상 작동 중)

```js
const unitMode = ref(stored.unitMode ?? "nautical"); // "metric" | "nautical"
const altitudeUnit = ref(stored.altitudeUnit ?? "ft");  // "m" | "ft"
const distanceUnit = ref(stored.distanceUnit ?? "nm");  // "km" | "nm"
const speedUnit = ref(stored.speedUnit ?? "kt");        // "kmh" | "kt"

function toggleUnitMode() { /* nautical ↔ metric 전환, localStorage 자동 저장 */ }
```

✅ Store 자체는 정상. Pinia 반응성도 `watch([unitMode, ...], saveSettings)`로 자동 저장됨.

### 2.2 컴포넌트별 단위 구독 현황

| 컴포넌트 | `useSettingsStore` import | 단위 표시 방식 | 문제 여부 |
|---|---|---|---|
| `FlightPlanTab.vue` | ✅ 있음 | 토글 버튼 라벨 (`nm/ft/kt` ↔ `km/m/kmh`) | 정상 |
| `FlightPlanMap.vue` | ❌ 없음 | 단위 표시 없음 | 정상 (단위 사용 안 함) |
| `WaypointList.vue` | ❌ **없음** | **하드코딩 `ft`, `kts`, `min`, `°/s`** | 🐛 **버그** |
| `WaypointEditor.vue` | ❌ **없음** | 단위 라벨 없음, 변환 없음 | 🐛 **버그** |
| `ElevationProfile.vue` | ✅ 있음 | `formatAltitude/formatSpeed/formatDistance` 사용 | 🐛 **변환 수학 오류** |

### 2.3 `ElevationProfile.vue` 치명적 오류 상세

```js
// 현재 코드 (lines 276-288) — 잘못됨
const formatAltitude = (meters) => {
    if (settings.altitudeUnit === "ft") {
        return `${Math.round(meters * METERS_TO_FEET)}ft`;  // ❌ meters가 아니라 feet이 들어옴
    }
    return `${Math.round(meters)}m`;  // ❌ feet 값을 m로 표시
};

const formatSpeed = (ms) => {
    if (settings.speedUnit === "kt") {
        return `${(ms * METERS_TO_KNOTS).toFixed(1)}kt`;  // ❌ ms가 아니라 knots가 들어옴
    }
    return `${(ms * METERS_TO_KMH).toFixed(1)}km/h`;  // ❌ knots를 m/s로 취급
};
```

**호출부**:
- `formatAltitude(minAltitude.value)` ← `minAltitude`는 `waypoints.map(wp => wp.altitude)`의 최소값. `wp.altitude`는 **feet** (storage).
- `formatAltitude(tooltipData.altitude)` ← `tooltipData.altitude = wpData.altitude` 역시 **feet**.
- `formatSpeed(tooltipData.speed)` ← `tooltipData.speed = wpData.speed`. `wp.speed`는 **knots** (storage).

**결과**: 현재 화면에 표시되는 고도/속도 숫자는 **실제 물리량의 약 3.28배 / 1.94배**로 잘못 표시됨.

### 2.4 `WaypointList.vue` 하드코딩된 단위

```html
<!-- line 44 -->
{{ $t("flightPlanTypeAltChange") }} → {{ waypoint.altitude }}ft AMSL

<!-- line 53 -->
{{ waypoint.altitude }}ft AMSL - {{ waypoint.speed }}kts - ...
```

→ 사용자가 metric 모드로 전환해도 `ft`, `kts`가 그대로 표시됨.

### 2.5 `WaypointEditor.vue` 입력 단위 모호성

- 입력 필드 옆에 단위 라벨 없음.
- `form.altitude`에 사용자가 입력한 값이 그대로 storage에 저장됨.
- storage는 항상 feet/knots이므로, metric 모드에서 사용자가 "100"을 입력하면 100m가 아니라 **100ft로 저장됨**.
- `:max="50000"` (altitude), `:max="500"` (speed) — 단위 불분명.

### 2.6 CLI 연동 확인 결과

**파일**: `src/composables/useFlightPlan.js`

```js
const FEET_TO_CM = 30.48;           // ✅ 1 ft = 30.48 cm
const KNOTS_TO_CMS = 51.4444;        // ✅ 1 kt = 51.4444 cm/s
const MINUTES_TO_DECISECONDS = 600;  // ✅ 1 min = 600 ds

// saveToFC: altitude (ft) → cm, speed (kt) → cm/s, duration (min) → ds
// loadFromFC: 역방향 변환
```

✅ **CLI 변환은 정확함. 수정 불필요.** Storage 단위를 ft/kt/min으로 유지하는 한 CLI는 건드리지 않는다.

---

## 3. 수정 작업 계획

### 3.1 전체 아키텍처 (수정 후)

```
┌──────────────────────────────────────────────────────────────┐
│  src/stores/settings.js  (Pinia store)                       │
│  - unitMode, altitudeUnit, distanceUnit, speedUnit           │
│  - 신규: altToDisplay(), altFromDisplay(),                   │
│          speedToDisplay(), speedFromDisplay(),               │
│          formatAltitude(), formatSpeed(), formatDistance(),  │
│          altitudeSymbol, speedSymbol, distanceSymbol         │
└──────────────────────────────────────────────────────────────┘
              ↑ Pinia reactive ↓
┌──────────────────────────────────────────────────────────────┐
│  모든 FlightPlan/* 컴포넌트는 settings store의 converter 사용 │
│  - WaypointList.vue: formatAltitude/formatSpeed로 표시       │
│  - WaypointEditor.vue: symbol 라벨 + fromDisplay 변환        │
│  - ElevationProfile.vue: 기존 format* 함수 제거, store 사용  │
└──────────────────────────────────────────────────────────────┘
              ↓ 저장 (항상 ft/kt/min)
┌──────────────────────────────────────────────────────────────┐
│  src/composables/useFlightPlan.js  (storage layer)           │
│  - 변경 없음. storage 단위 고정.                              │
│  - CLI 변환 (FEET_TO_CM, KNOTS_TO_CMS) 그대로 유지.          │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 작업 순서

1. **Task A**: `src/stores/settings.js`에 단위 변환 헬퍼 추가
2. **Task B**: `src/components/tabs/FlightPlan/WaypointList.vue` 하드코딩 단위 제거
3. **Task C**: `src/components/tabs/FlightPlan/WaypointEditor.vue` 단위 라벨 + 변환 추가
4. **Task D**: `src/components/tabs/FlightPlan/ElevationProfile.vue` 변환 수학 수정
5. **Task E**: `src/components/tabs/FlightPlanTab.vue` 라벨 다이내믹화 (선택)
6. **Task F**: 검증 (단위 전환 시나리오 테스트)

---

## 4. 상세 작업 지시 (Task별)

### Task A: `src/stores/settings.js` 단위 변환 헬퍼 추가

**목적**: 모든 컴포넌트가 공유하는 단일 변환 함수를 store에 두어 중복을 제거하고 일관성을 보장한다.

**수정 사항**: 기존 코드를 유지하면서 아래 내용을 **추가**한다.

```js
import { defineStore } from "pinia";
import { ref, watch, computed } from "vue";

const STORAGE_KEY = "bfSettings";

// 단위 변환 상수 (storage 단위 ↔ display 단위)
// Storage는 항상 ft(altitude), knots(speed), minutes(duration)로 고정.
const FT_TO_M = 0.3048;
const M_TO_FT = 1 / 0.3048;
const KT_TO_KMH = 1.852;
const KMH_TO_KT = 1 / 1.852;
const M_TO_NM = 1 / 1852;
const M_TO_KM = 1 / 1000;

export const useSettingsStore = defineStore("settings", () => {
    // [기존 코드 그대로 유지: stored, unitMode, altitudeUnit, distanceUnit,
    //  speedUnit, saveSettings, watch, toggleUnitMode]

    // ─── 신규: 단위 심볼 (라벨용) ───
    const altitudeSymbol = computed(() => (altitudeUnit.value === "ft" ? "ft" : "m"));
    const speedSymbol = computed(() => (speedUnit.value === "kt" ? "kt" : "km/h"));
    const distanceSymbol = computed(() => (distanceUnit.value === "nm" ? "nm" : "km"));

    // ─── 신규: storage → display 변환 ───
    // altitude: 항상 feet(storage) → display 단위
    function altToDisplay(feet) {
        if (!Number.isFinite(feet)) return 0;
        return altitudeUnit.value === "ft" ? feet : feet * FT_TO_M;
    }

    // speed: 항상 knots(storage) → display 단위
    // (yaw_rate 타입의 speed는 deg/s이므로 이 함수를 사용하지 말 것)
    function speedToDisplay(knots) {
        if (!Number.isFinite(knots)) return 0;
        return speedUnit.value === "kt" ? knots : knots * KT_TO_KMH;
    }

    // distance: 항상 meters(계산 결과) → display 단위
    function distanceToDisplay(meters) {
        if (!Number.isFinite(meters)) return 0;
        return distanceUnit.value === "nm" ? meters * M_TO_NM : meters * M_TO_KM;
    }

    // ─── 신규: display → storage 변환 (입력값 저장 시) ───
    // altitude: display 단위 → feet(storage)
    function altFromDisplay(displayValue) {
        if (!Number.isFinite(displayValue)) return 0;
        return altitudeUnit.value === "ft" ? displayValue : displayValue * M_TO_FT;
    }

    // speed: display 단위 → knots(storage)
    function speedFromDisplay(displayValue) {
        if (!Number.isFinite(displayValue)) return 0;
        return speedUnit.value === "kt" ? displayValue : displayValue * KMH_TO_KT;
    }

    // ─── 신규: 포맷팅 헬퍼 (표시용 문자열 반환) ───
    function formatAltitude(feet, decimals = 0) {
        const val = altToDisplay(feet);
        return `${val.toFixed(decimals)}${altitudeSymbol.value}`;
    }

    function formatSpeed(knots, decimals = 1) {
        const val = speedToDisplay(knots);
        return `${val.toFixed(decimals)}${speedSymbol.value}`;
    }

    function formatDistance(meters, decimals = 2) {
        const val = distanceToDisplay(meters);
        return `${val.toFixed(decimals)}${distanceSymbol.value}`;
    }

    return {
        // 기존 반환값 유지
        unitMode, altitudeUnit, distanceUnit, speedUnit,
        toggleUnitMode, saveSettings,
        // 신규 반환값
        altitudeSymbol, speedSymbol, distanceSymbol,
        altToDisplay, speedToDisplay, distanceToDisplay,
        altFromDisplay, speedFromDisplay,
        formatAltitude, formatSpeed, formatDistance,
    };
});
```

**검증 포인트**:
- 기존 반환값은 그대로 유지하여 다른 컴포넌트 호환성 보장.
- `yaw_rate` 타입의 speed (deg/s)는 `speedToDisplay`를 사용하지 않고 그대로 표시 (별도 라벨 `°/s`).

---

### Task B: `src/components/tabs/FlightPlan/WaypointList.vue` 수정

**목적**: 하드코딩된 `ft`, `kts` 단위를 store 기반 포매터로 교체.

**수정 1**: script setup에 settings store import 추가

```js
// 파일 상단 import 블록에 추가
import { useSettingsStore } from "@/stores/settings";

// 기존 useFlightPlan() 아래에 추가
const settings = useSettingsStore();
```

**수정 2**: template의 하드코딩 단위 제거 (lines 43-58)

**기존 코드**:
```html
<template v-if="waypoint.type === 'alt_change'">
    {{ $t("flightPlanTypeAltChange") }} → {{ waypoint.altitude }}ft AMSL
</template>
<template v-else-if="waypoint.type === 'delay'">
    {{ $t("flightPlanTypeDelay") }}: {{ waypoint.duration }}min
</template>
<template v-else-if="waypoint.type === 'yaw_rate'">
    {{ $t("flightPlanTypeYawRate") }}: {{ waypoint.speed }}°/s
</template>
<template v-else>
    {{ waypoint.altitude }}ft AMSL - {{ waypoint.speed }}kts -
    {{ getWaypointTypeLabel(waypoint.type) }}
    <span v-if="waypoint.type === 'hold'" class="hold-details">
        ({{ waypoint.duration }}min, {{ getPatternLabel(waypoint.pattern) }})
    </span>
</template>
```

**수정 후**:
```html
<template v-if="waypoint.type === 'alt_change'">
    {{ $t("flightPlanTypeAltChange") }} → {{ settings.formatAltitude(waypoint.altitude) }} AMSL
</template>
<template v-else-if="waypoint.type === 'delay'">
    {{ $t("flightPlanTypeDelay") }}: {{ waypoint.duration }} min
</template>
<template v-else-if="waypoint.type === 'yaw_rate'">
    {{ $t("flightPlanTypeYawRate") }}: {{ waypoint.speed }} °/s
</template>
<template v-else>
    {{ settings.formatAltitude(waypoint.altitude) }} AMSL - {{ settings.formatSpeed(waypoint.speed) }} -
    {{ getWaypointTypeLabel(waypoint.type) }}
    <span v-if="waypoint.type === 'hold'" class="hold-details">
        ({{ waypoint.duration }} min, {{ getPatternLabel(waypoint.pattern) }})
    </span>
</template>
```

**주의**:
- `yaw_rate`의 `°/s`는 단위 전환 대상이 아님 (항상 deg/s). 그대로 유지.
- `duration`의 `min`은 항상 분 단위 (메트릭/해리 모드 모두). 그대로 유지하되 가독성을 위해 스페이스 추가.
- `formatAltitude`는 정수 반올림(`decimals=0`), `formatSpeed`는 소수점 1자리(`decimals=1`)가 기본값. 필요시 인자로 조정.

---

### Task C: `src/components/tabs/FlightPlan/WaypointEditor.vue` 수정

**목적**: 입력 필드에 단위 라벨 표시, 입력값을 display 단위 ↔ storage 단위로 변환.

**수정 1**: settings store import

```js
// script setup 상단 import에 추가
import { useSettingsStore } from "@/stores/settings";

// useFlightPlan 아래에 추가
const settings = useSettingsStore();

// 디스플레이 단위에 따른 입력 범위 계산 (storage 기준 max를 display로 변환)
const altitudeMax = computed(() => {
    // storage max: 50000 ft
    return Math.ceil(settings.altToDisplay(50000));
});
const speedMax = computed(() => {
    // storage max: 500 knots
    return Math.ceil(settings.speedToDisplay(500));
});
```

**수정 2**: template의 altitude / speed 필드에 단위 라벨과 동적 max 추가

**기존 altitude 필드**:
```html
<SettingRow v-if="showAltitude" :label="$t('flightPlanAltitude')" full-width>
    <UInputNumber
        v-model="form.altitude"
        :step="1"
        :min="0"
        :max="50000"
        required
        :aria-label="$t('flightPlanAltitude')"
        class="w-48"
    />
</SettingRow>
```

**수정 후**:
```html
<SettingRow v-if="showAltitude" :label="`${$t('flightPlanAltitude')} (${settings.altitudeSymbol})`" full-width>
    <UInputNumber
        v-model="form.altitude"
        :step="1"
        :min="0"
        :max="altitudeMax"
        required
        :aria-label="$t('flightPlanAltitude')"
        class="w-48"
    />
</SettingRow>
```

**기존 speed 필드**:
```html
<SettingRow v-if="showSpeed" :label="$t('flightPlanSpeed')" full-width>
    <UInputNumber
        v-model="form.speed"
        :step="0.1"
        :min="0"
        :max="500"
        required
        :aria-label="$t('flightPlanSpeed')"
        class="w-48"
    />
</SettingRow>
```

**수정 후**:
```html
<SettingRow v-if="showSpeed" :label="`${$t('flightPlanSpeed')} (${settings.speedSymbol})`" full-width>
    <UInputNumber
        v-model="form.speed"
        :step="0.1"
        :min="0"
        :max="speedMax"
        required
        :aria-label="$t('flightPlanSpeed')"
        class="w-48"
    />
</SettingRow>
```

**수정 3**: `form` 상태를 display 단위로 유지하고 저장 시 storage 단위로 변환

**핵심 로직 변경**: `form.altitude`와 `form.speed`는 **사용자가 보는 display 단위**를 저장하고, `handleSave()`에서 storage 단위로 변환하여 `addWaypoint` / `updateWaypoint`에 전달한다. 반대로 edit 모드 진입 시에는 storage → display로 변환해서 `form`에 채운다.

**기존 form 초기값**:
```js
const form = reactive({
    latitude: 0,
    longitude: 0,
    altitude: 400,   // ❌ 단위 모호 (storage는 ft, 사용자는 모름)
    speed: 10,       // ❌ 단위 모호 (storage는 kt)
    type: "flyover",
    duration: 1,
    pattern: "circle",
});
```

**수정 후 form 초기값** (display 단위 기준):
```js
const form = reactive({
    latitude: 0,
    longitude: 0,
    altitude: 400,   // display 단위 (초기엔 nautical이므로 ft)
    speed: 10,       // display 단위 (초기엔 nautical이므로 kt)
    type: "flyover",
    duration: 1,
    pattern: "circle",
});
```

**기존 watch(editingWaypoint)**:
```js
watch(editingWaypoint, (waypoint) => {
    if (waypoint) {
        form.latitude = Number(waypoint.latitude.toFixed(6));
        form.longitude = Number(waypoint.longitude.toFixed(6));
        form.altitude = waypoint.altitude;   // storage → form (단위 변환 없음)
        form.speed = waypoint.speed;         // storage → form (단위 변환 없음)
        form.type = waypoint.type;
        form.duration = waypoint.duration;
        form.pattern = waypoint.pattern;
    }
});
```

**수정 후 watch(editingWaypoint)** — storage → display 변환 추가:
```js
watch(editingWaypoint, (waypoint) => {
    if (waypoint) {
        form.latitude = Number(waypoint.latitude.toFixed(6));
        form.longitude = Number(waypoint.longitude.toFixed(6));
        // storage(ft/kt) → display 단위로 변환하여 form에 채움
        form.altitude = Number(settings.altToDisplay(waypoint.altitude).toFixed(1));
        // yaw_rate 타입은 deg/s이므로 변환하지 않음
        form.speed = waypoint.type === "yaw_rate"
            ? waypoint.speed
            : Number(settings.speedToDisplay(waypoint.speed).toFixed(1));
        form.type = waypoint.type;
        form.duration = waypoint.duration;
        form.pattern = waypoint.pattern;
    }
});
```

**기존 buildPayload**:
```js
const buildPayload = () => {
    const base = { type: form.type, latitude: 0, longitude: 0, altitude: 0, speed: 0, duration: 0, pattern: "circle" };
    switch (form.type) {
        case "alt_change":
            return { ...base, altitude: form.altitude };
        case "delay":
            return { ...base, duration: form.duration };
        case "yaw_rate":
            return { ...base, speed: form.speed };
        case "hold":
            return {
                ...base,
                latitude: form.latitude,
                longitude: form.longitude,
                altitude: form.altitude,
                speed: form.speed,
                duration: form.duration,
                pattern: form.pattern,
            };
        default:
            return {
                ...base,
                latitude: form.latitude,
                longitude: form.longitude,
                altitude: form.altitude,
                speed: form.speed,
            };
    }
};
```

**수정 후 buildPayload** — display → storage 변환 추가:
```js
const buildPayload = () => {
    // form의 altitude/speed는 display 단위. storage(ft/kt)로 변환.
    const altitudeStorage = settings.altFromDisplay(form.altitude);
    // yaw_rate 타입의 speed는 deg/s이므로 변환하지 않음
    const speedStorage = form.type === "yaw_rate" ? form.speed : settings.speedFromDisplay(form.speed);

    const base = {
        type: form.type,
        latitude: 0,
        longitude: 0,
        altitude: 0,
        speed: 0,
        duration: 0,
        pattern: "circle",
    };

    switch (form.type) {
        case "alt_change":
            return { ...base, altitude: altitudeStorage };
        case "delay":
            return { ...base, duration: form.duration };
        case "yaw_rate":
            return { ...base, speed: speedStorage };
        case "hold":
            return {
                ...base,
                latitude: form.latitude,
                longitude: form.longitude,
                altitude: altitudeStorage,
                speed: speedStorage,
                duration: form.duration,
                pattern: form.pattern,
            };
        default:
            return {
                ...base,
                latitude: form.latitude,
                longitude: form.longitude,
                altitude: altitudeStorage,
                speed: speedStorage,
            };
    }
};
```

**수정 4**: `resetForm`도 display 단위 기준 기본값으로 수정

```js
const resetForm = () => {
    form.latitude = 0;
    form.longitude = 0;
    // storage 기본값 400ft, 10kt을 display 단위로 변환
    form.altitude = Number(settings.altToDisplay(400).toFixed(1));
    form.speed = Number(settings.speedToDisplay(10).toFixed(1));
    form.type = "flyover";
    form.duration = 1;
    form.pattern = "circle";
};
```

**검증 포인트**:
- 사용자가 metric 모드에서 "120"을 altitude에 입력 → `altFromDisplay(120)` = `120 * M_TO_FT` ≈ 393.7 ft → storage에 393.7 저장.
- 동일 웨이포인트를 다시 열면 `altToDisplay(393.7)` = `393.7 * FT_TO_M` = 120 m → form에 120 표시. ✅
- yaw_rate 모드에서는 speed가 deg/s이므로 변환을 건너뛰는 분기가 반드시 포함되어야 함.

---

### Task D: `src/components/tabs/FlightPlan/ElevationProfile.vue` 수정

**목적**: `formatAltitude` / `formatSpeed`의 단위 가정 오류 수정. 로컬 함수를 제거하고 store의 converter를 사용.

**수정 1**: 로컬 변환 상수 및 함수 제거

**제거할 코드 (lines 216-299 범위 내)**:
```js
// 제거 대상:
const METERS_TO_FEET = 3.28084;
const METERS_TO_NAUTICAL_MILES = 1 / 1852;
const METERS_TO_KMH = 3.6;
const METERS_TO_KNOTS = 1.94384;

const formatAltitude = (meters) => { ... };   // ❌ 잘못된 가정
const formatSpeed = (ms) => { ... };           // ❌ 잘못된 가정
const formatDistance = (meters) => { ... };    // ✅ 정상이지만 store로 이관
```

**대체**: settings store의 converter 사용. template에서 `formatAltitude(...)` 호출을 `settings.formatAltitude(...)`로 교체.

**주의**: `METERS_TO_NAUTICAL_MILES`는 `totalFlightTime` 계산에서도 사용되므로, 해당 계산식에서도 store 헬퍼를 사용하거나 로컬 상수를 `totalFlightTime` 계산용으로만 별도 유지.

**수정 2**: `minAltitude` / `maxAltitude` 주석 수정 및 일관성 확보

**기존 코드 (lines 346-358)**:
```js
// Min and max altitude (already in feet from waypoint data)
const minAltitude = computed(() => {
    if (waypoints.value.length === 0) return 0;
    return Math.round(Math.min(...waypoints.value.map((wp) => wp.altitude)));
});

const maxAltitude = computed(() => {
    if (waypoints.value.length === 0) return 0;
    return Math.round(Math.max(...waypoints.value.map((wp) => wp.altitude)));
});
```

→ 이 값들은 **feet(storage)** 단위. `formatAltitude`에 전달하면 store의 `altToDisplay(feet)`가 올바르게 변환함. ✅ (함수 시그니처가 올바른 converter로 교체되었으므로.)

**수정 3**: `maxGroundElevation` 단위 정규화

**문제**: `terrainSamples`의 `elevation` 값이 지형 API(Open-Elevation, Open-Meteo 등)에서 오는데, **대부분 meters**를 반환한다. 그런데 `combinedMax`에서 `maxAltitude` (feet)와 `maxGroundElevation` (meters)를 직접 `Math.max`로 비교 → 단위 불일치.

**해결**: terrain 샘플을 fetch하는 곳에서 elevation을 **feet로 변환**하여 저장하거나, `maxGroundElevation` computed에서 변환.

**선호 방식** — terrain fetch 함수에서 변환 (terrain API 응답은 meters로 가정):

terrain fetch 함수를 찾아 (대략 lines 600-820 사이, `fetchElevationData` 또는 유사 이름), API 응답을 terrainSamples에 push하는 부분을 수정:

```js
// 기존 (가정):
terrainSamples.value.push({
    distance: ...,
    elevation: apiElevationMeters,   // ❌ meters
    lat: ...,
    lon: ...,
});

// 수정 후:
const FT_PER_M = 3.28084;
terrainSamples.value.push({
    distance: ...,
    elevation: apiElevationMeters * FT_PER_M,   // ✅ feet로 정규화 (storage 단위와 일치)
    lat: ...,
    lon: ...,
});
```

**또는** computed에서 변환 (덜 침습적):

```js
const FT_PER_M = 3.28084;
const maxGroundElevation = computed(() => {
    if (terrainSamples.value.length === 0) return 0;
    // terrain API는 meters 반환. storage와 비교하기 위해 feet로 변환.
    return Math.round(Math.max(...terrainSamples.value.map((s) => s.elevation * FT_PER_M)));
});
```

→ terrain fetch 코드를 수정하기 어려우면 computed 변환 방식을 선택. 단, terrain 차트를 그리는 부문(`terrainLinePath`, `terrainAreaPath`)에서 `scaleY(sample.elevation)`을 호출하는데, 이때 `elevation`이 meters라면 차트도 어긋남. 따라서 **fetch 시점에 feet로 변환하는 방식 권장**.

**수정 4**: `totalFlightTime` 계산 — storage 단위 명시

**기존 코드 (lines 370-406)**:
```js
const totalFlightTime = computed(() => {
    if (waypoints.value.length < 2) return "0:00";

    let totalHours = 0;
    for (let i = 0; i < waypoints.value.length - 1; i++) {
        const wp = waypoints.value[i];
        const nextWp = waypoints.value[i + 1];

        const distanceMeters = calculateDistance(wp.latitude, wp.longitude, nextWp.latitude, nextWp.longitude);
        const distanceNM = distanceMeters * METERS_TO_NAUTICAL_MILES;

        const speed = (wp.speed ?? 10) <= 0 ? 1 : (wp.speed ?? 10);
        const segmentTime = distanceNM / speed;
        totalHours += segmentTime;
    }
    // ... format as h:mm
});
```

**현재 동작**: `wp.speed`는 storage의 knots. `distanceNM`은 meters → NM. `segmentTime = NM / knots = hours`. **수학적으로 정확함.** ✅

**권장 수정**: storage 단위 의존성을 명시적으로 만들어 향후 유지보수성 향상. 단, **기능 변경 없음**.

```js
const totalFlightTime = computed(() => {
    if (waypoints.value.length < 2) return "0:00";

    let totalSeconds = 0;
    const MS_PER_KM = 1000;
    const KMH_PER_KT = 1.852;

    for (let i = 0; i < waypoints.value.length - 1; i++) {
        const wp = waypoints.value[i];
        const nextWp = waypoints.value[i + 1];

        const distanceMeters = calculateDistance(wp.latitude, wp.longitude, nextWp.latitude, nextWp.longitude);
        const distanceKm = distanceMeters / MS_PER_KM;

        // storage speed는 knots. km/h로 변환하여 km/kmh = hours 계산.
        const speedKmh = (wp.speed ?? 10) * KMH_PER_KT;
        if (speedKmh <= 0) continue;

        totalSeconds += (distanceKm / speedKmh) * 3600;
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.round((totalSeconds % 3600) / 60);
    return `${hours}:${minutes.toString().padStart(2, "0")}`;
});
```

→ 기존 계산과 동일한 결과지만, meters/km/kmh 기반이라 metric display와 일관됨. **기능 변경 없음, 선택 사항**.

**수정 5**: Y-axis tick label 단위 정규화

**기존 코드 (line 52 템플릿)**:
```html
{{ formatAltitude(tick.value) }}
```

→ `tick.value`는 `combinedMax` 기반으로 계산된 값. `combinedMax = Math.max(maxAltitude, maxGroundElevation)`. Task D-3에서 두 값 모두 feet로 정규화했으므로 `tick.value`도 feet. `settings.formatAltitude(feet)` 호출로 올바르게 변환됨. ✅

**수정 6**: tooltip 단위 정규화

**기존 코드 (lines 164-165)**:
```html
<div><span v-html="$t('flightPlanAlt')"></span>: {{ formatAltitude(tooltipData.altitude) }}</div>
<div><span v-html="$t('flightPlanSpeed')"></span>: {{ formatSpeed(tooltipData.speed) }}</div>
```

→ `tooltipData.altitude`와 `tooltipData.speed`는 `wp.altitude`(feet)와 `wp.speed`(knots)에서 옴 (line 591-592 참조). store의 `formatAltitude(feet)` / `formatSpeed(knots)` 호출로 교체:

```html
<div><span v-html="$t('flightPlanAlt')"></span>: {{ settings.formatAltitude(tooltipData.altitude) }}</div>
<div><span v-html="$t('flightPlanSpeed')"></span>: {{ settings.formatSpeed(tooltipData.speed) }}</div>
```

**수정 7**: template 내 모든 `formatDistance`, `formatAltitude`, `formatSpeed` 호출을 `settings.formatDistance` 등으로 교체

검색 대상 라인: 6, 12, 15, 18, 21, 52, 75, 164, 165. 각각 `settings.` prefix 추가.

**검증 포인트**:
- nautical 모드: 1000ft 웨이포인트 → `formatAltitude(1000)` = "1000ft" ✅
- metric 모드: 1000ft 웨이포인트 → `formatAltitude(1000)` = `1000 * 0.3048`.toFixed(0) + "m" = "305m" ✅
- metric 모드에서 30kt 속도 → `formatSpeed(30)` = `(30 * 1.852).toFixed(1)` + "km/h" = "55.6km/h" ✅

---

### Task E (선택): `src/components/tabs/FlightPlanTab.vue` 라벨 다이내믹화

**현재 코드 (line 75)**:
```html
:label="settings.unitMode === 'nautical' ? '🧭 nm/ft/kt' : '⚡ km/m/kmh'"
```

→ 이미 동적이므로 변경 불필요. 다만 아이콘/텍스트 개선을 원할 경우:

```html
:label="settings.unitMode === 'nautical' ? '🧭 Nautical (nm/ft/kt)' : '⚡ Metric (km/m/km/h)'"
```

**선택 사항이며 기능에는 영향 없음.**

---

## 5. CLI 연동 보존 검증 (중요)

### 5.1 변경 후에도 CLI가 깨지지 않는지 확인

**시나리오**: 사용자가 metric 모드에서 altitude=120m, speed=50km/h를 입력하고 FC에 저장.

1. `WaypointEditor.handleSave()` → `buildPayload()` 호출
2. `altFromDisplay(120)` = `120 * (1/0.3048)` = 393.7 ft (storage)
3. `speedFromDisplay(50)` = `50 * (1/1.852)` = 27.0 kt (storage)
4. `addWaypoint({altitude: 393.7, speed: 27.0, ...})` → storage에 저장
5. `saveToFC()` → `waypointToCliCommand(wp, idx)`:
   - `altCm = Math.round(393.7 * 30.48)` = 11999 cm ✅ (≈120m)
   - `speedRaw = Math.round(27.0 * 51.4444)` = 1389 cm/s ✅ (≈50km/h)
6. CLI 명령: `waypoint insert 0 ... 11999 1389 ...`

**역방향 (FC → UI)**:
1. `loadFromFC()` → `parseWaypointLine(line)`:
   - `altitude = Math.round(11999 / 30.48)` = 394 ft (storage) ✅
   - `speed = Math.round((1389 / 51.4444) * 10) / 10` = 27.0 kt (storage) ✅
2. `WaypointEditor` edit 모드 진입:
   - `form.altitude = altToDisplay(394)` = `394 * 0.3048` = 120.1 m ✅
   - `form.speed = speedToDisplay(27.0)` = `27.0 * 1.852` = 50.0 km/h ✅

→ **CLI round-trip이 정확히 보존됨.** ✅

### 5.2 단위 토글 후 CLI 재저장 시나리오

1. nautical 모드에서 400ft, 20kt 입력 → storage: 400ft, 20kt
2. metric 모드로 전환 → editor에 121.9m, 37.0km/h 표시
3. 아무것도 수정하지 않고 다시 저장 → `altFromDisplay(121.9)` = 400.0ft, `speedFromDisplay(37.0)` = 20.0kt → 동일 storage 값
4. CLI 동일 명령 전송 → FC에 동일 데이터 ✅

→ **단위 토글만으로 데이터가 변형되지 않음.** ✅

---

## 6. 검증 체크리스트 (DeepSeek V4 Flash 완료 후 자체 점검)

### 6.1 기능 검증

- [ ] `npm run lint` 통과 (기존 ESLint 규칙 준수)
- [ ] `npm run build` (또는 `npm run dev`) 실행 시 컴파일 오류 없음
- [ ] FlightPlan 탭 진입 시 지도/목록/에디터/프로파일 정상 렌더링

### 6.2 단위 전환 검증

- [ ] 초기 상태 (nautical): WaypointList에 "400ft AMSL - 18.5kt" 형태로 표시
- [ ] 단위 버튼 클릭 → metric으로 전환 → 동일 웨이포인트가 "122m AMSL - 34.3km/h"로 표시
- [ ] 다시 클릭 → nautical으로 복귀 → 원래 값으로 복원 (부동소수점 오차 < 0.1)
- [ ] WaypointEditor: 라벨에 `(ft)` 또는 `(m)`, `(kt)` 또는 `(km/h)` 표시
- [ ] WaypointEditor: metric 모드에서 altitude=100 입력 후 저장 → storage에 약 328ft 저장 → 다시 열면 100m로 표시
- [ ] ElevationProfile: y축 라벨이 단위 전환에 따라 ft/m로 변경
- [ ] ElevationProfile: tooltip의 altitude/speed가 단위 전환에 따라 변경
- [ ] ElevationProfile: totalDistance가 nm/km로 전환
- [ ] ElevationProfile: totalFlightTime은 단위와 무관하게 동일 (시간은 단위 무관)

### 6.3 CLI 검증 (FC 연결 시)

- [ ] metric 모드에서 웨이포인트 3개 생성 후 FC에 save → `waypoint list` CLI 명령으로 확인 → altitude가 cm, speed가 cm/s로 정확히 저장됨
- [ ] FC에서 `waypoint list`로 불러오기 → metric 모드 UI에서 올바른 m/kmh 값 표시
- [ ] nautical ↔ metric 전환 후 FC 재저장 → CLI 값 동일 (데이터 무결성)

### 6.4 회귀 검증

- [ ] yaw_rate 타입 웨이포인트: speed 필드가 deg/s로 표시되고 단위 변환되지 않음
- [ ] delay 타입: duration이 항상 min으로 표시
- [ ] alt_change 타입: altitude만 표시, 단위 변환 정상
- [ ] localStorage 영속성: 페이지 새로고침 후에도 단위 설정 유지

---

## 7. 주의사항 및 금지 사항

### 7.1 금지 사항 (절대 하지 말 것)

1. **`useFlightPlan.js`의 storage 단위 변경 금지**: `FEET_TO_CM`, `KNOTS_TO_CMS`, `MINUTES_TO_DECISECONDS` 상수 및 `parseWaypointLine`, `waypointToCliCommand` 함수는 수정하지 않는다. Storage는 항상 ft/kt/min이다.

2. **`DEFAULT_ALTITUDE = 400`, `DEFAULT_SPEED = 10` 변경 금지**: 이 값들은 storage 단위(ft, kt) 기준이다.

3. **WaypointEditor에서 yaw_rate의 speed 변환 금지**: `yaw_rate` 타입의 speed는 deg/s이며, knots/kmh 변환 대상이 아니다. `form.type === "yaw_rate"` 분기로 변환을 건너뛴다.

4. **`duration` 단위 변환 금지**: duration은 항상 minutes이다. metric/nautical 모두에서 min으로 표시.

5. **latitude/longitude 변환 금지**: 항상 decimal degrees이다.

### 7.2 주의사항

1. **부동소수점 오차**: storage ↔ display 변환을 반복하면 오차가 누적될 수 있다. `toFixed(1)` 또는 `toFixed(6)`로 표시 소수점을 제한하고, storage에는 변환 결과를 그대로 저장한다 (사용자가 보는 값이 일관되게 유지되는 것이 더 중요).

2. **Pinia 반응성**: `settings.altitudeUnit` 등은 `ref`이므로 computed 내에서 참조하면 자동으로 반응한다. 컴포넌트 template에서 `settings.formatAltitude(...)`를 호출하면 `altitudeUnit` 변경 시 자동으로 재평가된다.

3. **기존 호환성**: `settings.js`의 기존 반환값(unitMode, altitudeUnit 등)은 다른 탭에서 사용 중일 수 있으므로 제거하지 않는다. 신규 함수만 추가한다.

4. **i18n 라벨**: 단위 라벨(`ft`, `m`, `kt`, `km/h`, `nm`, `km`)은 현재 하드코딩된 영어 축약형이다. i18n 메시지 키로 변환하는 것은 이번 작업 범위가 아니지만, 향후 확장 시 `settings.altitudeSymbol`이 번역 키를 반환하도록 변경하면 된다.

5. **UInputNumber 한계**: 단위 라벨을 입력 필드 우측에 inline으로 표시하는 것은 UInputNumber가 지원하지 않을 수 있다. SettingRow의 label에 단위를 포함시키는 방식을 사용한다.

---

## 8. 산출물

수정 완료 후 다음 파일들이 변경되어야 한다:

1. `src/stores/settings.js` — converter 함수 추가
2. `src/components/tabs/FlightPlan/WaypointList.vue` — 하드코딩 단위 제거
3. `src/components/tabs/FlightPlan/WaypointEditor.vue` — 단위 라벨 + 변환 추가
4. `src/components/tabs/FlightPlan/ElevationProfile.vue` — 변환 수학 수정

변경되지 않아야 하는 파일:
- `src/composables/useFlightPlan.js` (storage + CLI 변환)
- `src/components/tabs/FlightPlan/FlightPlanMap.vue` (단위 사용 없음)
- `src/components/tabs/FlightPlanTab.vue` (이미 정상 동작)

---

## 9. 완료 기준 (Definition of Done)

1. ✅ 본 문서의 모든 Task A~D가 구현됨
2. ✅ 검증 체크리스트(6절)의 모든 항목 통과
3. ✅ 단위 토글 버튼 클릭 시 4개 자식 컴포넌트 모두 즉시 단위 전환
4. ✅ CLI round-trip이 정확히 보존됨 (FEET_TO_CM, KNOTS_TO_CMS 상수 미변경)
5. ✅ 기존 localStorage에 저장된 웨이포인트가 단위 전환 후에도 올바르게 표시됨
6. ✅ `npm run lint` 통과

---

## 10. 참고 자료

- 단위 변환 상수 출처:
  - 1 ft = 0.3048 m (정확값, 국제 항공 표준)
  - 1 kt = 1.852 km/h (정확값, 국제 해사 표준)
  - 1 nm = 1852 m (정확값)
- Betaflight CLI waypoint 프로토콜: altitude(cm), speed(cm/s), duration(deciseconds), yaw_rate(deg/s)
- Pinia 반응성 문서: https://pinia.vuejs.org/api/computed-store

---

**작성자**: Super Z (분석 및 작업 지시)
**수행자**: DeepSeek V4 Flash (구현)
**검토자**: (사용자)
