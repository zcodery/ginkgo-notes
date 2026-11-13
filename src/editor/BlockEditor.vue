<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { EditorContent } from "@tiptap/vue-3"
import { useEditor } from "@tiptap/vue-3"
import { GripVertical, Bold, Italic, Underline, Strikethrough, Code, Link2, RemoveFormatting, Baseline, Sparkles, Highlighter } from "lucide-vue-next"
import { buildExtensions } from "./extensions"
import { docToMarkdown, markdownToDoc } from "./markdown"
import { ASSET_PREFIX, dehydrateAssets, hydrateAssets, importImageFile } from "./assets"
import { filterSlashItems, type SlashItem } from "./slashItems"
import { COLOR_PRESETS, isPresetKey, normalizeHex, resolveSwatch, type ColorValue } from "./marks/colors"
import { Fragment, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model"
import { NodeSelection, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state"
import { CellSelection } from "@tiptap/pm/tables"
import { createDatabase } from "@/db/databases"
import { createPage, getPage, movePage, saveContent, toPlainText } from "@/db/repo"
import { pageUrl, reloadPages, store } from "@/store"
import { hasPageDrag, readPageDragId } from "./pageDrag"
import SlashMenu from "./SlashMenu.vue"
import BlockMenu, { type BlockMenuInfo, type BlockMenuPage } from "./BlockMenu.vue"
import TableControls from "./TableControls.vue"
import AiPanel from "./AiPanel.vue"
import { tr } from "@/i18n/phrases"
import { copyText } from "@/utils/clipboard"
import type { AiMode } from "./ai"

const props = withDefaults(
  defineProps<{
    content: string
    pageId: string
    placeholder?: string
    /** false 时进入只读，不可编辑 */
    editable?: boolean
    /** 管理员从「更多 → 调试」开启的装订区调校 */
    gutterTuning?: boolean
  }>(),
  { placeholder: "输入 '/' 唤起命令……", editable: true, gutterTuning: false },
)

const emit = defineEmits<{ (e: "change", markdown: string, pageId: string): void }>()

const canEdit = computed(() => props.editable !== false)

const gutterTuningOn = computed(() => props.gutterTuning === true)

const rootRef = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const rev = ref(0)
let suppress = false
let saveTimer: number | null = null
let pendingSlashPos: number | null = null

/* ---------------- 编辑器 ---------------- */

/** 是否落在原生表单控件上（标题、自定义色值输入等），交给浏览器自己的撤销栈 */
function isNativeEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/**
 * Ctrl/Cmd+Z 撤销；Ctrl/Cmd+Y 或 Ctrl/Cmd+Shift+Z 重做。
 * 显式拦截，避免被浏览器默认行为或其它捕获监听抢走。
 */
function runUndoRedo(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.altKey) return false
  if (isNativeEditableTarget(e.target)) return false
  if (!canEdit.value) return false

  const ed = editor.value
  if (!ed) return false

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const code = e.code

  const isZ = key === "z" || code === "KeyZ"
  const isY = key === "y" || code === "KeyY"

  if (isZ && !e.shiftKey) {
    e.preventDefault()
    e.stopPropagation()
    ed.commands.undo()
    return true
  }
  if (isY || (isZ && e.shiftKey)) {
    e.preventDefault()
    e.stopPropagation()
    ed.commands.redo()
    return true
  }
  return false
}

const editor = useEditor({
  content: markdownToDoc(props.content),
  extensions: buildExtensions(props.placeholder),
  // 表格列宽拖动插件只在创建时可编辑才会装上；只读由下方 watch / onMounted 立即切换
  editable: true,
  editorProps: {
    attributes: { class: "gn-prose" },
    handleKeyDown: (_view, event) => runUndoRedo(event),
    handleTextInput: (view, from, _to, text) => {
      if (!canEdit.value) return false
      if (text === "/") {
        const before = from > 0 ? view.state.doc.textBetween(from - 1, from, "\n", "\0") : ""
        if (before === "" || /\s/.test(before)) pendingSlashPos = from
      }
      return false
    },
    handlePaste: (_view, event) => {
      if (!canEdit.value) return false
      const items = (event as ClipboardEvent).clipboardData?.items
      if (!items) return false
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const file = it.getAsFile()
          if (file) {
            void handleImageFile(file)
            return true
          }
        }
      }
      return false
    },
  },
  onCreate: async ({ editor: ed }) => {
    // 常规情况下父组件已把 asset: 引用换成了 blob URL；这里只作为兜底
    if (props.content.includes(ASSET_PREFIX)) {
      const hydrated = await hydrateAssets(props.content)
      suppress = true
      // addToHistory: false —— 初始灌入不进撤销栈，避免第一次 Ctrl+Z 把正文清空
      ed.chain()
        .command(({ tr }) => {
          tr.setMeta("addToHistory", false)
          return true
        })
        .setContent(markdownToDoc(hydrated), { emitUpdate: false })
        .run()
      suppress = false
    }
    ensureTrailingEmpty()
  },
  onUpdate: () => {
    if (pendingSlashPos != null) {
      const pos = pendingSlashPos
      pendingSlashPos = null
      if (!slash.value.open) openSlashAt(pos)
    }
    updateSlashQuery()
    // 末尾空行可能刚被写上字 / 换成别的块，立刻再补一行
    const added = ensureTrailingEmpty()
    if (slash.value.open && added) repositionSlash()
    if (suppress) return
    scheduleEmit()
  },
  onTransaction: () => {
    rev.value++
  },
  onSelectionUpdate: () => {
    if (slash.value.open) updateSlashQuery()
    updateBubble()
    syncListHandleWithSelection()
  },
  onBlur: () => {
    // 编辑器整体失焦（比如 Tab 走了、点了别的区域）时，把斜杠命令一并收掉，
    // 避免 `/er` 这种半截输入残留在正文里。
    if (slash.value.open) cancelSlashSilent()
  },
})

function currentMarkdown(): string {
  const ed = editor.value
  if (!ed) return ""
  const dehydrated = dehydrateAssets(JSON.stringify(ed.getJSON()))
  return docToMarkdown(JSON.parse(dehydrated))
}

function scheduleEmit() {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    emit("change", currentMarkdown(), props.pageId)
  }, 450)
}

function flush() {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  emit("change", currentMarkdown(), props.pageId)
}

onBeforeUnmount(() => {
  // 切页面 / 退出时还有没发出去的修改，立即保存而不是丢掉
  if (saveTimer) flush()
})

defineExpose({
  flush,
  getMarkdown: currentMarkdown,
  undo: () => editor.value?.commands.undo(),
  redo: () => editor.value?.commands.redo(),
  canUndo: () => editor.value?.can().undo() ?? false,
  canRedo: () => editor.value?.can().redo() ?? false,
  /** 每次文档变更递增，供菜单等订阅撤销/重做可用性 */
  historyRev: rev,
  /** TipTap 实例，供查找替换等外部能力使用 */
  editor,
  /** 打开 AI 面板：page 模式对整篇笔记操作 */
  openAi: (mode: AiMode, action?: string) => openAi(mode, action),
  focus: () => {
    const ed = editor.value
    if (!ed) return
    ed.commands.focus("start")
  },
})

/* ---------------- 块悬浮手柄 ---------------- */

const handle = ref({
  visible: false,
  top: 0,
  left: 0,
  headingLevel: 0 as HeadingLevel,
  listFold: false,
  listItem: false,
})
let hoverBlock: { from: number; to: number } | null = null
/** 当前手柄对应 DOM（列表行点击菜单时按此重新解析，避免误绑父级项） */
let handleTargetDom: HTMLElement | null = null
/** 当前显示 ▾ 的 listItem 行（类挂在 widget 上，避免 PM 重绘清掉 li 上的 class） */
let gutterHoverLi: HTMLElement | null = null

/**
 * 折叠 widget 的落点有两种：普通 listItem 是 `li > .gn-list-fold`，
 * taskItem 的 contentDOM 是 div，widget 会落在 `li > div > .gn-list-fold`。
 * 块手柄让位 / 高亮当前行都要兼容后者，否则 ⠿ 会直接压在任务项的折叠箭头上。
 */
function foldWidgetOf(li: Element | null | undefined): HTMLElement | null {
  return (li?.querySelector(":scope > .gn-list-fold, :scope > div > .gn-list-fold") as HTMLElement | null) ?? null
}

function syncActiveFold(li: HTMLElement | null) {
  const pm = editor.value?.view.dom as HTMLElement | undefined
  pm?.querySelectorAll(".gn-list-fold.is-active").forEach(el => el.classList.remove("is-active"))
  gutterHoverLi = li
  foldWidgetOf(li)?.classList.add("is-active")
}

function clearGutterHoverRow() {
  syncActiveFold(null)
}

type HeadingLevel = 0 | 1 | 2 | 3 | 4

/** 手柄按钮半高，原子块贴顶定位时用 */
const HANDLE_HALF = 11

type HoverBlock = {
  from: number
  to: number
  node: PMNode
  /** 用于垂直命中检测的外框（列表项用 li，其它用顶层块） */
  hitDom: HTMLElement
  /** 用于首行对齐的 DOM（段落 / 标题 / 原子块外框） */
  alignDom: HTMLElement
  alignIsText: boolean
}

function textLineHeightPx(dom: HTMLElement): number {
  const style = window.getComputedStyle(dom)
  const raw = style.lineHeight
  const lh = parseFloat(raw)
  // 计算样式通常是 px；若仍是倍数则乘字号
  if (Number.isFinite(lh) && lh > 0) {
    if (raw.endsWith("px")) return lh
    const fs = parseFloat(style.fontSize) || 16
    return lh * fs
  }
  return (parseFloat(style.fontSize) || 16) * 1.7
}

function handleYRatio(pm: HTMLElement | null, kind: "body" | "heading" | "list"): number {
  const style = getComputedStyle(pm ?? document.documentElement)
  const key =
    kind === "heading" ? "--gn-handle-heading-y-ratio" : kind === "list" ? "--gn-handle-list-y-ratio" : "--gn-handle-body-y-ratio"
  const fallback = kind === "heading" ? 0.55 : kind === "list" ? 0.5 : 0.46
  const n = parseFloat(style.getPropertyValue(key).trim())
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

/**
 * 首行锚点（视口 Y）：行盒比例锚点，不跟块级 margin 走；比例由 CSS 变量微调。
 */
function firstLineAnchorY(dom: HTMLElement, kind: "body" | "heading" | "list", pm?: HTMLElement | null): number {
  const ratio = handleYRatio(pm ?? (dom.closest(".ProseMirror") as HTMLElement | null), kind)
  const range = document.createRange()
  range.selectNodeContents(dom)
  const lines = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
  if (lines.length) {
    const line = lines[0]!
    return line.top + line.height * ratio
  }
  const style = window.getComputedStyle(dom)
  const padTop = parseFloat(style.paddingTop) || 0
  const lh = textLineHeightPx(dom)
  return dom.getBoundingClientRect().top + padTop + lh * ratio
}

/** 与首行文字/圆点同一行中心（仍优先行盒，inline 标记不拉偏） */
function listItemMarkerCenterY(li: HTMLElement): number {
  const pm = li.closest(".ProseMirror") as HTMLElement | null
  const ratio = handleYRatio(pm, "list")
  const band = listItemFirstRowBand(li)
  return band.top + (band.bottom - band.top) * ratio
}

/** 列表项首行垂直范围（不含子列表；多行段落也只认第一行） */
function listItemFirstRowBand(li: HTMLElement): { top: number; bottom: number } {
  const content = listItemContentEl(li)
  if (content) {
    const range = document.createRange()
    range.selectNodeContents(content)
    const lines = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
    if (lines.length) {
      const line = lines[0]!
      return { top: line.top, bottom: line.bottom }
    }
    const r = content.getBoundingClientRect()
    return { top: r.top, bottom: r.top + textLineHeightPx(content) }
  }
  const style = window.getComputedStyle(li)
  const padTop = parseFloat(style.paddingTop) || 0
  let lineH = parseFloat(style.getPropertyValue("--gn-line-h")) || 27.2
  const top = li.getBoundingClientRect().top + padTop
  return { top, bottom: top + lineH }
}

function listItemRowRect(li: HTMLElement): DOMRect {
  const band = listItemFirstRowBand(li)
  const w = li.getBoundingClientRect().width
  return new DOMRect(li.getBoundingClientRect().left, band.top, w, band.bottom - band.top)
}

function clientYOnListItemRow(li: HTMLElement, clientY: number): boolean {
  const content = listItemContentEl(li)
  if (content) {
    const r = content.getBoundingClientRect()
    return clientY >= r.top - 6 && clientY <= r.bottom + 6
  }
  const band = listItemFirstRowBand(li)
  return clientY >= band.top - 6 && clientY <= band.bottom + 6
}

function listItemContentBand(li: HTMLElement): DOMRect {
  const content = listItemContentEl(li)
  if (content) return content.getBoundingClientRect()
  return listItemRowRect(li)
}

function isHandleListItem(li: HTMLElement, pm: HTMLElement): boolean {
  if (!pm.contains(li)) return false
  const list = li.parentElement
  if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) return false
  if (list.getAttribute("data-type") === "taskList") return true
  if (list.tagName === "OL") return true
  return list.tagName === "UL"
}

