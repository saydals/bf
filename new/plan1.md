# 표고 프로필(Elevation Profile) 수정 작업 지시서

> **작성일**: 2026-07-08  
> **대상 저장소**: `/home/betaflight/configurator/src/components/tabs/FlightPlan/`  
> **펌웨어 참조**: `/home/betaflight/autopilot/src/main/flight/`  
> **상대고도 기준**: 모든 고도는 WP1 지점의 지면을 0으로 하는 상대고도(AGL) 체계

---

## 전제 조건 및 배경

### 고도 체계 요약

| 용어 | 의미 |
|------|------|
| **해발고도 (AMSL)** | 평균 해수면 기준 절대고도 |
| **상대고도 (AGL)** | WP1 지면 기준의 기압계 고도 (시동 시점 = 0) |
| **상대지면표고** | 각 WP 위치의 해발고도에서 WP1 해발고도를 뺀 값 (음수 가능) |

### 핵심 원리
- 기압계 기반 FC는 시동 시점을 0으로 잡는 상대고도를 사용함 (`position.c` L221-223: `getAltitude()` → `zeroedAltitudeCm` 반환)
- 지도 API(Open Elevation)는 해발고도를 제공함
- **변환 공식**: `상대고도 = 해발고도(해당 지점) - 해발고도(WP1)`
- WP1은 홈포인트와 동일 해발고도로 가정 (사용자 주의사항)

### 펌웨어 음수 고도 처리 확인 결과

> **결론: 펌웨어는 음수 targetAltitudeCm을 정상 처리한다.**

근거:
1. `mission.h` L46: `float altitude;` — 부호 있는 float, 음수 제한 없음
2. `mission.c` L153: `rescueState.intent.targetAltitudeCm = wp->altitude;` — clamp 없이 직접 대입
3. `gps_rescue.c` L324-380: `calculateAltitudePitch()` — `altErrM` 연산이 부호 무관하게 동작. currentAltitudeCm이 targetAltitudeCm보다 높으면 양수 에러(하강), 낮으면 음수 에러(상승)
4. `position.c` L164: `zeroedAltitudeCm = gpsAltCm - gpsAltOffsetCm;` — 시동 지점보다 낮으면 음수 반환
5. OSD에서 음수 고도 표시 확인됨 (사용자 확인)

**따라서 WP2 이후의 고도는 음수를 허용해야 한다.**

---

## 문제 1: WP 포인트 드래그 시 즉시 따라오지 않는 문제

### 대상 파일
- `ElevationProfile.vue`

### 현재 동작 분석

#### 1-A. 상하 드래그 (고도 변경) — 지연 문제
- L730-743 `handleAltDragMove()`: `deltaY / 2`로 altitudeDelta를 계산하여 `updateWaypoint()` 호출
- **문제**: 드래그 중 SVG 좌표가 `profilePoints` → `scaledProfilePoints` computed 체인을 거쳐 갱신됨
- `profilePoints` (L358)는 `waypoints.value`에 대한 computed이므로 `updateWaypoint()`이 `waypoints` 상태를 변경하면 즉시 반응함
- 실제 지연 원인은 **`updateWaypoint()` 내부의 `savePlan()` 호출** (`useFlightPlan.js` L219)로 매 드래그 이벤트마다 `localStorage.setItem()`을 실행하여 동기 I/O 블로킹 발생

#### 1-B. 좌우 드래그 (속도 변경) — 포인트가 조금만 움직이는 것은 의도된 동작
- L747-766 `handleSpeedDragMove()`: **500ms 쓰로틀** (`now - lastMoveTime < 500`) 적용됨
- 좌우 드래그 시 포인트가 살짝 움직여야 속도 변경 중임을 시각적으로 표시
- 현재는 포인트 X 좌표 자체가 움직이지 않음 (속도 변경은 포인트 위치에 영향 없음)

