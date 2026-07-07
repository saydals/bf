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
                            <tspan v-if="tick === yAxisTicks[yAxisTicks.length - 1]" class="amsl-label">(AMSL)</tspan>
                        </text>
                    </g>

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

            <!-- Tooltip teleported to body to avoid overflow clipping -->
            <Teleport to="body">
                <div
                    v-if="tooltipData.visible"
                    class="global-wp-tooltip"
                    :style="{ left: tooltipData.x + 'px', top: tooltipData.y + 'px' }"
                >
                    <div>WP{{ tooltipData.order }}</div>
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
import { ref, computed, watch } from "vue";
import UiBox from "@/components/elements/UiBox.vue";
import { useFlightPlan } from "@/composables/useFlightPlan";
import { useSettingsStore } from "@/stores/settings";

const { positionalWaypoints, selectedWaypointUid, selectWaypoint, updateWaypoint } = useFlightPlan();
const settings = useSettingsStore();
// Modifier waypoints (lat/lon = 0) would otherwise skew distance and altitude.
const waypoints = positionalWaypoints;

const chartSvg = ref(null);

// Chart dimensions (50% smaller)
const chartWidth = 800;
const chartHeight = 150;
const padding = {
    top: 20,
    right: 20,
    bottom: 35,
    left: 45,
};

// Drag direction threshold (px) for distinguishing horizontal vs vertical drag
const DRAG_DIRECTION_THRESHOLD = 10;

// Ground elevation in feet AMSL (fetched from API)
const groundElevation = ref(0); // Average ground elevation for display
const terrainSamples = ref([]); // Terrain samples with {distance, elevation, lat, lon}
const isFetchingElevation = ref(false);
const elevationFetchSeq = ref(0); // Monotonic sequence to prevent race conditions

// Segment-level caching for terrain data
// Key: "uid1-uid2", Value: { samples: [...], fromPos: {lat, lon}, toPos: {lat, lon} }
const segmentCache = ref(new Map());

// Terrain sampling configuration
const MIN_SAMPLE_INTERVAL_METERS = 50; // Minimum distance between samples (50m resolution)
const MAX_SAMPLES_PER_SEGMENT = 50; // Maximum samples between waypoints

// Generate cache key for a segment between two waypoints
const getSegmentKey = (fromUid, toUid) => `${fromUid}-${toUid}`;

// Conversion constants
const METERS_TO_FEET = 3.28084;
const METERS_TO_NAUTICAL_MILES = 1 / 1852;

// Calculate distance between two points using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
};

