<script setup lang="ts">
import { ref } from 'vue'
import { Archive, FileJson, FileText, FolderOpen, Upload } from 'lucide-vue-next'
import { downloadBlob } from '@/utils/exportPage'
import {
  exportBackupJson,
  exportSpaceZip,
  filesToEntries,
  importEntries,
  type ImportResult,
} from '@/utils/importExport'
import { reloadPages, store } from '@/store'
import { errorText } from '@/api/features'

const emit = defineEmits<{ (e: 'toast', type: 'ok' | 'err', text: string): void }>()

const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const zipInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const progress = ref('')
const last = ref<ImportResult | null>(null)
const dragOver = ref(false)

async function runImport(files: File[]) {
  if (!files.length || busy.value) return
  busy.value = true
  progress.value = '读取文件…'
  last.value = null
  try {
    const entries = await filesToEntries(files)
    const res = await importEntries(entries, null, (t) => (progress.value = t))
    last.value = res
    await reloadPages()
    emit('toast', 'ok', `已导入 ${res.pages} 个页面${res.images ? `、${res.images} 张图片` : ''}`)
  } catch (e) {
    emit('toast', 'err', errorText(e, '导入失败'))
  } finally {
    busy.value = false
    progress.value = ''
  }
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void runImport(files)
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  void runImport(Array.from(e.dataTransfer?.files ?? []))
}

const stamp = () => new Date().toISOString().slice(0, 10)

async function exportZip() {
  busy.value = true
  try {
    const blob = await exportSpaceZip((t) => (progress.value = t))
    downloadBlob(blob, `ginkgo-notes-${store.space === 'public' ? 'public-' : ''}${stamp()}.zip`)
    emit('toast', 'ok', '导出完成')
  } catch (e) {
    emit('toast', 'err', errorText(e, '导出失败'))
  } finally {
    busy.value = false
    progress.value = ''
  }
}

async function exportJson() {
  busy.value = true
  try {
    downloadBlob(await exportBackupJson(), `ginkgo-notes-backup-${stamp()}.json`)
  } catch (e) {
    emit('toast', 'err', errorText(e, '导出失败'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pf-section-head"><div class="pf-sub">导入</div></div>
  <div
    class="dt-drop"
    :class="{ over: dragOver, busy }"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <Upload :size="20" :stroke-width="1.6" />
    <div class="dt-drop-title">{{ busy && progress ? progress : '把文件拖到这里' }}</div>
    <div class="pf-row-desc">支持 .md / .txt、整个文件夹、.zip（含 Notion 导出包）、银杏笔记 JSON 备份</div>
    <div class="dt-btns">
      <button type="button" class="pf-btn" :disabled="busy" @click="fileInput?.click()"><FileText :size="12" :stroke-width="2" />选择文件</button>
      <button type="button" class="pf-btn" :disabled="busy" @click="folderInput?.click()"><FolderOpen :size="12" :stroke-width="2" />选择文件夹</button>
      <button type="button" class="pf-btn" :disabled="busy" @click="zipInput?.click()"><Archive :size="12" :stroke-width="2" />导入 zip / Notion</button>
    </div>
  </div>
  <ul class="dt-tips">
    <li>文件夹与 zip 会保留目录层级：「A.md」与同名文件夹「A/」里的文件会成为 A 的子页面。</li>
    <li>Notion：在 Notion 中「Export → Markdown &amp; CSV」，把下载的 zip 直接导入；图片会一并迁移，数据库（CSV）转成表格页面。</li>
    <li>Markdown 中以 <code># 标题</code> 开头的第一行会作为页面标题。</li>
  </ul>
  <div v-if="last" class="dt-result">
    导入完成：{{ last.pages }} 个页面 · {{ last.images }} 张图片{{ last.databases ? ` · ${last.databases} 个表格` : '' }}
    <template v-if="last.skipped.length">；跳过 {{ last.skipped.length }} 个不支持的文件</template>
  </div>

  <div class="pf-section-head"><div class="pf-sub">导出</div></div>
  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">整空间导出（zip）</div>
      <div class="pf-row-desc">Markdown + 图片，按页面层级组织文件夹，附带可原样恢复的 backup.json</div>
    </div>
    <button type="button" class="pf-btn primary" :disabled="busy" @click="exportZip"><Archive :size="12" :stroke-width="2" />导出 zip</button>
  </div>
  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">JSON 备份</div>
      <div class="pf-row-desc">包含全部页面、层级、图标与多维表格数据（不含图片文件）</div>
    </div>
    <button type="button" class="pf-btn" :disabled="busy" @click="exportJson"><FileJson :size="12" :stroke-width="2" />导出 JSON</button>
  </div>
  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">单页导出</div>
      <div class="pf-row-desc">在页面右上角「更多 → 导出」中可导出 Markdown、PDF 或图片</div>
    </div>
  </div>

  <input ref="fileInput" type="file" multiple accept=".md,.markdown,.txt,.json,.csv,.zip" hidden @change="onPick" />
  <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick" />
  <input ref="zipInput" type="file" accept=".zip" hidden @change="onPick" />
</template>

<style scoped>
.dt-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 22px 16px;
  border: 1.5px dashed var(--gn-border-strong);
  border-radius: 10px;
  color: var(--gn-text-muted);
  text-align: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.dt-drop.over {
  border-color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.dt-drop.busy {
  opacity: 0.8;
}
.dt-drop-title {
  font-size: 13.5px;
  color: var(--gn-text);
}
.dt-btns {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 6px;
}
.dt-tips {
  margin: 10px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--gn-text-muted);
}
.dt-tips code {
  font-family: var(--gn-mono);
  font-size: 11px;
}
.dt-result {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 7px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 12.5px;
}
</style>
