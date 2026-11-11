<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Star,
  MoreHorizontal,
  PanelLeftOpen,
  ChevronRight,
  Download,
  Link2,
  Trash2,
  Copy,
  Smile,
  Home,
  ListTree,
  Check,
  ChevronDown,
} from 'lucide-vue-next'
import BlockEditor from '@/editor/BlockEditor.vue'
import PageToc, { type TocItem } from '@/components/PageToc.vue'
import {
  activePage,
  ancestorsOf,
  goToPage,
  goHome,
  reloadPages,
  store,
  NOTE_WIDTH_RATIOS,
  setNoteWidthMode,
  setNoteWidthRatio,
  toggleTocVisible,
  type NoteWidthRatio,
} from '@/store'
import { createPage, saveContent, savePage, trashPage, toPlainText } from '@/db/repo'
import { hydrateAssets, inflateAssetsForExport } from '@/editor/assets'
import { expandDatabases } from '@/blocks/exportDatabases'

const props = defineProps<{ pageId: string }>()

const editorRef = ref<InstanceType<typeof BlockEditor> | null>(null)
const titleRef = ref<HTMLTextAreaElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const title = ref('')
const editorHtml = ref<string | null>(null)
const menuOpen = ref(false)
const emojiOpen = ref(false)
const widthMenuOpen = ref(false)
const copied = ref(false)
const tocItems = ref<TocItem[]>([])

const WIDTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: '自动调节' },
  ...NOTE_WIDTH_RATIOS.map((r) => ({ value: String(r), label: `${r}%` })),
]

const page = computed(() => (activePage.value?.id === props.pageId ? activePage.value : null))
const crumbs = computed(() => ancestorsOf(store.pages, props.pageId))

const innerStyle = computed(() => {
  if (store.noteWidthMode === 'auto') {
    return { maxWidth: '100%', width: '100%' }
  }
  return { maxWidth: `${store.noteWidthRatio}%`, width: '100%' }
})

function extractTocFromMarkdown(md: string): TocItem[] {
  const items: TocItem[] = []
  let inFence = false
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (/^```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^(#{1,3})\s+(.+?)\s*$/)
    if (!m) continue
    const text = m[2].replace(/[*_`~]/g, '').trim()
    if (!text) continue
    items.push({ level: m[1].length, text, index: items.length })
  }
  return items
}

function syncToc(markdown?: string) {
  const md = markdown ?? page.value?.content ?? ''
  tocItems.value = extractTocFromMarkdown(md)
}

const widthSelectValue = computed(() =>
  store.noteWidthMode === 'auto' ? 'auto' : String(store.noteWidthRatio),
)

const widthSelectLabel = computed(
  () => WIDTH_OPTIONS.find((o) => o.value === widthSelectValue.value)?.label ?? '自动调节',
)

function pickWidth(value: string) {
  if (value === 'auto') setNoteWidthMode('auto')
  else setNoteWidthRatio(Number(value) as NoteWidthRatio)
  widthMenuOpen.value = false
}

function toggleWidthMenu() {
  widthMenuOpen.value = !widthMenuOpen.value
}

const wordCount = computed(() => {
  const text = page.value?.content ?? ''
  const plain = toPlainText(text, 100000)
  return plain.replace(/\s/g, '').length
})