#### 1-C. 드래그 방향 판별
- L697-705: `DRAG_DIRECTION_THRESHOLD` (10px) 이내에서는 동작 판별 중이므로 무반응
- 판별 후 `type`이 정해지면 한 축으로만 동작함 — 이 로직은 올바름

### 수정 지침

#### 수정 1-A: 드래그 중 savePlan 지연 실행 (debounce)

**파일**: `useFlightPlan.js`  
**위치**: `updateWaypoint()` 함수 (L205-222)

```
변경 사항:
1. 파일 상단에 드래그 중 savePlan을 지연시키는 debounce 타이머 변수 추가:
   let savePlanTimeout = null;

2. updateWaypoint() 내부에서 savePlan() 호출을 debounce 처리:
   - 기존: savePlan(); 
   - 변경: 
     if (savePlanTimeout) clearTimeout(savePlanTimeout);
     savePlanTimeout = setTimeout(() => { savePlan(); savePlanTimeout = null; }, 300);
   
   이렇게 하면 드래그 중에는 300ms 내에 다시 호출되면 이전 타이머가 취소되어
   localStorage 쓰기가 마지막 드래그 이벤트 후 300ms 후에 1번만 실행됨.
   Object.assign(waypoint, updates)는 즉시 실행되므로 Vue의 반응형 시스템은 즉시 갱신됨.
```

#### 수정 1-B: 좌우 드래그 시 포인트의 시각적 미세 이동 (속도 조절 피드백)

**파일**: `ElevationProfile.vue`  
**위치**: `handleSpeedDragMove()` (L747-766) 및 `scaledProfilePoints` (L504-510)

```
변경 사항:
1. dragState에 speedVisualOffsetX 속성 추가 (L337-345):
   dragState 초기값에 speedVisualOffsetX: 0 추가

2. handleSpeedDragMove() 내부에서 speedVisualOffsetX 계산:
   - 쓰로틀 검사 전에 시각적 오프셋 계산 (쓰로틀과 무관하게 즉시 반영)
   - const visualDeltaX = event.clientX - dragState.value.startX;
   - dragState.value.speedVisualOffsetX = Math.sign(visualDeltaX) * Math.min(Math.abs(visualDeltaX) * 0.1, 15);
     (실제 드래그량의 10%, 최대 15px로 제한)
   - 쓰로틀 이후 startX 리셋 시 speedVisualOffsetX도 0으로 리셋

3. scaledProfilePoints computed에서 드래그 중인 포인트에 오프셋 적용:
   - 기존: x: scaleX(point.distance)
   - 변경: x: scaleX(point.distance) + (dragState.value.active && dragState.value.type === 'speed' && point.uid === dragState.value.wpUid ? dragState.value.speedVisualOffsetX : 0)

4. handlePointerUp()에서 speedVisualOffsetX를 0으로 리셋
```

#### 수정 1-C: 쓰로틀 간격 축소

**파일**: `ElevationProfile.vue`  
**위치**: L749

```
변경 사항:
- 기존: if (now - dragState.value.lastMoveTime < 500) return;
- 변경: if (now - dragState.value.lastMoveTime < 200) return;

500ms에서 200ms로 줄여 속도 변경 반응성 향상.
값 변경의 실질적 빈도는 사용자가 드래그를 중심에서 벗어나 유지하는 시간에 비례.
```

---

## 문제 2: 음수 고도 처리

### 대상 파일
- `ElevationProfile.vue` (차트 렌더링)
- `useFlightPlan.js` (검증 로직)
- `WaypointEditor.vue` (입력 UI)

### 현재 동작 분석 — 음수 고도를 차단하는 지점들

