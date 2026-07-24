# 기체 아이콘 표시 버그 수정 TODO

- [x] src/js/utils/map.js - 아이콘 경로를 `new URL()` 패턴으로 변경 (ICON_IMAGE_GPS, ICON_IMAGE_MAG, ICON_IMAGE_NOFIX)
- [x] src/components/tabs/FlightPlan/FlightPlanMap.vue - updateAircraftPosition() 내 Icon src와 plus-cursor.svg 경로 수정
