<template>
    <UModal v-model:open="open" :title="$t('wifiDialogTitle')">
        <template #body>
            <div class="wifi-dialog">
                <p class="wifi-dialog__error" v-if="error">
                    {{ error }}
                </p>
                <p class="wifi-dialog__saved" v-if="savedAddress && error">
                    {{ $t("wifiSavedAddress") }}: {{ savedAddress }}
                </p>
                <label class="wifi-dialog__field">
                    <span>{{ $t("wifiTcpAddressLabel") }}</span>
                    <UInput v-model="address" size="sm" autofocus />
                </label>
            </div>
        </template>
        <template #footer>
            <div class="wifi-dialog__actions">
                <UButton color="neutral" variant="soft" size="sm" @click="onCancel">
                    {{ $t("cancel") }}
                </UButton>
                <UButton color="success" variant="soft" size="sm" :disabled="!canConfirm" @click="onConnect">
                    {{ savedAddress && !error ? $t("retry") : $t("connect") }}
                </UButton>
            </div>
        </template>
    </UModal>
</template>

<script>
import { computed, defineComponent, ref, watch } from "vue";

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

        const address = ref(props.savedAddress || "tcp://10.3.2.1");

        watch(
            () => props.modelValue,
            (isOpen) => {
                if (isOpen) {
                    address.value = props.savedAddress || "tcp://10.3.2.1";
                }
            },
        );

        const canConfirm = computed(() => address.value.trim().length > 0);

        function onCancel() {
            open.value = false;
        }

        function onConnect() {
            if (!canConfirm.value) return;
            emit("connect", address.value.trim());
            open.value = false;
        }

        return {
            open,
            address,
            canConfirm,
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
    gap: 1rem;
    min-width: min(26rem, 80vw);
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

.wifi-dialog__field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
}

.wifi-dialog__field span {
    font-size: 0.875rem;
    color: var(--text);
}

.wifi-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
</style>