| # | 파일 | 위치 | 현재 코드 | 문제 |
|---|------|------|-----------|------|
| A | `useFlightPlan.js` | L94, L119 | `waypointData.altitude < 0` → 거부 | WP2+ 음수 고도 불가 |
| B | `WaypointEditor.vue` | L36 | `:min="0"` | 입력 UI에서 0 미만 불가 |
| C | `ElevationProfile.vue` | L328 | `Math.max(0, groundAtPoint - wp1GroundElevation)` | minAllowedAGL이 항상 0 이상 |
| D | `ElevationProfile.vue` | L89, L97, L108, L116 | `v-if="groundElevation > 0"`, `v-if="maxGroundElevation > 0"` | 음수일 때 표시 안 됨 |
| E | `ElevationProfile.vue` | L464, L490-491 | `const min = 0; // Always start at sea level` | Y축 최소값이 항상 0 |

### 수정 지침

#### 수정 2-A: validateWaypoint 음수 고도 허용 (WP2+)

**파일**: `useFlightPlan.js`  
**위치**: L89-124 `validateWaypoint()` 함수

```
변경 사항:
1. L94의 alt_change 검증:
   - 기존: waypointData.altitude < 0
   - 변경: !Number.isFinite(waypointData.altitude)
   (alt_change는 절대 AGL 값을 설정하므로 음수 허용)

2. L119의 일반 waypoint 검증:
   - 기존: if (waypointData.altitude < 0) { ... return false; }
   - 변경: 이 블록 전체 삭제
   
   근거: 펌웨어가 음수 targetAltitudeCm을 정상 처리하므로 (위 분석 참조)
   음수 고도 제한을 해제해야 함. 
   다만 WP1의 고도는 0 이상이어야 함 (WP1이 기준점이므로).
   WP1 고도 제한은 addWaypoint()에서 order === 0일 때만 적용:
   
   // addWaypoint() 함수 내부 (L170 이후), waypoint 생성 직전에 추가:
   if (state.waypoints.length === 0 && waypointData.altitude < 0) {
       gui_log("WP1 altitude must be 0 or above (reference point)");
       return false;
   }
```

#### 수정 2-B: WaypointEditor 입력 범위 변경

**파일**: `WaypointEditor.vue`  
**위치**: L33-41 (altitude UInputNumber)

```
변경 사항:
- 기존: :min="0" :max="50000"
- 변경: :min="-5000" :max="50000"
  
  음수 입력 허용. -5000 feet ≈ -1524m로 충분한 범위.
  다만 WP1 편집 시에는 min=0 유지 필요.
  
  조건부 min 적용:
  - computed 속성 추가:
    const altitudeMin = computed(() => {
        if (editMode.value) {
            const wp = editingWaypoint.value;
            return wp && wp.order === 0 ? 0 : -5000;
        }
        return state.waypoints.length === 0 ? 0 : -5000;
    });
  - 템플릿: :min="altitudeMin"
  
  주의: 여기서 editingWaypoint는 이미 useFlightPlan()에서 import되어 있음 (L112).
  state 접근은 useFlightPlan.js 내부 state이므로 직접 접근 불가.
  대신 waypoints computed를 추가로 import하여 waypoints.value.length로 판별:
  
  const { ..., waypoints } = useFlightPlan();
  
  const altitudeMin = computed(() => {
      if (editMode.value && editingWaypoint.value) {
          return editingWaypoint.value.order === 0 ? 0 : -5000;
      }
      return waypoints.value.length === 0 ? 0 : -5000;
  });
```

#### 수정 2-C: minAllowedAGL 음수 허용

**파일**: `ElevationProfile.vue`  
**위치**: L322-331 `minAllowedAGL` computed

```
변경 사항:
- 기존 L328: result[point.uid] = Math.max(0, groundAtPoint - wp1GroundElevation.value);
- 변경: result[point.uid] = groundAtPoint - wp1GroundElevation.value;

  Math.max(0, ...) 제거. 상대지면표고가 음수일 수 있음.
  이 값은 드래그 시 최소 고도 제한으로 사용됨 (L737).
  기체가 지면 아래로 들어가지 않도록 "상대지면표고"를 최소값으로 사용하는 것이 맞음.
  
  예시: WP1이 해발 500m, WP3이 해발 400m인 경우
  - 상대지면표고 = 400 - 500 = -100m (WP1 기준)
  - WP3의 최소 AGL = -100m (지면에 닿는 고도)
  - WP3를 -50m로 설정하면 지면 위 50m에 있게 됨
```

