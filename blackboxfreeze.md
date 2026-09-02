# Blackbox Viewer 3-Button Freeze — 분석 노트

> 시작일: 2026-09-03 / 상태: **미해결**. 마지막 분석은 빌드 산출물에서
> `J7e.render` → `s9` (RAF loop) → `t.graph.render(...)` 호출 체인을
> 식별한 단계에서 멈춤. 다음 세션은 이 문서부터 읽고 시작.

---

## 1. 증상 (사용자 보고)

블랙박스 뷰어에서 다음 **3개 버튼을 누르면 뷰어가 프리징**:

- **Expo override** (graphExpoOverride)
- **Smoothing override** (graphSmoothOverride)
- **Grid override** (graphGridOverride)

이 3 버튼은 **`<LegendPanel>` 우측 하단 토글 3개**이며, 모두
`settingsStore.userSettings.graphXxxOverride` boolean을 뒤집는
`UButton variant=ghost icon=...` 트리거이다 (콜러는 `LegendPanel.vue`의
`toggleExpo / toggleSmoothing / toggleGrid`).

### 사용자가 본 콘솔 에러 (3회 동일)

```
main-Bn3laU6Q.js:4281 Uncaught TypeError: Cannot read properties of null (reading 'render')
    at J7e.render (main-Bn3laU6Q.js:4281:28479)
    at s9 (main-Bn3laU6Q.js:4285:13115)
```

- `main-Bn3laU6Q.js`는 **이전 빌드 산출물** (해시가 `Dus5eFl7`이 아님).
  - 현재 로컬 `src/dist/assets/main-Dus5eFl7.js`에도 `J7e`/`s9`/`D9e`/`M7`이 존재하므로
    같은 클래스의 함수가 **현재 빌드에도 있음** (해시만 다름).
- 스택은 **`J7e.render` → `s9`** 두 프레임. `s9`는 RAF/스케줄 루프 본체이고
  `J7e`는 그 안에서 `render`를 호출한 객체.

### 결정적 단서

> "이 에러는 **우리가 작업한 (port한) 결과물에만 있고**, 업스트림 (masterconfig)
> 결과물에는 없다."

즉 250114dd 이후 일련의 cherry-pick으로 **우리가 만든 race / null 시나리오**가
`J7e.render`의 null 호출을 만들어낸 것. 업스트림에는 같은 코드가 없거나,
같은 호출 패턴이지만 다른 가드가 있다.

---

## 2. 작업 내역 (이번 세션)

### 2.1 cherry-pick으로 포팅한 커밋 (configurator HEAD)

| 커밋        | 제목                                                | 핵심                                                                    |
| ----------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| `a7753d940` | blackbox viewer 통합 (250114dd, a5b17c3b, 3ccdd05d) | 별도 createApp 제거, keep-alive, viewerActive 플래그, setViewerActive() |
| `4ecaaf968` | 9b41ec35 + b5c68d71                                 | reliable reconnect, port→device rename, DeviceHandler 도입              |
| `c9c83efde` | 55ba6d53                                            | honest connect failures, single owner for reboot                        |
| `030fe3c0c` | CLI escape hack setTimeout 제거                     | MSP handshake 동기성 복구 (테스트 통과용)                               |

### 2.2 변경한 핵심 파일

```
src/blackbox-viewer/vue_init.js          createApp 제거 → setViewerActive()
src/blackbox-viewer/pinia_instance.js    삭제 (호스트 pinia 공유)
src/blackbox-viewer/stores/log.js        store id "log" → "blackboxLog" (호스트 충돌)
src/blackbox-viewer/stores/app.js        viewerActive 플래그 추가
src/blackbox-viewer/App.vue              <UApp> 래퍼 제거, drag/drop 게이팅
src/blackbox-viewer/main.js              wheel 핸들러 viewerActive 게이팅
src/blackbox-viewer/keyboard_handler.js  viewerActive 게이팅, createDropdownSpaceGuard 추가
src/blackbox-viewer/grapher.js           has-grid-override 토글 제거
src/App.vue                              keep-alive + 안정적 key
src/components/tabs/BlackboxViewerTab.vue 자식 컴포넌트 패턴으로 재작성
src/components/dialogs/LegendPanel.vue   @wheel.prevent → @wheel (3ccdd05d)
test/setup.js                            localStorage 메모리 폴백
+ device-picker 신규 6개 파일 (b5c68d71 산출물)
+ RebootDialog.vue, connection_state.js 등 (55ba6d53 산출물)
```

