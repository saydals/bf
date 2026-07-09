# Betaflight Configurator Fork (saydals/bf) — USB/DFU 수정 지시서

> **대상 독자:** 코딩 AI (Claude / GPT / Cursor 등)
> **원본 저장소:** https://github.com/betaflight/betaflight-configurator (branch: `master`, HEAD `511c4cf`)
> **포크 저장소:** https://github.com/saydals/bf (branch: `master`, HEAD `2f08350`, 2026-07-07)
> **공통 버전:** `2026.6.0-alpha` (package.json)
> **작성일:** 2026-07-08
> **문서 목적:** 포크의 USB 인식 및 DFU 감지 문제를 원본 대비 diff 기반으로 식별하고, 선택적 병합 전략으로 수정하기 위한 체크리스트

---

## 0. 핵심 요약 (코딩 AI는 먼저 이것을 읽을 것)

### 0.1 사용자 인식 vs 실제 문제

| 사용자 인식 | 실제 분석 결과 |
|---|---|
| "DFU를 제대로 인식하지 못함" | **DFU 코어(감지/프로토콜/전송)는 원본과 바이트 단위로 동일하며 정상 작동함.** 직접 DFU 모드(보드가 이미 DFU로 부팅된 경우)는 정상 인식됨. |
| "USB 인식 탭 구조가 원본보다 기능이 떨어져 보임" | **포트 피커 UI(PortPicker/PortsInput/ConnectButton)는 원본과 동일하게 완전함.** 차이는 "탭 구조"가 아니라 **연결 오케스트레이션 계층의 stale sync**에서 발생. |
| "DFU 인식 불가" | 진짜 깨진 경로는 **STM32 시리얼 부트로더 플래싱** (`webstm32.js`). 시리얼 연결 → MSP reboot → DFU 대기 흐름에서 데이터 수신이 `undefined`로 떨어져 재부팅 후 DFU 장치를 기다리는 폴링이 의미 없이 타임아웃됨. |

### 0.2 수정 우선순위 (P0 → P3)

| Priority | Issue | 파일 | 난이도 | 영향 |
|---|---|---|---|---|
| **P0** | `webstm32.js` receive adapter가 잘못된 이벤트 속성 읽음 | `src/js/protocols/webstm32.js` | 낮음 (1줄) | 시리얼→DFU 플래싱 전체 경로 복구 |
| **P1** | `serial.js` 활성 전송계층 이벤트 게이트 누락 | `src/js/serial.js` | 중간 | 크로스-전송계층 이벤트 누출 방지 |
| **P2** | `connection_state.js`가 디스크에만 존재, 소비자 미연동 | `serial_backend.js`, `webstm32.js`, `port_handler.js`, `useFirmwareFlashing.js` | 높음 (4파일 동시 수정) | FLASHING 중 연결 차단, 리부트 재연결 다이얼로그 억제, 포트 선택 안정성 |
| **P3** | Android DFU 네이티브 플러그인 가용성 검증 누락 | `src/js/protocols/CapacitorDfu.js` | 낮음 | Android 빌드 안정성 |

### 0.3 전략: 선택적 병합 (Selective Merge)

- **DFU 코어는 그대로 유지** (`devices.js`, `usbdfu.js`, `WebUsbDfuTransport.js`, `CapacitorDfu*.js`, `FirmwareFlasherTab.vue`, `checkCompatibility.js`) — 원본과 동일하므로 수정 금지.
- **연결 오케스트레이션 계층은 원본에서 동기화** (`serial.js`, `serial_backend.js`, `webstm32.js`, `port_handler.js`, `useFirmwareFlashing.js`, `connection_state.js`) — 이들 파일은 하나의 coordinated change-set으로 함께 이동해야 함. 부분 동기화는 P2 이슈를 재현함.
- **포크 고유 변경분 보존**: FlightPlan 기능 (waypoint, AGL/AMSL, speed timers 등), CLI 출력 버퍼 5배 증가, resources 폴더 복구 등은 건드리지 않음. 이들은 `src/components/tabs/FlightPlan*`, `src/js/...` (FlightPlan 관련), CLI 버퍼 사이즈 상수에 국함.

---

## 1. 아키텍처 개요

### 1.1 두 저장소 공통 아키텍처

두 저장소 모두 **레거시 Chrome App이 아님**. Vue 3 + Vite PWA이며 Tauri(데스크톱)와 Capacitor(Android/iOS)로 패키징됨.

```
src/
├── js/
│   ├── serial.js                  # 전송계층 파사드 (WebSerial/BLE/WS/Virtual/Capacitor/Tauri 멀티플렉스)
│   ├── serial_backend.js          # MSP 연결 오케스트레이터 (connectDisconnect, onOpen, onClosed, rebootReconnect)
│   ├── port_handler.js            # 포트 목록 관리 + selectActivePort + dfuProtocol 홀더
│   ├── port_usage.js              # 포트 사용 추적
│   ├── connection_state.js        # 연결 단계 상태머신 (IDLE/CONNECTING/HANDSHAKING/CONNECTED/CLI/REBOOTING/RECONNECTING/FLASHING/FAILED)
│   ├── msp.js + msp/              # MSP 프로토콜 (MSP_SET_REBOOT → 부트로더 진입)
│   ├── fc.js                      # FC 상태 모델
│   ├── gui.js                     # GUI 글로벌 상태
│   ├── tab_switch.js              # 탭 전환 로직
│   ├── vue_tab_registry.js        # 탭 id → Vue 컴포넌트 매핑
│   ├── utils/
│   │   └── checkCompatibility.js  # checkSerialSupport / checkBluetoothSupport / checkUsbSupport / isAndroid / isTauri
│   ├── protocols/
│   │   ├── devices.js             # VID/PID 필터 테이블 (DFU + 시리얼 + BLE) + 원격 로딩
│   │   ├── usbdfu.js              # UsbDfuProtocol (DFU 상태머신, 1268줄) ← 전송계층 독립
│   │   ├── WebUsbDfuTransport.js  # navigator.usb DFU 전송 (데스크톱)
│   │   ├── CapacitorDfu.js        # Android 네이티브 DFU 플러그인 어댑터
│   │   ├── CapacitorDfuTransport.js # CapacitorDfu 전송 shim (Android)
│   │   ├── webstm32.js            # STM32Protocol (시리얼 ROM 부트로더 플래싱) ← 🔴 P0 이슈
│   │   ├── esp32.js               # ESP32 (esptool-js)
│   │   ├── WebSerial.js           # navigator.serial 전송
│   │   ├── WebBluetooth.js        # navigator.bluetooth 전송
│   │   ├── WebSocket.js           # TCP/WS 전송
│   │   ├── VirtualSerial.js       # 가상 FC
│   │   ├── CapacitorSerial.js / CapacitorBle.js / CapacitorTcp.js  # Android 전송
│   │   └── TauriSerial.js / TauriTcp.js                            # 데스크톱 전송
│   └── ConfigInserter.js          # unified config (custom defaults) HEX 삽입
├── components/
│   ├── tabs/
│   │   ├── FirmwareFlasherTab.vue          # 펌웨어 플래셔 탭 (96KB, 원본과 동일)
│   │   ├── firmware-flasher/
│   │   │   ├── FlasherBoardBuildTab.vue
│   │   │   └── FlasherFlashTab.vue
│   │   ├── PortsTab.vue                    # FC UART 기능 설정 탭 (USB 스캐너 아님)
│   │   └── ... (다른 탭들)
│   └── port-picker/
│       ├── PortPicker.vue
│       ├── PortsInput.vue                  # 포트 드롭다운 (시리얼/BLE/USB(DFU)/virtual/manual + 권한요청 항목)
│       ├── ConnectButton.vue
│       ├── ConnectOptionsDialog.vue
│       ├── PortOverrideOption.vue
│       └── FirmwareVirtualOption.vue
├── composables/
│   └── useFirmwareFlashing.js              # 플래싱 워크플로 (DFU vs STM32 vs UF2 vs ESP32 결정)
└── ...
```