/** 按 Y 扫描文档里所有 li，取该高度上嵌套最深的一项（不依赖 elementFromPoint） */
function pickListItemByRowY(ed: NonNullable<typeof editor.value>, clientY: number): HTMLElement | null {
  const pm = ed.view.dom as HTMLElement
  const all = pm.getElementsByTagName("li")
  let best: HTMLElement | null = null
  let bestDepth = -1
  for (let i = 0; i < all.length; i++) {
    const li = all[i] as HTMLElement
    if (!isHandleListItem(li, pm)) continue
    if (!clientYOnListItemRow(li, clientY)) continue
    const depth = listItemNestDepth(li, pm)
    if (depth > bestDepth) {
      bestDepth = depth
      best = li
    }
  }
  return best
}

let lastPointer = { x: 0, y: 0, active: false }

/** 光标 Y 落在该行即命中（含子列表；整行宽度含正文区） */
function tryResolveListItem(ed: NonNullable<typeof editor.value>, clientX: number, clientY: number, pmRect: DOMRect): HoverBlock | null {
  const rowLi = pickListItemByRowY(ed, clientY)
  if (!rowLi || !clientYOnListItemRow(rowLi, clientY)) return null
  if (clientX < pmRect.left - 64 || clientX > pmRect.right + 12) return null
  return hoverBlockFromListItem(ed, rowLi)
}

function listItemContentEl(li: HTMLElement): HTMLElement | null {
  const p = li.querySelector(":scope > p")
  if (p instanceof HTMLElement) return p
  const div = li.querySelector(":scope > div")
  return div instanceof HTMLElement ? div : null
}

function listItemNestDepth(li: HTMLElement, pm: HTMLElement): number {
  let depth = 0
  let walk: HTMLElement | null = li
  while (walk && walk !== pm) {
    if (walk.tagName === "LI") depth++
    walk = walk.parentElement
  }
  return depth
}

function isListItem(name: string) {
  return name === "listItem" || name === "taskItem"
}

/** 从文档位置向上找 listItem/taskItem：自深向浅遍历，返回最嵌套的一层 */
function deepestListItemDepthAt($pos: ResolvedPos): number {
  for (let d = $pos.depth; d >= 1; d--) {
    const name = $pos.node(d).type.name
    if (name === "listItem" || name === "taskItem") return d
  }
  return -1
}

/** 唯一确定这个 <li> 在文档里的 listItem/taskItem 起点 */
function listItemDocPosFromDom(ed: NonNullable<typeof editor.value>, li: HTMLElement): number | null {
  const domMatches = (from: number) => ed.view.nodeDOM(from) as HTMLElement | null

  const pickFromPos = (raw: number): number | null => {
    const $pos = ed.state.doc.resolve(raw)
    for (let d = $pos.depth; d >= 1; d--) {
      if (!isListItem($pos.node(d).type.name)) continue
      const from = $pos.before(d)
      if (domMatches(from) === li) return from
    }
    return null
  }

  for (const offset of [0, 1]) {
    try {
      const hit = pickFromPos(ed.view.posAtDOM(li, offset))
      if (hit != null) return hit
    } catch {
      /* 换下一偏移 */
    }
  }

  const content = listItemContentEl(li)
  if (content) {
    try {
      const hit = pickFromPos(ed.view.posAtDOM(content, 0))
      if (hit != null) return hit
    } catch {
      /* 全文扫描 */
    }
  }

  let found: number | null = null
  ed.state.doc.descendants((node, pos) => {
    if (found != null) return false
    if (!isListItem(node.type.name)) return
    if (domMatches(pos) === li) {
      found = pos
    }
  })
  return found
}

function listTurnTypeAtItem(from: number, state: EditorState): string {
  const node = state.doc.nodeAt(from)
  if (!node || !isListItem(node.type.name)) return "paragraph"
  const parent = state.doc.resolve(from).parent
  if (LIST_CONTAINERS.has(parent.type.name)) return parent.type.name
  return "paragraph"
}

/** 叠层 DOM 里取「当前 Y 落在其首行」且嵌套最深的 li */
function pickListItemAt(ed: NonNullable<typeof editor.value>, clientX: number, clientY: number): HTMLElement | null {
  const pm = ed.view.dom as HTMLElement
  const stack = document.elementsFromPoint(clientX, clientY)
  let best: HTMLElement | null = null
  let bestDepth = -1
  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue
    if (!pm.contains(raw)) continue
    const li = raw.closest("li")
    if (!(li instanceof HTMLElement) || !pm.contains(li)) continue
    if (!clientYOnListItemRow(li, clientY)) continue
    const depth = listItemNestDepth(li, pm)
    if (depth > bestDepth) {
      bestDepth = depth
      best = li
    }
  }
  return best
}

function listItemFromSelection(ed: NonNullable<typeof editor.value>): HTMLElement | null {
  const { $from } = ed.state.selection
  let best: HTMLElement | null = null
  let bestDepth = -1
  for (let d = $from.depth; d >= 1; d--) {
    const name = $from.node(d).type.name
    if (name !== "listItem" && name !== "taskItem") continue
    const dom = ed.view.nodeDOM($from.before(d)) as HTMLElement | null
    if (dom?.tagName === "LI" && d > bestDepth) {
      bestDepth = d
      best = dom
    }
  }
  return best
}

function hoverBlockFromListItem(ed: NonNullable<typeof editor.value>, li: HTMLElement): HoverBlock | null {
  const from = listItemDocPosFromDom(ed, li)
  if (from == null) return null
  const node = ed.state.doc.nodeAt(from)
  if (!node) return null
  const content = listItemContentEl(li)

  return {
    from,
    to: from + node.nodeSize,
    node,
    hitDom: li,
    alignDom: content ?? li,
    alignIsText: !!content,
  }
}

function atomBlockToolbarCenter(hitDom: HTMLElement): number | null {
  const bar = hitDom.querySelector(".cb-toolbar") ?? hitDom.querySelector(".dbb-head") ?? hitDom.querySelector(".dg-empty-head") ?? hitDom.querySelector(".dg-tools")
  if (bar instanceof HTMLElement) {
    const r = bar.getBoundingClientRect()
    if (r.height > 2) return r.top + r.height / 2
  }
  const box = hitDom.getBoundingClientRect()
  return box.top + Math.min(HANDLE_HALF * 2, box.height / 2)
}

function handleCenterY(alignDom: HTMLElement | null, isText: boolean, hitDom?: HTMLElement | null): number {
  if (!alignDom) return 0
  if (hitDom?.tagName === "LI") return listItemMarkerCenterY(hitDom)
  if (hitDom && (hitDom.classList.contains("gn-codeblock") || hitDom.classList.contains("gn-diagram") || hitDom.classList.contains("gn-db"))) {
    const y = atomBlockToolbarCenter(hitDom)
    if (y != null) return y
  }
  const pm = alignDom.closest(".ProseMirror") as HTMLElement | null
  if (hitDom?.tagName === "BLOCKQUOTE") {
    const p = hitDom.querySelector(":scope > p")
    if (p instanceof HTMLElement) return firstLineAnchorY(p, "body", pm)
  }
  if (isText) return firstLineAnchorY(alignDom, "body", pm)
  return alignDom.getBoundingClientRect().top + HANDLE_HALF
}

function headingLevelOf(block: HoverBlock): HeadingLevel {
  if (block.node.type.name === "heading") {
    return Math.min(4, Math.max(1, Number(block.node.attrs?.level) || 1)) as HeadingLevel
  }
  if (block.alignIsText && block.alignDom.tagName.match(/^H[1-4]$/)) {
    return Number(block.alignDom.tagName[1]) as HeadingLevel
  }
  return 0
}

/** 正文实际内容的底边：忽略 ProseMirror 底部大块 padding，避免空白区误吸附 */
function contentBottom(pm: HTMLElement): number {
  const last = pm.lastElementChild as HTMLElement | null
  if (!last) return pm.getBoundingClientRect().top
  return last.getBoundingClientRect().bottom
}

function atomBlockRoot(dom: HTMLElement): HTMLElement {
  if (isTextColumnAtom(dom) || dom.classList.contains("gn-codeblock")) return dom
  const inner = dom.querySelector(":scope > .gn-diagram, :scope > .gn-db, :scope > .gn-codeblock, .gn-diagram, .gn-db, .gn-codeblock")
  return inner instanceof HTMLElement ? inner : dom
}

/** ProseMirror 顶层块 DOM 序号 → 文档 offset（仅作 NodeView 的 posAtDOM 兜底） */
function topLevelDocFromByRowIndex(ed: NonNullable<typeof editor.value>, rowIndex: number): { from: number; node: HoverBlock["node"] } | null {
  if (rowIndex < 0) return null
  let i = 0
  let found: { from: number; node: HoverBlock["node"] } | null = null
  ed.state.doc.forEach((node, offset) => {
    if (i === rowIndex) found = { from: offset, node }
    i++
  })
  return found
}

function isAtomRowDom(row: HTMLElement): boolean {
  return row.classList.contains("gn-diagram") || row.classList.contains("gn-codeblock") || row.classList.contains("gn-db") || (row.tagName === "DETAILS" && row.classList.contains("gn-details")) || row.hasAttribute("data-diagram") || row.hasAttribute("data-codeblock")
}

function isIgnorablePmChild(row: HTMLElement): boolean {
  return row.classList.contains("ProseMirror-trailingBreak") || row.classList.contains("ProseMirror-separator")
}

function docPosMatchesRowDom(ed: NonNullable<typeof editor.value>, from: number, row: HTMLElement): boolean {
  const dom = ed.view.nodeDOM(from) as HTMLElement | null
  if (!dom) return isAtomRowDom(row)
  if (dom === row) return true
  if (row.contains(dom)) return true
  if (dom.contains(row)) return true
  return false
}

function blockFromResolvedPos(ed: NonNullable<typeof editor.value>, pos: number): { from: number; node: HoverBlock["node"] } | null {
  const $pos = ed.state.doc.resolve(Math.min(pos + 1, ed.state.doc.content.size))
  if ($pos.depth < 1) return null

  const itemDepth = deepestListItemDepthAt($pos)
  if (itemDepth >= 1) {
    return { from: $pos.before(itemDepth), node: $pos.node(itemDepth) }
  }

  // 段落 / 标题等顶层块（非列表）
  let depth = 1
  for (let d = $pos.depth; d >= 1; d--) {
    const parent = d === 1 ? $pos.node(0) : $pos.node(d - 1)
    if (parent?.type.name === "doc") {
      depth = d
      break
    }
  }
  return { from: $pos.before(depth), node: $pos.node(depth) }
}

function atomRowDocPos(ed: NonNullable<typeof editor.value>, row: HTMLElement): { from: number; node: HoverBlock["node"] } | null {
  const typeByClass: [string, string][] = [
    ["gn-codeblock", "codeBlock"],
    ["gn-diagram", "diagram"],
    ["gn-db", "databaseBlock"],
  ]
  let want: string | null = null
  for (const [cls, name] of typeByClass) {
    if (row.classList.contains(cls)) {
      want = name
      break
    }
  }
  if (!want) return null
  let found: { from: number; node: HoverBlock["node"] } | null = null
  ed.state.doc.forEach((node, offset) => {
    if (node.type.name !== want || found) return
    const dom = ed.view.nodeDOM(offset) as HTMLElement | null
    if (!dom) return
    if (dom === row || row.contains(dom) || dom.contains(row)) found = { from: offset, node }
  })
  return found
}