### 2.3 검증 결과 (현재 HEAD에서)

- ✅ Vite 프로덕션 빌드 성공 (4.68s)
- ✅ Vitest 379/379 통과 (36/36 파일) — **3개 포팅 커밋과 추가 수정 모두 회귀 없음**
- ✅ ESLint 0 errors
- ❌ **브라우저 런타임에서 3버튼 클릭 시 J7e.render null 에러** (이번 세션에서 재현/디버깅 못 함)

---

## 3. 분석: 어떤 함수가 `J7e` / `s9` / `D9e` / `M7` 인지

### 3.1 빌드 산출물에서 추출 (src/dist/assets/main-Dus5eFl7.js)

| 이름                         | 정의 / 의미                                                                                                                                                                              | 출처                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `M7`                         | lodash `throttle(e, t, n)` (throttle-debounce)                                                                                                                                           | `playback_controls.js`가 import                                   |
| `t9`                         | `function t9(e, t, n, r){ let i = e.flightLog.getSmoothedFrameAtTime(...); ... e.fieldValues=s; ...}` — value panel/field values 업데이트                                                | `playback_controls.js`의 `updateValuesRateLimited`                |
| `a9`, `o9`                   | `a9 = M7(250, () => t9(...))`, `o9 = M7(200, () => t.seekBar.repaint())`                                                                                                                 | throttled wrappers                                                |
| `D9e`                        | `function D9e(){ if(!a9){ let e=w6(zv), t=T6(zv), n=E6(zv), r=c6(zv); a9 = M7(250, () => t9(...)); o9 = M7(200, () => t.seekBar.repaint()) } }` — RAF loop 시작 (idempotent)             | `playback_controls.js`의 `invalidateGraph` / `animationLoop` 진입 |
| `s9`                         | `function s9(){ D9e(); ... if(!t.graph){ i9=!1; return } ... t.graph.render(n.currentBlackboxTime); t.seekBar.setCurrentTime(...); ... n.flightLog.hasGpsData() && ... }` — **RAF tick** | `playback_controls.js`의 `function animationLoop()`               |
| `i9`                         | "graph is null, 다음 RAF에서 bail" 플래그                                                                                                                                                | `playback_controls.js`의 `animationFrameIsQueued=!1` 추정         |
| `r9`                         | last play start timestamp (playback)                                                                                                                                                     | playback store                                                    |
| `zv`                         | pinia instance (압축된 import 변수)                                                                                                                                                      | `import { pinia } from "@/js/pinia_instance.js"`                  |
| `T6`, `w6`, `E6`, `c6`, `D6` | 모두 `useStore( StoreName )` 호출                                                                                                                                                        | stores                                                            |
| `J7e`                        | `function J7e(e,t,n,r,i,a,o){ let s=T6(), c=O6(), l='Verdana, Arial, sans-serif', u={ fontSizePIDTableLabel:null, ...}, ...}`                                                            | **`FlightLogGrapher` 팩토리** (grapher.js)                        |

### 3.2 핵심 호출 그래프 (RAF 1회)

```
requestAnimationFrame
  → s9()                          // animationLoop
       D9e()                      // 첫 호출이면 a9, o9 세팅
       t = T6(zv)                 // useGraphStore(pinia) ← null 가능
       n = w6(zv)                 // useLogStore(pinia) ← null 가능
       r = D6(zv)                 // usePlaybackStore(pinia)
       if (!t.graph) { i9=!1; return }   // 그래프 없으면 bail
       t.graph.render(currentBlackboxTime)   // ← J7e 인스턴스, null 가능
       t.seekBar.setCurrentTime(...)
       n.flightLog.hasGpsData() && t.mapGrapher.setCurrentTime(...)
```

