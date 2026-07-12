<template>
    <UiBox :title="$t('flightPlanElevationProfile')" class="elevation-profile">
        <template v-if="waypoints.length > 0">
            <div class="profile-stats">
                <span class="stat">
                    <strong>{{ $t("flightPlanDistance") }}:</strong> {{ formatDistance(totalDistance) }}
                </span>
                <span class="stat">
                    <strong>{{ $t("flightPlanFlightTime") }}:</strong> {{ totalFlightTime }}
                </span>
                <span class="stat">
                    <strong>{{ $t("flightPlanMinAlt") }}:</strong> {{ formatAltitude(minAltitude) }}
                </span>
                <span class="stat">
                    <strong>{{ $t("flightPlanMaxAlt") }}:</strong> {{ formatAltitude(maxAltitude) }}
                </span>
                <span class="stat">
                    <strong>{{ $t("flightPlanRelativeGroundElev") }}:</strong>
                    {{ formatAltitude(selectedWpRelativeGroundElev) }}
                    <span class="stat-note" v-if="selectedWaypointUid"
                        >(WP{{ (profilePoints.find((p) => p.uid === selectedWaypointUid)?.order ?? 0) + 1 }})</span
                    >
                </span>
                <span class="stat">
                    <strong>{{ $t("flightPlanRelativeMaxGroundElev") }}:</strong>
                    {{ formatAltitude(relativeMaxGroundElevation) }}
                </span>
            </div>

            <div class="profile-chart-container">
                <svg
                    ref="chartSvg"
                    :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
                    class="profile-chart"
                    @mousemove="handleMouseMove"
                    @mouseleave="handleMouseLeave"
                    @pointermove="handlePointerMove"
                    @pointerup="handlePointerUp"
                    @pointercancel="handlePointerUp"
                >
                    <!-- Y-axis grid lines and labels -->
                    <g class="y-axis">
                        <line
                            v-for="tick in yAxisTicks"
                            :key="`y-${tick.value}`"
                            :x1="padding.left"
                            :y1="tick.y"
                            :x2="chartWidth - padding.right"
                            :y2="tick.y"
                            class="grid-line"
                        />
                        <text
                            v-for="tick in yAxisTicks"
                            :key="`y-label-${tick.value}`"
                            :x="padding.left - 9"
                            :y="tick.y + 3"
                            class="axis-label"
                            text-anchor="end"
                        >
                            {{ formatAltitude(tick.value) }}
                        </text>
                    </g>

                    <!-- Y-axis title: AMSL -->
                    <text :x="padding.left - 12" :y="padding.top - 5" class="y-axis-title" text-anchor="end">
                        {{ $t("flightPlanAMSL") }}
                    </text>

                    <!-- X-axis grid lines and labels -->
                    <g class="x-axis">
                        <line
                            v-for="(point, index) in scaledProfilePoints"
                            :key="`x-${index}`"
                            :x1="point.x"
                            :y1="padding.top"
                            :x2="point.x"
                            :y2="chartHeight - padding.bottom"
                            class="grid-line-light"
                        />
                        <text
                            v-for="(point, index) in scaledProfilePoints"
                            :key="`x-label-${index}`"
                            :x="point.x"
                            :y="chartHeight - padding.bottom + 15"
                            class="axis-label"
                            text-anchor="middle"
                        >
                            {{ formatDistance(point.distance) }}
                        </text>
                    </g>

                    <!-- Terrain area fill (ground elevation at each waypoint) -->
                    <path v-if="terrainAreaPath" :d="terrainAreaPath" class="terrain-area" />

                    <!-- Terrain line (ground elevation profile) -->
                    <path v-if="terrainLinePath" :d="terrainLinePath" class="terrain-line" />

                    <!-- Average ground elevation reference line -->
                    <line
                        v-if="groundElevation > 0"
                        :x1="padding.left"
                        :y1="scaleY(groundElevation)"
                        :x2="chartWidth - padding.right"
                        :y2="scaleY(groundElevation)"
                        class="ground-line"
                    />
                    <text
                        v-if="groundElevation > 0"
                        :x="chartWidth - padding.right - 5"
                        :y="scaleY(groundElevation) - 3"
                        class="ground-label"
                        text-anchor="end"
                    >
                        {{ $t("flightPlanAvgGround") }}
                    </text>

                    <!-- Maximum ground elevation reference line -->
                    <line
                        v-if="maxGroundElevation > 0"
                        :x1="padding.left"
                        :y1="scaleY(maxGroundElevation)"
                        :x2="chartWidth - padding.right"
                        :y2="scaleY(maxGroundElevation)"
                        class="max-ground-line"
                    />
                    <text
                        v-if="maxGroundElevation > 0"
                        :x="chartWidth - padding.right - 5"
                        :y="scaleY(maxGroundElevation) - 3"
                        class="max-ground-label"
                        text-anchor="end"
                    >
                        {{ $t("flightPlanMaxGround") }}
                    </text>

                    <!-- Elevation area fill -->
                    <path :d="areaPath" class="elevation-area" />

                    <!-- Elevation line -->
                    <path :d="linePath" class="elevation-line" />

                    <!-- Invisible wide hit-area for double-click-to-insert -->
                    <path :d="linePath" class="elevation-line-hitarea" @dblclick="handleLineDoubleClick" />

                    <!-- Waypoint markers -->
                    <g class="waypoint-markers">
                        <circle
                            v-for="(point, index) in scaledProfilePoints"
                            :key="`marker-${index}`"
                            :cx="point.x"
                            :cy="point.y"
                            r="10"
                            :fill="getMarkerColor(point)"
                            :stroke="getMarkerStroke(point)"
                            :stroke-width="getMarkerStrokeWidth(point)"
                            class="waypoint-marker"
                            :class="{ selected: point.uid === selectedWaypointUid }"
                            @pointerdown="handlePointerDown($event, point)"
                        />
                        <text
                            v-for="(point, index) in scaledProfilePoints"
                            :key="`label-${index}`"
                            :x="point.x"
                            :y="point.y - 14"
                            class="waypoint-label"
                            text-anchor="middle"
                        >
                            WP{{ point.order + 1 }}
                        </text>
                    </g>
                </svg>
            </div>

            <!-- Elevation API error -->
            <div v-if="elevationError" class="elevation-error">⚠️ {{ elevationError }}</div>

            <Teleport to="body">
                <div
                    v-if="tooltipData.visible"
                    class="global-wp-tooltip"
                    :style="{ left: tooltipData.x + 'px', top: tooltipData.y + 'px' }"
                >
                    <div>WP{{ tooltipData.order }}</div>
                    <div>지상고도: {{ formatAltitude(tooltipData.groundElev) }}</div>
                    <div>{{ $t("flightPlanRelativeAltLabel") }}: {{ formatAltitude(tooltipData.altitude) }}</div>
                    <div>{{ $t("flightPlanSpeedLabel") }}: {{ formatSpeedMps(tooltipData.speed) }}</div>
                </div>
            </Teleport>
        </template>

        <div v-else class="no-waypoints">
            <p>{{ $t("flightPlanNoWaypointsForProfile") }}</p>
        </div>
    </UiBox>
