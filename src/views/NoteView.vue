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
  Image as ImageIcon,
  MessageSquare,
  X,
  Undo2,
  Redo2,
  Scaling,
  Type,
  CaseSensitive,
  Rows3,
  FileType,
  ImageDown,
  Replace,
  Lock,
  Unlock,
  Share2,
  Sparkles,
  Languages,
  ListChecks,
  Bug,
  GripVertical,
} from 'lucide-vue-next'
import type { Editor } from '@tiptap/core'
import BlockEditor from '@/editor/BlockEditor.vue'
import ShareDialog from '@/components/ShareDialog.vue'
import { tr } from '@/i18n/phrases'
import PageToc, { type TocItem } from '@/components/PageToc.vue'
import FindReplaceBar from '@/components/FindReplaceBar.vue'
import ImageExportModal from '@/components/ImageExportModal.vue'
import CollapseTransition from '@/components/CollapseTransition.vue'
import ChildPages from '@/components/ChildPages.vue'
import PresenceAvatars from '@/components/PresenceAvatars.vue'
import { ApiError } from '@/api/client'
import { claimEdit, releaseEdit } from '@/api/features'
import { copyText } from '@/utils/clipboard'
import {
  activePage,
  ancestorsOf,
  goToPage,
  goHome,
  pageUrl,
  reloadPages,
  store,
  NOTE_WIDTH_RATIOS,
  NOTE_FONT_SIZES,
  NOTE_FONT_STYLES,
  NOTE_LAYOUTS,
  setNoteWidthMode,
  setNoteWidthRatio,
  setNoteFontSize,
  setNoteFontStyle,
  setNoteLayout,
  toggleTocVisible,
  isAdmin,
  setGutterTuning,
  type NoteFontSize,
  type NoteFontStyle,
  type NoteLayout,
  type NoteWidthRatio,
} from '@/store'
import { createPage, saveContent, savePage, trashPage, toPlainText, uid } from '@/db/repo'
import { ASSET_PREFIX, hydrateAssets, inflateAssetsForExport } from '@/editor/assets'
import { expandDatabases } from '@/blocks/exportDatabases'
import { downloadBlob, exportNoteAsPdf, safeFileName } from '@/utils/exportPage'
import { randomGradientCover, resolveCoverBackground } from '@/components/pageCover'
import CoverPicker from '@/components/CoverPicker.vue'
import IconPicker from '@/components/IconPicker.vue'
import PageIcon from '@/components/PageIcon.vue'
import { formatCombo, matchShortcut, shortcuts } from '@/shortcuts'
import type { PageComment } from '@/types'

const props = defineProps<{ pageId: string }>()

const editorRef = ref<InstanceType<typeof BlockEditor> | null>(null)
const titleRef = ref<HTMLTextAreaElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const exportRoot = ref<HTMLElement | null>(null)
const exporting = ref(false)
const title = ref('')
const editorHtml = ref<string | null>(null)
const menuOpen = ref(false)
const emojiOpen = ref(false)
const widthMenuOpen = ref(false)
const fontSizeMenuOpen = ref(false)
const fontStyleMenuOpen = ref(false)
const layoutMenuOpen = ref(false)
const exportMenuOpen = ref(false)
const debugMenuOpen = ref(false)
const findOpen = ref(false)
const findStartWithReplace = ref(false)
const imageExportOpen = ref(false)
const copied = ref(false)
const tocItems = ref<TocItem[]>([])

const tipTapEditor = computed<Editor | null>(() => {
  const ed = editorRef.value?.editor as Editor | null | undefined
  return ed ?? null
})

type PrefMenu = 'width' | 'fontSize' | 'fontStyle' | 'layout'

const WIDTH_OPTIONS = computed<{ value: string; label: string }[]>(() => [
  { value: 'auto', label: tr('自动调节') },
  ...NOTE_WIDTH_RATIOS.map((r) => ({ value: String(r), label: `${r}%` })),
])

/** 「今天 10:20」/「3 月 5 日 10:20」 */
function dayTimeLabel(ts: number): string {
  const d = new Date(ts)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === new Date().toDateString()) return tr('今天 {time}', { time })
  return tr('{m} 月 {d} 日 {time}', { m: d.getMonth() + 1, d: d.getDate(), time })
}

const FONT_SIZE_OPTIONS = NOTE_FONT_SIZES.map((s) => ({
  value: s,
  label: `${s}px`,
}))

const page = computed(() => (activePage.value?.id === props.pageId ? activePage.value : null))
const crumbs = computed(() => ancestorsOf(store.pages, props.pageId))
const isLocked = computed(() => !!page.value?.locked)

/** 有人抢先占用编辑权时，本页转为只读并给出提示 */
const remoteEditing = ref(false)
const remoteEditorName = ref('')
const hasEditLease = ref(false)
const canEdit = computed(() => !isLocked.value && !remoteEditing.value)

/** 首次真正编辑时才申请编辑占用，避免只是查看也抢走写权限 */
async function ensureEditLease(): Promise<boolean> {
  if (hasEditLease.value) return true
  if (!canEdit.value || !page.value) return false
  try {
    await claimEdit(page.value.id)
    hasEditLease.value = true
    return true
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const data = e.data as { holder?: { name?: string } } | null
      remoteEditorName.value = data?.holder?.name ?? '其他成员'
      remoteEditing.value = true
      return false
    }
    // 其他错误不阻塞编辑（例如断网时会话内继续尝试）
    return true
  }
}

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
  () => WIDTH_OPTIONS.value.find((o) => o.value === widthSelectValue.value)?.label ?? tr('自动调节'),
)

const fontSizeSelectLabel = computed(() => `${store.noteFontSize}px`)

const fontStyleSelectLabel = computed(
  () => tr(NOTE_FONT_STYLES.find((s) => s.id === store.noteFontStyle)?.label ?? '默认'),
)

const layoutSelectLabel = computed(
  () => tr(NOTE_LAYOUTS.find((l) => l.id === store.noteLayout)?.label ?? '默认'),
)

