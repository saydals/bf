<template>
    <BaseTab tab-name="blackbox_3d" extra-class="tab-blackbox-3d-host">
        <div ref="rootRef" class="blackbox-3d-replay">
            <div id="toolbar" class="b3d-toolbar">
                <button id="b3dReplayBtn" class="b3d-btn" :disabled="!hasLog" @click="onReplay">
                    {{ replayLabel }}
                </button>
                <button class="b3d-btn" @click="onResetView">Reset View</button>
                <button class="b3d-btn" @click="onFullScreen">Full Screen</button>
                <button class="b3d-btn" @click="onYaw">Heading 90</button>
                <button class="b3d-btn" @click="onOpenFile">Load BBL</button>
                <span id="b3dStatus" class="b3d-status">{{ status }}</span>
            </div>

            <input
                ref="fileInputRef"
                type="file"
                accept=".bbl,.txt,.log,.csv"
                class="b3d-hidden-file"
                @change="onFilePicked"
            />

            <div id="seekWrap" class="b3d-seek">
                <button class="b3d-btn" :disabled="!hasLog" @click="onTogglePlay">{{ playing ? "⏸" : "▶" }}</button>
                <input
                    id="b3dSeek"
                    ref="seekRef"
                    class="b3d-seek-input"
                    type="range"
                    min="0"
                    max="1000"
                    value="0"
                    :disabled="!hasLog"
                    @input="onSeek"
                />
                <span id="b3dTime" class="b3d-time">{{ timeLabel }}</span>
            </div>

            <div id="b3dDrop" class="b3d-drop">Drop a log here</div>

            <div id="b3dHud" class="b3d-hud">
                <div>Altitude (relative): <span id="b3dAltRel">0.0</span> m</div>
                <div>Altitude (ASL): <span id="b3dAltAsl">0.0</span> m</div>
                <div>Dist to home: <span id="b3dHome">0</span> m</div>
                <div>Position: <span id="b3dPos">0, 0</span></div>
                <div>Mode: <span id="b3dMode" class="b3d-mode">Manual</span></div>
                <div class="b3d-file">Log: <span id="b3dFile">—</span></div>
            </div>

            <div v-if="!hasLog" class="b3d-empty">
                <p>Load a blackbox log (.bbl) to replay the flight in 3D.</p>
                <button class="b3d-btn b3d-btn--load" @click="onOpenFile">Open BBL Log</button>
            </div>
        </div>
    </BaseTab>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import BaseTab from "./BaseTab.vue";
import { useLogStore } from "../../blackbox-viewer/stores/log.js";
import { FlightLog } from "../../blackbox-viewer/flightlog.js";
import { buildReplayDataFromFlightLog } from "../../blackbox-viewer/blackbox3d_adapter.js";

const rootRef = ref(null);
const seekRef = ref(null);
const fileInputRef = ref(null);
const localLog = ref(null);
const loadedFile = ref("—");
const logStore = useLogStore();

// The 3D replay is self-contained: it works from its own loaded .bbl, but also
// reuses a log already loaded in the Blackbox Viewer if present.
const hasLog = computed(() => !!localLog.value || logStore.hasLog);

function ensureActiveLog() {
    if (localLog.value) {
        logStore.flightLog = localLog.value;
        logStore.hasLog = true;
        return localLog.value;
    }
    return logStore.flightLog;
}

const status = ref("Load a blackbox log, then press Replay");
const timeLabel = ref("0.0s");
const playing = ref(false);
const replayLabel = ref("▶ Replay");

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
let scene, camera, renderer, controls;
let airplane = null;
let propellers = [];
let propAngle = 0;
let lastTs = 0;
let yawOffset = Math.PI / 2;
let camTargetY = 2;
const CAM_HOME = new THREE.Vector3(0, 25, 55);

// playback state
let frames = [];
let startTime = 0,
    endTime = 0;
let homeLat = null,
    homeLon = null,
    homeAsl = 0;
let hasGps = false;
let playingFlag = false;
let playT = 0;
let lastPlayWall = 0;
let sourceRows = [];
let gpsFixes = [];
const PLAYBACK_HZ = 50;
const PLAYBACK_STEP_US = 1e6 / PLAYBACK_HZ;