</template>

<script setup>
import { ref, computed, watch, reactive, onMounted, onUnmounted } from "vue";
import { debounce } from "lodash-es";
import UiBox from "@/components/elements/UiBox.vue";
import { useFlightPlan } from "@/composables/useFlightPlan";
import { useSettingsStore } from "@/stores/settings";

const { positionalWaypoints, selectedWaypointUid, selectWaypoint, updateWaypoint, insertWaypointAfter } =
    useFlightPlan();
const settings = useSettingsStore();
const waypoints = positionalWaypoints;

const chartSvg = ref(null);

const chartWidth = 800;
const chartHeight = 150;
const padding = { top: 20, right: 20, bottom: 35, left: 45 };
const DRAG_DIRECTION_THRESHOLD = 10;

const isFetchingElevation = ref(false);
const needsFetchAgain = ref(false);
const elevationError = ref(null); // API 에러 메시지 (화면 표시용)
const segmentCache = reactive(new Map());

// 웨이포인트의 "위치 관련" 상태만 뽑아낸 시그니처 문자열.
// 이 값이 바뀔 때만 지면표고 API를 재호출해야 한다 (고도/속도/duration/pattern/type 변경은 제외).
const positionSignature = computed(() =>
    waypoints.value.map((wp) => `${wp.uid}:${wp.order}:${wp.latitude.toFixed(7)}:${wp.longitude.toFixed(7)}`).join("|"),
);

