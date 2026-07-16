# MSP 버그 수정 보고서 (mspbug.md)

## 개요
업스트림 원본(`/tmp/bfc-original` — Betaflight 공식 저장소)과 포크 버전을 비교 분석하여 발견된 4가지 버그를 수정했습니다.

---

## 🐛 버그 1: 콜백 이중 호출 (`TypeError: t is not a function`)

### 원인
`src/js/serial.js`의 `send()` 메서드가 콜백을 2번 호출:
1. 프로토콜(WebSerial)의 `send()`에서 한 번
2. 자신의 `send()`에서 한 번 더 (`callback?.(result)`)

### 추가 원인
`src/js/serial_backend.js`에서 `serial.send(escapeBuffer, false)`로 `false`를 콜백으로 전달.
- JS에서 `false?.(result)`는 `false`가 `null`/`undefined`가 아니므로 `?.`이 단락되지 않고 `false(result)`를 호출 → `"false is not a function"` 오류 발생
- 미니파이된 코드에서 변수명 `t`로 축약되어 `"t is not a function"`으로 표시됨

### 수정
**`src/js/serial.js`** (`send` 메서드, 175~185행):
- `callback?.(result)` 제거 (프로토콜이 이미 처리)
- 콜백은 프로토콜의 `send()`에서만 처리

**`src/js/serial_backend.js`** (562, 567행):
- `serial.send(escapeBuffer, false)` → `serial.send(escapeBuffer, null)`
- `serial.send(lfBuffer, false)` → `serial.send(lfBuffer, null)`

---

## 🐛 버그 2: 모든 시리얼 포트가 동일한 경로 `"serial"` 사용

### 원인
`src/js/protocols/WebSerial.js`의 `createPort()`에서 포트 식별자로 고정 문자열 `"serial"` 사용
- 다중 시리얼 장치 연결 시 구분 불가능
- 포트 선택/자동연결 로직 혼란
- `Failed to open serial port` 에러의 근본 원인

### 수정
**`src/js/protocols/WebSerial.js`**:
- Private 필드 `#portIds` (WeakMap) + `#nextPortId` 추가
- `#getStablePortId()` 메서드 추가: 동일 SerialPort 객체에 대해 항상 같은 ID 반환
- `createPort()`에서 `path: this.#getStablePortId(port)` 사용
- WeakMap을 사용하여 브라우저가 SerialPort를 해제할 때 자동으로 ID도 해제됨

### 효과
- 첫 번째 포트: `serial_0`, 두 번째 포트: `serial_1`, ...
- MCU 리부트 후 USB 재열거에도 동일한 SerialPort 객체 → 동일한 ID 유지
- 다중 포트 환경에서 정확한 식별 가능

---

## 🐛 버그 3: 생명주기 이벤트 필터링 누락

### 원인
`src/js/serial.js`의 `_setupEventForwarding()`에서 **모든** 프로토콜의 **모든** 이벤트를 조건 없이 포워딩
- 비활성화된 Bluetooth/WebSocket 전송의 `connect`/`disconnect`/`receive` 이벤트가 현재 활성 시리얼 연결을 방해
- `onOpen()`이 잘못된 연결 정보로 실행되어 상태 불일치 발생
- USB 인식 오류 및 연결 끊김 현상의 근본 원인

### 수정
**`src/js/serial.js`** (`_setupEventForwarding`, 62~95행):
- 디바이스 열거 이벤트(`addedDevice`, `removedDevice`): **모든 전송에서** 수신 (O)
- 생명주기 이벤트(`connect`, `disconnect`, `receive`): **현재 활성 전송에서만** 수신
- `_tagDetail()` 메서드 추가: 이벤트 detail에 `protocolType` 태깃 + falsy detail 보존

### 핵심 로직
```javascript
if (lifecycleEvents.has(eventType) && instance !== this._protocol) {
    return;  // 비활성 전송의 생명주기 이벤트 차단!
}
```

---

## 🐛 버그 4: MSP 에러 처리 기능 제거

### 원인
포크 버전의 `src/js/msp.js`에서 업스트림의 에러 처리 기능이 대거 제거됨:
- `MAX_RETRIES`, `_buffer_matches()` 제거
- 타임아웃 시 단순 로깅만 하고 종료 (재시도 없음)
- `promise()` 메서드에 에러 전파(reject) 없음
- `callbacks_cleanup()`이 에러 정보 전파 없음

### 수정
**`src/js/msp.js`**:
- `MAX_RETRIES: 3` 복원
- `_buffer_matches(entry, view)` — 중복 요청 감지용 버퍼 비교 메서드
- `_arm_timer(obj)` — 재시도 로직을 포함한 타임아웃 핸들러
  - 최대 `MAX_RETRIES`회 재시도
  - 각 재시도 간격: `TIMEOUT` (1000ms)
  - `_settled` 플래그로 중복/중첩 타임아웃 방지
  - 최대 시도 초과 시 콜백에 에러 전파
- `callbacks_cleanup(error)` — 에러를 모든 pending 콜백에 전파
- `disconnect_cleanup()` — 연결 종료 시 `connectionClosed` 태그된 에러 전파
- `promise(code, data)` — 연결/모드 체크 추가 + `reject` 지원

---

## 수정 파일 요약

| 파일 | 버그 | 변경 유형 |
|------|------|----------|
| `src/js/serial.js` | #1 (콜백 이중호출), #3 (이벤트 필터링) | 수정 |
| `src/js/protocols/WebSerial.js` | #2 (포트 고유ID) | 수정 |
| `src/js/msp.js` | #4 (에러 처리) | 수정/개선 |
| `src/js/serial_backend.js` | #1 (false→null) | 수정 |

---

## 테스트 방법

### 1. 웹빌드 테스트
```bash
npm run build
npm run preview
```

### 2. 수정 검증 포인트
- **WebSerial 연결**: 2개 이상의 USB-to-Serial 장치 연결 시 각각 `serial_0`, `serial_1`로 표시
- **연결 안정성**: 장시간 연결 유지 후 끊김 없음
- **재연결**: MCU 리부트 후 자동 재연결 정상 동작
- **MSP 타임아웃**: 타임아웃 시 재시도 후 연결 상태 유지
- **에러 로그**: `"t is not a function"` 에러 미발생
