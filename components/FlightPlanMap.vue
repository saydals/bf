<template>
    <UiBox :title="$t('flightPlanMap')" class="flight-plan-map" fill>
        <div ref="mapContainerRef" class="map-container">
            <div ref="mapRef" class="map"></div>
            <div v-if="isLoading" class="map-loading">
                <div class="loading-message">
                    {{ $t("flightPlanLoading") }}
                </div>
            </div>
            <div class="map-top-controls">
                <div class="map-rotate-controls">
                    <button
                        class="rotate-btn"
                        @mousedown.prevent="startRotateLeft"
                        @mouseup="handleRotateLeftMouseUp"
                        @mouseleave="stopRotate"
                        :title="$t('flightPlanRotateLeft')"
                    >
                        ↺
                    </button>
                    <button
                        class="rotate-btn"
                        @mousedown.prevent="startRotateRight"
                        @mouseup="handleRotateRightMouseUp"
                        @mouseleave="stopRotate"
                        :title="$t('flightPlanRotateRight')"
                    >
                        ↻
                    </button>
                </div>
                <div class="map-zoom-controls">
                    <button
                        class="zoom-btn"
                        @mousedown.prevent="startZoomIn"
                        @mouseup="handleZoomInMouseUp"
                        @mouseleave="stopZoom"
                        :title="$t('flightPlanZoomIn')"
                    >
                        +
                    </button>
                    <button
                        class="zoom-btn"
                        @mousedown.prevent="startZoomOut"
                        @mouseup="handleZoomOutMouseUp"
                        @mouseleave="stopZoom"
                        :title="$t('flightPlanZoomOut')"
                    >
                        −
                    </button>
                </div>
            </div>
            <div class="compass-group compass-group-top-right" :class="{ hidden: isLoading }">
                <div
                    class="compass-overlay"
                    @click.stop="resetNorth"
                    @touchstart.prevent="resetNorth"
                    role="button"
                    aria-label="$t('flightPlanCompassResetNorth')"
                >
                    <img
                        class="compass-needle"
                        src="/images/compass.svg"
                        alt="compass"
                        :style="{ transform: `rotate(${northAngle}rad)` }"
                    />
                </div>
            </div>
            <div class="map-undo-redo-controls">
                <button class="map-action-btn" :disabled="!canUndo" :title="$t('flightPlanUndo')" @click="handleUndo">
                    <UIcon name="i-lucide-undo" class="size-4" />
                </button>
                <button class="map-action-btn" :disabled="!canRedo" :title="$t('flightPlanRedo')" @click="handleRedo">
                    <UIcon name="i-lucide-redo" class="size-4" />
                </button>
                <button class="map-action-btn" :title="$t('flightPlanClearAll')" @click="handleClearAll">
                    <UIcon name="i-lucide-trash-2" class="size-4" />
                </button>
            </div>
            <div class="map-buttons-bottom-left">
                <button
                    class="zoom-btn"
                    :class="{ 'map-btn-active': activeLayer === 'satellite' }"
                    @click="setLayer('satellite')"
                    title="Satellite"
                >
                    S
                </button>
                <button
                    class="zoom-btn"
                    :class="{ 'map-btn-active': activeLayer === 'hybrid' }"
                    @click="setLayer('hybrid')"
                    title="Hybrid"
                >
                    H
                </button>
                <button
                    class="zoom-btn"
                    :class="{ 'map-btn-active': activeLayer === 'street' }"
                    @click="setLayer('street')"
                    title="Street"
                >
                    R
                </button>
                <button
                    class="zoom-btn"
                    :class="{ 'map-btn-active': isFullscreen }"
                    @click="toggleFullscreen"
                    title="Fullscreen"
                >
                    ⛶
                </button>
                <button class="zoom-btn home-btn" @click="handleHomeClick" :title="$t('flightPlanHomeTooltip')">
                    🏠
                </button>
            </div>
            <div class="map-defaults-bar">
                <USelect
                    v-model="defaultAltitudeFt"
                    :items="altitudeItems"
                    :placeholder="$t('flightPlanDefaultAltitude')"
                    size="xs"
                    class="defaults-select"
                />
                <USelect
                    v-model="defaultSpeedKt"
                    :items="speedItems"
                    :placeholder="$t('flightPlanDefaultSpeed')"
                    size="xs"
                    class="defaults-select"
                />
            </div>
        </div>
    </UiBox>
</template>
<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import UiBox from "@/components/elements/UiBox.vue";
import { initMap } from "@/js/utils/map";
import { fromLonLat, toLonLat } from "ol/proj";
import { Feature } from "ol";
import { Point, LineString } from "ol/geom";
import { Vector as LayerVector } from "ol/layer";
import { Vector as SourceVector } from "ol/source";
import { Style, Stroke, Circle, Fill, Text } from "ol/style";
import { DragPan, DoubleClickZoom, MouseWheelZoom } from "ol/interaction";
import { useFlightPlan } from "@/composables/useFlightPlan";
import { useSettingsStore } from "@/stores/settings";
import { useAircraftGpsPolling } from "@/composables/useAircraftGpsPolling";
import { useFlightControllerStore } from "@/stores/fc";

const {
    waypoints,
    positionalWaypoints,
    selectedWaypointUid,
    selectWaypoint,
    addWaypointAtLocation,
    updateWaypoint,
    insertWaypointAfter,
    editWaypoint,
    undo,
    redo,
    canUndo,
    canRedo,
    clearPlan,
} = useFlightPlan();

const settings = useSettingsStore();
const fcStore = useFlightControllerStore();

