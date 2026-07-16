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

                <div v-else class="ble-profile-dialog__list">
                    <div
                        v-for="d in filteredDevices"
                        :key="d.value"
                        class="ble-profile-dialog__item"
                        :class="{ 'ble-profile-dialog__item--selected': selectedDevicePath === d.value }"
                        @click="selectedDevicePath = d.value"
                    >
                        <span class="ble-profile-dialog__item-icon">🔗</span>
                        <span class="ble-profile-dialog__item-label">{{ d.label }}</span>
                    </div>
                </div>
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

        const filteredDevices = computed(() => {
            const ports = PortHandler.currentBluetoothPorts || [];
            const items = [];

            for (const d of ports) {
                const label = d.displayName || d.address || d.path;
                items.push({
                    value: d.path,
                    label: label,
                });
            }

            return items;
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

.ble-profile-dialog__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 18rem;
    overflow-y: auto;
}

.ble-profile-dialog__item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: background 0.15s;
}

.ble-profile-dialog__item:hover {
    background: var(--muted-200);
}

html.dark .ble-profile-dialog__item:hover {
    background: var(--muted-800);
}

.ble-profile-dialog__item--selected {
    background: var(--primary-100);
    border: 1px solid var(--primary-400);
}

html.dark .ble-profile-dialog__item--selected {
    background: var(--primary-900);
    border: 1px solid var(--primary-600);
}

.ble-profile-dialog__item-icon {
    font-size: 1.1rem;
    line-height: 1;
}

.ble-profile-dialog__item-label {
    font-size: 0.875rem;
    font-weight: 500;
}

.ble-profile-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
</style>