function resolveRowBlockPos(ed: NonNullable<typeof editor.value>, row: HTMLElement): { from: number; node: HoverBlock["node"] } | null {
  const pm = ed.view.dom as HTMLElement
  const rowIndex = Array.prototype.indexOf.call(pm.children, row)
  const band = row.getBoundingClientRect()
  const pickY = band.top + Math.min(48, Math.max(14, band.height / 2))

  if (isAtomRowDom(row)) {
    const byDom = atomRowDocPos(ed, row)
    if (byDom) return byDom
  }

  let pos: number | null = null
  try {
    pos = ed.view.posAtDOM(row, 0)
  } catch {
    pos = null
  }
  if (pos != null) {
    const mapped = blockFromResolvedPos(ed, pos)
    if (mapped && docPosMatchesRowDom(ed, mapped.from, row)) return mapped
  }

  const viaCoords = ed.view.posAtCoords({ left: band.left + 12, top: pickY })
  if (viaCoords) {
    const mapped = blockFromResolvedPos(ed, viaCoords.pos)
    if (mapped && docPosMatchesRowDom(ed, mapped.from, row)) return mapped
  }

  if (isAtomRowDom(row)) {
    const mid = ed.view.posAtCoords({ left: band.left + 2, top: pickY })
    if (mid) {
      const $m = ed.state.doc.resolve(mid.pos)
      for (let d = $m.depth; d >= 1; d--) {
        const n = $m.node(d)
        if (n.type.name === "diagram" || n.type.name === "databaseBlock" || n.type.name === "codeBlock") {
          const candidate = { from: $m.before(d), node: n }
          if (docPosMatchesRowDom(ed, candidate.from, row)) return candidate
        }
      }
    }
    const byIndex = topLevelDocFromByRowIndex(ed, rowIndex)
    if (byIndex && docPosMatchesRowDom(ed, byIndex.from, row)) return byIndex
  }

  if (pos != null) return blockFromResolvedPos(ed, pos)

  if (rowIndex >= 0) {
    const byIndex = topLevelDocFromByRowIndex(ed, rowIndex)
    if (byIndex && docPosMatchesRowDom(ed, byIndex.from, row)) return byIndex
  }
  return null
}

function hoverBlockFromRowDom(ed: NonNullable<typeof editor.value>, row: HTMLElement): HoverBlock | null {
  const mapped = resolveRowBlockPos(ed, row)
  if (!mapped) return null
  const { from, node } = mapped
  const rawHit = isAtomRowDom(row) ? row : ((ed.view.nodeDOM(from) as HTMLElement | null) ?? row)
  const hitDom = normalizeBlockHitDom(node, rawHit)

  let alignDom: HTMLElement = hitDom
  let alignIsText = false
  const $at = ed.state.doc.resolve(Math.min(from + 1, ed.state.doc.content.size))
  for (let d = $at.depth; d >= 1; d--) {
    const n = $at.node(d)
    if (n?.isTextblock) {
      const tb = ed.view.nodeDOM($at.before(d)) as HTMLElement | null
      if (tb) {
        alignDom = tb
        alignIsText = true
      }
      break
    }
  }

  return { from, to: from + node.nodeSize, node, hitDom, alignDom, alignIsText }
}

/** 按 Y 命中 ProseMirror 顶层块（含装订区）；图表/表格等 atom 块靠它露出 ⠿ */
function pickTopLevelBlockAt(ed: NonNullable<typeof editor.value>, clientX: number, clientY: number, pmRect: DOMRect): HoverBlock | null {
  const pm = ed.view.dom as HTMLElement
  const pmStyle = getComputedStyle(pm)
  const lead = cssLengthPx(pmStyle, "--gn-gutter-lead")
  if (clientX < pmRect.left - lead - 16 || clientX > pmRect.right + 12) return null
  const bottom = contentBottom(pm) + 6
  if (clientY < pmRect.top - 2 || clientY > bottom) return null

  let best: HoverBlock | null = null
  let bestH = Infinity
  for (let i = 0; i < pm.children.length; i++) {
    const row = pm.children[i] as HTMLElement
    if (isIgnorablePmChild(row)) continue
    const band = row.getBoundingClientRect()
    if (clientY < band.top - 8 || clientY > band.bottom + 8) continue
    if (clientX > band.right + 16) continue
    const block = hoverBlockFromRowDom(ed, row)
    if (!block) continue
    const h = band.height
    if (h <= bestH) {
      bestH = h
      best = block
    }
  }
  return best
}

function resolveBlock(clientX: number, clientY: number): HoverBlock | null {
  const ed = editor.value
  if (!ed) return null
  const pm = ed.view.dom as HTMLElement
  const pmRect = pm.getBoundingClientRect()

  // 底部空白（padding-bottom: 35vh）不显示手柄
  if (clientY > contentBottom(pm) + 6) return null
  if (clientY < pmRect.top - 2) return null

  const listBlock = tryResolveListItem(ed, clientX, clientY, pmRect)
  if (listBlock) return listBlock

  const topBlock = pickTopLevelBlockAt(ed, clientX, clientY, pmRect)
  if (topBlock) return topBlock

  // 左侧装订线也要能命中当前行（含块手柄 / 折叠箭头区域）
  const x = Math.min(Math.max(clientX, pmRect.left - 54), pmRect.right - 12)
  const info = ed.view.posAtCoords({ left: x, top: clientY })
  if (!info) return blockAtPoint(x, clientY)

  const $pos = ed.state.doc.resolve(info.pos)
  if ($pos.depth < 1) return blockAtPoint(x, clientY)

  const itemDepth = deepestListItemDepthAt($pos)
  if (itemDepth < 1) return blockAtPoint(x, clientY)

  const from = $pos.before(itemDepth)
  const node = $pos.node(itemDepth)
  const hitDomRaw = ed.view.nodeDOM(from) as HTMLElement | null
  if (!hitDomRaw) return null
  const hitDom = normalizeBlockHitDom(node, hitDomRaw)

  let alignDom: HTMLElement | null = null
  let alignIsText = false
  for (let d = $pos.depth; d >= 1; d--) {
    const n = $pos.node(d)
    if (n?.isTextblock) {
      alignDom = ed.view.nodeDOM($pos.before(d)) as HTMLElement | null
      alignIsText = true
      break
    }
  }
  if (!alignDom) {
    alignDom = hitDom
    alignIsText = node.isTextblock
  }
  if (hitDom.tagName === "LI") {
    const p = hitDom.querySelector(":scope > p")
    if (p instanceof HTMLElement) {
      alignDom = p
      alignIsText = true
    }
  }
  if (hitDom.tagName === "LI") {
    const again = tryResolveListItem(ed, clientX, clientY, pmRect)
    if (again) return again
    if (!clientYOnListItemRow(hitDom, clientY)) return null
  }

  return { from, to: from + node.nodeSize, node, hitDom, alignDom: alignDom!, alignIsText }
}

function blockAtPoint(clientX: number, clientY: number): HoverBlock | null {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root) return null
  if ((document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest?.(".block-handle")) {
    return null
  }

  const pmRect = (ed.view.dom as HTMLElement).getBoundingClientRect()
  const fromList = tryResolveListItem(ed, clientX, clientY, pmRect)
  if (fromList) return fromList

  const fromTop = pickTopLevelBlockAt(ed, clientX, clientY, pmRect)
  if (fromTop) return fromTop

  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  if (!el || !root.contains(el)) return null

  let hitDom: HTMLElement | null = el
  while (hitDom && hitDom.parentElement !== ed.view.dom) hitDom = hitDom.parentElement
  if (!hitDom) return null

  const mapped = resolveRowBlockPos(ed, hitDom)
  if (!mapped) return null
  const { from, node } = mapped
  const blockDom = normalizeBlockHitDom(node, (ed.view.nodeDOM(from) as HTMLElement | null) ?? hitDom)

  let alignDom: HTMLElement | null = null
  let alignIsText = false
  const $at = ed.state.doc.resolve(Math.min(from + 1, ed.state.doc.content.size))
  for (let d = $at.depth; d >= 1; d--) {
    const n = $at.node(d)
    if (n?.isTextblock) {
      alignDom = ed.view.nodeDOM($at.before(d)) as HTMLElement | null
      alignIsText = true
      break
    }
  }
  if (!alignDom) {
    alignDom = blockDom
    alignIsText = !!node.isTextblock
  }

  return {
    from,
    to: from + node.nodeSize,
    node,
    hitDom: blockDom,
    alignDom,
    alignIsText,
  }
}

function cssLengthPx(from: CSSStyleDeclaration, prop: string): number {
  const raw = from.getPropertyValue(prop).trim()
  if (!raw) return 0
  if (raw.endsWith("px")) return parseFloat(raw) || 0
  const probe = document.createElement("div")
  probe.style.position = "absolute"
  probe.style.visibility = "hidden"
  probe.style.pointerEvents = "none"
  probe.style.width = raw
  document.body.appendChild(probe)
  const w = probe.getBoundingClientRect().width
  probe.remove()
  return w
}

function isTextColumnAtom(hit: HTMLElement): boolean {
  return hit.classList.contains("gn-codeblock") || hit.classList.contains("gn-diagram") || hit.classList.contains("gn-db") || (hit.tagName === "DETAILS" && hit.classList.contains("gn-details"))
}

function normalizeBlockHitDom(node: HoverBlock["node"], raw: HTMLElement): HTMLElement {
  const atomish = new Set(["diagram", "databaseBlock", "codeBlock"])
  if (atomish.has(node.type.name) || isTextColumnAtom(raw)) return atomBlockRoot(raw)
  return raw
}

/** ⠿ 跟当前行缩进；有 ▾ 时占 lead 槽左侧 compact 段，避免与折叠钮重叠 */
function computeHandleLeft(block: HoverBlock, root: HTMLElement): number {
  const rootRect = root.getBoundingClientRect()
  const pm = root.querySelector(".ProseMirror") as HTMLElement | null
  const style = getComputedStyle(pm ?? root)
  const compact = cssLengthPx(style, "--gn-gutter-compact")
  const lead = cssLengthPx(style, "--gn-gutter-lead")
  const rowLeft = block.hitDom.getBoundingClientRect().left
  const hasFold =
    block.hitDom.tagName === "LI" && !!foldWidgetOf(block.hitDom)
  const rail = hasFold ? lead : compact
  return Math.round(rowLeft - rail - rootRect.left)
}

function showBlockHandle(block: HoverBlock, clientY: number): boolean {
  const root = rootRef.value
  if (!root) return false
  const hit = block.hitDom.tagName === "LI" ? listItemContentBand(block.hitDom) : block.hitDom.getBoundingClientRect()
  if (clientY < hit.top - 2 || clientY > hit.bottom + 2) return false
  hoverBlock = { from: block.from, to: block.to }
  handleTargetDom = block.hitDom
  const rect = root.getBoundingClientRect()
  let centerY: number
  if (isTextColumnAtom(block.hitDom)) {
    const band = block.hitDom.getBoundingClientRect()
    const pad = HANDLE_HALF + 2
    centerY = Math.min(Math.max(clientY, band.top + pad), band.bottom - pad)
  } else {
    const lvl = headingLevelOf(block)
    if (lvl > 0 && block.alignDom instanceof HTMLElement) {
      const pm = block.alignDom.closest(".ProseMirror") as HTMLElement | null
      centerY = firstLineAnchorY(block.alignDom, "heading", pm)
    } else {
      centerY = handleCenterY(block.alignDom, block.alignIsText, block.hitDom)
    }
  }
  const top = Math.round(centerY - rect.top)
  const listFold = block.hitDom.tagName === "LI" && !!foldWidgetOf(block.hitDom)
  const listItem = block.hitDom.tagName === "LI"
  if (block.hitDom.tagName === "LI") {
    if (listFold) syncActiveFold(block.hitDom)
    else clearGutterHoverRow()
  } else {
    clearGutterHoverRow()
  }

  handle.value = {
    visible: true,
    top,
    left: computeHandleLeft(block, root),
    headingLevel: headingLevelOf(block),
    listFold,
    listItem,
  }
  return true
}

/** 在列表里输入时保持当前行手柄（嵌套子项含在内） */
function syncListHandleWithSelection() {
  const ed = editor.value
  if (!ed || !canEdit.value) return
  if (slash.value.open || blockMenu.value.open) return
  const selLi = listItemFromSelection(ed)
  if (!selLi) return
  const block = hoverBlockFromListItem(ed, selLi)
  if (!block) return
  const band = listItemContentBand(selLi)
  showBlockHandle(block, (band.top + band.bottom) / 2)
}

function updateBlockHandleFromPointer(clientX: number, clientY: number, target: EventTarget | null) {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root || !canEdit.value) {
    handle.value.visible = false
    clearGutterHoverRow()
    return
  }
  lastPointer = { x: clientX, y: clientY, active: true }
  if (slash.value.open || blockMenu.value.open) return
  if (target instanceof HTMLElement && target.closest?.(".block-handle")) return

  const pmRect = (ed.view.dom as HTMLElement).getBoundingClientRect()
  const hoverLi = pickListItemByRowY(ed, clientY)
  if (hoverLi && clientX >= pmRect.left - 64 && clientX <= pmRect.right + 12) {
    const listBlock = hoverBlockFromListItem(ed, hoverLi)
    if (listBlock && showBlockHandle(listBlock, clientY)) return
  }

  const block = resolveBlock(clientX, clientY)
  if (!block) {
    handle.value.visible = false
    clearGutterHoverRow()
    return
  }
  if (!showBlockHandle(block, clientY)) {
    handle.value.visible = false
    clearGutterHoverRow()
  }
}

function editorGutterPointerBox(): DOMRect | null {
  const root = rootRef.value
  const ed = editor.value
  if (!root || !ed) return null
  const pm = ed.view.dom as HTMLElement
  const lead = cssLengthPx(getComputedStyle(pm), "--gn-gutter-lead")
  const r = root.getBoundingClientRect()
  const bottom = contentBottom(pm) + 6
  return new DOMRect(r.left - lead - 12, r.top, r.width + lead + 28, Math.max(0, bottom - r.top))
}