// Map renders only positional waypoints (lat/lon meaningful); modifier types
// have no horizontal position and would otherwise be plotted at (0, 0).
const sortedWaypoints = positionalWaypoints;

// --- Map action handlers (undo / redo / clear) ---
const handleUndo = () => {
    if (canUndo.value) undo();
};

const handleRedo = () => {
    if (canRedo.value) redo();
};

const handleClearAll = () => {
    if (sortedWaypoints.value.length === 0) return;
    clearPlan();
};

// --- Default waypoint altitude / speed selector ---
// Storage units inside useFlightPlan are feet / knots. The selector keeps the
// chosen values in storage units (feet / knots) and only converts for display,
// following the global unit toggle (altitudeUnit: m/ft, speedUnit: mps/kt/kmh).
// Integer (rounded) values are shown because fractional display is undesirable.
const FT_PER_M = 0.3048; // 1 m = 1 / 0.3048 ft
const MS_PER_KT = 0.514444; // 1 m/s = 1 / 0.514444 kt
const KMH_PER_KT = 1.852; // 1 kt = 1.852 km/h

// Metric-baseline options requested by the user.
const altitudeOptionsM = [30, 60, 90, 120];
const speedOptionsMs = [5, 10, 15, 20];

// Chosen values stored in storage units (feet / knots). Initial: 30 m / 15 m·s⁻¹.
const defaultAltitudeFt = ref(30 / FT_PER_M);
const defaultSpeedKt = ref(15 / MS_PER_KT);

// Altitude dropdown items — label follows the current altitude unit (m / ft).
const altitudeItems = computed(() => {
    const isMetric = settings.altitudeUnit === "m";
    return altitudeOptionsM.map((m) => {
        const ft = m / FT_PER_M;
        const display = isMetric ? m : Math.round(ft);
        return { label: `${display}${isMetric ? "m" : "ft"}`, value: ft };
    });
});

// Speed dropdown items — label follows the current speed unit (m/s / kt / km/h).
const speedItems = computed(() => {
    const unit = settings.speedUnit;
    return speedOptionsMs.map((ms) => {
        const kt = ms / MS_PER_KT;
        let display;
        let suffix;
        if (unit === "kt") {
            display = Math.round(kt);
            suffix = "kt";
        } else if (unit === "kmh") {
            display = Math.round(kt * KMH_PER_KT);
            suffix = "km/h";
        } else {
            display = ms;
            suffix = "m/s";
        }
        return { label: `${display}${suffix}`, value: kt };
    });
});

// --- Waypoint segment helpers (for double-click insert on path line) ---

