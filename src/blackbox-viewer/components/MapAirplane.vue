<template>
    <div ref="wrapper" class="map-airplane-wrapper">
        <canvas ref="canvas" class="map-airplane-canvas"></canvas>
    </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CanvasRenderer } from "../../js/utils/three/CanvasRenderer";

const props = defineProps({
    // Attitude in radians: roll, pitch, yaw (already yaw-corrected by the grapher).
    roll: { type: Number, default: 0 },
    pitch: { type: Number, default: 0 },
    yaw: { type: Number, default: 0 },
});

const wrapper = ref(null);
const canvas = ref(null);

let renderer = null;
let scene = null;
let camera = null;
let modelWrapper = null;
let model = null;
let rafId = null;

function canUseWebGL() {
    const detector = document.createElement("canvas");
    return window.WebGLRenderingContext && (detector.getContext("webgl") || detector.getContext("experimental-webgl"));
}

function getSize() {
    const el = wrapper.value;
    return { width: el.clientWidth || 75, height: el.clientHeight || 75 };
}

function render() {
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
}

function applyAttitude() {
    if (!model) return;
    model.rotation.x = props.pitch * -1;
    modelWrapper.rotation.y = props.yaw * -1;
    model.rotation.z = props.roll * -1;
    render();
}

function init() {
    const { width, height } = getSize();

    renderer = canUseWebGL()
        ? new THREE.WebGLRenderer({ canvas: canvas.value, alpha: true, antialias: true })
        : new CanvasRenderer({ canvas: canvas.value, alpha: true });
    renderer.setSize(width, height);

    scene = new THREE.Scene();
    modelWrapper = new THREE.Object3D();

    camera = new THREE.PerspectiveCamera(60, width / height, 1, 10000);
    camera.position.z = 125;

    const light = new THREE.AmbientLight(0x404040);
    const light2 = new THREE.DirectionalLight(new THREE.Color(1, 1, 1), 1.5);
    light2.position.set(0, 1, 0);

    scene.add(light);
    scene.add(light2);
    scene.add(camera);
    scene.add(modelWrapper);

    const loader = new GLTFLoader();
    loader.load(
        "./resources/models/airplane.gltf",
        (gltf) => {
            model = gltf.scene;
            model.scale.set(15, 15, 15);
            modelWrapper.add(model);
            scene.add(modelWrapper);
            applyAttitude();
        },
        undefined,
        (err) => console.error("MapAirplane: failed to load airplane.gltf", err),
    );
}

function dispose() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (renderer && renderer.dispose) renderer.dispose();
    renderer = null;
    scene = null;
    camera = null;
    modelWrapper = null;
    model = null;
}

onMounted(() => {
    init();
});

onBeforeUnmount(() => {
    dispose();
});

watch(() => [props.roll, props.pitch, props.yaw], applyAttitude);
</script>
