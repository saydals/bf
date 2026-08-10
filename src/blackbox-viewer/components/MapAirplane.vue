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
    // Throttle 0..1; drives propeller spin speed.
    throttle: { type: Number, default: 0 },
});

const wrapper = ref(null);
const canvas = ref(null);

let renderer = null;
let scene = null;
let camera = null;
let modelWrapper = null;
let model = null;
let rafId = null;
let propellerNodes = [];
let propAngle = 0;
let lastFrameTs = 0;

// Latest attitude received before the model finished loading, so the first
// real frame isn't lost (and the model doesn't get stuck pointing north).
let pendingAttitude = { roll: 0, pitch: 0, yaw: 0 };

function canUseWebGL() {
    const detector = document.createElement("canvas");
    return window.WebGLRenderingContext && (detector.getContext("webgl") || detector.getContext("experimental-webgl"));
}

function getSize() {
    const el = wrapper.value;
    return { width: el.clientWidth || 120, height: el.clientHeight || 120 };
}

function resize() {
    if (!renderer || !camera) return;
    const { width, height } = getSize();
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
}

function render() {
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
}

// Identify propeller meshes. In airplane.gltf the propellers are the two "Cylinder"
// nodes (Cylinder_0 front, Cylinder001_3 rear) holding the blade sub-meshes.
// We match by that name prefix and exclude the unrelated "Circle" node.
function findPropellerNodes(root) {
    const found = [];
    root.traverse((o) => {
        const name = (o.name || "").toLowerCase();
        if (/^cylinder/.test(name)) {
            found.push(o);
        }
    });
    return found;
}

// Continuous render loop so the propeller can spin regardless of attitude changes.
function animate(ts) {
    rafId = requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;

    const dt = lastFrameTs ? (ts - lastFrameTs) / 1000 : 0;
    lastFrameTs = ts;

    // Spin speed scales with throttle (rad/s). Idle tick even at zero so it reads "alive".
    const maxRpm = 40; // rad/s at full throttle
    const speed = 2 + props.throttle * maxRpm;
    propAngle += speed * dt;
    for (const p of propellerNodes) {
        p.rotation.z = propAngle;
    }

    renderer.render(scene, camera);
}

function applyAttitudeFrom(a) {
    if (!model) return;
    model.rotation.x = a.pitch * -1;
    modelWrapper.rotation.y = a.yaw * -1;
    model.rotation.z = a.roll * -1;
}

function applyAttitude() {
    applyAttitudeFrom(pendingAttitude);
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
    camera.position.z = 135;

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
            // Apply whatever attitude we already received (or the latest) now.
            applyAttitudeFrom(pendingAttitude);

            // Identify propeller nodes for spinning. The airplane.gltf uses generic
            // names (Cylinder/Circle), so match by shape-name heuristics.
            propellerNodes = findPropellerNodes(model);
            console.log(
                "MapAirplane: propeller candidate nodes =",
                propellerNodes.map((n) => n.name || n.type),
            );

            // Start the render loop so the propeller spins.
            lastFrameTs = 0;
            rafId = requestAnimationFrame(animate);
        },
        undefined,
        (err) => console.error("MapAirplane: failed to load airplane.gltf", err),
    );
}

function dispose() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    propellerNodes = [];
    if (renderer && renderer.dispose) renderer.dispose();
    renderer = null;
    scene = null;
    camera = null;
    modelWrapper = null;
    model = null;
}

let resizeObserver = null;

onMounted(() => {
    init();
    if (typeof ResizeObserver !== "undefined" && wrapper.value) {
        resizeObserver = new ResizeObserver(() => resize());
        resizeObserver.observe(wrapper.value);
    }
});

onBeforeUnmount(() => {
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    dispose();
});

watch(
    () => [props.roll, props.pitch, props.yaw],
    () => {
        pendingAttitude = {
            roll: props.roll,
            pitch: props.pitch,
            yaw: props.yaw,
        };
        applyAttitudeFrom(pendingAttitude);
    },
);
</script>