const prefMenus: Record<PrefMenu, typeof widthMenuOpen> = {
  width: widthMenuOpen,
  fontSize: fontSizeMenuOpen,
  fontStyle: fontStyleMenuOpen,
  layout: layoutMenuOpen,
}

function closePrefMenus() {
  widthMenuOpen.value = false
  fontSizeMenuOpen.value = false
  fontStyleMenuOpen.value = false
  layoutMenuOpen.value = false
}

function closeExportMenu() {
  exportMenuOpen.value = false
}

function closeDebugMenu() {
  debugMenuOpen.value = false
}

function togglePrefMenu(which: PrefMenu) {
  const open = prefMenus[which]
  const next = !open.value
  closePrefMenus()
  closeExportMenu()
  closeDebugMenu()
  open.value = next
}

function toggleExportMenu() {
  const next = !exportMenuOpen.value
  closePrefMenus()
  closeDebugMenu()
  exportMenuOpen.value = next
}

function toggleDebugMenu() {
  const next = !debugMenuOpen.value
  closePrefMenus()
  closeExportMenu()
  debugMenuOpen.value = next
}

function toggleGutterTuning() {
  setGutterTuning(!store.gutterTuning)
}

function toggleMoreMenu() {
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) {
    closePrefMenus()
    closeExportMenu()
    closeDebugMenu()
  }
}

function openFindReplace(withReplace = false) {
  findStartWithReplace.value = canEdit.value ? withReplace : false
  findOpen.value = true
  menuOpen.value = false
  closePrefMenus()
  closeExportMenu()
}

function closeFindReplace() {
  findOpen.value = false
  findStartWithReplace.value = false
  tipTapEditor.value?.commands.clearSearch()
}

function pickWidth(value: string) {
  if (value === 'auto') setNoteWidthMode('auto')
  else setNoteWidthRatio(Number(value) as NoteWidthRatio)
  closePrefMenus()
}

function pickFontSize(size: NoteFontSize) {
  setNoteFontSize(size)
  closePrefMenus()
}

function pickFontStyle(style: NoteFontStyle) {
  setNoteFontStyle(style)
  closePrefMenus()
}

function pickLayout(layout: NoteLayout) {
  setNoteLayout(layout)
  closePrefMenus()
}

const wordCount = computed(() => {
  const text = page.value?.content ?? ''
  const plain = toPlainText(text, 100000)
  return plain.replace(/\s/g, '').length
})

const updatedLabel = computed(() => {
  const ts = page.value?.updatedAt
  return ts ? dayTimeLabel(ts) : ''
})