function onWindowMouseMoveForGutter(e: MouseEvent) {
  const root = rootRef.value
  if (!root || !editor.value || !canEdit.value) return
  if (e.target instanceof Node && root.contains(e.target)) return
  const box = editorGutterPointerBox()
  if (!box) return
  if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) return
  updateBlockHandleFromPointer(e.clientX, e.clientY, e.target)
}

function onMouseMove(e: MouseEvent) {
  updateBlockHandleFromPointer(e.clientX, e.clientY, e.target)
}

function onMouseLeaveRoot() {
  lastPointer.active = false
  if (gutterTuningOn.value || slash.value.open || blockMenu.value.open) return
  scheduleHide()
}

let hideTimer: number | null = null

function scheduleHide() {
  if (gutterTuningOn.value) return
  if (hideTimer) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    handle.value.visible = false
    clearGutterHoverRow()
  }, 320)
}

function cancelHide() {
  if (hideTimer) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
}

function hideNow() {
  cancelHide()
  if (slash.value.open || blockMenu.value.open) return
  handle.value.visible = false
  handleTargetDom = null
  clearGutterHoverRow()
}

/* ---------------- 文字浮动工具条 ---------------- */

const bubble = ref({ visible: false, top: 0, left: 0 })
const linkMode = ref(false)
const linkInput = ref("")
const colorPanelOpen = ref(false)
const customFontHex = ref("#337ea9")
const customBgHex = ref("#fef3c7")

const activeFontColor = computed(() => {
  void rev.value
  const ed = editor.value
  if (!ed) return null
  return (ed.getAttributes("fontColor")?.color as ColorValue | null) ?? null
})

const activeBgColor = computed(() => {
  void rev.value
  const ed = editor.value
  if (!ed) return null
  return (ed.getAttributes("bgColor")?.color as ColorValue | null) ?? null
})

const fontBarColor = computed(() => {
  const c = activeFontColor.value
  if (!c) return "currentColor"
  if (isPresetKey(c)) return `var(--gn-fc-${c})`
  return c
})

const bgBarColor = computed(() => {
  const c = activeBgColor.value
  if (!c) return "var(--gn-border-strong)"
  return `color-mix(in srgb, ${resolveSwatch(c)} 40%, transparent)`
})

function updateBubble() {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root || !canEdit.value) {
    bubble.value.visible = false
    return
  }
  const { from, to, empty } = ed.state.selection
  if (empty || to <= from) {
    bubble.value.visible = false
    linkMode.value = false
    colorPanelOpen.value = false
    return
  }
  // 选区里只有原子块（图表、多维表格、图片）时不该弹出文字格式条
  if (!ed.state.doc.textBetween(from, to, " ").trim()) {
    bubble.value.visible = false
    linkMode.value = false
    colorPanelOpen.value = false
    return
  }
  if (ed.isActive("codeBlock")) {
    bubble.value.visible = false
    colorPanelOpen.value = false
    return
  }
  // 整行 / 整列等单元格选区由表格菜单接管
  if (ed.state.selection instanceof CellSelection) {
    bubble.value.visible = false
    colorPanelOpen.value = false
    return
  }
  const rect = root.getBoundingClientRect()
  const start = ed.view.coordsAtPos(from)
  const end = ed.view.coordsAtPos(to)
  bubble.value = {
    visible: true,
    left: (start.left + end.left) / 2 - rect.left,
    top: start.top - rect.top,
  }
}

function toggleColorPanel() {
  linkMode.value = false
  colorPanelOpen.value = !colorPanelOpen.value
  if (colorPanelOpen.value) {
    const fc = activeFontColor.value
    const bc = activeBgColor.value
    if (fc && !isPresetKey(fc)) customFontHex.value = fc
    if (bc && !isPresetKey(bc)) customBgHex.value = bc
  }
}

function applyFontColor(color: ColorValue | null) {
  const ed = editor.value
  if (!ed) return
  if (!color) ed.chain().focus().unsetFontColor().run()
  else ed.chain().focus().setFontColor(color).run()
  updateBubble()
}

function applyBgColor(color: ColorValue | null) {
  const ed = editor.value
  if (!ed) return
  if (!color) ed.chain().focus().unsetBgColor().run()
  else ed.chain().focus().setBgColor(color).run()
  updateBubble()
}

function onCustomFontPick(e: Event) {
  const hex = normalizeHex((e.target as HTMLInputElement).value)
  if (!hex) return
  customFontHex.value = hex
  applyFontColor(hex)
}

function onCustomBgPick(e: Event) {
  const hex = normalizeHex((e.target as HTMLInputElement).value)
  if (!hex) return
  customBgHex.value = hex
  applyBgColor(hex)
}

function onCustomFontHexInput() {
  const hex = normalizeHex(customFontHex.value)
  if (hex) applyFontColor(hex)
}

function onCustomBgHexInput() {
  const hex = normalizeHex(customBgHex.value)
  if (hex) applyBgColor(hex)
}

function fontSwatchStyle(swatch: string) {
  return { background: swatch, borderColor: swatch }
}

function bgSwatchStyle(swatch: string) {
  return {
    background: `color-mix(in srgb, ${swatch} 28%, var(--gn-bg))`,
    borderColor: `color-mix(in srgb, ${swatch} 40%, transparent)`,
  }
}

function toggleLink() {
  const ed = editor.value
  if (!ed) return
  colorPanelOpen.value = false
  if (ed.isActive("link")) {
    ed.chain().focus().extendMarkRange("link").unsetLink().run()
    linkMode.value = false
    return
  }
  linkMode.value = !linkMode.value
  linkInput.value = "https://"
}

function applyLink() {
  const ed = editor.value
  if (!ed) return
  const href = linkInput.value.trim()
  linkMode.value = false
  if (!href || href === "https://") return
  ed.chain().focus().extendMarkRange("link").setLink({ href }).run()
  updateBubble()
}

/* ---------------- 末尾空行 ---------------- */

function isEmptyParagraph(node: { type: { name: string }; content: { size: number } } | null | undefined) {
  return !!node && node.type.name === "paragraph" && node.content.size === 0
}

/**
 * 保证文档末尾恰好有一个空段落。
 *
 * - 最后一行被写上字 / 换成别的块 → 再补一行
 * - 取消 `/` 后可能留下两个空段落 → 收成一个
 * - 不进撤销栈，避免和 Ctrl+Z 打架
 * - 返回文档是否被改过（调用方好据此重算斜杠菜单位置）
 */
function ensureTrailingEmpty(): boolean {
  const ed = editor.value
  if (!ed || ensuringTrail || !canEdit.value) return false
  const doc = ed.state.doc
  const last = doc.lastChild
  if (!last) return false

  ensuringTrail = true
  try {
    // 末尾已是空段落：若再前面还是空的，只留一个
    if (isEmptyParagraph(last)) {
      if (doc.childCount < 2) return false
      const prev = doc.child(doc.childCount - 2)
      if (!isEmptyParagraph(prev)) return false
      const from = doc.content.size - last.nodeSize
      const tr = ed.state.tr.delete(from, doc.content.size)
      tr.setMeta("addToHistory", false)
      ed.view.dispatch(tr)
      return true
    }

    const para = ed.schema.nodes.paragraph?.create()
    if (!para) return false
    const tr = ed.state.tr.insert(doc.content.size, para)
    tr.setMeta("addToHistory", false)
    ed.view.dispatch(tr)
    return true
  } finally {
    ensuringTrail = false
  }
}

let ensuringTrail = false

/* ---------------- 斜杠菜单 ---------------- */

const SLASH_MENU_W = 248
const SLASH_MENU_MAX_H = 380
const SLASH_MENU_MIN_H = 160

const slash = ref({ open: false, from: 0, query: "", x: 0, y: 0, maxHeight: SLASH_MENU_MAX_H, index: 0 })
const slashItems = computed(() => filterSlashItems(slash.value.query))

/** 按光标视口坐标摆菜单：优先下方，空间不够就翻到上方，并钳进视口 */
function placeSlashMenu(from: number): { x: number; y: number; maxHeight: number } | null {
  const ed = editor.value
  if (!ed) return null
  const coords = ed.view.coordsAtPos(from)
  const pad = 8
  const gap = 6
  const vh = window.innerHeight
  const x = Math.max(pad, Math.min(coords.left, window.innerWidth - SLASH_MENU_W - pad))
  const spaceBelow = vh - coords.bottom - pad
  const spaceAbove = coords.top - pad
  let y: number
  let maxHeight: number
  if (spaceBelow >= Math.min(SLASH_MENU_MAX_H, 220) || spaceBelow >= spaceAbove) {
    maxHeight = Math.max(SLASH_MENU_MIN_H, Math.min(SLASH_MENU_MAX_H, Math.max(spaceBelow - gap, SLASH_MENU_MIN_H)))
    y = coords.bottom + gap
  } else {
    maxHeight = Math.max(SLASH_MENU_MIN_H, Math.min(SLASH_MENU_MAX_H, Math.max(spaceAbove - gap, SLASH_MENU_MIN_H)))
    y = coords.top - gap - maxHeight
  }
  // 光标偶尔会落在视口外（刚补了末尾空行还没滚过来），强制钳进可见区域
  maxHeight = Math.min(maxHeight, vh - pad * 2)
  y = Math.max(pad, Math.min(y, vh - maxHeight - pad))
  return { x, y, maxHeight }
}

function openSlashAt(from: number) {
  const ed = editor.value
  if (!ed || !canEdit.value) return
  // 先让光标进视口，再算坐标，否则菜单会跑到屏幕外
  try {
    const dom = ed.view.domAtPos(from).node
    const el = dom.nodeType === 1 ? (dom as HTMLElement) : (dom as globalThis.Node).parentElement
    el?.scrollIntoView({ block: "nearest" })
  } catch {
    /* pos 暂时无效时跳过 */
  }
  const place = placeSlashMenu(from)
  if (!place) return
  slash.value = {
    open: true,
    from,
    query: "",
    x: place.x,
    y: place.y,
    maxHeight: place.maxHeight,
    index: 0,
  }
  handle.value.visible = false
}

function repositionSlash() {
  if (!slash.value.open) return
  const ed = editor.value
  if (!ed) return
  try {
    const dom = ed.view.domAtPos(slash.value.from).node
    const el = dom.nodeType === 1 ? (dom as HTMLElement) : (dom as globalThis.Node).parentElement
    el?.scrollIntoView({ block: "nearest" })
  } catch {
    /* ignore */
  }
  const place = placeSlashMenu(slash.value.from)
  if (!place) return
  slash.value.x = place.x
  slash.value.y = place.y
  slash.value.maxHeight = place.maxHeight
}

function closeSlash() {
  slash.value.open = false
  slash.value.query = ""
}

/**
 * 取消斜杠命令：把已经输入的 `/` 和查询词一起删掉。
 *
 * 只关菜单的话，`/er` 会留在正文里变成普通文字，属于误操作残留。
 */
function cancelSlash() {
  const ed = editor.value
  const from = slash.value.from
  const cursor = ed?.state.selection.from ?? from
  closeSlash()
  if (!ed || cursor <= from) return
  ed.chain().focus().deleteRange({ from, to: cursor }).run()
}

/** 失焦场景下的清理：和 cancelSlash 一样删掉残留文本，但不要把焦点抢回来 */
function cancelSlashSilent() {
  const ed = editor.value
  const from = slash.value.from
  const cursor = ed?.state.selection.from ?? from
  closeSlash()
  if (!ed || cursor <= from) return
  ed.chain().deleteRange({ from, to: cursor }).run()
}

function updateSlashQuery() {
  const ed = editor.value
  if (!ed || !slash.value.open) return
  const { from, empty } = ed.state.selection
  if (!empty || from <= slash.value.from) {
    closeSlash()
    return
  }
  const q = ed.state.doc.textBetween(slash.value.from + 1, from, "\n", "\0")
  // 出现空格说明用户已经不是在找命令了，连输入内容一起清掉
  if (/[\s\n]/.test(q)) {
    cancelSlash()
    return
  }
  if (q.length > 24) {
    closeSlash()
    return
  }
  slash.value.query = q
  slash.value.index = 0
}

function pickSlash(item: SlashItem) {
  const ed = editor.value
  if (!ed) return
  const cursor = ed.state.selection.from
  const from = slash.value.from
  closeSlash()
  if (cursor > from) {
    ed.chain().focus().deleteRange({ from, to: cursor }).run()
  }
  item.run(ed, {
    insertImage: () => openFilePicker(),
    insertDiagram,
    insertDatabase: () => void insertDatabase(),
    insertPageLink: () => void insertSubPageLink(),
    openAi: action => openAi("cursor", action),
  })
}