// Interpolate a point along a great circle path
// fraction is between 0 (start) and 1 (end)
const interpolatePoint = (lat1, lon1, lat2, lon2, fraction) => {
    // Calculate distance first to check for zero/near-zero case
    const distance = calculateDistance(lat1, lon1, lat2, lon2);

    // Guard against division by zero for identical or very close waypoints
    if (distance < 0.001) {
        // Less than 1mm - return start coordinates
        return {
            latitude: lat1,
            longitude: lon1,
        };
    }

    const φ1 = (lat1 * Math.PI) / 180;
    const λ1 = (lon1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const λ2 = (lon2 * Math.PI) / 180;

    const d = distance / 6371000; // Angular distance in radians

    const a = Math.sin((1 - fraction) * d) / Math.sin(d);
    const b = Math.sin(fraction * d) / Math.sin(d);

    const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
    const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
    const z = a * Math.sin(φ1) + b * Math.sin(φ2);

    const φ = Math.atan2(z, Math.hypot(x, y));
    const λ = Math.atan2(y, x);

    return {
        latitude: (φ * 180) / Math.PI,
        longitude: (λ * 180) / Math.PI,
    };
};

// Unit format helpers — delegation to settings store
// NOTE: storage units are altitude=feet, speed=knots, distance=meters

const formatAltitude = (ft) => settings.formatAltitude(ft);
const formatSpeed = (kt) => settings.formatSpeed(kt);
const formatSpeedMps = (kt) => settings.formatSpeedMps(kt);
const formatDistance = (meters) => settings.formatDistance(meters);

// Ground elevation at WP1 (feet AMSL) — the reference for AGL system
const wp1GroundElevation = computed(() => {
    if (terrainSamples.value.length === 0 || profilePoints.value.length === 0) {
        return 0;
    }
    // Find the terrain sample closest to WP1
    const wp1 = profilePoints.value[0];
    const closest = terrainSamples.value.reduce((prev, curr) => {
        return Math.abs(curr.distance - wp1.distance) < Math.abs(prev.distance - wp1.distance) ? curr : prev;
    });
    return closest ? closest.elevation : 0;
});

// Get ground elevation (feet AMSL) at a given distance along the profile
const getGroundElevAtPoint = (distance) => {
    if (terrainSamples.value.length === 0) {
        return 0;
    }
    // Find the two terrain samples that bracket the given distance
    const samples = terrainSamples.value;
    if (distance <= samples[0].distance) return samples[0].elevation;
    if (distance >= samples[samples.length - 1].distance) return samples[samples.length - 1].elevation;

    for (let i = 0; i < samples.length - 1; i++) {
        if (distance >= samples[i].distance && distance <= samples[i + 1].distance) {
            const t = (distance - samples[i].distance) / (samples[i + 1].distance - samples[i].distance);
            return samples[i].elevation + t * (samples[i + 1].elevation - samples[i].elevation);
        }
    }
    return 0;
};

// Minimum allowed AGL for each waypoint (ground elevation at that WP - WP1 ground elevation)
const minAllowedAGL = computed(() => {
    if (profilePoints.value.length === 0) return {};
    const result = {};
    for (const point of profilePoints.value) {
        const groundAtPoint = getGroundElevAtPoint(point.distance);
        result[point.uid] = groundAtPoint - wp1GroundElevation.value; // 음수 허용 (0 clamp 제거)
    }
    return result;
});

// Maximum allowed AGL (10,000 feet system limit, configurable in future)
const maxAllowedAGL = 10000; // feet

// Drag state
const dragState = ref({
    active: false,
    type: null, // 'altitude' or 'speed'
    wpUid: null,
    startX: 0,
    startY: 0,
    lastValue: 0,
    lastMoveTime: 0,
    speedVisualOffsetX: 0, // 시각적 X 오프셋 (속도 드래그 피드백)
    speedDirection: 0, // 시간 기반 속도 방향 (-1:감속, 0:중립, +1:가속)
});

// Tooltip state (teleported to body, positioned with clientX/clientY)
const tooltipData = ref({
    visible: false,
    x: 0,
    y: 0,
    order: 0,
    altitude: 0,
    speed: 0,
});

// Calculate profile points with cumulative distance
const profilePoints = computed(() => {
    if (waypoints.value.length === 0) {
        return [];
    }

    let cumulativeDistance = 0;
    const wpg = wp1GroundElevation.value; // WP1 ground elevation in feet AMSL
    const points = waypoints.value.map((wp, index) => {
        if (index > 0) {
            const prevWp = waypoints.value[index - 1];
            cumulativeDistance += calculateDistance(prevWp.latitude, prevWp.longitude, wp.latitude, wp.longitude);
        }

        return {
            uid: wp.uid,
            order: wp.order,
            altitude: wp.altitude, // AGL (relative to WP1 ground)
            altitudeAMSL: wp.altitude + wpg, // AMSL for Y-axis scaling
            speed: wp.speed || 0,
            distance: cumulativeDistance,
            latitude: wp.latitude,
            longitude: wp.longitude,
        };
    });

    return points;
});

// Total distance
const totalDistance = computed(() => {
    if (profilePoints.value.length === 0) {
        return 0;
    }
    return profilePoints.value[profilePoints.value.length - 1].distance;
});

// Min and max altitude (already in feet from waypoint data)
const minAltitude = computed(() => {
    if (waypoints.value.length === 0) {
        return 0;
    }
    return Math.round(Math.min(...waypoints.value.map((wp) => wp.altitude)));
});

const maxAltitude = computed(() => {
    if (waypoints.value.length === 0) {
        return 0;
    }
    return Math.round(Math.max(...waypoints.value.map((wp) => wp.altitude)));
});

// Max ground elevation from terrain samples
const maxGroundElevation = computed(() => {
    if (terrainSamples.value.length === 0) {
        return 0;
    }
    return Math.round(Math.max(...terrainSamples.value.map((sample) => sample.elevation)));
});

// ★ 선택된 WP의 상대지면표고 (WP1 지표고도 기준)
const selectedWpRelativeGroundElev = computed(() => {
    if (!selectedWaypointUid.value) return 0;
    const point = profilePoints.value.find((p) => p.uid === selectedWaypointUid.value);
    if (!point) return 0;
    return getGroundElevAtPoint(point.distance) - wp1GroundElevation.value;
});

// ★ 전체 최대 상대지면표고
const relativeMaxGroundElevation = computed(() => {
    if (terrainSamples.value.length === 0) return 0;
    const maxAmbl = Math.max(...terrainSamples.value.map((s) => s.elevation));
    return maxAmbl - wp1GroundElevation.value;
});

// Total flight time (based on speed at each waypoint for the next segment)
const totalFlightTime = computed(() => {
    if (waypoints.value.length < 2) {
        return "0:00";
    }

    let totalHours = 0;

    // For each segment from waypoint i to waypoint i+1
    for (let i = 0; i < waypoints.value.length - 1; i++) {
        const wp = waypoints.value[i];
        const nextWp = waypoints.value[i + 1];

        // Calculate segment distance in nautical miles
        const distanceMeters = calculateDistance(wp.latitude, wp.longitude, nextWp.latitude, nextWp.longitude);
        const distanceNM = distanceMeters * METERS_TO_NAUTICAL_MILES;

        // Use current waypoint's speed for this segment (speed in knots)
        // Guard against zero or negative speed by using a minimum of 1 knot
        const speed = (wp.speed ?? 10) <= 0 ? 1 : (wp.speed ?? 10);

        // Calculate time in hours (distance in NM / speed in knots = hours)
        const segmentTime = distanceNM / speed;
        totalHours += segmentTime;
    }

    // Format as h:mm
    let hours = Math.floor(totalHours);
    let minutes = Math.round((totalHours - hours) * 60);

    // Handle rollover when minutes === 60
    if (minutes === 60) {
        hours += 1;
        minutes = 0;
    }

    return `${hours}:${minutes.toString().padStart(2, "0")}`;
});

// Combined maximum for y-axis scaling (considers both flight path AMSL and terrain)
const combinedMax = computed(() => {
    const maxAmsl = profilePoints.value.length > 0 ? Math.max(...profilePoints.value.map((p) => p.altitudeAMSL)) : 0;
    return Math.max(maxAmsl, maxGroundElevation.value, 100); // 최소 100ft 보장
});

// Y-axis ticks
const yAxisTicks = computed(() => {
    const min = 0; // Always start at sea level (0 ft AMSL)
    const max = combinedMax.value;
    const range = max - min;
    const tickCount = 5;
    const step = Math.ceil(range / (tickCount - 1) / 10) * 10 || 50; // Round to nearest 10

    const ticks = [];
    const startValue = Math.floor(min / step) * step;

    for (let i = 0; i < tickCount; i++) {
        const value = startValue + i * step;
        const y = scaleY(value);
        ticks.push({ value, y });
    }

    return ticks;
});

// Scale functions
const scaleX = (distance) => {
    const total = totalDistance.value || 1;
    const plotWidth = chartWidth - padding.left - padding.right;
    return padding.left + (distance / total) * plotWidth;
};

const scaleY = (altitude) => {
    const min = 0; // Always start at sea level (0 ft AMSL)
    const max = combinedMax.value; // Use combined max to include terrain heights
    const range = max - min || 100; // Default range if all altitudes are the same
    const plotHeight = chartHeight - padding.top - padding.bottom;

    // Add 10% padding to top only (keep bottom at 0)
    const paddedMin = min;
    const paddedMax = max + range * 0.1;
    const paddedRange = paddedMax - paddedMin;

    return chartHeight - padding.bottom - ((altitude - paddedMin) / paddedRange) * plotHeight;
};

// Profile points with scaled x/y coordinates for rendering
const scaledProfilePoints = computed(() => {
    return profilePoints.value.map((point) => {
        const baseX = scaleX(point.distance);
        // ★ 속도 드래그 중인 WP에만 시각적 X 오프셋 적용
        const offsetX =
            dragState.value.active && dragState.value.type === "speed" && dragState.value.wpUid === point.uid
                ? dragState.value.speedVisualOffsetX
                : 0;
        return {
            ...point,
            x: baseX + offsetX,
            y: scaleY(point.altitudeAMSL),
        };
    });
});

// Calculate SVG path for elevation line
const linePath = computed(() => {
    if (scaledProfilePoints.value.length === 0) {
        return "";
    }

    const pathParts = scaledProfilePoints.value.map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command} ${point.x} ${point.y}`;
    });

    return pathParts.join(" ");
});

// Calculate SVG path for area fill
const areaPath = computed(() => {
    if (scaledProfilePoints.value.length === 0) {
        return "";
    }

    const baseY = chartHeight - padding.bottom;
    const points = scaledProfilePoints.value;

    const topPath = points
        .map((point, index) => {
            const command = index === 0 ? "M" : "L";
            return `${command} ${point.x} ${point.y}`;
        })
        .join(" ");

    const bottomPath = [`L ${points[points.length - 1].x} ${baseY}`, `L ${points[0].x} ${baseY}`, "Z"].join(" ");

    return `${topPath} ${bottomPath}`;
});

// Calculate SVG path for terrain line using sampled elevations
const terrainLinePath = computed(() => {
    if (terrainSamples.value.length === 0) {
        return "";
    }

    const points = terrainSamples.value.map((sample) => {
        return {
            x: scaleX(sample.distance),
            y: scaleY(sample.elevation),
        };
    });

    const pathParts = points.map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command} ${point.x} ${point.y}`;
    });

    return pathParts.join(" ");
});

