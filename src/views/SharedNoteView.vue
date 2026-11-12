<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Eye, Home, PanelLeftOpen, Pencil, Users } from 'lucide-vue-next'
import BlockEditor from '@/editor/BlockEditor.vue'
import PageIcon from '@/components/PageIcon.vue'
import { errorText, getSharedPage, saveSharedPage } from '@/api/features'
import { toPlainText } from '@/db/repo'
import { hydrateAssets } from '@/editor/assets'
import { goHome, store } from '@/store'
import type { Page } from '@/types'

const props = defineProps<{ pageId: string }>()

const page = ref<Page | null>(null)
const content = ref('')
const role = ref<'viewer' | 'editor'>('viewer')
const ownerName = ref('')
const error = ref('')
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const title = ref('')
const canEdit = computed(() => role.value === 'editor' && !page.value?.locked)
let titleTimer: number | null = null
/** 上次保存（或加载）时的正文，编辑器初始化触发的变更与它相同则不写回 */
let lastContent = ''

async function load() {
  try {
    const res = await getSharedPage(props.pageId)
    // 正文先就绪再挂编辑器：编辑器只在创建时读取 content
    content.value = await hydrateAssets(res.page.content ?? '')
    lastContent = res.page.content ?? ''
    role.value = res.role
    ownerName.value = res.ownerName
    title.value = res.page.title
    page.value = res.page
    document.title = `${res.page.title || '未命名'} · 银杏笔记`
  } catch (e) {
    error.value = errorText(e, '页面加载失败')
  }
}

async function save(patch: { title?: string; content?: string }) {
  if (!canEdit.value) return
  if (patch.content !== undefined) {
    if (patch.content.trim() === lastContent.trim()) return
    lastContent = patch.content
  }
  saveState.value = 'saving'
  try {
    await saveSharedPage(props.pageId, {
      ...patch,
      ...(patch.content !== undefined ? { excerpt: toPlainText(patch.content, 200) } : {}),
    })
    saveState.value = 'saved'
  } catch (e) {
    saveState.value = 'error'
    error.value = errorText(e)
  }
}

function onChange(markdown: string) {
  void save({ content: markdown })
}

function onTitleInput() {
  if (titleTimer) window.clearTimeout(titleTimer)
  titleTimer = window.setTimeout(() => void save({ title: title.value }), 500)
}

onMounted(load)
onBeforeUnmount(() => {
  if (titleTimer) {
    window.clearTimeout(titleTimer)
    void save({ title: title.value })
  }
})
</script>

<template>
  <div class="shv">
    <header class="shv-top">
      <button class="gn-icon-btn" v-tooltip="'全部笔记'" @click="goHome"><Home :size="14" /></button>
      <span class="shv-crumb"><Users :size="13" :stroke-width="2" />与我共享</span>
      <span class="shv-crumb current">{{ page?.title || '未命名' }}</span>
      <span class="shv-grow"></span>
      <span v-if="page" class="shv-role" :class="role">
        <component :is="role === 'editor' ? Pencil : Eye" :size="12" :stroke-width="2" />
        {{ role === 'editor' ? (page.locked ? '作者已锁定' : '可编辑') : '只读' }} · 来自 {{ ownerName }}
      </span>
      <span v-if="canEdit" class="shv-save" :class="saveState">
        {{ saveState === 'saving' ? '保存中' : saveState === 'error' ? '保存失败' : saveState === 'saved' ? '已保存' : '' }}
      </span>
      <button v-if="!store.sidebarOpen" class="gn-icon-btn" v-tooltip="'展开侧边栏'" @click="store.sidebarOpen = true">
        <PanelLeftOpen :size="16" :stroke-width="1.9" />
      </button>
    </header>

    <div class="shv-scroll gn-scroll">
      <div v-if="error && !page" class="shv-error">{{ error }}</div>
      <div v-else-if="page" class="shv-inner">
        <div v-if="page.icon" class="shv-icon"><PageIcon :icon="page.icon" :size="56" :fallback="false" /></div>
        <input
          v-model="title"
          class="shv-title"
          placeholder="未命名"
          :readonly="!canEdit"
          @input="onTitleInput"
        />
        <BlockEditor :content="content" :page-id="page.id" :editable="canEdit" @change="onChange" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.shv {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--gn-bg);
}
.shv-top {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  flex: 0 0 44px;
  padding: 0 12px;
}
.shv-crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
.shv-crumb.current {
  color: var(--gn-text-soft);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}
.shv-crumb + .shv-crumb::before {
  content: '/';
  margin-right: 6px;
  color: var(--gn-border-strong);
}
.shv-grow {
  flex: 1 1 auto;
}
.shv-role {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 99px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 11.5px;
  white-space: nowrap;
}
.shv-role.editor {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.shv-save {
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.shv-save.error {
  color: var(--gn-danger);
}
.shv-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
}
.shv-inner {
  max-width: 760px;
  margin: 0 auto;
  padding: 34px 56px 0;
}
.shv-title {
  display: block;
  width: 100%;
  margin: 8px 0 12px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--gn-text);
  font-family: var(--gn-editor-font, var(--gn-font));
  font-size: calc(var(--gn-editor-font-size, 16px) * 2.125);
  font-weight: 680;
}
.shv-error {
  padding: 80px 24px;
  text-align: center;
  color: var(--gn-text-muted);
}
@media (max-width: 768px) {
  .shv-inner {
    padding: 20px 18px 0;
  }
  .shv-role {
    display: none;
  }
}
</style>