#### 수정 2-D: 차트에서 음수 표고선 표시

**파일**: `ElevationProfile.vue`  
**위치**: L89, L97, L108, L116

```
변경 사항:
1. L89: v-if="groundElevation > 0" → v-if="terrainSamples.length > 0"
2. L97: v-if="groundElevation > 0" → v-if="terrainSamples.length > 0"  
3. L108: v-if="maxGroundElevation > 0" → v-if="terrainSamples.length > 0"
4. L116: v-if="maxGroundElevation > 0" → v-if="terrainSamples.length > 0"

  표고가 0보다 작아도 표시해야 함.
  terrainSamples가 존재하면 항상 표시.
```

#### 수정 2-E: Y축 스케일링 — 음수 고도 지원

**파일**: `ElevationProfile.vue`  
**위치**: L456-501

```
변경 사항:
1. combinedMax (L457-460): 변경 없음 (이미 올바름)

2. Y축 최소값 계산 추가 — combinedMin computed 추가:
   const combinedMin = computed(() => {
       const minAgl = profilePoints.value.length > 0 
           ? Math.min(...profilePoints.value.map(p => p.altitudeAMSL)) 
           : 0;
       const minTerrain = terrainSamples.value.length > 0
           ? Math.min(...terrainSamples.value.map(s => s.elevation))
           : 0;
       return Math.min(0, minAgl, minTerrain);
   });

3. yAxisTicks (L462-480):
   - L464: const min = 0; → const min = combinedMin.value;

4. scaleY (L489-501):
   - L490: const min = 0; → const min = combinedMin.value;
   
5. areaPath (L527-545):
   - L532: const baseY = chartHeight - padding.bottom; 
     이 부분은 변경 없음. 면적 채우기의 바닥선은 차트 하단 경계로 유지.
```

---

## 문제 3: 지면표고 표시 — 평균 → 각 WP별 상대지면표고

### 대상 파일
- `ElevationProfile.vue`

### 현재 동작 분석

- L972-974: `groundElevation`은 모든 terrainSample의 **평균 해발고도**를 계산
  ```js
  const sum = allSegmentSamples.reduce((acc, sample) => acc + sample.elevation, 0);
  groundElevation.value = Math.round(sum / allSegmentSamples.length);
  ```
- L410-415: `maxGroundElevation`도 해발고도 기준 최대값
- 두 값 모두 해발고도이며 WP1 기준 상대값이 아님

### 수정 지침

#### 수정 3-A: groundElevation → 선택된 WP의 상대지면표고

**파일**: `ElevationProfile.vue`  
**위치**: L210 `groundElevation` ref 선언 및 L972-974 갱신 로직

```
변경 사항:
1. groundElevation을 ref에서 computed로 변경:
   
   - 기존 (L210): const groundElevation = ref(0);
   - 변경: (ref 제거, 아래 computed 추가)

   const groundElevation = computed(() => {
       if (terrainSamples.value.length === 0 || profilePoints.value.length === 0) return 0;
       
       // 선택된 WP의 위치에서의 상대지면표고
       const selectedUid = selectedWaypointUid.value;
       const targetPoint = selectedUid 
           ? profilePoints.value.find(p => p.uid === selectedUid)
           : profilePoints.value[0]; // 선택 없으면 WP1
       
       if (!targetPoint) return 0;
       
       const groundAtPoint = getGroundElevAtPoint(targetPoint.distance); // 해발고도
       return Math.round(groundAtPoint - wp1GroundElevation.value); // 상대지면표고
   });

2. fetchGroundElevation() 내의 groundElevation.value 대입 부분 제거 (L972-975):
   - 기존:
     if (allSegmentSamples.length > 0) {
         const sum = allSegmentSamples.reduce(...);
         groundElevation.value = Math.round(sum / allSegmentSamples.length);
     }
   - 변경: 블록 전체 삭제 (groundElevation이 computed이므로 자동 갱신)

3. fetchGroundElevation()의 초기화 부분 (L950-951)에서도 삭제:
   - 기존: groundElevation.value = 0;
   - 변경: 삭제 (computed이므로 불필요)

4. catch 블록 (L979-982)에서도 삭제:
   - 기존: groundElevation.value = 0;
   - 변경: 삭제
```

