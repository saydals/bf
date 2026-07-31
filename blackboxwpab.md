# 블랙박스 뷰어 맵 위에 WP 및 A/B 포인트 표시 계획서

펌웨어 코드에서 블랙박스 GPS 항목에 WP, A, B 포인트를 기록해야 하는 계획.

컨피규레이터의 블랙박스 뷰어 지도 위에 WP, A, B를 표시해야 함. 현재는 WP, A, B를 제외한 그냥 비행 행적만 표시하고 있음.

정상 비행중의 비행궤적은 현재 상태의 라인으로 표시하고,

레스큐(waypoint 비행경로 또는 순수 레스큐 비행경로) 비행 경로는 색깔이 다른 라인으로 표시.

이 계획서는 autopilot 펌웨어측, 컨피규레이터 윈도우용(configurator), 컨피규레이터 안드로이드용(bfapk) 세 플랫폼에서 실행되어야 함.

## 1. 조사 결과 요약

### 1-1. autopilot 블랙박스(BBL) 데이터 확인

autopilot 펌웨어(`src/main/blackbox/blackbox.c`)는 다음 4개 필드를 이미 로그합니다:

| 로그 필드명 | 블랙박스 코드 라인 | 타입 | 설명 |
| --- | --- | --- | --- |
| `GPS_coord[0]` | line 278 | SIGNED | 위도 (1e-7 deg 단위, home 좌표로 예측 암호화) |
| `GPS_coord[1]` | line 279 | SIGNED | 경도 (동일 암호화) |
| `GPS_altitude` | line 280 | SIGNED | 고도 (cm 단위) |
| `GPS_ground_course` | line 282 | UNSIGNED | 지상 방위각 (도) |

이 4개는 configurator 블랙박스 뷰어가 요구하는 것과 완전히 동일하므로, autopilot BBL 데이터만으로도 기본 맵 뷰어(비행 궤적, 현재 위치, 홈 위치)가 정상 작동합니다. WP, A, B 포인트는 BBL에 현재 로그되지 않으므로 별도 확장이 필요합니다.

추가로 다음 필드도 로그됩니다:

- `GPS_numSat` (line 277): 위성 수
- `GPS_speed` (line 281): 지상 속도
- `GPS_home[0]`, `GPS_home[1]`, `GPS_home[2]`, `GPS_home_epoch` (line 291~294): 홈 위치
- `flightModeFlags` (line 889, 1715~1716): 비행 모드 플래그 (GPS_RESCUE 등 포함)

### 1-2. WP(waypoint) 데이터: BBL에 포함되지 않음

autopilot에서 WP는 `missionConfig_t` 구조체에 저장됩니다:

```c
// src/main/pg/mission.h
typedef struct {
    uint8_t waypointCount;
    missionWaypoint_t waypoints[MAX_MISSION_WAYPOINTS]; // MAX는 보통 15
} missionConfig_t;
```

```c
// src/main/flight/mission.h
typedef struct {
    int32_t latitude;      // 1e-7 deg
    int32_t longitude;     // 1e-7 deg
    float altitude;        // cm
    missionWpType_e type;
} missionWaypoint_t;
```

**이 데이터는 FC 내부 메모리(PG_REGISTER)에만 저장되며, BBL 파일에 로그되지 않습니다.**

### 1-3. A/B 포인트 데이터: BBL에 포함되지 않음

A, B 포인트는 autopilot 레스큐 로직에서 동적으로 생성되는 좌표입니다(`사용자설계의도.md` 참조):

- **A 포인트**: descent distance 위치에 생성되는 지점. 짝수 모드에서는 이륙방향으로, 홀수 모드에서는 홈포인트 방향으로 생성.
- **B 포인트**: A 포인트에서 홈포인트 방향으로 shuttle distance만큼 떨어진 지점.

이 좌표는 FC 메모리에만 존재하며 BBL에 로그되지 않습니다.

### 1-4. 기존 맵 데이터 흐름 (configurator + bfapk)