### 1.2 연결 흐름도 (정상 — 원본 기준)

```
[사용자: 포트 선택]
        ↓
PortHandler.selectActivePort()
        ↓
serial_backend.connectDisconnect()  ──→  serial.connect(port, baud)
        ↓                                          ↓
onOpen() → MSP handshake                    WebSerial.open() / TauriSerial / ...
        ↓
CONNECTED 상태

[펌웨어 플래싱 - 시리얼 경로]
FirmwareFlasherTab → useFirmwareFlashing.startFlashing()
        ↓
port.startsWith("serial") → STM32.connect(port, baud, hex, options)
        ↓
mspConnector.connect(reboot_baud) → MSP_BOARD_INFO → rebootMode 결정 (1=ROM, 4=FlashBL)
        ↓
MSP_SET_REBOOT(rebootMode)
        ↓
FC 재부팅 → 시리얼 링크 드롭 → handleDisconnect()
        ↓
PortHandler.dfuProtocol.waitForDfu(4000, 500)  ← 폴링
        ↓
DFU_AUTH_REQUIRED? → requestPermission() (사용자 제스처)
        ↓
UsbDfuProtocol.connect(devicePath, hex, options)
        ↓
upload_procedure(0) → getChipInfo → option-bytes → erase → program → verify → leave
        ↓
cleanup() → callback

[펌웨어 플래싱 - DFU 직접 경로]
port.startsWith("usb") → PortHandler.dfuProtocol.connect(port, firmware, options)
        ↓ (위와 동일한 upload_procedure 흐름)
```

### 1.3 포크의 깨진 지점 (P0)

```
STM32.connect() → mspConnector.connect() → serial.addEventListener("receive", readSerialAdapter)
                                                        ↓
                                        readSerialAdapter(event) {
                                            read_serial(event.detail.buffer);  // 🔴 undefined!
                                            //   ↑ serial.js 파사드는 { data, protocolType }로 래핑함
                                            //   event.detail.buffer는 존재하지 않음
                                        }
        ↓
MSP.read(undefined) → 핸드셰이크 실패 / 타임아웃
        ↓
reboot()가 호출되더라도 DFU 대기 폴링이 보드 상태를 정상적으로 추적하지 못함
```

---

## 2. 파일 경로 맵 (전체 참조)

### 2.1 수정 대상 파일 (연결 오케스트레이션 계층)

| 파일 경로 | 포크 상태 | 권장 조치 | 우선순위 |
|---|---|---|---|
| `src/js/protocols/webstm32.js` | 🔴 P0 버그 + stale | 원본에서 동기화 (receive adapter + connection_state 연동) | **P0** |
| `src/js/serial.js` | ⚠️ 이벤트 게이트 누락 | 원본의 `_setupEventForwarding` 분리 구조로 교체 | **P1** |
| `src/js/serial_backend.js` | ⚠️ connection_state 미사용 | 원본에서 동기화 (isFlasing 하드블록, 리부트 재연결 다이얼로그 억제, intentionalDisconnect API) | **P2** |
| `src/js/port_handler.js` | ⚠️ hadRealSelection 휴리스틱 | 원본의 isReconnecting 기반 selectActivePort로 교체 | **P2** |
| `src/composables/useFirmwareFlashing.js` | ⚠️ ESP32 경로 FLASHING 미설정 | beginDeviceReplacement/endFlasing 호출 추가 | **P2** |
| `src/js/connection_state.js` | ⚠️ 디스크에만 존재 (dead code) | 위 4개 파일 동기화 시 자동 활성화 | **P2** |

### 2.2 수정 금지 파일 (DFU 코어 — 원본과 동일)

| 파일 경로 | 상태 | 비고 |
|---|---|---|
| `src/js/protocols/devices.js` | ✅ 동일 | VID/PID 필터 (STM32 DFU 0x0483:0xDF11 = 1155:57105 포함) |
| `src/js/protocols/usbdfu.js` | ✅ 동일 | 1268줄 DFU 상태머신 (erase/write/verify/leave/unprotect) |
| `src/js/protocols/WebUsbDfuTransport.js` | ✅ 동일 | navigator.usb DFU 전송 |
| `src/js/protocols/CapacitorDfu.js` | ✅ 동일 | Android 네이티브 플러그인 어댑터 (P3 별도 검증) |
| `src/js/protocols/CapacitorDfuTransport.js` | ✅ 동일 | Android 전송 shim |
| `src/components/tabs/FirmwareFlasherTab.vue` | ✅ 동일 (96854 bytes) | 플래셔 UI 전체 |
| `src/components/tabs/firmware-flasher/*.vue` | ✅ 동일 | 플래셔 서브탭 |
| `src/components/port-picker/*.vue` | ✅ 동일 | 포트 피커 UI |
| `src/js/utils/checkCompatibility.js` | ✅ 동일 | checkUsbSupport / checkSerialSupport |
| `src/js/protocols/WebSerial.js` | ✅ 동일 | navigator.serial 전송 |
| `src/js/protocols/WebBluetooth.js` | ✅ 동일 | navigator.bluetooth 전송 |
| `src/js/protocols/esp32.js` | ✅ 동일 | ESP32 esptool-js |
| `src/js/ConfigInserter.js` | ✅ 동일 | unified config 삽입 |

### 2.3 포크 고유 변경분 (보존 대상 — 건드리지 말 것)

- `src/components/tabs/` 내 FlightPlan 관련 컴포넌트 (waypoint, AGL/AMSL, speed timers)
- CLI 출력 버퍼 사이즈 상수 (5배 증가, 커밋 `2f08350`)
- `resources/` 폴더 (커밋 `065da4b` 복구)
- FlightPlan i18n 문자열
- `git log --oneline` 로 `saydals` 커밋을 확인하여 FlightPlan/CLI 버퍼 관련 변경은 보존

### 2.4 빌드/패키지 파일

| 파일 | 비고 |
|---|---|
| `package.json` | Tauri 2 + Capacitor 8 + Vue 3.5 + Vite 8 |
| `vite.config.js` | VitePWA 인라인 매니페스트 (USB 권한 선언 없음 — PWA 방식), mkcert로 dev HTTPS (`local.betaflight.com:8443`) |
| `capacitor.config.base.json` | Capacitor (Android/iOS) 베이스 설정 |
| `DFU_ANDROID_IMPLEMENTATION.md` | Android 네이티브 DFU 플러그인 문서 |
| `CAPACITOR_SERIAL_IMPLEMENTATION.md` | Android 시리얼 플러그인 문서 |

