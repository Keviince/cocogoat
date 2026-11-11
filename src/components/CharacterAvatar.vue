<template>
    <img
        :key="source"
        :src="source"
        :alt="alt"
        referrerpolicy="no-referrer"
        decoding="async"
        @load="loaded = true"
        @error="nextSource"
    />
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { characterIconSources, resolveCharacterKey } from '@/assets/mihoyoImages/characterIcon'

// Embedded so a CDN outage or offline use still has a visible avatar.
const placeholder =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#dceafa"/><circle cx="40" cy="29" r="14" fill="#7899bd"/><path d="M13 73a27 27 0 0 1 54 0" fill="#7899bd"/></svg>',
    )

export default defineComponent({
    props: {
        name: { type: String, default: 'PlayerGirl' },
        alt: { type: String, default: '角色头像' },
    },
    setup(props) {
        const index = ref(0)
        const loaded = ref(false)
        const sources = computed(() => characterIconSources(props.name))
        const source = computed(() => sources.value[index.value] || placeholder)
        watch(
            () => resolveCharacterKey(props.name),
            () => {
                index.value = 0
                loaded.value = false
            },
            { flush: 'sync' },
        )
        const nextSource = () => {
            if (index.value < sources.value.length) index.value++
        }
        watch(
            source,
            (url, _, onCleanup) => {
                loaded.value = false
                if (url === placeholder) return
                const timer = window.setTimeout(() => {
                    if (!loaded.value) nextSource()
                }, 8000)
                onCleanup(() => window.clearTimeout(timer))
            },
            { immediate: true },
        )
        return { source, loaded, nextSource }
    },
})
</script>

<style scoped>
img {
    object-fit: cover;
    object-position: top;
}
</style>