// Calculate SVG path for terrain area fill using sampled elevations
const terrainAreaPath = computed(() => {
    if (terrainSamples.value.length === 0) {
        return "";
    }

    const baseY = chartHeight - padding.bottom;
    const points = terrainSamples.value.map((sample) => {
        return {
            x: scaleX(sample.distance),
            y: scaleY(sample.elevation),
        };
    });

    const topPath = points
        .map((point, index) => {
            const command = index === 0 ? "M" : "L";
            return `${command} ${point.x} ${point.y}`;
        })
        .join(" ");

    const bottomPath = [`L ${points[points.length - 1].x} ${baseY}`, `L ${points[0].x} ${baseY}`, "Z"].join(" ");

    return `${topPath} ${bottomPath}`;
});

// Tooltip position update (clientX/Y based, with screen edge correction)
const updateTooltipPosition = (event, wpData) => {
    const tooltipWidth = 150;
    const tooltipHeight = 60;
    const gap = 30; // gap from marker/label to tooltip

    // Get marker screen position
    const rect = event.target.getBoundingClientRect();
    const markerCenterX = rect.left + rect.width / 2;
    const markerTop = rect.top;

    // Tooltip Y: above the marker (with gap)
    let posY = markerTop - tooltipHeight - gap;

    // Determine horizontal zone based on marker X ratio within chart
    const xRatio = (wpData.x ?? 0) / chartWidth;
    let posX;

    if (xRatio < 0.33) {
        // Left zone: tooltip right-aligned to marker (up-right)
        posX = markerCenterX;
    } else if (xRatio < 0.66) {
        // Center zone: tooltip centered on marker (up)
        posX = markerCenterX - tooltipWidth / 2;
    } else {
        // Right zone: tooltip left-aligned to marker (up-left)
        posX = markerCenterX - tooltipWidth;
    }

    // Screen edge guards
    if (posX < 4) {
        posX = 4;
    }
    if (posX + tooltipWidth > window.innerWidth - 4) {
        posX = window.innerWidth - tooltipWidth - 4;
    }
    if (posY < 4) {
        // If tooltip would go off top, place below marker instead
        posY = rect.bottom + gap;
    }

    tooltipData.value = {
        visible: true,
        x: posX,
        y: posY,
        order: (wpData.order ?? 0) + 1,
        altitude: wpData.altitude ?? 0,
        speed: wpData.speed ?? 0,
    };
};