const updatedLabel = computed(() => {
  const ts = page.value?.updatedAt
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `今天 ${hh}:${mm}`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hh}:${mm}`
})

const EMOJIS = [
  '🍃', '📄', '📝', '📚', '💡', '🎯', '🚀', '⭐️', '🔥', '✅',
  '📌', '🗂️', '🧠', '💭', '🔖', '🎨', '🧩', '⚙️', '🌱', '🍀',
  '🌊', '☀️', '🌙', '☕️', '🍵', '🧪', '🔬', '📊', '📈', '🗓️',
  '✍️', '🎵', '🏔️', '🌍', '💎', '🪴', '🐚', '🦋', '🕊️', '✨',
]

function autosize() {
  const el = titleRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

onMounted(async () => {
  title.value = page.value?.title ?? ''
  syncToc(page.value?.content)
  await nextTick()
  autosize()
  if (!page.value?.title) titleRef.value?.focus()
  document.addEventListener('mousedown', onGlobalDown)
  // 先把 asset: 引用换成 blob URL 再交给编辑器，避免首屏出现无效图片请求
  try {
    editorHtml.value = await hydrateAssets(page.value?.content ?? '')
  } catch {
    editorHtml.value = page.value?.content ?? ''
  }
})

watch(
  () => page.value?.title,
  (t) => {
    if (t !== undefined && t !== title.value) {
      title.value = t
      void nextTick(autosize)
    }
  },
)

function onTitleInput() {
  autosize()
  const p = page.value
  if (!p) return
  p.title = title.value
  scheduleTitleSave()
}

let titleTimer: number | null = null
function scheduleTitleSave() {
  if (titleTimer) window.clearTimeout(titleTimer)
  titleTimer = window.setTimeout(async () => {
    titleTimer = null
    const p = page.value
    if (!p) return
    try {
      await savePage(p.id, { title: title.value })
    } catch {
      store.saveState = 'error'
    }
  }, 400)
}

function onTitleEnter(e: KeyboardEvent) {
  ;(e.target as HTMLTextAreaElement).blur()
  nextTick(() => {
    editorRef.value?.focus()
  })
}

async function onContentChange(markdown: string, pageId: string) {
  store.saveState = 'saving'
  if (pageId === props.pageId) syncToc(markdown)
  let excerpt: string
  try {
    excerpt = await saveContent(
      pageId,
      markdown,
      pageId === props.pageId ? title.value || undefined : undefined,
    )
  } catch {
    store.saveState = 'error'
    return
  }
  const p = store.pages.find((x) => x.id === pageId)
  if (p) {
    p.content = markdown
    p.excerpt = excerpt || toPlainText(markdown)
    p.updatedAt = Date.now()
    if (pageId === props.pageId && !p.title && markdown) {
      const firstLine = markdown.split('\n').find((l) => l.trim())
      if (firstLine) {
        p.title = firstLine.replace(/^#{1,6}\s+/, '').slice(0, 60)
        title.value = p.title
      }
    }
  }
  await new Promise((r) => setTimeout(r, 220))
  if (store.saveState === 'saving') store.saveState = 'saved'
}

async function pickEmoji(e: string) {
  emojiOpen.value = false
  const p = page.value
  if (!p) return
  p.icon = e
  await savePage(p.id, { icon: e })
}

async function removeIcon() {
  emojiOpen.value = false
  const p = page.value
  if (!p) return
  p.icon = ''
  await savePage(p.id, { icon: '' })
}

async function toggleFavorite() {
  const p = page.value
  if (!p) return
  p.favorite = !p.favorite
  await savePage(p.id, { favorite: p.favorite })
  menuOpen.value = false
}

async function exportMarkdown() {
  const p = page.value
  if (!p) return
  menuOpen.value = false
  const md = await expandDatabases(await inflateAssetsForExport(p.content))
  const name = (p.title || '未命名').replace(/[\\/:*?"<>|]/g, '_')
  const body = p.title ? `# ${p.title}\n\n${md}` : md
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function copyLink() {
  const p = page.value
  if (!p) return
  const link = `${location.origin}${location.pathname}#/p/${p.id}`
  try {
    await navigator.clipboard.writeText(link)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    /* ignore */
  }
  menuOpen.value = false
}

async function duplicatePage() {
  const p = page.value
  if (!p) return
  menuOpen.value = false
  const np = await createPage({
    title: `${p.title || '未命名'} 副本`,
    icon: p.icon,
    content: p.content,
  })
  await reloadPages()
  goToPage(np.id)
}

async function moveToTrash() {
  const p = page.value
  if (!p) return
  menuOpen.value = false
  editorRef.value?.flush()
  await trashPage(p.id)
  await reloadPages()
  goHome()
}

function onGlobalDown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (menuOpen.value && !target.closest('.nv-menu') && !target.closest('.nv-more-btn')) {
    menuOpen.value = false
    widthMenuOpen.value = false
  }
  if (widthMenuOpen.value && !target.closest('.nv-width-dd')) {
    widthMenuOpen.value = false
  }
  if (emojiOpen.value && !target.closest('.emoji-pop') && !target.closest('.nv-emoji')) {
    emojiOpen.value = false
  }
}

