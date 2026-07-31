# 블랙박스(BBL) 기록 방식 및 로깅 항목 가이드

autopilot 펌웨어의 블랙박스는 `blackboxConfig()->fields_disabled_mask` 비트마스크로 개별 로깅 항목을 선택/해제할 수 있습니다. 각 비트는 `FLIGHT_LOG_FIELD_SELECT_*` 열거형에 대응합니다.

## 1. 로깅 항목 목록

`src/main/blackbox/blackbox_fielddefs.h`의 `FlightLogFieldSelect_e` 정의:

| 비트 | 항목명 | 설명 |
|------|--------|------|
| 0 | `PID` | PID 제어 출력 |
| 1 | `RC_COMMANDS` | RC 명령값 |
| 2 | `SETPOINT` | 세트포인트 |
| 3 | `BATTERY` | 배터리 전압/전류 |
| 4 | `MAG` | 자력계 (MAG) |
| 5 | `ALTITUDE` | 고도 (BARO/초음파) |
| 6 | `RSSI` | 신호 강도 |
| 7 | `GYRO` | 자이로 (필터링됨) |
| 8 | `ACC` | 가속도계 |
| 9 | `DEBUG_LOG` | 디버그 로그 |
| 10 | `MOTOR` | 모터 출력 |
| 11 | `GPS` | **GPS 위치 데이터** |
| 12 | `RPM` | 모터 eRPM (DSHOT 텔레메트리) |
| 13 | `GYROUNFILT` | 자이로 (필터링 안 됨) |

## 2. 각 항목 선택 시 저장되는 데이터

### PID (비트 0)
- `axisP[0]`, `axisP[1]`, `axisP[2]` — PID P 출력
- `axisI[0]`, `axisI[1]`, `axisI[2]` — PID I 출력
- `axisD[0]`, `axisD[1]`, `axisD[2]` — PID D 출력
- `axisF[0]`, `axisF[1]`, `axisF[2]` — PID FF 출력

### RC_COMMANDS (비트 1)
- `rcCommand[0]`, `rcCommand[1]`, `rcCommand[2]` — 롤/피치/요우 입력
- `rcCommand[3]` — 스로틀 입력

### SETPOINT (비트 2)
- `setpoint[0]`, `setpoint[1]`, `setpoint[2]`, `setpoint[3]` — 목표 각속도/스로틀

### BATTERY (비트 3)
- `vbat` — 배터리 전압
- `amperage` — 배터리 전류 (전류계 존재 시)
- `batteryOkay`, `powerState` — 배터리 상태

### MAG (비트 4) — `SENSOR_MAG` 활성화 필요
- `mag[0]`, `mag[1]`, `mag[2]` — 자력계 X/Y/Z

### ALTITUDE (비트 5) — `SENSOR_BARO` 활성화 필요
- `BaroAlt` — 기압계 고도
- `sonar` — 초음파 거리 (`SENSOR_RANGEFINDER` 시)

### RSSI (비트 6) — RSSI 설정 필요
- `rssi` — 수신 신호 강도

### GYRO (비트 7)
- `gyro[0]`, `gyro[1]`, `gyro[2]` — 자이로 (필터링됨)

### ACC (비트 8) — `SENSOR_ACC` 활성화 필요
- `acc[0]`, `acc[1]`, `acc[2]` — 가속도계 X/Y/Z

### DEBUG_LOG (비트 9) — DEBUG 모드 필요
- `debug[0]`, `debug[1]`, `debug[2]`, `debug[3]` — 디버그 값

### MOTOR (비트 10)
- `motor[0]`~`motor[7]` — 모터 출력 (설정된 모터 수만큼)
- `servo[5]` — 트리콥터 서보 (`MIXER_TRI` 시)

### GPS (비트 11) — **맵 항적 표시에 필수**
- `GPS_numSat` — 위성 수
- `GPS_coord[0]` — **위도** (1e-7 deg)
- `GPS_coord[1]` — **경도** (1e-7 deg)
- `GPS_altitude` — **고도** (cm)
- `GPS_speed` — 지상 속도
- `GPS_ground_course` — **지상 방위각** (도)
- `GPS_velned[0]`, `GPS_velned[1]`, `GPS_velned[2]` — NED 속도
- `GPS_time` — GPS 시간
- `GPS_home[0]`, `GPS_home[1]`, `GPS_home[2]` — 홈 위치
- `GPS_home_epoch` — 홈 epoch
- `flightModeFlags` — 비행 모드 플래그 (GPS_RESCUE 등 포함)

### RPM (비트 12) — DSHOT 텔레메트리 필요
- `eRPM[0]`~`eRPM[7]` — 모터 eRPM/100

### GYROUNFILT (비트 13)
- `gyroUnfilt[0]`, `gyroUnfilt[1]`, `gyroUnfilt[2]` — 자이로 (필터링 안 됨)

## 3. 항상 기록되는 필드 (조건 무관)

모든 로깅 설정과 무관하게 항상 기록:
- `loopIteration` — 제어 루프 반복 카운트
- `time` — 타임스탬프
- GPS 관련 필드 (GPS 항목 선택 시, 아래 참조)

## 4. 맵 항적 표시에 필요한 최소 설정

| 목적 | 필수 항목 |
|------|-----------|
| 비행 궤적 / 현재 위치 / 홈 표시 | **GPS** (비트 11) |
| 고도 컬러 트레일 | GPS (고도는 GPS 항목 포함) |
| Rescue 모드 감지 | GPS (flightModeFlags 포함) |
| WP / A·B 포인트 | **추가 펌웨어 수정 필요** (현재 BBL에 WP 데이터 없음) |

**결론**: `GPS` 로깅 항목만 선택되어 있으면 4가지 기본 데이터(GPS_coord[0/1], GPS_altitude, GPS_ground_course)가 BBL에 저장되며, 맵에 항적이 표시됩니다.

## 5. 로깅 비트마스크 해제 방법

```c
// GPS 항목을 비활성화하려면 (필드 누락)
blackboxConfigMutable()->fields_disabled_mask |= (1 << FLIGHT_LOG_FIELD_SELECT_GPS);

// GPS 항목을 활성화하려면
blackboxConfigMutable()->fields_disabled_mask &= ~(1 << FLIGHT_LOG_FIELD_SELECT_GPS);
```

configurator UI에서는 Blackbox 설정 화면의 "Logged data" 섹션에서 GPS 체크박스를 선택/해제합니다.