// HUD elements (kept as refs for fast updates)
let hudAltRel, hudAltAsl, hudHome, hudPos, hudMode, hudFile;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
function buildEnvironment() {
    const GROUND_SIZE = 600;
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
        new THREE.MeshStandardMaterial({ color: 0x5a9e3f }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const runway = new THREE.Mesh(
        new THREE.BoxGeometry(12, 0.2, 160),
        new THREE.MeshStandardMaterial({ color: 0x33363b }),
    );
    runway.position.set(0, 0.1, 0);
    runway.receiveShadow = true;
    scene.add(runway);
    for (let z = -70; z <= 70; z += 14) {
        const dash = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 0.05, 5),
            new THREE.MeshStandardMaterial({ color: 0xffffff }),
        );
        dash.position.set(0, 0.22, z);
        scene.add(dash);
    }

    const rand = (a, b) => a + Math.random() * (b - a);
    const treeGroup = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32 });
    for (let i = 0; i < 80; i++) {
        const x = rand(-280, 280),
            z = rand(-280, 280);
        if (Math.abs(x) < 18 && Math.abs(z) < 175) continue;
        const t = new THREE.Group();
        const h = rand(7, 10);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, h, 6), trunkMat);
        trunk.position.y = h / 2;
        trunk.castShadow = true;
        const leaves = new THREE.Mesh(new THREE.SphereGeometry(rand(2.2, 3.6), 8, 6), leafMat);
        leaves.position.y = h + 1.2;
        leaves.castShadow = true;
        t.add(trunk);
        t.add(leaves);
        t.position.set(x, 0, z);
        treeGroup.add(t);
    }
    scene.add(treeGroup);

    const flowerColors = [0xff5d8f, 0xffd166, 0x9b5de5, 0xffffff, 0xf15bb5];
    const flowerGeo = new THREE.SphereGeometry(0.35, 6, 5);
    for (let i = 0; i < 240; i++) {
        const x = rand(-290, 290),
            z = rand(-290, 290);
        if (Math.abs(x) < 14 && Math.abs(z) < 170) continue;
        const f = new THREE.Mesh(
            flowerGeo,
            new THREE.MeshStandardMaterial({
                color: flowerColors[(Math.random() * flowerColors.length) | 0],
            }),
        );
        f.position.set(x, 0.35, z);
        scene.add(f);
    }
}

