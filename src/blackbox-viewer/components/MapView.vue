<template>
    <div v-show="graphStore.hasMap" ref="mapContainer" class="absolute inset-0">
        <div class="map-controls">
            <button
                type="button"
                :class="{ active: layer === 'street' }"
                :aria-label="$t('mapLayerStreet')"
                @click="setLayer('street')"
            >
                R
            </button>
            <button
                type="button"
                :class="{ active: layer === 'satellite' }"
                :aria-label="$t('mapLayerSatellite')"
                @click="setLayer('satellite')"
            >
                S
            </button>
            <button
                type="button"
                :class="{ active: layer === 'hybrid' }"
                :aria-label="$t('mapLayerHybrid')"
                @click="setLayer('hybrid')"
            >
                H
            </button>
            <button type="button" :aria-label="$t('mapZoomHome')" @click="zoomHome">&#x1F3E0;</button>
            <button type="button" :aria-label="$t('mapFullscreen')" @click="toggleFullscreen">&#x26F6;</button>
        </div>
    </div>
</template>

<script setup>
import { ref } from "vue";
import { useGraphStore } from "../stores/graph.js";

const graphStore = useGraphStore();
const mapContainer = ref(null);
const layer = ref("street");

function setLayer(layerKey) {
    layer.value = layerKey;
    graphStore.mapGrapher?.setLayer(layerKey);
}
function zoomHome() {
    graphStore.mapGrapher?.zoomHome();
}
function toggleFullscreen() {
    graphStore.mapGrapher?.toggleFullscreen();
}

// Expose container for legacy MapGrapher
defineExpose({
    mapContainer,
});
</script>

<style scoped>
.map-controls {
    position: absolute;
    bottom: 8px;
    left: 8px;
    display: flex;
    gap: 4px;
    z-index: 1000;
}

.map-controls button {
    width: 28px;
    height: 28px;
    border: 1px solid var(--surface-300);
    border-radius: 4px;
    background: var(--surface-100);
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms ease;
}

.map-controls button:hover {
    background: var(--surface-200);
}

.map-controls button.active {
    background: var(--primary);
    color: var(--text-inverted);
    border-color: var(--primary);
}
</style>