// Marker style helpers
const getMarkerColor = (point) => {
    if (point.uid === selectedWaypointUid.value) return "var(--success-500)";
    return "var(--primary-500)";
};

const getMarkerStroke = (point) => {
    if (point.uid === selectedWaypointUid.value) return "var(--surface-50)";
    return "var(--surface-50)";
};

const getMarkerStrokeWidth = (point) => {
    if (point.uid === selectedWaypointUid.value) return 2;
    return 1.5;
};

// Update tooltip with AGL altitude and m/s speed
const updateTooltipData = (point) => {
    tooltipData.value.altitude = point.altitude; // AGL
    tooltipData.value.speed = point.speed; // knots (formatSpeedMps converts)
};

// Pointer handlers for drag functionality
const handlePointerDown = (event, point) => {
    selectWaypoint(point.uid);
    updateTooltipPosition(event, point);
    updateTooltipData(point);
    tooltipData.value.visible = true;

    // Capture pointer to receive events even outside the element
    event.target.setPointerCapture(event.pointerId);

    dragState.value = {
        active: true,
        type: null, // Will be determined on first move
        wpUid: point.uid,
        startX: event.clientX,
        startY: event.clientY,
        lastValue: point.altitude,
        lastMoveTime: 0,
        speedVisualOffsetX: 0,
        speedDirection: 0,
    };
};

