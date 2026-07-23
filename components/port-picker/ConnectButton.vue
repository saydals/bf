<template>
    <div class="sidebar-connect">
        <UButton
            v-if="isConnected"
            block
            color="error"
            variant="soft"
            icon="i-lucide-link-2-off"
            size="sm"
            :loading="connecting"
            :title="disconnectLabel"
            @click="onDisconnectClick"
        >
            <span class="sidebar-connect__label">{{ disconnectLabel }}</span>
        </UButton>
        <UFieldGroup v-else size="sm" orientation="horizontal" class="sidebar-connect__group w-full !flex">
            <UButton
                class="sidebar-connect__main"
                block
                color="success"
                variant="soft"
                icon="i-lucide-link-2"
                :loading="connecting"
                :disabled="portPickerDisabled"
                :title="mainLabel"
                @click="onConnectClick"
            >
                <span class="sidebar-connect__label">{{ mainLabel }}</span>
            </UButton>
            <UDropdownMenu
                v-slot="{ open }"
                :items="menuItems"
                :content="{ align: 'end', side: 'top' }"
                :ui="{ content: 'max-h-96 z-[2100]' }"
            >
                <UButton
                    color="success"
                    variant="soft"
                    :icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    square
                    :disabled="portPickerDisabled"
                    :aria-label="$t('connect')"
                />
            </UDropdownMenu>
        </UFieldGroup>
        <ConnectOptionsDialog
            v-model="dialogOpen"
            :mode="dialogMode"
            :initial-version="portPicker.virtualMspVersion"
            :initial-port-override="portPicker.portOverride"
            @confirm="onDialogConfirm"
        />
        <SppDeviceDialog v-model="sppDialogOpen" />
        <WifiDialog
            v-model="wifiDialogOpen"
            :saved-address="wifiAddress"
            :error="wifiError"
            @connect="onWifiDialogConnect"
        />
    </div>
</template>

<script>
import { defineComponent, computed, ref, onMounted, onUnmounted } from "vue";
import { useConnectionStore } from "../../stores/connection";
import PortHandler from "../../js/port_handler";
import { connectDisconnect, disconnect } from "../../js/serial_backend";
import { i18n } from "../../js/localization";
import { get as getConfig, set as setConfig } from "../../js/ConfigStorage";
import { isExpertModeEnabled } from "../../js/utils/isExpertModeEnabled";
import { EventBus } from "../eventBus";
import ConnectOptionsDialog from "./ConnectOptionsDialog.vue";
import SppDeviceDialog from "./SppDeviceDialog.vue";
import WifiDialog from "./WifiDialog.vue";

function selectAndConnect(path) {
    PortHandler.portPicker.selectedPort = path;
    connectDisconnect();
}

function onDialogConfirm({ mode, version, portOverride }) {
    if (mode === "virtual") {
        PortHandler.portPicker.virtualMspVersion = version;
        setConfig({ virtualMspVersion: version });
        selectAndConnect("virtual");
    } else {
        PortHandler.portPicker.portOverride = portOverride;
        setConfig({ portOverride });
        selectAndConnect("manual");
    }
}

function toggleAutoConnect(value) {
    PortHandler.portPicker.autoConnect = value;
    setConfig({ autoConnect: value });
}