### 3.3 결론 — 어디서 null 이 생기는가

`J7e` 자체는 `FlightLogGrapher` 팩토리. `J7e.render`로 표시된 함수는
`FlightLogGrapher`가 반환하는 **인스턴스의 `.render` 메서드**가 호출되는
장소에서 **`t.graph`가 null**인 상태를 의미한다.

```js
if (!t.graph) { i9=!1; return }   // ← 이 가드는 있음
...
t.graph.render(n.currentBlackboxTime)   // ← 그래도 null일 수 있음 (race)
```

또는 가드 이후 `t.graph`가 다른 곳에서 `null`로 재할당된 경우 (e.g.
teardown / `setViewerActive(false)` 도중).

---

## 4. 우리가 한 변경 중 race를 만들 가능성이 큰 부분

### 4.1 250114dd의 `setViewerActive` — main.js의 teardown 로직 차이

`setViewerActive(false)` 시 main.js teardown이 `graph = null`을 하지만,
RAF loop `s9`는 이미 다음 프레임에 실행 큐에 들어있을 수 있다.

**가설 A**: `setViewerActive(false)` → 캔버스 `unmount` → teardown
(`graph = null`) → RAF가 발화 → `t.graph.render` → null.

`if (!t.graph) { i9=!1; return }` 가드는 이미 있으므로,
이 가드가 **누락되거나** `t`가 destructuring으로 풀린 후 다시 graphStore에
접근하는 코드 경로가 있을 때만 터진다.

`playback_controls.js:86` `requestAnimationFrame(animationLoop)`는
`animationFrameIsQueued = true` 후 호출되므로 teardown이 그 사이를
비집고 들어갈 수 있다.

### 4.2 250114dd의 `useGraphStore()` vs `useGraphStore(pinia)` 혼용

`grapher.js:21-22`:

```js
const graphStore = useGraphStore();         // ← pinia 없이 호출
const workspaceStore = useWorkspaceStore();
```

`main.js:95`:

```js
const graphStore = useGraphStore(pinia);    // ← pinia 명시
```

이 둘이 **혼재**되어 있다. pinia가 active일 때는 둘 다 같은 store를
반환하지만, **keep-alive로 컴포넌트가 unmounted 상태**에서 `grapher.js`의
`useGraphStore()`가 호출되면 `getActivePinia()`가 null을 반환하여
`graphStore`가 **null**이 된다.

`grapher.js` 내부의 `graphStore.xxx` 접근이 `null.xxx`로 죽는다. 그러나
스택트레이스의 `J7e.render`는 **인스턴스 메서드**에서 나왔으므로
다음 가설이 더 강하다:

**가설 B**: `FlightLogGrapher` 인스턴스 메서드 `render` 안에서
`this.graphStore` (또는 클로저로 잡힌 store)가 null이 되었는데,
`render`가 `this.something.method()`를 호출하다 죽는다.

`grapher.js`의 `useGraphStore()`는 `FlightLogGrapher` **팩토리 호출 시점**에
1회 실행되어 클로저로 캡처된다. **탭 전환 후에도 이 클로저는 동일
store ref를 갖고 있어야** 하지만, `keep-alive`로 컴포넌트가 unmount되면서
pinia store가 **dispose**되면 (드문 경우) 그 ref가 dangling 된다.

### 4.3 55ba6d53 — `useDeviceHandler` import / store refresh timing

`useGraphStore(pinia)` 명시적 호출은 `main.js:bootstrapViewer` 안에서
실행된다. **`bootstrapViewer`는 `onMounted` + `nextTick` 후 호출**되지만,
masterconfig와 달리 우리는 **`viewerReady = true; nextTick(); bootstrapViewer()`**
순서로 호출한다. 이 사이에 RAF가 발화하면 store가 비어있을 수 있다.

