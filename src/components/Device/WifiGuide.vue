<template>
    <button class="dd-icon-btn" title="无线调试连接提示" @click="dialogVisible = true">
        <v-icon size="18" :icon="mdiHelpCircleOutline" />
    </button>

    <v-dialog v-model="dialogVisible" max-width="560">
        <div class="wg-dialog">
            <div class="wg-header">
                <span class="wg-title">无线调试连接提示</span>
                <button class="wg-close" @click="dialogVisible = false">
                    <v-icon size="18" :icon="mdiClose" />
                </button>
            </div>

            <div class="wg-body">
                <p class="wg-section-label">步骤说明</p>
                <ol class="wg-steps">
                    <li v-for="(step, index) in steps" :key="index" class="wg-step">
                        <strong>{{ step.title }}</strong>
                        <span v-html="step.content"></span>
                    </li>
                </ol>

                <div class="wg-download">
                    <span class="wg-download-label">ADB Bridge{{ versionPrefix
                    }}<a v-if="versionPrefix" class="wg-release-link" :href="releaseUrl" target="_blank" rel="noopener">版本说明</a></span>
                    <div class="wg-download-actions">
                        <v-menu location="top" open-on-hover>
                            <template #activator="{ props }">
                                <button class="wg-qr-btn" title="扫码下载" v-bind="props">
                                    <v-icon size="18" :icon="mdiQrcode" />
                                </button>
                            </template>
                            <div class="wg-qr-pop">
                                <img class="wg-qr-img" :src="qrImage" alt="ADB Bridge 下载二维码" />
                                <span class="wg-qr-note">扫码下载 <em>ADB Bridge</em></span>
                            </div>
                        </v-menu>
                        <v-btn size="small" variant="tonal" :href="apkUrl" target="_blank" rel="noopener">下载 APK</v-btn>
                    </div>
                </div>
                <details class="wg-faq">
                    <summary class="wg-faq-toggle">常见问题 (FAQ)</summary>
                    <div class="wg-faq-list">
                        <div v-for="(item, index) in faqItems" :key="index" class="wg-faq-item">
                            <strong>{{ item.question }}</strong>
                            <p v-html="item.answer"></p>
                        </div>
                    </div>
                </details>
            </div>

            <div class="wg-actions">
                <v-btn size="small" color="primary" @click="dialogVisible = false">完成</v-btn>
            </div>
        </div>
    </v-dialog>
</template>

<script setup>
import { mdiClose, mdiHelpCircleOutline, mdiQrcode } from '@mdi/js'
import { generate } from 'lean-qr';
import { toSvgDataURL } from 'lean-qr/extras/svg';
import { computed, onMounted, ref } from 'vue';

const dialogVisible = ref(false);

/** 版本索引，由 adb-ws-bridge 仓库的 index 分支产出 */
const INDEX_URL = 'https://raw.githubusercontent.com/journey-ad/adb-ws-bridge/index/latest.json';
const RELEASES_URL = 'https://github.com/journey-ad/adb-ws-bridge/releases/latest';

const apkUrl = ref(RELEASES_URL);
const releaseUrl = ref(RELEASES_URL);
const version = ref('');

/** 版本号前缀，形如 " v0.2.1 · "，读取失败时为空 */
const versionPrefix = computed(() => (version.value ? ` ${version.value} · ` : ''));

const qrImage = computed(() => toSvgDataURL(generate(apkUrl.value)));

onMounted(async () => {
    try {
        const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) return;
        const info = await response.json();
        const universal = info?.assets?.universal;
        if (universal?.url) {
            apkUrl.value = universal.url;
            version.value = info.version ?? '';
            releaseUrl.value = info.releaseUrl ?? RELEASES_URL;
        }
    } catch {
        // 读取失败时沿用发布页地址
    }
});