watch(menuOpen, (open) => {
  if (!open) widthMenuOpen.value = false
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onGlobalDown)
  // 离开页面时只补写还没落库的标题
  if (titleTimer) {
    window.clearTimeout(titleTimer)
    titleTimer = null
    const pid = props.pageId
    if (pid) savePage(pid, { title: title.value }).catch(() => undefined)
  }
})
</script>

<template>
  <div class="note-view">
    <header class="nv-topbar">
      <div class="nv-crumbs">
        <button class="nv-crumb home" @click="goHome" title="全部笔记">
          <Home :size="13" :stroke-width="1.9" />
        </button>
        <template v-for="c in crumbs" :key="c.id">
          <ChevronRight :size="12" class="nv-crumb-sep" />
          <button class="nv-crumb" @click="goToPage(c.id)">
            <span v-if="c.icon" class="nv-crumb-icon">{{ c.icon }}</span>
            {{ c.title || '未命名' }}
          </button>
        </template>
        <ChevronRight v-if="crumbs.length || page?.title" :size="12" class="nv-crumb-sep" />
        <span class="nv-crumb-current">{{ page?.title || '未命名' }}</span>
      </div>

      <div class="nv-top-actions">
        <span class="nv-save" :class="{ error: store.saveState === 'error' }">
          <span v-if="store.saveState === 'saving'" class="nv-dot saving"></span>
          <span v-else class="nv-dot"></span>
          {{
            store.saveState === 'saving'
              ? '保存中'
              : store.saveState === 'error'
                ? '保存失败，继续编辑会自动重试'
                : '已保存'
          }}
        </span>

        <button
          class="gn-icon-btn nv-more-btn"
          :class="{ starred: page?.favorite }"
          :title="page?.favorite ? '取消收藏' : '收藏'"
          @click="toggleFavorite"
        >
          <Star :size="15" :stroke-width="1.9" :fill="page?.favorite ? 'currentColor' : 'none'" />
        </button>

        <button class="gn-icon-btn nv-more-btn" title="更多" @click="menuOpen = !menuOpen">
          <MoreHorizontal :size="16" :stroke-width="1.9" />
        </button>

        <button
          v-if="!store.sidebarOpen"
          class="gn-icon-btn"
          title="展开侧边栏"
          @click="store.sidebarOpen = true"
        >
          <PanelLeftOpen :size="16" :stroke-width="1.9" />
        </button>

        <div v-if="menuOpen" class="nv-menu gn-pop">
          <button @click="copyLink">
            <Link2 :size="14" :stroke-width="1.8" />
            <span>{{ copied ? '已复制链接' : '复制页面链接' }}</span>
          </button>
          <button @click="duplicatePage">
            <Copy :size="14" :stroke-width="1.8" /><span>创建副本</span>
          </button>
          <button @click="exportMarkdown">
            <Download :size="14" :stroke-width="1.8" /><span>导出为 Markdown</span>
          </button>
          <div class="nv-menu-sep"></div>
          <div class="nv-menu-section nv-width-row">
            <span class="nv-menu-label">页面宽度</span>
            <div class="nv-width-dd">
              <button
                type="button"
                class="nv-width-trigger"
                :class="{ open: widthMenuOpen }"
                @click.stop="toggleWidthMenu"
              >
                <span>{{ widthSelectLabel }}</span>
                <ChevronDown :size="13" :stroke-width="2" />
              </button>
              <div v-if="widthMenuOpen" class="nv-width-list gn-pop">
                <button
                  v-for="opt in WIDTH_OPTIONS"
                  :key="opt.value"
                  type="button"
                  class="nv-width-opt"
                  :class="{ on: widthSelectValue === opt.value }"
                  @click.stop="pickWidth(opt.value)"
                >
                  <span>{{ opt.label }}</span>
                  <Check
                    v-if="widthSelectValue === opt.value"
                    :size="13"
                    :stroke-width="2.2"
                  />
                </button>
              </div>
            </div>
          </div>
          <button @click="toggleTocVisible()">
            <ListTree :size="14" :stroke-width="1.8" />
            <span>页面目录</span>
            <Check v-if="store.tocVisible" class="nv-menu-check" :size="14" :stroke-width="2.2" />
          </button>
          <div class="nv-menu-sep"></div>
          <button class="danger" @click="moveToTrash">
            <Trash2 :size="14" :stroke-width="1.8" /><span>移到回收站</span>
          </button>
        </div>
      </div>
    </header>

    <div class="nv-body">
      <div ref="scrollRef" class="nv-scroll gn-scroll">
        <div class="nv-inner" :class="{ auto: store.noteWidthMode === 'auto' }" :style="innerStyle">
          <div class="nv-icon-row">
            <button class="nv-emoji" :class="{ empty: !page?.icon }" @click="emojiOpen = !emojiOpen">
              <span v-if="page?.icon" class="nv-emoji-char">{{ page.icon }}</span>
              <Smile v-else :size="26" :stroke-width="1.4" />
            </button>
            <div v-if="emojiOpen" class="emoji-pop gn-pop">
              <button class="emoji-cell remove" @click="removeIcon">移除</button>
              <button v-for="e in EMOJIS" :key="e" class="emoji-cell" @click="pickEmoji(e)">
                {{ e }}
              </button>
            </div>
          </div>

          <textarea
            ref="titleRef"
            v-model="title"
            class="nv-title"
            rows="1"
            placeholder="未命名"
            spellcheck="false"
            @input="onTitleInput"
            @keydown.enter.prevent="onTitleEnter"
          ></textarea>

          <div class="nv-meta">
            <span>{{ wordCount }} 字</span>
            <span v-if="updatedLabel">· 编辑于 {{ updatedLabel }}</span>
          </div>

          <BlockEditor
            v-if="editorHtml !== null"
            ref="editorRef"
            :key="pageId"
            :content="editorHtml"
            :page-id="pageId"
            @change="onContentChange"
          />
        </div>
      </div>

      <PageToc v-if="store.tocVisible" :items="tocItems" :scroll-root="scrollRef" />
    </div>
  </div>
