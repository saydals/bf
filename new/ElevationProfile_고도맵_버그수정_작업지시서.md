# ElevationProfile.vue 고도맵(Terrain) 미표시 버그 수정 작업지시서

## 1. 문제 개요

| 항목 | 내용 |
|------|------|
| **대상 파일** | `ElevationProfile.vue` (Vue 3 SFC, `<script setup>`) |
| **증상** | 비행계획에서 WP(웨이포인트)를 생성해도 지형 고도맵(Terrain area/line)이 SVG에 표시되지 않음 |
| **API 상태** | `https://api.opentopodata.org/v1/srtm90m` 정상 작동 확인됨 (HTTP 200, 유효 elevation 반환) |
| **핵심 원인** | `ref(new Map())`의 Vue 3 반응형(Reactivity) 한계로 인해 `computed` 속성이 Map `.set()` 변경을 감지하지 못함 |

---

## 2. 원인 분석 (상세)

### 2-1. 데이터 흐름

```
WP 생성/변경
  → watch() 트리거 (deep: true, immediate: true)
    → debouncedFetchGroundElevation() (400ms debounce)
      → fetchGroundElevation()
        → partitionSegments()        // 캐시되지 않은 세그먼트 식별
        → generateSegmentSamples()   // 세그먼트별 샘플 좌표 생성
        → fetchElevationBatches()    // OpenTopoData API 호출
        → cacheAndMergeSamples()     // ★ segmentCache.value.set() 호출
          → [의도] currentTerrainSamples computed 재평가
            → terrainLinePath / terrainAreaPath computed 재계산
              → SVG <path> 렌더링
```

### 2-2. 버그 발생 지점

**230번 줄:**
```js
const segmentCache = ref(new Map());
```

Vue 3에서 `ref()`로 `Map`을 래핑하면, `.set()` 호출 시 내부 `computed`가 의존성 변화를 감지하지 못하는 케이스가 존재합니다. 특히:

- `computed` 내부에서 **동적으로 계산된 키**로 `.get()`을 호출할 때
- `computed`가 `waypoints.value`(다른 반응형 소스)와 `segmentCache.value`(Map) **두 가지에 동시에 의존**할 때
- `.set()`이 `async` 함수(`fetchGroundElevation`) 내부에서 호출될 때 타이밍 이슈

결과적으로 `cacheAndMergeSamples()`에서 `segmentCache.value.set(segmentKey, data)`를 호출해도, `currentTerrainSamples` computed가 재평가되지 않아 **항상 초기값(elevation: 0)이 유지**됩니다.

### 2-3. 증상의 구체적 양상

- 비행 경로 라인(elevation-line)과 영역(elevation-area)은 **정상 표시**됨 (WP 데이터 직접 사용)
- 지형 라인(terrain-line)과 지형 영역(terrain-area)이 **표시되지 않거나 elevation 0에 그려짐**
- `currentTerrainSamples` computed는 항상 캐시 미스 상태의 fallback 데이터(elevation: 0)를 반환
- 브라우저 개발자 도구 Console에서 `[Elevation] Fetching...` / `[Elevation] Completed:` 로그는 **정상 출력**됨 (API 호출 자체는 성공)

---

## 3. 수정 지침

### 3-1. 수정 전략

`ref(new Map())`을 **`reactive(new Map())`**으로 변경합니다.

Vue 3에서 `reactive()`는 Proxy를 직접 Map에 적용하여 `.get()/.set()/.has()/.delete()` 및 `.size`의 모든 변경을 정확히 추적합니다. 반면 `ref()`는 내부적으로 `reactive()`를 거치지만, `Map`/`Set` 같은 컬렉션 타입에서는 의존성 추적이 불완전할 수 있습니다.

### 3-2. 수정 목록 (총 4处)

#### 수정 1: `segmentCache` 선언 (230번 줄 근처)

