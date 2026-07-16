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
         * 블루투스 검색으로 보여주는 모든 BLE 장치 목록을 필터링 없이 표시
         */
        const filteredDevices = computed(() => {
            const ports = PortHandler.currentBluetoothPorts || [];
            const items = [];

            for (const d of ports) {
                const label = d.displayName || d.address || d.path;
                items.push({
                    value: d.path,
                    label: label,
                    icon: "i-lucide-bluetooth",
                });
            }

            return items;
        });

        // 다이얼로그가 열릴 때 BLE 장치 스캔 실행
        watch(
            () => props.modelValue,
            async (isOpen) => {
                if (!isOpen) return;

                scanning.value = true;
                selectedDevicePath.value = "";

                await PortHandler.updateDeviceList("bluetooth");

                scanning.value = false;
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
