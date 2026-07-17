# Firmware Flash 버그 수정 가이드

> 작업 디렉토리: `/home/betaflight/configurator`
> 원본 비교 대상: `/tmp/bfc-original` (github.com/saydals/bf 임시 클론)

---

## 1. 증상

펼침 메뉴에서 **Flash** 선택시 **Please wait**에서 멈추고 플래시가 진행되지 않음.
반면 **DFU find** 선택시에는 장치 선택 팝업이 정상적으로 뜸.

```
# 개인포크 로그 (USB 꼽기 전부터 에러로 멈출때까지)
...
setting default value for backupOnFlash 1
i18next::translator: missingKey ko messages firmwareFlasherNoPortSelected firmwareFlasherNoPortSelected
# ← 이 후 아무 로그 없이 멈춤
```

---

## 2. 근본 원인

`src/js/utils/AutoBackup.js` `execute()` 함수가 USB/DFU 포트(`usb_`)에서
백업을 시도하다 실패하고 콜백을 호출하지 않아 `initiateFlashing`이 실행되지 않음.

### 원본 로그 (정상)
```
[FIRMWARE_FLASHER] Selected port: noselection
[FIRMWARE_FLASHER] No valid port detected, asking for permissions  ← 팝업
...
```

### 개인포크 로그 (멈춤)
```
[PORTHANDLER] Found DFU port(s) [{…}]
[PORTHANDLER] Automatically selected device is 'usb_386D38703434'
...
main-D_P6OAxU.js:4105 setting default value for backupOnFlash 1
main-D_P6OAxU.js:4105 setting default value for backupOnFlash 1
i18next::translator: missingKey ko messages firmwareFlasherNoPortSelected firmwareFlasherNoPortSelected
# ← 여기서 멈춤
```

---

## 3. 원인 상세

### 3.1 펼침 메뉴 원본과 동일함

`FirmwareFlasherTab.vue`의 `flashActionMenuItems`는 원본과 완전히 동일하다.
Flash 항목을 선택하면 `handleFlashFirmware` → `runFlashWorkflow`로 진입한다.

### 3.2 runFlashWorkflow 가 backup 분기로 빠지는 조건

`runFlashWorkflow` (useFirmwareFlashing.js):
```js
if (flashOnConnectEnabled || !portAvailable) {
    await startFlashingCallback?.();  // flash-now
    return;
}

// backup 분기
const backupOnFlash = getConfig("backupOnFlash", 1).backupOnFlash;
switch (backupOnFlash) {
    case 1:
        startBackup?.(initiateFlashing);  // ← 여기로 감
        break;
```

- 원본 테스트 환경: 시리얼 포트 없음 → `portAvailable = false`
  → `!portAvailable === true` → **flash-now 분기** → 바로 플래시 시작
- 개인포크 환경: 시리얼 포트 있음 (`Found serial port(s) [{…}]`)
  → `portAvailable = true` → **backup 분기** → `startBackup` → `AutoBackup.execute()` 진입

### 3.3 AutoBackup.execute() 가 USB 포트를 처리하지 못함

```js
// src/js/utils/AutoBackup.js execute()
if (port.startsWith("serial")) {
    serial.connect(port, { baudRate: baud });
} else if (port.startsWith("capacitor-")) {
    console.log("AutoBackup: Skipping backup on Android capacitor port");
    if (this.callback) { this.callback(true); }
} else {
    gui_log(i18n.getMessage("firmwareFlasherNoPortSelected"));  // ← USB 포트는 여기로 떨어짐
}
```

`PortHandler.portPicker.selectedPort`가 `usb_386D38703434` 일 때,
`port.startsWith("serial")`도 `capacitor-`도 아니므로 `else` 분기로 떨어진다.
→ `firmwareFlasherNoPortSelected` 경고만 출력하고 **`callback`을 호출하지 않는다**.
→ `initiateFlashing`이 실행되지 않음 → 플래시 시작 안 됨 → Please wait에서 멈춤.

### 3.4 DFU find는 왜 팝업이 뜨는가

`handleRequestDfuPermission` → `PortHandler.requestDevicePermission("usb")` →
`dfuProtocol.requestPermission()` → `navigator.usb.requestDevice()` → 팝업

Flash와는 **다른 독립 경로**이므로, AutoBackup 문제와 무관하게 정상 동작한다.

---

## 4. 해결 방법

### 수정: `src/js/utils/AutoBackup.js` `execute()` 에 USB/DFU 포트 분기 추가

```js
} else if (port.startsWith("usb")) {
    // Skip backup for a DFU/USB bootloader port — there is no live MSP session to
    // back up, so proceed straight to flashing (mirrors the original behaviour when
    // a DFU device is selected before flashing).
    console.log("AutoBackup: Skipping backup on USB/DFU port");
    if (this.callback) {
        this.callback(true);
    }
} else {
    gui_log(i18n.getMessage("firmwareFlasherNoPortSelected"));
}
```

USB/DFU 포트는 백업할 live MSP 세션이 없으므로 백업을 건너뛰고
`callback(true)`로 `initiateFlashing` → 플래시를 정상 진행시킨다.

---

## 5. 검증

- 빌드: `npm run build`
- 배포 후 USB 부트로더 연결 → 펼침 메뉴 → Flash 선택
- 백업 경고 없이 플래시가 진행되어야 함

## 6. 참고

- 이 버그는 원본에도 잠재되어 있으나, 원본 테스트 환경에서는 시리얼 포트가
  감지되지 않아 `portAvailable=false` → flash-now 분기로 빠져 드러나지 않았다.
- 개인포크 환경에서 시리얼 포트가 함께 감지되어 `portAvailable=true` → backup 분기로
  빠지면서 발현된다.
