<template>
    <header class="cc-header"></header>
    <div class="cc-user-corner">
        <router-link class="cc-settings" :to="{ name: 'options.basic' }" aria-label="设置" title="设置">
            <fa-icon icon="gear" /><span>设置</span>
        </router-link>
        <user-selector />
    </div>
    <router-view />
</template>

<script lang="ts">
import { defineComponent, onMounted, onUnmounted } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { faGear, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { faInternetExplorer } from '@fortawesome/free-brands-svg-icons'
import UserSelector from '@/components/UserSelector.vue'
import bus from '@/bus'
import './layout.scss'

library.add(faGear, faTriangleExclamation, faInternetExplorer)

export default defineComponent({
    components: { UserSelector },
    setup() {
        const resize = () => {
            const isMobile = window.innerWidth < 900
            bus().isMobile = isMobile
            document.body.classList.toggle('m', isMobile)
            document.body.classList.toggle('pc', !isMobile)
        }
        onMounted(() => {
            document.body.classList.add('layout')
            resize()
            window.addEventListener('resize', resize)
        })
        onUnmounted(() => {
            window.removeEventListener('resize', resize)
            document.body.classList.remove('layout', 'm', 'pc')
        })
    },
})
</script>
