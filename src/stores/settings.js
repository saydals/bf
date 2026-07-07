import { defineStore } from "pinia";
import { ref, watch } from "vue";

const STORAGE_KEY = "bfSettings";

// Unit conversion constants (storage → display)
// Storage: altitude = feet, speed = knots, distance = meters
const FT_TO_M = 0.3048;
const KT_TO_KMH = 1.852;
const KT_TO_MPS = 0.514444; // 1 knot = 0.514444 m/s
const M_TO_NM = 1 / 1852;
const M_TO_KM = 1 / 1000;

export const useSettingsStore = defineStore("settings", () => {
    // Load persisted state or use defaults
    const stored = (() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    })();

    const unitMode = ref(stored.unitMode ?? "nautical"); // "metric" or "nautical"
    const altitudeUnit = ref(stored.altitudeUnit ?? "ft"); // "m" or "ft"
    const distanceUnit = ref(stored.distanceUnit ?? "nm"); // "km" or "nm"
    const speedUnit = ref(stored.speedUnit ?? "kt"); // "kmh" or "kt"

    function saveSettings() {
        const payload = {
            unitMode: unitMode.value,
            altitudeUnit: altitudeUnit.value,
            distanceUnit: distanceUnit.value,
            speedUnit: speedUnit.value,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }

    // Auto-persist on change
    watch([unitMode, altitudeUnit, distanceUnit, speedUnit], saveSettings, { deep: true });

    function toggleUnitMode() {
        if (unitMode.value === "nautical") {
            unitMode.value = "metric";
            altitudeUnit.value = "m";
            distanceUnit.value = "km";
            speedUnit.value = "kmh";
        } else {
            unitMode.value = "nautical";
            altitudeUnit.value = "ft";
            distanceUnit.value = "nm";
            speedUnit.value = "kt";
        }
    }

    // ============================================================
    // Converter functions
    // All *Display functions take storage-unit values and return
    // display strings in the current unit mode.
    // ============================================================

    /**
     * Format altitude from storage (feet) to display string.
     * @param {number} ft - altitude in feet (storage unit)
     * @returns {string} e.g. "400ft" or "122m"
     */
    function formatAltitude(ft) {
        if (altitudeUnit.value === "m") {
            return `${Math.round(ft * FT_TO_M)}m`;
        }
        return `${Math.round(ft)}ft`;
    }

    /**
     * Format speed from storage (knots) to display string.
     * @param {number} kt - speed in knots (storage unit)
     * @returns {string} e.g. "10kt" or "18.5km/h"
     */
    function formatSpeed(kt) {
        if (speedUnit.value === "kmh") {
            return `${(kt * KT_TO_KMH).toFixed(1)}km/h`;
        }
        return `${kt.toFixed(1)}kt`;
    }

    /**
     * Format distance from meters to display string.
     * @param {number} meters - distance in meters (Haversine result)
     * @returns {string} e.g. "0.54nm" or "1.00km"
     */
    function formatDistance(meters) {
        if (distanceUnit.value === "km") {
            return `${(meters * M_TO_KM).toFixed(2)}km`;
        }
        return `${(meters * M_TO_NM).toFixed(2)}nm`;
    }

    /**
     * Convert a display-altitude value to storage (feet).
     * @param {number} val - value entered by user in current display unit
     * @returns {number} value in feet (storage unit)
     */
    function displayAltToStorage(val) {
        if (altitudeUnit.value === "m") {
            return Math.round(val / FT_TO_M);
        }
        return Math.round(val);
    }

    /**
     * Convert a display-speed value to storage (knots).
     * @param {number} val - value entered by user in current display unit
     * @returns {number} value in knots (storage unit)
     */
    function displaySpeedToStorage(val) {
        if (speedUnit.value === "kmh") {
            return val / KT_TO_KMH;
        }
        return val;
    }

    /**
     * Format speed from storage (knots) to m/s display string.
     * FlightPlan uses m/s as the primary speed unit regardless of unitMode.
     * @param {number} kt - speed in knots (storage unit)
     * @returns {string} e.g. "5.1 m/s"
     */
    function formatSpeedMps(kt) {
        return `${(kt * KT_TO_MPS).toFixed(1)} m/s`;
    }

    /**
     * Convert m/s display value to storage (knots).
     * @param {number} mps - speed in m/s
     * @returns {number} speed in knots (storage unit)
     */
    function mpsToStorage(mps) {
        return mps / KT_TO_MPS;
    }

    /**
     * Convert storage (knots) to m/s display value.
     * @param {number} kt - speed in knots (storage unit)
     * @returns {number} speed in m/s
     */
    function storageToMps(kt) {
        return kt * KT_TO_MPS;
    }

    /**
     * Get altitude unit symbol for labels.
     * @returns {string} "ft" or "m"
     */
    function altitudeSymbol() {
        return altitudeUnit.value;
    }

    /**
     * Get speed unit symbol for labels.
     * @returns {string} "kt" or "km/h"
     */
    function speedSymbol() {
        return speedUnit.value === "kmh" ? "km/h" : "kt";
    }

    /**
     * Get distance unit symbol for labels.
     * @returns {string} "nm" or "km"
     */
    function distanceSymbol() {
        return distanceUnit.value;
    }

    return {
        unitMode,
        altitudeUnit,
        distanceUnit,
        speedUnit,
        toggleUnitMode,
        saveSettings,
        // Converter functions
        formatAltitude,
        formatSpeed,
        formatSpeedMps,
        formatDistance,
        displayAltToStorage,
        displaySpeedToStorage,
        mpsToStorage,
        storageToMps,
        altitudeSymbol,
        speedSymbol,
        distanceSymbol,
    };
});