#### 수정 3-B: maxGroundElevation → 상대 최대 지면표고

**파일**: `ElevationProfile.vue`  
**위치**: L410-415 `maxGroundElevation` computed

```
변경 사항:
- 기존:
  const maxGroundElevation = computed(() => {
      if (terrainSamples.value.length === 0) return 0;
      return Math.round(Math.max(...terrainSamples.value.map(sample => sample.elevation)));
  });

- 변경:
  const maxGroundElevation = computed(() => {
      if (terrainSamples.value.length === 0) return 0;
      const maxAbsolute = Math.max(...terrainSamples.value.map(sample => sample.elevation));
      return Math.round(maxAbsolute - wp1GroundElevation.value); // WP1 기준 상대값
  });
```

#### 수정 3-C: 평균 지면 표고 참조선 (그래프 내)

그래프 상의 "평균 지면 표고" 참조선 (L88-104)은 이미 그래프에 표시되고 있으므로 **유지**.  
단, 참조선은 해발고도 기준으로 scaleY에 전달되어야 하므로 별도 computed 필요:

**파일**: `ElevationProfile.vue`

```
변경 사항:
1. 평균 해발고도 computed 추가 (그래프 참조선 전용):
   const avgGroundElevationAMSL = computed(() => {
       if (terrainSamples.value.length === 0) return 0;
       const sum = terrainSamples.value.reduce((acc, s) => acc + s.elevation, 0);
       return Math.round(sum / terrainSamples.value.length);
   });

2. 참조선 (L88-104)에서 groundElevation 대신 avgGroundElevationAMSL 사용:
   - L91: :y1="scaleY(groundElevation)" → :y1="scaleY(avgGroundElevationAMSL)"
   - L93: :y2="scaleY(groundElevation)" → :y2="scaleY(avgGroundElevationAMSL)"
   - L98: :y="scaleY(groundElevation) - 3" → :y="scaleY(avgGroundElevationAMSL) - 3"
   - v-if 조건도 변경: terrainSamples.length > 0

3. 최대 지면표고 참조선 (L107-123)에서도 AMSL 값 사용:
   maxGroundElevation은 이제 상대값이므로 AMSL 전용 computed 추가:
   const maxGroundElevationAMSL = computed(() => {
       if (terrainSamples.value.length === 0) return 0;
       return Math.round(Math.max(...terrainSamples.value.map(s => s.elevation)));
   });
   
   - L110: :y1="scaleY(maxGroundElevation)" → :y1="scaleY(maxGroundElevationAMSL)"
   - L112: :y2="scaleY(maxGroundElevation)" → :y2="scaleY(maxGroundElevationAMSL)"
   - L118: :y="scaleY(maxGroundElevation) - 3" → :y="scaleY(maxGroundElevationAMSL) - 3"
   - v-if 조건도 변경: terrainSamples.length > 0
```

#### 수정 3-D: 라벨 텍스트 변경

**파일**: 로컬라이제이션 파일 (i18n)

```
변경 사항:
1. flightPlanGroundElev: "지면표고" → "상대지면표고" (또는 영문: "Relative Ground Elev")
2. flightPlanMaxGroundElev: "최대 지면표고" → "상대 최대 지면표고" (또는 영문: "Rel. Max Ground Elev")

해당 키를 찾아 변경. 파일 위치는 configurator의 locales 디렉토리에서 검색:
grep -r "flightPlanGroundElev" src/
```