/* ---------------- AI 助手 ---------------- */

const ai = ref<{ open: boolean; mode: AiMode; top: number; left: number; action?: string; key: number }>({
  open: false,
  mode: "cursor",
  top: 0,
  left: 0,
  key: 0,
})

function openAi(mode: AiMode, action?: string) {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root || !canEdit.value) return
  const rect = root.getBoundingClientRect()
  let top = 0
  let left = 0
  if (mode === "page") {
    top = 0
    left = Math.max(0, rect.width / 2 - 220)
  } else {
    const coords = ed.view.coordsAtPos(mode === "selection" ? ed.state.selection.to : ed.state.selection.from)
    top = coords.bottom - rect.top + 8
    left = Math.min(Math.max(0, coords.left - rect.left - 20), Math.max(0, rect.width - 440))
  }
  bubble.value.visible = false
  ai.value = { open: true, mode, top, left, action, key: ai.value.key + 1 }
}

/* ---------------- 图表 / 多维表格 ---------------- */

/**
 * 插入一个原子块，并在其后补一个空段落，光标直接落到段落里。
 *
 * 不能用「先 insert 再读 selection」的写法：原子块的 node view 挂载会
 * 把选区重置回文档开头，连续插入两个块时内容就串位了。
 */
function insertAtomBlock(node: Record<string, unknown>) {
  const ed = editor.value
  if (!ed) return
  const at = ed.state.selection.from
  ed.chain()
    .focus()
    .insertContentAt(at, [node, { type: "paragraph" }])
    .setTextSelection(at + 2)
    .run()
  scheduleEmit()
}

function insertDiagram() {
  insertAtomBlock({ type: "diagram", attrs: { kind: "mermaid", code: "" } })
}

async function insertDatabase() {
  const d = await createDatabase()
  if (!editor.value) return
  insertAtomBlock({ type: "databaseBlock", attrs: { dbId: d.id } })
}

/** 斜杠命令：新建子页面并在正文插入页面卡片 */
async function insertSubPageLink() {
  const page = await createPage({ parentId: props.pageId, title: "" })
  await reloadPages()
  if (!editor.value) return
  insertAtomBlock({ type: "pageLink", attrs: { pageId: page.id } })
}

/* ---------------- 块菜单 ---------------- */

const blockMenuRef = ref<InstanceType<typeof BlockMenu> | null>(null)
const blockMenu = ref({ open: false, x: 0, y: 0 })
const blockMenuInfo = ref<BlockMenuInfo>({
  currentType: "",
  canTurn: false,
  canColor: false,
  charCount: 0,
  editorName: "",
  editedAt: "",
})

