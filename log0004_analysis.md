# log0004.csv 블랙박스 데이터 분석 - 비행기 자세 판별 항목

## 파일 정보
- **파일**: `/home/betaflight/autopilot/log0004.csv`
- **펌웨어**: Betaflight 4.5.4
- **보드**: FLYINGRC FLYINGRC_F4WING (고정익)
- **로그 시작**: 2026-08-10T09:47:36.590+00:00
- **자이로 스케일**: `1.7453292519943295e-8` (rad/LSB = π/180 * 1e-8)

---

## CSV 데이터 컬럼 (라인 145 헤더 기준)

### 🎯 **자세 판별 핵심 필드** (총 119개 컬럼 중)

| # | 컬럼명 | 타입 | 축 | 설명 | 자세 판별 용도 |
|---|--------|------|-----|------|----------------|
| **20-22** | **gyroADC[0..2]** | int | X,Y,Z | **자이로 각속도** (필터링됨) | **필수** - 자세 적분용 |
| **23-25** | **accSmooth[0..2]** | int | X,Y,Z | **가속도계** (스무딩됨) | **필수** - 중력 벡터로 롤/피치 보정 |
| **15-18** | **setpoint[0..3]** | int | R,P,Y,T | PID 목표값 (롤,피치,요,스로틀) | 목표 자세 파악 |
| **107-110** | **rcCommands[0..3]** | int | R,P,Y,T | RC 조종 입력 | 조종 의도 파악 |
| **3-5** | **axisP[0..2]** | int | R,P,Y | PID P텀 출력 | 현재 자세 오차 반영 |
| **6-8** | **axisI[0..2]** | int | R,P,Y | PID I텀 출력 | 누적 자세 오차 |
| **9-11** | **axisD[0..2]** | int | R,P,Y | PID D텀 출력 | 자세 변화율 |
| **12-14** | **axisF[0..2]** | int | R,P,Y | PID F텀(피드포워드) | 목표 자세 변화 반영 |
| **101-103** | **heading[0..2]** | float | R,P,Y | **계산된 자세 각도** (라디안) | **직접 자세 값!** |
| **96** | **GPS_ground_course** | float | - | GPS 지상 진행방향 (라디안) | 요(헤딩) 참조 |
| **97-99** | **GPS_velned[0..2]** | float | N,E,D | GPS NED 속도 벡터 | 풍향 보정용 요 참조 |
| **92-93** | **GPS_coord[0..1]** | int | Lat,Lon | GPS 위도/경도 (홈 기준) | 위치 추적 |
| **94** | **GPS_altitude** | int | - | GPS 고도 (0.1m) | 고도 변화 |
| **95** | **GPS_speed** | float | - | GPS 속도 | 비행 속도 |
| **91** | **GPS_numSat** | int | - | 위성 수 | GPS 품질 |
| **19** | **baroAlt** | int | - | 기압계 고도 | 고도 보조 |
| **104-106** | **axisSum[0..2]** | int | R,P,Y | PID 총합 출력 | 모터 믹싱 전 총 출력 |
| **111-113** | **axisError[0..2]** | int | R,P,Y | PID 에러 (목표-현재) | 자세 오차 직접 확인 |
| **34** | **flightModeFlags** | int | - | 활성 플라이트 모드 | 모드별 동작 파악 |
| **1** | **loopIteration** | int | - | 루프 카운터 | 시간 동기화 |
| **2** | **time** | int | - | 타임스탬프 (μs) | 절대 시간 |

---

## 🔑 **자세 복원에 필요한 최소 필드 세트**

### 1순위: 완전한 자세 복원 (Mahony/Madgwick 필터)
```python
# 필수 3종 세트
gyro = [gyroADC[0], gyroADC[1], gyroADC[2]] * gyroScale  # rad/s
acc  = [accSmooth[0], accSmooth[1], accSmooth[2]]        # raw ADC
mag  = [magADC[0], magADC[1], magADC[2]]                 # 이 파일에 없음 ❌
```

### 2순위: GPS 보정 자세 복원 (이 파일에 있는 것들로)
```python
# 이 파일에 있는 것으로 가능
gyro = [gyroADC[0], gyroADC[1], gyroADC[2]] * gyroScale  # rad/s
acc  = [accSmooth[0], accSmooth[1], accSmooth[2]]        # raw ADC
gps_heading = GPS_ground_course                          # 라디안 (요 참조)
gps_velned  = [GPS_velned[0], GPS_velned[1], GPS_velned[2]]  # cm/s (풍향 추정용)
```

