# GPS Rescue — Configurator에 새 MSP 필드 추가 가이드

이 문서는 Betaflight Configurator에 새로운 GPS Rescue MSP 필드를 추가하는 일반적인 워크플로를 설명합니다. 펌웨어에 이미 CLI 명령어와 MSP 필드가 존재하고, 이를 Configurator UI에 노출해야 하는 경우를 대상으로 합니다.

---

## 1. 준비: 펌웨어에서 확인할 사항

작업을 시작하기 전에 펌웨어(또는 해당 개발자)에서 다음을 확인합니다:

| 항목 | 설명 |
|---|---|
| **필드명** | `gps_rescue_xxx` 형태의 MSP 필드명 |
| **허용 범위** | CLI 도움말에서 확인 가능 (예: `Allowed range: 15 - 45`) |
| **기본값** | CLI 도움말에서 확인 가능 (예: `Default value: 15`) |
| **저장 타입** | `U8` (0~255), `U16` (0~65535) 등 — 펌웨어 소스 `msp_protocol.h`에서 확인 |
| **소수점 처리** | 값이 x10, x100 등의 factor로 저장되는지 확인 (예: 속도·비율 등) |
| **API 버전** | 해당 필드가 도입된 API 버전을 확인 (예: 1.49) |

---

## 2. 파일별 변경 순서

### 2.1. `src/js/data_storage.js` — 새 API 버전 상수 추가

새로운 API 버전이 필요한 경우 추가합니다 (기존 버전 뒤에 이어서):

```js
export const API_VERSION_1_49 = "1.49.0";
```

> 이미 동일 API 버전이 있으면 스킵합니다.

---

### 2.2. `src/js/fc.js` — GPS_RESCUE struct에 필드 추가

`GPS_RESCUE` 객체의 마지막 필드 뒤에 새 필드를 추가합니다:

```js
this.GPS_RESCUE = {
    angle: 0,
    returnAltitudeM: 0,
    // ... 기존 필드들 ...
    initialClimbM: 0,
    descentBank: 0,    // ← 새 필드
};
```

- 기본값은 `0`으로 두고, 실제 값은 FC에서 MSP 응답 시 덮어씁니다.
- 소수점 factor가 필요한 경우 (예: x100) 초기값도 그에 맞게 설정합니다.

---

### 2.3. `src/js/msp/MSPHelper.js` — 읽기/쓰기 로직 추가

#### 2.3a. import에 새 API 버전 상수 추가

```js
import { API_VERSION_1_45, API_VERSION_1_46, API_VERSION_1_47, API_VERSION_1_48, API_VERSION_1_49 } from "../data_storage";
```

#### 2.3b. 읽기 (`process_data`, `MSP_GPS_RESCUE` case)

`GPS_RESCUE` case의 맨 마지막 필드 뒤에 추가합니다. 기존 필드는 순차적으로 읽고, 새 필드는 API 버전 게이트를 적용합니다:

```js
// Introduced in API version 1.46
FC.GPS_RESCUE.initialClimbM = data.readU16();

// Introduced in API version 1.49
if (semver.gte(FC.CONFIG.apiVersion, API_VERSION_1_49)) {
    FC.GPS_RESCUE.descentBank = data.readU16();
}
break;
```

> 기존 필드(`initialClimbM` 등)는 **버전 게이트 없이** 순차적으로 읽습니다. 이는 해당 필드가 도입된 API 이후의 FC는 항상 모든 이전 필드도 함께 전송하기 때문입니다.

#### 2.3c. 쓰기 (`crunch`, `MSP_SET_GPS_RESCUE` case)

같은 위치에 같은 패턴으로 추가합니다:

```js
// Introduced in 1.46
buffer.push16(FC.GPS_RESCUE.initialClimbM);

// Introduced in 1.49
if (semver.gte(FC.CONFIG.apiVersion, API_VERSION_1_49)) {
    buffer.push16(FC.GPS_RESCUE.descentBank);
}
break;
```

---

### 2.4. `src/components/tabs/FailsafeTab.vue` — UI 추가

#### 2.4a. SettingRow 추가 위치

GPS Rescue 설정 영역(`showGpsRescue` 조건 하)에 있는 `SettingRow`들 사이에 새 행을 추가합니다. 보통 `minSats` 필드 바로 아래가 가장 자연스러운 위치입니다.