/** 「移动到 / 复制到页面」可选的目标：当前空间里除本页外的未删除页面 */
const blockMenuPages = computed<BlockMenuPage[]>(() =>
  store.pages
    .filter(p => !p.trashed && p.id !== props.pageId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(p => ({ id: p.id, title: p.title, icon: p.icon })),
)

/** 没有可编辑文字的块：不能转换类型、不能上色 */
const ATOM_BLOCKS = new Set(["diagram", "databaseBlock", "horizontalRule", "table"])

const LIST_CONTAINERS = new Set(["bulletList", "orderedList", "taskList"])

type ListContainerType = "bulletList" | "orderedList" | "taskList"

function firstTextPosInItem(itemFrom: number, state: EditorState): number {
  const item = state.doc.nodeAt(itemFrom)
  if (!item) return itemFrom + 1
  let pos = itemFrom + 1
  for (let i = 0; i < item.childCount; i++) {
    const child = item.child(i)
    if (child.isTextblock) return pos + 1
    pos += child.nodeSize
  }
  return itemFrom + 1
}

function convertListItemForContainer(item: PMNode, target: ListContainerType, schema: EditorState["schema"]): PMNode {
  if (target === "taskList") {
    const checked = item.type.name === "taskItem" ? !!item.attrs.checked : false
    return schema.nodes.taskItem.create({ checked }, item.content)
  }
  if (item.type.name === "taskItem") {
    return schema.nodes.listItem.create(null, item.content)
  }
  return item
}

function itemMatchesListContainer(item: PMNode, listType: string, target: ListContainerType): boolean {
  if (listType !== target) return false
  if (target === "taskList") return item.type.name === "taskItem"
  return item.type.name === "listItem"
}

/**
 * 仅转换当前 listItem：在同级列表中拆开，该项单独成目标类型列表；
 * 兄弟项、父级行、子级嵌套列表均不变。
 */
function turnListItemListType(itemFrom: number, target: ListContainerType) {
  const ed = editor.value
  if (!ed) return
  const { state, view, schema } = ed
  const item = state.doc.nodeAt(itemFrom)
  if (!item || !isListItem(item.type.name)) return

  const $from = state.doc.resolve(itemFrom)
  const listNode = $from.parent
  const listType = listNode.type.name
  if (!LIST_CONTAINERS.has(listType)) return

  const listPos = $from.before($from.depth)
  const indexInList = $from.index()
  const targetItem = convertListItemForContainer(item, target, schema)

  if (listNode.childCount === 1 && itemMatchesListContainer(item, listType, target) && listType === target) {
    ed.chain().focus().setTextSelection(firstTextPosInItem(itemFrom, state)).run()
    return
  }

  const middleList = schema.nodes[target].create(listNode.attrs, [targetItem])
  const beforeItems: PMNode[] = []
  const afterItems: PMNode[] = []
  for (let i = 0; i < listNode.childCount; i++) {
    if (i < indexInList) beforeItems.push(listNode.child(i))
    else if (i > indexInList) afterItems.push(listNode.child(i))
  }

  const parts: PMNode[] = []
  if (beforeItems.length) parts.push(schema.nodes[listType].create(listNode.attrs, beforeItems))
  parts.push(middleList)
  if (afterItems.length) parts.push(schema.nodes[listType].create(listNode.attrs, afterItems))

  const tr = state.tr.replaceWith(listPos, listPos + listNode.nodeSize, parts.length === 1 ? parts[0]! : Fragment.from(parts))

  const mappedItemFrom = tr.mapping.map(itemFrom)
  view.dispatch(tr)
  ed.chain().focus().setTextSelection(firstTextPosInItem(mappedItemFrom, view.state)).run()
}

function formatEditedAt(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  if (d.toDateString() === new Date().toDateString()) return `今天 ${hh}:${mm}`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hh}:${mm}`
}

const notice = ref("")
let noticeTimer: number | null = null

function notify(msg: string) {
  notice.value = msg
  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ""
    noticeTimer = null
  }, 1800)
}

async function writeClipboard(text: string) {
  await copyText(text)
}

function openBlockMenu() {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root || !canEdit.value) return
  if (handleTargetDom?.tagName === "LI") {
    if (!syncHoverBlockFromHandleTarget()) return
  } else if (!hoverBlock) {
    return
  }
  const node = ed.state.doc.nodeAt(hoverBlock!.from)
  if (!node) return
  const name = node.type.name
  const page = store.pages.find(p => p.id === props.pageId)
  blockMenuInfo.value = {
    currentType: name === "heading" ? `h${node.attrs.level}` : isListItem(name) ? listTurnTypeAtItem(hoverBlock!.from, ed.state) : name,
    canTurn: !ATOM_BLOCKS.has(name),
    canColor: !ATOM_BLOCKS.has(name) && name !== "codeBlock" && !!node.textContent.trim(),
    charCount: node.textContent.replace(/\s/g, "").length,
    editorName: store.user?.username ?? "—",
    editedAt: page ? formatEditedAt(page.updatedAt) : "",
  }

  const rect = root.getBoundingClientRect()
  const coords = ed.view.coordsAtPos(hoverBlock!.from + 1)
  blockMenu.value = { open: true, x: coords.left - rect.left + 6, y: coords.top - rect.top + 26 }

  // 靠近视口底部时整体上移，保证菜单完整可见
  void nextTick(() => {
    const el = root.querySelector<HTMLElement>(".block-menu")
    if (!el) return
    const overflow = el.getBoundingClientRect().bottom - (window.innerHeight - 8)
    if (overflow <= 0) return
    const minY = 8 - rect.top
    blockMenu.value.y = Math.max(minY, blockMenu.value.y - overflow)
  })
}

/** 把一个块导出为 Markdown（列表项补上外层列表，图片换回 asset: 引用） */
function blockMarkdown(from: number): string {
  const ed = editor.value
  if (!ed) return ""
  const doc = ed.state.doc
  const node = doc.nodeAt(from)
  if (!node) return ""
  let content: unknown[] = [node.toJSON()]
  if (isListItem(node.type.name)) {
    const list = doc.resolve(from).parent
    content = [{ type: list.type.name, attrs: list.attrs, content }]
  }
  const json = dehydrateAssets(JSON.stringify({ type: "doc", content }))
  return docToMarkdown(JSON.parse(json))
}

/** 走 ProseMirror 自己的复制 / 剪切，粘贴回编辑器时块结构不丢 */
function copyBlock(from: number, cut: boolean) {
  const ed = editor.value
  if (!ed) return
  const fallback = blockMarkdown(from)
  const to = from + (ed.state.doc.nodeAt(from)?.nodeSize ?? 0)
  ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, from)))
  ed.view.focus()
  if (!document.execCommand(cut ? "cut" : "copy")) {
    void writeClipboard(fallback)
    if (cut) ed.chain().focus().deleteRange({ from, to }).run()
  }
  notify(cut ? "已剪切" : "已复制")
}

function insertEmptyBlock(at: number, likeName: string) {
  const ed = editor.value
  if (!ed) return
  const item = isListItem(likeName)
  const json = item ? { type: likeName, content: [{ type: "paragraph" }] } : { type: "paragraph" }
  ed.chain()
    .focus()
    .insertContentAt(at, json)
    .setTextSelection(at + (item ? 2 : 1))
    .run()
}

function selectBlockText(from: number, to: number) {
  return ({ tr }: { tr: Transaction }) => {
    tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)))
    return true
  }
}

function colorBlock(from: number, to: number, kind: "font" | "bg", value: string) {
  const ed = editor.value
  if (!ed) return
  const c = ed.chain().focus().command(selectBlockText(from, to))
  if (kind === "font") {
    if (value === "none") c.unsetFontColor()
    else c.setFontColor(value)
  } else if (value === "none") c.unsetBgColor()
  else c.setBgColor(value)
  c.command(({ tr }) => {
    tr.setSelection(Selection.near(tr.doc.resolve(to), -1))
    return true
  }).run()
}

function turnBlock(from: number, to: number, type: string) {
  const ed = editor.value
  if (!ed) return
  const node = ed.state.doc.nodeAt(from)
  const level = /^h([1-4])$/.exec(type)
  if (node && isListItem(node.type.name)) {
    const textPos = firstTextPosInItem(from, ed.state)
    if (type === "bulletList" || type === "orderedList" || type === "taskList") {
      turnListItemListType(from, type)
      return
    }
    if (type === "paragraph") {
      ed.chain().focus().setTextSelection(textPos).liftListItem(node.type.name).setParagraph().run()
      return
    }
    if (type === "blockquote" || type === "codeBlock" || level) {
      ed.chain().focus().setTextSelection(textPos).liftListItem(node.type.name).run()
      const c = ed.chain().focus()
      if (type === "blockquote") c.toggleBlockquote().run()
      else if (type === "codeBlock") c.toggleCodeBlock().run()
      else if (level) c.setNode("heading", { level: Number(level[1]) }).run()
      return
    }
  }
  ed.chain().focus().command(selectBlockText(from, to)).run()
  const c = ed.chain().focus()
  if (type === "paragraph") c.setParagraph().run()
  else if (level) c.setNode("heading", { level: Number(level[1]) }).run()
  else if (type === "bulletList") c.toggleBulletList().run()
  else if (type === "orderedList") c.toggleOrderedList().run()
  else if (type === "taskList") c.toggleTaskList().run()
  else if (type === "blockquote") c.toggleBlockquote().run()
  else if (type === "codeBlock") c.toggleCodeBlock().run()
}

/** 把块追加到另一个页面末尾；move 为 true 时成功后从本页删除 */
async function sendBlockToPage(targetId: string, from: number, to: number, move: boolean) {
  const ed = editor.value
  if (!ed) return
  const node = ed.state.doc.nodeAt(from)
  if (!node) return
  const md = blockMarkdown(from)
  const target = store.pages.find(p => p.id === targetId)
  const targetName = target?.title || "未命名"
  try {
    const cur = await getPage(targetId)
    if (!cur) throw new Error("目标页面不存在")
    const base = cur.content.replace(/\s+$/, "")
    const next = base ? `${base}\n\n${md}` : md
    const excerpt = await saveContent(targetId, next)
    if (target) {
      target.content = next
      target.excerpt = excerpt || toPlainText(next)
      target.updatedAt = Date.now()
    }
  } catch {
    notify("操作失败，请重试")
    return
  }
  if (move) {
    // 等待保存期间本页可能又被编辑过，块没动才删，避免删错
    const now = editor.value?.state.doc.nodeAt(from)
    if (now && now.eq(node)) {
      editor.value?.chain().focus().deleteRange({ from, to }).run()
      handle.value.visible = false
    }
    notify(`已移动到「${targetName}」`)
  } else {
    notify(`已复制到「${targetName}」`)
  }
}

function syncHoverBlockFromHandleTarget(): boolean {
  const ed = editor.value
  if (!ed || handleTargetDom?.tagName !== "LI") return !!hoverBlock
  const again = hoverBlockFromListItem(ed, handleTargetDom)
  if (!again) return false
  hoverBlock = { from: again.from, to: again.to }
  const dom = ed.view.nodeDOM(again.from) as HTMLElement | null
  return dom === handleTargetDom
}

function runBlockAction(action: string) {
  const ed = editor.value
  if (!ed || !canEdit.value) return
  if (handleTargetDom?.tagName === "LI" && !syncHoverBlockFromHandleTarget()) {
    notify("未定位到当前列表行，请把手柄移到该行后重试")
    return
  }
  if (!hoverBlock) return
  const { from, to } = hoverBlock
  const name = ed.state.doc.nodeAt(from)?.type.name ?? "paragraph"
  blockMenu.value.open = false

  if (action === "copy" || action === "cut") {
    copyBlock(from, action === "cut")
    if (action === "cut") handle.value.visible = false
    return
  }
  if (action === "delete") {
    ed.chain().focus().deleteRange({ from, to }).run()
    handle.value.visible = false
    return
  }
  if (action === "duplicate") {
    const slice = ed.state.doc.slice(from, to)
    ed.chain().focus().insertContentAt(to, slice.content.toJSON()).run()
    return
  }
  if (action === "copyLink") {
    const index = ed.state.doc.resolve(from).index(0)
    const url = pageUrl(props.pageId, index)
    void writeClipboard(url).then(() => notify("已复制块链接"))
    return
  }
  if (action === "insertAbove") return insertEmptyBlock(from, name)
  if (action === "insertBelow") return insertEmptyBlock(to, name)
  if (action.startsWith("turn:")) return turnBlock(from, to, action.slice(5))
  if (action.startsWith("toColumns:")) {
    const n = Number(action.slice(11))
    // 直接用编辑器当前选区：选中多行时整段选区都会被转成多栏；单选/光标处则转换当前块
    if (n >= 1 && n <= 4) ed.chain().focus().convertToColumns({ count: n }).run()
    return
  }
  if (action.startsWith("font:")) return colorBlock(from, to, "font", action.slice(5))
  if (action.startsWith("bg:")) return colorBlock(from, to, "bg", action.slice(3))
  if (action.startsWith("moveTo:")) return void sendBlockToPage(action.slice(7), from, to, true)
  if (action.startsWith("copyTo:")) return void sendBlockToPage(action.slice(7), from, to, false)
}

/** 菜单打开时的单键 / 组合键快捷操作（和菜单右侧的提示一致） */
function onBlockMenuKeyDown(e: KeyboardEvent) {
  if (!blockMenu.value.open || !canEdit.value) return
  if (e.key === "Escape") {
    e.preventDefault()
    e.stopPropagation()
    blockMenu.value.open = false
    return
  }
  // 页面搜索框里正常打字
  if (isNativeEditableTarget(e.target)) return

  const mod = e.ctrlKey || e.metaKey
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (mod && e.shiftKey && k === "p") {
    e.preventDefault()
    e.stopPropagation()
    blockMenuRef.value?.openSub("move")
    return
  }
  let action: string | null = null
  if (mod && !e.shiftKey && !e.altKey) {
    if (k === "c") action = "copy"
    else if (k === "x") action = "cut"
    else if (k === "d") action = "duplicate"
  } else if (!mod && !e.altKey && !e.shiftKey) {
    if (k === "Delete" || k === "Backspace") action = "delete"
    else if (k === "f") action = "copyLink"
    else if (k === "a") action = "insertAbove"
    else if (k === "b") action = "insertBelow"
  }
  if (!action) return
  e.preventDefault()
  e.stopPropagation()
  runBlockAction(action)
}

/**
 * 块链接定位后的高亮框。
 * 画在编辑器外层而不是给块加 class：ProseMirror 会把它管理的 DOM 上的外来改动重绘掉。
 */
const flashBox = ref<{ top: number; height: number; key: number } | null>(null)
let flashTimer: number | null = null

/** 打开 `/<id>?b=<序号>`（兼容旧 `#/p/<id>?b=`）时，滚到对应块并闪一下 */
function revealBlockFromUrl() {
  let raw: string | null = null
  const path = window.location.pathname.replace(/\/+$/, "") || "/"
  if (path === `/${props.pageId}`) {
    raw = new URLSearchParams(window.location.search).get("b")
  } else {
    const m = /^#\/?p\/([^?]+)\?(.*)$/.exec(window.location.hash)
    if (m && m[1] === props.pageId) raw = new URLSearchParams(m[2]).get("b")
  }
  const index = raw == null ? NaN : Number(raw)
  if (!Number.isInteger(index) || index < 0) return
  window.setTimeout(() => {
    const el = editor.value?.view.dom.children[index] as HTMLElement | undefined
    const root = rootRef.value
    if (!el || !root) return
    el.scrollIntoView({ block: "center", behavior: "smooth" })
    const r = el.getBoundingClientRect()
    const base = root.getBoundingClientRect()
    flashBox.value = { top: r.top - base.top - 2, height: r.height + 4, key: Date.now() }
    if (flashTimer) window.clearTimeout(flashTimer)
    flashTimer = window.setTimeout(() => {
      flashBox.value = null
      flashTimer = null
    }, 1800)
  }, 120)
}

/* ---------------- 拖拽移动块 ---------------- */

const dragFrom = ref<number | null>(null)
const dragTo = ref<number | null>(null)
const dropLineY = ref<number | null>(null)
let dropPos: number | null = null

interface ColDrop {
  mode: 'new' | 'into' | 'cols-with'
  columnsPos?: number
  /** mode='cols-with'：要把拖入块并排进去的目标普通块起始位置 */
  targetPos?: number
  /** mode='cols-with'：拖入块落在目标块的左侧还是右侧 */
  side?: 'left' | 'right'
  index?: number
  columnIndex?: number
  left?: number
  top?: number
  height?: number
  el?: HTMLElement
}
const dropCol = ref<ColDrop | null>(null)
let lastIntoEl: HTMLElement | null = null

function setIntoHighlight(t: ColDrop) {
  if (t.mode !== 'into' || !t.el) {
    clearIntoHighlight()
    return
  }
  if (lastIntoEl && lastIntoEl !== t.el) lastIntoEl.classList.remove('gn-col-drop-into')
  t.el.classList.add('gn-col-drop-into')
  lastIntoEl = t.el
}
function clearIntoHighlight() {
  if (lastIntoEl) {
    lastIntoEl.classList.remove('gn-col-drop-into')
    lastIntoEl = null
  }
}

/** 判断拖拽落点是否落在某个分栏上，并返回「新建栏」或「入栏」目标 */
function computeColumnDrop(columnsPos: number, clientX: number, clientY: number): ColDrop | null {
  const ed = editor.value
  if (!ed || dragFrom.value == null) return null
  // 分栏/列节点本身不能被拖入列内
  const dragNode = ed.state.doc.nodeAt(dragFrom.value)
  if (dragNode && (dragNode.type.name === 'columns' || dragNode.type.name === 'column')) return null
  const columnsNode = ed.state.doc.nodeAt(columnsPos)
  if (!columnsNode || columnsNode.type.name !== 'columns') return null
  // 拖动内容必须是合法的「列内容」（block+），否则交给普通重排逻辑处理
  const slice = ed.state.doc.slice(dragFrom.value, dragTo.value ?? dragFrom.value)
  if (!ed.schema.nodes.column.validContent(slice.content)) return null

  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  if (!el) return null
  const rowEl = el.closest('.gn-columns-row') as HTMLElement | null
  if (!rowEl) return null
  // 命中的分栏必须是当前解析到的这一层（嵌套分栏时避免作用到外层）
  const columnsEl = rowEl.closest('.gn-columns') as HTMLElement | null
  const nodeDom = ed.view.nodeDOM(columnsPos) as HTMLElement | null
  if (!columnsEl || !nodeDom || columnsEl !== nodeDom) return null
  const root = rootRef.value
  if (!root) return null
  const colEls = Array.from(rowEl.children).filter((c) => c.classList?.contains('gn-column')) as HTMLElement[]
  if (!colEls.length) return null

  const rootRect = root.getBoundingClientRect()
  const rowRect = rowEl.getBoundingClientRect()
  const mkNew = (index: number, atX: number): ColDrop => ({
    mode: 'new',
    columnsPos,
    index,
    left: atX - rootRect.left,
    top: rowRect.top - rootRect.top,
    height: rowRect.height,
  })

  // 1) 行左右边缘 → 首 / 尾新建栏（拖到「某一行」的边侧即可开新栏）
  if (clientX <= rowRect.left + 16) return mkNew(0, rowRect.left)
  if (clientX >= rowRect.right - 16) return mkNew(colEls.length, rowRect.right)

  // 2) 列与列之间的空隙 → 在该缝隙处新建栏
  for (let i = 0; i < colEls.length - 1; i++) {
    const rRight = colEls[i].getBoundingClientRect().right
    const rLeft = colEls[i + 1].getBoundingClientRect().left
    if (clientX >= rRight - 6 && clientX <= rLeft + 6) {
      return mkNew(i + 1, (rRight + rLeft) / 2)
    }
  }

  // 3) 落在某一列的内容区 → 入栏
  const hit = el.closest('.gn-column') as HTMLElement | null
  if (hit && colEls.includes(hit)) {
    return { mode: 'into', columnsPos, columnIndex: colEls.indexOf(hit), el: hit }
  }
  // 兜底：其余情况在末尾新建
  return mkNew(colEls.length, clientX)
}

/**
 * 拖到「还没有分栏」的普通行上：在该行就地开一栏。
 * - 行的上下窄边（band）→ 仍走普通重排（便于上下换位）；
 * - 其余中间区域     → 目标行与拖入块并排成两栏（x 决定放左还是放右）；
 * - 目标是空段落     → 不处理（保持普通移动，避免半空分栏）。
 */
function computeBlockColumnDrop(block: HoverBlock, clientX: number, clientY: number): ColDrop | null {
  const ed = editor.value
  if (!ed || dragFrom.value == null) return null
  const dragNode = ed.state.doc.nodeAt(dragFrom.value)
  if (!dragNode) return null
  // 整块分栏/列本身不参与「并排成栏」
  if (dragNode.type.name === 'columns' || dragNode.type.name === 'column') return null
  // 拖到自己身上不处理
  if (block.from === dragFrom.value) return null

  // 目标提升到「顶层块」：清单条目命中时按整张清单算，否则无法安全地换成块级分栏
  const docSize = ed.state.doc.content.size
  const $pos = ed.state.doc.resolve(Math.min(block.from, docSize))
  const topFrom = $pos.depth > 0 ? $pos.before(1) : block.from
  const topNode = ed.state.doc.nodeAt(topFrom)
  if (!topNode) return null
  if (topNode.type.name === 'columns' || topNode.type.name === 'column') return null
  // 空段落作为落点：交给普通重排
  if (topNode.isTextblock && topNode.content.size === 0) return null
  // 拖拽范围与目标顶层块重叠（例如把清单里的条目拖回同一张清单）→ 不处理
  const dragToPos = dragTo.value ?? dragFrom.value
  if (dragFrom.value! < topFrom + topNode.nodeSize && dragToPos > topFrom) return null

  const root = rootRef.value
  if (!root) return null
  const dom =
    block.hitDom ??
    (ed.view.nodeDOM(topFrom) as HTMLElement | null) ??
    (ed.view.nodeDOM(block.from) as HTMLElement | null)
  if (!dom) return null
  const r = dom.getBoundingClientRect()
  if (r.height <= 0) return null

  // 只有贴住行的上下窄边才走普通重排（否则「拖到某行中间」很难命中并排）
  const band = Math.max(6, Math.min(20, r.height * 0.12))
  if (clientY < r.top + band || clientY > r.bottom - band) return null

  const rootRect = root.getBoundingClientRect()
  const side: 'left' | 'right' = clientX < r.left + r.width / 2 ? 'left' : 'right'
  return {
    mode: 'cols-with',
    targetPos: topFrom,
    side,
    left: (side === 'left' ? r.left : r.right) - rootRect.left,
    top: r.top - rootRect.top,
    height: r.height,
  }
}

function onDragStart(e: DragEvent) {
  if (!hoverBlock || !canEdit.value) {
    e.preventDefault()
    return
  }
  dragFrom.value = hoverBlock.from
  dragTo.value = hoverBlock.to
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", "block")
  }
  handle.value.visible = false
}