const calcDist = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const pointToSegmentDistance = (pLat, pLon, aLat, aLon, bLat, bLon) => {
    const toXY = (lat, lon, refLat, refLon) => {
        const dLat = (lat - refLat) * 111320;
        const dLon = (lon - refLon) * 111320 * Math.cos((refLat * Math.PI) / 180);
        return [dLon, dLat];
    };
    const [px, py] = toXY(pLat, pLon, aLat, aLon);
    const [bx, by] = toXY(bLat, bLon, aLat, aLon);
    const dx = bx,
        dy = by;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return { dist: Math.sqrt(px * px + py * py), fraction: 0 };
    let t = (px * dx + py * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = t * dx,
        projY = t * dy;
    return { dist: Math.sqrt((px - projX) ** 2 + (py - projY) ** 2), fraction: t };
};

const interpolatePoint = (lat1, lon1, lat2, lon2, fraction) => {
    const d = calcDist(lat1, lon1, lat2, lon2);
    if (d < 0.001) return { latitude: lat1, longitude: lon1 };
    const φ1 = (lat1 * Math.PI) / 180,
        λ1 = (lon1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180,
        λ2 = (lon2 * Math.PI) / 180;
    const ang = d / 6371000;
    const a = Math.sin((1 - fraction) * ang) / Math.sin(ang);
    const b = Math.sin(fraction * ang) / Math.sin(ang);
    const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
    const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
    const z = a * Math.sin(φ1) + b * Math.sin(φ2);
    return {
        latitude: (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI,
        longitude: (Math.atan2(y, x) * 180) / Math.PI,
    };
};

const findClosestSegment = (pixel) => {
    if (!mapInstance.value || !mapInstance.value.mapView) return null;
    const wpList = positionalWaypoints.value;
    if (wpList.length < 2) return null;
    const coord = mapInstance.value.map.getCoordinateFromPixel(pixel);
    const coordLl = toLonLat(coord);
    const toleranceM = mapInstance.value.mapView.getResolution() * 12;

    let best = null;
    for (let i = 0; i < wpList.length - 1; i++) {
        const a = wpList[i],
            b = wpList[i + 1];
        const { dist, fraction } = pointToSegmentDistance(
            coordLl[1],
            coordLl[0],
            a.latitude,
            a.longitude,
            b.latitude,
            b.longitude,
        );
        if (dist <= toleranceM && (!best || dist < best.dist)) {
            best = { a, b, dist, fraction };
        }
    }
    return best;
};

// Check if the given pixel is near any path line segment (for cursor)
const isNearPathLine = (pixel, tolerancePx) => {
    if (!mapInstance.value || !mapInstance.value.mapView) return false;
    const wpList = positionalWaypoints.value;
    if (wpList.length < 2) return false;
    const coord = mapInstance.value.map.getCoordinateFromPixel(pixel);
    const coordLl = toLonLat(coord);
    const toleranceM = mapInstance.value.mapView.getResolution() * tolerancePx;
    for (let i = 0; i < wpList.length - 1; i++) {
        const a = wpList[i],
            b = wpList[i + 1];
        const { dist } = pointToSegmentDistance(
            coordLl[1],
            coordLl[0],
            a.latitude,
            a.longitude,
            b.latitude,
            b.longitude,
        );
        if (dist <= toleranceM) return true;
    }
    return false;
};

// --- Zoom controls (click → 3x, hold → 0.5x repeat) ---
let zoomTimer = null;
let zoomHoldDelay = null;
let zoomStartTime = 0;

// --- Rotate controls (click → 15°, hold → 3.75° repeat) ---
let rotateTimer = null;
let rotateHoldDelay = null;
let rotateStartTime = 0;

const isLongPress = () => Date.now() - zoomStartTime > 250;

const zoom3In = () => {
    if (mapInstance.value?.mapView) {
        const res = mapInstance.value.mapView.getResolution();
        mapInstance.value.mapView.animate({ resolution: Math.max(0.5, res - 3), duration: 150 });
    }
};
const zoom3Out = () => {
    if (mapInstance.value?.mapView) {
        const res = mapInstance.value.mapView.getResolution();
        mapInstance.value.mapView.animate({ resolution: Math.min(50000, res + 3), duration: 150 });
    }
};

const zoom05In = () => {
    if (mapInstance.value?.mapView) {
        const res = mapInstance.value.mapView.getResolution();
        mapInstance.value.mapView.animate({ resolution: Math.max(0.5, res - 0.5), duration: 80 });
    }
};
const zoom05Out = () => {
    if (mapInstance.value?.mapView) {
        const res = mapInstance.value.mapView.getResolution();
        mapInstance.value.mapView.animate({ resolution: Math.min(50000, res + 0.5), duration: 80 });
    }
};

const startZoomIn = () => {
    zoomStartTime = Date.now();
    clearTimeout(zoomHoldDelay);
    clearInterval(zoomTimer);
    zoomHoldDelay = setTimeout(() => {
        zoomTimer = setInterval(zoom05In, 200);
    }, 250);
};
const startZoomOut = () => {
    zoomStartTime = Date.now();
    clearTimeout(zoomHoldDelay);
    clearInterval(zoomTimer);
    zoomHoldDelay = setTimeout(() => {
        zoomTimer = setInterval(zoom05Out, 200);
    }, 250);
};
const stopZoom = () => {
    clearTimeout(zoomHoldDelay);
    clearInterval(zoomTimer);
    zoomHoldDelay = null;
    zoomTimer = null;
};
const handleZoomInMouseUp = () => {
    stopZoom();
    if (!isLongPress()) {
        zoom3In();
    }
};
const handleZoomOutMouseUp = () => {
    stopZoom();
    if (!isLongPress()) {
        zoom3Out();
    }
};

// 목표각(desiredAngle, 보통 0 = 정북)에 대해 현재 raw 회전값 기준 "최단 delta"로 이동할 절대 목표값 계산.
// view의 실제 rotation을 강제로 snap하지 않으므로 northAngle(나침반 CSS transform)에 불필요한 raw 점프가 생기지 않는다.
const shortestRotationTarget = (currentRotation, desiredAngle) => {
    const twoPi = 2 * Math.PI;
    let delta = (((desiredAngle - currentRotation) % twoPi) + twoPi) % twoPi; // [0, 2π)
    if (delta > Math.PI) delta -= twoPi; // (-π, π]
    return currentRotation + delta;
};

const rotateLeft = () => {
    if (mapInstance.value?.mapView) {
        const r = mapInstance.value.mapView.getRotation();
        mapInstance.value.mapView.animate({ rotation: r - Math.PI / 12, duration: 200 });
    }
};
const rotateRight = () => {
    if (mapInstance.value?.mapView) {
        const r = mapInstance.value.mapView.getRotation();
        mapInstance.value.mapView.animate({ rotation: r + Math.PI / 12, duration: 200 });
    }
};

// Slow hold rotation (3.75° per step, smooth)
const rotateLeftHold = () => {
    if (mapInstance.value?.mapView) {
        const r = mapInstance.value.mapView.getRotation();
        mapInstance.value.mapView.animate({ rotation: r - Math.PI / 48, duration: 80 });
    }
};
const rotateRightHold = () => {
    if (mapInstance.value?.mapView) {
        const r = mapInstance.value.mapView.getRotation();
        mapInstance.value.mapView.animate({ rotation: r + Math.PI / 48, duration: 80 });
    }
};

const isRotateLongPress = () => Date.now() - rotateStartTime > 250;

const startRotateLeft = () => {
    rotateStartTime = Date.now();
    clearTimeout(rotateHoldDelay);
    clearInterval(rotateTimer);
    rotateHoldDelay = setTimeout(() => {
        rotateTimer = setInterval(rotateLeftHold, 200);
    }, 250);
};
const startRotateRight = () => {
    rotateStartTime = Date.now();
    clearTimeout(rotateHoldDelay);
    clearInterval(rotateTimer);
    rotateHoldDelay = setTimeout(() => {
        rotateTimer = setInterval(rotateRightHold, 200);
    }, 250);
};
const stopRotate = () => {
    clearTimeout(rotateHoldDelay);
    clearInterval(rotateTimer);
    rotateHoldDelay = null;
    rotateTimer = null;
};
const handleRotateLeftMouseUp = () => {
    stopRotate();
    if (!isRotateLongPress()) {
        rotateLeft();
    }
};
const handleRotateRightMouseUp = () => {
    stopRotate();
    if (!isRotateLongPress()) {
        rotateRight();
    }
};

// 북향 화살표: 지도 회전각과 반대로 돌려 실제 북쪽 방향 표시
const northAngle = ref(0);
const updateNorthAngle = () => {
    if (mapInstance.value?.mapView) {
        const r = mapInstance.value.mapView.getRotation();
        const twoPi = 2 * Math.PI;
        northAngle.value = ((r % twoPi) + twoPi) % twoPi; // 항상 [0, 2π)로 정규화
    }
};
// 클릭 시 정북 방향으로 리셋 (raw 회전값 기준 최단 delta로 이동 → 항상 최대 180°만 회전, CSS transition에도 raw 점프 없음)
const resetNorth = () => {
    if (mapInstance.value?.mapView) {
        const view = mapInstance.value.mapView;
        const target = shortestRotationTarget(view.getRotation(), 0);
        view.animate({ rotation: target, duration: 300 });
    }
};

// --- Map layer switching (S = Satellite, H = Hybrid, R = Road/Street) ---
const setLayer = (layerKey) => {
    if (!mapInstance.value?.layers) return;
    Object.entries(mapInstance.value.layers).forEach(([key, layer]) => {
        layer.setVisible(key === layerKey);
    });
    activeLayer.value = layerKey;
};

// --- Fullscreen controls (CSS 기반 - 브라우저 Fullscreen API 사용 안 함) ---
// 이유: UModal/Dialog 등이 body로 텔레포트되므로, 브라우저 fullscreen 시 가려짐.
// CSS fixed 방식으로 map-container만 화면 전체로 확장하여 다이얼로그 정상 표시.
const toggleFullscreen = () => {
    const mapContainer = mapContainerRef.value;
    if (!mapContainer) return;

    isFullscreen.value = !isFullscreen.value;
    mapContainer.classList.toggle("fullscreen", isFullscreen.value);

    nextTick(() => {
        if (mapInstance.value?.map) {
            mapInstance.value.map.updateSize();
        }
    });
};

const handleFullscreenChange = () => {
    // 브라우저 네이티브 전체화면(F11 등) 감지 시 CSS 전체화면 해제
    const isNativeFullscreen = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement
    );
    if (!isNativeFullscreen && isFullscreen.value) {
        const mapContainer = mapContainerRef.value;
        if (mapContainer) {
            mapContainer.classList.remove("fullscreen");
            isFullscreen.value = false;
        }
    }
    requestAnimationFrame(() => {
        if (mapInstance.value?.map) {
            mapInstance.value.map.updateSize();
            // 강제 re-render로 drag-drop 이벤트 좌표 보정
            const renderer = mapInstance.value.map.getRenderer && mapInstance.value.map.getRenderer();
            if (renderer) {
                mapInstance.value.map.renderSync();
            }
        }
    });
};

// --- Home button: fly to aircraft GPS position, or reset to initial view if no GPS fix ---
const initialMapCenter = ref(null);
const initialMapZoom = ref(null);

const saveInitialMapState = () => {
    if (mapInstance.value?.mapView) {
        initialMapCenter.value = mapInstance.value.mapView.getCenter();
        initialMapZoom.value = mapInstance.value.mapView.getZoom();
    }
};

const handleHomeClick = () => {
    if (!mapInstance.value?.mapView) return;
    // GPS fix가 있으면 기체 위치로, 없으면 초기 지도 위치로 이동
    const gpsData = fcStore?.gpsData || {};
    if (gpsData?.fix) {
        flyToAircraft();
    } else if (initialMapCenter.value && initialMapZoom.value) {
        mapInstance.value.mapView.animate({
            center: initialMapCenter.value,
            zoom: initialMapZoom.value,
            duration: 300,
        });
    }
};

// 마우스 휠 처리: 지도를 가로로 3등분하여 가운데 1/3에서만 확대/축소.
// 좌우 1/3에서는 preventDefault 하지 않아 브라우저 기본 페이지 스크롤이 동작한다.
const handleMapWheel = (event) => {
    if (!mapInstance.value?.mapView || !mapRef.value) {
        return;
    }

    const rect = mapRef.value.getBoundingClientRect();
    const relX = event.clientX - rect.left;
    const inCenterThird = relX >= rect.width / 3 && relX <= (rect.width * 2) / 3;

    if (!inCenterThird) {
        // 좌우 영역: 지도 줌을 막고 페이지 스크롤에 맡긴다.
        return;
    }

    // 가운데 영역: 페이지 스크롤을 막고 지도 확대/축소.
    event.preventDefault();
    const view = mapInstance.value.mapView;
    const res = view.getResolution();
    if (res == null) {
        return;
    }
    // 휠 위(deltaY < 0) → 확대, 아래 → 축소
    const factor = event.deltaY < 0 ? 1 / 1.15 : 1.15;
    const newRes = Math.min(50000, Math.max(0.5, res * factor));
    view.animate({ resolution: newRes, duration: 80 });
};

const mapRef = ref(null);
const mapContainerRef = ref(null);
const mapInstance = ref(null);
const activeLayer = ref("satellite");
const isFullscreen = ref(false);
const { start: startGpsPolling, stop: stopGpsPolling, flyToAircraft } = useAircraftGpsPolling(mapInstance);
const waypointLayer = ref(null);
const pathLayer = ref(null);
const draggingWaypointUid = ref(null);
const dragPanInteraction = ref(null);
const isDragging = ref(false);
const dragStartCoordinate = ref(null);
const lastValidDragCoord = ref(null); // 마지막 정상좌표 (pointercancel 복구용)
const isLoading = ref(true);
let pendingDeleteTimer = null;
const pendingDeleteUid = ref(null);

// Helper function to initialize map with given coordinates
const initializeMapAtLocation = (latitude, longitude, logMessage) => {
    mapInstance.value = initMap({
        target: mapRef.value,
        defaultZoom: 15, // Zoom level 15 shows approximately 1 nautical mile (1852m) in view
        defaultLat: latitude,
        defaultLon: longitude,
        defaultLayer: "satellite",
    });

    console.log(logMessage);
    setupMapLayers();
    mapInstance.value.mapView.on("change:rotation", updateNorthAngle);
    updateNorthAngle();

    // 가운데 1/3에서만 휠 줌, 좌우는 페이지 스크롤 (passive:false 여야 preventDefault 동작)
    if (mapRef.value) {
        mapRef.value.addEventListener("wheel", handleMapWheel, { passive: false });
    }
};

// Fetch location from IP-based geolocation API
const fetchIPLocation = async () => {
    try {
        const response = await fetch("https://get.geojs.io/v1/ip/geo.json");
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.latitude && data.longitude) {
            return {
                latitude: Number(data.latitude),
                longitude: Number(data.longitude),
            };
        }
        throw new Error("Invalid response from IP geolocation API");
    } catch (error) {
        console.warn("IP geolocation failed:", error.message);
        return null;
    }
};

// Initialize map and layers
onMounted(async () => {
    if (!mapRef.value) {
        console.error("Map ref not available");
        return;
    }

    // Final fallback coordinates (Sydney Harbour Bridge, Australia)
    const finalFallbackLat = -33.8523;
    const finalFallbackLon = 151.2108;

    // Try to get user's geolocation via browser API
    if (navigator.geolocation) {
        // prettier-ignore
        navigator.geolocation.getCurrentPosition( // NOSONAR - user-initiated, required for map centering
            (position) => {
                const { latitude, longitude } = position.coords;
                console.log("Browser geolocation obtained:", latitude, longitude);
                initializeMapAtLocation(latitude, longitude, "Map initialized at browser location");
            },
            async (error) => {
                console.warn("Browser geolocation failed:", error.message);

                // Fallback to IP-based geolocation
                const ipLocation = await fetchIPLocation();
                if (ipLocation) {
                    console.log("IP geolocation obtained:", ipLocation.latitude, ipLocation.longitude);
                    initializeMapAtLocation(
                        ipLocation.latitude,
                        ipLocation.longitude,
                        "Map initialized at IP-based location",
                    );
                } else {
                    console.warn("IP geolocation failed, using final fallback");
                    initializeMapAtLocation(
                        finalFallbackLat,
                        finalFallbackLon,
                        "Map initialized at final fallback location",
                    );
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0,
            },
        );
    } else {
        console.warn("Browser geolocation not supported");

        // Fallback to IP-based geolocation
        const ipLocation = await fetchIPLocation();
        if (ipLocation) {
            console.log("IP geolocation obtained:", ipLocation.latitude, ipLocation.longitude);
            initializeMapAtLocation(ipLocation.latitude, ipLocation.longitude, "Map initialized at IP-based location");
        } else {
            console.warn("IP geolocation failed, using final fallback");
            initializeMapAtLocation(finalFallbackLat, finalFallbackLon, "Map initialized at final fallback location");
        }
    }
});

// Setup map layers and event handlers
const setupMapLayers = () => {
    if (!mapInstance.value) {
        console.error("Map instance not available");
        return;
    }

    // Remove default DoubleClickZoom so dblclick is free for waypoint insertion.
    // Remove default MouseWheelZoom so we can restrict wheel-zoom to the center third
    // of the map (left/right thirds fall through to normal page scrolling).
    mapInstance.value.map.getInteractions().forEach((interaction) => {
        if (interaction instanceof DoubleClickZoom || interaction instanceof MouseWheelZoom) {
            mapInstance.value.map.removeInteraction(interaction);
        }
    });

    // Create path line layer (magenta line) - add first so it renders behind waypoints
    pathLayer.value = new LayerVector({
        source: new SourceVector(),
        style: new Style({
            stroke: new Stroke({
                color: "#FF00FF", // Magenta
                width: 3,
            }),
        }),
    });
    mapInstance.value.map.addLayer(pathLayer.value);

    // Create waypoint marker layer with numbered circles - add second so it renders on top
    waypointLayer.value = new LayerVector({
        source: new SourceVector(),
    });
    mapInstance.value.map.addLayer(waypointLayer.value);

    // Get reference to the default DragPan interaction
    mapInstance.value.map.getInteractions().forEach((interaction) => {
        if (interaction instanceof DragPan) {
            dragPanInteraction.value = interaction;
        }
    });

    // Manual drag handling using pointer events
    // Handle pointer down - start dragging or pending delete
    const startPendingDeleteTimer = (uid) => {
        cancelPendingDelete();
        pendingDeleteUid.value = uid;
        pendingDeleteTimer = setTimeout(() => {
            if (pendingDeleteUid.value === uid) {
                isDragging.value = false;
                draggingWaypointUid.value = null;
                dragStartCoordinate.value = null;
                lastValidDragCoord.value = null;
                if (dragPanInteraction.value) dragPanInteraction.value.setActive(true);
                updateMapFeatures(false);
                editWaypoint(uid);
            }
            pendingDeleteUid.value = null;
            pendingDeleteTimer = null;
        }, 2000);
    };
    const cancelPendingDelete = () => {
        clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = null;
        pendingDeleteUid.value = null;
    };

    mapInstance.value.map.on("pointerdown", (event) => {
        const feature = mapInstance.value.map.forEachFeatureAtPixel(event.pixel, (feat) => feat, {
            layerFilter: (layer) => layer === waypointLayer.value,
        });

        if (feature) {
            const waypointUid = feature.get("waypointUid");
            if (waypointUid) {
                event.preventDefault();
                cancelPendingDelete();
                isDragging.value = true;
                draggingWaypointUid.value = waypointUid;
                dragStartCoordinate.value = [...event.coordinate];
                lastValidDragCoord.value = [...event.coordinate];

                // Disable map panning
                if (dragPanInteraction.value) {
                    dragPanInteraction.value.setActive(false);
                }

                // 스타일만 변경 (전체 마커 삭제 안함 → 객체 참조 유지)
                updateDraggingStyle(waypointUid, true);

                // Start 2s pending delete timer
                startPendingDeleteTimer(waypointUid);

                console.log("Started dragging waypoint:", waypointUid);
            }
        }
    });

    // Handle pointer move - update waypoint position during drag
    mapInstance.value.map.on("pointermove", (event) => {
        if (isDragging.value && draggingWaypointUid.value) {
            // 좌표 유효성 검사 (터치 왜곡 방지)
            const [cx, cy] = event.coordinate || [];
            if (!isFinite(cx) || !isFinite(cy) || Math.abs(cx) > 3e7 || Math.abs(cy) > 3e7) {
                return;
            }

            // Cancel pending delete if waypoint moved significantly
            if (pendingDeleteUid.value === draggingWaypointUid.value && dragStartCoordinate.value) {
                const startPx = mapInstance.value.map.getPixelFromCoordinate(dragStartCoordinate.value);
                const currentPx = mapInstance.value.map.getPixelFromCoordinate([cx, cy]);
                const dist = Math.hypot(currentPx[0] - startPx[0], currentPx[1] - startPx[1]);
                if (dist > 3) {
                    cancelPendingDelete();
                }
            }

            lastValidDragCoord.value = [cx, cy];

            const src = waypointLayer.value.getSource();
            const feat = src.getFeatures().find((f) => f.get("waypointUid") === draggingWaypointUid.value);
            if (feat) {
                feat.getGeometry().setCoordinates([cx, cy]);
                updatePathDuringDrag(draggingWaypointUid.value, [cx, cy]);
            }
        } else {
            // Update cursor when hovering over waypoints
            const hit = mapInstance.value.map.hasFeatureAtPixel(event.pixel, {
                layerFilter: (layer) => layer === waypointLayer.value,
            });
            if (hit) {
                mapInstance.value.map.getTargetElement().style.cursor = "move";
            } else {
                // Check if hovering near the path line for "+" insert cursor
                const nearLine = isNearPathLine(event.pixel, 12);
                mapInstance.value.map.getTargetElement().style.cursor = nearLine
                    ? 'url("/images/plus-cursor.svg") 16 16, copy'
                    : "";
            }
        }
    });

    // 드래그 종료 공통 로직
    const endDrag = (finalCoord, wasCancelled = false) => {
        cancelPendingDelete();
        if (!isDragging.value || !draggingWaypointUid.value) return;
        const uid = draggingWaypointUid.value;

        let useCoord = finalCoord;
        const [x, y] = useCoord || [];
        if (!useCoord || !isFinite(x) || !isFinite(y) || Math.abs(x) > 3e7 || Math.abs(y) > 3e7) {
            useCoord = lastValidDragCoord.value || dragStartCoordinate.value;
        }

        const startPx = mapInstance.value.map.getPixelFromCoordinate(dragStartCoordinate.value);
        const endPx = mapInstance.value.map.getPixelFromCoordinate(useCoord);
        const dist = Math.hypot(endPx[0] - startPx[0], endPx[1] - startPx[1]);

        if (dist > 3 || wasCancelled) {
            const [lon, lat] = toLonLat(useCoord);
            updateWaypoint(uid, { latitude: lat, longitude: lon });
        } else {
            selectWaypoint(uid);
        }

        isDragging.value = false;
        draggingWaypointUid.value = null;
        dragStartCoordinate.value = null;
        lastValidDragCoord.value = null;
        if (dragPanInteraction.value) dragPanInteraction.value.setActive(true);

        // 드래그 완료 시에만 명시적 재빌드 (클릭은 watcher에 위임)
        if (dist > 3 || wasCancelled) {
            updateMapFeatures(false);
        }
    };

    // Pointer up → end drag
    mapInstance.value.map.on("pointerup", (e) => endDrag(e.coordinate, false));

    // Pointer cancel → safe end drag
    mapInstance.value.map.on("pointercancel", () => endDrag(lastValidDragCoord.value, true));

    // Click handler - near line → insert between, empty space → append
    mapInstance.value.map.on("click", (event) => {
        if (isDragging.value) return;
        const waypointClicked = mapInstance.value.map.hasFeatureAtPixel(event.pixel, {
            layerFilter: (layer) => layer === waypointLayer.value,
        });
        if (waypointClicked) return;

        // Check if near path line → insert between waypoints
        const seg = findClosestSegment(event.pixel);
        if (seg) {
            const ll = interpolatePoint(seg.a.latitude, seg.a.longitude, seg.b.latitude, seg.b.longitude, seg.fraction);
            const alt = Math.round(seg.a.altitude + seg.fraction * (seg.b.altitude - seg.a.altitude));
            insertWaypointAfter(seg.a.uid, {
                latitude: ll.latitude,
                longitude: ll.longitude,
                altitude: alt,
                speed: seg.a.speed,
            });
            return;
        }

        // Otherwise add waypoint at the end
        const coords = toLonLat(event.coordinate);
        addWaypointAtLocation(coords[1], coords[0], {
            altitude: defaultAltitudeFt.value,
            speed: defaultSpeedKt.value,
        });
    });

    // Initial map update
    updateMapFeatures();

    // Map is now ready
    isLoading.value = false;
    saveInitialMapState();
    startGpsPolling();
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);
};

// Update path lines during drag in real-time
const updatePathDuringDrag = (draggingUid, newCoordinates) => {
    if (!pathLayer.value) {
        return;
    }

    const pathSource = pathLayer.value.getSource();
    pathSource.clear();

    // Build coordinates array with the updated position for the dragging waypoint
    const coordinates = [];
    sortedWaypoints.value.forEach((wp) => {
        let coord;
        if (wp.uid === draggingUid) {
            // Use the current dragged position
            coord = newCoordinates;
        } else {
            // Use the stored position
            coord = fromLonLat([wp.longitude, wp.latitude]);
        }
        coordinates.push(coord);
    });

    // Draw magenta line connecting waypoints
    if (coordinates.length > 1) {
        const lineFeature = new Feature({
            geometry: new LineString(coordinates),
        });
        pathSource.addFeature(lineFeature);
    }
};

// 스타일만 변경하여 드래그 마커 객체 참조 유지
const updateDraggingStyle = (uid, isDragActive) => {
    if (!waypointLayer.value) return;
    const feat = waypointLayer.value
        .getSource()
        .getFeatures()
        .find((f) => f.get("waypointUid") === uid);
    if (!feat) return;
    const wp = sortedWaypoints.value.find((w) => w.uid === uid);
    if (!wp) return;

    const isSelected = selectedWaypointUid.value === uid;
    let fill = "#0080FF",
        r = 14,
        sw = 2,
        fs = "bold 12px sans-serif";
    if (isDragActive) {
        fill = "#00FF00";
        r = 14;
        sw = 3;
        fs = "bold 14px sans-serif";
    } else if (isSelected) {
        fill = "#FF8C00";
        r = 14;
        sw = 3;
        fs = "bold 13px sans-serif";
    }

    feat.setStyle(
        new Style({
            image: new Circle({
                radius: r,
                fill: new Fill({ color: fill }),
                stroke: new Stroke({ color: "#FFF", width: sw }),
            }),
            text: new Text({ text: String(wp.order + 1), fill: new Fill({ color: "#FFF" }), font: fs }),
        }),
    );
};

// Update map features when waypoints change
const updateMapFeatures = (autoFit = true) => {
    // 드래그 중에는 외부에서 오는 전체 재생성 요청 무시 (watcher 차단)
    if (isDragging.value) return;

    if (!waypointLayer.value || !pathLayer.value) {
        console.log("Layers not ready yet");
        return;
    }

    const waypointSource = waypointLayer.value.getSource();
    const pathSource = pathLayer.value.getSource();

    // Clear existing features
    waypointSource.clear();
    pathSource.clear();

    const sorted = sortedWaypoints.value;

    if (!sorted.length) {
        console.log("No waypoints to display");
        return;
    }

    console.log(`Updating map with ${sorted.length} waypoints`);

    // Add markers for each waypoint with order numbers
    const coordinates = [];
    sorted.forEach((wp) => {
        const coord = fromLonLat([wp.longitude, wp.latitude]);
        coordinates.push(coord);

        // Create numbered marker
        const feature = new Feature({
            geometry: new Point(coord),
            waypointUid: wp.uid,
            waypointOrder: wp.order + 1,
        });

        // Check if this waypoint is selected
        const isSelected = selectedWaypointUid.value === wp.uid;

        // Determine color: green for dragging, orange for selected, blue for normal
        let fillColor = "#0080FF"; // Blue for normal
        let radius = 14;
        let strokeWidth = 2;
        let fontSize = "bold 12px sans-serif";

        if (isSelected) {
            fillColor = "#FF8C00"; // Orange for selected
            radius = 14;
            strokeWidth = 3;
            fontSize = "bold 13px sans-serif";
        }

        // Style with numbered circle
        feature.setStyle(
            new Style({
                image: new Circle({
                    radius: radius,
                    fill: new Fill({
                        color: fillColor,
                    }),
                    stroke: new Stroke({
                        color: "#FFFFFF",
                        width: strokeWidth,
                    }),
                }),
                text: new Text({
                    text: String(wp.order + 1),
                    fill: new Fill({
                        color: "#FFFFFF",
                    }),
                    font: fontSize,
                }),
            }),
        );

        waypointSource.addFeature(feature);
    });

    // Draw magenta line connecting waypoints in order
    if (coordinates.length > 1) {
        const lineFeature = new Feature({
            geometry: new LineString(coordinates),
        });
        pathSource.addFeature(lineFeature);
        console.log(`Drew path line connecting ${coordinates.length} waypoints`);
    }

    // Auto-fit map to show all waypoints (only if requested)
    if (autoFit && coordinates.length > 0) {
        const extent = waypointSource.getExtent();
        mapInstance.value.mapView.fit(extent, {
            padding: [50, 50, 50, 50],
            maxZoom: 15,
            duration: 500,
        });
        console.log("Map fitted to waypoints");
    }
};

// Watch waypoints and update map (don't auto-fit to prevent zoom changes during drag/edit)
watch(
    () => waypoints.value,
    () => updateMapFeatures(false),
    { deep: true },
);

// Watch dragging state and update map to show green marker

// Watch selected waypoint and update map focus
watch(
    () => selectedWaypointUid.value,
    (selectedUid) => {
        if (!mapInstance.value || !selectedUid) {
            return;
        }

        // Update map features to show selection styling (don't auto-fit)
        updateMapFeatures(false);

        // Find the selected waypoint and pan to it
        const selectedWaypoint = sortedWaypoints.value.find((wp) => wp.uid === selectedUid);
        if (selectedWaypoint) {
            const coord = fromLonLat([selectedWaypoint.longitude, selectedWaypoint.latitude]);

            // Smoothly animate to the selected waypoint
            mapInstance.value.mapView.animate({
                center: coord,
                duration: 500,
            });

            console.log("Map centered on selected waypoint:", selectedWaypoint.order + 1);
        }
    },
);

// Cleanup on unmount
onUnmounted(() => {
    console.log("Cleaning up map");
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    if (mapRef.value) {
        mapRef.value.removeEventListener("wheel", handleMapWheel, { passive: false });
    }
    if (mapInstance.value?.destroy) {
        mapInstance.value.destroy();
    }
});
</script>
<style scoped>
.flight-plan-map {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.flight-plan-map :deep(> div:last-child) {
    flex: 1;
    min-height: 0;
}

.map-container {
    flex: 1;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--surface-500);
    background: var(--surface-100);
    position: relative;
}

.map {
    width: 100%;
    height: 100%;
}

/* 지도 하단 중앙: 기본 고도/속도 선택 드롭다운 2개 */
.map-defaults-bar {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 500;
    max-width: calc(100% - 20px);
    flex-wrap: wrap;
    justify-content: center;
}

.defaults-select {
    min-width: 84px;
}
/* OpenLayers 동적 DOM까지 touch-action 적용 */
.map :deep(.ol-viewport) {
    touch-action: none !important;
}

.map-loading {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-100);
    z-index: 1000;
}

