<template>
    <BaseTab tab-name="flight_plan">
        <div class="content_wrapper flex flex-col">
            <!-- Title and Documentation -->
            <div class="cf_column flex-shrink-0">
                <div class="tab_title" v-html="$t('tabFlightPlan')"></div>
                <WikiButton docUrl="flight-plan" />
            </div>

            <!-- Responsive Grid with Map Aspect Ratio Control -->
            <div class="flight-plan-grid grid grid-cols-1 gap-6 flex-1 min-h-0 overflow-hidden h-full">
                <!-- Map Area -->
                <div class="map-section flex flex-col min-h-0 overflow-hidden rounded-lg border border-surface-200">
                    <FlightPlanMap class="flex-1" />
                </div>

                <!-- Elevation Profile -->
                <div class="flex flex-col min-h-0 overflow-hidden rounded-lg border border-surface-200">
                    <ElevationProfile class="flex-1" />
                </div>

                <!-- Waypoint List -->
                <div class="flex flex-col min-h-0 overflow-hidden rounded-lg border border-surface-200">
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

/* UiBox fill + flex-1 propagation */
:deep(.flight-plan-map),
:deep(.elevation-profile),
:deep(.waypoint-list) {
    height: 100% !important;
    display: flex;
    flex-direction: column;
}

/* Responsive Flight Plan Grid */
.flight-plan-grid {
    grid-template-rows: minmax(280px, 2.6fr) minmax(160px, 1.2fr) minmax(200px, 2fr);
}

/* 가로 화면 (Landscape) - 맵을 2:1 비율로 크게 */
@media (min-aspect-ratio: 4/3) or (min-width: 1024px) {
    .flight-plan-grid {
        grid-template-rows: minmax(320px, 3.2fr) minmax(150px, 1fr) minmax(180px, 1.8fr);
    }

    .map-section {
        min-height: 340px !important; /* 가로에서 맵 최소 높이 보장 */
    }
}

/* 세로 화면 (Portrait) - 맵을 1:1 비율에 가깝게 */
@media (max-aspect-ratio: 4/3) or (max-width: 900px) {
    .flight-plan-grid {
        grid-template-rows: minmax(280px, 1.8fr) minmax(160px, 1.1fr) minmax(220px, 2.1fr);
    }
}

.map-section {
    transition: min-height 0.2s ease;
}
</style>
