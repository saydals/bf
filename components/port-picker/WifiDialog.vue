<template>
    <UModal v-model:open="open" :title="$t('wifiDialogTitle')">
        <template #body>
            <div class="wifi-dialog">
                <p class="wifi-dialog__help">
                    {{ $t("wifiDialogHelp") }}
                </p>

                <p v-if="scanning" class="wifi-dialog__scanning">네트워크에서 장치를 검색 중...</p>

                <div v-if="foundDevices.length > 0" class="wifi-dialog__list">
                    <div class="wifi-dialog__list-title">발견된 장치:</div>
                    <div
                        v-for="d in foundDevices"
                        :key="d.address"
                        class="wifi-dialog__item"
                        :class="{ 'wifi-dialog__item--selected': selectedAddress === d.address }"
                        @click="selectedAddress = d.address"
                    >
                        <span class="wifi-dialog__item-icon">🌐</span>
                        <span class="wifi-dialog__item-label">{{ d.label }}</span>
                    </div>
                </div>

                <p v-if="!scanning && foundDevices.length === 0 && !error" class="wifi-dialog__empty">
                    장치를 찾을 수 없습니다. 아래에 주소를 직접 입력하세요.
                </p>

                <p v-if="error" class="wifi-dialog__error">{{ error }}</p>
                <p v-if="savedAddress && error" class="wifi-dialog__saved">
                    {{ $t("wifiSavedAddress") }}: {{ savedAddress }}
                </p>

                <div class="wifi-dialog__manual">
                    <span class="wifi-dialog__manual-label">── 또는 직접 입력 ──</span>
                    <UInput v-model="manualAddress" size="sm" placeholder="tcp://10.3.2.1" autofocus />
                </div>
            </div>
        </template>
        <template #footer>
            <div class="wifi-dialog__actions">
                <UButton color="neutral" variant="soft" size="sm" @click="onCancel">
                    {{ $t("cancel") }}
                </UButton>
                <UButton
                    color="success"
                    variant="soft"
                    size="sm"
                    :disabled="!canConnect && !selectedAddress"
                    @click="onConnect"
                >
                    {{ $t("connect") }}
                </UButton>
            </div>
        </template>
    </UModal>
</template>

<script>
import { defineComponent, computed, ref, watch } from "vue";
import { scanNetwork } from "../../js/utils/networkScan";
import PortHandler from "../../js/port_handler";
import { connectDisconnect } from "../../js/serial_backend";

export default defineComponent({
    name: "WifiDialog",
    props: {
        modelValue: { type: Boolean, default: false },
        savedAddress: { type: String, default: "" },
        error: { type: String, default: "" },
    },
    emits: ["update:modelValue", "connect"],
    setup(props, { emit }) {
        const open = computed({
            get: () => props.modelValue,
            set: (v) => emit("update:modelValue", v),
        });

        const scanning = ref(false);
        const foundDevices = ref([]);
        const selectedAddress = ref("");
        const manualAddress = ref("");

        const canConnect = computed(() => {
            return manualAddress.value.trim().length > 0;
        });

        watch(
            () => props.modelValue,
            async (isOpen) => {
                if (!isOpen) return;

                scanning.value = true;
                foundDevices.value = [];
                selectedAddress.value = "";
                manualAddress.value = props.savedAddress || "tcp://10.3.2.1";

                // 자동 스캔 실행
                const devices = await scanNetwork();
                foundDevices.value = devices;
                scanning.value = false;

                // 발견된 장치가 있으면 첫 번째 자동 선택
                if (devices.length > 0) {
                    selectedAddress.value = devices[0].address;
                }
            },
        );

        function onCancel() {
            open.value = false;
        }

        function onConnect() {
            const address = selectedAddress.value || manualAddress.value.trim();
            if (!address) return;
            open.value = false;
            PortHandler.portPicker.selectedPort = address;
            connectDisconnect();
        }

        return {
            open,
            scanning,
            foundDevices,
            selectedAddress,
            manualAddress,
            canConnect,
            onCancel,
            onConnect,
        };
    },
});
</script>

<style scoped>
.wifi-dialog {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: min(26rem, 80vw);
}

.wifi-dialog__help {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
}

.wifi-dialog__scanning {
    font-size: 0.875rem;
    color: var(--text-muted);
    font-style: italic;
    margin: 0;
}

.wifi-dialog__empty {
    font-size: 0.875rem;
    color: var(--warning-foreground);
    background: var(--warning);
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    margin: 0;
}

.wifi-dialog__error {
    margin: 0;
    color: var(--error-600);
    font-size: 0.875rem;
    font-weight: 600;
}

.wifi-dialog__saved {
    margin: 0;
    color: var(--text);
    opacity: 0.7;
    font-size: 0.8rem;
    font-family: monospace;
}

.wifi-dialog__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 14rem;
    overflow-y: auto;
}

.wifi-dialog__list-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
    opacity: 0.7;
    margin-bottom: 0.125rem;
}

.wifi-dialog__item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: background 0.15s;
}

.wifi-dialog__item:hover {
    background: var(--muted-200);
}

html.dark .wifi-dialog__item:hover {
    background: var(--muted-800);
}

.wifi-dialog__item--selected {
    background: var(--primary-100);
    border: 1px solid var(--primary-400);
}

html.dark .wifi-dialog__item--selected {
    background: var(--primary-900);
    border: 1px solid var(--primary-600);
}

.wifi-dialog__item-icon {
    font-size: 1rem;
    line-height: 1;
}

.wifi-dialog__item-label {
    font-size: 0.875rem;
    font-weight: 500;
    font-family: monospace;
}

.wifi-dialog__manual {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
}

.wifi-dialog__manual-label {
    font-size: 0.75rem;
    text-align: center;
    color: var(--text);
    opacity: 0.5;
}

.wifi-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
</style>