```
BBL 파일
  ├─ GPS_coord[0], GPS_coord[1], GPS_altitude, GPS_ground_course
  │  → flightlog_parser.js → getCoordinatesFromFrame() → L.latLng()
  │  → graph_map.js: updateCurrentPosition() → craftMarker 위치갱신
  │  → graph_map.js: redrawFlightTrail() → 비행 궤적 polyline
  │
  ├─ flightModeFlags → rescue 모드 감지 → 항적 색상 구분
  │
  └─ (WP 데이터 없음 → 표시 불가)
  └─ (A/B 포인트 데이터 없음 → 표시 불가)

위 흐름은 configurator(Windows)와 bfapk(Android) 모두에 해당합니다.
```

## 2. 구현 계획

### 2-1. WP 데이터 소스 결정

WP 데이터는 BBL에 없으므로, **autopilot 펌웨어에서 BBL 확장** 방식으로 추가 로그해야 합니다.

### 2-2. autopilot 펌웨어 수정 계획 (BBL 확장)

`src/main/blackbox/blackbox.c`에 WP 데이터와 A/B 포인트를 추가 로깅합니다.

추가 로그 필드 정의:

```c
// GPS_wp_count (WP 개수, 0~15)
// GPS_wp_0_lat ~ GPS_wp_14_lat  (위도 × 1e7, int32)
// GPS_wp_0_lon ~ GPS_wp_14_lon  (경도 × 1e7, int32)
// GPS_wp_0_alt ~ GPS_wp_14_alt  (고도 cm, int32)
// GPS_wp_0_type ~ GPS_wp_14_type (WP 타입, int32)
// GPS_A_lat, GPS_A_lon, GPS_A_alt (A 포인트 좌표, int32 / int32 / int32)
// GPS_B_lat, GPS_B_lon, GPS_B_alt (B 포인트 좌표, int32 / int32 / int32)
```

로깅 타이밍:

- WP 필드: GPS 업데이트 시점에 missionConfig_t에서 현재 WP 목록을 읽어 로그
- A/B 포인트 필드: autopilot 레스큐 로직에서 A, B 포인트가 생성/갱신될 때마다 로그
- GPS_coord 필드와 동일한 시점 (flight loop에서 GPS 업데이트 시)
- GPS_coord의 GPS_home 예측 방식과 유사하게 동작

주요 사항:

- WP 개수만큼 필드가 추가되므로 데이터 크기 증가
- 동적 필드 수 → `CONDITION(FLIGHT_LOG_FIELD_CONDITION_...)` 활용
- 최대 15개 WP이므로 필드 이름 패턴: `GPS_wp_0_lat`, `GPS_wp_0_lon`, ... `GPS_wp_14_lat`
- A/B 포인트는 고정 1개씩이므로 필드 이름: `GPS_A_lat`, `GPS_A_lon`, `GPS_A_alt`, `GPS_B_lat`, `GPS_B_lon`, `GPS_B_alt`
- A/B 포인트가 생성되지 않은 경우(예: shuttle count=0 모드)에는 해당 필드가 BBL에 기록되지 않음 → configurator/bfapk에서 필드 존재 여부로 판단

### 2-3. configurator (Windows) 블랙박스 뷰어 수정 계획

#### A. WP 파싱

`flightlog_parser.js` 또는 해당 위치에 WP 파싱 함수 추가:

```javascript
// BBL 필드 인덱스 확인 → WP 데이터 추출
function parseWaypoints(frameDefs, frame) {
    const waypoints = [];
    for (let i = 0; i < 15; i++) {
        const latField = `GPS_wp_${i}_lat`;
        const lonField = `GPS_wp_${i}_lon`;
        if (frameDefs.H?.nameToIndex[latField] === undefined) break;
        const lat = frame[frameDefs.H.nameToIndex[latField]] / coordinateDivider;
        const lon = frame[frameDefs.H.nameToIndex[lonField]] / coordinateDivider;
        const alt = frame[frameDefs.H.nameToIndex[`GPS_wp_${i}_alt`]] / altitudeDivider;
        waypoints.push({ lat, lon, alt, index: i });
    }
    return waypoints;
}
```

#### B. A/B 포인트 파싱