> **참고:** `manifest.json` (Chrome App)과 `background.js`는 존재하지 않음. WebUSB/WebSerial 권한은 런타임 `requestDevice`/`requestPort`로 처리되며, 이는 PWA의 올바른 동작 방식임.

---

## 3. 문제 분석 및 해결 체크리스트

### 🔴 P0: `webstm32.js` Receive Adapter 버그 (시리얼→DFU 경로 복구)

#### 문제

포크의 `src/js/protocols/webstm32.js` (lines 20–26, 309)는 레거시 버전을 유지:

```javascript
// 포크 (BROKEN)
import { read_serial } from "../serial_backend";
...
function readSerialAdapter(event) {
    read_serial(event.detail.buffer);   // 🔴 event.detail.buffer는 undefined
}
...
serial.addEventListener("receive", readSerialAdapter);  // line 309
```

그러나 포크 자체의 `src/js/serial.js` 파사드 (lines 70–73)는 모든 `receive` 이벤트를 `{ data, protocolType }`로 래핑:

```javascript
// 포크의 serial.js (정상)
if (event.type === "receive") {
    newDetail = { data: event.detail, protocolType: name };
}
```

따라서 `event.detail.buffer`는 항상 `undefined`이고, `read_serial(undefined)` → `MSP.read(undefined)`로 이어져 MSP 핸드셰이크가 실패함.

포크의 `serial_backend.js` 자체는 올바른 속성을 읽음 (`read_serial_adapter`: `read_serial(event.detail.data)`, line 522)으로, 파사드 계약이 `.data`임이 증명됨.

#### 영향

- **STM32 시리얼 ROM 부트로더 플래싱 경로 전체 무력화**
- MSP reboot-to-bootloader 후 DFU 대기 폴링이 보드 상태를 정상 추적하지 못함
- 사용자가 "DFU 인식 불가"로 인지하는 현상의 실제 원인
- **DFU 직접 모드(보드가 이미 DFU로 부팅)는 영향 없음** — `usbdfu.js`는 `webstm32.js`를 거치지 않음

#### 해결 — 원본에서 동기화

원본 `betaflight-configurator/master`의 `src/js/protocols/webstm32.js`는 `read_serial` import를 제거하고 MSP를 직접 호출:

```javascript
// 원본 (CORRECT)
// import { read_serial } from "../serial_backend";  ← 제거됨
import MSP from "../msp";
...
function readSerialAdapter(event) {
    MSP.read(event.detail.data);   // ✅ 파사드 계약 일치
}
```

#### 체크리스트

- [ ] **P0-1:** `src/js/protocols/webstm32.js`에서 `import { read_serial } from "../serial_backend";` 제거
- [ ] **P0-2:** `readSerialAdapter` 함수 본문을 `read_serial(event.detail.buffer)` → `MSP.read(event.detail.data)`로 교체
- [ ] **P0-3:** `MSP` import가 파일 상단에 존재하는지 확인 (없으면 추가)
- [ ] **P0-4:** 파일 내 `read_serial` 참조가 더 이상 없는지 `rg "read_serial" src/js/protocols/webstm32.js`로 검증
- [ ] **P0-5:** 빌드 후 시리얼 연결 → 펌웨어 플래셔 → "Flash firmware" 클릭 → MSP reboot → DFU 대기 → 플래싱 성공 확인
- [ ] **P0-6:** 콘솔에서 `MSP.read` 호출 시 `event.detail.data`가 `Uint8Array`로 들어오는지 브레이크포인트/로그로 확인

#### 검증 명령

```bash
# 원본과 diff 확인
git diff master..upstream/master -- src/js/protocols/webstm32.js

# 수정 후 read_serial 참조 없는지 확인
rg "read_serial" src/js/protocols/webstm32.js
# (빈 출력이어야 함)

# MSP.read 호출 확인
rg "MSP.read" src/js/protocols/webstm32.js
# (최소 1개 이상 매칭)
```

---

### 🟡 P1: `serial.js` 활성 전송계층 이벤트 게이트 누락

#### 문제

포크의 `src/js/serial.js` `_setupEventForwarding()` (lines 63–99)는 모든 전송계층에서 모든 이벤트를 포워딩:

```javascript
// 포크 (BROKEN — 게이트 없음)
const events = ["addedDevice", "removedDevice", "connect", "disconnect", "receive"];
for (const { name, instance } of this._protocols) {
    for (const eventType of events) {
        instance.addEventListener(eventType, (event) => {
            // ... 모든 전송계층의 이벤트를 디스패치
        });
    }
}
```

원본은 이벤트를 두 그룹으로 분리:
- `deviceEvents` (`addedDevice`, `removedDevice`): 모든 전송계층에서 포워딩 (핫플러그 감지용)
- `lifecycleEvents` (`connect`, `disconnect`, `receive`): **활성 `this._protocol`에서만** 포워딩

#### 영향

- 비활성 전송계층의 스트레이 lifecycle 이벤트가 활성 연결에 영향
- 예: BLE `gattserverdisconnected`가 사용자가 시리얼 FC로 전환 후 발생하면 `onClosed`/`read_serial`이 라이브 연결에 대해 실행되어 손상
- DFU 플래싱 중 시리얼 전송계층의 잔여 이벤트가 간섭할 수 있음

#### 해결 — 원본 구조로 교체

```javascript
// 원본 (CORRECT)
_setupEventForwarding() {
    const deviceEvents = ["addedDevice", "removedDevice"];
    const lifecycleEvents = ["connect", "disconnect", "receive"];

    // 디바이스 이벤트: 모든 전송계층에서 포워딩
    for (const { name, instance } of this._protocols) {
        for (const eventType of deviceEvents) {
            instance.addEventListener(eventType, (event) => {
                this.dispatchEvent(new CustomEvent(eventType, { detail: this._tagDetail(event.detail, name) }));
            });
        }
    }

    // lifecycle 이벤트: 활성 전송계층에서만 포워딩
    for (const eventType of lifecycleEvents) {
        this.addEventListener(eventType, (event) => {
            if (this._protocol !== /* 현재 전송계층 */) return;  // 게이트
            // ... 포워딩
        });
    }
}
```

> 정확한 구현은 원본 `serial.js`를 직접 참조하여 `_setupEventForwarding`, `_tagDetail`, `selectProtocol` 메서드를 동기화할 것.

#### 체크리스트

- [ ] **P1-1:** 원본 `src/js/serial.js`의 `_setupEventForwarding` 메서드 전체를 포크로 복사
- [ ] **P1-2:** `_tagDetail` 헬퍼 메서드 동기화 (이벤트 detail에 전송계층 이름 태깅)
- [ ] **P1-3:** `selectProtocol` 메서드가 활성 전송계층 전환 시 이전 전송계층의 lifecycle 리스너를 해제하는지 확인
- [ ] **P1-4:** `deviceEvents`와 `lifecycleEvents` 배열 분리 확인
- [ ] **P1-5:** 포크 고유 변경분 (있다면) 보존 — `git diff`로 확인 후 병합
- [ ] **P1-6:** 시리얼 연결 중 BLE 장치 연결/해제 시 활성 시리얼 연결이 유지되는지 테스트
- [ ] **P1-7:** DFU 플래싱 중 시리얼 포트 이벤트가 간섭하지 않는지 테스트