const ELEVATION_API_URL = "https://api.open-meteo.com/v1/elevation";
const MIN_SAMPLE_INTERVAL_METERS = 40;
const MAX_SAMPLES_PER_SEGMENT = 25;
const MAX_TOTAL_SAMPLES = 160;

const METERS_TO_FEET = 3.28084;
const METERS_TO_NAUTICAL_MILES = 1 / 1852;

/* ──────────────────────────────────────────────────
   ✅ ✅ ✅ 안드로이드 터치 스크롤 방지 — 가장 중요한 부분
   Vue @pointermove 는 passive:true 라서 안드로이드에서 preventDefault 가 무시됨
   → 직접 window 에 passive:false 로 리스너 등록
   ────────────────────────────────────────────────── */
const preventTouchScroll = (e) => {
    if (!dragState.value.active) return;
    if (e.cancelable) {
        try {
            e.preventDefault();
        } catch {}
    }
    e.stopPropagation();
};

onMounted(() => {
    window.addEventListener("touchmove", preventTouchScroll, { passive: false, capture: true });
    window.addEventListener(
        "touchstart",
        (e) => {
            if (e.target.closest(".waypoint-marker") && e.cancelable) {
                try {
                    e.preventDefault();
                } catch {}
            }
        },
        { passive: false },
    );
});

onUnmounted(() => {
    window.removeEventListener("touchmove", preventTouchScroll, true);
});
/* ────────────────── 터치 고정 끝 ────────────────── */

const getSegmentKey = (fromUid, toUid) => `${fromUid}-${toUid}`;