```javascript
function parseABPoints(frameDefs, frame) {
    const aLatField = frameDefs.H?.nameToIndex['GPS_A_lat'];
    if (aLatField === undefined) return null;
    return {
        a: {
            lat: frame[aLatField] / coordinateDivider,
            lon: frame[frameDefs.H.nameToIndex['GPS_A_lon']] / coordinateDivider,
            alt: frame[frameDefs.H.nameToIndex['GPS_A_alt']] / altitudeDivider,
        },
        b: {
            lat: frame[frameDefs.H.nameToIndex['GPS_B_lat']] / coordinateDivider,
            lon: frame[frameDefs.H.nameToIndex['GPS_B_lon']] / coordinateDivider,
            alt: frame[frameDefs.H.nameToIndex['GPS_B_alt']] / altitudeDivider,
        },
    };
}
```

#### C. 비행 항적(WP 경로) 및 A/B 포인트 표시

- WP1 → WP2 → ... → WP15 순서로 점선(polyline)으로 연결
- 이미 존재하는 `redrawFlightTrail()` 패턴을 활용하여 WP 경로도 함께 그리기
- WP가 없으면 경로 미표시 (기존 트레일만)
- A 포인트: 마커(marker)로 표시, 레이블 "A" 표시
- B 포인트: 마커(marker)로 표시, 레이블 "B" 표시
- A → B 방향으로 점선(화살표)으로 연결
- B → A 방향으로 점선(화살표)으로 연결
- A, B 포인트가 BBL에 없으면 마커 미표시 (존재하지 않으면 표시 안 함)

### 2-4. bfapk (Android) 블랙박스 뷰어 수정 계획

bfapk는 configurator의 Android 포트로, 동일한 BBL 파일을 파싱하여 맵 위에 WP와 A/B 포인트를 표시해야 합니다.

#### A. bfapk BBL 파싱 레이어

- bfapk 내부의 BBL 파서(`flightlog_parser` 대응 모듈)에 WP 파싱 함수와 A/B 포인트 파싱 함수를 추가
- configurator와 동일한 필드 이름(`GPS_wp_N_lat`, `GPS_A_lat` 등)을 사용하므로 파싱 로직은 동일
- bfapk의 네이티브(Bluetooth/USB) BBL 전송 경로에서 frame 데이터를 configurator와 동일한 형식으로 제공

#### B. bfapk 맵 뷰어 UI

- bfapk의 지도 컴포넌트에 WP 마커, A/B 포인트 마커, WP 경로 polyline 렌더링 기능 추가
- configurator와 동일한 시각적 규칙 적용:
  - WP 경로: 점선 polyline
  - A 포인트: "A" 라벨 마커
  - B 포인트: "B" 라벨 마커
  - A↔B 연결: 점선
- Android 화면 크기에 맞게 마커 크기와 라벨을 조정

#### C. bfapk Rescue 모드 항적 색상

- configurator와 동일하게 `flightModeFlags`에서 GPS_RESCUE 비트를 판별
- Rescue 모드 항적은 별도 색상 그라디언트로 표시
- bfapk에서 polyline 색상 변경 로직 구현

### 2-5. 구현 순서

| 단계 | 내용 | 위치 | 플랫폼 |
| --- | --- | --- | --- |
| 1 | autopilot 펌웨어: WP 데이터 BBL 로그 추가 | `src/main/blackbox/blackbox.c` | autopilot 펌웨어 |
| 2 | autopilot 펌웨어: A/B 포인트 BBL 로그 추가 | `src/main/blackbox/blackbox.c` | autopilot 펌웨어 |
| 3 | configurator: BBL 필드 확장 대응 (flightlog_fielddefs.js 업데이트) | `flightlog_fielddefs.js` | configurator (Windows) |
| 4 | configurator: WP 파싱 함수 추가 | `flightlog_parser.js` 또는 `graph_map.js` | configurator (Windows) |
| 5 | configurator: A/B 포인트 파싱 함수 추가 | `flightlog_parser.js` 또는 `graph_map.js` | configurator (Windows) |
| 6 | configurator: WP 마커 + A/B 포인트 마커 + 경로 polyline | `graph_map.js` | configurator (Windows) |
| 7 | configurator: Rescue 모드 항적 색상 구분 | `graph_map.js` | configurator (Windows) |
| 8 | bfapk: BBL 파싱 레이어에 WP/A/B 파싱 함수 추가 | bfapk BBL 파서 모듈 | bfapk (Android) |
| 9 | bfapk: 맵 뷰어 UI에 WP 마커, A/B 마커, 경로 polyline 추가 | bfapk 지도 컴포넌트 | bfapk (Android) |
| 10 | bfapk: Rescue 모드 항적 색상 구분 | bfapk 지도 컴포넌트 | bfapk (Android) |

