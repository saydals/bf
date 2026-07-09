<template>
    <UModal v-model:open="open" :title="$t('bleProfileDialogTitle')">
        <template #body>
            <div class="ble-profile-dialog">
                <p class="ble-profile-dialog__help">
                    {{ $t("bleProfileDialogHelp") }}
                </p>

                <label class="ble-profile-dialog__field">
                    <span>{{ $t("bleProfileDialogDevice") }}</span>
                    <USelect :items="deviceItems" v-model="selectedDeviceKey" size="sm" :ui="{ content: 'max-h-96' }" />
                </label>

                <label class="ble-profile-dialog__field">
                    <span>{{ $t("bleProfileDialogProfile") }}</span>
                    <USelect
                        :items="profileItems"
                        v-model="selectedProfile"
                        :disabled="!selectedDeviceKey"
                        size="sm"
                        :ui="{ content: 'max-h-96' }"
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

export default defineComponent({
    name: "BleProfileDialog",
    props: {
        modelValue: {
            type: Boolean,
            required: true,
        },
        bluetoothPorts: {
            type: Array,
            default: () => [],
        },
    },
    emits: ["update:modelValue"],
    setup(props, { emit }) {
        const open = computed({
            get: () => props.modelValue,
            set: (v) => emit("update:modelValue", v),
        });

        const selectedDeviceKey = ref("");
        const selectedProfile = ref("");

        // 기기 목록: 현재 검색된 블루투스 기기
        const deviceItems = computed(() =>
            props.bluetoothPorts.map((d) => ({
                label: d.displayName || d.path,
                value: d.path,
            })),
        );

        // 프로필 목록: 자동 감지 + 모든 등록된 BLE 프로필
        const profileItems = ref(getSelectableProfiles());

        // 기기 변경 시 저장된 오버라이드 불러오기
        watch(selectedDeviceKey, (newKey) => {
            const override = getProfileOverride(newKey);
            selectedProfile.value = override?.name ?? "";
        });

        function save() {
            if (!selectedDeviceKey.value) return;
            setProfileOverride(selectedDeviceKey.value, selectedProfile.value || null);
            open.value = false;
        }

        return {
            open,
            selectedDeviceKey,
            selectedProfile,
            deviceItems,
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
