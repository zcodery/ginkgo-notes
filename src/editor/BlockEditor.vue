<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { EditorContent } from '@tiptap/vue-3'
import { useEditor } from '@tiptap/vue-3'
import {
  GripVertical,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link2,
  RemoveFormatting,
  Baseline,
} from 'lucide-vue-next'
import { buildExtensions } from './extensions'
import { docToMarkdown, markdownToDoc } from './markdown'
import { ASSET_PREFIX, dehydrateAssets, hydrateAssets, importImageFile } from './assets'
import { filterSlashItems, type SlashItem } from './slashItems'
import {
  COLOR_PRESETS,
  isPresetKey,
  normalizeHex,
  resolveSwatch,
  type ColorValue,
} from './marks/colors'
import { createDatabase } from '@/db/databases'
import SlashMenu from './SlashMenu.vue'
import BlockMenu from './BlockMenu.vue'

const props = withDefaults(
  defineProps<{
    content: string
    pageId: string
    placeholder?: string
  }>(),
  { placeholder: "输入 '/' 唤起命令……" },
)

const emit = defineEmits<{ (e: 'change', markdown: string, pageId: string): void }>()

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
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Ctrl/Cmd+Z 撤销；Ctrl/Cmd+Y 或 Ctrl/Cmd+Shift+Z 重做。
 * 显式拦截，避免被浏览器默认行为或其它捕获监听抢走。
 */
function runUndoRedo(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.altKey) return false
  if (isNativeEditableTarget(e.target)) return false

  const ed = editor.value
  if (!ed) return false

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const code = e.code

  const isZ = key === 'z' || code === 'KeyZ'
  const isY = key === 'y' || code === 'KeyY'

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
  editorProps: {
    attributes: { class: 'gn-prose' },
    handleKeyDown: (_view, event) => runUndoRedo(event),
    handleTextInput: (view, from, _to, text) => {
      if (text === '/') {
        const before = from > 0 ? view.state.doc.textBetween(from - 1, from, '\n', '\0') : ''
        if (before === '' || /\s/.test(before)) pendingSlashPos = from
      }
      return false
    },
    handlePaste: (_view, event) => {
      const items = (event as ClipboardEvent).clipboardData?.items
      if (!items) return false
      for (const it of items) {
        if (it.type.startsWith('image/')) {
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
          tr.setMeta('addToHistory', false)
          return true
        })
        .setContent(markdownToDoc(hydrated), { emitUpdate: false })
        .run()
      suppress = false
    }
  },
  onUpdate: () => {
    if (pendingSlashPos != null) {
      const pos = pendingSlashPos
      pendingSlashPos = null
      if (!slash.value.open) openSlashAt(pos)
    }
    updateSlashQuery()
    if (suppress) return
    scheduleEmit()
  },
  onTransaction: () => {
    rev.value++
  },
  onSelectionUpdate: () => {
    if (slash.value.open) updateSlashQuery()
    updateBubble()
  },
  onBlur: () => {
    // 编辑器整体失焦（比如 Tab 走了、点了别的区域）时，把斜杠命令一并收掉，
    // 避免 `/er` 这种半截输入残留在正文里。
    if (slash.value.open) cancelSlashSilent()
  },
})

function currentMarkdown(): string {
  const ed = editor.value
  if (!ed) return ''
  const dehydrated = dehydrateAssets(JSON.stringify(ed.getJSON()))
  return docToMarkdown(JSON.parse(dehydrated))
}

function scheduleEmit() {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    emit('change', currentMarkdown(), props.pageId)
  }, 450)
}

function flush() {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  emit('change', currentMarkdown(), props.pageId)
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
  focus: () => {
    const ed = editor.value
    if (!ed) return
    ed.commands.focus('start')
  },
})

/* ---------------- 块悬浮手柄 ---------------- */

const handle = ref({ visible: false, top: 0, headingLevel: 0 as 0 | 1 | 2 | 3 })
let hoverBlock: { from: number; to: number } | null = null

/** 手柄按钮半高，原子块贴顶定位时用 */
const HANDLE_HALF = 11

