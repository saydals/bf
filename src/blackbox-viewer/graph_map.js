import { useSettingsStore } from "./stores/settings.js";
import { FLIGHT_LOG_FLIGHT_MODE_NAME } from "./flightlog_fielddefs.js";

export function MapGrapher() {
    const { userSettings } = useSettingsStore();
    let myMap,
        currentLogStartDateTime,
        currentTime,
        craftPosition,
        groundCourse,
        homePosition,
        craftMarker,
        homeMarker,
        trailLayers = new Map(),
        routeLayers = new Map(),
        previousLogIndex,
        latIndexAtFrame,
        lngIndexAtFrame,
        altitudeIndexAtFrame,
        groundCourseIndexAtFrame,
        flightLog,
        altitudeSource = "asl",
        homeGpsAltitude = null,
        mapToolsControl = null,
        airplaneControl = null,
        headingIndexAtFrame = null,
        throttleIndexAtFrame = null;

    // Registered by MapView.vue; receives { roll, pitch, yaw } in radians.
    this.onAirplaneAttitude = null;

    const coordinateDivider = 10000000;
    const altitudeDivider = 10;
    const grounCourseDivider = 10;

    const mapOptions = {
        center: [0, 0],
        zoom: 1,
    };

    const craftIcon = L.icon({
        iconUrl: "images/markers/craft.png",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        className: "icon",
    });

    const homeIcon = L.icon({
        iconUrl: "images/markers/home.png",
        iconSize: [60, 60],
        iconAnchor: [30, 53],
        className: "icon home-icon",
    });

    const createWaypointIcon = (index) =>
        L.divIcon({
            className: "blackbox-waypoint-marker",
            html: `<span class="blackbox-waypoint-marker__label">P${index + 1}</span>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        });

    const aPointIcon = L.divIcon({
        className: "blackbox-route-marker blackbox-route-marker--a",
        html: '<span class="blackbox-route-marker__label">A</span>',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
    });

    const bPointIcon = L.divIcon({
        className: "blackbox-route-marker blackbox-route-marker--b",
        html: '<span class="blackbox-route-marker__label">B</span>',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
    });

    const routePolylineOptions = {
        color: "#ffcc00",
        dashArray: "6 8",
        opacity: 0.9,
        weight: 3,
        smoothFactor: 1,
    };

    const abPolylineOptions = {
        color: "#ff66cc",
        dashArray: "4 8",
        opacity: 0.9,
        weight: 3,
        smoothFactor: 1,
    };

    const polylineOptions = {
        color: "#2db0e3",
        opacity: 0.8,
        smoothFactor: 1,
    };

    // flight trail colors
    const colorTrailGradient = [
        { color: "#00ffe0bf" },
        { color: "#00ff8cbf" },
        { color: "#00ff02bf" },
        { color: "#75ff00bf" },
        { color: "#e5ff00bf" },
        { color: "#ffb100bf" },
        { color: "#ff4c00bf" },
        { color: "#ff1414" },
    ];

    const rescuePolylineOptions = {
        color: "#d946ef",
        dashArray: "8 4",
        opacity: 0.95,
        weight: 4,
        smoothFactor: 1,
        lineCap: "round",
    };

    // debug circles can be used to aligh icons at the correct coordinates
    const debugCircle = false;
    const debugCircleOptions = {
        color: "red",
        fillColor: "red",
        fillOpacity: 0.8,
        radius: 1,
    };

    // map layers
    const layerUrls = {
        street: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        hybrid: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    };
    const layerAttributions = {
        street: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        satellite: '&copy; <a href="https://www.arcgis.com/">Esri</a> — Source: Esri, Maxar, Earthstar',
        hybrid: '&copy; <a href="https://www.arcgis.com/">Esri</a> — Source: Esri, Maxar + OpenStreetMap labels',
    };
    let currentLayer = "street";
    let currentTileLayer = null;

    // --- Leaflet custom control: map action buttons (layer toggle, home, fullscreen) ---
    L.Control.MapActions = L.Control.extend({
        options: { position: "topleft" },
        initialize: function (options) {
            L.setOptions(this, options);
            this._activeLayer = "street";
        },
        onAdd: function () {
            const g = this.options.grapher;
            const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-custom-map-actions");
            const layers = ["street", "satellite"];
            const labels = { street: "R", satellite: "S" };
            const self = this;
            layers.forEach((key) => {
                const btn = L.DomUtil.create("button", "", container);
                btn.type = "button";
                btn.textContent = labels[key];
                btn.title = key === "street" ? "Street map" : "Satellite map";
                btn.setAttribute("aria-label", `${key} layer`);
                btn.classList.toggle("active", key === self._activeLayer);
                L.DomEvent.on(btn, "click", L.DomEvent.stopPropagation);
                L.DomEvent.on(btn, "click", function () {
                    self._activeLayer = key;
                    self._updateActive();
                    g.setLayer(key);
                });
            });
            L.DomUtil.create("span", "leaflet-control-separator", container);
            const homeBtn = L.DomUtil.create("button", "", container);
            homeBtn.type = "button";
            homeBtn.innerHTML = "&#x1F3E0;";
            homeBtn.title = "Zoom to home";
            homeBtn.setAttribute("aria-label", "Zoom to home");
            L.DomEvent.on(homeBtn, "click", L.DomEvent.stopPropagation);
            L.DomEvent.on(homeBtn, "click", function () {
                g.zoomHome();
            });
            const fsBtn = L.DomUtil.create("button", "", container);
            fsBtn.type = "button";
            fsBtn.innerHTML = "&#x26F6;";
            fsBtn.title = "Toggle fullscreen";
            fsBtn.setAttribute("aria-label", "Toggle fullscreen");
            L.DomEvent.on(fsBtn, "click", L.DomEvent.stopPropagation);
            L.DomEvent.on(fsBtn, "click", function () {
                g.toggleFullscreen();
            });
            return container;
        },
        _updateActive: function () {
            const container = this.getContainer();
            if (!container) return;
            const buttons = container.querySelectorAll("button");
            buttons.forEach((btn) => btn.classList.remove("active"));
            // R=0, S=1, H=2 are the first three buttons
            const layerIndex = ["street", "satellite"].indexOf(this._activeLayer);
            if (buttons[layerIndex]) {
                buttons[layerIndex].classList.add("active");
            }
        },
    });

    // --- Leaflet control: bottom-left tools row (drag + altitude) ---
    // A flex row holding the drag (+) button and the altitude readout, kept on a
    // single line. The airplane attitude widget sits above this row (separate control).
    L.Control.MapTools = L.Control.extend({
        options: { position: "bottomleft" },
        onAdd: function () {
            const g = this.options.grapher;
            const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-custom-map-tools");

            // Drag (+) button
            const dragBtn = L.DomUtil.create("button", "map-drag-button", container);
            dragBtn.type = "button";
            dragBtn.innerHTML = "&#x270B;";
            dragBtn.title = "Hold & drag to move map position";
            dragBtn.setAttribute("aria-label", "Drag map position");
            dragBtn.style.cssText = "font-size:16px;width:30px;height:30px;";
            L.DomEvent.on(dragBtn, "mousedown", L.DomEvent.stopPropagation);
            L.DomEvent.on(dragBtn, "touchstart", L.DomEvent.stopPropagation);
            L.DomEvent.on(dragBtn, "mousedown", function (e) {
                startMapDrag(e);
            });
            L.DomEvent.on(
                dragBtn,
                "touchstart",
                function (e) {
                    startMapDrag(e);
                },
                { passive: false },
            );

            // Altitude readout button (click toggles ASL / MSL source)
            const btn = L.DomUtil.create("button", "altitude-toggle-button", container);
            btn.type = "button";
            btn.innerHTML = '<span class="altitude-source">ASL</span> <span class="altitude-value">--</span>';
            btn.title = "Altitude (click to toggle ASL / MSL source)";
            btn.setAttribute("aria-label", "Altitude readout, click to toggle source");
            L.DomEvent.on(btn, "click", L.DomEvent.stopPropagation);
            L.DomEvent.on(btn, "click", function () {
                g.toggleAltitudeSource();
            });

            return container;
        },
    });

    this.initialize = function () {
        if (myMap) {
            return;
        }

        myMap = L.map("mapContainer", mapOptions);

        currentTileLayer = L.tileLayer(layerUrls[currentLayer], {
            maxZoom: 19,
            minZoom: 1,
            attribution: layerAttributions[currentLayer],
        }).addTo(myMap);

        myMap.addControl(new L.Control.MapActions({ grapher: this }));

        // Fix: map may render at 0×0 when container is hidden on init.
        // Observe container size and invalidate when it gets real dimensions.
        const mapEl = document.getElementById("mapContainer");
        if (mapEl && typeof ResizeObserver !== "undefined") {
            let lastW = 0;
            let lastH = 0;
            const obs = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const w = entry.contentRect.width;
                    const h = entry.contentRect.height;
                    if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
                        lastW = w;
                        lastH = h;
                        myMap.invalidateSize();
                    }
                }
            });
            obs.observe(mapEl);
        }

        // Add drag control so the map frame can be freely repositioned
        this.enableDragControl();
    };

    // --- Leaflet control: airplane attitude display (bottomleft, above tools row) ---
    // A circular 90x90 (180x180 in fullscreen) box with a blue background that hosts
    // the Three.js airplane model (MapAirplane.vue). The model/canvas lives in Vue;
    // this control only provides the mount point and toggles the fullscreen class.
    L.Control.MapAirplane = L.Control.extend({
        options: { position: "bottomleft" },
        onAdd: function () {
            const container = L.DomUtil.create(
                "div",
                "leaflet-bar leaflet-control leaflet-control-custom-map-airplane",
            );
            container.id = "mapAirplaneMount";
            // Keep pointer/scroll events on the widget from panning or zooming the map.
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);
            return container;
        },
    });

    let mapDragState = null;
    let mapDragControl = null;

    function startMapDrag(e) {
        const mapEl = document.getElementById("mapContainer");
        if (!mapEl || !myMap) return;

        e.preventDefault();
        e.stopPropagation();

        mapEl.style.cursor = "grabbing";

        const touch = e.touches ? e.touches[0] : e;
        const origLeft = parseFloat(mapEl.style.left) || 0;
        const origTop = parseFloat(mapEl.style.top) || 0;

        mapDragState = {
            startX: touch.clientX,
            startY: touch.clientY,
            origLeft,
            origTop,
            mapEl,
        };

        document.addEventListener("mousemove", onMapDragMove);
        document.addEventListener("mouseup", onMapDragEnd);
        document.addEventListener("touchmove", onMapDragMove, { passive: false });
        document.addEventListener("touchend", onMapDragEnd);
        document.addEventListener("touchcancel", onMapDragEnd);
    }

    function onMapDragMove(e) {
        if (!mapDragState) return;
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - mapDragState.startX;
        const dy = touch.clientY - mapDragState.startY;

        const parentRect = mapDragState.mapEl.parentElement.getBoundingClientRect();

        let newLeft = mapDragState.origLeft + dx;
        let newTop = mapDragState.origTop + dy;

        newLeft = Math.max(-mapDragState.mapEl.offsetWidth * 0.5, Math.min(parentRect.width - 50, newLeft));
        newTop = Math.max(-mapDragState.mapEl.offsetHeight * 0.5, Math.min(parentRect.height - 50, newTop));

        mapDragState.mapEl.style.left = `${newLeft}px`;
        mapDragState.mapEl.style.top = `${newTop}px`;
    }

    function onMapDragEnd() {
        if (!mapDragState) return;

        document.removeEventListener("mousemove", onMapDragMove);
        document.removeEventListener("mouseup", onMapDragEnd);
        document.removeEventListener("touchmove", onMapDragMove);
        document.removeEventListener("touchend", onMapDragEnd);
        document.removeEventListener("touchcancel", onMapDragEnd);

        const mapEl = mapDragState.mapEl;
        mapEl.style.cursor = "";

        const parentRect = mapEl.parentElement.getBoundingClientRect();

        if (userSettings && userSettings.map) {
            const leftPct = Math.max(0, (parseFloat(mapEl.style.left) / parentRect.width) * 100);
            const topPct = Math.max(0, (parseFloat(mapEl.style.top) / parentRect.height) * 100);
            userSettings.map.left = Math.round(leftPct);
            userSettings.map.top = Math.round(topPct);
        }

        if (myMap) {
            requestAnimationFrame(() => myMap.invalidateSize());
        }

        mapDragState = null;
    }

    this.enableDragControl = function () {
        if (!myMap || mapDragControl) return;
        // Leaflet stacks bottom-left controls with the FIRST added on top. We want the
        // airplane widget ABOVE the tools row (drag + altitude), so add the tools first
        // and the airplane last.
        if (!mapToolsControl) {
            mapToolsControl = new L.Control.MapTools({ grapher: this });
            myMap.addControl(mapToolsControl);
        }
        // Airplane attitude display sits ABOVE the tools row.
        if (!airplaneControl) {
            airplaneControl = new L.Control.MapAirplane();
            myMap.addControl(airplaneControl);
        }
        mapDragControl = {}; // mark as initialized
    };

    // Tear down the Leaflet map so the viewer tab can be re-mounted without leaking
    // the map instance and its DOM/event handlers.
    this.destroy = function () {
        if (myMap) {
            myMap.remove();
            myMap = null;
        }
        currentTileLayer = null;
        trailLayers = new Map();
        routeLayers = new Map();
        craftMarker = null;
        homeMarker = null;
        airplaneControl = null;
        mapToolsControl = null;
        mapDragControl = null;
    };

    this.setLayer = function (layerKey) {
        if (!myMap || !layerUrls[layerKey] || layerKey === currentLayer) {
            return;
        }
        if (currentTileLayer) {
            myMap.removeLayer(currentTileLayer);
        }
        currentLayer = layerKey;
        currentTileLayer = L.tileLayer(layerUrls[currentLayer], {
            maxZoom: 19,
            minZoom: 1,
            attribution: layerAttributions[currentLayer],
        }).addTo(myMap);
    };

    this.zoomHome = function () {
        if (!myMap || !homePosition) {
            return;
        }
        myMap.setView(homePosition, Math.max(myMap.getZoom(), 12));
    };

    this.toggleFullscreen = function () {
        if (!myMap) {
            return;
        }
        const el = document.getElementById("mapContainer");
        if (!el) {
            return;
        }
        const entering = !document.fullscreenElement && !document.webkitFullscreenElement;
        if (entering) {
            el.requestFullscreen?.();
            el.webkitRequestFullscreen?.();
        } else {
            document.exitFullscreen?.();
            document.webkitExitFullscreen?.();
        }
        // Scale the airplane widget up while the map is fullscreen.
        const mount = document.getElementById("mapAirplaneMount");
        if (mount) {
            mount.classList.toggle("fullscreen", entering);
        }
    };

    this.reset = function () {
        if (!myMap) {
            return;
        }
        this.clearMap(previousLogIndex);
        previousLogIndex = null;
        currentTime = null;
        craftPosition = null;
        groundCourse = null;
        homePosition = null;
        craftMarker = null;
        homeMarker = null;
        trailLayers = new Map();
        routeLayers = new Map();
        previousLogIndex = null;
        latIndexAtFrame = null;
        lngIndexAtFrame = null;
        altitudeIndexAtFrame = null;
        groundCourseIndexAtFrame = null;
        altitudeSource = "asl";
        homeGpsAltitude = null;
        this.updateAltitudeDisplay();
        myMap.setView(mapOptions.center, mapOptions.zoom);
    };

    this.setFlightLog = function (newFlightLog) {
        flightLog = newFlightLog;

        const newLogStartDateTime = flightLog.getSysConfig()["Log start datetime"];
        if (currentLogStartDateTime !== newLogStartDateTime) {
            this.reset();
            currentLogStartDateTime = newLogStartDateTime;
        }

        const logIndex = flightLog.getLogIndex();

        // if this log is already proccesed its skipped
        if (trailLayers.has(logIndex)) {
            return;
        }

        this.setFlightLogIndexs();
        const { latlngs, maxAlt, minAlt, rescueLatlngs } = this.getPolylinesData();
        const routeData = this.getRouteData();

        const hasGpsData = latlngs.length > 0;

        if (hasGpsData) {
            const polyline = L.polyline(latlngs, polylineOptions);

            const polylineC = this.createAltitudeColoredPolyline(latlngs, maxAlt, minAlt);
            const rescuePolyline = rescueLatlngs.length > 1 ? L.polyline(rescueLatlngs, rescuePolylineOptions) : null;

            trailLayers.set(logIndex, { polyline, polylineC, rescuePolyline });
            routeLayers.set(logIndex, this.createRouteLayers(routeData));

            homePosition = this.getHomeCoordinatesFromFlightLog(flightLog);
            homeGpsAltitude = this.getFirstFrameGpsAltitude(flightLog);
        } else {
            console.debug("FlightLog has no gps data.");
        }

        document.getElementById("mapContainer")?.classList.toggle("no-gps-data", !hasGpsData);
    };

    this.setFlightLogIndexs = function () {
        latIndexAtFrame = flightLog.getMainFieldIndexByName("GPS_coord[0]");
        lngIndexAtFrame = flightLog.getMainFieldIndexByName("GPS_coord[1]");
        altitudeIndexAtFrame = flightLog.getMainFieldIndexByName("GPS_altitude");
        groundCourseIndexAtFrame = flightLog.getMainFieldIndexByName("GPS_ground_course");
        headingIndexAtFrame = [
            flightLog.getMainFieldIndexByName("heading[0]"),
            flightLog.getMainFieldIndexByName("heading[1]"),
            flightLog.getMainFieldIndexByName("heading[2]"),
        ];
        // Throttle may be logged as "throttle" or inside rcCommand[3].
        const throttleIdx = flightLog.getMainFieldIndexByName("throttle");
        const rcThrottleIdx = flightLog.getMainFieldIndexByName("rcCommand[3]");
        throttleIndexAtFrame = throttleIdx >= 0 ? throttleIdx : rcThrottleIdx;
    };

    this.getRouteData = function () {
        const fieldIndexes = flightLog.getMainFieldIndexes();
        const waypoints = [];
        const waypointValues = new Map();
        const abValues = { a: {}, b: {} };
        const chunks = flightLog.getChunksInTimeRange(flightLog.getMinTime(), flightLog.getMaxTime());

        const readValue = (frame, name) => {
            const index = fieldIndexes[name];
            return index === undefined || !this.isNumber(frame[index]) ? null : frame[index];
        };

        for (const chunk of chunks) {
            for (const frame of chunk.frames) {
                for (let i = 0; i < 99; i++) {
                    const lat = readValue(frame, `GPS_wp_${i}_lat`);
                    const lon = readValue(frame, `GPS_wp_${i}_lon`);
                    if (lat !== null && lon !== null && (lat !== 0 || lon !== 0)) {
                        waypointValues.set(i, {
                            lat: lat / coordinateDivider,
                            lon: lon / coordinateDivider,
                        });
                    }
                }

                for (const point of ["a", "b"]) {
                    const prefix = point === "a" ? "GPS_A" : "GPS_B";
                    const lat = readValue(frame, `${prefix}_lat`);
                    const lon = readValue(frame, `${prefix}_lon`);
                    if (lat !== null && lon !== null && (lat !== 0 || lon !== 0)) {
                        abValues[point] = {
                            lat: lat / coordinateDivider,
                            lon: lon / coordinateDivider,
                        };
                    }
                }
            }
        }

        for (const [index, point] of waypointValues) {
            waypoints[index] = L.latLng(point.lat, point.lon);
        }

        return {
            waypoints: waypoints.filter(Boolean),
            a: abValues.a.lat === undefined ? null : L.latLng(abValues.a.lat, abValues.a.lon),
            b: abValues.b.lat === undefined ? null : L.latLng(abValues.b.lat, abValues.b.lon),
        };
    };

    this.createRouteLayers = function ({ waypoints, a, b }) {
        const layers = {
            waypoints: [],
            route: null,
            ab: [],
        };

        if (waypoints.length > 0) {
            layers.waypoints = waypoints.map((point, index) =>
                L.marker(point, {
                    icon: createWaypointIcon(index),
                    title: `Waypoint ${index + 1}`,
                }),
            );
            if (waypoints.length > 1) {
                layers.route = L.polyline(waypoints, {
                    ...routePolylineOptions,
                    className: "blackbox-waypoint-route",
                });
            }
        }

        if (a) {
            layers.ab.push(
                L.marker(a, {
                    icon: aPointIcon,
                    title: "Rescue point A",
                }),
            );
        }
        if (b) {
            layers.ab.push(
                L.marker(b, {
                    icon: bPointIcon,
                    title: "Rescue point B",
                }),
            );
        }
        if (a && b) {
            layers.ab.push(
                L.polyline([a, b], {
                    ...abPolylineOptions,
                    className: "blackbox-ab-route",
                }),
            );
        }

        return layers;
    };

    this.addRouteLayers = function (logIndex) {
        const layers = routeLayers.get(logIndex);
        if (!layers || !myMap) {
            return;
        }
        layers.waypoints.forEach((layer) => layer.addTo(myMap));
        if (layers.route) {
            layers.route.addTo(myMap);
        }
        layers.ab.forEach((layer) => layer.addTo(myMap));
    };

    this.removeRouteLayers = function (logIndex) {
        const layers = routeLayers.get(logIndex);
        if (!layers || !myMap) {
            return;
        }
        layers.waypoints.forEach((layer) => myMap.removeLayer(layer));
        if (layers.route) {
            myMap.removeLayer(layers.route);
        }
        layers.ab.forEach((layer) => myMap.removeLayer(layer));
    };

    this.fitMapToAllLayers = function (logIndex, flightPolyline) {
        if (!myMap || !flightPolyline) {
            return;
        }

        const bounds = flightPolyline.getBounds();
        const layers = routeLayers.get(logIndex);
        if (layers) {
            const routeLayersToInclude = [...layers.waypoints, ...layers.ab];
            if (layers.route) {
                routeLayersToInclude.push(layers.route);
            }

            routeLayersToInclude.forEach((layer) => {
                if (typeof layer.getBounds === "function") {
                    bounds.extend(layer.getBounds());
                } else if (typeof layer.getLatLng === "function") {
                    bounds.extend(layer.getLatLng());
                }
            });
        }

        if (bounds.isValid()) {
            myMap.fitBounds(bounds);
        }
    };

    this.getPolylinesData = function () {
        const latlngs = [];
        const rescueLatlngs = [];
        let maxAlt = Number.MIN_VALUE;
        let minAlt = Number.MAX_VALUE;
        const flightModeIndex = flightLog.getMainFieldIndexByName("flightModeFlags");
        const rescueModeIndex = Math.max(
            FLIGHT_LOG_FLIGHT_MODE_NAME.indexOf("GPS_RESCUE"),
            FLIGHT_LOG_FLIGHT_MODE_NAME.indexOf("GPSRESCUE"),
        );
        const rescueModeMask = rescueModeIndex >= 0 ? 1 << rescueModeIndex : 0;

        const chunks = flightLog.getChunksInTimeRange(flightLog.getMinTime(), flightLog.getMaxTime());

        let frameCount = 0;
        for (const chunk of chunks) {
            for (const frame of chunk.frames) {
                const coordinates = this.getCoordinatesFromFrame(
                    frame,
                    latIndexAtFrame,
                    lngIndexAtFrame,
                    altitudeIndexAtFrame,
                );

                // if there are no coordinates the frame is skipped
                if (!coordinates) {
                    frameCount++;
                    continue;
                }

                // Altitude max and min values can be obtained from the stats but fixing the index at 4 doesn't seem safe
                // const maxAlt = flightLog.getStats().frame.G.field[4].max / altitudeDivider;
                // const minAlt = flightLog.getStats().frame.G.field[4].min / altitudeDivider;
                maxAlt = Math.max(coordinates.alt, maxAlt);
                minAlt = Math.min(coordinates.alt, minAlt);

                // 1/4 of the dots is enough to draw the line
                if (frameCount % 4 === 0) {
                    latlngs.push(coordinates);
                    const flightModeFlags = frame[flightModeIndex];
                    if (rescueModeMask && this.isNumber(flightModeFlags) && (flightModeFlags & rescueModeMask) !== 0) {
                        rescueLatlngs.push(coordinates);
                    }
                }
                frameCount++;
            }
        }
        return { latlngs, maxAlt, minAlt, rescueLatlngs };
    };

    this.createAltitudeColoredPolyline = function (latlngs, maxAlt, minAlt) {
        const divider = colorTrailGradient.length - 1;

        const delta = maxAlt - minAlt;

        const thresholdIncrement = delta / divider;

        const altThresholds = [];
        let threshold = minAlt;
        for (let i = 0; i < divider; i++) {
            //amount of colors - min and max that are set
            threshold += thresholdIncrement;
            altThresholds.push(threshold);
        }

        return L.multiOptionsPolyline(latlngs, {
            multiOptions: {
                optionIdxFn: function (latLng) {
                    for (let i = 0; i < altThresholds.length; i++) {
                        if (latLng.alt <= altThresholds[i]) {
                            return i;
                        }
                    }
                    return altThresholds.length;
                },
                options: colorTrailGradient,
            },
            weight: 3,
            lineCap: "butt",
            opacity: 1,
            smoothFactor: 1,
        });
    };

    this.updateCurrentPosition = function () {
        try {
            const frame = flightLog.getCurrentFrameAtTime(currentTime);
            craftPosition = this.getCoordinatesFromFrame(
                frame.current,
                latIndexAtFrame,
                lngIndexAtFrame,
                altitudeIndexAtFrame,
            );
            groundCourse = this.getGroundCourseFromFrame(frame.current, groundCourseIndexAtFrame);

            this.updateAltitudeDisplay();
        } catch {
            // Frame coordinates unavailable — skip position update
        }
    };

    this.redrawAll = function () {
        if (trailLayers.size <= 0 || !myMap) {
            return;
        }

        this.redrawFlightTrail();
        this.redrawHomeMarker();
        this.redrawCraftMarker();
    };

    this.redrawFlightTrail = function () {
        // If flightLog has changed redraw flight trail
        const currentLogIndex = flightLog.getLogIndex();
        if (previousLogIndex !== currentLogIndex) {
            this.clearMap(previousLogIndex);
            if (trailLayers.has(currentLogIndex)) {
                const polyline = userSettings.mapTrailAltitudeColored
                    ? trailLayers.get(currentLogIndex).polylineC
                    : trailLayers.get(currentLogIndex).polyline;
                polyline.addTo(myMap);
                const rescuePolyline = trailLayers.get(currentLogIndex).rescuePolyline;
                if (rescuePolyline) {
                    rescuePolyline.addTo(myMap);
                }
                this.addRouteLayers(currentLogIndex);
                this.fitMapToAllLayers(currentLogIndex, polyline);
            }

            previousLogIndex = currentLogIndex;
        }
    };

    this.redrawHomeMarker = function () {
        if (homePosition) {
            if (homeMarker) {
                homeMarker.icon.setLatLng(homePosition).addTo(myMap);

                // debug circle
                if (debugCircle) {
                    homeMarker.circle.setLatLng(homePosition).addTo(myMap);
                }
            } else {
                homeMarker = {};

                homeMarker.icon = L.marker(homePosition, {
                    icon: homeIcon,
                }).addTo(myMap);

                // debug circle
                if (debugCircle) {
                    homeMarker.circle = L.circle(homePosition, debugCircleOptions).addTo(myMap);
                }
            }
        }
    };

    this.redrawCraftMarker = function () {
        if (craftPosition) {
            if (craftMarker) {
                craftMarker.icon.setLatLng(craftPosition);
                craftMarker.icon.setRotationAngle(groundCourse).addTo(myMap);
                // debug circle
                if (debugCircle) {
                    homeMarker.circle.setLatLng(craftPosition).addTo(myMap);
                }
            } else {
                craftMarker = {};
                craftMarker.icon = L.rotatedMarker(craftPosition, {
                    icon: craftIcon,
                    rotationAngle: groundCourse,
                    rotationOrigin: "center center",
                }).addTo(myMap);

                // debug circle
                if (debugCircle) {
                    craftMarker.circle = L.circle(craftPosition, debugCircleOptions).addTo(myMap);
                }
            }
        }
    };

    this.clearMap = function (trailIndex) {
        this.clearMapFlightTrails(trailIndex);
        this.clearMapMarkers();
    };

    this.clearMapFlightTrails = function (trailIndex) {
        this.removeRouteLayers(trailIndex);
        if (trailLayers.has(trailIndex)) {
            const p = trailLayers.get(trailIndex).polyline;
            const pc = trailLayers.get(trailIndex).polylineC;
            const rescuePolyline = trailLayers.get(trailIndex).rescuePolyline;
            if (p) {
                myMap.removeLayer(p);
            }
            if (pc) {
                myMap.removeLayer(pc);
            }
            if (rescuePolyline) {
                myMap.removeLayer(rescuePolyline);
            }
        }
    };

    this.clearMapMarkers = function () {
        if (homeMarker) {
            if (myMap.hasLayer(homeMarker.icon)) {
                myMap.removeLayer(homeMarker.icon);
            }
            if (debugCircle && myMap.hasLayer(homeMarker.circle)) {
                myMap.removeLayer(homeMarker.circle);
            }
        }
        if (craftMarker) {
            if (myMap.hasLayer(craftMarker.icon)) {
                myMap.removeLayer(craftMarker.icon);
            }
            if (debugCircle && myMap.hasLayer(craftMarker.circle)) {
                myMap.removeLayer(craftMarker.circle);
            }
        }
    };

    this.resize = function (width, height) {
        if (!userSettings) {
            return;
        }
        const containerstyle = {
            height: (height * Number.parseInt(userSettings.map.size, 10)) / 100,
            width: (width * Number.parseInt(userSettings.map.size, 10)) / 100,
            left: (width * Number.parseInt(userSettings.map.left, 10)) / 100,
            top: (height * Number.parseInt(userSettings.map.top, 10)) / 100,
        };
        const mapEl = document.getElementById("mapContainer");
        if (mapEl) {
            Object.assign(mapEl.style, {
                height: `${containerstyle.height}px`,
                width: `${containerstyle.width}px`,
                left: `${containerstyle.left}px`,
                top: `${containerstyle.top}px`,
            });
            if (myMap) {
                requestAnimationFrame(() => myMap.invalidateSize());
            }
        }
    };

    this.getCoordinatesFromFrame = function (frame, latIndex, lngIndex, altitudeIndex) {
        const lat = frame[latIndex];
        const lng = frame[lngIndex];
        const alt = frame[altitudeIndex];

        return this.isNumber(lat) && this.isNumber(lng)
            ? L.latLng(lat / coordinateDivider, lng / coordinateDivider, alt / altitudeDivider)
            : null;
    };

    this.isNumber = function (n) {
        return typeof n === "number" && !Number.isNaN(n);
    };

    this.getGroundCourseFromFrame = function (frame, groundCourseIndex) {
        const gc = frame[groundCourseIndex];
        return typeof gc === "number" ? gc / grounCourseDivider : 0;
    };

    this.getHomeCoordinatesFromFlightLog = function (flightLog) {
        const home = flightLog.getStats().frame.H.field;
        return [home[0].min / coordinateDivider, home[1].min / coordinateDivider];
    };

    this.getFirstFrameGpsAltitude = function (flightLog) {
        const chunks = flightLog.getChunksInTimeRange(flightLog.getMinTime(), flightLog.getMaxTime());
        for (const chunk of chunks) {
            for (const frame of chunk.frames) {
                const alt = frame[altitudeIndexAtFrame];
                if (this.isNumber(alt)) {
                    return alt / altitudeDivider;
                }
            }
        }
        return null;
    };

    this.setCurrentTime = function (newTime) {
        currentTime = newTime;
        this.updateCurrentPosition();
        this.updateAirplaneAttitude();
        this.redrawAll();
    };

    this.getCurrentTime = function () {
        return currentTime;
    };

    // Read attitude from the current blackbox frame and push it to the airplane
    // display (MapAirplane.vue) via the onAirplaneAttitude callback.
    this.updateAirplaneAttitude = function () {
        if (!this.onAirplaneAttitude || !flightLog) {
            return;
        }
        const frame = flightLog.getCurrentFrameAtTime(currentTime);
        if (!frame || !frame.current) {
            return;
        }

        const f = frame.current;
        const hasHeading = headingIndexAtFrame && headingIndexAtFrame.every((i) => this.isNumber(f[i]));

        let roll = 0;
        let pitch = 0;
        let yaw;

        if (hasHeading) {
            roll = f[headingIndexAtFrame[0]];
            pitch = f[headingIndexAtFrame[1]];
            yaw = f[headingIndexAtFrame[2]];
        } else if (this.isNumber(f[groundCourseIndexAtFrame])) {
            // Fallback: yaw from GPS ground course, roll/pitch stay level.
            yaw = f[groundCourseIndexAtFrame] / grounCourseDivider;
        } else {
            yaw = 0;
        }

        // Use the raw heading (or GPS ground course fallback) directly so the model
        // points along the real flight direction instead of always resetting north.

        // Throttle (0..1 from a 1000..2000 RC step, or raw 0..1000+ depending on log).
        let throttle = 0;
        if (throttleIndexAtFrame >= 0 && this.isNumber(f[throttleIndexAtFrame])) {
            let raw = f[throttleIndexAtFrame];
            // Normalize common scales to 0..1.
            if (raw > 1.5) {
                // Likely a 1000..2000 (or similar) RC pulse; shift and scale.
                raw = Math.max(0, raw - 1000) / 1000;
            }
            throttle = Math.min(1, Math.max(0, raw));
        }

        this.onAirplaneAttitude({ roll, pitch, yaw, throttle });
    };

    this.toggleAltitudeSource = function () {
        altitudeSource = altitudeSource === "asl" ? "msl" : "asl";
        const btn = document.querySelector(".altitude-toggle-button");
        if (btn) {
            const sourceEl = btn.querySelector(".altitude-source");
            if (sourceEl) {
                sourceEl.textContent = altitudeSource === "asl" ? "ASL" : "MSL";
            }
        }
        this.updateAltitudeDisplay();
    };

    this.updateAltitudeDisplay = function () {
        const btn = document.querySelector(".altitude-toggle-button");
        if (!btn) {
            return;
        }
        const valueEl = btn.querySelector(".altitude-value");
        if (!valueEl) {
            return;
        }

        const frame = flightLog?.getCurrentFrameAtTime(currentTime);
        const rawGpsAlt =
            frame && frame.current && this.isNumber(frame.current[altitudeIndexAtFrame])
                ? frame.current[altitudeIndexAtFrame] / altitudeDivider
                : null;
        if (rawGpsAlt === null) {
            valueEl.textContent = "--";
            return;
        }

        // ASL: relative to takeoff GPS altitude (current GPS - home GPS)
        // MSL: raw GPS altitude from the log (absolute)
        const value = altitudeSource === "asl" ? rawGpsAlt - (homeGpsAltitude ?? 0) : rawGpsAlt;

        const unit = userSettings.altitudeUnits === 2 ? "ft" : "m";
        const converted = userSettings.altitudeUnits === 2 ? value * 3.28 : value;
        valueEl.textContent = `${converted.toFixed(1)}${unit}`;
    };
}