#### 수정 3-E: Y축 라벨 — 왼쪽 해발고도 표시 유지

사용자 지시에 따라 **Y축 왼쪽의 고도 라벨은 해발고도를 유지**하며, "해발고도"라는 표시를 추가.

**파일**: `ElevationProfile.vue`  
**위치**: L36-56 (Y축 렌더링 영역)

```
변경 사항:
Y축 최상단 또는 최하단에 "(AMSL)" 또는 "해발고도" 텍스트 추가:

<text
    :x="padding.left - 9"
    :y="padding.top - 5"
    class="axis-label"
    text-anchor="end"
    font-style="italic"
>
    (AMSL)
</text>
```

---

## 문제 4: 툴팁 표시 개선

### 대상 파일
- `ElevationProfile.vue`

### 현재 동작 분석

#### 4-A. 툴팁 텍스트
- L167-173: 현재 `"고도 : 00 m AGL"` 형식
- 사용자 요청: `"상대고도 : 00 m"` 형식

#### 4-B. 드래그 중 툴팁 실시간 갱신
- `handlePointerDown()` (L668-686)에서 `updateTooltipPosition()` + `updateTooltipData()` 호출
- `handlePointerMove()` (L688-712)에서는 툴팁 갱신 없음
- `handleAltDragMove()` (L730-743)에서 updateWaypoint() 호출 후 tooltipData 갱신 없음
- `handleSpeedDragMove()` (L747-766)에서도 마찬가지

#### 4-C. 속도 갱신 지연
- 속도 드래그에 500ms 쓰로틀이 있어 속도값 갱신이 늦음
- WaypointList는 reactive 데이터를 직접 표시하므로 updateWaypoint() 직후 즉시 반영
- ElevationProfile 툴팁은 별도의 `tooltipData` ref를 사용하여 수동 갱신 필요

### 수정 지침

#### 수정 4-A: 툴팁 텍스트 변경

**파일**: `ElevationProfile.vue`  
**위치**: L167-173

```
변경 사항:
- 기존:
  <div>
      <span v-html="$t('flightPlanAlt')"></span>: {{ formatAltitude(tooltipData.altitude) }}
      <span v-html="$t('flightPlanRelativeAlt')"></span>
  </div>
  <div><span v-html="$t('flightPlanSpeed')"></span>: {{ formatSpeedMps(tooltipData.speed) }}</div>

- 변경:
  <div>상대고도: {{ formatAltitude(tooltipData.altitude) }}</div>
  <div>속도: {{ formatSpeedMps(tooltipData.speed) }}</div>

  또는 i18n 키 사용:
  <div>{{ $t('flightPlanRelativeAltLabel') }}: {{ formatAltitude(tooltipData.altitude) }}</div>
  <div>{{ $t('flightPlanSpeedLabel') }}: {{ formatSpeedMps(tooltipData.speed) }}</div>

  i18n 키 추가:
  - flightPlanRelativeAltLabel: "상대고도"
  - flightPlanSpeedLabel: "속도"
```

#### 수정 4-B: 드래그 중 툴팁 실시간 갱신

**파일**: `ElevationProfile.vue`

##### 고도 드래그 시 즉시 갱신

**위치**: `handleAltDragMove()` (L730-743)

```
변경 사항:
updateWaypoint() 호출 후 tooltipData 즉시 갱신 추가:

if (newAlt !== currentWp.altitude) {
    updateWaypoint(dragState.value.wpUid, { altitude: newAlt });
    dragState.value.startY = event.clientY;
    
    // 추가: 툴팁 실시간 갱신
    tooltipData.value.altitude = newAlt;
}
```

##### 속도 드래그 시 즉시 갱신

**위치**: `handleSpeedDragMove()` (L747-766)