function autosize() {
  const el = titleRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function shortcutLabel(action: keyof typeof shortcuts): string {
  return formatCombo(shortcuts[action])
}

function onNoteKeydown(e: KeyboardEvent) {
  const action = matchShortcut(e)
  if (!action) return
  switch (action) {
    case 'find':
      e.preventDefault()
      openFindReplace(e.shiftKey)
      break
    case 'copyLink':
      e.preventDefault()
      void copyLink()
      break
    case 'duplicate':
      e.preventDefault()
      void duplicatePage()
      break
    case 'share':
      e.preventDefault()
      openShare()
      break
    case 'favorite':
      e.preventDefault()
      void toggleFavorite()
      break
    case 'toggleToc':
      e.preventDefault()
      toggleTocVisible()
      break
    case 'lockPage':
      e.preventDefault()
      void toggleLock()
      break
    case 'aiSummary':
      if (!canEdit.value) return
      e.preventDefault()
      pageAi('summary')
      break
    case 'askAi':
      if (!canEdit.value) return
      e.preventDefault()
      pageAi()
      break
    default:
      break
  }
}

onMounted(async () => {
  title.value = page.value?.title ?? ''
  syncToc(page.value?.content)
  await nextTick()
  autosize()
  if (!page.value?.title) titleRef.value?.focus()
  document.addEventListener('mousedown', onGlobalDown)
  document.addEventListener('keydown', onNoteKeydown)
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
  if (!canEdit.value) return
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

/** 租约冲突导致只读后，对方离开时用户主动重新拉取最新内容并恢复可编辑 */
async function reloadFromRemote() {
  const pid = props.pageId
  remoteEditing.value = false
  remoteEditorName.value = ''
  hasEditLease.value = false
  try {
    await reloadPages()
    title.value = page.value?.title ?? ''
    editorHtml.value = await hydrateAssets(page.value?.content ?? '')
    syncToc(page.value?.content)
    store.saveState = 'saved'
  } catch {
    store.saveState = 'error'
  }
}

async function onContentChange(markdown: string, pageId: string) {
  if (!canEdit.value) return
  if (!(await ensureEditLease())) {
    store.saveState = 'error'
    return
  }

  store.saveState = 'saving'
  if (pageId === props.pageId) syncToc(markdown)
  let excerpt: string
  try {
    excerpt = await saveContent(
      pageId,
      markdown,
      pageId === props.pageId ? title.value || undefined : undefined,
    )
  } catch (e) {
    // 版本冲突已被 putPage 内部自动重试消化；走到这里说明极端并发下仍失败。
    // 不再把编辑器锁成只读（那样 onContentChange 直接 return，形成「提示会重试却永不重试」的死锁）。
    // 保留 error 状态，用户下一次输入会再次触发保存并重试。
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

async function pickIcon(icon: string) {
  if (!canEdit.value) return
  emojiOpen.value = false
  const p = page.value
  if (!p) return
  p.icon = icon
  await savePage(p.id, { icon })
}

async function removeIcon() {
  if (!canEdit.value) return
  emojiOpen.value = false
  const p = page.value
  if (!p) return
  p.icon = ''
  await savePage(p.id, { icon: '' })
}

/* ---------------- 封面 ---------------- */

const coverBg = ref<string | null>(null)
const coverMenuOpen = ref(false)

watch(
  () => page.value?.cover,
  async (cover) => {
    coverBg.value = await resolveCoverBackground(cover)
  },
  { immediate: true },
)

async function setCover(cover: string | null) {
  if (!canEdit.value) return
  const p = page.value
  if (!p) return
  p.cover = cover
  await savePage(p.id, { cover })
}

async function addCover() {
  await setCover(randomGradientCover())
  coverMenuOpen.value = true
}

function onCoverPick(cover: string) {
  coverMenuOpen.value = false
  void setCover(cover)
}

function removeCover() {
  coverMenuOpen.value = false
  void setCover(null)
}

/* ---------------- 评论 ---------------- */

const commentOpen = ref(false)
const commentDraft = ref('')
const commentRef = ref<HTMLTextAreaElement | null>(null)
const comments = computed<PageComment[]>(() => page.value?.comments ?? [])
const showComments = computed(() => commentOpen.value || comments.value.length > 0)

function openComment() {
  if (!canEdit.value) return
  commentOpen.value = true
  void nextTick(() => commentRef.value?.focus())
}

async function submitComment() {
  if (!canEdit.value) return
  const p = page.value
  const text = commentDraft.value.trim()
  if (!p || !text) return
  const next: PageComment[] = [
    ...comments.value,
    { id: uid(), author: store.user?.username ?? '我', text, createdAt: Date.now() },
  ]
  p.comments = next
  commentDraft.value = ''
  await savePage(p.id, { comments: next })
}

async function removeComment(id: string) {
  if (!canEdit.value) return
  const p = page.value
  if (!p) return
  const next = comments.value.filter((c) => c.id !== id)
  p.comments = next
  if (!next.length) commentOpen.value = false
  await savePage(p.id, { comments: next })
}

function onCommentKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void submitComment()
  } else if (e.key === 'Escape' && !commentDraft.value.trim() && !comments.value.length) {
    commentOpen.value = false
  }
}

function formatCommentTime(ts: number): string {
  return dayTimeLabel(ts)
}

async function toggleFavorite() {
  const p = page.value
  if (!p) return
  p.favorite = !p.favorite
  await savePage(p.id, { favorite: p.favorite })
  menuOpen.value = false
}

/** 订阅编辑器 historyRev，让菜单上的撤回/重做按钮即时灰掉或亮起 */
const canUndo = computed(() => {
  void editorRef.value?.historyRev
  return !!editorRef.value?.canUndo()
})
const canRedo = computed(() => {
  void editorRef.value?.historyRev
  return !!editorRef.value?.canRedo()
})

function runUndo() {
  if (!canEdit.value || !canUndo.value) return
  editorRef.value?.undo()
}

function runRedo() {
  if (!canEdit.value || !canRedo.value) return
  editorRef.value?.redo()
}

async function exportMarkdown() {
  const p = page.value
  if (!p || exporting.value) return
  menuOpen.value = false
  const md = await expandDatabases(await inflateAssetsForExport(p.content))
  const name = safeFileName(p.title)
  const body = p.title ? `# ${p.title}\n\n${md}` : md
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
  downloadBlob(blob, `${name}.md`)
}

async function withVisualExport(run: (el: HTMLElement) => Promise<void>) {
  const p = page.value
  const el = exportRoot.value
  if (!p || !el || exporting.value) return
  menuOpen.value = false
  emojiOpen.value = false
  coverMenuOpen.value = false
  exporting.value = true
  await nextTick()
  try {
    await run(el)
  } catch (err) {
    console.error(err)
    window.alert(err instanceof Error ? err.message : tr('导出失败，请稍后重试'))
  } finally {
    exporting.value = false
  }
}

async function exportPdf() {
  await withVisualExport((el) => exportNoteAsPdf(el, page.value?.title ?? '未命名'))
}

function exportImage() {
  if (!exportRoot.value || exporting.value) return
  menuOpen.value = false
  closeExportMenu()
  imageExportOpen.value = true
}

async function toggleLock() {
  const p = page.value
  if (!p) return
  const locked = !p.locked
  p.locked = locked
  menuOpen.value = false
  await savePage(p.id, { locked })
}

async function copyLink() {
  const p = page.value
  if (!p) return
  const link = pageUrl(p.id)
  const ok = await copyText(link)
  if (ok) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  }
  menuOpen.value = false
}

async function duplicatePage() {
  const p = page.value
  if (!p) return
  menuOpen.value = false
  const np = await createPage({
    title: tr('{title} 副本', { title: p.title || tr('未命名') }),
    icon: p.icon,
    cover: p.cover,
    content: p.content,
  })
  await reloadPages()
  goToPage(np.id)
}

const shareOpen = ref(false)

function openShare() {
  menuOpen.value = false
  editorRef.value?.flush()
  shareOpen.value = true
}

/** 对整篇笔记执行 AI 动作；不指定动作时打开输入框 */
function pageAi(action?: string) {
  menuOpen.value = false
  editorRef.value?.openAi('page', action)
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
    closePrefMenus()
    closeExportMenu()
    closeDebugMenu()
  }
  if (
    (widthMenuOpen.value ||
      fontSizeMenuOpen.value ||
      fontStyleMenuOpen.value ||
      layoutMenuOpen.value) &&
    !target.closest('.nv-pref-dd')
  ) {
    closePrefMenus()
  }
  if (exportMenuOpen.value && !target.closest('.nv-sub-row')) {
    closeExportMenu()
  }
  if (debugMenuOpen.value && !target.closest('.nv-sub-row')) {
    closeDebugMenu()
  }
  if (
    emojiOpen.value &&
    !target.closest('.icon-picker') &&
    !target.closest('.nv-emoji') &&
    !target.closest('.nv-add-icon')
  ) {
    emojiOpen.value = false
  }
  if (coverMenuOpen.value && !target.closest('.cover-pop') && !target.closest('.nv-cover-change')) {
    coverMenuOpen.value = false
  }
  // 打开评论但未发送：点到评论区外则收起（有草稿内容时保留，避免误丢）
  if (
    commentOpen.value &&
    !commentDraft.value.trim() &&
    !comments.value.length &&
    !target.closest('.nv-comments')
  ) {
    commentOpen.value = false
  }
}

watch(menuOpen, (open) => {
  if (!open) {
    closePrefMenus()
    closeExportMenu()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onGlobalDown)
  document.removeEventListener('keydown', onNoteKeydown)
  tipTapEditor.value?.commands.clearSearch()
  if (hasEditLease.value) void releaseEdit(props.pageId)
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
  <div class="note-view" :class="{ 'is-exporting': exporting, locked: isLocked }">
    <ShareDialog v-if="shareOpen && page" :page-id="page.id" :page-title="page.title" @close="shareOpen = false" />
    <ImageExportModal
      v-if="imageExportOpen && exportRoot"
      :source="exportRoot"
      :title="page?.title || '未命名'"
      @close="imageExportOpen = false"
    />

    <Transition name="gn-drop">
      <div v-if="findOpen" class="nv-find-wrap">
        <FindReplaceBar
          :editor="tipTapEditor"
          :start-with-replace="findStartWithReplace"
          :replace-enabled="canEdit"
          @close="closeFindReplace"
        />
      </div>
    </Transition>

    <header class="nv-topbar">
      <button
        v-if="!store.sidebarOpen"
        class="gn-icon-btn nv-sidebar-open"
        v-tooltip="tr('展开侧边栏')"
        @click="store.sidebarOpen = true"
      >
        <PanelLeftOpen :size="16" :stroke-width="1.9" />
      </button>
      <div class="nv-crumbs">
        <button class="nv-crumb home" @click="goHome" v-tooltip="tr('全部笔记')">
          <Home :size="13" :stroke-width="1.9" />
        </button>
        <template v-for="c in crumbs" :key="c.id">
          <ChevronRight :size="12" class="nv-crumb-sep" />
          <button class="nv-crumb" @click="goToPage(c.id)">
            <span v-if="c.icon" class="nv-crumb-icon">{{ c.icon }}</span>
            {{ c.title || tr('未命名') }}
          </button>
        </template>
        <ChevronRight v-if="crumbs.length || page?.title" :size="12" class="nv-crumb-sep" />
        <span class="nv-crumb-current">{{ page?.title || tr('未命名') }}</span>
      </div>

      <div class="nv-top-actions">
        <PresenceAvatars :page-id="pageId" />
        <span class="nv-save" :class="{ error: store.saveState === 'error' }">
          <span v-if="store.saveState === 'saving'" class="nv-dot saving"></span>
          <span v-else class="nv-dot"></span>
          <span class="nv-save-text">{{
            store.saveState === 'saving'
              ? tr('保存中')
              : store.saveState === 'error'
                ? tr('保存失败，继续编辑会自动重试')
                : tr('已保存')
          }}</span>
        </span>

        <button
          class="gn-icon-btn nv-more-btn"
          v-tooltip="tr('公开分享 / 邀请成员')"
          @click="openShare"
        >
          <Share2 :size="15" :stroke-width="1.9" />
        </button>

        <button
          class="gn-icon-btn nv-more-btn"
          :class="{ starred: page?.favorite }"
          v-tooltip="page?.favorite ? tr('取消收藏') : tr('收藏')"
          @click="toggleFavorite"
        >
          <Star :size="15" :stroke-width="1.9" :fill="page?.favorite ? 'currentColor' : 'none'" />
        </button>

        <button class="gn-icon-btn nv-more-btn" v-tooltip="tr('更多')" @click="toggleMoreMenu">
          <MoreHorizontal :size="16" :stroke-width="1.9" />
        </button>

        <div v-if="menuOpen" class="nv-menu gn-pop">
          <button :disabled="!canEdit || !canUndo" @click="runUndo">
            <Undo2 :size="14" :stroke-width="1.8" />
            <span>{{ tr('撤回') }}</span>
            <kbd>{{ formatCombo('Mod+Z') }}</kbd>
          </button>
          <button :disabled="!canEdit || !canRedo" @click="runRedo">
            <Redo2 :size="14" :stroke-width="1.8" />
            <span>{{ tr('重做') }}</span>
            <kbd>{{ formatCombo('Mod+Y') }}</kbd>
          </button>
          <div class="nv-menu-sep"></div>
          <button @click="copyLink">
            <Link2 :size="14" :stroke-width="1.8" />
            <span>{{ copied ? tr('已复制链接') : tr('复制页面链接') }}</span>
            <kbd v-if="shortcutLabel('copyLink')">{{ shortcutLabel('copyLink') }}</kbd>
          </button>
          <button @click="duplicatePage">
            <Copy :size="14" :stroke-width="1.8" /><span>{{ tr('创建副本') }}</span>
            <kbd v-if="shortcutLabel('duplicate')">{{ shortcutLabel('duplicate') }}</kbd>
          </button>
          <button @click="openFindReplace(false)">
            <Replace :size="14" :stroke-width="1.8" />
            <span>{{ tr('查找或替换') }}</span>
            <kbd v-if="shortcutLabel('find')">{{ shortcutLabel('find') }}</kbd>
          </button>
          <button @click="openShare">
            <Share2 :size="14" :stroke-width="1.8" /><span>{{ tr('分享与协作') }}</span>
            <kbd v-if="shortcutLabel('share')">{{ shortcutLabel('share') }}</kbd>
          </button>
          <div class="nv-menu-sep"></div>
          <button :disabled="!canEdit" @click="pageAi('summary')">
            <Sparkles :size="14" :stroke-width="1.8" /><span>{{ tr('AI 总结全文') }}</span>
            <kbd v-if="shortcutLabel('aiSummary')">{{ shortcutLabel('aiSummary') }}</kbd>
          </button>
          <button :disabled="!canEdit" @click="pageAi('todo')">
            <ListChecks :size="14" :stroke-width="1.8" /><span>{{ tr('AI 提取待办') }}</span>
          </button>
          <button :disabled="!canEdit" @click="pageAi('en')">
            <Languages :size="14" :stroke-width="1.8" /><span>{{ tr('AI 翻译成英文') }}</span>
          </button>
          <button :disabled="!canEdit" @click="pageAi()">
            <Sparkles :size="14" :stroke-width="1.8" /><span>{{ tr('问问 AI…') }}</span>
            <kbd v-if="shortcutLabel('askAi')">{{ shortcutLabel('askAi') }}</kbd>
          </button>
          <div class="nv-sub-row">
            <button
              class="nv-sub-trigger"
              :class="{ open: exportMenuOpen }"
              :disabled="exporting"
              @click.stop="toggleExportMenu"
            >
              <Download :size="14" :stroke-width="1.8" />
              <span>{{ exporting ? tr('导出中…') : tr('导出') }}</span>
              <ChevronRight class="nv-sub-arrow" :size="14" :stroke-width="1.8" />
            </button>
            <div v-if="exportMenuOpen" class="nv-sub-menu gn-pop">
              <button :disabled="exporting" @click.stop="exportMarkdown">
                <Download :size="14" :stroke-width="1.8" />
                <span>Markdown</span>
              </button>
              <button :disabled="exporting" @click.stop="exportPdf">
                <FileType :size="14" :stroke-width="1.8" />
                <span>PDF</span>
              </button>
              <button :disabled="exporting" @click.stop="exportImage">
                <ImageDown :size="14" :stroke-width="1.8" />
                <span>{{ tr('图片') }}</span>
              </button>
            </div>
          </div>
          <div v-if="isAdmin" class="nv-sub-row">
            <button
              class="nv-sub-trigger"
              :class="{ open: debugMenuOpen }"
              @click.stop="toggleDebugMenu"
            >
              <Bug :size="14" :stroke-width="1.8" />
              <span>{{ tr('调试') }}</span>
              <ChevronRight class="nv-sub-arrow" :size="14" :stroke-width="1.8" />
            </button>
            <div v-if="debugMenuOpen" class="nv-sub-menu gn-pop">
              <button type="button" @click.stop="toggleGutterTuning">
                <GripVertical :size="14" :stroke-width="1.8" />
                <span>{{ tr('装订区调校') }}</span>
                <Check
                  v-if="store.gutterTuning"
                  :size="14"
                  :stroke-width="2"
                  class="nv-pref-check"
                />
              </button>
            </div>
          </div>
          <div class="nv-menu-sep"></div>
          <div class="nv-menu-section nv-pref-row">
            <Scaling :size="14" :stroke-width="1.8" />
            <span class="nv-menu-label">{{ tr('页面宽度') }}</span>
            <div class="nv-pref-dd">
              <button
                type="button"
                class="nv-pref-trigger"
                :class="{ open: widthMenuOpen }"
                @click.stop="togglePrefMenu('width')"
              >
                <span>{{ widthSelectLabel }}</span>
                <ChevronDown :size="13" :stroke-width="2" />
              </button>
              <div v-if="widthMenuOpen" class="nv-pref-list gn-pop">
                <button
                  v-for="opt in WIDTH_OPTIONS"
                  :key="opt.value"
                  type="button"
                  class="nv-pref-opt"
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
          <div class="nv-menu-section nv-pref-row">
            <Type :size="14" :stroke-width="1.8" />
            <span class="nv-menu-label">{{ tr('字体大小') }}</span>
            <div class="nv-pref-dd">
              <button
                type="button"
                class="nv-pref-trigger"
                :class="{ open: fontSizeMenuOpen }"
                @click.stop="togglePrefMenu('fontSize')"
              >
                <span>{{ fontSizeSelectLabel }}</span>
                <ChevronDown :size="13" :stroke-width="2" />
              </button>
              <div v-if="fontSizeMenuOpen" class="nv-pref-list gn-pop">
                <button
                  v-for="opt in FONT_SIZE_OPTIONS"
                  :key="opt.value"
                  type="button"
                  class="nv-pref-opt"
                  :class="{ on: store.noteFontSize === opt.value }"
                  @click.stop="pickFontSize(opt.value)"
                >
                  <span>{{ opt.label }}</span>
                  <Check
                    v-if="store.noteFontSize === opt.value"
                    :size="13"
                    :stroke-width="2.2"
                  />
                </button>
              </div>
            </div>
          </div>
          <div class="nv-menu-section nv-pref-row">
            <CaseSensitive :size="14" :stroke-width="1.8" />
            <span class="nv-menu-label">{{ tr('字体样式') }}</span>
            <div class="nv-pref-dd">
              <button
                type="button"
                class="nv-pref-trigger"
                :class="{ open: fontStyleMenuOpen }"
                @click.stop="togglePrefMenu('fontStyle')"
              >
                <span>{{ fontStyleSelectLabel }}</span>
                <ChevronDown :size="13" :stroke-width="2" />
              </button>
              <div v-if="fontStyleMenuOpen" class="nv-pref-list gn-pop">
                <button
                  v-for="opt in NOTE_FONT_STYLES"
                  :key="opt.id"
                  type="button"
                  class="nv-pref-opt"
                  :class="{ on: store.noteFontStyle === opt.id }"
                  :style="{ fontFamily: opt.css }"
                  @click.stop="pickFontStyle(opt.id)"
                >
                  <span>{{ tr(opt.label) }}</span>
                  <Check
                    v-if="store.noteFontStyle === opt.id"
                    :size="13"
                    :stroke-width="2.2"
                  />
                </button>
              </div>
            </div>
          </div>
          <div class="nv-menu-section nv-pref-row">
            <Rows3 :size="14" :stroke-width="1.8" />
            <span class="nv-menu-label">{{ tr('页面布局') }}</span>
            <div class="nv-pref-dd">
              <button
                type="button"
                class="nv-pref-trigger"
                :class="{ open: layoutMenuOpen }"
                @click.stop="togglePrefMenu('layout')"
              >
                <span>{{ layoutSelectLabel }}</span>
                <ChevronDown :size="13" :stroke-width="2" />
              </button>
              <div v-if="layoutMenuOpen" class="nv-pref-list gn-pop">
                <button
                  v-for="opt in NOTE_LAYOUTS"
                  :key="opt.id"
                  type="button"
                  class="nv-pref-opt"
                  :class="{ on: store.noteLayout === opt.id }"
                  @click.stop="pickLayout(opt.id)"
                >
                  <span>{{ tr(opt.label) }}</span>
                  <Check
                    v-if="store.noteLayout === opt.id"
                    :size="13"
                    :stroke-width="2.2"
                  />
                </button>
              </div>
            </div>
          </div>
          <button @click="toggleTocVisible()">
            <ListTree :size="14" :stroke-width="1.8" />
            <span>{{ tr('页面目录') }}</span>
            <kbd v-if="shortcutLabel('toggleToc')">{{ shortcutLabel('toggleToc') }}</kbd>
            <Check v-if="store.tocVisible" class="nv-menu-check" :size="14" :stroke-width="2.2" />
          </button>
          <button @click="toggleLock">
            <component :is="isLocked ? Unlock : Lock" :size="14" :stroke-width="1.8" />
            <span>{{ isLocked ? tr('解除锁定') : tr('锁定页面') }}</span>
            <kbd v-if="shortcutLabel('lockPage')">{{ shortcutLabel('lockPage') }}</kbd>
            <Check v-if="isLocked" class="nv-menu-check" :size="14" :stroke-width="2.2" />
          </button>
          <div class="nv-menu-sep"></div>
          <button class="danger" :disabled="isLocked" @click="moveToTrash">
            <Trash2 :size="14" :stroke-width="1.8" /><span>{{ tr('移到回收站') }}</span>
          </button>
        </div>
      </div>
    </header>

    <div class="nv-body" :class="{ 'has-toc': store.tocVisible }">
      <div ref="scrollRef" class="nv-scroll gn-scroll">
        <div ref="exportRoot" class="nv-export-root">
        <div v-if="remoteEditing" class="nv-remote-banner">
          <Lock :size="14" :stroke-width="2.2" />
          <span>{{ tr('「{n}」正在编辑此页，当前为只读；对方离开后点重新加载即可继续', { n: remoteEditorName }) }}</span>
          <button class="nv-remote-reload" @click="reloadFromRemote">{{ tr('重新加载') }}</button>
        </div>
        <div v-if="page?.cover" class="nv-cover" :style="{ background: coverBg ?? 'var(--gn-bg-hover)' }">
          <div v-if="canEdit" class="nv-cover-actions">
            <button class="nv-cover-btn nv-cover-change" @click="coverMenuOpen = !coverMenuOpen">
              {{ tr('更换封面') }}
            </button>
            <button class="nv-cover-btn" @click="removeCover">{{ tr('移除') }}</button>
          </div>
          <CoverPicker
            v-if="coverMenuOpen"
            class="cover-pop-anchor"
            :current="page?.cover"
            @pick="onCoverPick"
            @clear="removeCover"
          />
        </div>

        <div class="nv-main" :class="{ 'with-toc': store.tocVisible }">
        <div
          class="nv-inner"
          :class="{ auto: store.noteWidthMode === 'auto', 'has-cover': !!page?.cover }"
          :style="innerStyle"
        >
          <div class="nv-head">
            <div v-if="page?.icon" class="nv-icon-row">
              <button
                class="nv-emoji"
                :disabled="!canEdit"
                v-tooltip="canEdit ? tr('更换图标') : tr('页面已锁定')"
                @click="canEdit && (emojiOpen = !emojiOpen)"
              >
                <PageIcon :icon="page.icon" :size="56" />
              </button>
            </div>

            <div
              v-if="canEdit && (!page?.icon || !page?.cover || !showComments)"
              class="nv-head-actions"
              :class="{ pinned: emojiOpen }"
            >
              <button
                v-if="!page?.icon"
                class="nv-head-btn nv-add-icon"
                @click="emojiOpen = !emojiOpen"
              >
                <Smile :size="15" :stroke-width="1.8" /><span>{{ tr('添加图标') }}</span>
              </button>
              <button v-if="!page?.cover" class="nv-head-btn" @click="addCover">
                <ImageIcon :size="15" :stroke-width="1.8" /><span>{{ tr('添加封面') }}</span>
              </button>
              <button v-if="!showComments" class="nv-head-btn" @click="openComment">
                <MessageSquare :size="15" :stroke-width="1.8" /><span>{{ tr('添加评论') }}</span>
              </button>
            </div>

            <IconPicker
              v-if="emojiOpen"
              class="nv-icon-picker"
              :class="{ under: !!page?.icon }"
              :current="page?.icon"
              @pick="pickIcon"
              @clear="removeIcon"
            />
          </div>

          <textarea
            ref="titleRef"
            v-model="title"
            class="nv-title"
            rows="1"
            :placeholder="tr('未命名')"
            spellcheck="false"
            :readonly="!canEdit"
            @input="onTitleInput"
            @keydown.enter.prevent="onTitleEnter"
          ></textarea>

          <div class="nv-meta">
            <span v-if="isLocked" class="nv-locked-tag">
              <Lock :size="11" :stroke-width="2.2" />{{ tr('已锁定') }}
            </span>
            <span>{{ tr('{n} 字', { n: wordCount }) }}</span>
            <span v-if="updatedLabel">{{ tr('· 编辑于 {time}', { time: updatedLabel }) }}</span>
          </div>

          <CollapseTransition>
          <section v-if="showComments" class="nv-comments">
            <div v-for="c in comments" :key="c.id" class="nv-comment">
              <span class="nv-comment-avatar">{{ c.author.slice(0, 1).toUpperCase() }}</span>
              <div class="nv-comment-body">
                <div class="nv-comment-head">
                  <span class="nv-comment-author">{{ c.author }}</span>
                  <span class="nv-comment-time">{{ formatCommentTime(c.createdAt) }}</span>
                  <button
                    v-if="canEdit"
                    class="nv-comment-del"
                    v-tooltip="tr('删除评论')"
                    @click="removeComment(c.id)"
                  >
                    <X :size="13" :stroke-width="2" />
                  </button>
                </div>
                <div class="nv-comment-text">{{ c.text }}</div>
              </div>
            </div>
            <div v-if="canEdit" class="nv-comment-compose">
              <span class="nv-comment-avatar">
                {{ (store.user?.username ?? '我').slice(0, 1).toUpperCase() }}
              </span>
              <textarea
                ref="commentRef"
                v-model="commentDraft"
                class="nv-comment-input"
                rows="1"
                :placeholder="tr('添加评论…  Enter 发送，Shift+Enter 换行')"
                @keydown="onCommentKeydown"
              ></textarea>
              <button
                class="nv-comment-send"
                :disabled="!commentDraft.trim()"
                @click="submitComment"
              >
                {{ tr('发送') }}
              </button>
            </div>
          </section>
          </CollapseTransition>

          <BlockEditor
            v-if="editorHtml !== null"
            ref="editorRef"
            :key="pageId"
            :content="editorHtml"
            :page-id="pageId"
            :editable="canEdit"
            :gutter-tuning="isAdmin && store.gutterTuning"
            @change="onContentChange"
          />

          <ChildPages :page-id="pageId" :editable="canEdit" />
        </div>
        <Transition name="gn-toc">
          <PageToc v-if="store.tocVisible" :items="tocItems" :scroll-root="scrollRef" />
        </Transition>
        </div>
        </div>
      </div>
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
  position: relative;
}
.nv-find-wrap {
  position: absolute;
  top: 44px;
  right: 16px;
  z-index: 120;
}
.nv-export-root {
  width: 100%;
}
.nv-locked-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--gn-accent);
}
.nv-remote-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 14px;
  padding: 10px 14px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-accent-soft);
  color: var(--gn-text);
  font-size: 13px;
  line-height: 1.5;
}
.nv-remote-banner svg {
  color: var(--gn-accent);
  flex: 0 0 auto;
}
.nv-remote-reload {
  margin-left: auto;
  flex: 0 0 auto;
  border: 1px solid var(--gn-accent);
  background: transparent;
  color: var(--gn-accent);
  border-radius: 7px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.nv-remote-reload:hover {
  background: var(--gn-accent);
  color: var(--gn-bg);
}
.note-view.locked .nv-title {
  cursor: default;
}
.note-view.locked .nv-emoji:disabled {
  cursor: default;
  opacity: 1;
}
/* 导出截图时隐藏交互控件，并收掉编辑器底部留白 */
.note-view.is-exporting .nv-head-actions,
.note-view.is-exporting .nv-cover-actions,
.note-view.is-exporting .nv-icon-picker,
.note-view.is-exporting .cover-pop,
.note-view.is-exporting .nv-comment-compose,
.note-view.is-exporting .nv-comment-del {
  display: none !important;
}
.note-view.is-exporting :deep(.note-editor .ProseMirror) {
  min-height: 0 !important;
  padding-bottom: 32px !important;
}
.note-view.is-exporting :deep(.block-handle),
.note-view.is-exporting :deep(.slash-menu),
.note-view.is-exporting :deep(.bubble-bar),
.note-view.is-exporting :deep(.tc-ui),
.note-view.is-exporting :deep(.column-resize-handle) {
  display: none !important;
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
.nv-sidebar-open {
  flex: 0 0 auto;
  margin-right: 2px;
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
/* 在线头像与「已保存」状态之间留出呼吸感 */
.nv-top-actions :deep(.pa-wrap) {
  margin-right: 8px;
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
  width: 268px;
  padding: 5px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  box-shadow: var(--gn-shadow-lg);
  z-index: 80;
}
.nv-menu > button,
.nv-sub-trigger,
.nv-sub-menu > button {
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
  font-family: inherit;
}
.nv-menu > button > span,
.nv-sub-trigger > span,
.nv-sub-menu > button > span {
  flex: 1;
  min-width: 0;
}
.nv-menu > button > kbd {
  flex: 0 0 auto;
  font-family: inherit;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.nv-menu > button:hover:not(:disabled),
.nv-sub-trigger:hover:not(:disabled),
.nv-sub-trigger.open,
.nv-sub-menu > button:hover:not(:disabled) {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.nv-menu > button:disabled,
.nv-sub-trigger:disabled,
.nv-sub-menu > button:disabled {
  opacity: 0.4;
  cursor: default;
}
.nv-menu > button.danger {
  color: var(--gn-danger);
}
.nv-menu > button.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
}
.nv-sub-row {
  position: relative;
}
.nv-sub-arrow {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--gn-text-muted);
}
.nv-sub-menu {
  position: absolute;
  top: -4px;
  right: calc(100% + 4px);
  z-index: 90;
  min-width: 148px;
  padding: 4px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  box-shadow: var(--gn-shadow-lg);
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
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--gn-text-soft);
}
.nv-pref-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nv-pref-row > :deep(svg) {
  flex: 0 0 auto;
  color: var(--gn-text-soft);
}
.nv-pref-dd {
  position: relative;
}
.nv-pref-trigger {
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
.nv-pref-trigger:hover,
.nv-pref-trigger.open {
  background: var(--gn-bg-active);
  border-color: var(--gn-border-strong);
}
.nv-pref-trigger span {
  flex: 1 1 auto;
  text-align: left;
}
.nv-pref-trigger :deep(svg) {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  transition: transform 0.14s ease;
}
.nv-pref-trigger.open :deep(svg) {
  transform: rotate(180deg);
}
.nv-pref-list {
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
.nv-pref-opt {
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
.nv-pref-opt span {
  flex: 1 1 auto;
}
.nv-pref-opt:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.nv-pref-opt.on {
  color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.nv-pref-opt :deep(svg) {
  flex: 0 0 auto;
  color: var(--gn-accent);
}
.nv-body {
  position: relative;
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
.nv-main {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 4px;
  padding-right: 8px;
}
.nv-main.with-toc {
  padding-right: 4px;
}
.nv-inner {
  flex: 1 1 auto;
  max-width: 70%;
  min-width: 0;
  margin: 0 auto;
  padding: 34px 56px 0 56px;
}
.nv-inner.auto {
  max-width: 100%;
  padding-left: 48px;
  padding-right: 48px;
}
.nv-main.with-toc .nv-inner.auto {
  padding-right: 24px;
}
.nv-inner.has-cover {
  padding-top: 0;
}
/* ---------- 封面 ---------- */
.nv-cover {
  position: relative;
  height: 200px;
  width: 100%;
}
.nv-cover-actions {
  position: absolute;
  right: 24px;
  bottom: 12px;
  display: flex;
  gap: 1px;
  border-radius: 6px;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.14s ease;
  box-shadow: var(--gn-shadow-sm);
}
.nv-cover:hover .nv-cover-actions,
.nv-cover:has(.cover-pop) .nv-cover-actions {
  opacity: 1;
}
.nv-cover-btn {
  height: 26px;
  padding: 0 10px;
  border: none;
  background: color-mix(in srgb, var(--gn-bg) 92%, transparent);
  color: var(--gn-text-soft);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.nv-cover-btn:hover {
  background: var(--gn-bg);
  color: var(--gn-text);
}
.cover-pop-anchor {
  position: absolute;
  right: 24px;
  top: calc(100% - 8px);
  z-index: 70;
}

/* ---------- 标题上方：图标 / 添加图标·封面·评论 ---------- */
.nv-head {
  position: relative;
  padding-top: 8px;
}
.nv-inner.has-cover .nv-head {
  padding-top: 0;
}
.nv-icon-row {
  position: relative;
  margin-bottom: 2px;
}
/* 有封面时图标压在封面下沿 */
.nv-inner.has-cover .nv-icon-row {
  margin-top: -40px;
}
.nv-emoji {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  transition: background 0.14s ease;
}
.nv-emoji:hover {
  background: color-mix(in srgb, var(--gn-bg-hover) 85%, transparent);
}
.nv-head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  margin: 2px 0 4px -6px;
  opacity: 0;
  transition: opacity 0.14s ease;
}
.nv-inner:hover .nv-head-actions,
.nv-head-actions.pinned,
.nv-head-actions:focus-within {
  opacity: 1;
}
.nv-head-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.nv-head-btn:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
}
.nv-icon-picker {
  position: absolute;
  top: 40px;
  left: 0;
  z-index: 70;
}
.nv-icon-picker.under {
  top: 76px;
}
.nv-inner.has-cover .nv-icon-picker.under {
  top: 36px;
}

/* ---------- 评论 ---------- */
.nv-comments {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0 14px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--gn-border);
}
.nv-comment,
.nv-comment-compose {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.nv-comment-avatar {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 12px;
  font-weight: 600;
}
.nv-comment-body {
  flex: 1;
  min-width: 0;
}
.nv-comment-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.nv-comment-author {
  font-weight: 600;
  color: var(--gn-text);
}
.nv-comment-time {
  color: var(--gn-text-muted);
  font-size: 11.5px;
}
.nv-comment-del {
  margin-left: auto;
  display: flex;
  padding: 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
  opacity: 0;
}
.nv-comment:hover .nv-comment-del {
  opacity: 1;
}
.nv-comment-del:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-danger);
}
.nv-comment-text {
  margin-top: 2px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--gn-text-soft);
  white-space: pre-wrap;
  word-break: break-word;
}
.nv-comment-input {
  flex: 1;
  min-height: 24px;
  max-height: 140px;
  padding: 2px 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--gn-text);
  field-sizing: content;
}
.nv-comment-input::placeholder {
  color: var(--gn-text-muted);
}
.nv-comment-send {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: var(--gn-accent);
  color: var(--gn-accent-ink);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}
.nv-comment-send:disabled {
  opacity: 0.4;
  cursor: default;
}
.nv-title {
  display: block;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-family: var(--gn-editor-font, var(--gn-font));
  font-size: calc(var(--gn-editor-font-size, 16px) * 2.125);
  font-weight: 680;
  line-height: 1.25;
  letter-spacing: -0.022em;
  color: var(--gn-text);
  padding-top: 2px;
  padding-right: 0;
  padding-bottom: 0;
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

/* ---------- 触屏：没有悬停，悬停才出现的控件改为常显 / 隐藏 ---------- */
@media (hover: none) {
  .nv-head-actions,
  .nv-cover-actions {
    opacity: 1;
  }
  .note-view :deep(.block-handle) {
    display: none !important;
  }
}

/* ---------- 窄屏 ---------- */
@media (max-width: 768px) {
  .nv-topbar {
    padding: 0 6px 0 4px;
    gap: 4px;
  }
  .nv-crumb:not(.home),
  .nv-crumbs > .nv-crumb-sep:not(:last-of-type) {
    display: none;
  }
  .nv-crumb-current {
    max-width: none;
  }
  .nv-save-text {
    display: none;
  }
  .nv-save {
    padding-right: 4px;
  }
  .nv-menu {
    position: fixed;
    top: 44px;
    right: 8px;
    width: min(280px, calc(100vw - 16px));
    max-height: calc(100dvh - 60px);
    overflow-y: auto;
  }
  .nv-sub-menu {
    position: static;
    margin: 2px 0 2px 22px;
    box-shadow: none;
    border: none;
    padding: 0;
  }
  .nv-find-wrap {
    left: 8px;
    right: 8px;
  }
  .nv-inner,
  .nv-inner.auto {
    max-width: 100% !important;
    padding: 20px 18px 0;
  }
  .nv-inner.has-cover {
    padding-top: 0;
  }
  .nv-cover {
    height: 132px;
  }
  .nv-cover-actions {
    right: 12px;
    bottom: 8px;
  }
  .cover-pop-anchor.cover-pop {
    position: fixed;
    left: 12px;
    right: 12px;
    top: 120px;
    width: auto;
    max-width: none;
  }
  .nv-emoji {
    width: 56px;
    height: 56px;
  }
  .nv-inner.has-cover .nv-icon-row {
    margin-top: -30px;
  }
  .nv-icon-picker {
    position: fixed;
    left: 8px;
    right: 8px;
    top: 96px;
  }
  .nv-title {
    font-size: calc(var(--gn-editor-font-size, 16px) * 1.75);
  }
}
</style>