const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const interpolatePoint = (lat1, lon1, lat2, lon2, fraction) => {
    const distance = calculateDistance(lat1, lon1, lat2, lon2);
    if (distance < 0.001) return { latitude: lat1, longitude: lon1 };
    const φ1 = (lat1 * Math.PI) / 180,
        λ1 = (lon1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180,
        λ2 = (lon2 * Math.PI) / 180;
    const d = distance / 6371000;
    const a = Math.sin((1 - fraction) * d) / Math.sin(d);
    const b = Math.sin(fraction * d) / Math.sin(d);
    const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
    const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
    const z = a * Math.sin(φ1) + b * Math.sin(φ2);
    return {
        latitude: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
        longitude: (Math.atan2(y, x) * 180) / Math.PI,
    };
};

const formatAltitude = (ft) => settings.formatAltitude(ft);
const formatSpeedMps = (kt) => settings.formatSpeedMps(kt);
const formatDistance = (meters) => settings.formatDistance(meters);

const currentTerrainSamples = computed(() => {
    if (waypoints.value.length === 0) return [];
    const samples = [];
    let cumulativeDistance = 0;
    for (let i = 1; i < waypoints.value.length; i++) {
        const prevWp = waypoints.value[i - 1],
            wp = waypoints.value[i];
        const key = getSegmentKey(prevWp.uid, wp.uid);
        const dist = calculateDistance(prevWp.latitude, prevWp.longitude, wp.latitude, wp.longitude);
        const cached = segmentCache.get(key);
        if (cached?.samples?.length) {
            cached.samples.forEach((s) =>
                samples.push({
                    ...s,
                    distance: cumulativeDistance + (s.relativeDistance / cached.distance) * dist,
                }),
            );
        } else {
            samples.push({
                latitude: prevWp.latitude,
                longitude: prevWp.longitude,
                distance: cumulativeDistance,
                elevation: 0,
            });
            samples.push({
                latitude: wp.latitude,
                longitude: wp.longitude,
                distance: cumulativeDistance + dist,
                elevation: 0,
            });
        }
        cumulativeDistance += dist;
    }
    return samples;
});

const groundElevation = computed(() =>
    currentTerrainSamples.value.length
        ? Math.round(
            currentTerrainSamples.value.reduce((a, s) => a + s.elevation, 0) / currentTerrainSamples.value.length,
        )
        : 0,
);
const wp1GroundElevation = computed(() => currentTerrainSamples.value[0]?.elevation ?? 0);

const getGroundElevAtPoint = (distance) => {
    const s = currentTerrainSamples.value;
    if (!s.length) return 0;
    if (distance <= s[0].distance) return s[0].elevation;
    if (distance >= s[s.length - 1].distance) return s[s.length - 1].elevation;
    for (let i = 0; i < s.length - 1; i++) {
        if (distance >= s[i].distance && distance <= s[i + 1].distance) {
            const t = (distance - s[i].distance) / (s[i + 1].distance - s[i].distance);
            return s[i].elevation + t * (s[i + 1].elevation - s[i].elevation);
        }
    }
    return 0;
};

const maxAllowedAGL = 10000;

// ✅ 고도 방향 저장용 필드 추가 (녹/파 구분)
const dragState = ref({
    active: false,
    type: null,
    wpUid: null,
    startX: 0,
    startY: 0,
    lastValue: 0,
    altDirection: 0, // +1=올림=녹 / -1=내림=파
    lastMoveTime: 0,
    speedVisualOffsetX: 0,
    speedDirection: 0,
    speedInterval: null,
});

const tooltipData = ref({ visible: false, x: 0, y: 0, order: 0, altitude: 0, speed: 0, groundElev: 0 });

const profilePoints = computed(() => {
    if (!waypoints.value.length) return [];
    let cum = 0;
    const wpg = wp1GroundElevation.value;
    return waypoints.value.map((wp, i) => {
        if (i)
            cum += calculateDistance(
                waypoints.value[i - 1].latitude,
                waypoints.value[i - 1].longitude,
                wp.latitude,
                wp.longitude,
            );
        return {
            uid: wp.uid,
            order: wp.order,
            altitude: wp.altitude,
            altitudeAMSL: wp.altitude + wpg,
            speed: wp.speed || 0,
            distance: cum,
            latitude: wp.latitude,
            longitude: wp.longitude,
        };
    });
});

const totalDistance = computed(() => profilePoints.value.at(-1)?.distance ?? 0);
const minAltitude = computed(() =>
    waypoints.value.length ? Math.round(Math.min(...waypoints.value.map((w) => w.altitude))) : 0,
);
const maxAltitude = computed(() =>
    waypoints.value.length ? Math.round(Math.max(...waypoints.value.map((w) => w.altitude))) : 0,
);
const maxGroundElevation = computed(() =>
    currentTerrainSamples.value.length
        ? Math.round(Math.max(...currentTerrainSamples.value.map((s) => s.elevation)))
        : 0,
);

const selectedWpRelativeGroundElev = computed(() => {
    if (!selectedWaypointUid.value) return 0;
    const p = profilePoints.value.find((x) => x.uid === selectedWaypointUid.value);
    return p ? getGroundElevAtPoint(p.distance) - wp1GroundElevation.value : 0;
});
const relativeMaxGroundElevation = computed(() =>
    currentTerrainSamples.value.length
        ? Math.max(...currentTerrainSamples.value.map((s) => s.elevation)) - wp1GroundElevation.value
        : 0,
);

const totalFlightTime = computed(() => {
    if (waypoints.value.length < 2) return "0:00";
    let h = 0;
    for (let i = 0; i < waypoints.value.length - 1; i++) {
        const d =
            calculateDistance(
                waypoints.value[i].latitude,
                waypoints.value[i].longitude,
                waypoints.value[i + 1].latitude,
                waypoints.value[i + 1].longitude,
            ) * METERS_TO_NAUTICAL_MILES;
        const sp = (waypoints.value[i].speed ?? 10) <= 0 ? 1 : (waypoints.value[i].speed ?? 10);
        h += d / sp;
    }
    let hr = Math.floor(h),
        mn = Math.round((h - hr) * 60);
    if (mn === 60) {
        hr++;
        mn = 0;
    }
    return `${hr}:${mn.toString().padStart(2, "0")}`;
});

const combinedMax = computed(() => {
    const a = profilePoints.value.length ? Math.max(...profilePoints.value.map((p) => p.altitudeAMSL)) : 0;
    return Math.max(a, maxGroundElevation.value, 100);
});

const yAxisTicks = computed(() => {
    const max = combinedMax.value,
        range = max || 100;
    const step = Math.ceil(range / 4 / 10) * 10 || 50;
    return Array.from({ length: 5 }, (_, i) => ({ value: i * step, y: scaleY(i * step) }));
});

const scaleX = (d) => padding.left + (d / (totalDistance.value || 1)) * (chartWidth - padding.left - padding.right);
const unscaleX = (x) => ((x - padding.left) / (chartWidth - padding.left - padding.right)) * (totalDistance.value || 1);
const scaleY = (alt) => {
    const max = combinedMax.value,
        range = max || 100,
        pMax = max + range * 0.1,
        pR = pMax;
    return chartHeight - padding.bottom - (alt / pR) * (chartHeight - padding.top - padding.bottom);
};

const scaledProfilePoints = computed(() =>
    profilePoints.value.map((p) => ({
        ...p,
        x:
            scaleX(p.distance) +
            (dragState.value.active && dragState.value.type === "speed" && dragState.value.wpUid === p.uid
                ? dragState.value.speedVisualOffsetX
                : 0),
        y: scaleY(p.altitudeAMSL),
    })),
);

const linePath = computed(() => scaledProfilePoints.value.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "));
const areaPath = computed(() => {
    if (!scaledProfilePoints.value.length) return "";
    const by = chartHeight - padding.bottom,
        pts = scaledProfilePoints.value;
    return `${pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ")} L ${pts.at(-1).x} ${by} L ${pts[0].x} ${by} Z`;
});
const terrainLinePath = computed(() =>
    currentTerrainSamples.value
        .map((s, i) => `${i ? "L" : "M"} ${scaleX(s.distance)} ${scaleY(s.elevation)}`)
        .join(" "),
);
const terrainAreaPath = computed(() => {
    if (!currentTerrainSamples.value.length) return "";
    const by = chartHeight - padding.bottom;
    const top = currentTerrainSamples.value
        .map((s, i) => `${i ? "L" : "M"} ${scaleX(s.distance)} ${scaleY(s.elevation)}`)
        .join(" ");
    return `${top} L ${scaleX(currentTerrainSamples.value.at(-1).distance)} ${by} L ${scaleX(0)} ${by} Z`;
});

const updateTooltipPosition = (e, wp) => {
    const r = e.target.getBoundingClientRect();
    const cx = r.left + r.width / 2,
        top = r.top;
    let y = top - 90,
        x = cx - 75;
    if (x < 4) x = 4;
    if (x + 150 > innerWidth - 4) x = innerWidth - 154;
    if (y < 4) y = r.bottom + 20;
    const tooltipGroundElev = calcGroundElev(wp.altitude ?? 0, wp.distance);
    tooltipData.value = {
        visible: true,
        x,
        y,
        order: (wp.order ?? 0) + 1,
        altitude: wp.altitude ?? 0,
        speed: wp.speed ?? 0,
        groundElev: tooltipGroundElev,
    };
};

// ✅ ✅ ✅ 네가 원했던 색상 규칙 정확히 적용
// 🟢 위로 드래그 = 고도 올림 = 녹색
// 🔵 아래로 드래그 = 고도 내림 = 파란색
// 🩷 좌우 드래그 = 속도 변경 = 분홍
// 지상고도 = 기체AMSL - 지면AMSL
const calcGroundElev = (altitude, distance) => {
    const terrainAMSL = getGroundElevAtPoint(distance);
    const aircraftAMSL = altitude + wp1GroundElevation.value;
    return Math.round(aircraftAMSL - terrainAMSL);
};
const getMarkerColor = (p) => {
    if (dragState.value.active && dragState.value.wpUid === p.uid) {
        if (dragState.value.type === "altitude") {
            return dragState.value.altDirection >= 0 ? "#22c55e" : "#3b82f6"; // 🟢녹 / 🔵파
        }
        if (dragState.value.type === "speed") return "#FF69B4"; // 🩷분홍
    }
    if (p.uid === selectedWaypointUid.value) return "var(--success-500)";
    return "var(--primary-500)";
};
const getMarkerStroke = (p) => "var(--surface-50)";
const getMarkerStrokeWidth = (p) => (p.uid === selectedWaypointUid.value ? 2 : 1.5);

const updateTooltipData = (p) => Object.assign(tooltipData.value, { altitude: p.altitude, speed: p.speed });

const handleLineDoubleClick = (e) => {
    const svg = chartSvg.value;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const sp = pt.matrixTransform(svg.getScreenCTM().inverse());
    const cd = unscaleX(sp.x);
    const pts = profilePoints.value;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i],
            b = pts[i + 1];
        if (cd >= a.distance && cd <= b.distance) {
            const f = b.distance - a.distance > 0 ? (cd - a.distance) / (b.distance - a.distance) : 0;
            const ll = interpolatePoint(a.latitude, a.longitude, b.latitude, b.longitude, f);
            insertWaypointAfter(a.uid, {
                latitude: ll.latitude,
                longitude: ll.longitude,
                altitude: Math.round(a.altitude + f * (b.altitude - a.altitude)),
                speed: a.speed,
            });
            return;
        }
    }
};