---

### 🟡 P2: `connection_state.js` 동기화 (4파일 coordinated change-set)

#### 문제 배경

원본은 `connection_state.js`를 통해 연결 라이프사이클 전체를 상태머신으로 관리:
- 단계: `IDLE → CONNECTING → HANDSHAKING → CONNECTED → (CLI | REBOOTING → RECONNECTING) → FLASHING → FAILED`
- API: `getConnectionState()`, `setPhase()`, `markIntentionalDisconnect()`, `consumeIntentionalDisconnect()`, `beginDeviceReplacement()`, `endFlashing()`, `linkOpen`, `isFlashing`, `isReconnecting`

포크는 `connection_state.js` 모듈을 디스크에 가지고 있으나 (202줄, 모든 단계 포함), **소비자가 구버전**:
- `serial_backend.js`: 모듈 private `let isConnected = false` / `let intentionalDisconnect = false` 사용
- `webstm32.js`: `beginDeviceReplacement()`/`endFlashing()` 호출 없음
- `port_handler.js`: `isReconnecting` 대신 `hadRealSelection` 휴리스틱 사용
- `useFirmwareFlashing.js`: ESP32 경로에 FLASHING 상태 미설정

#### 영향 (개별)

**P2-a: `serial_backend.js` — FLASHING 하드블록 누락**
- 원본은 `connectDisconnect()`에서 `getConnectionState().isFlashing` 하드블록 (defence-in-depth, `GUI.connect_lock`와 별개)
- 포크는 `GUI.connect_lock`만 의존 — 플래셔가 설정하지 않으면 연결 시도 가능
- 리부트 재연결 중 "Connection failed" 다이얼로그가 항상 표시됨 (원본은 `isRebootReconnecting && autoConnect`일 때 억제)
- 제거된 장치 매칭에 null 가드 없음: `event.detail.path === GUI.connected_to` (원본은 `event.detail?.path && ...`)

**P2-b: `webstm32.js` — FLASHING 단계 미설정**
- 원본은 플래시 시작 시 `getConnectionState().beginDeviceReplacement()` (FLASHING 진입), 완료/중단 시 `endFlashing()`
- 포크는 둘 다 없음 — P0 수정과 함께 이 부분도 동기화 필요

**P2-c: `port_handler.js` — `selectActivePort` 약한 휴리스틱**
- 원본: `getConnectionState().isReconnecting`일 때 virtual/manual 폴백 억제, 이전 포트 유지
- 포크: `hadRealSelection` 로컬 휴리스틱 (lines 234–241, 299–305) — 모든 리부트 재연결 케이스 커버 불가

**P2-d: `useFirmwareFlashing.js` — ESP32 경로 FLASHING 미설정**
- 원본: ESP32 `.bin` 플래싱 시 `beginDeviceReplacement()`/`endFlashing()` 호출
- 포크: 누락

#### 해결 — 4파일을 하나의 change-set으로 동기화

> **주의:** 이 4파일은 서로 의존적임. 부분 동기화는 P2 이슈를 재현하거나 새로운 버그를 만듦. 반드시 원본에서 함께 가져올 것.

#### 체크리스트

- [ ] **P2-1:** 원본 `src/js/serial_backend.js` 전체를 포크로 덮어쓰기 (단, 포크 고유 변경분이 있다면 3-way merge)
- [ ] **P2-2:** `isFlashing` 하드블록이 `connectDisconnect()`에 있는지 확인
- [ ] **P2-3:** `isRebootReconnecting && autoConnect`일 때 "Connection failed" 다이얼로그 억제 로직 있는지 확인
- [ ] **P2-4:** `event.detail?.path && event.detail.path === GUI.connected_to` null 가드 있는지 확인
- [ ] **P2-5:** `intentionalDisconnect` 대신 `markIntentionalDisconnect()`/`consumeIntentionalDisconnect()` API 사용하는지 확인
- [ ] **P2-6:** `setPhase(CONNECTING/HANDSHAKING/CONNECTED/CLI/FAILED)` 호출 지점 모두 동기화
- [ ] **P2-7:** `document.getElementById("rebootProgressDialog")` 대신 dialog store 사용하는지 확인
- [ ] **P2-8:** 원본 `src/js/protocols/webstm32.js` 전체 동기화 (P0 수정 포함) — `beginDeviceReplacement()`/`endFlashing()` 호출 지점 확인
- [ ] **P2-9:** 원본 `src/js/port_handler.js`의 `selectActivePort` 동기화 — `isReconnecting` 기반 폴백 억제 확인
- [ ] **P2-10:** 원본 `src/composables/useFirmwareFlashing.js` 동기화 — ESP32 경로의 `beginDeviceReplacement()`/`endFlashing()` 확인
- [ ] **P2-11:** 동기화 후 `connection_state.js`가 더 이상 dead code가 아닌지 `rg "getConnectionState|connection_state" src/js/ src/composables/ src/components/`로 검증
- [ ] **P2-12:** 시리얼 플래싱 → 리부트 → 자동 재연결 흐름에서 "Connection failed" 다이얼로그가 뜨지 않는지 테스트
- [ ] **P2-13:** 플래싱 중 Connect 버튼이 비활성화되는지 (`isFlashing` 하드블록) 테스트
- [ ] **P2-14:** 핫플러그로 장치 제거 시 `GUI.connected_to`가 null이어도 크래시 없는지 테스트

#### 검증 명령

```bash
# connection_state 사용 빈도 비교
rg "getConnectionState|connection_state" src/js/ src/composables/ src/components/ --count-matches

# isFlasing 하드블록 확인
rg "isFlashing" src/js/serial_backend.js

# beginDeviceReplacement / endFlashing 호출 지점
rg "beginDeviceReplacement|endFlashing" src/js/ src/composables/

# isRebootReconnecting 사용
rg "isRebootReconnecting|isReconnecting" src/js/serial_backend.js src/js/port_handler.js
```

---

### 🟢 P3: Android DFU 네이티브 플러그인 가용성 검증

#### 문제

`src/js/protocols/CapacitorDfu.js`는 `Capacitor.Plugins.BetaflightDfu`를 래핑. 플러그인이 없으면 생성자가 `console.error`만 출력하고 반환하며, 이후 `this.ports`/메서드가 undefined가 되어 호출 시 예외 발생.

```javascript
// CapacitorDfu.js (포크 = 원본, 동일)
constructor() {
    if (!Capacitor.Plugins.BetaflightDfu) {
        console.error("BetaflightDfu plugin not available");
        return;  // 🔴 this.ports가 undefined로 남음
    }
    ...
}
```

`checkUsbSupport()`는 Android에서 무조건 `true`를 반환하므로, 플러그인 누락 시 graceful fallback이 없음.

#### 영향