type HoverBlock = {
  from: number
  to: number
  node: { type: { name: string }; attrs?: Record<string, unknown>; isTextblock?: boolean }
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
    if (raw.endsWith('px')) return lh
    const fs = parseFloat(style.fontSize) || 16
    return lh * fs
  }
  return (parseFloat(style.fontSize) || 16) * 1.7
}

/**
 * 首行视觉中心（视口 Y）。
 * 用 selectNodeContents 的 line box，比单字符墨水盒更稳，才能和列表圆点对齐。
 */
function firstLineCenterY(dom: HTMLElement): number {
  const range = document.createRange()
  range.selectNodeContents(dom)
  const lines = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
  if (lines.length) {
    const line = lines[0]!
    return line.top + line.height / 2
  }
  // 空段落：padding-top + 半行高
  const style = window.getComputedStyle(dom)
  const padTop = parseFloat(style.paddingTop) || 0
  return dom.getBoundingClientRect().top + padTop + textLineHeightPx(dom) / 2
}

function handleCenterY(alignDom: HTMLElement | null, isText: boolean): number {
  if (!alignDom) return 0
  if (isText) return firstLineCenterY(alignDom)
  return alignDom.getBoundingClientRect().top + HANDLE_HALF
}

function headingLevelOf(block: HoverBlock): 0 | 1 | 2 | 3 {
  if (block.node.type.name === 'heading') {
    return Math.min(3, Math.max(1, Number(block.node.attrs?.level) || 1)) as 1 | 2 | 3
  }
  if (block.alignIsText && block.alignDom.tagName.match(/^H[1-3]$/)) {
    return Number(block.alignDom.tagName[1]) as 1 | 2 | 3
  }
  return 0
}

/** 正文实际内容的底边：忽略 ProseMirror 底部大块 padding，避免空白区误吸附 */
function contentBottom(pm: HTMLElement): number {
  const last = pm.lastElementChild as HTMLElement | null
  if (!last) return pm.getBoundingClientRect().top
  return last.getBoundingClientRect().bottom
}

function resolveBlock(clientX: number, clientY: number): HoverBlock | null {
  const ed = editor.value
  if (!ed) return null
  const pm = ed.view.dom as HTMLElement
  const pmRect = pm.getBoundingClientRect()

  // 底部空白（padding-bottom: 35vh）不显示手柄
  if (clientY > contentBottom(pm) + 6) return null
  if (clientY < pmRect.top - 2) return null

  // 左侧装订线也要能命中当前行：把 X 夹进正文再算坐标
  const x = Math.min(Math.max(clientX, pmRect.left + 12), pmRect.right - 12)
  const info = ed.view.posAtCoords({ left: x, top: clientY })
  if (!info) return blockAtPoint(x, clientY)

  const $pos = ed.state.doc.resolve(info.pos)
  if ($pos.depth < 1) return blockAtPoint(x, clientY)

  // 列表里按「列表项」为单位，而不是整棵 ul
  let depth = 1
  for (let d = $pos.depth; d >= 1; d--) {
    const name = $pos.node(d).type.name
    if (name === 'listItem' || name === 'taskItem') {
      depth = d
      break
    }
  }

  const from = $pos.before(depth)
  const node = $pos.node(depth)
  const hitDom = ed.view.nodeDOM(from) as HTMLElement | null
  if (!hitDom) return null

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

  return { from, to: from + node.nodeSize, node, hitDom, alignDom, alignIsText }
}

function blockAtPoint(clientX: number, clientY: number): HoverBlock | null {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root) return null
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  if (!el || !root.contains(el)) return null
  // 忽略手柄自身
  if (el.closest('.block-handle')) return null

  let child: HTMLElement | null = el
  while (child && child.parentElement !== ed.view.dom) {
    if (child.tagName === 'LI') break
    child = child.parentElement
  }
  // 若停在 LI 上，用它作为 hit；否则爬到 ProseMirror 直接子节点
  let hitDom = child
  if (hitDom && hitDom.tagName === 'LI') {
    // ok
  } else {
    hitDom = el
    while (hitDom && hitDom.parentElement !== ed.view.dom) hitDom = hitDom.parentElement
  }
  if (!hitDom) return null

  // 通过 DOM 反查文档位置
  const pos = ed.view.posAtDOM(hitDom, 0)
  const $pos = ed.state.doc.resolve(Math.min(pos + 1, ed.state.doc.content.size))
  if ($pos.depth < 1) return null

  let depth = 1
  for (let d = $pos.depth; d >= 1; d--) {
    const name = $pos.node(d).type.name
    if (name === 'listItem' || name === 'taskItem') {
      depth = d
      break
    }
  }
  const from = $pos.before(depth)
  const node = $pos.node(depth)
  const blockDom = (ed.view.nodeDOM(from) as HTMLElement | null) ?? hitDom

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
    alignDom = blockDom
    alignIsText = node.isTextblock
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

