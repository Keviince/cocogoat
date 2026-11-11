import { ref, nextTick } from 'vue'
import { debounce } from 'lodash-es'
import { reloadAllUsers, currentUser, store, options, disableAutoSave, loadStore, loadOptions } from '.'
import * as localStorageImpl from './impl/localStorage'
import { SelfHostedSync } from './selfHostedSync.mjs'

export enum SYNCSTAT {
    OFFLINE = 'offline',
    WAITING = 'waitng',
    SYNCING = 'syncing',
    SYNCED = 'synced',
    FAILED = 'failed',
    PARTIALLY = 'partially',
}
export const syncStatus = ref({ status: SYNCSTAT.OFFLINE, errors: [] as { code: string; message: string }[] })
export const syncConnection = ref(null as { endpoint: string; account: string } | null)
let client: SelfHostedSync | undefined
let started = false
const connection = () => {
    if (!client) {
        client = new SelfHostedSync({
            storage: localStorage,
            keys: () => Object.keys(localStorage),
            onState: (status: string, errors: { code: string; message: string }[]) => {
                syncStatus.value = { status: status as SYNCSTAT, errors }
            },
            onRemote: async () => {
                disableAutoSave.value = true
                try {
                    await nextTick()
                    currentUser.value = localStorageImpl.currentUser()[0]
                    store.value = loadStore()
                    options.value = loadOptions()
                    reloadAllUsers()
                    await nextTick()
                } finally {
                    disableAutoSave.value = false
                }
            },
        })
    }
    return client
}
export async function initSync() {
    const sync = connection()
    sync.restore()
    syncConnection.value = sync.connection()
    if (!started) {
        started = true
        window.addEventListener('online', () => {
            sync.sync()
        })
        window.setInterval(() => {
            if (navigator.onLine && document.visibilityState === 'visible') sync.sync()
        }, 30000)
    }
    await sync.sync()
}
export async function connectServer(endpoint: string, account: string, password: string) {
    const sync = connection()
    await sync.login(endpoint, account, password)
    syncConnection.value = sync.connection()
}
export async function disconnectServer() {
    await connection().logout()
    syncConnection.value = null
}
export const syncNow = (mode = 'normal') => connection().sync(mode)
const upload = debounce(() => {
    connection().sync()
}, 1000)
export function debouncedSingleSync({ user, data }: { user: string; data: unknown; now: Date; last: Date }) {
    connection().queue(user, data)
    if (syncConnection.value) upload()
}