```diff
- const segmentCache = ref(new Map());
+ const segmentCache = reactive(new Map());
```

#### 수정 2: `currentTerrainSamples` computed 내부 (319번 줄 근처)

```diff
- const cached = segmentCache.value.get(segmentKey);
+ const cached = segmentCache.get(segmentKey);
```

#### 수정 3: `hasSegmentMoved` 함수 내부 (957번 줄 근처)

```diff
- const cached = segmentCache.value.get(segmentKey);
+ const cached = segmentCache.get(segmentKey);
```

#### 수정 4: `cacheAndMergeSamples` 함수 내부 (1060번 줄 근처)

```diff
- segmentCache.value.set(segment.key, {
+ segmentCache.set(segment.key, {
      samples: segmentSamples,
      fromPos: { lat: segment.fromWp.latitude, lon: segment.fromWp.longitude },
      toPos: { lat: segment.toWp.latitude, lon: segment.toWp.longitude },
      distance: segment.segmentDistance,
  });
```

### 3-3. import 문 변경 (194번 줄)

`reactive`가 이미 import되어 있는지 확인합니다. 기존 import:

```js
import { ref, computed, watch } from "vue";
```

다음으로 변경:

```diff
- import { ref, computed, watch } from "vue";
+ import { ref, computed, watch, reactive } from "vue";
```

---

## 4. 수정 후 전체 관련 코드 (참고용)

수정이 완료된 후, 다음 코드 블록들이 올바르게 변경되었는지 확인하세요.

### 4-1. import 구역

```js
import { ref, computed, watch, reactive } from "vue";
import { debounce } from "lodash-es";
import UiBox from "@/components/elements/UiBox.vue";
import { useFlightPlan } from "@/composables/useFlightPlan";
import { useSettingsStore } from "@/stores/settings";
```

### 4-2. segmentCache 선언

```js
// Segment-level caching for terrain data
// Key: "uid1-uid2", Value: { samples: [...], fromPos: {lat, lon}, toPos: {lat, lon}, distance }
const segmentCache = reactive(new Map());
```

### 4-3. currentTerrainSamples computed (해당 부분만)

```js
const currentTerrainSamples = computed(() => {
    if (waypoints.value.length === 0) {
        return [];
    }

    const samples = [];
    let cumulativeDistance = 0;

    for (let i = 1; i < waypoints.value.length; i++) {
        const prevWp = waypoints.value[i - 1];
        const wp = waypoints.value[i];
        const segmentKey = getSegmentKey(prevWp.uid, wp.uid);
        const segmentDistance = calculateDistance(prevWp.latitude, prevWp.longitude, wp.latitude, wp.longitude);

        const cached = segmentCache.get(segmentKey);
        if (cached && cached.samples && cached.samples.length > 0) {
            const cachedDist = cached.distance || 1;
            for (const s of cached.samples) {
                const fraction = s.relativeDistance / cachedDist;
                samples.push({
                    latitude: s.latitude,
                    longitude: s.longitude,
                    distance: cumulativeDistance + fraction * segmentDistance,
                    elevation: s.elevation,
                });
            }
        } else {
            samples.push({
                latitude: prevWp.latitude,
                longitude: prevWp.longitude,
                distance: cumulativeDistance,
                elevation: 0,
            });
            samples.push({
                latitude: wp.latitude,
                longitude: wp.longitude,
                distance: cumulativeDistance + segmentDistance,
                elevation: 0,
            });
        }

        cumulativeDistance += segmentDistance;
    }

    return samples;
});
```

### 4-4. hasSegmentMoved 함수

```js
const hasSegmentMoved = (segmentKey, fromPos, toPos) => {
    const cached = segmentCache.get(segmentKey);
    if (!cached) {
        return true;
    }

    const tolerance = 0.000001;
    const fromMoved =
        Math.abs(cached.fromPos.lat - fromPos.lat) > tolerance ||
        Math.abs(cached.fromPos.lon - fromPos.lon) > tolerance;
    const toMoved =
        Math.abs(cached.toPos.lat - toPos.lat) > tolerance ||
        Math.abs(cached.toPos.lon - toPos.lon) > tolerance;

    return fromMoved || toMoved;
};
```

