<template>
    <BaseTab tab-name="blackbox_viewer" extra-class="tab-blackbox-viewer-host">
        <!-- Sub-tab strip: the classic 2D log viewer and the new 3D replay. -->
        <div class="b3d-subtabs">
            <button class="b3d-subtab" :class="{ active: view === 'viewer' }" @click="view = 'viewer'">
                {{ t("tabBlackboxViewer") }}
            </button>
            <button
                class="b3d-subtab"
                :class="{ active: view === '3d' }"
                :disabled="!hasLog"
                :title="hasLog ? '' : t('tabBlackbox3DDisabled')"
                @click="onShow3D"
            >
                {{ t("tabBlackbox3D") }}
            </button>
        </div>

        <!-- Vendored blackbox-log-viewer scaffold. The viewer's Vue app mounts into
             #vue-app and teleports its UI into the divs below; the legacy bootstrap wires
             the canvases by id. All styling is scoped under .blackbox-viewer-root. -->
        <div v-show="view === 'viewer'" ref="rootRef" class="blackbox-viewer-root">
            <div id="vue-welcome"></div>
            <div id="vue-navbar" class="app-navbar" style="z-index: 100"></div>

            <div class="app-main-pane">
                <div class="video-top-controls pl-0">
                    <div id="vue-view-controls" style="display: contents"></div>
                    <div id="vue-playback" style="display: contents"></div>
                    <div id="vue-speed-panel" style="display: contents"></div>
                    <div id="vue-zoom-panel" style="display: contents"></div>
                    <div id="vue-time-panel" style="display: contents"></div>
                    <div id="vue-sync-panel" style="display: contents"></div>
                    <div id="vue-workspace-panel" style="display: contents"></div>
                    <div id="vue-log-panel" style="display: contents"></div>
                </div>
                <div id="screenshot-frame" class="graph-row">
                    <div id="log-graph" class="log-graph">
                        <video id="logVideo"></video>
                        <canvas width="200" height="100" id="graphCanvas"></canvas>
                        <canvas width="0" height="0" id="craftCanvas"></canvas>
                        <div id="vue-analyser" style="display: contents"></div>
                        <div id="mapContainer" class="map-container"></div>
                        <canvas width="0" height="0" id="stickCanvas"></canvas>
                    </div>
                    <div id="vue-legend-panel" style="display: contents"></div>
                    <div id="mouseNotification" class="mouseNotification"></div>
                </div>
            </div>

            <div id="log-seek-bar" class="log-seek-bar">
                <canvas id="seekbarCanvas" width="200" height="100"></canvas>
                <div id="vue-seekbar-toolbar" style="display: contents"></div>
            </div>

            <div id="vue-statusbar" class="vue-statusbar"></div>

            <!-- Mount point for the viewer's Vue app -->
            <div id="vue-app"></div>
        </div>

        <div v-show="view === '3d'" class="blackbox-3d-host">
            <Blackbox3DReplay v-if="view === '3d'" />
        </div>
    </BaseTab>
</template>

<script setup>
import { nextTick, onMounted, onBeforeUnmount, ref, h, createApp } from "vue";
import BaseTab from "./BaseTab.vue";
import GUI from "../../js/gui";
import { initBlackboxViewer, destroyBlackboxViewer, setBlackboxViewerDark } from "../../blackbox-viewer/vue_init.js";
import { useDataflashPull } from "../../composables/useDataflashPull";
import pinia from "../../blackbox-viewer/pinia_instance.js";
import { useGraphStore } from "../../blackbox-viewer/stores/graph.js";
import { useLogStore } from "../../blackbox-viewer/stores/log.js";
import { i18n } from "../../js/localization";
import MapAirplane from "../../blackbox-viewer/components/MapAirplane.vue";
import Blackbox3DReplay from "./Blackbox3DReplay.vue";

const rootRef = ref(null);
let themeObserver = null;
let airplaneApp = null;
let airplanePoll = null;
const dataflash = useDataflashPull();
const graphStore = useGraphStore(pinia);
const logStore = useLogStore(pinia);
const hasLog = logStore.hasLog;

// Sub-tab selection between the classic 2D viewer and the new 3D replay.
const view = ref("viewer");
function t(key) {
    return i18n.getMessage(key);
}
function onShow3D() {
    if (!hasLog.value) return;
    view.value = "3d";
}

// The configurator drives dark mode by toggling `.dark` on <html>; mirror it into the viewer.
function hostIsDark() {
    return document.documentElement.classList.contains("dark");
}

// Mount the airplane attitude widget into the Leaflet control's mount point
// (#mapAirplaneMount), which is created asynchronously when the map initializes.
const attitude = ref({ roll: 0, pitch: 0, yaw: 0, throttle: 0 });
const AttitudeHost = {
    render: () =>
        h(MapAirplane, {
            roll: attitude.value.roll,
            pitch: attitude.value.pitch,
            yaw: attitude.value.yaw,
            throttle: attitude.value.throttle,
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

    // Push the current frame's attitude immediately so the model doesn't start
    // pointing north before the first playback tick.
    if (typeof mapGrapher.setCurrentTime === "function") {
        mapGrapher.setCurrentTime(mapGrapher.getCurrentTime());
    }
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

onMounted(async () => {
    // Scaffold DOM is in place; mount the viewer into it.
    await nextTick();
    initBlackboxViewer(rootRef.value, { dataflash });
    setBlackboxViewerDark(hostIsDark());

    // Keep the viewer theme in sync if the host theme changes while the tab is open.
    themeObserver = new MutationObserver(() => setBlackboxViewerDark(hostIsDark()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    // The map (and its airplane mount point) initializes on demand; poll until present.
    if (document.getElementById("mapAirplaneMount")) {
        mountAirplane();
    } else {
        airplanePoll = setInterval(() => {
            if (document.getElementById("mapAirplaneMount")) {
                mountAirplane();
                clearInterval(airplanePoll);
                airplanePoll = null;
            }
        }, 200);
    }

    GUI.content_ready();
});

onBeforeUnmount(() => {
    themeObserver?.disconnect();
    themeObserver = null;
    if (airplanePoll) clearInterval(airplanePoll);
    unmountAirplane();
    destroyBlackboxViewer();
});
</script>

<style scoped>
.tab-blackbox-viewer-host {
    height: 100%;
    display: flex;
    flex-direction: column;
}

.b3d-subtabs {
    display: flex;
    gap: 4px;
    padding: 6px 10px;
    background: var(--bb-subtab-bg, rgba(20, 24, 30, 0.9));
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex: 0 0 auto;
    z-index: 30;
}
.b3d-subtab {
    background: transparent;
    color: #cfe8ff;
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
}
.b3d-subtab:hover:not(:disabled) {
    border-color: #2db0e3;
}
.b3d-subtab.active {
    background: #2db0e3;
    color: #fff;
    border-color: #2db0e3;
}
.b3d-subtab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.blackbox-viewer-root {
    position: relative;
    flex: 1 1 auto;
    width: 100%;
    overflow: hidden;
    /* The vendored viewer was a full-page app and lays out with position: fixed. A transform
       on this root makes those fixed descendants resolve against the tab pane instead of the
       window, so the viewer stays inside the content area and never covers the sidebar. */
    transform: translateZ(0);
}

.blackbox-3d-host {
    flex: 1 1 auto;
    width: 100%;
    overflow: hidden;
}
</style>