const handlePointerMove = (event) => {
    if (!dragState.value.active) return;

    const dx = event.clientX - dragState.value.startX;
    const dy = event.clientY - dragState.value.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Determine drag direction if not yet determined
    if (!dragState.value.type) {
        if (absDx > DRAG_DIRECTION_THRESHOLD || absDy > DRAG_DIRECTION_THRESHOLD) {
            dragState.value.type = absDy > absDx ? "altitude" : "speed";
            // Reset start position for clean delta calculation
            dragState.value.startX = event.clientX;
            dragState.value.startY = event.clientY;
        }
        return;
    }

    // ★ 속도 드래그: 방향 감지 + 시각적 오프셋 (쓰로틀과 무관하게 즉시)
    if (dragState.value.type === "speed") {
        const speedDeltaX = event.clientX - dragState.value.startX;
        // 시각적 오프셋: 실제 드래그량의 50%, 최대 15px
        dragState.value.speedVisualOffsetX = Math.sign(speedDeltaX) * Math.min(Math.abs(speedDeltaX) * 0.5, 15);
        // 방향 결정 (±5px 히스테리시스)
        if (Math.abs(speedDeltaX) > 5) {
            dragState.value.speedDirection = speedDeltaX > 0 ? 1 : -1;
        } else {
            dragState.value.speedDirection = 0;
        }
    }

    if (dragState.value.type === "altitude") {
        handleAltDragMove(event);
    } else {
        handleSpeedDragMove(event);
    }

    // ★ 드래그 중 항상 툴팁 위치 갱신
    const draggedPoint = scaledProfilePoints.value.find((p) => p.uid === dragState.value.wpUid);
    if (draggedPoint) {
        updateTooltipPosition(event, draggedPoint);
    }
};

