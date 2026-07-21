<template>
    <UiBox :title="$t('flightPlanSpeedProfile')" class="speed-profile" :class="{ inactive: !active }">
        <template v-if="waypoints.length > 0">
            <div class="profile-inner">
                <div class="profile-stats">
                    <span class="stat">
                        <strong>{{ $t("flightPlanDistance") }}:</strong> {{ formatDistance(totalDistance) }}
                    </span>
                    <span class="stat">
                        <strong>{{ $t("flightPlanFlightTime") }}:</strong> {{ totalFlightTime }}
                    </span>
                    <span class="stat">
                        <strong>{{ $t("flightPlanMinSpeed") }}:</strong> {{ formatSpeed(minSpeed) }}
                    </span>
                    <span class="stat">
                        <strong>{{ $t("flightPlanMaxSpeed") }}:</strong> {{ formatSpeed(maxSpeed) }}
                    </span>
                    <span class="stat">
                        <strong>{{ $t("flightPlanCurrentSpeed") }}:</strong>
                        {{ formatSpeed(selectedWpSpeed) }}
                        <span class="stat-note" v-if="selectedWaypointUid"
                            >(WP{{ (profilePoints.find((p) => p.uid === selectedWaypointUid)?.order ?? 0) + 1 }})</span
                        >
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
                                {{ formatSpeed(tick.value) }}
                            </text>
                        </g>

                        <!-- Y-axis title: 속도 -->
                        <text :x="padding.left - 12" :y="padding.top - 5" class="y-axis-title" text-anchor="end">
                            {{ $t("flightPlanSpeedLabel") }}
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

                        <!-- Speed area fill -->
                        <path :d="areaPath" class="speed-area" />

                        <!-- Speed line -->
                        <path :d="linePath" class="speed-line" />

                        <!-- Invisible wide hit-area for double-click-to-insert -->
                        <path :d="linePath" class="speed-line-hitarea" @dblclick="handleLineDoubleClick" />

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
            </div>

            <Teleport to="body">
                <div
                    v-if="tooltipData.visible"
                    class="global-wp-tooltip"
                    :class="{ 'is-above': tooltipData.anchorAbove, 'is-below': !tooltipData.anchorAbove }"
                    :style="{
                        left: tooltipData.x + 'px',
                        top: tooltipData.y + 'px',
                        '--tooltip-gap': TOOLTIP_GAP + 'px',
                    }"
                >
                    <div>WP{{ tooltipData.order }}</div>
                    <div>{{ $t("flightPlanSpeedLabel") }}: {{ formatSpeed(tooltipData.speed) }}</div>
                </div>
            </Teleport>
        </template>

        <div v-else class="no-waypoints">
            <p>{{ $t("flightPlanNoWaypointsForProfile") }}</p>
        </div>
    </UiBox>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import UiBox from "@/components/elements/UiBox.vue";
import { useFlightPlan } from "@/composables/useFlightPlan";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps({
    active: {
        type: Boolean,
        default: true,
    },
});

const { positionalWaypoints, selectedWaypointUid, selectWaypoint, updateWaypoint, insertWaypointAfter } =
    useFlightPlan();
const settings = useSettingsStore();
const waypoints = positionalWaypoints;

const chartSvg = ref(null);

const chartWidth = 800;
const chartHeight = 150;
const padding = { top: 20, right: 20, bottom: 35, left: 45 };
const DRAG_DIRECTION_THRESHOLD = 10;

const METERS_TO_FEET = 3.28084;
const METERS_TO_NAUTICAL_MILES = 1 / 1852;

// Speed constants for Y-axis
const SPEED_Y_MIN = 0; // m/s
const SPEED_Y_MAX = 40; // m/s (max 40 m/s)
const KNOTS_TO_MPS = 0.514444;
const MPS_TO_KNOTS = 1 / KNOTS_TO_MPS;