// ---------------------------------------------------------------------------
// Airplane (loaded from the program's resources/models/airplane.gltf)
// ---------------------------------------------------------------------------
function loadAirplane() {
    if (airplane) {
        scene.remove(airplane);
        airplane.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
    }
    airplane = null;
    propellers = [];

    const loader = new GLTFLoader();
    loader.load(
        "./resources/models/airplane.gltf",
        (gltf) => {
            airplane = gltf.scene;
            airplane.scale.set(0.75, 0.75, 0.75);
            airplane.traverse((o) => {
                if (o.isMesh) o.castShadow = true;
                const name = (o.name || "").toLowerCase();
                if (/^cylinder/.test(name)) propellers.push(o);
            });
            airplane.position.y = 4;
            scene.add(airplane);
        },
        undefined,
        (err) => {
            console.error("airplane load failed", err);
            status.value = "Failed to load airplane model";
        },
    );
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------
let markersGroup = null;
function makeTextSprite(text, color, heightM) {
    const pad = 24,
        fontPx = 96;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = fontPx + pad * 2;
    canvas.width = w;
    canvas.height = h;
    ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const sprite = new THREE.Sprite(mat);
    const aspect = w / h;
    sprite.scale.set(heightM * aspect, heightM, 1);
    return sprite;
}
function clearMarkers() {
    if (markersGroup) {
        scene.remove(markersGroup);
        markersGroup.traverse((o) => {
            if (o.material) {
                if (o.material.map) o.material.map.dispose();
                o.material.dispose();
            }
            if (o.geometry) o.geometry.dispose();
        });
    }
    markersGroup = new THREE.Group();
    scene.add(markersGroup);
}
function degToMeters(lat, lon) {
    const dLat = (lat - homeLat) * 111320;
    const dLon = (lon - homeLon) * 111320 * Math.cos((homeLat * Math.PI) / 180);
    return { x: dLon, z: -dLat };
}
let abMarker = { a: null, b: null };
let abFirstSeen = { a: null, b: null };
function buildMarkers(data) {
    clearMarkers();
    abMarker = { a: null, b: null };
    abFirstSeen = { a: null, b: null };
    const { out, wpLat, wpLon, wpAlt, iALat, iALon, iBLat, iBLon } = data;
    const num = (vals, k) => {
        if (k < 0) return null;
        const v = parseFloat(vals[k]);
        return Number.isNaN(v) ? null : v;
    };
    const toAltM = (cm) => (cm == null ? 0 : cm / 100);
    const addMarker = (latDeg, lonDeg, text, color, heightM, altCm) => {
        const m = degToMeters(latDeg, lonDeg);
        const sprite = makeTextSprite(text, color, heightM);
        sprite.position.set(m.x, toAltM(altCm) + heightM * 0.6, m.z);
        markersGroup.add(sprite);
        return sprite;
    };
    const wpDrawn = new Set();
    for (const row of out) {
        const vals = row._raw;
        if (!vals) continue;
        for (let i = 0; i < 15; i++) {
            if (wpDrawn.has(i)) continue;
            const lat = num(vals, wpLat[i]),
                lon = num(vals, wpLon[i]);
            if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
                const altCm = num(vals, wpAlt[i]);
                addMarker(lat / 1e7, lon / 1e7, String(i), "#ffd166", 4, altCm);
                wpDrawn.add(i);
            }
        }
        if (wpDrawn.size === 15) break;
    }
    for (const row of out) {
        const vals = row._raw;
        if (!vals) continue;
        const aLat = num(vals, iALat),
            aLon = num(vals, iALon);
        if (abFirstSeen.a === null) abFirstSeen.a = { latDeg: 0, lonDeg: 0 };
        if (aLat != null && aLat !== 0) abFirstSeen.a.latDeg = aLat / 1e7;
        if (aLon != null && aLon !== 0) abFirstSeen.a.lonDeg = aLon / 1e7;
        const bLat = num(vals, iBLat),
            bLon = num(vals, iBLon);
        if (abFirstSeen.b === null) abFirstSeen.b = { latDeg: 0, lonDeg: 0 };
        if (bLat != null && bLat !== 0) abFirstSeen.b.latDeg = bLat / 1e7;
        if (bLon != null && bLon !== 0) abFirstSeen.b.lonDeg = bLon / 1e7;
    }
    return wpDrawn.size + (abFirstSeen.a ? 1 : 0) + (abFirstSeen.b ? 1 : 0);
}
function updateABMarkers(fr) {
    if (!fr) return;
    for (const point of ["a", "b"]) {
        const seen = abFirstSeen[point];
        if (!seen) continue;
        const altCm = point === "a" ? fr.aAlt || 0 : fr.bAlt || 0;
        let entry = abMarker[point];
        if (!entry) {
            const m = degToMeters(seen.latDeg, seen.lonDeg);
            const sprite = makeTextSprite(point.toUpperCase(), "#ff3b3b", 5);
            sprite.position.set(m.x, 0, m.z);
            sprite.visible = altCm !== 0;
            markersGroup.add(sprite);
            entry = abMarker[point] = { sprite, latDeg: seen.latDeg, lonDeg: seen.lonDeg };
        }
        entry.sprite.visible = altCm !== 0;
        const m = degToMeters(seen.latDeg, seen.lonDeg);
        entry.sprite.position.set(m.x, altCm / 100 + 5 * 0.6, m.z);
    }
}
// ---------------------------------------------------------------------------
// Frame building (from adapted FlightLog data)
// ---------------------------------------------------------------------------
function validGpsRow(row) {
    return row.lat != null && row.lon != null && Number.isFinite(row.lat) && Number.isFinite(row.lon);
}
function shortestAngleDiff(target, current) {
    let d = (target - current) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}
