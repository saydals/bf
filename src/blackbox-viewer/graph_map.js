import { useSettingsStore } from "./stores/settings.js";

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
        previousLogIndex,
        latIndexAtFrame,
        lngIndexAtFrame,
        altitudeIndexAtFrame,
        groundCourseIndexAtFrame,
        flightLog;

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
        iconSize: [40, 40],
        iconAnchor: [20, 35],
        className: "icon",
    });

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
    const layerLabels = { street: "R", satellite: "S", hybrid: "H" };
    let currentLayer = "street";
    let currentTileLayer = null;

    // --- Leaflet custom control: map action buttons (layer toggle, home, fullscreen) ---
    L.Control.MapActions = L.Control.extend({
        options: { position: "topright" },
        initialize: function (options) {
            L.setOptions(this, options);
            this._activeLayer = "street";
        },
        onAdd: function () {
            const g = this.options.grapher;
            const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-custom-map-actions");
            const layers = ["street", "satellite", "hybrid"];
            const labels = { street: "R", satellite: "S", hybrid: "H" };
            const self = this;
            layers.forEach((key) => {
                const btn = L.DomUtil.create("button", "", container);
                btn.type = "button";
                btn.textContent = labels[key];
                btn.title = key.charAt(0).toUpperCase() + key.slice(1);
                btn.setAttribute("aria-label", key + " layer");
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
            const layerIndex = ["street", "satellite", "hybrid"].indexOf(this._activeLayer);
            if (buttons[layerIndex]) {
                buttons[layerIndex].classList.add("active");
            }
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
        craftMarker = null;
        homeMarker = null;
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
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            el.requestFullscreen?.();
            el.webkitRequestFullscreen?.();
        } else {
            document.exitFullscreen?.();
            document.webkitExitFullscreen?.();
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
        previousLogIndex = null;
        latIndexAtFrame = null;
        lngIndexAtFrame = null;
        altitudeIndexAtFrame = null;
        groundCourseIndexAtFrame = null;
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
        const { latlngs, maxAlt, minAlt } = this.getPolylinesData();

        const hasGpsData = latlngs.length > 0;

        if (hasGpsData) {
            const polyline = L.polyline(latlngs, polylineOptions);

            const polylineC = this.createAltitudeColoredPolyline(latlngs, maxAlt, minAlt);

            trailLayers.set(logIndex, { polyline, polylineC });

            homePosition = this.getHomeCoordinatesFromFlightLog(flightLog);
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
    };

    this.getPolylinesData = function () {
        const latlngs = [];
        let maxAlt = Number.MIN_VALUE;
        let minAlt = Number.MAX_VALUE;

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
                }
                frameCount++;
            }
        }
        return { latlngs, maxAlt, minAlt };
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
                myMap.fitBounds(polyline.getBounds());
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
        if (trailLayers.has(trailIndex)) {
            const p = trailLayers.get(trailIndex).polyline;
            const pc = trailLayers.get(trailIndex).polylineC;
            if (p) {
                myMap.removeLayer(p);
            }
            if (pc) {
                myMap.removeLayer(pc);
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
                myMap.invalidateSize();
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

    this.setCurrentTime = function (newTime) {
        currentTime = newTime;
        this.updateCurrentPosition();
        this.redrawAll();
    };
}
