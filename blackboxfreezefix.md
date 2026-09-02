# Blackbox Viewer 3-Button Freeze — 원인 분석 및 해결 방안 (Root Cause Analysis & Fix Plan)

> **문서 상태**: 원인 규명 완료 및 해결 방안 확정  
> **대상 버그**: `<LegendPanel>` 우측 하단 3개 버튼(Expo override, Smoothing override, Grid override) 클릭 시 블랙박스 뷰어가 즉시 프리징되는 현상  
> **에러 로그**:
> ```
> Uncaught TypeError: Cannot read properties of null (reading 'render')
>     at J7e.render (main-...js:4281:28479)
>     at s9 (main-...js:4285:13115)
> ```

---

## 1. 이전 분석의 오류 및 정확한 스택 분석

### 1.1 이전 분석(`blackboxfreeze.md`, `blackboxfreezefix2.md`)의 치명적인 오류
이전 분석에서는 에러 로그를 보고 다음과 같이 잘못 판단했습니다:
> *"J7e.render로 표시된 함수는 FlightLogGrapher의 인스턴스 메서드이고, s9(animationLoop)에서 `t.graph.render()`를 호출할 때 `t.graph`가 null이어서 터진 것이다. 따라서 RAF 루프 도중 graphStore.graph가 null로 바뀌는 레이스 컨디션이다."*

이 가설을 바탕으로 다음과 같은 수정(`97e0f5afc`, `5d9f11b87`)을 적용했으나 **전혀 해결되지 않았습니다**:
1. `playback_controls.js`의 `animationLoop`에서 `const graph = graphStore.graph` 로컬 변수 캡처
2. `grapher.js`에 Pinia 인스턴스 강제 전달

### 1.2 왜 이전 분석이 완전히 틀렸는가?
자바스크립트의 호출 스택(Call Stack) 구조를 보면 명확합니다:
```
TypeError: Cannot read properties of null (reading 'render')
    at J7e.render (main-....js:4281:28479)   <-- 최상단 에러 발생 지점
    at s9 (main-....js:4285:13115)           <-- 호출자 (animationLoop)
```
- 만약 `animationLoop`(`s9`)에서 `graph` 객체 자체가 `null`이었다면, 에러는 `s9` 내부에서 발생하여 스택 최상단이 `at s9`가 되어야 합니다. `null.render(...)`를 호출하면 그 즉시 호출자 위치에서 에러가 던져지며 `J7e.render` 내부로 들어갈 수 없습니다.
- **스택 최상단이 `J7e.render`라는 것은, `s9`가 `graph.render(...)`를 성공적으로 호출하여 `FlightLogGrapher.prototype.render` 내부로 진입했다는 뜻입니다.**
- 즉, **`FlightLogGrapher.prototype.render` 내부에서 또 다른 어떤 객체 `xxx`의 `xxx.render(...)`를 호출하려 했는데, 그 `xxx`가 `null`이었던 것**입니다!

---

## 2. 근본 원인 (Root Cause Analysis)

### 2.1 `FlightLogGrapher.this.render` 내부의 `.render()` 호출 지점 확인
`src/blackbox-viewer/grapher.js`의 `this.render` 메서드(라인 830~970) 내부에서 `.render`를 호출하는 코드는 전체 파일에서 **정확히 다음 3곳뿐**입니다:

```javascript
// src/blackbox-viewer/grapher.js:939-956
if (centerFrame) {
    if (options.drawSticks) {
        sticks.render(centerFrame, chunks, startFrameIndex, windowCenterTime); // [호출 1]
    }

    if (options.drawTime) {
        drawFrameLabel(
            centerFrame[FlightLogParser.prototype.FLIGHT_LOG_FIELD_INDEX_ITERATION],
            Math.round((windowCenterTime - flightLog.getMinTime()) / 1000),
        );
    }

    if (options.craftType === "3D") {
        craft3D.render(centerFrame, flightLog.getMainFieldIndexes());          // [호출 2]
    } else if (options.craftType === "2D") {
        craft2D.render(centerFrame, flightLog.getMainFieldIndexes());          // [호출 3]
    }
}
```

여기서 호출 대상은 `sticks`, `craft3D`, `craft2D` 셋 중 하나입니다.
이 중 하나가 `null`인 상태에서 `.render()`를 호출한 것입니다.

---

### 2.2 결정적 원인 1: `craft_3d.js`의 Three.js 모듈 누락 및 생성 실패 (2D Fallback)
현재 우리 configurator의 `src/blackbox-viewer/craft_3d.js`와 업스트림(`masterconfig`)의 `craft_3d.js`를 비교(diff)한 결과:

1. **`import * as THREE from "three";` 누락**:
   - configurator의 `craft_3d.js`에는 `THREE` import 문이 아예 없습니다.
   - 또한 Three.js r125+에서 완전히 삭제된 구버전 API인 `new THREE.Geometry()`, `extrudeSettings = { amount: ... }` 등을 그대로 사용하고 있습니다.