const handlePointerDown = (e, point) => {
    // ✅ 안드로이드: 누르는 순간 기본동작 차단 → 스크롤 시작 자체를 막음
    if (e.cancelable)
        try {
            e.preventDefault();
        } catch {}
    e.stopPropagation();

    selectWaypoint(point.uid);
    updateTooltipPosition(e, point);
    updateTooltipData(point);
    tooltipData.value.visible = true;
    try {
        e.target.setPointerCapture(e.pointerId);
    } catch {}

    dragState.value = {
        active: true,
        type: null,
        wpUid: point.uid,
        startX: e.clientX,
        startY: e.clientY,
        lastValue: point.altitude,
        altDirection: 0,
        lastMoveTime: 0,
        speedVisualOffsetX: 0,
        speedDirection: 0,
        speedInterval: null,
    };
};

const handlePointerMove = (e) => {
    if (!dragState.value.active) return;

    // ✅ ✅ ✅ 가장 중요: 드래그 중이면 무조건 스크롤 막음
    if (e.cancelable)
        try {
            e.preventDefault();
        } catch {}
    e.stopPropagation();

    const dx = e.clientX - dragState.value.startX;
    const dy = e.clientY - dragState.value.startY;
    const ax = Math.abs(dx),
        ay = Math.abs(dy);

    if (!dragState.value.type) {
        if (ax > DRAG_DIRECTION_THRESHOLD || ay > DRAG_DIRECTION_THRESHOLD) {
            dragState.value.type = ay > ax ? "altitude" : "speed";
            dragState.value.startX = e.clientX;
            dragState.value.startY = e.clientY;
        }
        return;
    }

    if (dragState.value.type === "speed") {
        const sd = e.clientX - dragState.value.startX;
        dragState.value.speedVisualOffsetX = Math.sign(sd) * Math.min(Math.abs(sd) * 0.5, 15);
        dragState.value.speedDirection = Math.abs(sd) > 8 ? Math.sign(sd) : 0;
        if (!dragState.value.speedInterval) startSpeedChangeInterval();
    } else if (dragState.value.type === "altitude") {
        // ✅ 방향 기록 → 색상 녹/파 전환
        const d = dragState.value.startY - e.clientY;
        dragState.value.altDirection = Math.abs(d) > 2 ? Math.sign(d) : dragState.value.altDirection;
        handleAltDragMove(e);
    }

    const dp = scaledProfilePoints.value.find((p) => p.uid === dragState.value.wpUid);
    if (dp) updateTooltipPosition(e, dp);
};