masterconfig에서는 `onMounted` → `nextTick` → `bootstrapViewer` 사이에
`viewerReady`를 **두 번** nextTick로 기다리거나, 더 긴 tick이 있을 수 있다.
다만 masterconfig 코드도 `await nextTick(); viewerReady = true; await nextTick(); bootstrapViewer()`
이므로 동일.

### 4.4 `setViewerActive(false)` 도중 `graphStore.graph = null`

`teardown` 함수가 `graph = null`로 한 후, `graphStore.graph = null`로
store에도 반영한다. `s9`의 가드 `if (!t.graph)`는 reactive ref 이므로
이후 자동으로 `null`이 된다. 그 다음 RAF에서 가드가 동작해 return한다.

→ **이 가드는 동작한다**. 사용자가 본 에러는 이 경로가 아니다.

### 4.5 가장 유력한 가설 (확인 필요)

**`grapher.js`의 `useGraphStore()` (no pinia) 호출**이
`bootstrapViewer` 외부에서 (e.g. RAF 콜백 안에서?) 일어나고,
그 시점에 pinia가 active가 아니면 `graphStore`가 **null**이 된다.

하지만 `grapher.js`의 `useGraphStore()`는 팩토리 호출 시점에만 실행되므로
RAF 콜백 안에서 실행되지는 않는다. 그러므로 이 가설은 약하다.

**두 번째 유력한 가설**: `s9`의 `if (!t.graph)` 가드는
**초기 진입 시점**에만 동작하고, **`t.graph.render` 호출 직전에
`graphStore.graph = null`로 set**되면 죽는다. 이는 `setViewerActive(false)`
와 동시에 RAF가 발화하면 발생할 수 있는 진짜 race.

→ **수정 방향**: `s9`의 진입부에 `getActivePinia()` 체크 + `t.graph`를
**로컬 변수로 캡처**해 race 방지.

---

## 5. 추론하면서 헛다리 짚은 것들 (실수 노트)

> 같은 실수 반복하지 않기 위해 적어둠.

### ❌ 5.1 `J7e`는 Vue 컴포넌트의 `render` 메서드라고 추측

- 처음에 `J7e`는 Vue의 컴파일된 `render` 함수일 것이라 추측
- 사실: `J7e`는 **`FlightLogGrapher` 팩토리 자체** (e..t..n..r..i..a..o 7개 인자)
- Vue의 컴파일된 render는 보통 `_sfc_render`라는 이름을 갖는다
- **시간 낭비**: `J7e`가 팩토리인지 인스턴스인지 구별하지 않고 분석 시작

### ❌ 5.2 `T6` / `O6`의 정체를 처음에 `useGraphStore` / `useWorkspaceStore`로 추측 → 맞음

- `T6=gp("graph")`, `O6=gp("workspace")`로 **맞는 추측**이긴 했음
- 다만 `gp`가 무엇인지 (useStore 헬퍼) 추측이 늦었음
- **시간 낭비**: `useGraphStore` 압축 형태를 더 빠르게 확정했어야

### ❌ 5.3 `J7e` 안의 `fontSizePIDTableLabel:null`이 null deref의 원인이라 추측

- 사실 `J7e` 본문 안의 `fontSizePIDTableLabel:null`은 `drawingParams` 초기값일 뿐
- **null deref의 원인은 이게 아님**
- **시간 낭비**: `J7e` 본문을 끝까지 읽었어야 했음

### ❌ 5.4 `a9, o9, i9, r9, M7, s9, D9e, J7e`가 masterconfig에는 없다고 생각

- masterconfig의 src/blackbox-viewer/main.js에는 throttle 없음 (확인)
- 그러나 **`playback_controls.js`에 있음** (이걸 늦게 발견)
- **시간 낭비**: `main.js`만 보고 "우리 빌드에 없는 코드"라고 단정

### ❌ 5.5 masterconfig 빌드 산출물이 `s9/D9e`을 포함 안 한다고 추측

- `grep -rn 'requestAnimationFrame' src/`로 확인 안 하고 추측만 함
- 실제로는 `playback_controls.js:86, 97`에 RAF가 있고 빌드에 포함됨
- **시간 낭비**: 빌드 산출물 디버깅 시 source grep을 먼저 했어야

