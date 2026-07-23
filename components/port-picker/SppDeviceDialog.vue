<template>
    <UModal v-model:open="open" :title="title" :ui="{ content: 'overflow-visible' }">
        <template #body>
            <div class="spp-device-dialog">
                <p class="spp-device-dialog__help">
                    {{ $t("sppDialogHelp") }}
                </p>

                <p v-if="scanning" class="spp-device-dialog__scanning">
                    {{ $t("sppDialogScanning") }}
                </p>

                <template v-else>
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

                    <div class="spp-device-dialog__actions-body" v-if="allDeviceItems.length === 0">
                        <UButton color="primary" variant="soft" size="sm" @click="onRequestPermission">
                            {{ $t("portsSelectPermission") }}
                        </UButton>
                    </div>
                </template>
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
        const scanning = ref(false);

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

        async function scanDevices() {
            scanning.value = true;
            try {
                // 시리얼 장치 목록 갱신
                await PortHandler.updateDeviceList("serial");
            } catch (e) {
                console.error("[SPP] Error scanning devices:", e);
            } finally {
                scanning.value = false;
            }
        }

        // 다이얼로그가 열릴 때 장치 스캔 + 현재 선택된 장치 자동 선택
        watch(
            () => props.modelValue,
            async (isOpen) => {
                if (!isOpen) return;

                // 장치 목록 새로고침
                await scanDevices();

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

        async function onRequestPermission() {
            // 브라우저의 Web Serial API 권한 요청 UI 호출 (크롬 네이티브 시리얼 포트 선택기)
            await PortHandler.requestDevicePermission("serial");
            // 권한 부여 후 다시 스캔
            await scanDevices();
        }

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
            scanning,
            allDeviceItems,
            connect,
            onRequestPermission,
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

.spp-device-dialog__scanning {
    font-size: 0.875rem;
    color: var(--text-muted);
    font-style: italic;
    margin: 0;
}

.spp-device-dialog__actions-body {
    display: flex;
    justify-content: center;
    margin-top: 0.5rem;
}
</style>
