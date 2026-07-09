<template>
    <UModal v-model:open="open" :title="title" :ui="{ content: 'overflow-visible' }">
        <template #body>
            <div class="ble-profile-dialog">
                <p class="ble-profile-dialog__help">
                    {{ $t("bleProfileDialogHelp") }}
                </p>

                <p v-if="allDeviceItems.length === 0" class="ble-profile-dialog__empty">
                    {{ $t("bleProfileDialogEmpty") }}
                </p>

                <label class="ble-profile-dialog__field" v-if="allDeviceItems.length > 0">
                    <span>{{ $t("bleProfileDialogDevice") }}</span>
                    <USelect
                        :items="allDeviceItems"
                        v-model="selectedDeviceKey"
                        size="sm"
                        :ui="{ content: 'z-[9999] max-h-96' }"
                    />
                </label>

                <label class="ble-profile-dialog__field">
                    <span>{{ $t("bleProfileDialogProfile") }}</span>
                    <USelect
                        :items="profileItems"
                        v-model="selectedProfile"
                        :disabled="!selectedDeviceKey"
                        size="sm"
                        :ui="{ content: 'z-[9999] max-h-96' }"
                    />
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
import PortHandler from "../../js/port_handler";

const OVERRIDE_STORAGE_KEY = "bleProfileOverrides";

export default defineComponent({
    name: "BleProfileDialog",
    props: {
        modelValue: {
            type: Boolean,
            required: true,
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

        const allDeviceItems = computed(() => {
            const items = [];

            // 1) 현재 스캔된 기기 (address를 키로 사용)
            const ports = PortHandler.currentBluetoothPorts || [];
            for (const d of ports) {
                const key = d.address || d.path;
                items.push({ value: key, label: d.displayName || key });
            }

            // 2) 이전 저장된 오버라이드 기기 중 스캔 목록에 없는 것
            const stored = getConfig(OVERRIDE_STORAGE_KEY)?.[OVERRIDE_STORAGE_KEY] ?? {};
            const scannedKeys = new Set(items.map((d) => d.value));
            for (const key of Object.keys(stored)) {
                if (!scannedKeys.has(key)) {
                    items.push({ value: key, label: `${stored[key]} (${key})` });
                }
            }

            return items;
        });

        const profileItems = computed(() =>
            getSelectableProfiles().map((p) => ({
                value: p.name,
                label: p.label,
            })),
        );

        watch(selectedDeviceKey, (newKey) => {
            const override = getProfileOverride(newKey);
            selectedProfile.value = override?.name ?? "";
        });

        // 다이얼로그가 열릴 때 현재 선택된 블루투스 기기를 자동 선택
        watch(
            () => props.modelValue,
            (isOpen) => {
                if (!isOpen) return;

                const currentPath = PortHandler.portPicker.selectedPort;
                if (currentPath?.startsWith("bluetooth")) {
                    const currentPort = (PortHandler.currentBluetoothPorts || []).find((p) => p.path === currentPath);
                    if (currentPort) {
                        selectedDeviceKey.value = currentPort.address || currentPort.path;
                        return;
                    }
                }

                selectedDeviceKey.value = allDeviceItems.value[0]?.value ?? "";
            },
        );

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
            allDeviceItems,
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