### ❌ 5.6 `s9`의 `if (!t.graph)` 가드가 race를 막아준다고 단정

- 가드는 **함수 진입 시점의 `t.graph` 값**만 확인
- `t.graph.render(...)` 호출 **직전**에 null이 되면 가드를 못 잡음
- JavaScript 단일 스레드이지만 **await/external callback 사이**는 인터리빙됨
- **시간 낭비**: 단일 가드만으로 충분하다고 단정하지 말 것

### ❌ 5.7 `J7e.render`를 인스턴스의 `.render` 메서드로만 해석

- `J7e`가 팩토리이므로 `J7e.render`는 함수 객체의 속성 `.render`
- `J7e`가 null인 케이스 (e.g. `J7e` import가 실패한 모듈)도 가능
- 그러나 빌드 산출물에는 `J7e`가 정의되어 있으므로 null이 아님
- → 스택의 "null"은 `J7e`가 아니라 **`J7e`가 반환한 인스턴스의 멤버**
  또는 **`J7e` 안에서 호출하는 다른 객체**

### ❌ 5.8 빌드 산출물 `J7e`를 masterconfig 빌드와 비교하려 시도

- masterconfig에는 `node_modules`가 없어 빌드 못 함
- **시간 낭비**: masterconfig 빌드 비교는 불가능. source 비교만 가능.

### ❌ 5.9 `userSettings.graphXxxOverride` 토글이 무한 루프 만든다고 의심

- 3개 토글이 모두 같은 패턴 → 무한 루프는 발생 안 함
- 실제 원인은 다른 곳 (RAF race)
- **시간 낭비**: 토글 함수 자체를 의심하는 건 시간 낭비

### ❌ 5.10 `useGraphStore(pinia)` 와 `useGraphStore()`의 차이를 대수롭지 않게 봄

- store가 destroy/destroy되면 `useGraphStore()` (no pinia)는 null 반환
- **time bomb**: pinia가 active가 아닐 때 호출하면 null
- **시간 낭비**: grapher.js의 `useGraphStore()` (no pinia) 호출을 무시

### ❌ 5.11 masterconfig master의 main.js에는 throttle이 없어서 우리도 없어야 한다고 추측

- 사실 masterconfig의 `playback_controls.js`에 throttle 있음
- **시간 낭비**: main.js만 비교

### ❌ 5.12 `s9`가 `D9e()`로 시작하니까 `D9e`가 `requestAnimationFrame`을 호출한다고 추측

- 사실 `D9e`는 `M7(throttle)`로 한 번만 시작 (idempotent)
- `s9` 자체는 이미 큐잉된 RAF의 콜백
- **시간 낭비**: RAF 시작 구조를 더 빨리 파악했어야

---

## 6. 다음 세션에서 시도할 것 (우선순위)

### P0: race condition 가설 B 검증

`playback_controls.js`의 `animationLoop`에서 `graphStore.graph.render(...)` 호출
**직전**에 `graphStore.graph`를 **로컬 const로 캡처**해서 null 체크.

```js
// before
if (!t.graph) { i9=!1; return }
...
t.graph.render(n.currentBlackboxTime)  // race 가능

// after
const graph = t.graph;
if (!graph) { i9=!1; return }
...
graph.render(n.currentBlackboxTime)  // race 차단
```

masterconfig가 어떤 식으로 가드하는지 확인 (소스 diff).

### P1: setViewerActive(false) 시 RAF 정지 보장

`setViewerActive(false)` 안에서 `cancelAnimationFrame`로 pending RAF 취소.
또는 `animationFrameIsQueued` 플래그를 false로 만들어 다음 tick 진입 차단.

### P2: grapher.js의 `useGraphStore()` → `useGraphStore(pinia)` 통일

- `grapher.js:21-22` `useGraphStore()`, `useWorkspaceStore()` (no pinia)
- → `useGraphStore(pinia)`, `useWorkspaceStore(pinia)`
- `bootstrapViewer`에서 받은 `pinia`를 `FlightLogGrapher` 호출 시 전달