- Android 빌드에서 `BetaflightDfu` Capacitor 플러그인이 누락된 경우 DFU 시도 시 예외
- 포크 고유 이슈는 아님 (원본과 동일) — 그러나 포크 빌드 파이프라인에서 플러그인이 실제로 포함되는지 검증 필요

#### 해결

```javascript
// 개선안 (선택적)
constructor() {
    this.available = !!Capacitor.Plugins?.BetaflightDfu;
    if (!this.available) {
        console.warn("BetaflightDfu plugin not available — Android DFU disabled");
        this.ports = [];
        return;
    }
    ...
}

isAvailable() { return this.available; }
```

그리고 `port_handler.js`의 `createDfuProtocol()`에서 Android 분기 시 `CapacitorDfu.isAvailable()` 체크 후 fallback:

```javascript
function createDfuProtocol() {
    if (isAndroid() && CapacitorDfu.isAvailable()) {
        return new UsbDfuProtocol(new CapacitorDfuTransport());
    }
    return defaultDfu;  // WebUsbDfuTransport 싱글톤
}
```

#### 체크리스트

- [ ] **P3-1:** Android 빌드에서 `BetaflightDfu` 플러그인이 실제로 포함되는지 `capacitor.config.base.json`과 Android 네이티브 프로젝트 확인
- [ ] **P3-2:** `CapacitorDfu.js`에 `available` 플래그와 `isAvailable()` 메서드 추가 (선택)
- [ ] **P3-3:** `port_handler.js`의 `createDfuProtocol()`에 가용성 체크 추가 (선택)
- [ ] **P3-4:** 실제 Android 기기에서 DFU 플래싱 테스트 (가능한 경우)

---

## 4. 디버깅 가이드

### 4.1 문제 재현 시나리오

#### 시나리오 A: 시리얼 플래싱 실패 (P0)

1. FC를 시리얼로 연결 (USB-CDC 또는 FTDI)
2. Firmware Flasher 탭 → 보드/빌드 선택 → "Flash firmware" 클릭
3. **예상 (버그):** MSP reboot 후 DFU 대기 타임아웃, "No DFU device found" 에러
4. **콘솔 확인:** `MSP.read` 호출 시 인자가 `undefined`인지 브레이크포인트
5. **수정 후:** MSP reboot → DFU 장치 자동 감지 → 플래싱 진행

#### 시나리오 B: DFU 직접 모드 (정상 작동해야 함)

1. FC를 DFU 모드로 부팅 (부트로더 버튼 누르고 USB 연결, 또는 이미 DFU인 상태)
2. 장치 관리자 / `lsusb`에서 `STMicroelectronics STM Device in DFU Mode` (VID:PID `0483:DF11`) 확인
3. Configurator 포트 드롭다운에 `usb_...` 항목 표시
4. Firmware Flasher → "Flash firmware" → 정상 플래싱
5. **이 시나리오는 P0 수정과 무관하게 작동해야 함** — 작동하지 않으면 WebUSB 권한/브라우저 이슈 (4.3 참조)

#### 시나리오 C: 리부트 재연결 다이얼로그 (P2)

1. 시리언 연결 상태에서 CLI 탭 → `save` 또는 설정 변경 후 저장
2. FC 재부팅 → 자동 재연결
3. **예상 (버그):** "Connection failed" 다이얼로그 표시
4. **수정 후:** 다이얼로그 없이 자동 재연결

### 4.2 콘솔 디버깅 명령

Chrome DevTools 콘솔에서 실행:

```javascript
// 1. WebUSB 가용성
console.log("navigator.usb:", !!navigator.usb);
console.log("navigator.serial:", !!navigator.serial);

// 2. 이미 권한을 가진 DFU 장치 목록
navigator.usb.getDevices().then(devs => console.table(devs.map(d => ({
    vendorId: d.vendorId?.toString(16),
    productId: d.productId?.toString(16),
    productName: d.productName,
    serialNumber: d.serialNumber,
    isDfu: d.vendorId === 0x0483 && d.productId === 0xDF11,
}))));

// 3. 이미 권한을 가진 시리얼 포트
navigator.serial.getPorts().then(ports => console.log("Serial ports:", ports));

// 4. PortHandler 상태 (Configurator 실행 중)
console.log("PortHandler.currentUsbPorts:", PortHandler.currentUsbPorts);
console.log("PortHandler.currentSerialPorts:", PortHandler.currentSerialPorts);
console.log("PortHandler.dfuAvailable:", PortHandler.dfuAvailable);
console.log("PortHandler.portPicker:", PortHandler.portPicker);

// 5. 연결 상태 (P2 수정 후)
import('./src/js/connection_state.js').then(m => console.log("Connection state:", m.getConnectionState()));

// 6. STM32 프로토콜 상태
console.log("STM32:", STM32);

// 7. 이벤트 리스너 추적
serial.addEventListener("receive", e => console.log("[recv]", e.detail));
serial.addEventListener("connect", e => console.log("[conn]", e.detail));
serial.addEventListener("disconnect", e => console.log("[disc]", e.detail));
```

### 4.3 WebUSB / 브라우저 정책 이슈 (DFU 직접 모드가 안 될 때)

DFU 직접 모드(시나리오 B)가 작동하지 않으면 P0 수정과 무관한 브라우저 이슈일 수 있음:

| 증상 | 원인 | 해결 |
|---|---|---|
| `navigator.usb`가 undefined | HTTP (비보안 컨텍스트) | HTTPS 또는 localhost 사용. dev 서버는 `vite-plugin-mkcert`로 `https://local.betaflight.com:8443` 사용 |
| `requestDevice`가 "Must be handling a user gesture" 에러 | 사용자 제스처 없이 호출 | 버튼 클릭 핸들러 내에서 호출 (포트 피커의 "Request permission" 항목 사용) |
| DFU 장치가 드롭다운에 안 뜸 | 운영체제가 다른 드라이버를 잡음 | Windows: Zadig로 `WinUSB` 드라이버 할당. macOS: `sudo kextunload -b com.apple.driver.AppleUSBFTDI` 불필요 (DFU는 클래스 드라이버). Linux: `udev` 규칙 확인 |
| Linux에서 권한 거부 | `udev` 규칙 누락 | `/etc/udev/rules.d/`에 `SUBSYSTEM=="usb", ATTR{idVendor}=="0483", ATTR{idProduct}=="df11", MODE="0664", GROUP="plugdev"` 추가 후 `sudo udevadm control --reload-rules` |
| Chrome이 DFU 장치를 인식하지만 `claimInterface` 실패 | 다른 프로세스가 인터페이스 점유 | DFU 프로브 도구(stm32cubeProgrammer 등) 종료 |
| Tauri 빌드에서 WebUSB 안 됨 | Tauri 셸의 webview 설정 | `tauri.conf.json`에서 `app.security.csp`와 `app.windows.webviewOptions` 확인 |

### 4.4 DFU 프로토콜 레벨 디버깅

`usbdfu.js`의 `controlTransfer` 래퍼 (line 464)에 로그 추가:

```javascript
// 임시 디버깅 (수정 후 제거)
controlTransfer(direction, request, value, _interface, length, data, callback) {
    console.debug(`[DFU] ${direction} req=0x${request.toString(16)} val=0x${value.toString(16)} if=${_interface} len=${length}`);
    // ... 원본 로직
}
```

DFU 상태머신 단계 추적:

```javascript
// upload_procedure 내부
console.debug(`[DFU] step=${step} state=${this.state}`);
```

### 4.5 로그 위치

- **브라우저:** Chrome DevTools → Console (빌드된 앱의 경우에도 동일)
- **Tauri 데스크톱:** 앱 윈도우 우클릭 → Inspect, 또는 `~/.config/com.betaflight.configurator/logs/` (구현에 따라)
- **Android (Capacitor):** `adb logcat | grep -i "betaflight\|dfu\|capacitor"`

---

## 5. WebUSB / Web Serial API 및 DFU 프로토콜 참조

### 5.1 WebUSB API (`navigator.usb`) — DFU 전용

#### 권한 모델

- **매니페스트 선언 불필요** (PWA 방식). Chrome App 시절의 `manifest.json`의 `usb_devices`는 더 이상 사용하지 않음.
- 첫 `requestDevice()`는 **사용자 제스처**(버튼 클릭) 내에서 호출해야 함.
- 권한 부여 후 `getDevices()`로 권한 있는 장치 목록을 사용자 제스처 없이 조회 가능.
- 권한은 origin에 영구 저장 (사용자가 사이트 데이터 삭제 전까지).

#### 핵심 API 호출 패턴 (`WebUsbDfuTransport.js`)

```javascript
// 1. 장치 요청 (사용자 제스처 필요)
const device = await navigator.usb.requestDevice({
    filters: [
        { vendorId: 0x0483, productId: 0xDF11 },  // STM32 DFU
        { vendorId: 0x2908, productId: 0x0189 },  // GD32 DFU
        { vendorId: 0x2E3C, productId: 0xDF11 },  // AT32F435 DFU
        // ... devices.js의 defaultUsbFilters 전체
    ],
});

// 2. 장치 열기
await device.open();
await device.selectConfiguration(1);
await device.claimInterface(0);  // DFU 인터페이스 (보통 0)

// 3. DFU 컨트롤 전송 (requestType: "class", recipient: "interface")
// DFU_DETACH=0x00, DFU_DNLOAD=0x01, DFU_UPLOAD=0x02, DFU_GETSTATUS=0x03,
// DFU_CLRSTATUS=0x04, DFU_GETSTATE=0x05, DFU_ABORT=0x06
await device.controlTransferOut({
    requestType: "class",
    recipient: "interface",
    request: 0x01,      // DNLOAD
    value: wBlockNum,    // 블록 번호 (2부터 시작)
    index: 0,            // 인터페이스 번호
}, dataBuffer);

const result = await device.controlTransferIn({
    requestType: "class",
    recipient: "interface",
    request: 0x03,      // GETSTATUS
    value: 0,
    index: 0,
}, 6);  // 상태 응답은 6바이트

// 4. 인터페이스 해제 및 닫기
await device.releaseInterface(0);
await device.close();
```

#### 핫플러그 이벤트

```javascript
navigator.usb.addEventListener("connect", e => {
    if (isDfuDevice(e.device)) {
        // PortHandler.addedDevice 디스패치
    }
});
navigator.usb.addEventListener("disconnect", e => {
    // PortHandler.removedDevice 디스패치
});
```

### 5.2 Web Serial API (`navigator.serial`) — FC 통신

```javascript
// 1. 포트 요청 (사용자 제스처)
const port = await navigator.serial.requestPort({
    filters: [
        { usbVendorId: 0x0483, usbProductId: 0x5740 },  // STM32 VCP
        { usbVendorId: 0x10C4, usbProductId: 0xEA60 },  // CP210x
        // ... devices.js의 defaultSerialDevices를 webSerialDevices로 매핑
    ],
});

// 2. 포트 열기
await port.open({ baudRate: 115200 });

// 3. 읽기 루프
const reader = port.readable.getReader();
while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // value: Uint8Array — receive 이벤트로 디스패치
}

// 4. 쓰기
const writer = port.writable.getWriter();
await writer.write(data);
writer.releaseLock();
```

> **주의:** `navigator.serial`은 STM32 ROM 부트로더 모드에서 even parity가 필요:
> `port.open({ baudRate, parityBit: "even", stopBits: "one" })` — `webstm32.js`의 `no_reboot` 경로에서 사용.

### 5.3 STM32 DFU 프로토콜 상세

#### USB DFU 클래스 요청

| Request | Value | 이름 | 설명 |
|---|---|---|---|
| 0x00 | DFU_DETACH | DETACH | DFU 모드 종료 요청 (host→device, timeout) |
| 0x01 | DFU_DNLOAD | DNLOAD | 펌웨어 데이터 다운로드 (wBlockNum=2부터) |
| 0x02 | DFU_UPLOAD | UPLOAD | 플래시 읽기 (검증용) |
| 0x03 | DFU_GETSTATUS | GETSTATUS | 상태 조회 (6바이트 응답) |
| 0x04 | DFU_CLRSTATUS | CLRSTATUS | 에러 상태 클리어 |
| 0x05 | DFU_GETSTATE | GETSTATE | 현재 상태 조회 (1바이트) |
| 0x06 | DFU_ABORT | ABORT | 현재 작업 중단 |

모든 요청은 `requestType: "class"`, `recipient: "interface"`.

#### DFU 상태 (`usbdfu.js` line 60–71)

| 상태 | 값 | 의미 |
|---|---|---|
| dfuIDLE | 2 | 대기 중, 명령 수신 가능 |
| dfuDNLOAD_SYNC | 3 | 다운로드 동기화 대기 |
| dfuDNBUSY | 4 | 플래시 프로그래밍 중 (폴링 필요) |
| dfuDNLOAD_IDLE | 5 | 다운로드 가능 상태 |
| dfuMANIFEST_SYNC | 6 | 매니페스트 동기화 |
| dfuUPLOAD_IDLE | 9 | 업로드 가능 상태 |
| dfuERROR | 10 | 에러 상태 (CLRSTATUS 필요) |

#### STM32 DFU-SE 확장 명령 (DNLOAD의 첫 블록, wBlockNum=1)

| 명령 | 코드 | 인자 | 설명 |
|---|---|---|---|
| Set Address Pointer | 0x21 | 4바이트 little-endian 주소 | 다음 작업의 시작 주소 설정 |
| Erase Page | 0x41 | 4바이트 little-endian 페이지 주소 | 특정 페이지 삭제 |
| Erase Full | 0x42 | 없음 | 전체 플래시 삭제 (일부 칩만) |
| Read Unprotect | 0x92 | 없음 | 읽기 보호 해제 (장치 재부팅됨, 20초 대기) |

#### 플래싱 시퀀스 (`upload_procedure` 단계)

