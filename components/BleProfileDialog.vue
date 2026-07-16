<template>
    <UModal v-model:open="open" :title="title" :ui="{ content: 'overflow-visible' }">
        <template #body>
            <div class="ble-profile-dialog">
                <p class="ble-profile-dialog__help">
                    {{ $t("bleProfileDialogHelp") }}
                </p>

                <p v-if="scanning" class="ble-profile-dialog__scanning">{{ $t("bleScan") }}...</p>

                <p v-else-if="filteredDevices.length === 0" class="ble-profile-dialog__empty">
                    {{ $t("bleProfileDialogEmpty") }}
                </p>

                <label class="ble-profile-dialog__field" v-else>
                    <span>{{ $t("bleProfileDialogDevice") }}</span>
                    <USelect
                        :items="filteredDevices"
                        v-model="selectedDevicePath"
                        size="sm"
                        :ui="{ content: 'z-[9999] max-h-96' }"
                    />
                </label>
            </div>
        </template>
        <template #footer>
            <div class="ble-profile-dialog__actions">
                <UButton color="neutral" variant="soft" size="sm" @click="onCancel">
                    {{ $t("cancel") }}
                </UButton>
                <UButton color="primary" variant="soft" size="sm" :disabled="!selectedDevicePath" @click="onConnect">
                    {{ $t("connect") }}
                </UButton>
            </div>
        </template>
    </UModal>
</template>

<script>
import { defineComponent, computed, ref, watch } from "vue";
import { i18n } from "../../js/localization";
import PortHandler from "../../js/port_handler";
import { connectDisconnect } from "../../js/serial_backend";
import { serial } from "../../js/serial";

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

        const selectedDevicePath = ref("");
        const scanning = ref(false);

        /**
         * BLE 장치 목록을 가져와 필터링합니다.
         * 규칙:
         * 1. displayName이 없는 장치 (이름이 주소와 같은 경우) 제외
         * 2. SPP 장치로 간주되는 장치 제외
         */
        const filteredDevices = computed(() => {
            const ports = PortHandler.currentBluetoothPorts || [];
            const items = [];

            for (const d of ports) {
                // 필터 1: 이름이 없는 장치 제외 (displayName이 address와 동일한 경우)
                const hasName = d.displayName && d.displayName !== (d.address || "");
                if (!hasName) continue;

                // 필터 2: SPP 장치 제외
                const name = (d.displayName || "").toLowerCase();
                const isSppDevice =
                    name.includes("spp") ||
                    name.includes("hc-0") ||
                    name.includes("hc-1") ||
                    name.includes("hc 0") ||
                    name.includes("hc 1") ||
                    name.includes("linvor") ||
                    name.includes("ble-spp") ||
                    name.startsWith("rn42") ||
                    name.startsWith("rn41");
                if (isSppDevice) continue;

                items.push({
                    value: d.path,
                    label: d.displayName,
                    icon: "i-lucide-bluetooth",
                });
            }

            return items;
        });

        // 다이얼로그가 열릴 때 BLE 장치 스캔
        watch(
            () => props.modelValue,
            (isOpen) => {
                if (!isOpen) return;

                scanning.value = true;
                selectedDevicePath.value = "";

                // BLE 장치 스캔 실행
                serial.scanBLEDevices?.(() => {
                    scanning.value = false;
                    // 스캔 완료 후 자동 선택
                    if (filteredDevices.value.length > 0) {
                        selectedDevicePath.value = filteredDevices.value[0].value;
                    }
                });

                // 타임아웃 안전장치
                setTimeout(() => {
                    scanning.value = false;
                    if (!selectedDevicePath.value && filteredDevices.value.length > 0) {
                        selectedDevicePath.value = filteredDevices.value[0].value;
                    }
                }, 5000);
            },
        );

        function onCancel() {
            open.value = false;
        }

        function onConnect() {
            if (!selectedDevicePath.value) return;
            PortHandler.portPicker.selectedPort = selectedDevicePath.value;
            open.value = false;
            connectDisconnect();
        }

        return {
            open,
            title,
            selectedDevicePath,
            filteredDevices,
            scanning,
            onCancel,
            onConnect,
        };
    },
});
</script>

<style scoped>
.ble-profile-dialog {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: min(26rem, 80vw);
}

.ble-profile-dialog__help {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
}

.ble-profile-dialog__scanning {
    font-size: 0.875rem;
    color: var(--text-muted);
    font-style: italic;
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

.ble-profile-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
</style>