### P3: masterconfig master와의 source diff로 8월 8일 이후 변경 식별

- `git show 250114dd:src/blackbox-viewer/main.js` vs HEAD src/blackbox-viewer/main.js
- `git show 250114dd:src/blackbox-viewer/playback_controls.js` vs HEAD
- `git show 250114dd:src/blackbox-viewer/grapher.js` vs HEAD
- **특히 playback_controls.js의 RAF 핸들링 차이**가 핵심일 가능성

### P4: 사용자 환경 재현

- `main-Bn3laU6Q.js` 빌드가 우리 HEAD에서 나올 수 있는지 확인
- 가능하면 사용자에게 **현재 HEAD를 다시 빌드한 버전**으로 테스트 요청
- 재현되면 dev tools에서 stack trace 다시 캡처

### P5: 브라우저 직접 디버깅

- `npm run dev`로 띄우고
- 3개 버튼 클릭
- console에서 `graphStore`, `t.graph` 값 실시간 확인
- `setActivePinia(pinia)` 호출 여부 확인

---

## 7. 재현 환경 / 재현 절차

- 빌드: `cd /home/betaflight/configurator && npm run build` (성공)
- 산출물: `src/dist/` (HMR로 띄울 때 dist가 stale일 수 있음 → `rm -rf src/dist` 후 재빌드)
- 사용자 환경: Tauri 빌드? Capacitor? 순수 web? — **확인 안 됨**
- 재현 절차 (추정):
  1. 앱 시작 → 블랙박스 탭 이동
  2. 로그 파일 로드 (`.bbl`/`.csv`)
  3. 우측 상단 Expo/Smoothing/Grid 토글 클릭
  4. ~클릭 후 즉시 또는 다음 interaction에 프리징

---

## 8. 핵심 파일 위치 (다음 세션 즉시 보기)

```
src/blackbox-viewer/playback_controls.js   ← animationLoop (RAF, 의심 1순위)
src/blackbox-viewer/main.js                ← bootstrapViewer, teardown, appStore
src/blackbox-viewer/grapher.js             ← useGraphStore() no pinia (의심)
src/blackbox-viewer/vue_init.js            ← setViewerActive (race 진입점)
src/blackbox-viewer/App.vue                ← viewerReady 토글
src/components/tabs/BlackboxViewerTab.vue  ← onActivated/Deactivated
```

---

## 9. 빌드 산출물 위치 (dist)

```
src/dist/assets/main-Dus5eFl7.js   (현재 HEAD, 4MB)
```

빌드 디버깅 시:

```bash
node -e "const c=require('fs').readFileSync('src/dist/assets/main-Dus5eFl7.js','utf8');
console.log(c.indexOf('function J7e'), c.indexOf('function s9'));"
```

---

## 10. masterconfig master 비교용 (next session)

```bash
cd /home/betaflight/masterconfig
# 250114dd 시점의 playback_controls.js (RAF 핸들링)
git show 250114dd:src/blackbox-viewer/playback_controls.js > /tmp/mc_250_pc.js
# HEAD의 같은 파일
git show HEAD:src/blackbox-viewer/playback_controls.js > /tmp/mc_head_pc.js
diff /tmp/mc_250_pc.js /tmp/mc_head_pc.js
```

`grapher.js`도 동일:

```bash
diff <(git show 250114dd:src/blackbox-viewer/grapher.js) <(git show HEAD:src/blackbox-viewer/grapher.js)
```

`250114dd` 시점과 HEAD 사이에 우리가 누락한 **masterconfig의 후속 커밋** 중
`playback_controls.js` 또는 `grapher.js`를 건드린 것이 있는지 확인:

```bash
cd /home/betaflight/masterconfig
git log --oneline 250114dd..HEAD -- src/blackbox-viewer/playback_controls.js src/blackbox-viewer/grapher.js
```

→ 결과: **이번 세션에서 확인 안 됨 (놓침)**. 다음 세션 첫 명령으로 실행.

---

