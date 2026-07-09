<template>
    <UModal v-model:open="open" :title="title" :ui="{ overlay: 'z-3000', content: 'z-3001' }">
        <template #body>
            <div class="ble-profile-dialog">
                <p class="ble-profile-dialog__help">
                    {{ $t("bleProfileDialogHelp") }}
                </p>

                <p
                    v-if="deviceItems.length === 0 && overrideOnlyDevices.length === 0"
                    class="ble-profile-dialog__empty"
                >
                    {{ $t("bleProfileDialogEmpty") }}
                </p>

                <label
                    class="ble-profile-dialog__field"
                    v-if="deviceItems.length > 0 || overrideOnlyDevices.length > 0"
                >
                    <span>{{ $t("bleProfileDialogDevice") }}</span>
                    <USelect
                        :items="[...deviceItems, ...overrideOnlyDevices]"
                        v-model="selectedDeviceKey"
                        size="sm"
                        :ui="{ content: 'max-h-96' }"
                    />
                </label>

                <label class="ble-profile-dialog__field" v-if="selectedDeviceKey">
                    <span>{{ $t("bleProfileDialogProfile") }}</span>
                    <USelect :items="profileItems" v-model="selectedProfile" size="sm" :ui="{ content: 'max-h-96' }" />
                </label>
            </div>
        </template>
        <template #footer>
            <UButton color="neutral" variant="soft" @click="open = false">
                {{ $t("cancel") }}
            </UButton>
            <UButton color="primary" :disabled="!selectedDeviceKey" @click="save">
                {{ $t("save") }}
            </UButton>
        </template>
    </UModal>
</template>

<script>
import { defineComponent, computed, ref, watch } from "vue";
import { getProfileOverride, setProfileOverride, getSelectableProfiles } from "../../js/protocols/blePreferences";
import { get as getConfig } from "../../js/ConfigStorage";
import { i18n } from "../../js/localization";

const OVERRIDE_STORAGE_KEY = "bleProfileOverrides";

export default defineComponent({
    name: "BleProfileDialog",
    props: {
        modelValue: {
            type: Boolean,
            required: true,
        },
        bluetoothPorts: {
            type: Array,
            default: () => [],
        },
    },
    emits: ["update:modelValue"],
    setup(props, { emit }) {
        const open = computed({
            get: () => props.modelValue,
            set: (v) => emit("update:modelValue", v),
        });

        const title = computed(() => i18n.getMessage("bleProfileDialogTitle"));

        const selectedDeviceKey = ref("");
        const selectedProfile = ref("");

        // 기기 목록: 현재 검색된 블루투스 기기 (address=MAC을 키로 사용)
        const deviceItems = computed(() =>
            (props.bluetoothPorts || []).map((d) => ({
                value: d.address || d.path,
                label: d.displayName || d.path,
            })),
        );

        // 이전에 오버라이드 저장된 기기 중 현재 스캔 목록에 없는 것도 표시
        const overrideOnlyDevices = computed(() => {
            const stored = getConfig(OVERRIDE_STORAGE_KEY)?.[OVERRIDE_STORAGE_KEY] ?? {};
            const scannedKeys = new Set(deviceItems.value.map((d) => d.value));
            return Object.keys(stored)
                .filter((key) => !scannedKeys.has(key))
                .map((key) => ({
                    value: key,
                    label: `${stored[key]} (${key})`,
                }));
        });

        // 프로필 목록: 자동 감지 + 모든 등록된 BLE 프로필 (value=프로필명, label=표시명)
        const profileItems = computed(() =>
            getSelectableProfiles().map((p) => ({
                value: p.name,
                label: p.label,
            })),
        );

        // 기기 변경 시 저장된 오버라이드 불러오기
        watch(selectedDeviceKey, (newKey) => {
            const override = getProfileOverride(newKey);
            selectedProfile.value = override?.name ?? "";
        });

        function save() {
            if (!selectedDeviceKey.value) return;
            setProfileOverride(selectedDeviceKey.value, selectedProfile.value || null);
            open.value = false;
        }

        return {
            open,
            title,
            selectedDeviceKey,
            selectedProfile,
            deviceItems,
            overrideOnlyDevices,
            profileItems,
            save,
        };
    },
});
</script>

<style scoped>
.ble-profile-dialog {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.ble-profile-dialog__help {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
}

.ble-profile-dialog__empty {
    font-size: 0.875rem;
    color: var(--warning-foreground);
    background: var(--warning);
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    margin: 0;
}

.ble-profile-dialog__field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.ble-profile-dialog__field span {
    font-size: 0.875rem;
    font-weight: 600;
}
</style>