export default defineComponent({
    name: "ConnectButton",
    components: { ConnectOptionsDialog, SppDeviceDialog, WifiDialog },
    setup() {
        const connectionStore = useConnectionStore();

        const isConnected = computed(() => connectionStore.connectionValid);
        const connecting = computed(() => Boolean(connectionStore.connectingTo));
        const isVirtualMode = computed(() => connectionStore.virtualMode);
        const connectedTo = computed(() => connectionStore.connectedTo);

        const disconnectLabel = computed(() => {
            if (isVirtualMode.value) {
                return i18n.getMessage("disconnectVirtual");
            }
            const path = connectedTo.value || "";
            if (path.startsWith("bluetooth")) {
                return i18n.getMessage("disconnectBluetooth");
            }
            if (/^(tcp|ws|wss):\/\//.test(path)) {
                return i18n.getMessage("disconnectManual");
            }
            return i18n.getMessage("disconnect");
        });
        const portPickerDisabled = computed(() => PortHandler.portPickerDisabled);

        const selectedPort = computed(() => PortHandler.portPicker.selectedPort);
        const serialPorts = computed(() => PortHandler.currentSerialPorts);
        const usbPorts = computed(() => PortHandler.currentUsbPorts);
        const bluetoothPorts = computed(() => PortHandler.currentBluetoothPorts);

        const selectedDisplayName = computed(() => {
            const path = selectedPort.value;
            if (!path || path === "noselection") {
                return null;
            }
            const all = [...serialPorts.value, ...usbPorts.value, ...bluetoothPorts.value];
            return all.find((d) => d.path === path)?.displayName ?? null;
        });

        const mainLabel = computed(() => {
            if (connecting.value) {
                return i18n.getMessage("connecting");
            }
            if (selectedPort.value === "virtual") {
                return i18n.getMessage("connectVirtual");
            }
            return selectedDisplayName.value ?? i18n.getMessage("connect");
        });

        const dialogOpen = ref(false);
        const dialogMode = ref("virtual");
        const sppDialogOpen = ref(false);
        const portPicker = computed(() => PortHandler.portPicker);

        // WiFi 상태
        const wifiDialogOpen = ref(false);
        const wifiAddress = ref("");
        const wifiError = ref("");
        const wifiAutoConnectAttempted = ref(false);
        const wifiLastFailed = ref(false);

        function onWifiClick() {
            // 이미 WiFi 연결 시도 중이면 중복 실행 방지
            if (wifiAutoConnectAttempted.value) return;
            const saved = getConfig("wifiTcpAddress", "").wifiTcpAddress;
            if (saved && !wifiLastFailed.value) {
                // 저장된 주소 → 자동 연결 시도 (이전 실패 이력이 없을 때만)
                wifiAutoConnectAttempted.value = true;
                wifiError.value = "";
                PortHandler.portPicker.selectedPort = saved;
                connectDisconnect();
                // 12초 후 연결 실패 감지 (serial_backend 10초 타임아웃 이후)
                wifiTimeoutId = setTimeout(() => {
                    if (wifiAutoConnectAttempted.value) {
                        wifiAutoConnectAttempted.value = false;
                        if (!connectionStore.connectionValid) {
                            wifiLastFailed.value = true;
                            wifiAddress.value = saved;
                            wifiError.value = i18n.getMessage("connectionFailed").replace(/<[^>]*>/g, "");
                            wifiDialogOpen.value = true;
                        }
                    }
                }, 12000);
            } else {
                // 저장 주소 없음 or 이전 연결 실패 → 다이얼로그 표시
                wifiAddress.value = saved || "tcp://10.3.2.1";
                wifiError.value = "";
                wifiLastFailed.value = false;
                wifiDialogOpen.value = true;
            }
        }

        function onWifiDialogConnect(address) {
            // 주소 저장
            setConfig({ wifiTcpAddress: address });
            PortHandler.portPicker.wifiTcpAddress = address;
            // 연결
            wifiError.value = "";
            wifiLastFailed.value = false;
            PortHandler.portPicker.selectedPort = address;
            connectDisconnect();
        }

        function openConnectDialog(mode) {
            dialogMode.value = mode;
            dialogOpen.value = true;
        }

        function buildDeviceItems() {
            const expertMode = isExpertModeEnabled();
            const devices = [];
            if (PortHandler.showSerialOption) {
                for (const d of serialPorts.value) {
                    devices.push({
                        label: d.displayName,
                        icon: "i-lucide-usb",
                        onSelect: () => selectAndConnect(d.path),
                    });
                }
            }
            if (PortHandler.showUsbOption) {
                for (const d of usbPorts.value) {
                    devices.push({
                        label: d.displayName,
                        icon: "i-lucide-cpu",
                        onSelect: () => selectAndConnect(d.path),
                    });
                }
            }
            if (PortHandler.showBluetoothOption) {
                for (const d of bluetoothPorts.value) {
                    devices.push({
                        label: d.displayName,
                        icon: "i-lucide-bluetooth",
                        onSelect: () => selectAndConnect(d.path),
                    });
                }
            }
            if (expertMode && PortHandler.showVirtualMode) {
                devices.push({
                    label: i18n.getMessage("portsSelectVirtual"),
                    icon: "i-lucide-flask-conical",
                    onSelect: () => openConnectDialog("virtual"),
                });
            }
            if (expertMode && PortHandler.showManualMode) {
                devices.push({
                    label: i18n.getMessage("portsSelectManual"),
                    icon: "i-lucide-keyboard",
                    onSelect: () => openConnectDialog("manual"),
                });
            }
            return devices;
        }

        function buildPermissionItems() {
            const items = [];
            if (PortHandler.showSerialOption) {
                items.push({
                    label: i18n.getMessage("portsSelectPermission"),
                    icon: "i-lucide-plug-zap",
                    onSelect: () => PortHandler.requestDevicePermission("serial"),
                });
            }
            if (PortHandler.showBluetoothOption) {
                items.push({
                    label: i18n.getMessage("portsSelectPermissionBluetooth"),
                    icon: "i-lucide-bluetooth",
                    onSelect: () => PortHandler.requestDevicePermission("bluetooth"),
                });
                items.push({
                    label: i18n.getMessage("sppDialogTitle"),
                    icon: "i-lucide-settings-2",
                    onSelect: () => {
                        sppDialogOpen.value = true;
                    },
                });
            }
            if (PortHandler.showUsbOption) {
                items.push({
                    label: i18n.getMessage("portsSelectPermissionDFU"),
                    icon: "i-lucide-usb",
                    onSelect: () => PortHandler.requestDevicePermission("usb"),
                });
            }
            if (PortHandler.showWiFiOption) {
                items.push({
                    label: i18n.getMessage("portsSelectWiFi"),
                    icon: "i-lucide-wifi",
                    onSelect: onWifiClick,
                });
            }
            return items;
        }

        const menuItems = computed(() => {
            const devices = buildDeviceItems();
            const items = devices.length ? [...devices, { type: "separator" }] : [];
            items.push(
                ...buildPermissionItems(),
                { type: "separator" },
                {
                    type: "checkbox",
                    label: i18n.getMessage("autoConnect"),
                    checked: portPicker.value.autoConnect,
                    onUpdateChecked: toggleAutoConnect,
                    onSelect: (e) => e.preventDefault(),
                },
            );
            return items;
        });

        // WiFi PortsInput 드롭다운 이벤트 처리
        let wifiTimeoutId = null;
        onMounted(() => {
            EventBus.$on("ports-input:request-permission-wifi", onWifiClick);
        });
        onUnmounted(() => {
            if (wifiTimeoutId) clearTimeout(wifiTimeoutId);
        });

        async function onConnectClick() {
            if (portPickerDisabled.value) {
                return;
            }

            // Guard against a persisted virtual/manual selection when expert mode is off.
            const gatedModes = ["virtual", "manual"];
            if (!isExpertModeEnabled() && gatedModes.includes(selectedPort.value)) {
                PortHandler.portPicker.selectedPort = "noselection";
            }

            if (selectedPort.value === "noselection") {
                PortHandler.selectActivePort();
                if (PortHandler.portPicker.selectedPort !== "noselection") {
                    connectDisconnect();
                    return;
                }
                await PortHandler.requestDevicePermission("serial");
                if (PortHandler.portPicker.selectedPort !== "noselection") {
                    connectDisconnect();
                }
                return;
            }

            if (selectedPort.value === "wifi") {
                onWifiClick();
                return;
            }

            connectDisconnect();
        }

        return {
            isConnected,
            connecting,
            portPickerDisabled,
            disconnectLabel,
            mainLabel,
            menuItems,
            dialogOpen,
            dialogMode,
            portPicker,
            onConnectClick,
            onDisconnectClick: disconnect,
            onDialogConfirm,
            sppDialogOpen,
            bluetoothPorts,
            wifiDialogOpen,
            wifiAddress,
            wifiError,
            onWifiDialogConnect,
        };
    },
});
</script>

