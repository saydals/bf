# Setup 탭 GUI 비행기 모델 및 자세 제어 조사 결과

## 1. GUI 비행기 모델 경로

- **모델 파일**: `/home/betaflight/configurator/resources/models/airplane.gltf`
- **모델 선택 로직**: `src/js/model.js`의 `mixerList` 배열에서 `mixer` 값에 따라 결정
  - Airplane은 `pos: 13` (mixer 값 14)에 해당
  - `model: "airplane"`으로 설정되어 있어 `airplane.gltf` 파일을 로드

## 2. 비행기 자세를 제어하는 값들 (실시간 - MSP_ATTITUDE)

`SetupTab.vue`의 `renderModel()` 함수(742-750행)에서 다음 값들을 사용:

```javascript
function renderModel() {
    const x = fcStore.sensorData.kinematics[1] * -1 * 0.017453292519943295;  // Pitch (라디안)
    const y = (fcStore.sensorData.kinematics[2] * -1 - yaw_fix.value) * 0.017453292519943295;  // Yaw/Heading (라디안)
    const z = fcStore.sensorData.kinematics[0] * -1 * 0.017453292519943295;  // Roll (라디안)
    modelInstance.rotateTo(x, y, z);
}
```

**데이터 소스**: `fcStore.sensorData.kinematics` 배열 (FC에서 MSP_ATTITUDE 메시지로 수신)
- **kinematics[0]**: Roll (롤) - 도 단위
- **kinematics[1]**: Pitch (피치) - 도 단위  
- **kinematics[2]**: Yaw/Heading (요/헤딩) - 도 단위

## 3. 데이터 흐름 (실시간)

1. `SetupTab.vue`에서 33ms 간격으로 `MSP_ATTITUDE` 요청 (`get_fast_data` 함수)
2. FC에서 응답 수신 → `fcStore.sensorData.kinematics` 업데이트
3. `renderModel()` 호출 → Three.js 모델에 회전 적용
4. `Model.prototype.rotateTo(x, y, z)`에서:
   - `model.rotation.x = x` (Pitch)
   - `modelWrapper.rotation.y = y` (Yaw)
   - `model.rotation.z = z` (Roll)

## 4. 추가 보정 (실시간)

- `yaw_fix.value`: "Reset Z-axis" 버튼으로 현재 Yaw 값을 0점으로 보정 가능 (71-74행)

---

## 5. 블랙박스 데이터로 비행기 자세 표현하기 (후처리/리플레이)

### 5.1 블랙박스 데이터 소스 (`log0004.csv`)

| 컬럼 | 인덱스 | 설명 | 단위 |
|------|--------|------|------|
| `heading[0]` | 101 | **롤 (Roll)** | 라디안 |
| `heading[1]` | 102 | **피치 (Pitch)** | 라디안 |
| `heading[2]` | 103 | **요/헤딩 (Yaw)** | 라디안 (0~2π, 북=0) |
| `gyroADC[0..2]` | 20-22 | 자이로 각속도 (X,Y,Z) | raw LSB |
| `accSmooth[0..2]` | 23-25 | 가속도계 (X,Y,Z) | raw ADC |
| `GPS_ground_course` | 96 | GPS 지상 진행방향 | 라디안 |
| `GPS_velned[0..2]` | 97-99 | GPS NED 속도 벡터 | cm/s |
| `gyroScale` | 헤더 | 자이로 스케일 팩터 | rad/LSB = 1.745e-8 |
| `acc_1G` | 헤더 | 가속도계 1G 기준값 | 2048 |

### 5.2 방법 1: 직접 사용 (가장 간단, 권장)

블랙박스에 **이미 계산된 자세(`heading`)가 저장되어 있음**:

```javascript
// CSV 파싱 후 각 행에서
const roll  = heading[0];   // 라디안
const pitch = heading[1];   // 라디안
const yaw   = heading[2];   // 라디안

// Three.js 모델에 적용 (SetupTab.vue와 동일)
const x = pitch * -1;                    // Pitch → model.rotation.x
const y = (yaw * -1 - yawFix) * 1;       // Yaw → modelWrapper.rotation.y  
const z = roll * -1;                     // Roll → model.rotation.z
modelInstance.rotateTo(x, y, z);
```