function onMouseMove(e: MouseEvent) {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root) return
  if (slash.value.open || blockMenu.value.open) return
  // 鼠标悬停到手柄自身时保持当前状态，否则手柄会「跑掉」
  const target = e.target as HTMLElement | null
  if (target?.closest?.('.block-handle')) return

  const block = resolveBlock(e.clientX, e.clientY)
  if (!block) {
    handle.value.visible = false
    return
  }

  // 鼠标必须落在该块垂直范围内，防止空白区吸附到远处块
  const hit = block.hitDom.getBoundingClientRect()
  if (e.clientY < hit.top - 2 || e.clientY > hit.bottom + 2) {
    handle.value.visible = false
    return
  }

  hoverBlock = { from: block.from, to: block.to }
  const rect = root.getBoundingClientRect()
  const top = Math.round(handleCenterY(block.alignDom, block.alignIsText) - rect.top)
  handle.value = { visible: true, top, headingLevel: headingLevelOf(block) }
}

function onMouseLeaveRoot() {
  if (slash.value.open || blockMenu.value.open) return
  scheduleHide()
}

let hideTimer: number | null = null

function scheduleHide() {
  if (hideTimer) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    handle.value.visible = false
  }, 200)
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
}

/* ---------------- 文字浮动工具条 ---------------- */

const bubble = ref({ visible: false, top: 0, left: 0 })
const linkMode = ref(false)
const linkInput = ref('')
const colorPanelOpen = ref(false)
const customFontHex = ref('#337ea9')
const customBgHex = ref('#fef3c7')

const activeFontColor = computed(() => {
  void rev.value
  const ed = editor.value
  if (!ed) return null
  return (ed.getAttributes('fontColor')?.color as ColorValue | null) ?? null
})

const activeBgColor = computed(() => {
  void rev.value
  const ed = editor.value
  if (!ed) return null
  return (ed.getAttributes('bgColor')?.color as ColorValue | null) ?? null
})

const fontBarColor = computed(() => {
  const c = activeFontColor.value
  if (!c) return 'currentColor'
  if (isPresetKey(c)) return `var(--gn-fc-${c})`
  return c
})

const bgBarColor = computed(() => {
  const c = activeBgColor.value
  if (!c) return 'var(--gn-border-strong)'
  return `color-mix(in srgb, ${resolveSwatch(c)} 40%, transparent)`
})

function updateBubble() {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root) {
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
  if (!ed.state.doc.textBetween(from, to, ' ').trim()) {
    bubble.value.visible = false
    linkMode.value = false
    colorPanelOpen.value = false
    return
  }
  if (ed.isActive('codeBlock')) {
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
  if (ed.isActive('link')) {
    ed.chain().focus().extendMarkRange('link').unsetLink().run()
    linkMode.value = false
    return
  }
  linkMode.value = !linkMode.value
  linkInput.value = 'https://'
}

function applyLink() {
  const ed = editor.value
  if (!ed) return
  const href = linkInput.value.trim()
  linkMode.value = false
  if (!href || href === 'https://') return
  ed.chain().focus().extendMarkRange('link').setLink({ href }).run()
  updateBubble()
}

/* ---------------- 斜杠菜单 ---------------- */

const slash = ref({ open: false, from: 0, query: '', x: 0, y: 0, index: 0 })
const slashItems = computed(() => filterSlashItems(slash.value.query))

function openSlashAt(from: number) {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root) return
  const coords = ed.view.coordsAtPos(from)
  const rect = root.getBoundingClientRect()
  slash.value = {
    open: true,
    from,
    query: '',
    x: Math.min(coords.left - rect.left, rect.width - 300),
    y: coords.bottom - rect.top + 6,
    index: 0,
  }
  handle.value.visible = false
}