const handlePointerUp = (event) => {
    if (!dragState.value.active) return;

    // Release pointer capture
    if (event.target) {
        try {
            event.target.releasePointerCapture(event.pointerId);
        } catch {}
    }

    dragState.value.active = false;
    dragState.value.type = null;
    dragState.value.wpUid = null;
};

// Altitude drag (vertical): SVG scale synchronized — marker follows mouse exactly
const handleAltDragMove = (event) => {
    const currentWp = waypoints.value.find((wp) => wp.uid === dragState.value.wpUid);
    if (!currentWp) return;

    // SVG 스케일을 통해 화면픽셀 → 고도 변화량 변환
    const svgEl = chartSvg.value;
    if (!svgEl) return;
    const svgRect = svgEl.getBoundingClientRect();
    const plotHeight = chartHeight - padding.top - padding.bottom;
    const svgScale = plotHeight / svgRect.height; // SVG단위 / 화면픽셀

    const deltaScreenY = dragState.value.startY - event.clientY;
    const deltaSvgY = deltaScreenY * svgScale;

    // scaleY의 역변환: SVG Y 변화 → 고도 변화 (feet)
    const min = 0;
    const max = combinedMax.value;
    const range = max - min || 100;
    const paddedMax = max + range * 0.1;
    const paddedRange = paddedMax - min;
    const feetPerSvgUnit = paddedRange / plotHeight;

    const altitudeDelta = Math.round(deltaSvgY * feetPerSvgUnit);

    const minAlt = selectedWpRelativeGroundElev.value;
    const newAlt = Math.max(minAlt, Math.min(maxAllowedAGL, currentWp.altitude + altitudeDelta));

    if (newAlt !== currentWp.altitude) {
        updateWaypoint(dragState.value.wpUid, { altitude: newAlt });
        dragState.value.startY = event.clientY;
        // ★ 툴팁 실시간 갱신
        tooltipData.value.altitude = newAlt;
    }
};

// Speed drag (horizontal): time-based — direction held determines ±1 m/s per 500ms
const handleSpeedDragMove = (event) => {
    const currentWp = waypoints.value.find((wp) => wp.uid === dragState.value.wpUid);
    if (!currentWp) return;

    // ★ 방향이 중립이면 변화 없음 (마우스가 중심 근처)
    if (dragState.value.speedDirection === 0) return;

    // ★ 시간 쓰로틀: 500ms 간격으로만 값 변경
    const now = Date.now();
    if (now - dragState.value.lastMoveTime < 500) return;
    dragState.value.lastMoveTime = now;

    // ★ 시간 기반: 방향에 따라 ±1 m/s
    const currentMps = Math.round(settings.storageToMps(currentWp.speed || 10));
    const newMps = Math.max(5, Math.min(25, currentMps + dragState.value.speedDirection));
    const newKnots = settings.mpsToStorage(newMps);

    if (Math.abs(newKnots - currentWp.speed) > 0.01) {
        updateWaypoint(dragState.value.wpUid, { speed: newKnots });
        // ★ 툴팁 실시간 갱신
        tooltipData.value.speed = newKnots;
    }
};

const handleMouseMove = (event) => {
    // Handle drag if active (dragging can happen via mouse too)
    if (dragState.value.active && event.pointerType === "mouse") {
        handlePointerMove(event);
    }
};

const handleMouseLeave = () => {
    tooltipData.value.visible = false;
};

// Check if a segment's waypoints have moved (positions changed)
const hasSegmentMoved = (segmentKey, fromPos, toPos) => {
    const cached = segmentCache.value.get(segmentKey);
    if (!cached) {
        return true; // Not cached, needs fetching
    }

    // Check if positions match (with small tolerance for floating point comparison)
    const tolerance = 0.000001; // ~0.1m tolerance
    const fromMoved =
        Math.abs(cached.fromPos.lat - fromPos.lat) > tolerance ||
        Math.abs(cached.fromPos.lon - fromPos.lon) > tolerance;
    const toMoved =
        Math.abs(cached.toPos.lat - toPos.lat) > tolerance || Math.abs(cached.toPos.lon - toPos.lon) > tolerance;

    return fromMoved || toMoved;
};

