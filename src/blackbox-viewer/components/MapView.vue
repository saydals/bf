<template>
    <div v-show="graphStore.hasMap" ref="mapContainer" class="absolute inset-0"></div>
</template>

<script setup>
import { useGraphStore } from "../stores/graph.js";
import { createApp, h, ref, onBeforeUnmount } from "vue";
import MapAirplane from "./MapAirplane.vue";

const graphStore = useGraphStore();

// Attitude forwarded to the Vue airplane widget. Reactive so the host re-renders
// without re-mounting the Three.js model.
const attitude = ref({ roll: 0, pitch: 0, yaw: 0 });
let airplaneApp = null;

const AttitudeHost = {
    render: () =>
        h(MapAirplane, {
            roll: attitude.value.roll,
            pitch: attitude.value.pitch,
            yaw: attitude.value.yaw,
        }),
};

function mountAirplane() {
    const mapGrapher = graphStore.mapGrapher;
    const mountEl = document.getElementById("mapAirplaneMount");
    if (!mapGrapher || !mountEl || airplaneApp) return;

    airplaneApp = createApp(AttitudeHost);
    airplaneApp.mount(mountEl);

    mapGrapher.onAirplaneAttitude = (a) => {
        attitude.value = a;
    };
}

function unmountAirplane() {
    if (airplaneApp) {
        airplaneApp.unmount();
        airplaneApp = null;
    }
    if (graphStore.mapGrapher) {
        graphStore.mapGrapher.onAirplaneAttitude = null;
    }
}

// The map (and its controls) are created asynchronously in main.js, so the mount
// point may not exist yet. Poll briefly until it appears.
let pollTimer = null;
function tryMount() {
    if (!graphStore.hasMap) return;
    if (document.getElementById("mapAirplaneMount")) {
        mountAirplane();
    } else if (pollTimer === null) {
        pollTimer = setInterval(() => {
            if (document.getElementById("mapAirplaneMount")) {
                mountAirplane();
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }, 200);
    }
}

graphStore.$subscribe(tryMount);
// In case the map is already initialized by the time this component mounts.
tryMount();

onBeforeUnmount(() => {
    if (pollTimer) clearInterval(pollTimer);
    unmountAirplane();
});
</script>
