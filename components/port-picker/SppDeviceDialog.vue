<template>
    <UModal v-model:open="open" :title="$t('sppDialogTitle')">
        <template #body>
            <div class="spp-dialog">
                <p class="spp-dialog__help">
                    {{ $t("sppDialogHelp") }}
                </p>

                <p v-if="scanning" class="spp-dialog__scanning">
                    {{ $t("sppDialogScanning") }}
                </p>

                <p v-else-if="sppDevices.length === 0" class="spp-dialog__empty">
                    {{ $t("sppDialogEmpty") }}
                </p>

                <label class="spp-dialog__field" v-else>
                    <span>{{ $t("sppDialogDevice") }}</span>
                    <USelect
                        :items="sppDevices"
                        v-model="selectedDevicePath"
                        size="sm"
                        :ui="{ content: 'z-[9999] max-h-96' }"
                    />
                </label>
            </div>
        </template>
        <template #footer>
            <div class="spp-dialog__actions">
                <UButton color="neutral" variant="soft" size="sm" @click="onCancel">
                    {{ $t("cancel") }}
                </UButton>
                <UButton color="success" variant="soft" size="sm" :disabled="!selectedDevicePath" @click="onConnect">
                    {{ $t("connect") }}
                </UButton>
            </div>
        </template>
    </UModal>
</template>

<script>
import { defineComponent, computed, ref, watch } from "vue";
import PortHandler from "../../js/port_handler";
import { connectDisconnect } from "../../js/serial_backend";

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

        const selectedDevicePath = ref("");
        const scanning = ref(false);

        const sppDevices = computed(() => {
            // 시스템에 등록된 모든 블루투스 장치 목록을 표시
            const devices = [];
            const btPorts = PortHandler.currentBluetoothPorts || [];

            for (const d of btPorts) {
                const label = d.displayName || d.address || d.path;
                devices.push({
                    value: d.path,
                    label: label,
                    icon: "i-lucide-bluetooth",
                });
            }

            // 시리얼 포트도 함께 표시
            const serialPorts = PortHandler.currentSerialPorts || [];
            for (const d of serialPorts) {
                const label = d.displayName || d.path;
                if (!devices.some((dev) => dev.value === d.path)) {
                    devices.push({
                        value: d.path,
                        label: label,
                        icon: "i-lucide-usb",
                    });
                }
            }

            return devices;
        });

        // 다이얼로그가 열릴 때 자동 선택
        watch(
            () => props.modelValue,
            (isOpen) => {
                if (!isOpen) return;

                scanning.value = true;
                selectedDevicePath.value = "";

                // 장치 목록 갱신 후 첫 번째 항목 선택
                setTimeout(() => {
                    scanning.value = false;
                    if (sppDevices.value.length > 0) {
                        selectedDevicePath.value = sppDevices.value[0].value;
                    }
                }, 300);
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
            selectedDevicePath,
            sppDevices,
            scanning,
            onCancel,
            onConnect,
        };
    },
});
</script>

<style scoped>
.spp-dialog {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: min(26rem, 80vw);
}

.spp-dialog__help {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
}

.spp-dialog__scanning {
    font-size: 0.875rem;
    color: var(--text-muted);
    font-style: italic;
    margin: 0;
}

.spp-dialog__empty {
    font-size: 0.875rem;
    color: var(--warning-foreground);
    background: var(--warning);
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    margin: 0;
}

.spp-dialog__field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.spp-dialog__field span {
    font-size: 0.875rem;
    font-weight: 600;
}

.spp-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
</style>