</template>

<style scoped>
.note-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--gn-bg);
}
.nv-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  flex: 0 0 44px;
  padding: 0 12px 0 12px;
  border-bottom: 1px solid transparent;
  position: relative;
  z-index: 40;
}
.nv-crumbs {
  display: flex;
  align-items: center;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
}
.nv-crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  height: 24px;
  padding: 0 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nv-crumb:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.nv-crumb-icon {
  font-size: 12px;
}
.nv-crumb-sep {
  color: var(--gn-border-strong);
  flex: 0 0 auto;
}
.nv-crumb-current {
  font-size: 12.5px;
  color: var(--gn-text-soft);
  font-weight: 500;
  padding: 0 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.nv-top-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  position: relative;
  flex: 0 0 auto;
}
.nv-more-btn.starred {
  color: #e0a92e;
}
.nv-save {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--gn-text-muted);
  padding-right: 6px;
  white-space: nowrap;
}
.nv-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gn-accent);
  opacity: 0.55;
}
.nv-save.error {
  color: var(--gn-danger);
}
.nv-save.error .nv-dot {
  background: var(--gn-danger);
  opacity: 1;
}
.nv-dot.saving {
  animation: gn-blink 1s ease-in-out infinite;
  opacity: 1;
}
@keyframes gn-blink {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}
.nv-menu {
  position: absolute;
  top: 34px;
  right: 0;
  width: 236px;
  padding: 5px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  box-shadow: var(--gn-shadow-lg);
  z-index: 80;
}
.nv-menu > button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.nv-menu > button:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.nv-menu > button.danger {
  color: var(--gn-danger);
}
.nv-menu > button.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
}
.nv-menu-check {
  margin-left: auto;
  color: var(--gn-accent);
}
.nv-menu-sep {
  height: 1px;
  margin: 4px 3px;
  background: var(--gn-border);
}
.nv-menu-section {
  padding: 4px 8px 6px;
}
.nv-menu-label {
  font-size: 13px;
  color: var(--gn-text-soft);
}
.nv-width-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.nv-width-dd {
  position: relative;
}
.nv-width-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  min-width: 96px;
  padding: 0 8px 0 10px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg-hover);
  color: var(--gn-text);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.nv-width-trigger:hover,