2. **초기화 시 예외 발생**:
   - 뷰어 시작 시 `grapher.js` 라인 1064의 `initializeCraftModel()`이 실행됩니다:
     ```javascript
     if (options.craftType === "3D") {
         if (craftCanvas) {
             try {
                 craft3D = new Craft3D(flightLog, craftCanvas, idents.motorColors);
             } catch {
                 // WebGL not supported, fall back to 2D rendering
                 options.craftType = "2D";
             }
         }
     }
     if (options.craftType === "2D") {
         craft2D = new Craft2D(flightLog, craftCanvas, idents.motorColors);
     }
     ```
   - `new Craft3D(...)` 실행 중 `ReferenceError: THREE is not defined` (또는 Geometry constructor 오류)가 발생하여 `catch` 블록으로 빠집니다.
   - 따라서 **`craft3D`는 `null`인 채로 남고, `options.craftType = "2D"`로 변경되며, `craft2D`가 생성**됩니다.
3. **초기 상태 정상 작동**:
   - `craft3D = null`, `craft2D = [객체]`, `options.craftType = "2D"` 상태이므로 초기 렌더링 시에는 `else if (options.craftType === "2D")`로 분기하여 `craft2D.render(...)`가 호출되어 정상 작동합니다.

---

### 2.3 결정적 원인 2: 3개 버튼 클릭 시 `refreshOptions`가 `options.craftType`을 `"3D"`로 강제 리셋
`<LegendPanel>`의 3개 override 버튼(Expo, Smoothing, Grid) 중 하나를 클릭하면:

1. `main.js`의 watcher가 트리거됩니다:
   ```javascript
   // src/blackbox-viewer/main.js:485-494
   const stopOverrideWatch = watch(
       () => [userSettings.graphSmoothOverride, userSettings.graphExpoOverride, userSettings.graphGridOverride],
       () => {
           if (graph) {
               graph.refreshOptions(userSettings); // <-- 문제의 지점!
               graph.refreshGraphConfig();
               invalidateGraph();
           }
       },
   );
   ```

2. `graph.refreshOptions(userSettings)`의 구현(`src/blackbox-viewer/grapher.js:1165`):
   ```javascript
   this.refreshOptions = function (newSettings) {
       options = { ...defaultOptions, ...newSettings };
   };
   ```
   - `defaultOptions`는 `grapher.js:60`에 다음과 같이 선언되어 있습니다:
     ```javascript
     const defaultOptions = {
         gapless: false,
         craftType: "3D", // <-- 기본값이 "3D"
         drawPidTable: true,
         drawSticks: true,
         drawTime: true,
         drawAnalyser: true,
         analyserSampleRate: 2000,
         eraseBackground: true,
     };
     ```
   - 전달받은 `newSettings`(`userSettings`)에는 `craftType`이라는 프로퍼티가 없고 `drawCraft: "3D"`가 사용됩니다 (`user_settings_data.js`).
   - 따라서 `{ ...defaultOptions, ...newSettings }`가 실행되는 순간, **기존에 `"2D"`로 폴백되어 있던 `options.craftType`이 강제로 다시 `"3D"`로 덮어써집니다!**
   - 그러나 `initializeCraftModel()`은 다시 호출되지 않으므로, **`craft3D`는 여전히 `null`**입니다!

3. 직후 `invalidateGraph()` -> `requestAnimationFrame(animationLoop)` -> `graph.render()`가 실행됩니다:
   ```javascript
   if (options.craftType === "3D") {
       craft3D.render(centerFrame, flightLog.getMainFieldIndexes()); // <-- craft3D가 null이므로 CRASH!
   }
   ```
   - `craft3D`가 `null`이므로 `Cannot read properties of null (reading 'render')`가 발생하고, RAF 루프가 중단되면서 화면이 영구적으로 프리징됩니다.

---

### 2.4 결정적 원인 3: 방어적 Null 체크 부재
`grapher.js`의 `this.render`에서는:
```javascript
// 현재 코드 (취약함)
if (options.craftType === "3D") {
    craft3D.render(...);
} else if (options.craftType === "2D") {
    craft2D.render(...);
}
if (options.drawSticks) {
    sticks.render(...);
}
```
`options.craftType === "3D"`라는 조건만 확인하고, 실제로 인스턴스인 `craft3D`가 존재하는지(`craft3D != null`) 전혀 확인하지 않습니다. `craft2D`와 `sticks` 역시 동일합니다.

---