**장점**: 별도 필터링 불필요, FC와 동일한 자세 값 사용
**단점**: 블랙박스 로그에 `heading` 필드가 활성화되어 있어야 함 (`fields_disabled_mask` 확인)

### 5.3 방법 2: 센서 융합 재계산 (heading 없을 때)

`gyroADC` + `accSmooth` + `GPS_ground_course`로 Mahony 필터 실행:

```javascript
// 단위 변환
const gyroScale = 1.7453292519943295e-8;  // 헤더에서 읽기
const acc1G = 2048;                        // 헤더에서 읽기

const gyro = [
  gyroADC[0] * gyroScale,
  gyroADC[1] * gyroScale, 
  gyroADC[2] * gyroScale
];  // rad/s

const acc = [
  accSmooth[0] / acc1G,
  accSmooth[1] / acc1G,
  accSmooth[2] / acc1G
];  // G 단위

// Mahony 필터로 자세 계산 (dt = 루프 타임 ≈ 1ms = 0.001s)
const attitude = mahonyFilter.update(gyro, acc, dt);

// 요 보정: GPS_ground_course 사용 (무풍 가정)
if (!isNaN(GPS_ground_course)) {
  attitude.yaw = GPS_ground_course;  // 또는 보완 필터로 융합
}

// Three.js 적용
modelInstance.rotateTo(
  attitude.pitch * -1,
  (attitude.yaw * -1 - yawFix),
  attitude.roll * -1
);
```

### 5.4 방법 3: GPS 벡터로 풍향 보정 (고정익 전용)

`GPS_velned` (북/동/하 속도)로 실제 Heading 계산:

```javascript
// GPS 속도 벡터 (cm/s)
const vN = GPS_velned[0];
const vE = GPS_velned[1];

// 지상 진행방향
const groundCourse = Math.atan2(vE, vN);  // 라디안

// 대속도 추정 (피치/스로틀로부터) 또는 설정값 사용
const airspeed = estimateAirspeed(pitch, throttle);

// 풍향/풍속 역계산
const wind = estimateWind(vN, vE, airspeed, attitude.yaw);

// 실제 Heading = Ground Course + Wind Correction Angle
const trueHeading = groundCourse + wind.correctionAngle;
```

### 5.5 블랙박스 리플레이 구현 예시 (Vue 컴포넌트)

```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import Model from '@/js/model';
import { parseBlackboxCSV } from '@/utils/blackboxParser';

const csvData = ref([]);
let modelInstance = null;
let replayTimer = null;
let currentIndex = 0;
const yawFix = ref(0);

async function loadBlackbox(file) {
  const text = await file.text();
  csvData.value = parseBlackboxCSV(text);  // 헤더 파싱 + 데이터 행 파싱
  initModel();
}

function initModel() {
  const wrapper = document.getElementById('canvas_wrapper');
  const canvas = document.getElementById('canvas');
  modelInstance = new Model(wrapper, canvas);
}

function startReplay() {
  replayTimer = setInterval(() => {
    if (currentIndex >= csvData.value.length) {
      stopReplay();
      return;
    }
    const row = csvData.value[currentIndex++];
    renderFromBlackbox(row);
  }, 4);  // ~250Hz (P-frame 간격)
}

function renderFromBlackbox(row) {
  if (!modelInstance) return;
  
  // 방법 1: heading 직접 사용 (권장)
  if (row.heading && !isNaN(row.heading[0])) {
    const roll  = row.heading[0];
    const pitch = row.heading[1];
    const yaw   = row.heading[2];
    
    const x = pitch * -1;
    const y = (yaw * -1 - yawFix.value);
    const z = roll * -1;
    modelInstance.rotateTo(x, y, z);
    return;
  }
  
  // 방법 2: 센서 융합 (fallback)
  if (row.gyroADC && row.accSmooth) {
    // Mahony 필터 업데이트 후 rotateTo 호출
  }
}

function stopReplay() {
  clearInterval(replayTimer);
  currentIndex = 0;
}

function resetYaw() {
  if (csvData.value.length > 0) {
    yawFix.value = csvData.value[0].heading[2] * -1;
  }
}
</script>

<template>
  <div class="blackbox-replay">
    <div id="canvas_wrapper" ref="canvasWrapper">
      <canvas id="canvas" ref="canvasEl"></canvas>
    </div>
    <div class="controls">
      <UButton @click="loadBlackbox" :label="csvData.length ? 'Replay' : 'Load CSV'" />
      <UButton @click="startReplay" :disabled="!csvData.length" label="Play" />
      <UButton @click="stopReplay" label="Stop" />
      <UButton @click="resetYaw" label="Reset Yaw" />
    </div>
  </div>
</template>
```

