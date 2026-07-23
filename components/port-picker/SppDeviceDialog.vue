<template>
    <UModal v-model:open="open" :title="title" :ui="{ content: 'overflow-visible' }">
        <template #body>
            <div class="spp-device-dialog">
                <p class="spp-device-dialog__help">
                    {{ $t("sppDialogHelp") }}
                </p>

                <p v-if="allDeviceItems.length === 0" class="spp-device-dialog__empty">
                    {{ $t("sppDialogEmpty") }}
                </p>

                <label class="spp-device-dialog__field" v-if="allDeviceItems.length > 0">
                    <span>{{ $t("sppDialogDevice") }}</span>
                    <USelect
                        :items="allDeviceItems"
                        v-model="selectedDevicePath"
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
            <UButton color="primary" :disabled="!selectedDevicePath" @click="connect">
                {{ $t("connect") }}
            </UButton>
        </template>
    </UModal>
</template>

<script>
import { defineComponent, computed, ref, watch } from "vue";
import { get as getConfig } from "../../js/ConfigStorage";
import { i18n } from "../../js/localization";
import PortHandler from "../../js/port_handler";
import { connectDisconnect } from "../../js/serial_backend";

const OVERRIDE_STORAGE_KEY = "sppDeviceOverrides";

export default defineComponent({
    name: "SppDeviceDialog",
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

        const title = computed(() => i18n.getMessage("sppDialogTitle"));

        const selectedDevicePath = ref("");

        const allDeviceItems = computed(() => {
            const items = [];

            // 1) 현재 스캔된 시리얼 장치 (SPP는 시리얼 포트 프로토콜)
            const serialPorts = PortHandler.currentSerialPorts || [];
            for (const d of serialPorts) {
                const label = d.displayName || d.path;
                items.push({ value: d.path, label: label });
            }

            // 2) 이전 저장된 오버라이드 장치 중 스캔 목록에 없는 것
            const stored = getConfig(OVERRIDE_STORAGE_KEY)?.[OVERRIDE_STORAGE_KEY] ?? {};
            const scannedKeys = new Set(items.map((d) => d.value));
            for (const key of Object.keys(stored)) {
                if (!scannedKeys.has(key)) {
                    items.push({ value: key, label: `${stored[key]} (${key})` });
                }
            }

            return items;
        });

        // 다이얼로그가 열릴 때 현재 선택된 시리얼 장치를 자동 선택
        watch(
            () => props.modelValue,
            (isOpen) => {
                if (!isOpen) return;

                const currentPath = PortHandler.portPicker.selectedPort;
                if (currentPath?.startsWith("serial") || currentPath?.startsWith("bluetooth")) {
                    const currentPort = (PortHandler.currentSerialPorts || []).find((p) => p.path === currentPath);
                    if (currentPort) {
                        selectedDevicePath.value = currentPort.path;
                        return;
                    }
                }

                selectedDevicePath.value = allDeviceItems.value[0]?.value ?? "";
            },
        );

        function connect() {
            if (!selectedDevicePath.value) return;
            PortHandler.portPicker.selectedPort = selectedDevicePath.value;
            open.value = false;
            connectDisconnect();
        }

        return {
            open,
            title,
            selectedDevicePath,
            allDeviceItems,
            connect,
        };
    },
});
</script>

<style scoped>
.spp-device-dialog {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.spp-device-dialog__help {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
}

.spp-device-dialog__empty {
    font-size: 0.875rem;
    color: var(--warning-foreground);
    background: var(--warning);
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    margin: 0;
}

.spp-device-dialog__field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.spp-device-dialog__field span {
    font-size: 0.875rem;
    font-weight: 600;
}
</style>