### 3순위: 직접 자세 값 사용 (이미 계산됨!)
```python
# heading[0..2]가 이미 라디안 단위 자세 각도!
roll  = heading[0]   # 라디안
pitch = heading[1]   # 라디안  
yaw   = heading[2]   # 라디안 (0~2π, 북쪽=0)
```

---

## 📊 **데이터 샘플 분석 (첫 10행)**

| loopIter | time(μs) | heading[0](roll) | heading[1](pitch) | heading[2](yaw) | GPS_ground_course | GPS_velned[N,E,D] |
|----------|----------|------------------|-------------------|-----------------|-------------------|-------------------|
| 0 | 391541944 | -0.050 | -0.074 | 6.283 | NaN | NaN,NaN,NaN |
| 4 | 391543944 | -0.061 | -0.066 | 6.283 | NaN | NaN,NaN,NaN |
| 8 | 391546194 | -0.075 | -0.070 | 6.283 | NaN | NaN,NaN,NaN |
| 12 | 391548194 | -0.084 | -0.073 | 6.282 | NaN | NaN,NaN,NaN |
| 16 | 391550194 | -0.087 | -0.078 | 6.282 | NaN | NaN,NaN,NaN |
| 20 | 391552196 | -0.081 | -0.082 | 6.282 | NaN | NaN,NaN,NaN |
| 24 | 391554194 | -0.066 | -0.086 | 6.281 | NaN | NaN,NaN,NaN |
| 28 | 391556194 | -0.046 | -0.090 | 6.281 | NaN | NaN,NaN,NaN |
| 32 | 391558194 | -0.026 | -0.093 | 6.281 | NaN | NaN,NaN,NaN |
| 36 | 391560194 | -0.011 | -0.095 | 6.281 | NaN | NaN,NaN,NaN |

**관찰사항:**
- **heading[2] (yaw) ≈ 6.283 ≈ 2π ≈ 0 라디안 (북쪽)** - 초기값
- **heading[0] (roll)**: -0.05 ~ -0.09 rad ≈ **-3° ~ -5°** (약간 좌측 롤)
- **heading[1] (pitch)**: -0.07 ~ -0.12 rad ≈ **-4° ~ -7°** (약간 노즈 다운)
- **GPS 데이터 초기엔 NaN** - GPS 픽스 대기 중
- **loopIteration 4씩 증가** - P-frame 간격 (frameIntervalPNum=1, frameIntervalPDenom=4)

---

## ⚠️ **주의사항**

### 1. **heading[0..2] 단위: 라디안** (도 아님!)
```python
roll_deg  = heading[0] * 180 / π
pitch_deg = heading[1] * 180 / π
yaw_deg   = heading[2] * 180 / π
```

### 2. **gyroADC 스케일 적용 필요**
```python
gyroScale = 1.7453292519943295e-8  # rad/LSB
gyro_rad_s = gyroADC_raw * gyroScale
```

### 3. **accSmooth 단위: raw ADC** (acc_1G = 2048 기준)
```python
acc_g = accSmooth_raw / 2048.0  # 1G 단위
```

### 4. **GPS_ground_course, GPS_velned 단위: 라디안, cm/s**

### 5. **초기 GPS 데이터 NaN** - GPS 픽스 전까지 자세 복원 시 주의

---

## ✅ **결론: 이 파일로 비행기 자세 완전 판별 가능**

| 자세 축 | 판별 방법 | 신뢰도 |
|--------|----------|--------|
| **롤** | `heading[0]` 직접 사용 또는 `gyroADC+accSmooth` 융합 | ⭐⭐⭐⭐⭐ |
| **피치** | `heading[1]` 직접 사용 또는 `gyroADC+accSmooth` 융합 | ⭐⭐⭐⭐⭐ |
| **요(헤딩)** | `heading[2]` 직접 사용, `GPS_ground_course`로 검증/보정 | ⭐⭐⭐⭐ |

**추천 접근법:**
1. **가장 간단**: `heading[0], heading[1], heading[2]` 직접 사용 (이미 필터링된 자세)
2. **검증/보정**: `GPS_ground_course`와 `heading[2]` 비교로 요 드리프트 확인
3. **풍향 추정**: `GPS_velned` + 대속도 추정 → 실제 Heading 계산
4. **재계산 필요시**: `gyroADC` + `accSmooth` + `GPS_ground_course`로 Mahony 필터 재실행