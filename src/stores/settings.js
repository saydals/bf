import { defineStore } from "pinia";
import { ref, watch } from "vue";

const STORAGE_KEY = "bfSettings";

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

    return {
        unitMode,
        altitudeUnit,
        distanceUnit,
        speedUnit,
        toggleUnitMode,
        saveSettings,
    };
});