## 3. 현재 맵 표시 항목 (참고)

| 항목 | 데이터 필드 | 표시 방식 |
| --- | --- | --- |
| 비행 궤적 | GPS_coord[0/1] | 파란색 polyline |
| 현재 위치 | GPS_coord[0/1] | craft.png 마커 |
| 홈 위치 | GPS_home[0/1] | home.png 마커 |
| 고도 컬러 트레일 | GPS_altitude | 색상 그라디언트 polyline |
| 레이어 토글 | - | R/S 버튼 (topright) |
| 홈 줌 | - | 🏠 버튼 (topright) |
| 전체화면 | - | ⛶ 버튼 (topright) |
| 드래그 이동 | - | ✋ 버튼 (bottomleft) |

## 4. Rescue 모드 항적 색상 구분 계획

### 4-1. Rescue 모드 감지

autopilot BBL은 `flightModeFlags`를 로그합니다(`blackbox.c` line 889, 1715~1716):

```c
blackboxWriteUnsignedVB(slowHistory.flightModeFlags);
blackboxWriteUnsignedVB(data->flightMode.flags);
```

이 플래그 중 `GPS_RESCUE_MODE` 비트가 켜져 있으면 rescue 모드 진입/종료를 감지할 수 있습니다.

configurator 뷰어(`flightlog_parser.js` 또는 `graph_map.js`)에서 해당 플래그를 파싱합니다.

bfapk에서도 동일하게 `flightModeFlags`에서 GPS_RESCUE 비트를 판별합니다.

### 4-2. Rescue 모드 항적 색상 변경 방안

기존 항적: `colorTrailGradient` (cyan-green → 빨간, 고도 기반)
Rescue 모드 항적: **별도 그라디언트** 사용, 더 밝고 구분되는 색상

**제안 색상 (Rescue 모드):**

```javascript
const colorRescueTrailGradient = [
    { color: "#ff00ffbf" },
    { color: "#ff00ffff" },
    { color: "#00ffffff" },
    { color: "#ff4444bf" },
    { color: "#ff0000" },
];
```

차이점:

- 기본 트레일: cyan → red (고도 기반 부드러운 전환)
- Rescue 트레일: purple → white → red (높은 대비, 즉시 인식 가능)

### 4-3. 구현 방법

`graph_map.js`의 `createAltitudeColoredPolyline()`를 확장:

```javascript
this.createTrailPolyline = function (latlngs, maxAlt, minAlt, isRescue) {
    const gradient = isRescue ? colorRescueTrailGradient : colorTrailGradient;
    // ... 기존 createAltitudeColoredPolyline() 로직 재사용
    return L.multiOptionsPolyline(latlngs, {
        multiOptions: {
            optionIdxFn: ...,
            options: gradient,
        },
        weight: isRescue ? 4 : 3,
        opacity: 1,
        smoothFactor: 1,
    });
};
```

Rescue 모드 트레일은 기존 트레일 위에 겹쳐 그리되 두께(weight)를 4px(기본 3px)로 넓게 → 더 밝게 보이도록 처리합니다.

bfapk에서도 동일한 로직을 Android 지도 컴포넌트에 적용합니다.

### 4-4. Rescue 모드 감지 구현 시 유의사항

1. **flightModeFlags 파싱**: `flightlog_parser.js`에서 BBL frame의 flight mode field를 읽어 Rescue 비트 판별
2. **시점 매칭**: rescue 모드 플래그는 slow frame(history) 단위로 로그되므로, fast frame GPS 데이터와 시점을 맞추어야 함
3. **조건부 렌더링**: rescue 모드 플래그가 존재하지 않으면 기본 트레일 사용 (하위 호환성)
4. **Rescue 전환 시 트레일 색상 변경**: 모드 전환 지점에서 색상이 명확히 바뀌도록 구간별 polyline으로 그리기
5. **bfapk 반영**: Android 지도 컴포넌트에서도 동일한 구간별 polyline 로직을 적용