```
변경 사항:
1. 쓰로틀 검사 이전에 현재 속도 계산하여 표시 (시각적 피드백은 즉각적):
   
   전체 함수를 다음과 같이 재구성:

   const handleSpeedDragMove = (event) => {
       const currentWp = waypoints.value.find(wp => wp.uid === dragState.value.wpUid);
       if (!currentWp) return;
       
       const deltaX = event.clientX - dragState.value.startX;
       const currentMps = Math.round(settings.storageToMps(currentWp.speed || 10));
       
       // 시각적 피드백: 매 프레임마다 예상 속도를 툴팁에 표시
       const previewSpeedDeltaMps = Math.round(deltaX / 10);
       const previewMps = Math.max(5, Math.min(25, currentMps + previewSpeedDeltaMps));
       const previewKnots = settings.mpsToStorage(previewMps);
       tooltipData.value.speed = previewKnots; // 즉시 표시 갱신
       
       // 실제 값 변경은 쓰로틀 적용
       const now = Date.now();
       if (now - dragState.value.lastMoveTime < 200) return;
       dragState.value.lastMoveTime = now;
       
       const speedDeltaMps = Math.round(deltaX / 10);
       const newMps = Math.max(5, Math.min(25, currentMps + speedDeltaMps));
       const newKnots = settings.mpsToStorage(newMps);
       
       if (Math.abs(newKnots - currentWp.speed) > 0.1) {
           updateWaypoint(dragState.value.wpUid, { speed: newKnots });
           dragState.value.startX = event.clientX;
       }
   };
```

##### 드래그 중 툴팁 위치도 갱신

**위치**: `handlePointerMove()` (L688-712)

```
변경 사항:
타입 결정 후 드래그 처리 부분에서, 매 이벤트마다 tooltipPosition도 갱신:

if (dragState.value.type === "altitude") {
    handleAltDragMove(event);
} else {
    handleSpeedDragMove(event);
}

// 추가: 드래그 중 항상 tooltip 위치 갱신
const draggedPoint = scaledProfilePoints.value.find(p => p.uid === dragState.value.wpUid);
if (draggedPoint) {
    updateTooltipPosition(event, draggedPoint);
}
```

---

## 수정 대상 파일 요약

| 파일 | 수정 항목 |
|------|-----------|
| `ElevationProfile.vue` | 문제 1-B, 1-C, 2-C, 2-D, 2-E, 3-A, 3-B, 3-C, 3-E, 4-A, 4-B |
| `useFlightPlan.js` | 문제 1-A (debounce), 2-A (음수 고도 허용) |
| `WaypointEditor.vue` | 문제 2-B (입력 범위) |
| i18n 로컬라이제이션 파일 | 문제 3-D, 4-A (라벨 텍스트) |

---

## 주의사항

1. **scaleY 좌표 체계**: scaleY()는 AMSL 값을 받아 SVG Y좌표로 변환함. 상대값을 전달할 때는 `+ wp1GroundElevation.value`로 AMSL 변환 필요. profilePoints의 `altitudeAMSL` 프로퍼티(L375)가 이미 이 변환을 수행하고 있음.

2. **terrainSamples의 elevation**: Open Elevation API에서 받은 해발고도(feet)로 저장됨. 상대값으로 표시할 때는 항상 `- wp1GroundElevation.value` 필요.

3. **computed 의존성 순서**: `groundElevation`을 computed로 변경하면 `wp1GroundElevation` → `groundElevation` 순서로 의존성 체인이 형성됨. 순환 의존 없음 확인.

4. **WP1 고도 0 보장**: WP1의 altitude는 항상 0 이상이어야 함. WP1이 기준점이므로 음수가 되면 전체 좌표계가 역전됨.

5. **단위 일관성**: 내부 저장은 feet(고도), knots(속도), meters(거리). 표시 시 settings store의 포매터 사용.

6. **성능**: dragState의 speedVisualOffsetX 변경 시 scaledProfilePoints가 재계산됨. computed가 아닌 함수 호출로 변경을 검토할 것. 단, 현재 포인트 수(최대 15개)에서는 성능 문제 없음.