### 2.5 업스트림(`masterconfig`)에는 왜 에러가 없었는가?
1. 업스트림은 `craft_3d.js`에 `import * as THREE from "three"`가 포함되어 있고 `BufferGeometry`를 올바르게 사용하여 `new Craft3D(...)` 인스턴스화가 성공합니다. 따라서 `craft3D`가 정상 객체이므로 에러가 터지지 않았던 것입니다.
2. 하지만 업스트림 역시 WebGL이 지원되지 않거나 비활성화된 환경(예: Linux 소프트웨어 렌더링, WebKitGTK 등)에서는 2D로 폴백된 후 버튼을 누르면 똑같이 터지는 **잠재적 구조적 결함**을 품고 있습니다.

---

## 3. 해결 방법 (Resolution Plan)

해결책은 3단계로 구성됩니다:

### 1단계: `grapher.js` 런타임 Null 방어 및 `refreshOptions` 수정 (필수 안전망)

#### A. `refreshOptions`에서 기존 런타임 `options` 보존 및 키 매핑
`defaultOptions`로 매번 덮어쓰면 런타임에 결정된 폴백 값(`craftType: "2D"` 등)이 날아갑니다. 기존 `options`를 베이스로 병합하고, `userSettings.drawCraft`와 `options.craftType` 간의 이름 불일치를 해소합니다.

```javascript
// src/blackbox-viewer/grapher.js
this.refreshOptions = function (newSettings) {
    options = {
        ...defaultOptions,
        ...options, // 기존 런타임 상태(fallback 등) 보존
        ...newSettings,
        craftType: newSettings.drawCraft || newSettings.craftType || options.craftType || defaultOptions.craftType,
    };
};
```

#### B. `this.render`에서 옵셔널 체이닝 또는 Null 가드 추가
`craft3D`, `craft2D`, `sticks` 호출 시 인스턴스 존재 여부를 확인합니다.

```javascript
// src/blackbox-viewer/grapher.js
if (centerFrame) {
    if (options.drawSticks && sticks) {
        sticks.render(centerFrame, chunks, startFrameIndex, windowCenterTime);
    }

    if (options.drawTime) {
        drawFrameLabel(
            centerFrame[FlightLogParser.prototype.FLIGHT_LOG_FIELD_INDEX_ITERATION],
            Math.round((windowCenterTime - flightLog.getMinTime()) / 1000),
        );
    }

    if (options.craftType === "3D" && craft3D) {
        craft3D.render(centerFrame, flightLog.getMainFieldIndexes());
    } else if (options.craftType === "2D" && craft2D) {
        craft2D.render(centerFrame, flightLog.getMainFieldIndexes());
    }
}
```

---

### 2단계: `craft_3d.js`를 업스트림 사양으로 현대화 (Three.js 복구)

`src/blackbox-viewer/craft_3d.js`에 Three.js ES Module import 및 현대화된 Geometry API를 적용하여 3D Craft가 정상 작동하도록 복구합니다.

1. 파일 상단에 Three.js import 추가:
   ```javascript
   import * as THREE from "three";
   import { useSettingsStore } from "./stores/settings.js";
   ```
2. `buildPropGeometry()`:
   - `new THREE.Geometry()` 제거 -> `new THREE.BufferGeometry()` 사용
   - `depth: 0.1 * propRadius` 사용 (구버전 `amount` 대신)
   - Three.js Shape 호환 로직 적용
3. `buildCraft()` & `buildArrow()`:
   - 최신 Three.js `Shape` 및 `ExtrudeGeometry` 문법 준수

---

### 3단계: 이전 헛다리 패치 정리 (Clean-up)
- `commit 5d9f11b87`: `grapher.js`에 불필요하게 `pinia` 파라미터를 넘기던 변경은 Pinia Composition API 사용 표준에 맞춰 검토 후 유지하거나 원복
- `commit 97e0f5afc`: `playback_controls.js`의 `const graph = graphStore.graph`는 무해하므로 유지 가능하나 주석을 올바르게 정정

---

## 4. 검증 절차 (Verification Checklist)

1. **빌드 검증**:
   - `npm run build` 정상 완료 확인
   - ESLint / TypeScript 에러 없음 확인
2. **단위 테스트**:
   - `npx vitest run` (379개 전체 테스트 통과)
3. **런타임 동작 확인**:
   - 애플리케이션 실행 후 Blackbox Viewer 탭 진입
   - 로그 파일(`.bbl` 또는 `.csv`) 로드
   - `<LegendPanel>` 우측 하단의 **Expo override**, **Smoothing override**, **Grid override** 3개 버튼을 각각 클릭
   - 콘솔에 `Cannot read properties of null (reading 'render')` 에러가 발생하지 않는지 확인
   - 그래프가 즉시 다시 그려지고, 재생(Play/Pause) 및 타임라인 탐색(Seek)이 정상 동작하는지 확인
   - WebGL 비활성화 환경(또는 2D 모드)에서도 에러 없이 2D Craft가 정상 렌더링되는지 확인