const handlePointerUp = (e) => {
    if (!dragState.value.active) return;
    stopSpeedChangeInterval();
    try {
        if (e?.pointerId != null) e.target.releasePointerCapture(e.pointerId);
    } catch {}
    dragState.value = {
        active: false,
        type: null,
        wpUid: null,
        startX: 0,
        startY: 0,
        lastValue: 0,
        altDirection: 0,
        lastMoveTime: 0,
        speedVisualOffsetX: 0,
        speedDirection: 0,
        speedInterval: null,
    };
};

const handleAltDragMove = (e) => {
    const wp = waypoints.value.find((w) => w.uid === dragState.value.wpUid);
    const svg = chartSvg.value;
    if (!wp || !svg) return;
    const rect = svg.getBoundingClientRect();
    const pH = chartHeight - padding.top - padding.bottom;
    const range = combinedMax.value || 100;
    const ftPx = (range * 1.1) / (pH * (rect.height / chartHeight));
    const d = (dragState.value.startY - e.clientY) * ftPx;
    const alt = Math.max(selectedWpRelativeGroundElev.value, Math.min(maxAllowedAGL, Math.round(wp.altitude + d)));
    if (alt !== wp.altitude) {
        updateWaypoint(wp.uid, { altitude: alt });
        dragState.value.startY = e.clientY;
        tooltipData.value.altitude = alt;
        tooltipData.value.groundElev = calcGroundElev(alt, wp.distance);
    }
};