.nv-width-trigger.open {
  background: var(--gn-bg-active);
  border-color: var(--gn-border-strong);
}
.nv-width-trigger span {
  flex: 1 1 auto;
  text-align: left;
}
.nv-width-trigger :deep(svg) {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  transition: transform 0.14s ease;
}
.nv-width-trigger.open :deep(svg) {
  transform: rotate(180deg);
}
.nv-width-list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 90;
  min-width: 118px;
  padding: 4px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  box-shadow: var(--gn-shadow-md);
}
.nv-width-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.nv-width-opt span {
  flex: 1 1 auto;
}
.nv-width-opt:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.nv-width-opt.on {
  color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.nv-width-opt :deep(svg) {
  flex: 0 0 auto;
  color: var(--gn-accent);
}
.nv-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: stretch;
}
.nv-scroll {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.nv-inner {
  max-width: 70%;
  margin: 0 auto;
  padding: 34px 56px 0 56px;
}
.nv-inner.auto {
  max-width: 100%;
  padding-left: 48px;
  padding-right: 48px;
}
.nv-icon-row {
  position: relative;
  margin-bottom: 4px;
}
.nv-emoji {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  color: var(--gn-text-muted);
  transition: background 0.14s ease, opacity 0.14s ease;
}
.nv-emoji:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.nv-emoji.empty {
  opacity: 0;
}
.nv-icon-row:hover .nv-emoji.empty,
.nv-emoji.empty:focus-visible {
  opacity: 0.5;
}
.nv-emoji-char {
  font-size: 34px;
  line-height: 1;
}
.emoji-pop {
  position: absolute;
  top: 48px;
  left: 0;
  z-index: 60;
  width: 288px;
  padding: 6px;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 1px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  box-shadow: var(--gn-shadow-lg);
}
.emoji-cell {
  height: 30px;
  border: none;
  border-radius: 5px;
  background: transparent;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.emoji-cell:hover {
  background: var(--gn-bg-hover);
}
.emoji-cell.remove {
  grid-column: span 8;
  height: 26px;
  font-size: 12px;
  color: var(--gn-text-muted);
}
.nv-title {
  display: block;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-family: inherit;
  font-size: 34px;
  font-weight: 680;
  line-height: 1.25;
  letter-spacing: -0.022em;
  color: var(--gn-text);
  padding: 2px 0 0;
  overflow: hidden;
}
.nv-title::placeholder {
  color: var(--gn-border-strong);
}
.nv-meta {
  display: flex;
  gap: 6px;
  font-size: 11.5px;
  color: var(--gn-text-muted);
  padding: 6px 0 12px;
}
</style>