function closeSlash() {
  slash.value.open = false
  slash.value.query = ''
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
  const q = ed.state.doc.textBetween(slash.value.from + 1, from, '\n', '\0')
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
  })
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
    .insertContentAt(at, [node, { type: 'paragraph' }])
    .setTextSelection(at + 2)
    .run()
  scheduleEmit()
}

function insertDiagram() {
  insertAtomBlock({ type: 'diagram', attrs: { kind: 'mermaid', code: '' } })
}

async function insertDatabase() {
  const d = await createDatabase()
  if (!editor.value) return
  insertAtomBlock({ type: 'databaseBlock', attrs: { dbId: d.id } })
}

/* ---------------- 块菜单 ---------------- */

const blockMenu = ref({ open: false, x: 0, y: 0 })

function openBlockMenu() {
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root || !hoverBlock) return
  const rect = root.getBoundingClientRect()
  const coords = ed.view.coordsAtPos(hoverBlock.from + 1)
  blockMenu.value = { open: true, x: coords.left - rect.left + 6, y: coords.top - rect.top + 26 }
}

function runBlockAction(action: string) {
  const ed = editor.value
  if (!ed || !hoverBlock) return
  const { from, to } = hoverBlock
  blockMenu.value.open = false

  if (action === 'delete') {
    ed.chain().focus().deleteRange({ from, to }).run()
    return
  }
  if (action === 'duplicate') {
    const slice = ed.state.doc.slice(from, to)
    ed.chain().focus().insertContentAt(to, slice.content.toJSON()).run()
    return
  }
  if (action === 'moveUp') {
    const doc = ed.state.doc
    const $from = doc.resolve(from)
    const idx = $from.index(0)
    if (idx <= 0) return
    const prevNode = doc.child(idx - 1)
    const prevStart = from - prevNode.nodeSize
    const slice = doc.slice(from, to)
    const tr = ed.state.tr
    tr.delete(from, to)
    tr.insert(prevStart, slice.content)
    ed.view.dispatch(tr)
    return
  }
  if (action === 'moveDown') {
    const doc = ed.state.doc
    const $from = doc.resolve(from)
    const idx = $from.index(0)
    if (idx >= doc.childCount - 1) return
    const nextNode = doc.child(idx + 1)
    const insertAt = from + nextNode.nodeSize
    const slice = doc.slice(from, to)
    const tr = ed.state.tr
    tr.delete(from, to)
    tr.replaceWith(insertAt, insertAt, slice.content)
    ed.view.dispatch(tr)
    return
  }
  if (action.startsWith('turn:')) {
    const type = action.slice(5)
    ed.chain()
      .focus()
      .setTextSelection({ from: from + 1, to: Math.max(from + 1, to - 1) })
      .run()
    const c = ed.chain().focus()
    if (type === 'paragraph') c.setParagraph().run()
    else if (type === 'h1') c.setNode('heading', { level: 1 }).run()
    else if (type === 'h2') c.setNode('heading', { level: 2 }).run()
    else if (type === 'h3') c.setNode('heading', { level: 3 }).run()
    else if (type === 'bulletList') c.toggleBulletList().run()
    else if (type === 'orderedList') c.toggleOrderedList().run()
    else if (type === 'taskList') c.toggleTaskList().run()
    else if (type === 'blockquote') c.toggleBlockquote().run()
    else if (type === 'codeBlock') c.toggleCodeBlock().run()
  }
}

/* ---------------- 拖拽移动块 ---------------- */

const dragFrom = ref<number | null>(null)
const dragTo = ref<number | null>(null)
const dropLineY = ref<number | null>(null)
let dropPos: number | null = null

function onDragStart(e: DragEvent) {
  if (!hoverBlock) {
    e.preventDefault()
    return
  }
  dragFrom.value = hoverBlock.from
  dragTo.value = hoverBlock.to
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', 'block')
  }
  handle.value.visible = false
}