### 4-5. cacheAndMergeSamples 함수

```js
const cacheAndMergeSamples = (segmentSampleRanges, samplesToFetch, allElevations) => {
    for (const { segment, startIdx, endIdx } of segmentSampleRanges) {
        const segmentSamples = [];

        for (let j = startIdx; j < endIdx; j++) {
            const sample = samplesToFetch[j];
            const elevation = allElevations[j] ?? 0;

            segmentSamples.push({
                latitude: sample.latitude,
                longitude: sample.longitude,
                relativeDistance: sample.relativeDistance,
                elevation,
            });
        }

        segmentCache.set(segment.key, {
            samples: segmentSamples,
            fromPos: { lat: segment.fromWp.latitude, lon: segment.fromWp.longitude },
            toPos: { lat: segment.toWp.latitude, lon: segment.toWp.longitude },
            distance: segment.segmentDistance,
        });
    }
};
```

---

## 5. 검증 방법

### 5-1. 기본 동작 확인

1. 애플리케이션 실행 후 비행계획 탭 진입
2. 지도 위에 2개 이상의 WP 생성
3. 고도 프로파일 차트에서 **지형 영역(회색/진한 영역)**과 **지형 라인**이 SVG에 표시되는지 확인
4. 통계 영역의 "평균 지표고도" 및 "최대 지면표고" 값이 0이 아닌 실제 고도값인지 확인

### 5-2. 반응형 동작 확인

1. WP를 추가/삭제/이동할 때마다 지형 고도맵이 **실시간으로 갱신**되는지 확인
2. 기존 WP의 위치를 드래그하여 이동한 후, 지형 프로파일이 새 위치에 맞게 **재계산**되는지 확인
3. 브라우저 개발자 도구 Console에서 `[Elevation] Fetching...` 및 `[Elevation] Completed:` 로그 확인

### 5-3. Vue DevTools 확인 (권장)

1. Vue DevTools로 `ElevationProfile` 컴포넌트 선택
2. `currentTerrainSamples` computed 값 확인
   - API 응답 후 `elevation` 값이 0이 아닌 실제 고도(feet AMSL)로 채워져야 함
3. `segmentCache` (reactive Map) 확인
   - 세그먼트 키(`"uid1-uid2"`)가 존재하고, 각 세그먼트에 `samples` 배열이 있어야 함

### 5-4. 엣지 케이스 확인

| 케이스 | 예상 동작 |
|--------|----------|
| WP 1개만 생성 | 고도맵 미표시 (정상 - 세그먼트가 없음) |
| 매우 가까운 WP (거리 < 1m) | 샘플 0개, 시작/끝점만 표시 |
| SRTM 커버리지 외 지역 (위도 60°N 이상 등) | API가 null 반환 → elevation 0으로 폴백 |
| 네트워크 오류 시 | Console에 `[Elevation] Batch failed:` 출력, elevation 0으로 폴백 |

---

## 6. 주의사항

- `reactive(new Map())`은 Vue 3.0+에서 지원됩니다. 프로젝트의 Vue 버전이 3.0 미만인 경우 `shallowRef({})`와 수동 트리거(`triggerRef()`)를 대안으로 사용하세요.
- `lodash-es`의 `debounce`는 400ms로 설정되어 있으므로, WP 생성 후 **약 0.5초 이내**에 지형이 표시되어야 정상입니다.
- OpenTopoData API는 무료 서비스이므로, 과도한 요청(단시간에 수백 개 WP 생성) 시 rate limiting(429)이 발생할 수 있습니다. 이 경우 `delayBetweenBatches`(180ms) 값을 늘리는 것을 고려하세요.