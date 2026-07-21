<template>
    <BaseTab tab-name="flight_plan">
        <div class="content_wrapper flex flex-col">
            <!-- Title and Documentation -->
            <div class="cf_column flex-shrink-0">
                <div class="tab_title" v-html="$t('tabFlightPlan')"></div>
                <WikiButton docUrl="flight-plan" />
            </div>

            <div class="grid grid-cols-1 gap-6 grid-rows-[auto_auto_1fr] flex-1 min-h-0 overflow-hidden h-full">
                <div class="map-aspect-wrapper">
                    <FlightPlanMap class="flex-1" />
                </div>
                <div class="flex flex-col min-h-0 overflow-hidden">
                    <div class="profile-tabs">
                        <button
                            class="profile-tab"
                            :class="{ active: activeProfile === 'elevation' }"
                            @click="activeProfile = 'elevation'"
                        >
                            {{ $t("flightPlanElevationProfile") }}
                        </button>
                        <button
                            class="profile-tab"
                            :class="{ active: activeProfile === 'speed' }"
                            @click="activeProfile = 'speed'"
                        >
                            {{ $t("flightPlanSpeedProfile") }}
                        </button>
                    </div>
                    <ElevationProfile :active="activeProfile === 'elevation'" v-show="activeProfile === 'elevation'" />
                    <SpeedProfile :active="activeProfile === 'speed'" v-show="activeProfile === 'speed'" />
                </div>
                <div class="flex flex-col min-h-0 overflow-hidden h-full">
                    <WaypointList class="flex-1" />
                </div>
            </div>
        </div>

        <!-- Waypoint Editor Dialog -->
        <WaypointEditor />

        <!-- Clear Confirmation Dialog -->
        <Dialog v-model="showClearDialog" :title="$t('flightPlanClearTitle')">
            <p v-html="$t('flightPlanConfirmClear')"></p>

            <template #footer>
                <div class="flex gap-2 justify-end">
                    <UButton variant="soft" color="neutral" @click="showClearDialog = false">
                        {{ $t("cancel") }}
                    </UButton>
                    <UButton color="error" @click="confirmClear">
                        {{ $t("flightPlanClear") }}
                    </UButton>
                </div>
            </template>
        </Dialog>

        <!-- Load-from-FC Confirmation Dialog -->
        <Dialog v-model="showLoadPromptDialog" :title="$t('flightPlanLoadPromptTitle')" :closeable="false">
            <p v-html="$t('flightPlanLoadPromptBody')"></p>

            <template #footer>
                <div class="flex gap-2 justify-end">
                    <UButton variant="soft" color="neutral" @click="declineLoadFromFC">
                        {{ $t("flightPlanKeepLocal") }}
                    </UButton>
                    <UButton @click="confirmLoadFromFC">
                        {{ $t("flightPlanLoadFromFC") }}
                    </UButton>
                </div>
            </template>
        </Dialog>

        <!-- Bottom toolbar -->
        <div class="content_toolbar toolbar_fixed_bottom flex items-center gap-2">
            <UButton variant="soft" color="error" @click="handleClear">
                {{ $t("flightPlanClear") }}
            </UButton>
            <UButton variant="soft" :disabled="!canUseFC" :title="$t('flightPlanLoadFromFC')" @click="handleLoad">
                {{ $t("flightPlanLoad") }}
            </UButton>
            <UButton :disabled="!canUseFC" :title="$t('flightPlanSaveToFC')" @click="handleSave">
                {{ $t("save") }}
            </UButton>

            <div class="ml-auto flex items-center gap-1">
                <span class="text-xs text-surface-700">{{ $t("units") }}:</span>
                <UButton
                    variant="soft"
                    color="neutral"
                    size="xs"
                    :label="settings.unitMode === 'nautical' ? '🌊 ft/nm/kt' : '⚡ m/km/m·s'"
                    @click="settings.toggleUnitMode()"
                />
            </div>
        </div>
    </BaseTab>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import BaseTab from "./BaseTab.vue";