.loading-message {
    font-size: 1rem;
    color: var(--text);
    font-weight: 500;
}

.map-top-controls {
    position: absolute;
    top: 10px;
    left: 10px;
    display: flex;
    flex-direction: row;
    gap: 2px;
    z-index: 500;
}

.map-zoom-controls {
    display: flex;
    flex-direction: row;
    gap: 2px;
}

.map-rotate-controls {
    display: flex;
    flex-direction: row;
    gap: 2px;
}

.compass-group {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    z-index: 500;
}

.compass-group-top-right {
    padding: 6px;
}

.compass-group.hidden {
    display: none;
}

.compass-overlay {
    width: 55px;
    height: 55px;
    background: rgba(255, 255, 255, 0.6);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.2s ease;
}

.compass-overlay:hover {
    filter: brightness(1.3);
}

.compass-needle {
    width: 51px;
    height: 51px;
    pointer-events: none;
}

.home-btn {
    width: 30px;
    height: 30px;
    background: var(--surface-100);
    border: 1px solid var(--surface-500);
    border-radius: 4px;
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
}

.home-btn:hover {
    background: var(--surface-200);
}

.home-btn:active {
    background: var(--surface-300);
}

.zoom-btn {
    width: 30px;
    height: 30px;
    background: var(--surface-100);
    border: 1px solid var(--surface-500);
    border-radius: 4px;
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
}