<style scoped>
.sidebar-connect {
    padding: 0.5rem 0;
}

.sidebar-connect__group {
    display: flex !important;
    width: 100% !important;
}

.sidebar-connect__main {
    flex: 1 1 0 !important;
    min-width: 0;
}

.sidebar-connect__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@media (max-width: 1055px) {
    .sidebar-connect {
        display: flex;
        justify-content: center;
    }
    .sidebar-connect__label {
        display: none;
    }
    .sidebar-connect__group {
        width: auto !important;
    }
}

/* Default Nuxt UI `success` soft tint is too pale in light mode — lift the contrast. */
html:not(.dark) .sidebar-connect :deep(button.color-success) {
    background-color: var(--success-400);
    border: 1px solid var(--success-600);
    color: var(--surface-900);
}
html:not(.dark) .sidebar-connect :deep(button.color-success:hover) {
    background-color: var(--success-500);
}

/* Disconnect button (error) styling for light mode - ensure it's red */
html:not(.dark) .sidebar-connect :deep(button.color-error) {
    background-color: var(--error-500);
    border: 1px solid var(--error-600);
    color: var(--surface-50);
}
html:not(.dark) .sidebar-connect :deep(button.color-error:hover) {
    background-color: var(--error-600);
}

/* Disconnect button (error) styling for dark mode - ensure proper contrast */
html.dark .sidebar-connect :deep(button.color-error) {
    background-color: var(--error-500);
    border: 1px solid var(--error-600);
    color: var(--surface-50);
}
html.dark .sidebar-connect :deep(button.color-error:hover) {
    background-color: var(--error-600);
}

.tab_container.reveal .sidebar-connect {
    display: block;
}
.tab_container.reveal .sidebar-connect__label {
    display: inline;
}
.tab_container.reveal .sidebar-connect__group {
    width: 100% !important;
}
</style>