/* ──────────────────────────────────────────────────
   안드로이드 터치 스크롤 방지
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

    window.addEventListener("scroll", repositionActiveTooltip, { passive: true, capture: true });
    window.addEventListener("resize", repositionActiveTooltip, { passive: true });
});

onUnmounted(() => {
    window.removeEventListener("touchmove", preventTouchScroll, true);
    window.removeEventListener("scroll", repositionActiveTooltip, true);
    window.removeEventListener("resize", repositionActiveTooltip);
});

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

const formatSpeed = (kt) => settings.formatSpeed(kt);
const formatDistance = (meters) => settings.formatDistance(meters);

const maxAllowedSpeedMps = 40;

const dragState = ref({
    active: false,
    type: null,
    wpUid: null,
    startX: 0,
    startY: 0,
    lastValue: 0,
    speedDirection: 0,
    speedInterval: null,
});

const tooltipData = ref({
    visible: false,
    x: 0,
    y: 0,
    order: 0,
    altitude: 0,
    speed: 0,
    groundElev: 0,
    anchorAbove: true,
});
const activeTooltipWpUid = ref(null);

const profilePoints = computed(() => {
    if (!waypoints.value.length) return [];
    let cum = 0;
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
            speed: wp.speed || 0,
            distance: cum,
            latitude: wp.latitude,
            longitude: wp.longitude,
        };
    });
});

const totalDistance = computed(() => profilePoints.value.at(-1)?.distance ?? 0);
const minSpeed = computed(() => (waypoints.value.length ? Math.min(...waypoints.value.map((w) => w.speed || 0)) : 0));
const maxSpeed = computed(() => (waypoints.value.length ? Math.max(...waypoints.value.map((w) => w.speed || 0)) : 0));

const selectedWpSpeed = computed(() => {
    if (!selectedWaypointUid.value) return 0;
    const p = profilePoints.value.find((x) => x.uid === selectedWaypointUid.value);
    return p ? p.speed : 0;
});

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

// Y-axis: 0 to maxSpeedMps (40 m/s), 5 ticks
const yAxisTicks = computed(() => {
    // Determine max speed in knots for the current unit
    const isMetric = settings.speedUnit === "mps" || settings.speedUnit === "kmh";
    let maxVal = SPEED_Y_MAX; // base in m/s
    let stepVal = 10; // base step in m/s

    if (settings.speedUnit === "kt") {
        maxVal = Math.round(SPEED_Y_MAX * MPS_TO_KNOTS);
        stepVal = Math.round(10 * MPS_TO_KNOTS);
    } else {
        // m/s: 0, 10, 20, 30, 40
        maxVal = SPEED_Y_MAX;
        stepVal = 10;
    }

    // Convert to storage (knots) for formatSpeed
    return Array.from({ length: 5 }, (_, i) => ({
        value: i * stepVal,
        // Store in knots for formatSpeed
        ktValue: isMetric ? i * stepVal * MPS_TO_KNOTS : i * stepVal,
        y: scaleY(i * stepVal, maxVal),
    }));
});

// Override formatSpeed for y-axis labels to show values in correct unit
const formatSpeedValue = (value) => {
    // value is in m/s
    if (settings.speedUnit === "kt") {
        const kt = Math.round(value * MPS_TO_KNOTS);
        return `${kt}kt`;
    }
    return `${value}m/s`;
};

const scaleX = (d) => padding.left + (d / (totalDistance.value || 1)) * (chartWidth - padding.left - padding.right);
const unscaleX = (x) => ((x - padding.left) / (chartWidth - padding.left - padding.right)) * (totalDistance.value || 1);
const scaleY = (speedVal, maxVal = SPEED_Y_MAX) => {
    const range = maxVal || SPEED_Y_MAX;
    const pMax = range * 1.1;
    return chartHeight - padding.bottom - (speedVal / pMax) * (chartHeight - padding.top - padding.bottom);
};

// Get max speed for Y-axis scaling
const combinedMaxSpeed = computed(() => {
    const max = maxSpeed.value;
    // Convert maxSpeed (knots storage) to m/s for Y-axis comparison
    const maxMs = max * KNOTS_TO_MPS;
    return Math.max(maxMs, SPEED_Y_MAX);
});

const scaledProfilePoints = computed(() => {
    const maxVal = combinedMaxSpeed.value;
    return profilePoints.value.map((p) => ({
        ...p,
        x: scaleX(p.distance),
        // Convert speed from knots (storage) to m/s for Y positioning
        y: scaleY(p.speed * KNOTS_TO_MPS, maxVal),
        // Store speed as m/s for tooltip display calculation
        speedMs: p.speed * KNOTS_TO_MPS,
    }));
});

const linePath = computed(() => scaledProfilePoints.value.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "));
const areaPath = computed(() => {
    if (!scaledProfilePoints.value.length) return "";
    const by = chartHeight - padding.bottom;
    const pts = scaledProfilePoints.value;
    return `${pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ")} L ${pts.at(-1).x} ${by} L ${pts[0].x} ${by} Z`;
});

const TOOLTIP_GAP = 60;
const TOOLTIP_WIDTH_ESTIMATE = 150;
const MARKER_RADIUS = 10;

const computeMarkerScreenAnchor = (point) => {
    const svg = chartSvg.value;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const svgPt = svg.createSVGPoint();
    svgPt.x = point.x;
    svgPt.y = point.y;
    const center = svgPt.matrixTransform(ctm);
    const scale = Math.hypot(ctm.a, ctm.b) || 1;
    const radiusPx = MARKER_RADIUS * scale;
    return { cx: center.x, topY: center.y - radiusPx, bottomY: center.y + radiusPx };
};

const positionTooltipAtAnchor = (anchor) => {
    let x = anchor.cx - TOOLTIP_WIDTH_ESTIMATE / 2;
    if (x < 4) x = 4;
    if (x + TOOLTIP_WIDTH_ESTIMATE > innerWidth - 4) x = innerWidth - TOOLTIP_WIDTH_ESTIMATE - 4;

    const showAbove = anchor.topY - TOOLTIP_GAP > 90;
    tooltipData.value.x = x;
    tooltipData.value.y = showAbove ? anchor.topY : anchor.bottomY;
    tooltipData.value.anchorAbove = showAbove;
};

const showTooltipForPoint = (point) => {
    activeTooltipWpUid.value = point.uid;
    const anchor = computeMarkerScreenAnchor(point);
    if (!anchor) return;
    positionTooltipAtAnchor(anchor);
    tooltipData.value.visible = true;
    tooltipData.value.order = (point.order ?? 0) + 1;
    tooltipData.value.speed = point.speed ?? 0;
};

const repositionActiveTooltip = () => {
    if (!tooltipData.value.visible || !activeTooltipWpUid.value) return;
    const point = scaledProfilePoints.value.find((p) => p.uid === activeTooltipWpUid.value);
    if (!point) return;
    const anchor = computeMarkerScreenAnchor(point);
    if (!anchor) return;
    positionTooltipAtAnchor(anchor);
};

const getMarkerColor = (p) => {
    if (dragState.value.active && dragState.value.wpUid === p.uid) {
        return "#FF69B4"; // 분홍 (속도 변경)
    }
    if (p.uid === selectedWaypointUid.value) return "var(--success-500)";
    return "var(--primary-500)";
};
const getMarkerStroke = () => "var(--surface-50)";
const getMarkerStrokeWidth = (p) => (p.uid === selectedWaypointUid.value ? 2 : 1.5);

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
            // Inherit speed from the start waypoint of the segment
            const newSpeed = a.speed;
            insertWaypointAfter(a.uid, {
                latitude: ll.latitude,
                longitude: ll.longitude,
                altitude: Math.round(a.altitude + f * (b.altitude - a.altitude)),
                speed: newSpeed,
            });
            return;
        }
    }
};

const handlePointerDown = (e, point) => {
    if (e.cancelable)
        try {
            e.preventDefault();
        } catch {}
    e.stopPropagation();

    selectWaypoint(point.uid);
    showTooltipForPoint(point);
    try {
        e.target.setPointerCapture(e.pointerId);
    } catch {}

    dragState.value = {
        active: true,
        type: null,
        wpUid: point.uid,
        startX: e.clientX,
        startY: e.clientY,
        lastValue: point.speed,
        speedDirection: 0,
        speedInterval: null,
    };
};

const handlePointerMove = (e) => {
    if (!dragState.value.active) return;

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
        if (ay > DRAG_DIRECTION_THRESHOLD) {
            dragState.value.type = "speed";
            dragState.value.startY = e.clientY;
        }
        return;
    }

    if (dragState.value.type === "speed") {
        const d = dragState.value.startY - e.clientY;
        dragState.value.speedDirection = Math.abs(d) > 8 ? Math.sign(d) : 0;
        if (!dragState.value.speedInterval) startSpeedChangeInterval();
    }

    const dp = scaledProfilePoints.value.find((p) => p.uid === dragState.value.wpUid);
    if (dp) showTooltipForPoint(dp);
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
        speedDirection: 0,
        speedInterval: null,
    };
};

const startSpeedChangeInterval = () => {
    if (dragState.value.speedInterval) return;
    dragState.value.speedInterval = setInterval(() => {
        if (!dragState.value.active || dragState.value.type !== "speed" || !dragState.value.speedDirection)
            return stopSpeedChangeInterval();
        const wp = waypoints.value.find((w) => w.uid === dragState.value.wpUid);
        if (!wp) return;

        // Convert current speed from knots (storage) to m/s
        const currentMs = wp.speed * KNOTS_TO_MPS;
        // Change by 1 m/s or 1 knot depending on unit
        const step = settings.speedUnit === "kt" ? 1 * MPS_TO_KNOTS : 1; // 1 knot or 1 m/s in m/s
        let newMs = Math.max(0, Math.min(maxAllowedSpeedMps, currentMs + dragState.value.speedDirection * 1));

        // Convert back to knots (storage)
        const newKt = parseFloat((newMs * MPS_TO_KNOTS).toFixed(2));

        if (Math.abs(newKt - wp.speed) > 0.01) {
            updateWaypoint(wp.uid, { speed: newKt });
            tooltipData.value.speed = newKt;
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
    activeTooltipWpUid.value = null;
};
</script>

<style scoped>
.speed-profile.inactive {
    opacity: 0.5;
}

.speed-profile,
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

.profile-inner {
    position: relative;
    display: flex;
    flex-direction: column;
}

.profile-chart-container {
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
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
.speed-area {
    fill: var(--primary-500);
    opacity: 0.15;
}
.speed-line {
    fill: none;
    stroke: var(--primary-500);
    stroke-width: 1.5;
}
.speed-line-hitarea {
    fill: none;
    stroke: transparent;
    stroke-width: 14;
    cursor: copy;
}
.waypoint-marker {
    cursor: ns-resize;
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