function updateDropLine(e: DragEvent) {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root) return
  const rect = root.getBoundingClientRect()
  const block = resolveBlock(e.clientX, e.clientY)
  if (!block) {
    // 落在正文下方空白区（padding-bottom）时按「插到文档末尾」处理，
    // 否则 dropPos 会保持上一次的值或为 null，松手后看起来什么都没发生
    const pm = ed.view.dom as HTMLElement
    const bottom = contentBottom(pm)
    if (e.clientY > bottom) {
      dropPos = ed.state.doc.content.size
      dropLineY.value = bottom - rect.top
    }
    return
  }
  const dom = ed.view.nodeDOM(block.from) as HTMLElement | null
  if (!dom) return
  const b = dom.getBoundingClientRect()
  const upper = e.clientY < b.top + b.height / 2
  dropPos = upper ? block.from : block.to
  dropLineY.value = (upper ? b.top : b.bottom) - rect.top
}

function onDragOver(e: DragEvent) {
  if (!canEdit.value) return
  const pageDrop = hasPageDrag(e.dataTransfer) && dragFrom.value == null
  if (dragFrom.value == null && !pageDrop) return
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = pageDrop ? "copy" : "move"

  // 落点在分栏上 → 显示「新建栏 / 入栏」指示，不再显示普通重排线
  const block = resolveBlock(e.clientX, e.clientY)
  if (block) {
    if (block.node.type.name === 'columns') {
      const target = computeColumnDrop(block.from, e.clientX, e.clientY)
      if (target) {
        dropCol.value = target
        dropLineY.value = null
        setIntoHighlight(target)
        return
      }
    } else {
      // 落在普通行上 → 该行就地并排开一栏
      const asCols = computeBlockColumnDrop(block, e.clientX, e.clientY)
      if (asCols) {
        dropCol.value = asCols
        dropLineY.value = null
        clearIntoHighlight()
        return
      }
    }
  }
  clearIntoHighlight()
  dropCol.value = null
  updateDropLine(e)
}

async function insertPageLinkAt(pos: number, pageId: string) {
  const ed = editor.value
  if (!ed || !pageId || pageId === props.pageId) return
  const page = store.pages.find(p => p.id === pageId && !p.trashed)
  if (!page) return

  // 拖入正文时，若还不是当前页子页面，先挂到当前页下
  if (page.parentId !== props.pageId) {
    const kids = store.pages.filter(p => p.parentId === props.pageId && !p.trashed)
    const maxOrder = kids.reduce((m, p) => Math.max(m, p.order), 0)
    await movePage(pageId, props.pageId, maxOrder + 1)
    await reloadPages()
  }

  ed.chain().focus().insertContentAt(pos, { type: "pageLink", attrs: { pageId } }).run()
  flush()
}

function onDrop(e: DragEvent) {
  if (!canEdit.value) return
  const ed = editor.value
  if (!ed) return

  // 从侧栏 / 子页面列表拖入 → 插入页面卡片
  if (dragFrom.value == null && hasPageDrag(e.dataTransfer)) {
    e.preventDefault()
    e.stopPropagation()
    const pageId = readPageDragId(e.dataTransfer)
    const target = dropPos
    resetDrag()
    if (!pageId || target == null) return
    void insertPageLinkAt(target, pageId)
    return
  }

  if (dragFrom.value == null) return
  e.preventDefault()
  e.stopPropagation()

  // 落在分栏/普通行上：把拖拽块移入（新建栏 / 入栏 / 与目标并排成栏）
  if (dropCol.value) {
    const t = dropCol.value
    const from = dragFrom.value
    const to = dragTo.value!
    clearIntoHighlight()
    dropCol.value = null
    resetDrag()
    if (t.mode === 'cols-with' && t.targetPos != null && t.side) {
      const ok = ed
        .chain()
        .focus()
        .makeColumnsWithBlock({ targetPos: t.targetPos, from, to, side: t.side })
        .run()
      if (!ok) {
        // 兜底：无法并排成栏时按普通移动处理，避免「松手后什么都没发生」
        const target = ed.state.doc.nodeAt(t.targetPos)
        if (target) {
          moveBlockRange(ed, from, to, t.side === 'left' ? t.targetPos : t.targetPos + target.nodeSize)
        }
      }
      return
    }
    const ok = ed
      .chain()
      .focus()
      .moveBlocksToColumn({
        from,
        to,
        targetColumnsPos: t.columnsPos!,
        mode: t.mode === 'into' ? 'into' : 'new',
        index: t.index,
        columnIndex: t.columnIndex,
      })
      .run()
    if (!ok) {
      const target = ed.state.doc.nodeAt(t.columnsPos!)
      if (target) moveBlockRange(ed, from, to, t.columnsPos! + target.nodeSize)
    }
    return
  }

  if (dropPos == null) return resetDrag()
  const from = dragFrom.value
  const to = dragTo.value!
  const target = dropPos
  resetDrag()
  moveBlockRange(ed, from, to, target)
}

/** 普通重排：把 [from,to) 的顶层块移动到 target 处（target 为插入点） */
function moveBlockRange(ed: NonNullable<typeof editor.value>, from: number, to: number, target: number) {
  if (target >= from && target <= to) return
  let insert = target
  if (insert > to) insert -= to - from
  const slice = ed.state.doc.slice(from, to)
  const tr = ed.state.tr
  tr.delete(from, to)
  tr.replaceWith(insert, insert, slice.content)
  ed.view.dispatch(tr)
}

function resetDrag() {
  dragFrom.value = null
  dragTo.value = null
  dropLineY.value = null
  dropPos = null
  dropCol.value = null
  clearIntoHighlight()
}

/* ---------------- 图片 ---------------- */

function openFilePicker() {
  fileInput.value?.click()
}

async function handleImageFile(file: File) {
  if (!file.type.startsWith("image/")) return
  const url = await importImageFile(file)
  editor.value
    ?.chain()
    .focus()
    .setImage({ src: url, alt: file.name.replace(/\.[^.]+$/, "") })
    .run()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (files) for (const f of Array.from(files)) await handleImageFile(f)
  input.value = ""
}

/* ---------------- 键盘 / 全局事件 ---------------- */

function onKeyDown(e: KeyboardEvent) {
  if (runUndoRedo(e)) return

  const ed = editor.value
  if (!ed) return

  if (slash.value.open) {
    const list = slashItems.value
    if (e.key === "ArrowDown") {
      e.preventDefault()
      e.stopPropagation()
      slash.value.index = list.length ? (slash.value.index + 1) % list.length : 0
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      e.stopPropagation()
      slash.value.index = list.length ? (slash.value.index - 1 + list.length) % list.length : 0
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      const item = list[slash.value.index]
      if (item) pickSlash(item)
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      // Esc 视为「放弃这次命令」，连输入的 `/` 一起清掉
      cancelSlash()
      return
    }
    if (e.key === "Tab") {
      // Tab 要正常移走焦点，所以不 preventDefault；
      // 这里只把菜单和半截输入 `/xxx` 静默清掉，避免残留在正文里。
      cancelSlashSilent()
      return
    }
  }

  if (e.key === "Escape" && colorPanelOpen.value) {
    e.preventDefault()
    colorPanelOpen.value = false
    return
  }
}

function onGlobalMouseDown(e: MouseEvent) {
  const root = rootRef.value
  if (!root) return
  const target = e.target
  if (!(target instanceof Node)) return
  if (slash.value.open) {
    const menuEl = document.querySelector(".slash-menu")
    // 菜单已挂到 body，不能只看 note-editor 是否包含点击目标
    if (!root.contains(target) && !menuEl?.contains(target)) {
      cancelSlash()
    }
  }
  if (blockMenu.value.open) {
    const menuEl = document.querySelector(".block-menu")
    const handleEl = document.querySelector(".block-handle")
    if (!menuEl?.contains(target) && !handleEl?.contains(target)) {
      blockMenu.value.open = false
    }
  }
}

watch(
  canEdit,
  v => {
    const ed = editor.value
    if (!ed) return
    ed.setEditable(v)
    if (!v) {
      handle.value = { ...handle.value, visible: false }
      slash.value.open = false
      blockMenu.value.open = false
      bubble.value.visible = false
      linkMode.value = false
      colorPanelOpen.value = false
      resetDrag()
    }
  },
  { immediate: true },
)

onMounted(() => {
  const el = rootRef.value
  if (el) {
    el.addEventListener("dragover", onDragOver, true)
    el.addEventListener("drop", onDrop, true)
  }
  document.addEventListener("mousedown", onGlobalMouseDown)
  // 捕获阶段：抢在 ProseMirror 之前处理，否则 A / B 会被当成正文输入
  document.addEventListener("keydown", onBlockMenuKeyDown, true)
  // 捕获阶段：笔记滚动容器滚动时，固定定位的斜杠菜单要跟着光标重算
  window.addEventListener("scroll", onSlashViewportChange, true)
  window.addEventListener("resize", onSlashViewportChange)
  window.addEventListener("mousemove", onWindowMouseMoveForGutter, { passive: true })
  window.addEventListener("popstate", revealBlockFromUrl)
  revealBlockFromUrl()
  editor.value?.setEditable(canEdit.value)
})

function onSlashViewportChange() {
  if (slash.value.open) repositionSlash()
}

onBeforeUnmount(() => {
  const el = rootRef.value
  if (el) {
    el.removeEventListener("dragover", onDragOver, true)
    el.removeEventListener("drop", onDrop, true)
  }
  document.removeEventListener("mousedown", onGlobalMouseDown)
  document.removeEventListener("keydown", onBlockMenuKeyDown, true)
  window.removeEventListener("scroll", onSlashViewportChange, true)
  window.removeEventListener("resize", onSlashViewportChange)
  window.removeEventListener("mousemove", onWindowMouseMoveForGutter)
  window.removeEventListener("popstate", revealBlockFromUrl)
  if (noticeTimer) window.clearTimeout(noticeTimer)
  if (flashTimer) window.clearTimeout(flashTimer)
})
</script>