// Partition waypoint segments into cached and uncached
const partitionSegments = () => {
    const segmentsToFetch = [];
    const cachedSamples = [];
    let cumulativeDistance = 0;

    for (let i = 1; i < waypoints.value.length; i++) {
        const prevWp = waypoints.value[i - 1];
        const wp = waypoints.value[i];
        const segmentKey = getSegmentKey(prevWp.uid, wp.uid);
        const segmentDistance = calculateDistance(prevWp.latitude, prevWp.longitude, wp.latitude, wp.longitude);
        const fromPos = { lat: prevWp.latitude, lon: prevWp.longitude };
        const toPos = { lat: wp.latitude, lon: wp.longitude };

        if (hasSegmentMoved(segmentKey, fromPos, toPos)) {
            segmentsToFetch.push({
                key: segmentKey,
                fromWp: prevWp,
                toWp: wp,
                segmentDistance,
                startDistance: cumulativeDistance,
            });
        } else {
            const cached = segmentCache.value.get(segmentKey);
            cachedSamples.push(
                ...cached.samples.map((s) => ({ ...s, distance: cumulativeDistance + s.relativeDistance })),
            );
        }

        cumulativeDistance += segmentDistance;
    }

    return { segmentsToFetch, cachedSamples };
};

// Generate sample points along segments that need elevation data
const generateSegmentSamples = (segmentsToFetch) => {
    const samplesToFetch = [];
    const segmentSampleRanges = [];

    for (const segment of segmentsToFetch) {
        const startIdx = samplesToFetch.length;
        const numSamples = Math.max(
            0,
            Math.min(Math.floor(segment.segmentDistance / MIN_SAMPLE_INTERVAL_METERS), MAX_SAMPLES_PER_SEGMENT),
        );

        samplesToFetch.push({
            latitude: segment.fromWp.latitude,
            longitude: segment.fromWp.longitude,
            relativeDistance: 0,
        });

        for (let j = 1; j <= numSamples; j++) {
            const fraction = j / (numSamples + 1);
            const point = interpolatePoint(
                segment.fromWp.latitude,
                segment.fromWp.longitude,
                segment.toWp.latitude,
                segment.toWp.longitude,
                fraction,
            );
            samplesToFetch.push({
                latitude: point.latitude,
                longitude: point.longitude,
                relativeDistance: fraction * segment.segmentDistance,
            });
        }

        samplesToFetch.push({
            latitude: segment.toWp.latitude,
            longitude: segment.toWp.longitude,
            relativeDistance: segment.segmentDistance,
        });
        segmentSampleRanges.push({ segment, startIdx, endIdx: samplesToFetch.length });
    }

    return { samplesToFetch, segmentSampleRanges };
};

// Fetch elevations from API in batches
const fetchElevationBatches = async (samplesToFetch) => {
    const allElevations = [];
    const batchSize = 100;

    for (let i = 0; i < samplesToFetch.length; i += batchSize) {
        const batch = samplesToFetch.slice(i, i + batchSize);
        const locations = batch.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));

        const response = await fetch("https://api.open-elevation.com/api/v1/lookup", {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ locations }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.results?.length > 0) {
            allElevations.push(...data.results.map((result) => Math.round(result.elevation * METERS_TO_FEET)));
        }

        if (i + batchSize < samplesToFetch.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    return allElevations;
};