.zoom-btn:hover {
    background: var(--surface-200);
}

.zoom-btn:active {
    background: var(--surface-300);
}

.rotate-btn {
    width: 30px;
    height: 30px;
    background: var(--surface-100);
    border: 1px solid var(--surface-500);
    border-radius: 4px;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
}

.rotate-btn:hover {
    background: var(--surface-200);
}

.rotate-btn:active {
    background: var(--surface-300);
}

.map-undo-redo-controls {
    position: absolute;
    bottom: 10px;
    right: 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 1000;
}

.map-action-btn {
    width: 30px;
    height: 30px;
    background: var(--surface-100);
    border: 1px solid var(--surface-500);
    border-radius: 4px;
    cursor: pointer;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
}

.map-action-btn:hover:not(:disabled) {
    background: var(--surface-200);
}

.map-action-btn:active:not(:disabled) {
    background: var(--surface-300);
}

.map-action-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.map-buttons-bottom-left {
    position: absolute;
    bottom: 10px;
    left: 10px;
    display: flex;
    flex-direction: row;
    gap: 2px;
    z-index: 500;
}

.map-btn-active {
    background: var(--primary-500);
    color: #fff;
    border-color: var(--primary-500);
}

.map-btn-active:hover {
    background: var(--primary-600);
}

/* 전체화면 모드: .map-container를 뷰포트 전체로 확장 (CSS 기반 - 브라우저 Fullscreen API 사용 안 함) */
/* 이유: UModal/Dialog가 body로 텔레포트되므로 브라우저 fullscreen 시 모달이 가려짐 */
.map-container.fullscreen {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 9999 !important;
    border-radius: 0 !important;
    border: none !important;
    background: var(--surface-100);
}

.compass-needle {
    width: 76px;
    height: 76px;
    cursor: pointer;
    transition: transform 0.2s ease;
}

.compass-needle:hover {
    filter: brightness(1.3);
}

@media (max-width: 1055px) {
    .map-container {
        min-height: 320px;
    }
}
</style>
