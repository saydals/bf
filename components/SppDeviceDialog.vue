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

                <div v-else class="spp-dialog__list">
                    <div
                        v-for="d in sppDevices"
                        :key="d.value"
                        class="spp-dialog__item"
                        :class="{ 'spp-dialog__item--selected': selectedDevicePath === d.value }"
                        @click="selectedDevicePath = d.value"
                    >
                        <span class="spp-dialog__item-icon">🔗</span>
                        <span class="spp-dialog__item-label">{{ d.label }}</span>
                    </div>
                </div>
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
            const devices = [];
            const btPorts = PortHandler.currentBluetoothPorts || [];

            for (const d of btPorts) {
                const label = d.displayName || d.address || d.path;
                devices.push({
                    value: d.path,
                    label: label,
                });
            }

            return devices;
        });

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

.spp-dialog__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 18rem;
    overflow-y: auto;
}

.spp-dialog__item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: background 0.15s;
}

.spp-dialog__item:hover {
    background: var(--muted-200);
}

html.dark .spp-dialog__item:hover {
    background: var(--muted-800);
}

.spp-dialog__item--selected {
    background: var(--primary-100);
    border: 1px solid var(--primary-400);
}

html.dark .spp-dialog__item--selected {
    background: var(--primary-900);
    border: 1px solid var(--primary-600);
}

.spp-dialog__item-icon {
    font-size: 1.1rem;
    line-height: 1;
}

.spp-dialog__item-label {
    font-size: 0.875rem;
    font-weight: 500;
}

.spp-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
</style>