const steps = [
    { title: '安装转发服务', content: '在被控手机上安装 <em>ADB Bridge</em>，安装包见下方下载入口' },
    { title: '开启无线调试', content: '手机进入「开发者选项」，打开「无线调试」开关' },
    { title: '配对设备', content: '打开 <em>ADB Bridge</em>，点「前往配对」，把系统显示的配对码填进应用' },
    { title: '开启转发', content: '配对完成后点「开始转发」，面板会显示调试地址' },
    { title: '连接设备', content: '把面板上的地址填到本页输入框，点「通过无线调试连接」' },
];

const faqItems = [
    { question: '手机和电脑需要在同一网络吗？', answer: '需要。地址里是手机的内网 IP，只有同一局域网才能访问。' },
    { question: '地址每次都会变吗？', answer: '路由器重新分配 IP 后地址会变，可在路由器里为手机设置静态地址分配。' },
    { question: '填了地址却连不上怎么办？', answer: '确认 <em>ADB Bridge</em> 上显示「转发服务运行中」，地址与端口填写一致，并排查是否有防火墙拦截该端口。' },
    { question: '页面是 https 的，还能用 ws:// 地址吗？', answer: '可以，浏览器不会拦截明文 WebSocket 连接。' },
];
</script>

<style scoped>
.dd-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: rgba(24, 24, 27, 0.5);
    cursor: pointer;
    transition: background 0.15s;
}

.dd-icon-btn:hover {
    background: rgba(24, 24, 27, 0.06);
}

.wg-dialog {
    background: rgb(var(--v-theme-surface));
    border-radius: 12px;
    overflow: hidden;
}

.wg-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 0;
}

.wg-title {
    font-size: 15px;
    font-weight: 600;
    color: rgba(24, 24, 27, 0.85);
}

.wg-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: rgba(24, 24, 27, 0.4);
    cursor: pointer;
}

.wg-close:hover {
    background: rgba(24, 24, 27, 0.06);
}

.wg-body {
    padding: 16px 20px;
}

.wg-section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: rgba(24, 24, 27, 0.4);
    letter-spacing: 0.04em;
    margin: 0 0 10px;
}

.wg-steps {
    list-style: decimal;
    padding-left: 20px;
    margin: 0 0 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.wg-step {
    font-size: 13px;
    color: rgba(24, 24, 27, 0.7);
    line-height: 1.5;
}

.wg-step strong {
    color: rgba(24, 24, 27, 0.85);
    font-weight: 600;
    margin-right: 4px;
}

.wg-download {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
}

.wg-download-label {
    font-size: 13px;
    font-weight: 500;
    color: rgba(24, 24, 27, 0.8);
}

.wg-download-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.wg-qr-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: rgba(24, 24, 27, 0.6);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
}

.wg-qr-btn:hover {
    background: rgba(24, 24, 27, 0.03);
    border-color: var(--border-hover);
}

.wg-qr-pop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: rgb(var(--v-theme-surface));
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}

.wg-qr-img {
    display: block;
    width: 148px;
    height: 148px;
    border-radius: 8px;
    background: #fff;
}

.wg-qr-note {
    font-size: 12px;
    color: rgba(24, 24, 27, 0.6);
}

.wg-release-link {
    color: rgba(24, 24, 27, 0.55);
    text-decoration: underline;
}

.wg-release-link:hover {
    color: rgba(24, 24, 27, 0.8);
}

.wg-faq {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
}

.wg-faq-toggle {
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 500;
    color: rgba(24, 24, 27, 0.7);
    cursor: pointer;
    user-select: none;
}

.wg-faq-toggle:hover {
    background: rgba(24, 24, 27, 0.02);
}

.wg-faq-list {
    padding: 0 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.wg-faq-item {
    font-size: 13px;
    line-height: 1.5;
    color: rgba(24, 24, 27, 0.6);
}

.wg-faq-item strong {
    display: block;
    color: rgba(24, 24, 27, 0.8);
    font-weight: 500;
    margin-bottom: 2px;
}

.wg-faq-item p {
    margin: 0;
}

.wg-step :deep(em),
.wg-faq-item :deep(em),
.wg-qr-note em {
    font-style: italic;
    font-weight: 600;
}

.wg-actions {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
}
</style>