import WikiButton from "@/components/elements/WikiButton.vue";
import Dialog from "@/components/elements/Dialog.vue";
import WaypointList from "./FlightPlan/WaypointList.vue";
import WaypointEditor from "./FlightPlan/WaypointEditor.vue";
import FlightPlanMap from "./FlightPlan/FlightPlanMap.vue";
import ElevationProfile from "./FlightPlan/ElevationProfile.vue";
import SpeedProfile from "./FlightPlan/SpeedProfile.vue";
import { useFlightPlan } from "@/composables/useFlightPlan";
import { useConnectionStore } from "@/stores/connection";
import { useSettingsStore } from "@/stores/settings";
import FC from "@/js/fc";
import GUI from "@/js/gui";
import { gui_log } from "@/js/gui_log";
import { i18n } from "@/js/localization";

const { loadFromFC, saveToFC, clearOnFC, clearPlan, loadPlan, waypoints } = useFlightPlan();
const connectionStore = useConnectionStore();
const settings = useSettingsStore();
const showClearDialog = ref(false);
const showLoadPromptDialog = ref(false);
const activeProfile = ref("elevation"); // "elevation" | "speed"

const isConnected = computed(() => connectionStore.connectionValid);
const fcHasFlightPlan = computed(() => FC.CONFIG?.buildOptions?.includes("USE_FLIGHT_PLAN") ?? false);
const canUseFC = computed(() => isConnected.value && fcHasFlightPlan.value);

onMounted(async () => {
    loadPlan();

    if (canUseFC.value) {
        if (waypoints.value.length === 0) {
            await loadFromFC();
        } else {
            showLoadPromptDialog.value = true;
        }
    }

    GUI.content_ready();
});

const handleSave = async () => {
    if (!canUseFC.value) {
        return;
    }
    await saveToFC();
};

const handleLoad = async () => {
    if (!canUseFC.value) {
        return;
    }
    await loadFromFC();
};

const handleClear = () => {
    if (waypoints.value.length === 0) {
        gui_log(i18n.getMessage("flightPlanNoWaypoints") || "No waypoints to clear");
        return;
    }

    showClearDialog.value = true;
};

const confirmClear = async () => {
    clearPlan();
    if (canUseFC.value) {
        await clearOnFC();
    }
    showClearDialog.value = false;
};

const confirmLoadFromFC = async () => {
    showLoadPromptDialog.value = false;
    await loadFromFC();
};

const declineLoadFromFC = () => {
    showLoadPromptDialog.value = false;
};
</script>

<style scoped>
/* Bottom toolbar (CRITICAL: must be exactly 2rem) */
.content_toolbar.toolbar_fixed_bottom {
    position: fixed;
    bottom: 2rem;
}

/* Grid stabilization */
.grid {
    min-height: 0;
}

/* Map wrapper: width 기준으로 height 결정 */
/* 가로뷰(landscape): 2:1, 세로뷰(portrait): 1:1 */
.map-aspect-wrapper {
    width: 100%;
    aspect-ratio: 2 / 1;
    max-height: 55vh;
    min-height: 280px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

@media (orientation: portrait) {
    .map-aspect-wrapper {
        aspect-ratio: 1 / 1;
    }
}

/* UiBox fill + flex-1 propagation */
:deep(.flight-plan-map),
:deep(.waypoint-list) {
    height: 100% !important;
    display: flex;
    flex-direction: column;
}

/* Elevation profile: natural sizing, no forced height */
:deep(.elevation-profile),
:deep(.speed-profile) {
    display: flex;
    flex-direction: column;
}

/* Profile tab switcher */
.profile-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid var(--surface-300);
}

.profile-tab {
    flex: 1;
    padding: 0.35rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--surface-700);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
}

.profile-tab:hover {
    color: var(--surface-950);
    background: var(--surface-100);
}

.profile-tab.active {
    color: var(--primary-600);
    border-bottom-color: var(--primary-600);
    background: transparent;
}
</style>