```
Step 0: getChipInfo
    ├─ 인터페이스 디스크립터 문자열 파싱 ("@Internal Flash /0x08000000/04*016Kg,01*064Kg,07*128Kg")
    ├─ 메모리 맵 구축 (sectors[], total_size)
    ├─ wTransferSize 읽기 (기본 2048, F3/F4/F7)
    └─ clearStatus()

Step 1: 옵션 바이트 / 읽기 보호 확인
    ├─ 옵션 바이트 주소 로드 후 UPLOAD 시도
    ├─ 읽기 실패 → 읽기 보호됨
    └─ DNLOAD [0x92] → 20초 대기 → "DFU 재연결 후 재시도" 안내

Step 2: 삭제 (Erase)
    ├─ erase_chip=true: 전체 삭제 (0x42 또는 페이지별 순차)
    ├─ erase_chip=false: HEX 블록과 겹치는 페이지만 0x41로 삭제
    └─ H743 Rev-V 워크어라운드: dfuDNBUSY 타임아웃 후 CLRSTATUS 2회

Step 4: 프로그래밍 (Program/Write)
    ├─ 각 HEX 블록에 대해:
    │   ├─ loadAddress(0x21 + 시작 주소)
    │   └─ DNLOAD를 transferSize 청크로 분할, wBlockNum=2부터 증가
    └─ 각 DNLOAD 후 GETSTATUS로 dfuDNBUSY → dfuDNLOAD_IDLE 전환 확인

Step 5: 검증 (Verify)
    ├─ clearStatus + loadAddress
    ├─ UPLOAD로 동일 블록 읽기 → verify_hex[]
    └─ verify_flash() 바이트 비교

leave():
    ├─ clearStatus
    ├─ loadAddress(시작 주소)
    ├─ DNLOAD 0바이트 (DFU 종료 신호)
    ├─ GETSTATUS
    └─ cleanup() (인터페이스 해제, connect_lock 해제, 콜백)
```

#### 칩별 메모리 맵 예시

| 칩 | 디스크립터 문자열 | 시작 주소 |
|---|---|---|
| STM32F40x | `@Internal Flash /0x08000000/04*016Kg,01*064Kg,07*128Kg` | 0x08000000 |
| STM32H750 (SPRacing H7 EXST) | `@External Flash /0x90000000/998*128Kg,1*128Kg,4*128Kg,21*128Ka` | 0x90000000 |
| AT32F437 | `@Internal Flash /0x08000000/08*04Ka,1000*04Kg` | 0x08000000 |

#### VID/PID 필터 전체 목록 (`devices.js` `defaultUsbFilters`)

```javascript
// DFU 모드 필터 (navigator.usb)
const defaultUsbFilters = [
    { vendorId: 1155,  productId: 57105 },  // 0x0483:0xDF11 STM32 DFU
    { vendorId: 10473, productId: 393 },    // 0x2908:0x0189 GD32 DFU
    { vendorId: 11836, productId: 57105 },  // 0x2E3C:0xDF11 AT32F435 DFU
    { vendorId: 12619, productId: 262 },    // 0x314B:0x0106 APM32 DFU
    { vendorId: 11914, productId: 15 },     // 0x2E8A:0x000F RPi Pico Bootloader
    { vendorId: 14743, productId: 57105 },  // 0x3997:0xDF11 X32 DFU
];

// 시리얼 모드 필터 (navigator.serial)
const defaultSerialDevices = [
    { vendorId: 1027,  productId: 24577 },  // 0x0403:0x6001 FT232R
    { vendorId: 1155,  productId: 12886 },  // 0x0483:0x3256 STM32 HID? (실제로는 일부 보드)
    { vendorId: 1155,  productId: 14158 },  // 0x0483:0x374E STLink VCP (NUCLEO)
    { vendorId: 1155,  productId: 22336 },  // 0x0483:0x5740 STM32 VCP (가장 흔함)
    { vendorId: 4292,  productId: 60000 },  // 0x10C4:0xEA60 CP210x
    { vendorId: 4292,  productId: 60001 },  // 0x10C4:0xEA61 CP210x
    { vendorId: 4292,  productId: 60002 },  // 0x10C4:0xEA62 CP210x
    { vendorId: 10473, productId: 394 },    // 0x2908:0x018A GD32 VCP
    { vendorId: 11836, productId: 22336 },  // 0x2E3C:0x5740 AT32 VCP
    { vendorId: 12619, productId: 22336 },  // 0x314B:0x5740 APM32 VCP
    { vendorId: 11914, productId: 9 },      // 0x2E8A:0x0009 RPi Pico VCP
    { vendorId: 6790,  productId: 29986 },  // 0x1A86:0x7522 CH340 variant
    { vendorId: 6790,  productId: 29987 },  // 0x1A86:0x7523 CH340
    { vendorId: 6790,  productId: 21795 },  // 0x1A86:0x5503 CH341
    { vendorId: 6790,  productId: 30084 },  // 0x1A86:0x7564 CH340S
    { vendorId: 14743, productId: 22336 },  // 0x3997:0x5740 X32 VCP
];
```

---

## 6. 파일 교체 전략 — 상세 가이드

### 6.1 원본에서 가져올 파일 (전체 교체)

다음 파일들은 포크 고유 변경분이 없거나 거의 없으므로 원본에서 직접 덮어쓰기:

```bash
# 원본 리모트 추가 (포크 로컬 클론에서)
git remote add upstream https://github.com/betaflight/betaflight-configurator.git
git fetch upstream master

# 전체 교체 대상 (P0 + P1 + P2)
git checkout upstream/master -- \
    src/js/protocols/webstm32.js \
    src/js/serial.js \
    src/js/serial_backend.js \
    src/js/port_handler.js \
    src/composables/useFirmwareFlashing.js \
    src/js/connection_state.js

# 커밋 전 반드시 diff로 포크 고유 변경분 확인
git diff --cached
```

### 6.2 부분 병합 대상 (3-way merge 필요)

다음 파일들은 포크에 고유 변경분이 있을 수 있으므로 3-way merge:

```bash
# 각 파일별로 포크 변경분 확인
git log --oneline master..HEAD -- src/js/serial_backend.js
git log --oneline master..HEAD -- src/js/port_handler.js
# (FlightPlan 관련 변경이 이 파일들에 침투했는지 확인)

# 3-way merge 도구 사용
git mergetool
# 또는 VS Code: git config merge.tool vscode
```

### 6.3 절대 건드리지 말 것

- `src/js/protocols/devices.js` — DFU/시리얼 VID/PID 필터 (원본과 동일)
- `src/js/protocols/usbdfu.js` — DFU 프로토콜 (1268줄, 원본과 동일)
- `src/js/protocols/WebUsbDfuTransport.js` — WebUSB 전송 (원본과 동일)
- `src/js/protocols/CapacitorDfu.js` / `CapacitorDfuTransport.js` — Android DFU (P3 선택적 개선만)
- `src/components/tabs/FirmwareFlasherTab.vue` — 플래셔 UI (96854 bytes, 원본과 동일)
- `src/components/port-picker/*.vue` — 포트 피커 UI (원본과 동일)
- FlightPlan 관련 모든 파일 (포크 고유 기능)

### 6.4 동기화 후 검증 워크플로