function interpolateRowsAt(rows, t) {
    if (!rows.length) return null;
    if (t <= rows[0].t) return rows[0];
    if (t >= rows[rows.length - 1].t) return rows[rows.length - 1];
    let lo = 0,
        hi = rows.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].t < t) lo = mid;
        else hi = mid;
    }
    const a = rows[lo],
        b = rows[hi];
    const f = (t - a.t) / (b.t - a.t || 1);
    return {
        t,
        roll: a.roll + shortestAngleDiff(b.roll, a.roll) * f,
        pitch: a.pitch + shortestAngleDiff(b.pitch, a.pitch) * f,
        yaw: a.yaw + shortestAngleDiff(b.yaw, a.yaw) * f,
        throttle: a.throttle + (b.throttle - a.throttle) * f,
        velN: a.velN + (b.velN - a.velN) * f,
        velE: a.velE + (b.velE - a.velE) * f,
        baroAlt: a.baroAlt + (b.baroAlt - a.baroAlt) * f,
        gpsAlt: a.gpsAlt + (b.gpsAlt - a.gpsAlt) * f,
    };
}
function interpolateGpsAt(t) {
    if (!gpsFixes.length) return null;
    if (t <= gpsFixes[0].t) return gpsFixes[0];
    if (t >= gpsFixes[gpsFixes.length - 1].t) return gpsFixes[gpsFixes.length - 1];
    let lo = 0,
        hi = gpsFixes.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (gpsFixes[mid].t < t) lo = mid;
        else hi = mid;
    }
    const a = gpsFixes[lo],
        b = gpsFixes[hi];
    const f = (t - a.t) / (b.t - a.t || 1);
    return {
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        gpsAlt: a.gpsAlt + (b.gpsAlt - a.gpsAlt) * f,
    };
}
function buildFrames(data) {
    const { out, iAAlt, iBAlt, iMode } = data;
    sourceRows = out.slice().sort((a, b) => a.t - b.t);

    const rawAbAt = (t, k) => {
        if (k < 0 || !sourceRows.length) return 0;
        let lo = 0,
            hi = sourceRows.length - 1;
        if (t <= sourceRows[0].t) lo = hi = 0;
        else if (t >= sourceRows[hi].t) lo = hi = hi;
        else {
            while (hi - lo > 1) {
                const m = (lo + hi) >> 1;
                if (sourceRows[m].t < t) lo = m;
                else hi = m;
            }
        }
        const pick = (i) => {
            const v = sourceRows[i]._raw ? parseFloat(sourceRows[i]._raw[k]) : NaN;
            return Number.isNaN(v) ? 0 : v;
        };
        const a = pick(lo),
            b = pick(hi);
        const f = (t - sourceRows[lo].t) / (sourceRows[hi].t - sourceRows[lo].t || 1);
        return a + (b - a) * (hi === lo ? 0 : f);
    };
    frames = [];
    hasGps = sourceRows.some(validGpsRow);

    const rawModeAt = (t) => {
        if (iMode < 0 || !sourceRows.length) return 0;
        let lo = 0,
            hi = sourceRows.length - 1;
        if (t <= sourceRows[0].t) lo = hi = 0;
        else if (t >= sourceRows[hi].t) lo = hi = hi;
        else {
            while (hi - lo > 1) {
                const m = (lo + hi) >> 1;
                if (sourceRows[m].t < t) lo = m;
                else hi = m;
            }
        }
        const pick = (i) => {
            const raw = sourceRows[i]._raw ? String(sourceRows[i]._raw[iMode] ?? "").trim() : "";
            if (!raw || raw === "NaN") return 0;
            const v = /^0x/i.test(raw) ? parseInt(raw, 16) : parseFloat(raw);
            return Number.isNaN(v) ? 0 : v | 0;
        };
        return pick(lo);
    };

    gpsFixes = [];
    for (const row of sourceRows) {
        if (!validGpsRow(row)) continue;
        const previous = gpsFixes[gpsFixes.length - 1];
        if (!previous || row.lat !== previous.lat || row.lon !== previous.lon || row.gpsAlt !== previous.gpsAlt) {
            gpsFixes.push({ t: row.t, lat: row.lat, lon: row.lon, gpsAlt: row.gpsAlt ?? 0 });
        }
    }

    const first = gpsFixes[0];
    if (first) {
        homeLat = first.lat / 1e7;
        homeLon = first.lon / 1e7;
    }
    const firstAsl = gpsFixes.find((f) => Number.isFinite(f.gpsAlt) && f.gpsAlt !== 0);
    homeAsl = firstAsl ? firstAsl.gpsAlt / 10 : 0;

    const firstTime = sourceRows[0]?.t ?? 0;
    const lastTime = sourceRows[sourceRows.length - 1]?.t ?? firstTime;
    startTime = firstTime;
    endTime = lastTime;

    for (let t = startTime; t <= endTime + 0.5; t += PLAYBACK_STEP_US) {
        const row = interpolateRowsAt(sourceRows, Math.min(t, endTime));
        if (!row) continue;
        const gps = interpolateGpsAt(Math.min(t, endTime));
        const gpsAltM = gps ? (gps.gpsAlt || 0) / 10 : (row.gpsAlt || 0) / 10;
        const lat = gps ? gps.lat / 1e7 : homeLat;
        const lon = gps ? gps.lon / 1e7 : homeLon;
        const dLat = (lat - homeLat) * 111320;
        const dLon = (lon - homeLon) * 111320 * Math.cos((homeLat * Math.PI) / 180);
        frames.push({
            t: Math.min(t, endTime),
            x: dLon,
            z: -dLat,
            alt: gpsAltM - homeAsl,
            roll: row.roll,
            pitch: row.pitch,
            yaw: row.yaw,
            throttle: row.throttle,
            vx: row.velE,
            vz: -row.velN,
            baroAltM: gpsAltM,
            gpsAltM,
            aAlt: rawAbAt(Math.min(t, endTime), iAAlt),
            bAlt: rawAbAt(Math.min(t, endTime), iBAlt),
            mode: rawModeAt(Math.min(t, endTime)),
        });
    }
    if (frames.length) {
        startTime = frames[0].t;
        endTime = frames[frames.length - 1].t;
    }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
function frameAt(t) {
    if (!frames.length) return null;
    if (t <= frames[0].t) return frames[0];
    if (t >= frames[frames.length - 1].t) return frames[frames.length - 1];
    let lo = 0,
        hi = frames.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].t < t) lo = mid;
        else hi = mid;
    }
    const a = frames[lo],
        b = frames[hi];
    const f = (t - a.t) / (b.t - a.t || 1);
    return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        roll: a.roll + shortestAngleDiff(b.roll, a.roll) * f,
        pitch: a.pitch + shortestAngleDiff(b.pitch, a.pitch) * f,
        yaw: a.yaw + shortestAngleDiff(b.yaw, a.yaw) * f,
        throttle: a.throttle + (b.throttle - a.throttle) * f,
        alt: a.alt + (b.alt - a.alt) * f,
        baroAltM: a.baroAltM + (b.baroAltM - a.baroAltM) * f,
        gpsAltM: a.gpsAltM + (b.gpsAltM - a.gpsAltM) * f,
        aAlt: a.aAlt + (b.aAlt - a.aAlt) * f,
        bAlt: a.bAlt + (b.bAlt - a.bAlt) * f,
        mode: a.mode,
    };
}