function onDragOver(e: DragEvent) {
  if (dragFrom.value == null) return
  const ed = editor.value
  const root = rootRef.value
  if (!ed || !root) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const block = resolveBlock(e.clientX, e.clientY)
  if (!block) return
  const dom = ed.view.nodeDOM(block.from) as HTMLElement | null
  if (!dom) return
  const rect = root.getBoundingClientRect()
  const b = dom.getBoundingClientRect()
  const upper = e.clientY < b.top + b.height / 2
  dropPos = upper ? block.from : block.to
  dropLineY.value = (upper ? b.top : b.bottom) - rect.top
}

function onDrop(e: DragEvent) {
  if (dragFrom.value == null) return
  e.preventDefault()
  e.stopPropagation()
  const ed = editor.value
  if (!ed || dropPos == null) return resetDrag()
  const from = dragFrom.value
  const to = dragTo.value!
  const target = dropPos
  resetDrag()
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
}

/* ---------------- 图片 ---------------- */

function openFilePicker() {
  fileInput.value?.click()
}

async function handleImageFile(file: File) {
  if (!file.type.startsWith('image/')) return
  const url = await importImageFile(file)
  editor.value?.chain().focus().setImage({ src: url, alt: file.name.replace(/\.[^.]+$/, '') }).run()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (files) for (const f of Array.from(files)) await handleImageFile(f)
  input.value = ''
}

/* ---------------- 键盘 / 全局事件 ---------------- */

function onKeyDown(e: KeyboardEvent) {
  if (runUndoRedo(e)) return

  const ed = editor.value
  if (!ed) return

  if (slash.value.open) {
    const list = slashItems.value
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      slash.value.index = list.length ? (slash.value.index + 1) % list.length : 0
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      slash.value.index = list.length
        ? (slash.value.index - 1 + list.length) % list.length
        : 0
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const item = list[slash.value.index]
      if (item) pickSlash(item)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      // Esc 视为「放弃这次命令」，连输入的 `/` 一起清掉
      cancelSlash()
      return
    }
    if (e.key === 'Tab') {
      // Tab 要正常移走焦点，所以不 preventDefault；
      // 这里只把菜单和半截输入 `/xxx` 静默清掉，避免残留在正文里。
      cancelSlashSilent()
      return
    }
  }

  if (e.key === 'Escape' && colorPanelOpen.value) {
    e.preventDefault()
    colorPanelOpen.value = false
    return
  }

  if (e.key === 'Escape' && blockMenu.value.open) {
    blockMenu.value.open = false
    return
  }
}

function onGlobalMouseDown(e: MouseEvent) {
  const root = rootRef.value
  if (!root) return
  const target = e.target as Node
  if (slash.value.open && !root.contains(target)) {
    cancelSlash()
  }
  if (blockMenu.value.open) {
    const menuEl = document.querySelector('.block-menu')
    const handleEl = document.querySelector('.block-handle')
    if (!menuEl?.contains(target) && !handleEl?.contains(target)) {
      blockMenu.value.open = false
    }
  }
}

onMounted(() => {
  const el = rootRef.value
  if (el) {
    el.addEventListener('dragover', onDragOver, true)
    el.addEventListener('drop', onDrop, true)
  }
  document.addEventListener('mousedown', onGlobalMouseDown)
})

onBeforeUnmount(() => {
  const el = rootRef.value
  if (el) {
    el.removeEventListener('dragover', onDragOver, true)
    el.removeEventListener('drop', onDrop, true)
  }
  document.removeEventListener('mousedown', onGlobalMouseDown)
})
</script>

