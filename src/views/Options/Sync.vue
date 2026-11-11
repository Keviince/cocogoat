<template>
    <section :class="$style.syncManager">
        <h3>我的服务器</h3>
        <p>成就会先保存在本机，登录后自动同步到你自己的服务器。离线修改会在恢复连接后重试。</p>
        <template v-if="syncConnection">
            <div :class="$style.connection">
                <strong>{{ syncConnection.account }}</strong>
                <span>{{ syncConnection.endpoint }}</span>
                <span>{{ statusText[syncStatus.status] }}</span>
            </div>
            <div :class="$style.actions">
                <el-button type="primary" :loading="busy" @click="runSync('normal')">立即同步</el-button>
                <el-button :disabled="busy" @click="logout">退出登录</el-button>
            </div>
            <div v-if="hasConflict" :class="$style.conflict">
                <p>本机和服务器都有未合并的修改。请先导出备份，再选择保留哪一份。</p>
                <el-button :disabled="busy" @click="resolveConflict('upload')">冲突时保留本地数据</el-button>
                <el-button :disabled="busy" @click="resolveConflict('download')">恢复服务器数据</el-button>
            </div>
        </template>
        <el-form v-else label-position="top" :class="$style.login" @submit.prevent="login">
            <el-form-item label="服务器地址">
                <el-input v-model="endpoint" placeholder="https://achievements.example.com" autocomplete="url" />
            </el-form-item>
            <el-form-item label="UID 或账户名">
                <el-input v-model="account" autocomplete="username" placeholder="服务器上创建的账号" />
            </el-form-item>
            <el-form-item label="密码">
                <el-input v-model="password" type="password" autocomplete="current-password" show-password />
            </el-form-item>
            <p>登录后，本机现有成就会同步到该账号。已有数据发生冲突时，由你选择保留哪一份。</p>
            <el-button
                type="primary"
                native-type="submit"
                :loading="busy"
                :disabled="!endpoint || !account || !password"
                >登录并同步</el-button
            >
        </el-form>
        <el-alert v-if="message" :title="message" type="error" :closable="false" show-icon />
        <el-alert
            v-for="error in syncStatus.errors"
            :key="error.message"
            :title="error.message"
            type="warning"
            :closable="false"
            show-icon
        />
        <h3>本地备份</h3>
        <p>退出登录和移除旧同步方式都不会删除本机成就。</p>
        <el-button :loading="exportLoading" @click="exportData">导出全部本地数据</el-button>
        <el-button type="danger" plain @click="clearData">清除本地数据</el-button>
    </section>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { connectServer, disconnectServer, syncConnection, syncNow, syncStatus, SYNCSTAT } from '@/store/sync'
import { list, get, del } from '@/store/impl'
import { last } from '@/store/impl/localStorage'
import { disableAutoSave } from '@/store'

export default defineComponent({
    setup() {
        const endpoint = ref(
            location.protocol.startsWith('http') && !location.hostname.endsWith('github.io') ? location.origin : '',
        )
        const account = ref('')
        const password = ref('')
        const busy = ref(false)
        const message = ref('')
        const exportLoading = ref(false)
        const hasConflict = computed(() => syncStatus.value.errors.some((error) => error.code === 'conflict'))
        const statusText = {
            [SYNCSTAT.OFFLINE]: '未连接',
            [SYNCSTAT.WAITING]: '等待同步',
            [SYNCSTAT.SYNCING]: '同步中',
            [SYNCSTAT.SYNCED]: '已同步',
            [SYNCSTAT.FAILED]: '同步未完成',
            [SYNCSTAT.PARTIALLY]: '部分同步失败',
        }
        const login = async () => {
            busy.value = true
            message.value = ''
            try {
                await connectServer(endpoint.value.trim(), account.value.trim(), password.value)
            } catch (error) {
                message.value = error instanceof Error ? error.message : '登录失败'
            } finally {
                password.value = ''
                busy.value = false
            }
        }
        const runSync = async (mode = 'normal') => {
            busy.value = true
            try {
                await syncNow(mode)
            } finally {
                busy.value = false
            }
        }
        const logout = async () => {
            await disconnectServer()
        }
        const resolveConflict = async (mode: string) => {
            try {
                await ElMessageBox.confirm(
                    mode === 'upload'
                        ? '将使用本机的冲突数据覆盖服务器版本，是否继续？'
                        : '将使用服务器快照替换本机数据，未上传的本机修改将丢失，是否继续？',
                    '确认数据来源',
                    { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' },
                )
            } catch {
                return
            }
            await runSync(mode)
        }
        const exportData = async () => {
            exportLoading.value = true
            try {
                const JSZip = (await import('jszip')).default
                const zip = new JSZip()
                for (const key of list().concat(['options', 'currentUser'])) {
                    zip.file(
                        key + '.json',
                        JSON.stringify({ value: get(key), lastModified: last(key).toISOString() }, null, 4),
                    )
                }
                const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }))
                const link = document.createElement('a')
                link.href = url
                link.download = 'cocogoat-backup.zip'
                link.click()
                window.setTimeout(() => URL.revokeObjectURL(url), 10000)
            } finally {
                exportLoading.value = false
            }
        }
        const clearData = async () => {
            try {
                await ElMessageBox.confirm(
                    '只清除本机数据，服务器数据会保留。未上传的修改将丢失，是否继续？',
                    '确认清除',
                    { type: 'warning' },
                )
            } catch {
                return
            }
            // Disconnect first so the next scan cannot turn a local cleanup into remote deletions.
            await disconnectServer()
            disableAutoSave.value = true
            await nextTick()
            for (const key of list().concat(['options', 'currentUser'])) del(key, false)
            location.reload()
        }
        return {
            endpoint,
            account,
            password,
            busy,
            message,
            exportLoading,
            syncConnection,
            syncStatus,
            statusText,
            hasConflict,
            login,
            logout,
            runSync,
            resolveConflict,
            exportData,
            clearData,
        }
    },
})
</script>

<style lang="scss" module>
.sync-manager {
    padding: 0 20px 30px;
    color: var(--c-text);
    p {
        color: var(--c-text-mid);
        font-size: 14px;
        line-height: 1.7;
    }
    :global(.el-alert) {
        margin: 16px 0;
        max-width: 650px;
    }
}
.login {
    max-width: 440px;
}
.connection {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 20px 0;
}
.actions {
    display: flex;
    gap: 8px;
    margin-bottom: 18px;
}
.conflict {
    margin: 20px 0;
}
</style>