// ---------------------------------------------------------------------------
// Contrail
// ---------------------------------------------------------------------------
const WING_HALF_SPAN = 2.2;
const CONTRAIL_COUNT = 120;
const CONTRAIL_LIFE = 3.6;
const CONTRAIL_SIZE = 0.6;
const contrailGroup = new THREE.Group();
const contrailLeft = [];
const contrailRight = [];
let contrailAccum = 0;
function spawnContrail(worldPos, side) {
    const pool = side === "left" ? contrailLeft : contrailRight;
    const geom = new THREE.PlaneGeometry(CONTRAIL_SIZE, CONTRAIL_SIZE);
    const mat = new THREE.MeshBasicMaterial({
        color: contrailGroup.userData.color || 0xffffff,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const sprite = new THREE.Mesh(geom, mat);
    sprite.position.copy(worldPos);
    sprite.lookAt(camera.position);
    sprite.userData.life = CONTRAIL_LIFE;
    sprite.userData.maxLife = CONTRAIL_LIFE;
    contrailGroup.add(sprite);
    pool.push(sprite);
}
function updateContrail(dt, color) {
    contrailAccum += dt;
    for (const side of ["left", "right"]) {
        const pool = side === "left" ? contrailLeft : contrailRight;
        for (let i = pool.length - 1; i >= 0; i--) {
            const p = pool[i];
            p.userData.life -= dt;
            p.material.opacity = Math.max(0, p.userData.life / p.userData.maxLife) * 0.7;
            p.scale.setScalar(Math.max(0.01, p.userData.life / p.userData.maxLife));
            if (p.userData.life <= 0) {
                contrailGroup.remove(p);
                p.geometry.dispose();
                p.material.dispose();
                pool.splice(i, 1);
            }
        }
    }
    for (const side of ["left", "right"]) {
        const pool = side === "left" ? contrailLeft : contrailRight;
        while (pool.length > CONTRAIL_COUNT) {
            const old = pool.shift();
            contrailGroup.remove(old);
            old.geometry.dispose();
            old.material.dispose();
        }
    }
    contrailGroup.userData.color = color;
}
function setContrailColor(fr) {
    const mode = fr && fr.mode != null ? fr.mode | 0 : 0;
    const isAuto = (mode & ~1) !== 0;
    const color = isAuto ? 0xff99cc : 0xffffff;
    if (contrailGroup.userData.color !== color) {
        contrailGroup.userData.color = color;
        for (const side of ["left", "right"]) {
            const pool = side === "left" ? contrailLeft : contrailRight;
            for (const p of pool) p.material.color.setHex(color);
        }
    }
}
function clearContrail() {
    for (const side of ["left", "right"]) {
        const pool = side === "left" ? contrailLeft : contrailRight;
        while (pool.length) {
            const p = pool.pop();
            contrailGroup.remove(p);
            p.geometry.dispose();
            p.material.dispose();
        }
    }
    contrailGroup.userData.color = null;
    contrailAccum = 0;
}

function applyFrame(fr) {
    if (!airplane || !fr) return;
    airplane.position.x = fr.x;
    airplane.position.z = fr.z;
    const altRel = (fr.alt || 0) * 1;
    airplane.position.y = altRel + 1.5;

    if (hudAltRel) hudAltRel.textContent = altRel.toFixed(1);
    if (hudAltAsl) hudAltAsl.textContent = (fr.gpsAltM || 0).toFixed(0);
    const distToHome = Math.sqrt((fr.x || 0) * (fr.x || 0) + (fr.z || 0) * (fr.z || 0));
    if (hudHome) hudHome.textContent = distToHome.toFixed(1);
    if (hudPos) hudPos.textContent = `${fr.x.toFixed(1)}, ${fr.z.toFixed(1)}`;

    const modeVal = fr && fr.mode != null ? fr.mode | 0 : 0;
    const isAuto = (modeVal & ~1) !== 0;
    if (hudMode) {
        hudMode.textContent = isAuto ? "Autopilot" : "Manual";
        hudMode.classList.toggle("b3d-mode--auto", isAuto);
    }

    airplane.rotation.order = "YXZ";
    airplane.rotation.set(fr.pitch * -1, fr.yaw * -1 + yawOffset, fr.roll * -1, "YXZ");

    updateABMarkers(fr);

    if (airplane && (fr.alt || 0) > 0.5) {
        const localLeft = new THREE.Vector3(-WING_HALF_SPAN, 0.2, 0);
        const localRight = new THREE.Vector3(WING_HALF_SPAN, 0.2, 0);
        airplane.localToWorld(localLeft);
        airplane.localToWorld(localRight);
        if (contrailAccum >= 0.075) {
            spawnContrail(localLeft, "left");
            spawnContrail(localRight, "right");
            contrailAccum = 0;
        }
        setContrailColor(fr);
    }
    updateContrail(0.016, contrailGroup.userData.color || 0xffffff);
}
function updatePropellers(dt, throttle) {
    const maxRpm = 400;
    const speed = 20 + Math.min(1, Math.max(0, throttle)) * maxRpm;
    propAngle += speed * dt;
    for (const p of propellers) p.rotation.y = propAngle;
}
function setPlaying(p) {
    playingFlag = p;
    playing.value = p;
    replayLabel.value = p ? "⏸ Pause" : "▶ Replay";
    if (p) lastPlayWall = performance.now();
}

// Reset the bottom playback controls (play button + seek bar + time) and any
// in-flight replay state when a new log is loaded.
function resetPlayback() {
    setPlaying(false);
    playT = 0;
    frames = [];
    gpsFixes = [];
    startTime = 0;
    endTime = 0;
    clearContrail();
    clearMarkers();
    if (seekRef.value) seekRef.value.value = 0;
    timeLabel.value = "0.0s";
    const fr = frameAt(playT);
    applyFrame(fr);
}

// ---------------------------------------------------------------------------
// Load from the active FlightLog
// ---------------------------------------------------------------------------
function onOpenFile() {
    fileInputRef.value?.click();
}

function onFilePicked(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const bytes = e.target.result;
            const dataArray = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const log = new FlightLog(dataArray);
            localLog.value = log;
            logStore.flightLog = log;
            logStore.flightLogDataArray = dataArray;
            logStore.hasLog = true;
            loadedFile.value = file.name;
            status.value = `Loaded ${file.name} — press Replay`;
            resetPlayback();
        } catch (err) {
            console.error(err);
            status.value = `Failed to open log: ${err.message}`;
        }
    };
    reader.readAsArrayBuffer(file);
}

