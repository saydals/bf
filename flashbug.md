# 플래시 프로세스 버그 수정 보고서 (flashbug.md)

## 개요
업스트림 원본(`/tmp/bfc-original`)과 포크 버전의 플래시 관련 코드를 비교 분석하여 발견된 차이점을 모두 수정하여 **플래시 프로세스를 업스트림과 동일한 수준으로 견고하게** 만들었습니다.

---

## 🔧 수정된 파일 및 내용

### 1. `src/js/msp/mspErrors.js` — **신규 생성**

MSP 에러 타입 클래스 정의 (업스트림에서 가져옴):
- `MspError` — 기본 MSP 에러
- `MspTimeoutError` — 타임아웃 에러
- `MspCancelledError` — 취소 에러 (reason: "cleanup" | "disconnected")
- `MspCrcError` — CRC 에러
- `isMspCancelled(error)` — 취소 에러 판별 헬퍼 함수

**필요성**: `webstm32.js`에서 MSP_SET_REBOOT 요청 후 FC 연결해제가 예상된 것인지 진짜 오류인지 구분하는 데 사용.

---

### 2. `src/js/connection_state.js` — **리부트 윈도우 관리 추가**

| 추가된 기능 | 설명 |
|------------|------|
| `_rebootWindow` | 리부트 재연결 윈도우 상태 (`{ startedAt, durationMs }` or null) |
| `requestReboot(windowMs)` | 재연결 윈도우를 열고 REBOOTING 상태로 전환 |
| `isRebootWindowOpen` | 리부트 윈도우가 열려있는지 확인 |
| `rebootWindowMs` | 윈도우 지속 시간 (ms) |
| `rebootWindowStartedAt` | 윈도우 시작 타임스탬프 |
| `rebootWindowExpired` | 윈도우가 만료되었는지 확인 |
| `concludeReboot()` | 윈도우 정리 추가 |
| `shutdown()` | 윈도우 정리 추가 |

**필요성**: 리부트 후 재연결 시간 측정 및 타임아웃 관리의 단일 진실 공급원(Single Source of Truth).

---

### 3. `src/js/protocols/webstm32.js` — **대폭 수정**

| 변경 사항 | 설명 |
|----------|------|
| **Import** | `MspCancelledError`, `getConnectionState` 추가; `read_serial` 제거 |
| **`readSerialAdapter()`** | `read_serial(event.detail.buffer)` → `MSP.read(event.detail.data)`<br>MSP 직접 전달 (serial_backend 의존성 제거) |
| **`handleError()`** | `getConnectionState().endFlashing()` 호출 추가 |
| **`handleDisconnect()`** | `getConnectionState().beginDeviceReplacement()` 호출 추가<br>(FLASHING 상태 진입, 연결/재부팅 하드블록) |
| **`reboot()`** | `disconnectFromMsp()` 함수 분리<br>`MspCancelledError` 타입 체크로 예상된 연결해제 vs 실제 오류 구분 |
| **`onAbort()`** | `getConnectionState().endFlashing()` 호출 추가 |
| **`lookingForCapabilitiesViaMSP()`** | `getConnectionState().endFlashing()` 호출 추가<br>`.catch()` 에러 핸들러 추가 |
| **`cleanup()`** | `getConnectionState().endFlashing()` 호출 추가 (FLASHING → IDLE) |

#### MSP_SET_REBOOT 오류 처리 비교

**수정 전 (포크):**
```javascript
MSP.promise(MSPCodes.MSP_SET_REBOOT, buffer).then(() => {
    this.mspConnector.disconnect(...);
});
// 에러 처리 없음
```

**수정 후 (업스트림 동일):**
```javascript
const disconnectFromMsp = () => {
    this.mspConnector.disconnect(...);
};
MSP.promise(MSPCodes.MSP_SET_REBOOT, buffer)
    .then(() => disconnectFromMsp())
    .catch((error) => {
        if (error instanceof MspCancelledError && error.reason === "disconnected") {
            disconnectFromMsp();  // 예상된 연결해제
        } else {
            console.error(`${this.logHead} MSP_SET_REBOOT request failed:`, error);
            this.handleError();  // 진짜 오류
        }
    });
```

---

### 4. `src/composables/useFirmwareFlashing.js` — **ESP32 BIN 플래시 경로 개선**

| 변경 사항 | 설명 |
|----------|------|
| **Import** | `getConnectionState` 추가 |
| **ESP32 BIN 플래시** | `getConnectionState().beginDeviceReplacement()` 추가 (flash 시작 전)<br>`getConnectionState().endFlashing()` 추가 (finally 블록에서) |

---

### 5. `src/js/serial_backend.js` — **페이지 언로드 핸들러 개선**

| 변경 사항 | 설명 |
|----------|------|
| **페이지 언로드** | 조건부(`isConnected && !connect_lock`) → **무조건 종료**<br>`getConnectionState().shutdown()` + `stopRebootReconnect()` + `closeRebootDialog()` + `serial.forceClose()` |

**수정 전:**
```javascript
if (isConnected && !GUI.connect_lock) {
    serial.forceClose();
}
```

**수정 후:**
```javascript
getConnectionState().shutdown();
stopRebootReconnect();
closeRebootDialog();
serial.forceClose();
```

---

## 📋 최종 상태: 업스트림 vs 포크 비교

| 비교 항목 | 업스트림 | 포크 (수정 후) | 상태 |
|----------|---------|---------------|------|
| `msp/mspErrors.js` | 있음 | 생성됨 | ✅ 동일 |
| `connection_state.js` 리부트 윈도우 | 있음 | 추가됨 | ✅ 동일 |
| `webstm32.js` readSerialAdapter | `MSP.read(event.detail.data)` | `MSP.read(event.detail.data)` | ✅ 동일 |
| `webstm32.js` MSP_SET_REBOOT 에러처리 | MspCancelledError 구분 | MspCancelledError 구분 | ✅ 동일 |
| `webstm32.js` FLASHING 상태관리 | `beginDeviceReplacement()` + `endFlashing()` | `beginDeviceReplacement()` + `endFlashing()` | ✅ 동일 |
| `webstm32.js` MSP_BOARD_INFO 에러처리 | `.catch()` 있음 | `.catch()` 있음 | ✅ 동일 |
| `useFirmwareFlashing.js` ESP32 경로 | FLASHING 상태관리 | FLASHING 상태관리 | ✅ 동일 |
| `serial_backend.js` 페이지 언로드 | 무조건 완전 종료 | 무조건 완전 종료 | ✅ 동일 |
| `DeviceHandler` → `PortHandler` | device_handler | port_handler | ⚠️ 의도된 rename |

**남은 차이점**: `DeviceHandler` → `PortHandler` 리네임은 포크의 의도된 디자인 변경으로, 기능상 동일합니다.