## 11. 작업 환경 / 디렉토리

- 작업 루트: `/home/betaflight/configurator`
- 비교 대상: `/home/betaflight/masterconfig` (별도 작업장, node_modules 없음)
- git: HEAD가 4개 cherry-pick 결과. master remote는 origin/master만 있고 masterconfig는 별도 fetch
- 빌드 명령: `npm run build` (vite)
- 테스트 명령: `npx vitest run` (379/379 pass)

---

## 12. 키워드 / 인덱스

- `J7e` = FlightLogGrapher 팩토리
- `s9` = animationLoop (RAF tick)
- `D9e` = RAF/idempotent throttle 시작
- `M7` = lodash throttle
- `a9` = values throttler (250ms)
- `o9` = seekbar throttler (200ms)
- `i9` = "graph null" bail flag
- `r9` = last play start time
- `t9` = values update function
- `zv` = pinia instance
- `gp` = useStore helper
- `T6` = useGraphStore, `w6` = useLogStore, `E6` = usePlaybackStore, `c6` = useSettingsStore, `D6` = usePlaybackStore (?)
- `a9, o9, i9` = throttled wrappers + flags
- `i9=!1` = "graph null next tick" 플래그 (animationFrameIsQueued = false?)

---

## 13. 가정 / 미해결 사항

1. **사용자 환경 재현 안 됨**: 사용자 PC에서 dev/build로 다시 테스트 필요
2. **main-Bn3laU6Q.js 해시**: 어떤 빌드인지 식별 불가 (사용자 디바이스 캐시?)
3. **masterconfig 후속 커밋 차이**: 8/8 이후 grapher.js/playback_controls.js 변경 미확인
4. **3버튼과 race의 직접 연결**: 의심만 있고 확정 안 됨. 3버튼은 단지
   settings ref를 갱신 → watcher가 `graph.refreshOptions` 호출 → 그 안에서
   `graphStore.graph.refreshOptions(userSettings)` → ... 호출 체인 중
   한 곳에서 race가 발생할 가능성. **가장 의심: `invalidateGraph` 또는
   `updateCanvasSize`의 RAF 재큐잉**
5. **upstream master의 8/8~9/3 사이 hot fix**: `git log 250114dd..HEAD` (masterconfig)를
   다시 확인 필요. 5bb8b89e, 63d76abb, 9c6cfa01, 698bb950 등의 변경이
   freeze fix를 포함할 수 있음

---

## 14. 다음 세션 시작 체크리스트

- [ ] `cd /home/betaflight/configurator && git log --oneline -5` (HEAD 확인)
- [ ] `cd /home/betaflight/masterconfig && git log --oneline 250114dd..HEAD -- src/blackbox-viewer/` (누락 커밋 식별)
- [ ] `diff <(git show 250114dd:src/blackbox-viewer/playback_controls.js) <(git show HEAD:src/blackbox-viewer/playback_controls.js)` (RAF 차이)
- [ ] `diff <(git show 250114dd:src/blackbox-viewer/grapher.js) <(git show HEAD:src/blackbox-viewer/grapher.js)` (grapher 차이)
- [ ] P2 (grapher.js `useGraphStore()` → `useGraphStore(pinia)`) 적용 후 빌드 + 사용자 테스트
- [ ] P0 (animationLoop 내 `t.graph` 로컬 캡처 + null guard) 적용 후 빌드 + 사용자 테스트
- [ ] 재현 시 dev tools에서 stack trace 캡처
- [ ] 위 P0/P1/P2 모두 적용 후에도 재현되면 P3 (masterconfig 후속 cherry-pick)

---

**기록자**: AI (Cline) / 마지막 편집: 2026-09-03
**현 상태**: 분석 단계, 수정 미적용. 다음 세션은 §14 체크리스트부터.



이후 2번의 아래 코드 수정이 있었지만 여전히 문제 해결이 안되었다.

```
5d9f11b87 Fix blackbox viewer freeze: apply P2 fixes for pinia integration
97e0f5afc Fix blackbox viewer freeze race condition in animationLoop
```