<template>
  <div
    class="note-editor"
    ref="rootRef"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeaveRoot"
    @keydown.capture="onKeyDown"
  >
    <EditorContent :editor="editor" />

    <!-- 块手柄：普通块显示拖动手柄；标题显示隐性 H1/H2/H3 -->
    <div
      v-show="handle.visible"
      class="block-handle visible"
      :class="{ heading: handle.headingLevel > 0 }"
      :style="{ top: handle.top + 'px', left: handle.headingLevel ? '-40px' : '-28px' }"
      @mouseenter="cancelHide"
      @mouseleave="hideNow"
    >
      <button
        v-if="handle.headingLevel"
        class="bh-level"
        :title="`拖动排序 / 打开菜单 · H${handle.headingLevel}`"
        draggable="true"
        @dragstart="onDragStart"
        @dragend="resetDrag"
        @click="openBlockMenu"
      >
        H{{ handle.headingLevel }}
      </button>
      <button
        v-else
        class="bh-grip"
        title="拖动排序 / 打开菜单"
        draggable="true"
        @dragstart="onDragStart"
        @dragend="resetDrag"
        @click="openBlockMenu"
      >
        <GripVertical :size="15" :stroke-width="2" />
      </button>
    </div>

    <!-- 拖拽指示线 -->
    <div v-if="dropLineY !== null" class="block-drop-line" :style="{ top: dropLineY + 'px' }"></div>

    <!-- 文字格式浮条 -->
    <div
      v-if="bubble.visible"
      class="bubble-bar gn-pop"
      :style="{ top: bubble.top + 'px', left: bubble.left + 'px' }"
    >
      <template v-if="!linkMode">
        <button
          :class="{ on: editor?.isActive('bold') }"
          title="粗体 ⌘B"
          @mousedown.prevent="editor?.chain().focus().toggleBold().run()"
        >
          <Bold :size="15" :stroke-width="2.2" />
        </button>
        <button
          :class="{ on: editor?.isActive('italic') }"
          title="斜体 ⌘I"
          @mousedown.prevent="editor?.chain().focus().toggleItalic().run()"
        >
          <Italic :size="15" :stroke-width="2.2" />
        </button>
        <button
          :class="{ on: editor?.isActive('underline') }"
          title="下划线 ⌘U"
          @mousedown.prevent="editor?.chain().focus().toggleUnderline().run()"
        >
          <Underline :size="15" :stroke-width="2.2" />
        </button>
        <button
          :class="{ on: editor?.isActive('strike') }"
          title="删除线"
          @mousedown.prevent="editor?.chain().focus().toggleStrike().run()"
        >
          <Strikethrough :size="15" :stroke-width="2.2" />
        </button>
        <button
          :class="{ on: editor?.isActive('code') }"
          title="行内代码"
          @mousedown.prevent="editor?.chain().focus().toggleCode().run()"
        >
          <Code :size="15" :stroke-width="2.2" />
        </button>
        <span class="bubble-sep"></span>
        <button
          class="bubble-color-btn"
          :class="{ on: !!activeFontColor || !!activeBgColor || colorPanelOpen }"
          title="文字 / 背景颜色"
          @mousedown.prevent="toggleColorPanel"
        >
          <Baseline :size="15" :stroke-width="2.2" />
          <span class="bubble-color-bars">
            <i class="bubble-color-bar font" :style="{ background: fontBarColor }"></i>
            <i class="bubble-color-bar bg" :style="{ background: bgBarColor }"></i>
          </span>
        </button>
        <span class="bubble-sep"></span>
        <button
          :class="{ on: editor?.isActive('link') }"
          title="链接 ⌘K"
          @mousedown.prevent="toggleLink"
        >
          <Link2 :size="15" :stroke-width="2.2" />
        </button>
        <button
          title="清除格式"
          @mousedown.prevent="
            colorPanelOpen = false;
            editor?.chain().focus().unsetAllMarks().run()
          "
        >
          <RemoveFormatting :size="15" :stroke-width="2.2" />
        </button>

        <div v-if="colorPanelOpen" class="bubble-color-panel gn-pop" @mousedown.prevent>
          <div class="bubble-color-section">
            <div class="bubble-color-title">文字颜色</div>
            <div class="bubble-color-grid">
              <button
                class="bubble-swatch default"
                :class="{ on: !activeFontColor }"
                title="默认"
                @mousedown.prevent="applyFontColor(null)"
              >
                <span class="bubble-swatch-none">A</span>
              </button>
              <button
                v-for="opt in COLOR_PRESETS"
                :key="`font-${opt.key}`"
                class="bubble-swatch"
                :class="{ on: activeFontColor === opt.key }"
                :title="opt.label"
                :style="fontSwatchStyle(opt.swatch)"
                @mousedown.prevent="applyFontColor(opt.key)"
              ></button>
            </div>
            <div class="bubble-custom-row">
              <label class="bubble-custom-pick" title="自定义颜色">
                <input
                  type="color"
                  :value="customFontHex"
                  @input="onCustomFontPick"
                />
                <span class="bubble-custom-preview" :style="{ background: customFontHex }"></span>
              </label>
              <input
                v-model="customFontHex"
                class="bubble-hex-input"
                spellcheck="false"
                maxlength="7"
                placeholder="#337ea9"
                @mousedown.stop
                @keydown.enter.prevent="onCustomFontHexInput"
                @change="onCustomFontHexInput"
              />
              <button
                class="bubble-custom-apply"
                :class="{ on: !!activeFontColor && !isPresetKey(activeFontColor) }"
                @mousedown.prevent="onCustomFontHexInput"
              >
                应用
              </button>
            </div>
          </div>

          <div class="bubble-color-sep"></div>

          <div class="bubble-color-section">
            <div class="bubble-color-title">背景颜色</div>
            <div class="bubble-color-grid">
              <button
                class="bubble-swatch default"
                :class="{ on: !activeBgColor }"
                title="默认"
                @mousedown.prevent="applyBgColor(null)"
              >
                <span class="bubble-swatch-none">A</span>
              </button>
              <button
                v-for="opt in COLOR_PRESETS"
                :key="`bg-${opt.key}`"
                class="bubble-swatch bg"
                :class="{ on: activeBgColor === opt.key }"
                :title="opt.label"
                :style="bgSwatchStyle(opt.swatch)"
                @mousedown.prevent="applyBgColor(opt.key)"
              ></button>
            </div>
            <div class="bubble-custom-row">
              <label class="bubble-custom-pick" title="自定义颜色">
                <input type="color" :value="customBgHex" @input="onCustomBgPick" />
                <span class="bubble-custom-preview" :style="{ background: customBgHex }"></span>
              </label>
              <input
                v-model="customBgHex"
                class="bubble-hex-input"
                spellcheck="false"
                maxlength="7"
                placeholder="#fef3c7"
                @mousedown.stop
                @keydown.enter.prevent="onCustomBgHexInput"
                @change="onCustomBgHexInput"
              />
              <button
                class="bubble-custom-apply"
                :class="{ on: !!activeBgColor && !isPresetKey(activeBgColor) }"
                @mousedown.prevent="onCustomBgHexInput"
              >
                应用
              </button>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <input
          v-model="linkInput"
          class="bubble-input"
          placeholder="粘贴链接后回车"
          @mousedown.stop
          @keydown.enter.prevent="applyLink"
          @keydown.escape.prevent="linkMode = false"
        />
        <button class="bubble-ok" @mousedown.prevent="applyLink">确定</button>
      </template>
    </div>

    <SlashMenu
      :visible="slash.open"
      :x="slash.x"
      :y="slash.y"
      :items="slashItems"
      :active-index="slash.index"
      @select="pickSlash"
      @hover="(i: number) => (slash.index = i)"
    />

    <BlockMenu
      :visible="blockMenu.open"
      :x="blockMenu.x"
      :y="blockMenu.y"
      @action="runBlockAction"
    />

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.note-editor {
  position: relative;
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
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
.bubble-swatch:hover {
  transform: scale(1.1);
}
.bubble-swatch.on {
  box-shadow: 0 0 0 1.5px var(--gn-bg), 0 0 0 2.5px var(--gn-accent);
}
.bubble-swatch.default {
  background: var(--gn-bg) !important;
  border-color: var(--gn-border-strong) !important;
  position: relative;
  overflow: hidden;
}
.bubble-swatch.default::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top right,
    transparent calc(50% - 0.5px),
    #d64545 50%,
    transparent calc(50% + 0.5px)
  );
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
.bubble-custom-pick input[type='color'] {
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
  background: conic-gradient(
    from 0deg,
    #e03e3e,
    #d9730d,
    #cb912f,
    #448361,
    #337ea9,
    #9065b0,
    #c14c8a,
    #e03e3e
  );
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
</style>