function onReplay() {
    if (playingFlag) {
        setPlaying(false);
        return;
    }
    try {
        ensureActiveLog();
        const data = buildReplayDataFromFlightLog();
        const { out } = data;
        if (!out.length) throw new Error("No data rows found");
        loadAirplane();
        clearContrail();
        buildFrames(data);
        const markerCount = buildMarkers(data);
        playT = startTime;
        if (seekRef.value) seekRef.value.value = 0;
        const fr = frameAt(playT);
        applyFrame(fr);
        status.value = `Loaded: ${frames.length} frames (${PLAYBACK_HZ}Hz), GPS ${hasGps ? `interpolated from ${gpsFixes.length} fixes` : "unavailable"}${markerCount ? `, ${markerCount} markers` : ""}`;
        timeLabel.value = "0.0s";
        setPlaying(true);
    } catch (err) {
        console.error(err);
        status.value = `Parse failed: ${err.message}`;
    }
}

function onTogglePlay() {
    if (!frames.length) {
        onReplay();
        return;
    }
    setPlaying(!playingFlag);
}
function onResetView() {
    if (!camera) return;
    camera.position.copy(CAM_HOME);
    controls.target.set(0, 2, 0);
    camTargetY = 2;
}
function onFullScreen() {
    const el = rootRef.value;
    if (!document.fullscreenElement) el.requestFullscreen();
    else document.exitFullscreen();
}
function onYaw() {
    yawOffset += Math.PI / 2;
    if (!frames.length) return;
    const fr = frameAt(playT);
    applyFrame(fr);
}
function onSeek() {
    if (!frames.length || !seekRef.value) return;
    const frac = seekRef.value.value / 1000;
    playT = startTime + (endTime - startTime) * frac;
    setPlaying(false);
    const fr = frameAt(playT);
    applyFrame(fr);
    timeLabel.value = `${((playT - startTime) / 1e6).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
let rafId = null;
function animate(ts) {
    rafId = requestAnimationFrame(animate);
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;

    if (playingFlag && frames.length) {
        const wallDt = (ts - lastPlayWall) / 1000;
        lastPlayWall = ts;
        playT += wallDt * 1e6;
        if (playT >= endTime) {
            playT = endTime;
            setPlaying(false);
        }
        const frac = (playT - startTime) / (endTime - startTime || 1);
        if (seekRef.value) seekRef.value.value = Math.max(0, Math.min(1000, frac * 1000));
        const fr = frameAt(playT);
        applyFrame(fr);
        if (airplane) {
            const tx = airplane.position.x;
            const tz = airplane.position.z;
            let dy = airplane.position.y - camTargetY;
            if (Math.abs(dy) < 0.5) dy = 0;
            const ty = camTargetY + dy * 0.01;
            camTargetY = ty;
            controls.target.lerp(new THREE.Vector3(tx, ty, tz), 0.25);
        }
        timeLabel.value = `${((playT - startTime) / 1e6).toFixed(1)}s`;
    }

    const thr = frames.length ? frameAt(playT)?.throttle || 0 : 0;
    updatePropellers(dt, thr);

    controls.update();
    renderer.clear();
    renderer.render(scene, camera);
}

function resize() {
    if (!renderer || !camera || !rootRef.value) return;
    const w = rootRef.value.clientWidth;
    const h = rootRef.value.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87b9e6);
    scene.fog = new THREE.Fog(0x87b9e6, 60, 400);

    const w = rootRef.value.clientWidth || 800;
    const h = rootRef.value.clientHeight || 600;
    camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 5000);
    camera.position.copy(CAM_HOME);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.autoClear = true;
    rootRef.value.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 2, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(50, 100, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    scene.add(sun);

    buildEnvironment();
    scene.add(contrailGroup);
    loadAirplane();

    hudAltRel = rootRef.value.querySelector("#b3dAltRel");
    hudAltAsl = rootRef.value.querySelector("#b3dAltAsl");
    hudRaw = rootRef.value.querySelector("#b3dRaw");
    hudHome = rootRef.value.querySelector("#b3dHome");
    hudPos = rootRef.value.querySelector("#b3dPos");
    hudMode = rootRef.value.querySelector("#b3dMode");
    hudFile = rootRef.value.querySelector("#b3dFile");
    if (hudFile) hudFile.textContent = loadedFile.value;

    window.addEventListener("resize", resize);
    rafId = requestAnimationFrame(animate);
    // The tab pane may not have its final size on mount; correct the renderer
    // size once layout settles so the airfield is visible immediately.
    requestAnimationFrame(resize);
    setTimeout(resize, 200);
}

function dispose() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    window.removeEventListener("resize", resize);
    clearContrail();
    if (airplane) {
        scene.remove(airplane);
        airplane.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
    }
    if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
    }
    scene = null;
    camera = null;
    renderer = null;
    controls = null;
    airplane = null;
}

onMounted(async () => {
    await nextTick();
    init();
});
onBeforeUnmount(() => {
    dispose();
});
</script>

<style scoped>
.blackbox-3d-replay {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #87b9e6;
}
.b3d-toolbar {
    position: absolute;
    top: 10px;
    left: 10px;
    right: 10px;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    background: rgba(20, 24, 30, 0.82);
    color: #eee;
    padding: 8px 12px;
    border-radius: 8px;
    z-index: 10;
}
.b3d-btn {
    background: #2db0e3;
    color: #fff;
    border: none;
    padding: 6px 12px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 13px;
}
.b3d-btn:hover {
    background: #1e8fc0;
}
.b3d-sep {
    width: 1px;
    height: 22px;
    background: #444;
}
.b3d-status {
    font-size: 12px;
    color: #9fb3c8;
}
.b3d-seek {
    position: absolute;
    bottom: 14px;
    left: 10px;
    right: 10px;
    background: rgba(20, 24, 30, 0.82);
    padding: 8px 12px;
    border-radius: 8px;
    display: flex;
    gap: 10px;
    align-items: center;
    z-index: 10;
    color: #eee;
}
.b3d-seek-input {
    flex: 1;
}
.b3d-time {
    font-size: 12px;
    min-width: 90px;
    text-align: right;
    color: #9fb3c8;
}
.b3d-drop {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 20px;
    z-index: 20;
    pointer-events: none;
}
.b3d-hud {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 10;
    background: rgba(20, 24, 30, 0.82);
    color: #e8f4ff;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.7;
    font-family: ui-monospace, monospace;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    font-weight: 600;
}
.b3d-hud span {
    color: #ffd166;
    font-weight: 800;
}
.b3d-mode {
    color: #ffffff;
    font-weight: 800;
}
.b3d-mode--auto {
    color: #ff3b3b;
}
.b3d-file {
    margin-top: 4px;
    font-size: 12px;
    color: #9fb3c8;
}
.b3d-file span {
    color: #cfe8ff;
}
.tab-blackbox-3d-host {
    height: 100%;
}
.b3d-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 0 20%;
    text-align: center;
    color: #fff;
    font-size: 15px;
    line-height: 1.6;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
    background: rgba(10, 20, 35, 0.28);
    z-index: 30;
    pointer-events: none;
}
.b3d-empty .b3d-btn--load {
    pointer-events: auto;
}
.b3d-hidden-file {
    display: none;
}
</style>
