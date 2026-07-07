<template>
<UiBox :title="$t('flightPlanMap')" class="flight-plan-map">
<div class="map-container">
<div ref="mapRef" class="map"></div>
<div v-if="isLoading" class="map-loading">
<div class="loading-message">
{{ $t("flightPlanLoading") }}
</div>
</div>
</div>
<div class="map-instructions">
<p v-html="$t('flightPlanMapInstructions')"></p>
</div>
</UiBox>
</template><script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";
import UiBox from "@/components/elements/UiBox.vue";
import { initMap } from "@/js/utils/map";
import { fromLonLat, toLonLat } from "ol/proj";
import { Feature } from "ol";
import { Point, LineString } from "ol/geom";
import { Vector as LayerVector } from "ol/layer";
import { Vector as SourceVector } from "ol/source";
import { Style, Stroke, Circle, Fill, Text } from "ol/style";
import { DragPan } from "ol/interaction";
import { useFlightPlan } from "@/composables/useFlightPlan";

const { waypoints, positionalWaypoints, selectedWaypointUid, selectWaypoint, addWaypointAtLocation, updateWaypoint } =
useFlightPlan();

// Map renders only positional waypoints (lat/lon meaningful); modifier types
// have no horizontal position and would otherwise be plotted at (0, 0).
const sortedWaypoints = positionalWaypoints;

const mapRef = ref(null);
const mapInstance = ref(null);
const waypointLayer = ref(null);
const pathLayer = ref(null);
const draggingWaypointUid = ref(null);
const dragPanInteraction = ref(null);
const isDragging = ref(false);
const dragStartCoordinate = ref(null);
const lastValidDragCoord = ref(null);   // 마지막 정상좌표 (pointercancel 복구용)
const isLoading = ref(true);

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
// Handle pointer down - start dragging
mapInstance.value.map.on("pointerdown", (event) => {
const feature = mapInstance.value.map.forEachFeatureAtPixel(event.pixel, (feat) => feat, {
layerFilter: (layer) => layer === waypointLayer.value,
});

if (feature) {
const waypointUid = feature.get("waypointUid");
if (waypointUid) {
event.preventDefault();
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
mapInstance.value.map.getTargetElement().style.cursor = hit ? "move" : "";
}
});

// 드래그 종료 공통 로직
const endDrag = (finalCoord, wasCancelled = false) => {
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

// Click handler - add new waypoint when clicking on empty map
mapInstance.value.map.on("click", (event) => {
if (isDragging.value) return;
const waypointClicked = mapInstance.value.map.hasFeatureAtPixel(event.pixel, {
layerFilter: (layer) => layer === waypointLayer.value,
});
if (!waypointClicked) {
const coords = toLonLat(event.coordinate);
addWaypointAtLocation(coords[1], coords[0]);
}
});

// Initial map update
updateMapFeatures();

// Map is now ready
isLoading.value = false;
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
const feat = waypointLayer.value.getSource().getFeatures().find((f) => f.get("waypointUid") === uid);
if (!feat) return;
const wp = sortedWaypoints.value.find((w) => w.uid === uid);
if (!wp) return;

const isSelected = selectedWaypointUid.value === uid;
let fill = "#0080FF", r = 14, sw = 2, fs = "bold 12px sans-serif";
if (isDragActive) { fill = "#00FF00"; r = 14; sw = 3; fs = "bold 14px sans-serif"; }
else if (isSelected) { fill = "#FF8C00"; r = 14; sw = 3; fs = "bold 13px sans-serif"; }

feat.setStyle(new Style({
image: new Circle({ radius: r, fill: new Fill({ color: fill }), stroke: new Stroke({ color: "#FFF", width: sw }) }),
text: new Text({ text: String(wp.order + 1), fill: new Fill({ color: "#FFF" }), font: fs }),
}));
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
if (mapInstance.value?.destroy) {
mapInstance.value.destroy();
}
});
</script><style scoped>
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
min-height: 480px;
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

.map-instructions {
margin-top: 0.5rem;
padding: 0.5rem;
background: var(--surface-100);
border-radius: 4px;
font-size: 0.75rem;
color: var(--surface-700);
text-align: center;
}

.map-instructions p {
margin: 0;
}

@media (max-width: 1055px) {
.map-container {
min-height: 320px;
}
}
</style>