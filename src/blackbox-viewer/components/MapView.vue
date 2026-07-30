<template>
    <div v-show="graphStore.hasMap" ref="mapContainer" class="absolute inset-0"></div>
</template>

<script setup>
import { useGraphStore } from "../stores/graph.js";

const graphStore = useGraphStore();

// Expose container for legacy MapGrapher
defineExpose({});
</script>