```bash
# 1. 빌드 성공 확인
npm install
npm run build

# 2. 린트/타입체크 (설정된 경우)
npm run lint
npm run type-check  # 또는 vue-tsc

# 3. 의존성 그래프 검증 — connection_state가 실제로 사용되는지
rg "getConnectionState|connection_state" src/ --files-with-matches
# 예상: serial_backend.js, webstm32.js, port_handler.js, useFirmwareFlashing.js

# 4. dead code 검증
rg "isConnected = false|intentionalDisconnect = false" src/js/serial_backend.js
# 예상: 빈 출력 (원본은 connection_state API 사용)

# 5. read_serial 참조 제거 확인
rg "read_serial" src/js/protocols/webstm32.js
# 예상: 빈 출력

# 6. dev 서버 실행
npm run dev
# https://local.betaflight.com:8443 접속

# 7. 실기기 테스트 (시나리오 A, B, C)
```

---

## 7. 수정 후 회귀 테스트 체크리스트

### 7.1 시리얼 연결 (기본)

- [ ] FC 시리얼 연결 → Connect 버튼 → "Connected" 표시
- [ ] 포트 드롭다운에 시리얼 포트 표시
- [ ] 탭 전환 (CLI, Configuration, Ports 등) 시 연결 유지
- [ ] Disconnect → 포트 드롭다운 갱신
- [ ] 핫플러그 (USB 뽑기) → 자동 disconnect

### 7.2 DFU 직접 모드 (P0 무관, 정상 작동해야 함)

- [ ] DFU 모드 부팅 → 포트 드롭다운에 `usb_...` 표시
- [ ] "Exit DFU" 버튼 활성화
- [ ] Firmware Flasher → Flash → 플래싱 성공
- [ ] 플래싱 후 자동으로 DFU 종료 → FC 재부팅

### 7.3 시리얼 플래싱 (P0 수정 검증)

- [ ] 시리얼 연결 → Firmware Flasher → Flash → MSP reboot → DFU 대기 → 플래싱 성공
- [ ] 플래싱 후 자동 재연결
- [ ] "No reboot sequence" 옵션 활성화 시 even parity로 ROM 부트로더 직접 플래싱
- [ ] 수동 보드레이트 옵션 동작

### 7.4 리부트 재연결 (P2 수정 검증)

- [ ] CLI `save` 후 자동 재연결 시 "Connection failed" 다이얼로그 미표시
- [ ] 설정 변경 후 저장 → 자동 재연결
- [ ] 플래싱 중 Connect 버튼 비활성화 (isFlashing 하드블록)
- [ ] 핫플러그 장치 제거 시 `GUI.connected_to` null이어도 크래시 없음

### 7.5 크로스 전송계층 (P1 수정 검증)

- [ ] 시리얼 연결 중 BLE 장치 연결/해제 → 시리얼 연결 유지
- [ ] BLE 연결 중 시리얼 장치 연결/해제 → BLE 연결 유지
- [ ] DFU 플래싱 중 시리얼 포트 이벤트 간섭 없음

### 7.6 포크 고유 기능 (보존 검증)

- [ ] FlightPlan 탭 정상 동작 (waypoint 드래그, AGL/AMSL, speed timers)
- [ ] CLI 출력 버퍼 5배 증가 유지 (대량 출력 시 잘림 없음)
- [ ] resources 폴더 정상 로드

---

## 8. 코딩 AI를 위한 실행 순서 요약

```text
1. git clone 포크 + upstream 리모트 추가
2. git fetch upstream master
3. P0: src/js/protocols/webstm32.js 원본에서 동기화 (1줄 수정 + connection_state 연동)
4. 빌드 + 시나리오 A/B 테스트
5. 커밋: "fix(usb): restore STM32 serial bootloader receive adapter (P0)"
6. P1: src/js/serial.js 원본에서 동기화 (_setupEventForwarding 분리)
7. 빌드 + 크로스 전송계층 테스트
8. 커밋: "fix(usb): gate lifecycle events to active transport (P1)"
9. P2: 4파일 coordinated change-set 동기화
   - src/js/serial_backend.js
   - src/js/port_handler.js
   - src/composables/useFirmwareFlashing.js
   - src/js/connection_state.js (이미 동일하면 스킵)
10. 빌드 + 시나리오 C + 회귀 테스트 전체
11. 커밋: "refactor(connection): sync connection_state integration from upstream (P2)"
12. P3 (선택): CapacitorDfu.js 가용성 체크 추가
13. 커밋: "feat(android): guard DFU plugin availability (P3)"
14. PR 생성 + CI 통과 확인
```

---

## 9. 참조 링크

- **원본 저장소:** https://github.com/betaflight/betaflight-configurator
- **포크 저장소:** https://github.com/saydals/bf
- **WebUSB API (MDN):** https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API
- **Web Serial API (MDN):** https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
- **STM32 DFU 사용자 매뉴얼 (AN3156):** https://www.st.com/resource/en/application-note/cd00264379.pdf
- **USB DFU 클래스 사양:** https://www.usb.org/document-search/?search_api_fulltext=DFU
- **Betaflight DFU 안내:** https://github.com/betaflight/betaflight/wiki/Installing-Betaflight
- **Chrome WebUSB 정책:** https://developer.chrome.com/docs/capabilities/usb

---

## 10. 부록: 원본 vs 포크 diff 요약

| 파일 | 원본 SHA (master) | 포크 SHA (master) | 차이 | 조치 |
|---|---|---|---|---|
| `src/js/protocols/devices.js` | 동일 | 동일 | 없음 | 유지 |
| `src/js/protocols/usbdfu.js` | 동일 | 동일 | 없음 | 유지 |
| `src/js/protocols/WebUsbDfuTransport.js` | 동일 | 동일 | 없음 | 유지 |
| `src/js/protocols/CapacitorDfu.js` | 동일 | 동일 | 없음 | P3 선택 개선 |
| `src/components/tabs/FirmwareFlasherTab.vue` | 동일 | 동일 | 없음 | 유지 |
| `src/components/port-picker/*.vue` | 동일 | 동일 | 없음 | 유지 |
| `src/js/utils/checkCompatibility.js` | 동일 | 동일 | 없음 | 유지 |
| **`src/js/protocols/webstm32.js`** | 최신 | **구버전** | **receive adapter + connection_state** | **P0+P2 교체** |
| **`src/js/serial.js`** | 최신 | **구버전** | **이벤트 게이트** | **P1 교체** |
| **`src/js/serial_backend.js`** | 최신 | **구버전** | **connection_state 연동 + isFlasing + 다이얼로그 억제 + null 가드** | **P2 교체** |
| **`src/js/port_handler.js`** | 최신 | **구버전** | **isReconnecting selectActivePort** | **P2 교체** |
| **`src/composables/useFirmwareFlashing.js`** | 최신 | **구버전** | **ESP32 FLASHING 상태** | **P2 교체** |
| `src/js/connection_state.js` | 동일 | 동일 | 없음 | P2 동기화 시 자동 활성화 |

> **최종 권고:** P0만 먼저 수정해도 사용자 체감 품질이 크게 개선됨 (시리얼 플래싱 경로 복구). P1, P2는 안정성/UX 개선이며, P3는 Android 전용. P0 → P1 → P2 → P3 순서로 진행하고 각 단계마다 커밋 + 테스트 권장.
