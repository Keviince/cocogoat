<template>
    <Layout full-height>
        <template #title><span style="font-family: genshin">椰羊 · </span>霜华插件</template>
        <div :class="$style.client">
            <div class="center">
                <el-link :href="url" type="primary">如果下载没有自动开始，请点击这里</el-link>
                <div class="faq">
                    <h3>无法运行、提示找不到 DLL？</h3>
                    <a href="https://aka.ms/vs/17/release/vc_redist.x64.exe" target="_blank">请点击这里</a>
                    下载并安装微软基础运行库，安装完成后即可正常运行
                </div>
                <div class="copyright">
                    椰羊·霜华插件 v{{ version }} ({{ size }})
                    <br />
                    开发者：月海亭 YuehaiTeam
                </div>
                <div class="installer">
                    首次运行时程序会自动安装到 <code>C:\Program Files\cocogoat-control</code> 目录下
                    <br />
                    您可在控制面板或设置中随时卸载
                </div>
            </div>
        </div>
    </Layout>
</template>
<script lang="ts">
import { defineComponent, onMounted } from 'vue'
import DlUpdate from '@/utils/dlUpdate'
const latest = new DlUpdate('frostflake')
export default defineComponent({
    async beforeRouteEnter() {
        await latest.ready
    },
    setup() {
        onMounted(async () => {
            // iframe download
            const iframe = document.createElement('iframe')
            iframe.style.display = 'none'
            iframe.src = latest.url.value
            document.body.appendChild(iframe)
        })
        return {
            url: latest.url,
            version: latest.version,
            size: latest.formattedSize,
        }
    },
})
</script>
<style lang="scss" module>
.client {
    height: 100%;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    :global {
        .center {
            text-align: center;
            padding: 30px;
            .el-link {
                font-size: 20px;
            }
            .copyright {
                padding: 20px;
                font-size: 13px;
            }

            .installer {
                font-size: 13px;
                margin-top: -19px;
                code {
                    font-family: Consolas, monospace;
                    background: var(--c-border);
                    padding: 2px 5px;
                    border-radius: 3px;
                    color: var(--c-text);
                }
            }

            .faq {
                padding: 20px;
                font-size: 14px;
                margin-top: 40px;
                h3 {
                    margin-bottom: 5px;
                }
            }
        }
        .plz-card {
            padding: 0px;
            position: absolute;
            height: 120px;
            text-align: center;
            left: 0;
            right: 0;
            bottom: 0;
            .please {
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                padding: 15px;
                box-sizing: border-box;
            }
            .adswrapper {
                position: absolute;
                top: 0;
                left: 0;
                display: inline-block;
                max-height: 120px;
                width: 100%;
                max-width: 100%;
                text-align: center;
            }
        }
    }
}
</style>
