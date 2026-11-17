<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { X, Copy, Settings, Check } from 'lucide-vue-next'
import {
  EXPORT_PAPERS,
  EXPORT_THEMES,
  captureNoteCanvas,
  canvasToBlob,
  copyBlobToClipboard,
  downloadBlob,
  safeFileName,
  type ExportPaper,
  type ExportTheme,
  type ImageExportOptions,
} from '@/utils/exportPage'
import { store } from '@/store'

const props = defineProps<{
  source: HTMLElement
  title: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const paper = ref<ExportPaper>('plain')
const theme = ref<ExportTheme>(store.theme === 'dark' ? 'dark' : 'light')
const watermark = ref(false)
const settingsOpen = ref(false)
const previewUrl = ref<string | null>(null)
const busy = ref(false)
const copied = ref(false)
const error = ref('')
let canvasCache: HTMLCanvasElement | null = null
let regenTimer: number | null = null

const options = computed<ImageExportOptions>(() => ({
  paper: paper.value,
  theme: theme.value,
  watermark: watermark.value,
  watermarkText: store.user?.username ? `${store.user.username} · 银杏笔记` : '银杏笔记',
}))

async function regenerate() {
  busy.value = true
  error.value = ''
  try {
    await nextTick()
    const canvas = await captureNoteCanvas(props.source, options.value)
    canvasCache = canvas
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    const blob = await canvasToBlob(canvas)
    previewUrl.value = URL.createObjectURL(blob)
  } catch (err) {
    console.error(err)
    error.value = err instanceof Error ? err.message : '预览生成失败'
  } finally {
    busy.value = false
  }
}

function scheduleRegen() {
  if (regenTimer) window.clearTimeout(regenTimer)
  regenTimer = window.setTimeout(() => {
    regenTimer = null
    void regenerate()
  }, 180)
}

async function saveImage() {
  if (!canvasCache) await regenerate()
  if (!canvasCache) return
  busy.value = true
  try {
    const blob = await canvasToBlob(canvasCache)
    downloadBlob(blob, `${safeFileName(props.title)}.png`)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    busy.value = false
  }
}

async function copyImage() {
  if (!canvasCache) await regenerate()
  if (!canvasCache) return
  busy.value = true
  try {
    const blob = await canvasToBlob(canvasCache)
    await copyBlobToClipboard(blob)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '复制失败'
  } finally {
    busy.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  void regenerate()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  if (regenTimer) window.clearTimeout(regenTimer)
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

watch([paper, theme, watermark], () => scheduleRegen())
</script>

<template>
  <div class="iem-overlay gn-fade" @mousedown.self="emit('close')">
    <div class="iem-modal gn-pop" role="dialog" aria-label="图片导出">
      <header class="iem-head">
        <h2 class="iem-title">图片导出</h2>
        <span class="iem-mode">整张长图</span>
        <button type="button" class="iem-icon" v-tooltip="'关闭'" @click="emit('close')">
          <X :size="16" :stroke-width="1.9" />
        </button>
      </header>

      <div class="iem-preview gn-scroll">
        <div v-if="busy && !previewUrl" class="iem-empty">正在生成预览…</div>
        <p v-else-if="error && !previewUrl" class="iem-empty err">{{ error }}</p>
        <img v-if="previewUrl" class="iem-img" :src="previewUrl" alt="导出预览" />
      </div>

      <p v-if="error && previewUrl" class="iem-error">{{ error }}</p>

      <footer class="iem-foot">
        <button type="button" class="iem-save" :disabled="busy || !previewUrl" @click="saveImage">
          {{ busy && !previewUrl ? '生成中…' : '保存图片' }}
        </button>
        <button
          type="button"
          class="iem-icon-btn"
          :disabled="busy || !previewUrl"
          v-tooltip="copied ? '已复制' : '复制到剪贴板'"
          @click="copyImage"
        >
          <Check v-if="copied" :size="14" :stroke-width="2" />
          <Copy v-else :size="14" :stroke-width="1.8" />
        </button>
        <div class="iem-settings-wrap">
          <button
            type="button"
            class="iem-icon-btn"
            :class="{ on: settingsOpen }"
            v-tooltip="'导出设置'"
            @click="settingsOpen = !settingsOpen"
          >
            <Settings :size="14" :stroke-width="1.8" />
          </button>
          <div v-if="settingsOpen" class="iem-settings gn-pop">
            <div class="iem-sec-title">纸质样板</div>
            <div class="iem-chips">
              <button
                v-for="p in EXPORT_PAPERS"
                :key="p.id"
                type="button"
                class="iem-chip"
                :class="{ on: paper === p.id }"
                @click="paper = p.id"
              >
                {{ p.label }}
              </button>
            </div>
            <div class="iem-sec-title">主题</div>
            <div class="iem-chips">
              <button
                v-for="t in EXPORT_THEMES"
                :key="t.id"
                type="button"
                class="iem-chip"
                :class="{ on: theme === t.id }"
                @click="theme = t.id"
              >
                {{ t.label }}
              </button>
            </div>
            <div class="iem-sec-title">水印</div>
            <button
              type="button"
              class="iem-toggle"
              :class="{ on: watermark }"
              @click="watermark = !watermark"
            >
              <span class="iem-toggle-track"><i /></span>
              <span>{{ watermark ? '已开启' : '已关闭' }}</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.iem-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(20, 20, 18, 0.45);
}
.iem-modal {
  width: min(560px, 100%);
  max-height: min(860px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 14px;
  box-shadow: var(--gn-shadow-lg);
  overflow: hidden;
}
.iem-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--gn-border);
}
.iem-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--gn-text);
}
.iem-mode {
  margin-left: auto;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
.iem-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.iem-icon:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.iem-preview {
  flex: 1 1 auto;
  min-height: 280px;
  max-height: calc(100vh - 220px);
  overflow: auto;
  padding: 18px 20px;
  background: color-mix(in srgb, var(--gn-bg-hover) 70%, var(--gn-bg));
}
.iem-img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: var(--gn-shadow-md);
  background: var(--gn-bg);
}
.iem-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  color: var(--gn-text-muted);
  font-size: 13.5px;
}
.iem-empty.err,
.iem-error {
  color: var(--gn-danger);
  font-size: 12.5px;
  margin: 0;
  padding: 0 14px 6px;
}
.iem-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--gn-border);
}
.iem-save {
  flex: 1 1 auto;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: var(--gn-accent);
  color: var(--gn-accent-ink);
  font-size: 13px;
  font-weight: 520;
  font-family: inherit;
  cursor: pointer;
}
.iem-save:hover:not(:disabled) {
  filter: brightness(1.05);
}
.iem-save:disabled {
  opacity: 0.55;
  cursor: default;
}
.iem-icon-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text-soft);
  cursor: pointer;
}
.iem-icon-btn:hover:not(:disabled),
.iem-icon-btn.on {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.iem-icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.iem-settings-wrap {
  position: relative;
  flex: 0 0 auto;
}
.iem-settings {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  width: 220px;
  padding: 10px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  box-shadow: var(--gn-shadow-lg);
  z-index: 5;
}
.iem-sec-title {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  margin: 2px 0 6px;
}
.iem-sec-title + .iem-chips,
.iem-chips + .iem-sec-title {
  margin-top: 10px;
}
.iem-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.iem-chip {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--gn-border);
  border-radius: 999px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.iem-chip.on {
  border-color: color-mix(in srgb, var(--gn-accent) 45%, var(--gn-border));
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.iem-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}
.iem-toggle-track {
  width: 34px;
  height: 18px;
  border-radius: 99px;
  background: var(--gn-bg-active);
  position: relative;
  transition: background 0.15s ease;
}
.iem-toggle-track i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 0.15s ease;
}
.iem-toggle.on .iem-toggle-track {
  background: var(--gn-accent);
}
.iem-toggle.on .iem-toggle-track i {
  transform: translateX(16px);
}
</style>