const startSpeedChangeInterval = () => {
    if (dragState.value.speedInterval) return;
    dragState.value.speedInterval = setInterval(() => {
        if (!dragState.value.active || dragState.value.type !== "speed" || !dragState.value.speedDirection)
            return stopSpeedChangeInterval();
        const wp = waypoints.value.find((w) => w.uid === dragState.value.wpUid);
        if (!wp) return;
        const mps = Math.max(
            5,
            Math.min(25, Math.round(settings.storageToMps(wp.speed || 10)) + dragState.value.speedDirection),
        );
        const kt = settings.mpsToStorage(mps);
        if (Math.abs(kt - wp.speed) > 0.01) {
            updateWaypoint(wp.uid, { speed: kt });
            tooltipData.value.speed = kt;
        }
    }, 250);
};
const stopSpeedChangeInterval = () => {
    if (dragState.value.speedInterval) {
        clearInterval(dragState.value.speedInterval);
        dragState.value.speedInterval = null;
    }
};

const handleMouseMove = (e) => {
    if (dragState.value.active && e.pointerType === "mouse") handlePointerMove(e);
};
const handleMouseLeave = () => {
    tooltipData.value.visible = false;
};

const hasSegmentMoved = (k, f, t) => {
    const c = segmentCache.get(k);
    if (!c) return true;
    const tol = 1e-6;
    return (
        Math.abs(c.fromPos.lat - f.lat) > tol ||
        Math.abs(c.fromPos.lon - f.lon) > tol ||
        Math.abs(c.toPos.lat - t.lat) > tol ||
        Math.abs(c.toPos.lon - t.lon) > tol
    );
};

const partitionSegments = () => {
    const out = [];
    for (let i = 1; i < waypoints.value.length; i++) {
        const a = waypoints.value[i - 1],
            b = waypoints.value[i];
        const k = getSegmentKey(a.uid, b.uid);
        if (hasSegmentMoved(k, { lat: a.latitude, lon: a.longitude }, { lat: b.latitude, lon: b.longitude }))
            out.push({
                key: k,
                fromWp: a,
                toWp: b,
                segmentDistance: calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude),
            });
    }
    return out;
};

const genSamples = (segs) => {
    const all = [],
        ranges = [];
    for (const s of segs) {
        const st = all.length;
        const n = Math.max(
            0,
            Math.min(Math.floor(s.segmentDistance / MIN_SAMPLE_INTERVAL_METERS), MAX_SAMPLES_PER_SEGMENT),
        );
        all.push({ latitude: s.fromWp.latitude, longitude: s.fromWp.longitude, relativeDistance: 0 });
        for (let j = 1; j <= n; j++) {
            const f = j / (n + 1);
            const p = interpolatePoint(s.fromWp.latitude, s.fromWp.longitude, s.toWp.latitude, s.toWp.longitude, f);
            all.push({ ...p, relativeDistance: f * s.segmentDistance });
        }
        all.push({ latitude: s.toWp.latitude, longitude: s.toWp.longitude, relativeDistance: s.segmentDistance });
        ranges.push({ segment: s, startIdx: st, endIdx: all.length });
    }
    return { samplesToFetch: all, segmentSampleRanges: ranges };
};

const cacheMerge = (ranges, samples, elevs) =>
    ranges.forEach(({ segment, startIdx, endIdx }) =>
        segmentCache.set(segment.key, {
            samples: samples.slice(startIdx, endIdx).map((s, j) => ({ ...s, elevation: elevs[startIdx + j] ?? 0 })),
            fromPos: { lat: segment.fromWp.latitude, lon: segment.fromWp.longitude },
            toPos: { lat: segment.toWp.latitude, lon: segment.toWp.longitude },
            distance: segment.segmentDistance,
        }),
    );

const fetchBatches = async (samples) => {
    const out = [],
        B = 30;
    if (samples.length > MAX_TOTAL_SAMPLES) samples = samples.slice(0, MAX_TOTAL_SAMPLES);
    for (let i = 0; i < samples.length; i += B) {
        const b = samples.slice(i, i + B);
        const url = `${ELEVATION_API_URL}?latitude=${b.map((s) => s.latitude.toFixed(5)).join(",")}&longitude=${b.map((s) => s.longitude.toFixed(5)).join(",")}`;
        try {
            const r = await fetch(url);
            if (r.status === 429) {
                const body = await r.json().catch(() => ({}));
                const reason = body?.reason || "Rate limit exceeded";
                console.warn("[Elevation] 429:", reason);
                if (reason.includes("Daily")) {
                    elevationError.value = `고도맵표시에러 : ${reason}`;
                    out.push(...Array(b.length).fill(0));
                    break;
                }
                await new Promise((x) => setTimeout(x, 2000));
                i -= B;
                continue;
            }
            if (!r.ok) throw r.status;
            elevationError.value = null; // 성공 시 에러 메시지 초기화
            const d = await r.json();
            out.push(...(d.elevation ?? []).map((e) => Math.round((e ?? 0) * METERS_TO_FEET)));
        } catch {
            out.push(...Array(b.length).fill(0));
        }
        if (i + B < samples.length) await new Promise((x) => setTimeout(x, 180));
    }
    return out;
};