### 5.6 CSV 파싱 유틸리티

```javascript
// src/utils/blackboxParser.js
export function parseBlackboxCSV(text) {
  const lines = text.trim().split('\n');
  const headers = [];
  let dataStartLine = 0;
  
  // 헤더 파싱 (메타데이터 + 컬럼 헤더)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('"loopIteration"')) {
      // 컬럼 헤더 라인
      headers.push(...parseCSVLine(lines[i]));
      dataStartLine = i + 1;
      break;
    } else if (lines[i].startsWith('"gyroScale"')) {
      // gyroScale 추출
      const parts = parseCSVLine(lines[i]);
      gyroScale = parseFloat(parts[1]);
    } else if (lines[i].startsWith('"acc_1G"')) {
      const parts = parseCSVLine(lines[i]);
      acc1G = parseInt(parts[1]);
    }
  }
  
  // 데이터 행 파싱
  const data = [];
  for (let i = dataStartLine; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = parseValue(h, values[idx]);
    });
    data.push(row);
  }
  
  return data;
}

function parseCSVLine(line) {
  // CSV 파싱 (따옴표 처리 등)
  return line.split(',').map(v => v.replace(/^"|"$/g, ''));
}

function parseValue(header, value) {
  if (value === 'NaN' || value === '') return NaN;
  
  // 배열 필드 처리 (heading[0], gyroADC[0] 등)
  const match = header.match(/^(\w+)\[(\d+)\]$/);
  if (match) {
    // 배열 필드는 별도 처리 필요
    return parseFloat(value);
  }
  
  return parseFloat(value);
}
```

### 5.7 주의사항

| 항목 | 내용 |
|------|------|
| **단위** | `heading`: 라디안, `gyroADC`: raw LSB (×gyroScale), `accSmooth`: raw ADC (÷acc_1G) |
| **GPS 초기값** | 로그 초반 GPS 데이터는 `NaN` (픽스 대기) |
| **시간 동기** | `time` 컬럼(μs) 또는 `loopIteration`으로 프레임 간격 계산 |
| **요 보정** | `yawFix`로 초기 헤딩 0점 맞춤 (Reset Z-axis와 동일) |
| **필드 활성화** | `fields_disabled_mask` 비트마스크로 `heading` 필드 활성화 여부 확인 필요 |

---

## 6. 요약: 실시간 vs 블랙박스 리플레이

| 구분 | 실시간 (SetupTab) | 블랙박스 리플레이 |
|------|------------------|------------------|
| **데이터 소스** | `MSP_ATTITUDE` → `fcStore.sensorData.kinematics` | `log0004.csv` → `heading[0..2]` |
| **자세 값** | `kinematics[0..2]` (도) | `heading[0..2]` (라디안) |
| **단위 변환** | `× 0.01745...` (도→라디안) | 이미 라디안 |
| **적용 함수** | `renderModel()` | `renderFromBlackbox()` |
| **요 보정** | `yaw_fix.value` | `yawFix.value` |
| **업데이트율** | 33ms (30Hz) | 로그 프레임 레이트 (250Hz+) |