<template>
  <div class="note-editor" :class="{ 'is-readonly': !canEdit, 'is-gutter-tuning': gutterTuningOn }" ref="rootRef" @mousemove="onMouseMove" @mouseleave="onMouseLeaveRoot" @keydown.capture="onKeyDown">
    <EditorContent :editor="editor" />

    <TableControls :editor="editor" :root="rootRef" :editable="canEdit" :rev="rev" />

    <!-- 块手柄：普通块显示拖动手柄；标题显示隐性 H1/H2/H3 -->
    <div v-show="handle.visible" class="block-handle visible" :class="{ heading: handle.headingLevel > 0 }" :style="{ top: handle.top + 'px', left: handle.left + 'px' }" @mouseenter="cancelHide" @mouseleave="hideNow">
      <button v-if="handle.headingLevel" class="bh-level" v-tooltip="`拖动排序 / 打开菜单 · H${handle.headingLevel}`" draggable="true" @dragstart="onDragStart" @dragend="resetDrag" @click="openBlockMenu">H{{ handle.headingLevel }}</button>
      <button v-else class="bh-grip" v-tooltip="'拖动排序 / 拖到某行中间可并排成栏 / 点击打开菜单'" draggable="true" @dragstart="onDragStart" @dragend="resetDrag" @click="openBlockMenu">
        <GripVertical :size="15" :stroke-width="2" />
      </button>
    </div>

    <div v-if="flashBox" :key="flashBox.key" class="block-flash" :style="{ top: flashBox.top + 'px', height: flashBox.height + 'px' }"></div>

    <!-- 拖拽指示线 -->
    <div v-if="dropLineY !== null" class="block-drop-line" :style="{ top: dropLineY + 'px' }"></div>

    <!-- 拖入分栏 / 普通行并排：新建栏竖线指示 -->
    <div
      v-if="dropCol && (dropCol.mode === 'new' || dropCol.mode === 'cols-with')"
      class="block-drop-col"
      :style="{ left: (dropCol.left ?? 0) + 'px', top: (dropCol.top ?? 0) + 'px', height: (dropCol.height ?? 0) + 'px' }"
    >
      <span class="block-drop-col-badge">{{ dropCol.mode === 'cols-with' ? '并排成栏' : '新建栏' }}</span>
    </div>

    <!-- 文字格式浮条 -->
    <div v-if="bubble.visible" class="bubble-bar gn-pop" :style="{ top: bubble.top + 'px', left: bubble.left + 'px' }">
      <template v-if="!linkMode">
        <button class="bubble-ai" v-tooltip="tr('AI 改写 / 翻译 / 总结')" @mousedown.prevent="openAi('selection')">
          <Sparkles :size="14" :stroke-width="2.1" />
          <span>AI</span>
        </button>
        <span class="bubble-sep"></span>
        <button :class="{ on: editor?.isActive('bold') }" v-tooltip="'粗体 ⌘B'" @mousedown.prevent="editor?.chain().focus().toggleBold().run()">
          <Bold :size="15" :stroke-width="2.2" />
        </button>
        <button :class="{ on: editor?.isActive('italic') }" v-tooltip="'斜体 ⌘I'" @mousedown.prevent="editor?.chain().focus().toggleItalic().run()">
          <Italic :size="15" :stroke-width="2.2" />
        </button>
        <button :class="{ on: editor?.isActive('underline') }" v-tooltip="'下划线 ⌘U'" @mousedown.prevent="editor?.chain().focus().toggleUnderline().run()">
          <Underline :size="15" :stroke-width="2.2" />
        </button>
        <button :class="{ on: editor?.isActive('strike') }" v-tooltip="'删除线'" @mousedown.prevent="editor?.chain().focus().toggleStrike().run()">
          <Strikethrough :size="15" :stroke-width="2.2" />
        </button>
        <button :class="{ on: editor?.isActive('code') }" v-tooltip="'行内代码'" @mousedown.prevent="editor?.chain().focus().toggleCode().run()">
          <Code :size="15" :stroke-width="2.2" />
        </button>
        <button :class="{ on: editor?.isActive('highlight') }" v-tooltip="'着重文字'" @mousedown.prevent="editor?.chain().focus().toggleHighlight().run()">
          <Highlighter :size="15" :stroke-width="2.2" />
        </button>
        <span class="bubble-sep"></span>
        <button class="bubble-color-btn" :class="{ on: !!activeFontColor || !!activeBgColor || colorPanelOpen }" v-tooltip="'文字 / 背景颜色'" @mousedown.prevent="toggleColorPanel">
          <Baseline :size="15" :stroke-width="2.2" />
          <span class="bubble-color-bars">
            <i class="bubble-color-bar font" :style="{ background: fontBarColor }"></i>
            <i class="bubble-color-bar bg" :style="{ background: bgBarColor }"></i>
          </span>
        </button>
        <span class="bubble-sep"></span>
        <button :class="{ on: editor?.isActive('link') }" v-tooltip="'链接 ⌘K'" @mousedown.prevent="toggleLink">
          <Link2 :size="15" :stroke-width="2.2" />
        </button>
        <button
          v-tooltip="'清除格式'"
          @mousedown.prevent="colorPanelOpen = false; editor?.chain().focus().unsetAllMarks().run()"
        >
          <RemoveFormatting :size="15" :stroke-width="2.2" />
        </button>

        <div v-if="colorPanelOpen" class="bubble-color-panel gn-pop" @mousedown.prevent>
          <div class="bubble-color-section">
            <div class="bubble-color-title">文字颜色</div>
            <div class="bubble-color-grid">
              <button class="bubble-swatch default" :class="{ on: !activeFontColor }" v-tooltip="'默认'" @mousedown.prevent="applyFontColor(null)">
                <span class="bubble-swatch-none">A</span>
              </button>
              <button v-for="opt in COLOR_PRESETS" :key="`font-${opt.key}`" class="bubble-swatch" :class="{ on: activeFontColor === opt.key }" v-tooltip="opt.label" :style="fontSwatchStyle(opt.swatch)" @mousedown.prevent="applyFontColor(opt.key)"></button>
            </div>
            <div class="bubble-custom-row">
              <label class="bubble-custom-pick" v-tooltip="'自定义颜色'">
                <input type="color" :value="customFontHex" @input="onCustomFontPick" />
                <span class="bubble-custom-preview" :style="{ background: customFontHex }"></span>
              </label>
              <input v-model="customFontHex" class="bubble-hex-input" spellcheck="false" maxlength="7" placeholder="#337ea9" @mousedown.stop @keydown.enter.prevent="onCustomFontHexInput" @change="onCustomFontHexInput" />
              <button class="bubble-custom-apply" :class="{ on: !!activeFontColor && !isPresetKey(activeFontColor) }" @mousedown.prevent="onCustomFontHexInput">应用</button>
            </div>
          </div>

          <div class="bubble-color-sep"></div>

          <div class="bubble-color-section">
            <div class="bubble-color-title">背景颜色</div>
            <div class="bubble-color-grid">
              <button class="bubble-swatch default" :class="{ on: !activeBgColor }" v-tooltip="'默认'" @mousedown.prevent="applyBgColor(null)">
                <span class="bubble-swatch-none">A</span>
              </button>
              <button v-for="opt in COLOR_PRESETS" :key="`bg-${opt.key}`" class="bubble-swatch bg" :class="{ on: activeBgColor === opt.key }" v-tooltip="opt.label" :style="bgSwatchStyle(opt.swatch)" @mousedown.prevent="applyBgColor(opt.key)"></button>
            </div>
            <div class="bubble-custom-row">
              <label class="bubble-custom-pick" v-tooltip="'自定义颜色'">
                <input type="color" :value="customBgHex" @input="onCustomBgPick" />
                <span class="bubble-custom-preview" :style="{ background: customBgHex }"></span>
              </label>
              <input v-model="customBgHex" class="bubble-hex-input" spellcheck="false" maxlength="7" placeholder="#fef3c7" @mousedown.stop @keydown.enter.prevent="onCustomBgHexInput" @change="onCustomBgHexInput" />
              <button class="bubble-custom-apply" :class="{ on: !!activeBgColor && !isPresetKey(activeBgColor) }" @mousedown.prevent="onCustomBgHexInput">应用</button>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <input v-model="linkInput" class="bubble-input" placeholder="粘贴链接后回车" @mousedown.stop @keydown.enter.prevent="applyLink" @keydown.escape.prevent="linkMode = false" />
        <button class="bubble-ok" @mousedown.prevent="applyLink">确定</button>
      </template>
    </div>

    <AiPanel v-if="ai.open && editor" :key="ai.key" :editor="editor" :mode="ai.mode" :top="ai.top" :left="ai.left" :auto-action="ai.action" :page-markdown="ai.mode === 'page' ? currentMarkdown() : undefined" @changed="scheduleEmit" @close="ai.open = false" />

    <SlashMenu :visible="slash.open" :x="slash.x" :y="slash.y" :max-height="slash.maxHeight" :items="slashItems" :active-index="slash.index" @select="pickSlash" @hover="(i: number) => (slash.index = i)" />

    <BlockMenu ref="blockMenuRef" :visible="blockMenu.open" :x="blockMenu.x" :y="blockMenu.y" :info="blockMenuInfo" :pages="blockMenuPages" @action="runBlockAction" />

    <Teleport to="body">
      <div v-if="notice" class="block-notice">{{ notice }}</div>
    </Teleport>

    <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onFileChange" />
  </div>
</template>

<style scoped>
.note-editor {
  position: relative;
  overflow: visible;
}
.note-editor :deep(.ProseMirror) {
  overflow: visible;
}
.block-flash {
  position: absolute;
  left: -6px;
  right: -6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--gn-accent) 16%, transparent);
  pointer-events: none;
  z-index: 0;
  animation: block-flash 1.8s ease forwards;
}
@keyframes block-flash {
  0%,
  55% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.block-notice {
  position: fixed;
  left: 50%;
  bottom: 36px;
  transform: translateX(-50%);
  z-index: 200;
  padding: 7px 14px;
  border-radius: 8px;
  background: var(--gn-text);
  color: var(--gn-bg);
  font-size: 13px;
  box-shadow: var(--gn-shadow-md);
  pointer-events: none;
}
.block-drop-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--gn-accent);
  border-radius: 2px;
  pointer-events: none;
  z-index: 30;
}
.block-drop-col {
  position: absolute;
  width: 3px;
  background: var(--gn-accent);
  border-radius: 3px;
  pointer-events: none;
  z-index: 30;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--gn-accent) 22%, transparent);
}
.block-drop-col-badge {
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--gn-accent);
  color: #fff;
  font-size: 11px;
  line-height: 1.4;
  box-shadow: var(--gn-shadow-md);
}
.bubble-bar {
  position: absolute;
  transform: translate(-50%, calc(-100% - 8px));
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 3px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  box-shadow: var(--gn-shadow-md);
  z-index: 50;
}
.bubble-bar > button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 27px;
  height: 27px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
  position: relative;
}
.bubble-bar > button:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.bubble-bar > button.on {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.bubble-color-btn {
  flex-direction: column;
  gap: 2px;
}
.bubble-color-bars {
  display: flex;
  gap: 2px;
  margin-top: -2px;
}
.bubble-color-bar {
  display: block;
  width: 8px;
  height: 2px;
  border-radius: 1px;
}
.bubble-sep {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--gn-border);
}
.bubble-bar .bubble-ai {
  width: auto;
  gap: 3px;
  padding: 0 7px;
  color: #9065b0;
  font-size: 12px;
  font-weight: 600;
}
.bubble-input {
  width: 190px;
  height: 26px;
  padding: 0 6px;
  font-size: 13px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--gn-text);
}
.bubble-ok {
  width: auto !important;
  padding: 0 8px;
  font-size: 12.5px;
  color: var(--gn-accent) !important;
  font-weight: 500;
}
.bubble-color-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: 196px;
  padding: 7px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  box-shadow: var(--gn-shadow-md);
  z-index: 60;
}
.bubble-color-section + .bubble-color-sep {
  margin: 6px 0;
}
.bubble-color-sep {
  height: 1px;
  background: var(--gn-border);
}
.bubble-color-title {
  font-size: 10.5px;
  font-weight: 550;
  color: var(--gn-text-muted);
  padding: 0 1px 5px;
}
.bubble-color-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}
.bubble-swatch {
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid transparent;
  border-radius: 3.5px;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition:
    transform 0.1s ease,
    box-shadow 0.1s ease;
}
.bubble-swatch:hover {
  transform: scale(1.1);
}
.bubble-swatch.on {
  box-shadow:
    0 0 0 1.5px var(--gn-bg),
    0 0 0 2.5px var(--gn-accent);
}
.bubble-swatch.default {
  background: var(--gn-bg) !important;
  border-color: var(--gn-border-strong) !important;
  position: relative;
  overflow: hidden;
}
.bubble-swatch.default::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(to top right, transparent calc(50% - 0.5px), #d64545 50%, transparent calc(50% + 0.5px));
}
.bubble-swatch-none {
  position: relative;
  z-index: 1;
  font-size: 9px;
  font-weight: 650;
  color: var(--gn-text-soft);
  line-height: 1;
}
.bubble-custom-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
}
.bubble-custom-pick {
  position: relative;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--gn-border);
  cursor: pointer;
}
.bubble-custom-pick input[type="color"] {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
  border: none;
  padding: 0;
}
.bubble-custom-preview {
  display: block;
  width: 100%;
  height: 100%;
  background: conic-gradient(from 0deg, #e03e3e, #d9730d, #cb912f, #448361, #337ea9, #9065b0, #c14c8a, #e03e3e);
}
.bubble-hex-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 20px;
  padding: 0 5px;
  border: 1px solid var(--gn-border);
  border-radius: 4px;
  background: var(--gn-bg);
  color: var(--gn-text-soft);
  font-size: 11px;
  font-family: var(--gn-mono);
  outline: none;
}
.bubble-hex-input:focus {
  border-color: var(--gn-border-strong);
  color: var(--gn-text);
}
.bubble-custom-apply {
  flex: 0 0 auto;
  height: 20px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 11px;
  cursor: pointer;
}
.bubble-custom-apply:hover,
.bubble-custom-apply.on {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}

/* 锁定只读：隐藏块手柄 / 编辑控件，禁用待办勾选 */
.note-editor.is-readonly .block-handle {
  display: none !important;
}
.note-editor.is-readonly :deep(ul[data-type="taskList"] input[type="checkbox"]) {
  pointer-events: none;
  cursor: default;
}
.note-editor.is-readonly :deep(.ProseMirror) {
  caret-color: transparent;
}
.note-editor.is-readonly :deep(.cb-btn.danger),
.note-editor.is-readonly :deep(.cb-lang .cb-caret),
.note-editor.is-readonly :deep(.dg-tools button.danger),
.note-editor.is-readonly :deep(.dg-tools button:has(svg.lucide-pencil)),
.note-editor.is-readonly :deep(.dg-tools button:has(svg.lucide-replace)),
.note-editor.is-readonly :deep(.dbb-del),
.note-editor.is-readonly :deep(.dbb-tools),
.note-editor.is-readonly :deep(.db-add-row),
.note-editor.is-readonly :deep(.db-th-add),
.note-editor.is-readonly :deep(.db-col-add),
.note-editor.is-readonly :deep(.db-card-add) {
  display: none !important;
}
.note-editor.is-readonly :deep(.cb-title),
.note-editor.is-readonly :deep(.cb-lang-btn),
.note-editor.is-readonly :deep(.dbb-title) {
  pointer-events: none;
  cursor: default;
}
</style>
