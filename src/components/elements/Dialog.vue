<template>
    <UModal
        :open="modelValue"
        :title="title"
        :close="closeable"
        :dismissible="closeable"
        :size="size"
        :ui="{ overlay: 'z-3000', content: 'z-3001' }"
        @update:open="onOpenChange"
    >
        <template v-if="$slots.default" #body>
            <slot></slot>
        </template>
        <template v-if="$slots.footer" #footer>
            <div class="flex justify-end gap-2 w-full">
                <slot name="footer"></slot>
            </div>
        </template>
    </UModal>
</template>

<script setup>
const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false,
    },
    title: {
        type: String,
        default: "",
    },
    closeable: {
        type: Boolean,
        default: true,
    },
    size: {
        type: String,
        default: "md",
    },
});

const emit = defineEmits(["update:modelValue", "close"]);

const onOpenChange = (open) => {
    emit("update:modelValue", open);
    if (!open) {
        emit("close");
    }
};

const close = () => {
    if (props.closeable) {
        emit("update:modelValue", false);
        emit("close");
    }
};

defineExpose({
    close,
});
</script>
