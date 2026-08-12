# Betaflight Autopilot 펌웨어 - 블랙박스 저장 데이터 분석

## 조사 목적
FC 펌웨어(autopilot)의 블랙박스 저장 데이터 중 비행기의 움직임/자세에 대응하는 값들이 무엇인지 조사

---

## 1. 블랙박스 데이터 구조 개요

블랙박스는 다음 프레임 타입으로 데이터를 저장:

| 프레임 타입 | 설명 | 저장 주기 |
|------------|------|----------|
| **I-frame** (Intra) | 키프레임, 전체 데이터 | 설정된 간격마다 (기본 32루프) |
| **P-frame** (Predicted) | 델타 데이터 | I-frame 사이마다 (기본 매 루프) |
| **G-frame** (GPS) | GPS 데이터 | GPS 업데이트 시 |
| **H-frame** (GPS Home) | GPS 홈 포인트 | 주기적/변경 시 |
| **S-frame** (Slow) | 느리게 변하는 상태 | 설정된 간격마다 |
| **E-frame** (Event) | 이벤트 (암빙, 플라이트모드 변경 등) | 발생 시 |

---

## 2. 비행기 자세/움직임 관련 저장 필드

### 2.1 메인 프레임 (I/P-frame)에 저장되는 자세 관련 데이터

| 필드명 | 타입 | 축 | 설명 | 단위/스케일 |
|--------|------|-----|------|------------|
| **gyroADC** | int16_t[3] | X,Y,Z | 필터링된 자이로 데이터 (각속도) | 고해상도 모드 시 스케일 적용 |
| **gyroUnfilt** | int16_t[3] | X,Y,Z | 필터링되지 않은 원시 자이로 데이터 | 고해상도 모드 시 스케일 적용 |
| **accSmooth/accADC** | int16_t[3] | X,Y,Z | 가속도계 데이터 (선가속도) | raw ADC 값 |
| **setpoint** | int16_t[4] | R,P,Y,T | PID 설정값 (롤, 피치, 요, 스로틀) | 고해상도 모드 시 스케일 적용 |
| **rcCommand** | int16_t[4] | R,P,Y,T | RC 명령값 (롤, 피치, 요, 스로틀) | 고해상도 모드 시 스케일 적용 |
| **axisPID_P** | int32_t[3] | R,P,Y | PID P텀 출력 | - |
| **axisPID_I** | int32_t[3] | R,P,Y | PID I텀 출력 | - |
| **axisPID_D** | int32_t[3] | R,P,Y | PID D텀 출력 | - |
| **axisPID_F** | int32_t[3] | R,P,Y | PID F텀(피드포워드) 출력 | - |

### 2.2 GPS 프레임 (G-frame)에 저장되는 위치/속도 데이터

| 필드명 | 타입 | 설명 | 단위 |
|--------|------|------|------|
| **GPS_coord** | int32_t[2] | 위도, 경도 (홈 기준 상대값) | 도 * 10^7 |
| **GPS_altitude** | int32_t | 고도 | 0.1m 단위 |
| **GPS_speed** | uint32_t | 3D 속도 또는 지상 속도 | cm/s |
| **GPS_ground_course** | uint32_t | 지상 진행 방향 | 0.1도 단위 |
| **GPS_velned** | int32_t[3] | NED 프레임 속도 (북, 동, 하) | cm/s |
| **GPS_numSat** | uint8_t | 위성 수 | - |
| **GPS_time** | uint32_t | GPS 시간 | - |

### 2.3 슬로우 프레임 (S-frame)에 저장되는 상태 데이터

| 필드명 | 타입 | 설명 |
|--------|------|------|
| **flightModeFlags** | uint32_t | 활성화된 플라이트 모드 플래그 |
| **stateFlags** | uint8_t | 시스템 상태 플래그 |
| **failsafePhase** | uint8_t | 페일세이프 단계 |
| **rxSignalReceived** | bool | 수신기 신호 수신 여부 |
| **rxFlightChannelsValid** | bool | 비행 채널 유효 여부 |

---

## 3. **중요: 블랙박스에 직접 저장되지 않는 자세 데이터**

### ❌ 저장되지 않는 것들:
| 데이터 | 설명 | 비고 |
|--------|------|------|
| **Euler angles (attitude)** | 롤, 피치, 요 각도 (0.1도 단위) | `imu.h`의 `attitudeEulerAngles_t` 구조체 |
| **Quaternion** | 자세 쿼터니언 (w,x,y,z) | `imu.h`의 `quaternion` 구조체 |
| **Rotation matrix (rMat)** | 3x3 회전 행렬 | `imu.h`의 `rMat[3][3]` |
| **MSP_ATTITUDE 응답** | 롤, 피치, 요 (도 단위) | MSP 명령 108, 컨피규레이터에서 3D 모델용으로 사용 |

### ✅ 저장되는 것으로부터 자세 복원 가능:
- **gyroADC** (각속도) → 적분하여 자세 추정 가능
- **accADC** (가속도) → 중력 벡터로부터 롤/피치 보정 가능
- **GPS_velned + GPS_ground_course** → 요/헤딩 참조 가능
- **setpoint** → 목표 자세(각도) 알 수 있음

---

## 4. MSP_ATTITUDE (컨피규레이터에서 사용하는 자세 데이터)

