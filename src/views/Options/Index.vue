<template>
    <Layout :class="$style.options">
        <template #title><span style="font-family: genshin">设置</span></template>
        <div :class="$style.back">
            <router-link :to="{ name: 'achievement.index' }">← 返回成就</router-link>
        </div>
        <el-tabs :model-value="$route.name" @update:model-value="$router.replace({ name: $event })">
            <el-tab-pane name="options.basic" label="基本设置"></el-tab-pane>
            <el-tab-pane name="options.user" label="角色资料"></el-tab-pane>
            <el-tab-pane name="options.sync" label="服务器与备份"></el-tab-pane>
            <el-tab-pane name="options.env" label="环境检测"></el-tab-pane>
        </el-tabs>
        <router-view />
    </Layout>
</template>

<script>
export default {
    setup() {
        return {}
    },
}
</script>

<style lang="scss" module>
.back {
    padding: 20px;
    a {
        color: var(--c-theme);
        text-decoration: none;
    }
}
.options {
    background: var(--c-background);
    :global {
        .el-tabs__nav-scroll {
            padding: 0 20px;
        }
    }
}
</style>