// Cache fetched segments and produce absolute-distance samples
const cacheAndMergeSamples = (segmentSampleRanges, samplesToFetch, allElevations) => {
    const samples = [];

    for (const { segment, startIdx, endIdx } of segmentSampleRanges) {
        const segmentSamples = [];

        for (let i = startIdx; i < endIdx; i++) {
            const sample = samplesToFetch[i];
            const elevation = allElevations[i] || 0;

            segmentSamples.push({
                latitude: sample.latitude,
                longitude: sample.longitude,
                relativeDistance: sample.relativeDistance,
                elevation,
            });
            samples.push({
                latitude: sample.latitude,
                longitude: sample.longitude,
                distance: segment.startDistance + sample.relativeDistance,
                elevation,
            });
        }

        segmentCache.value.set(segment.key, {
            samples: segmentSamples,
            fromPos: { lat: segment.fromWp.latitude, lon: segment.fromWp.longitude },
            toPos: { lat: segment.toWp.latitude, lon: segment.toWp.longitude },
        });
    }

    return samples;
};

// Fetch ground elevation with segment-level caching
const fetchGroundElevation = async () => {
    elevationFetchSeq.value++;
    const currentSeq = elevationFetchSeq.value;

    if (waypoints.value.length === 0) {
        groundElevation.value = 0;
        terrainSamples.value = [];
        isFetchingElevation.value = false;
        return;
    }

    isFetchingElevation.value = true;

    try {
        const { segmentsToFetch, cachedSamples } = partitionSegments();
        const allSegmentSamples = [...cachedSamples];

        if (segmentsToFetch.length > 0) {
            const { samplesToFetch, segmentSampleRanges } = generateSegmentSamples(segmentsToFetch);
            const allElevations = await fetchElevationBatches(samplesToFetch);
            allSegmentSamples.push(...cacheAndMergeSamples(segmentSampleRanges, samplesToFetch, allElevations));
        }

        if (currentSeq === elevationFetchSeq.value) {
            allSegmentSamples.sort((a, b) => a.distance - b.distance);
            terrainSamples.value = allSegmentSamples;

            if (allSegmentSamples.length > 0) {
                const sum = allSegmentSamples.reduce((acc, sample) => acc + sample.elevation, 0);
                groundElevation.value = Math.round(sum / allSegmentSamples.length);
            }
        }
    } catch (error) {
        console.error("Failed to fetch ground elevation:", error);
        if (currentSeq === elevationFetchSeq.value) {
            groundElevation.value = 0;
            terrainSamples.value = [];
        }
    } finally {
        if (currentSeq === elevationFetchSeq.value) {
            isFetchingElevation.value = false;
        }
    }
};

// Watch waypoints and fetch ground elevation when they change
watch(
    () => waypoints.value,
    () => {
        fetchGroundElevation();
    },
    { deep: true, immediate: true },
);
</script>

<style scoped>
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

/* SVG styles */
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
    font-family: sans-serif;
}

.amsl-label {
    fill: var(--surface-600);
    font-size: 6px;
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
    font-weight: bold;
    pointer-events: none;
    font-family: sans-serif;
}

.ground-line {
    stroke: var(--surface-700);
    stroke-width: 1;
    stroke-dasharray: 4, 2;
    opacity: 0.6;
}

.ground-label {
    fill: var(--surface-700);
    font-size: 7px;
    font-family: sans-serif;
    font-weight: bold;
}

.max-ground-line {
    stroke: var(--error-500);
    stroke-width: 1;
    stroke-dasharray: 2, 2;
    opacity: 0.7;
}

.max-ground-label {
    fill: var(--error-500);
    font-size: 7px;
    font-family: sans-serif;
    font-weight: bold;
}

.tooltip-bg {
    fill: var(--surface-950);
    opacity: 0.9;
    stroke: var(--primary-500);
    stroke-width: 0.5;
}

.tooltip-text {
    fill: var(--surface-50);
    font-size: 8px;
    font-family: sans-serif;
    pointer-events: none;
}

.no-waypoints {
    padding: 2rem;
    text-align: center;
    color: var(--surface-700);
}

.no-waypoints p {
    margin: 0;
    font-style: italic;
}

/* Responsive */
@media (max-width: 768px) {
    .profile-stats {
        flex-direction: column;
        gap: 0.5rem;
    }

    .profile-chart-container {
        overflow-x: scroll;
    }
}
</style>