### 펌웨어 측 구현 (`msp.c`):
```c
case MSP_ATTITUDE:
    sbufWriteU16(dst, attitude.values.roll);   // 롤: 0.1도 단위
    sbufWriteU16(dst, attitude.values.pitch);  // 피치: 0.1도 단위
    sbufWriteU16(dst, DECIDEGREES_TO_DEGREES(attitude.values.yaw));  // 요: 도 단위
```

### 데이터 소스 (`imu.h`):
```c
typedef union {
    int16_t raw[XYZ_AXIS_COUNT];
    struct {
        int16_t roll;   // absolute angle inclination in multiple of 0.1 degree (180 deg = 1800)
        int16_t pitch;
        int16_t yaw;
    } values;
} attitudeEulerAngles_t;

extern attitudeEulerAngles_t attitude;  // 전역 변수
```

### 업데이트 주기:
- `imuUpdateAttitude()` 함수에서 매 루프마다 업데이트
- DCM(Direction Cosine Matrix) 또는 마하오니/마드윅 필터로 자이로+가속도+자력계 융합

---

## 5. 블랙박스에서 자세 복원 방법 (후처리)

### 방법 1: 자이로 적분 (Dead Reckoning)
```
attitude[k] = attitude[k-1] + gyroADC[k] * dt
```
- 드리프트 발생 → 가속도계로 보정 필요

### 방법 2: 센서 퓨전 (Mahony/Madgwick 필터)
- 블랙박스의 `gyroADC`, `accADC`, (가능시 `magADC`) 사용
- 펌웨어와 동일한 알고리즘으로 후처리에서 자세 재계산

### 방법 3: GPS 기반 헤딩 보정
- `GPS_ground_course` 또는 `GPS_velned`로 요 드리프트 보정
- 고정익 비행 시 특히 유용

---

## 6. 고정익(Airplane) 특화 고려사항

### 블랙박스에 저장되는 고정익 관련 데이터:
| 데이터 | 필드 | 비고 |
|--------|------|------|
| 모터/서보 출력 | `motor[]`, `servo[]` | 최대 8개 모터, 서보 |
| GPS 속도/방향 | `GPS_velned`, `GPS_ground_course` | 고정익에서 중요 |
| 고도 | `GPS_altitude`, `baroAlt` | 고도 유지/변화 추적 |
| 스로틀 설정값 | `setpoint[3]` | 스로틀 값 |

### 고정익 자세 분석 시 유용한 조합:
1. **gyroADC + accADC** → 기본 자세 복원
2. **GPS_velned + GPS_ground_course** → 요/헤딩 검증 및 보정
3. **setpoint (R,P,Y)** → 조종 입력 의도 파악
4. **motor/servo 출력** → 제어 면 동작 확인

---

## 7. 요약 테이블

| 구분 | 블랙박스 저장 여부 | 비고 |
|------|------------------|------|
| **자이로 (각속도)** | ✅ `gyroADC`, `gyroUnfilt` | 3축, 고해상도 옵션 |
| **가속도계** | ✅ `accADC` | 3축 |
| **자력계** | ✅ `magADC` (조건부) | USE_MAG 정의 시 |
| **Euler 각도 (롤/피치/요)** | ❌ 직접 저장 안됨 | MSP_ATTITUDE로만 조회 가능 |
| **쿼터니언** | ❌ 저장 안됨 | - |
| **회전 행렬** | ❌ 저장 안됨 | - |
| **PID 설정값** | ✅ `setpoint` | R,P,Y,T 4값 |
| **RC 명령** | ✅ `rcCommand` | R,P,Y,T 4값 |
| **PID 출력 (P/I/D/F)** | ✅ `axisPID_*` | 3축 각각 |
| **GPS 위치** | ✅ `GPS_coord` | 상대 좌표 |
| **GPS 속도 (NED)** | ✅ `GPS_velned` | 3축 속도 |
| **GPS 지상 진행방향** | ✅ `GPS_ground_course` | 헤딩 참조용 |
| **GPS 고도** | ✅ `GPS_altitude` | 0.1m 단위 |
| **기압계 고도** | ✅ `baroAlt` (조건부) | USE_BARO 정의 시 |
| **모터/서보 출력** | ✅ `motor[]`, `servo[]` | 실제 출력값 |

---

## 8. 결론 및 권장사항

### 블랙박스만으로 자세 분석 시:
1. **자이로 + 가속도계 데이터로 자세 재계산 필수** (Mahony/Madgwick 필터 권장)
2. **GPS 지상 진행방향/속도로 요 드리프트 보정** 가능
3. **고정익의 경우 GPS 속도 벡터가 자세 검증에 매우 유용**

### 컨피규레이터 연동 시:
- 실시간 자세: `MSP_ATTITUDE` (108번 명령) 사용 → `attitude.values.roll/pitch/yaw`
- 블랙박스 분석: 저장된 `gyroADC`, `accADC`, `GPS_velned` 등으로 후처리

### 향후 개선 가능성:
- 블랙박스 필드에 `attitude` (Euler angles) 또는 `quaternion` 추가 고려
- 고해상도 모드에서 자이로/가속도 스케일 정보 헤더에 기록됨 (`gyro_scale`)