const fetchGroundElevation = async () => {
    if (!waypoints.value.length) return;
    if (isFetchingElevation.value) {
        needsFetchAgain.value = true;
        return;
    }
    isFetchingElevation.value = true;
    needsFetchAgain.value = false;
    try {
        const segs = partitionSegments();
        if (segs.length) {
            const { samplesToFetch, segmentSampleRanges } = genSamples(segs);
            const e = await fetchBatches(samplesToFetch);
            cacheMerge(segmentSampleRanges, samplesToFetch, e);
        }
    } finally {
        isFetchingElevation.value = false;
        if (needsFetchAgain.value) {
            needsFetchAgain.value = false;
            fetchGroundElevation();
        }
    }
};
const debouncedFetch = debounce(fetchGroundElevation, 400);
watch(positionSignature, debouncedFetch, { immediate: true });
</script>

<style scoped>
/* ✅ ✅ ✅ 안드로이드 터치 스크롤 원천 봉쇄 — 이 4줄이 90% 해결 */
.elevation-profile,
.profile-chart,
.waypoint-marker {
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
}

.profile-stats {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
}
.profile-stats .stat {
    color: var(--text);
    font-size: 0.75rem;
}
.profile-stats .stat strong {
    color: var(--surface-950);
}

.profile-chart-container {
    width: 100%;
    overflow-x: auto;
}
.profile-chart {
    width: 100%;
    height: auto;
    display: block;
}

.grid-line {
    stroke: var(--surface-500);
    stroke-width: 0.5;
    opacity: 0.3;
}
.grid-line-light {
    stroke: var(--surface-500);
    stroke-width: 0.5;
    opacity: 0.15;
}
.axis-label {
    fill: var(--text);
    font-size: 8px;
}
.y-axis-title {
    fill: var(--surface-700);
    font-size: 9px;
    font-weight: 700;
}
.terrain-area {
    fill: var(--surface-700);
    opacity: 0.2;
}
.terrain-line {
    fill: none;
    stroke: var(--surface-700);
    stroke-width: 1.5;
    opacity: 0.7;
}
.elevation-area {
    fill: var(--primary-500);
    opacity: 0.15;
}
.elevation-line {
    fill: none;
    stroke: var(--primary-500);
    stroke-width: 1.5;
}
.elevation-line-hitarea {
    fill: none;
    stroke: transparent;
    stroke-width: 14;
    cursor: copy;
}
.waypoint-marker {
    cursor: pointer;
    transition: opacity 0.2s;
}
.waypoint-marker:hover {
    opacity: 0.8;
}
.waypoint-marker.selected {
    stroke: var(--surface-50);
    stroke-width: 2;
}
.waypoint-label {
    fill: var(--text);
    font-size: 7px;
    font-weight: 700;
    pointer-events: none;
}
.ground-line {
    stroke: var(--surface-700);
    stroke-width: 1;
    stroke-dasharray: 4 2;
    opacity: 0.6;
}
.ground-label {
    fill: var(--surface-700);
    font-size: 7px;
    font-weight: 700;
}
.max-ground-line {
    stroke: var(--error-500);
    stroke-width: 1;
    stroke-dasharray: 2 2;
    opacity: 0.7;
}
.max-ground-label {
    fill: var(--error-500);
    font-size: 7px;
    font-weight: 700;
}
.elevation-error {
    color: var(--error-500, #ef4444);
    font-size: 0.8rem;
    padding: 0.5rem 0.75rem;
    background: color-mix(in srgb, var(--error-500, #ef4444) 10%, transparent);
    border-radius: 6px;
    margin-top: 0.5rem;
}

.no-waypoints {
    padding: 2rem;
    text-align: center;
    color: var(--surface-700);
    font-style: italic;
}

@media (max-width: 768px) {
    .profile-stats {
        flex-direction: column;
        gap: 0.5rem;
    }
}
</style>