#### 2.4b. 템플릿 코드 패턴

```vue
<SettingRow
    :label="$t('failsafeGpsRescueItemDescentBank')"
    :help="$t('failsafeGpsRescueDescentBankHelp')"
>
    <UInputNumber
        v-model="gpsRescue.descentBank"
        :min="15"
        :max="45"
        :step="1"
        :disabled="isGpsSettingsDisabled"
        size="xs"
        orientation="vertical"
        :format-options="{ useGrouping: false }"
        class="w-16"
    />
</SettingRow>
```

**패턴 요약**:
| 항목 | 값 / 설명 |
|---|---|
| `v-model` | `gpsRescue.필드명` |
| `:min` / `:max` | 펌웨어 CLI 허용 범위 그대로 사용 |
| `:step` | 정수이면 `1`, 소수점이면 `0.1` 등 |
| `:disabled` | `isGpsSettingsDisabled` (GPS Rescue 모드가 아닐 때 비활성화) |
| `size` | `"xs"` |
| `orientation` | `"vertical"` |
| `class` | `"w-16"` (정수 입력) 또는 `"w-20"` (소수점 입력) |
| `:format-options` | `{ useGrouping: false }` — 항상 추가 |

#### 2.4c. 값 변환이 필요한 경우

값이 x10 또는 x100 factor로 저장되는 경우 (예: 속도, 비율), 커스텀 computed 프로퍼티를 만듭니다:

```js
const gpsRescueSomeField = computed({
    get: () => gpsRescue.value.someField / 100,
    set: (val) => (gpsRescue.value.someField = Math.round(Number(val) * 100)),
});
```

그 후 템플릿에서 `v-model="gpsRescueSomeField"`를 사용합니다.

단순 정수/소수점 필드(예: `descentBank`, `angle`, `minSats`)는 변환 없이 `v-model="gpsRescue.필드명"`을 직접 사용합니다.

---

### 2.5. `locales/en/messages.json` — i18n 키 추가

`failsafeGpsRescueItemMinSats` 아래와 같은 위치에 추가합니다:

```json
"failsafeGpsRescueItemDescentBank": {
    "message": "Descent Allow Max Bank Angle"
},
"failsafeGpsRescueDescentBankHelp": {
    "message": "Maximum bank angle allowed during descent in GPS rescue mode (15–45 deg)",
    "description": "Help text for gps_rescue_descent_bank field"
},
```

**규칙**:
- Label 키: `failsafeGpsRescueItem{FieldName}` 형태
- Help 키: `failsafeGpsRescue{FieldName}Help` 형태
- **`"message"`는 영어로만 통일**합니다 (국적과 상관없이)
- `message` 내용에는 HTML 태그를 넣지 않습니다
- `description`에는 필드 설명을 간단히 기술합니다
- 범위가 있으면 `message` 안에 `(min–max deg)` 형태로 포함합니다

---

## 3. 체크리스트

- [ ] 펌웨어 CLI에서 필드명, 허용 범위, 기본값 확인
- [ ] `data_storage.js`에 새 API 버전 상수 추가 (필요한 경우)
- [ ] `fc.js`에 `GPS_RESCUE` struct에 새 필드 추가
- [ ] `MSPHelper.js`에 import 추가 + read/write 로직 추가 (API 버전 게이트)
- [ ] `FailsafeTab.vue`에 `SettingRow` + `UInputNumber` 추가
- [ ] 값 변환이 필요한 경우 computed 프로퍼티 추가
- [ ] `locales/en/messages.json`에 English-only i18n 키 추가
- [ ] `npm run lint`로 에러 확인
- [ ] `npm run test`로 기존 테스트 통과 확인

---

## 4. 기타 참고 사항

- **커밋 메시지惯例**: `feat(gps-rescue): add gps_rescue_xxx support` 형태 사용
- **하나의 PR = 하나의 필드**: 여러 필드를 한 번에 추가하지 않습니다
- **테스트**: 새로운 UI 필드에 대한 단위 테스트는 별도로 작성하지 않으나, 기존 테스트가 깨지지 않는지 확인합니다
- **문서**: i18n `description` 필드에 "Help text for gps_rescue_xxx field" 형태로 기술합니다
