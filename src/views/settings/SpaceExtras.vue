<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { HardDrive, Pencil } from 'lucide-vue-next'
import SettingsModal from './SettingsModal.vue'
import IconPicker from '@/components/IconPicker.vue'
import PageIcon from '@/components/PageIcon.vue'
import { errorText, formatBytes, formatDateTime, getStorage, putUserSetting, type StorageInfo } from '@/api/features'
import { userState } from '@/userState'
import { store } from '@/store'

const emit = defineEmits<{ (e: 'toast', type: 'ok' | 'err', text: string): void }>()

/* ---------------- 空间名称与图标 ---------------- */

const editing = ref(false)
const nameDraft = ref('')
const iconDraft = ref('')
const pickerOpen = ref(false)
const busy = ref(false)

function openEdit() {
  nameDraft.value = userState.space.name
  iconDraft.value = userState.space.icon
  pickerOpen.value = false
  editing.value = true
}

async function saveSpace() {
  busy.value = true
  try {
    const value = { name: nameDraft.value.trim().slice(0, 40), icon: iconDraft.value }
    await putUserSetting('space', value)
    userState.space = value
    editing.value = false
    emit('toast', 'ok', '已保存')
  } catch (e) {
    emit('toast', 'err', errorText(e))
  } finally {
    busy.value = false
  }
}

/* ---------------- 存储用量 ---------------- */

const storage = ref<StorageInfo | null>(null)
const parts = computed(() => {
  const s = storage.value
  if (!s || !s.total) return []
  return [
    { label: '图片与附件', bytes: s.assets.bytes, extra: `${s.assets.count} 个文件`, color: '#6cb894' },
    { label: '页面正文', bytes: s.pages.bytes, extra: `${s.pages.count} 个页面`, color: '#5b8def' },
    { label: '多维表格', bytes: s.databases.bytes, extra: `${s.databases.count} 张表 · ${s.databases.rows} 行`, color: '#e0a92e' },
  ]
})

onMounted(async () => {
  try {
    storage.value = await getStorage()
  } catch (e) {
    emit('toast', 'err', errorText(e))
  }
})
</script>

<template>
  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">空间名称与图标</div>
      <div class="pf-row-desc">显示在侧栏顶部{{ store.space === 'public' ? '（公共原稿不受影响）' : '' }}</div>
    </div>
    <div class="pf-actions">
      <span class="pf-value sp-current">
        <PageIcon :icon="userState.space.icon || '🍃'" :size="15" />{{ userState.space.name || '银杏笔记' }}
      </span>
      <button type="button" class="pf-btn" @click="openEdit"><Pencil :size="12" :stroke-width="2" />编辑</button>
    </div>
  </div>

  <div class="pf-section-head">
    <div class="pf-sub"><HardDrive :size="12" :stroke-width="2" /> 存储用量</div>
    <span v-if="storage" class="pf-value">共 {{ formatBytes(storage.total) }}</span>
  </div>
  <div v-if="!storage" class="pf-empty">统计中…</div>
  <template v-else>
    <div class="sp-stack">
      <i v-for="p in parts" :key="p.label" :style="{ width: `${(p.bytes / storage.total) * 100}%`, background: p.color }"></i>
    </div>
    <div v-for="p in parts" :key="p.label" class="pf-row">
      <div class="pf-row-text">
        <div class="pf-row-title"><span class="sp-dot" :style="{ background: p.color }"></span>{{ p.label }}</div>
        <div class="pf-row-desc">{{ p.extra }}</div>
      </div>
      <span class="pf-value">{{ formatBytes(p.bytes) }}</span>
    </div>
    <template v-if="storage.largest.length">
      <div class="pf-sub sp-sub">占用最大的文件</div>
      <div class="pf-list">
        <div v-for="a in storage.largest" :key="a.id" class="pf-list-item">
          <div class="pf-list-main">
            <div class="pf-list-title">{{ a.name }}</div>
            <div class="pf-row-desc">上传于 {{ formatDateTime(a.createdAt) }}</div>
          </div>
          <span class="pf-value">{{ formatBytes(a.size) }}</span>
        </div>
      </div>
    </template>
  </template>

  <SettingsModal v-if="editing" title="空间名称与图标" @close="editing = false">
    <div class="sp-edit">
      <button type="button" class="sp-icon-btn" v-tooltip="'选择图标'" @click="pickerOpen = !pickerOpen">
        <PageIcon :icon="iconDraft || '🍃'" :size="22" />
      </button>
      <input v-model="nameDraft" maxlength="40" placeholder="银杏笔记" @keydown.enter="saveSpace" />
    </div>
    <div v-if="pickerOpen" class="sp-picker">
      <IconPicker
        :current="iconDraft"
        @pick="(i) => { iconDraft = i; pickerOpen = false }"
        @clear="iconDraft = ''; pickerOpen = false"
      />
    </div>
    <footer>
      <button type="button" class="pf-btn" @click="editing = false">取消</button>
      <button type="button" class="pf-btn primary" :disabled="busy" @click="saveSpace">保存</button>
    </footer>
  </SettingsModal>
</template>

<style scoped>
.sp-current {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sp-stack {
  display: flex;
  height: 8px;
  margin: 4px 0 6px;
  border-radius: 99px;
  background: var(--gn-bg-hover);
  overflow: hidden;
}
.sp-stack i {
  display: block;
  min-width: 2px;
}
.sp-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 2px;
}
.sp-sub {
  margin: 14px 0 6px;
}
.sp-edit {
  display: flex;
  gap: 8px;
}
.sp-edit input {
  flex: 1 1 auto;
}
.sp-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  cursor: pointer;
}
.sp-picker :deep(.icon-picker) {
  width: 100% !important;
}
</style>
