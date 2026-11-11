import { reactive, computed, nextTick } from 'vue'
import { buildTree, listPages, getMeta, setMeta, whenWritesIdle } from '@/db/repo'
import { api, getToken, onUnauthorized, setApiSpace, setToken, type Space } from '@/api/client'
import { clearAssetCache } from '@/editor/assets'
import type { Page } from '@/types'

export interface User {
  id: string
  username: string
  role: 'user' | 'admin'
  createdAt: number
  nickname?: string | null
  /** 压缩后的 data URL */
  avatar?: string | null
}

export type ViewKind = 'note' | 'empty' | 'trash' | 'profile'
/** 笔记正文宽度：auto 铺满可用区域；fixed 按比例限制 max-width */
export type NoteWidthMode = 'auto' | 'fixed'
export type NoteWidthRatio = 50 | 60 | 70 | 80 | 90
/** 正文基础字号（px） */
export type NoteFontSize = 14 | 15 | 16 | 17 | 18 | 20
/** 正文字体样式 */
export type NoteFontStyle =
  | 'default'
  | 'serif'
  | 'heiti'
  | 'kai'
  | 'fangsong'
  | 'rounded'
  | 'mono'

export const NOTE_WIDTH_RATIOS: NoteWidthRatio[] = [50, 60, 70, 80, 90]
export const NOTE_FONT_SIZES: NoteFontSize[] = [14, 15, 16, 17, 18, 20]
export const NOTE_FONT_STYLES: {
  id: NoteFontStyle
  label: string
  /** CSS font-family */
  css: string
}[] = [
  { id: 'default', label: '默认', css: 'var(--gn-font)' },
  {
    id: 'serif',
    label: '宋体',
    css: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "STSong", SimSun, "宋体", Georgia, "Times New Roman", serif',
  },
  {
    id: 'heiti',
    label: '黑体',
    css: '"Heiti SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", SimHei, "黑体", sans-serif',
  },
  {
    id: 'kai',
    label: '楷体',
    css: '"Kaiti SC", "STKaiti", KaiTi, "楷体", "Noto Serif SC", serif',
  },
  {
    id: 'fangsong',
    label: '仿宋',
    css: '"STFangsong", FangSong, "仿宋", "Songti SC", serif',
  },
  {
    id: 'rounded',
    label: '圆体',
    css: '"Yuanti SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  },
  { id: 'mono', label: '等宽', css: 'var(--gn-mono)' },
]

/** 页面布局疏密 */
export type NoteLayout = 'loose' | 'default' | 'compact'

export const NOTE_LAYOUTS: {
  id: NoteLayout
  label: string
  /** 行高倍数 */
  lineHeight: number
  /** 段落上下内边距 px */
  textPad: number
  /** 块间距 px */
  blockGap: number
  /** 标题上下间距倍率（相对默认 em） */
  headingSpace: number
}[] = [
  { id: 'loose', label: '宽松', lineHeight: 1.9, textPad: 6, blockGap: 8, headingSpace: 1.25 },
  { id: 'default', label: '默认', lineHeight: 1.7, textPad: 3, blockGap: 3, headingSpace: 1 },
  { id: 'compact', label: '紧密', lineHeight: 1.55, textPad: 1, blockGap: 1, headingSpace: 0.7 },
]

interface State {
  pages: Page[]
  route: { view: ViewKind; pageId: string | null }
  theme: 'light' | 'dark'
  sidebarOpen: boolean
  searchOpen: boolean
  /** 设置弹窗是否打开 */
  settingsOpen: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  loaded: boolean
  /** 当前登录用户；null 表示未登录 */
  user: User | null
  /** 启动时是否已完成登录态恢复（之前不渲染任何界面，避免闪一下登录页） */
  authReady: boolean
  /** me：自己的笔记；public：管理员正在编辑公共原稿 */
  space: Space
  /** 正文宽度模式 */
  noteWidthMode: NoteWidthMode
  /** 固定模式下占内容区的百分比 */
  noteWidthRatio: NoteWidthRatio
  /** 正文基础字号 */
  noteFontSize: NoteFontSize
  /** 正文字体样式 */
  noteFontStyle: NoteFontStyle
  /** 页面布局疏密 */
  noteLayout: NoteLayout
  /** 是否显示页面目录 */
  tocVisible: boolean
}

export const store = reactive<State>({
  pages: [],
  route: { view: 'empty', pageId: null },
  theme: 'light',
  sidebarOpen: true,
  searchOpen: false,
  settingsOpen: false,
  saveState: 'idle',
  loaded: false,
  user: null,
  authReady: false,
  space: 'me',
  noteWidthMode: 'fixed',
  noteWidthRatio: 70,
  noteFontSize: 16,
  noteFontStyle: 'default',
  noteLayout: 'default',
  tocVisible: false,
})

export const activePage = computed<Page | null>(() => {
  if (!store.route.pageId) return null
  return store.pages.find((p) => p.id === store.route.pageId) ?? null
})

export const tree = computed(() => buildTree(store.pages))

export const trashedPages = computed(() =>
  store.pages.filter((p) => p.trashed).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0)),
)

export const favoritePages = computed(() =>
  store.pages.filter((p) => p.favorite && !p.trashed).sort((a, b) => b.updatedAt - a.updatedAt),
)

export const recentPages = computed(() =>
  store.pages
    .filter((p) => !p.trashed)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8),
)

export function ancestorsOf(pages: Page[], id: string): Page[] {
  const map = new Map(pages.map((p) => [p.id, p]))
  const out: Page[] = []
  let cur = map.get(id)?.parentId ?? null
  while (cur) {
    const p = map.get(cur)
    if (!p) break
    out.unshift(p)
    cur = p.parentId
  }
  return out
}

export async function reloadPages() {
  store.pages = await listPages()
}

/* ---------------- 账号 ---------------- */

export const isAdmin = computed(() => store.user?.role === 'admin')

interface AuthResponse {
  token: string
  user: User
}

function resetSession() {
  store.pages = []
  store.loaded = false
  store.space = 'me'
  setApiSpace('me')
  clearAssetCache()
}

async function enter(res: AuthResponse) {
  setToken(res.token)
  resetSession()
  store.user = res.user
  await reloadPages()
  store.loaded = true
}

export async function login(username: string, password: string) {
  await enter(await api<AuthResponse>('POST', '/auth/login', { username, password }))
}

export async function register(username: string, password: string) {
  await enter(await api<AuthResponse>('POST', '/auth/register', { username, password }))
}

/**
 * 先关掉正在编辑的页面，让它把未保存的修改发出去并等写完，
 * 再切换身份或空间；否则这些写入会带着新令牌 / 新空间发出而失败。
 */
async function leaveCurrentPage() {
  goHome()
  store.route = { view: 'empty', pageId: null }
  await nextTick()
  try {
    await whenWritesIdle()
  } catch {
    /* 失败的写入已在编辑器里提示，这里不阻塞退出 */
  }
}

export async function logout() {
  await leaveCurrentPage()
  setToken(null)
  resetSession()
  store.user = null
}

/** 启动时用本地保存的令牌恢复登录态；令牌失效则留在登录页 */
export async function restoreSession() {
  onUnauthorized(() => {
    resetSession()
    store.user = null
  })
  try {
    if (!getToken()) return
    const { user } = await api<{ user: User }>('GET', '/auth/me')
    store.user = user
    await reloadPages()
    store.loaded = true
  } catch {
    store.user = null
  } finally {
    store.authReady = true
  }
}

/** 管理员在「我的笔记」与「公共原稿」之间切换 */
export async function switchSpace(space: Space) {
  if (store.space === space) return
  if (space === 'public' && !isAdmin.value) return
  await leaveCurrentPage()
  setApiSpace(space)
  try {
    // 先拿到新空间的数据再整体替换，避免界面闪一下「0 篇」
    const pages = await listPages()
    clearAssetCache()
    store.space = space
    store.pages = pages
  } catch (err) {
    setApiSpace(store.space)
    throw err
  }
}

export async function initTheme() {
  const saved = await getMeta<'light' | 'dark'>('theme', 'light')
  setTheme(saved)
}

export function setTheme(theme: 'light' | 'dark') {
  store.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  void setMeta('theme', theme)
}

export function toggleTheme() {
  setTheme(store.theme === 'dark' ? 'light' : 'dark')
}

/** 把字号 / 字体 / 布局写到根节点 CSS 变量，编辑器与标题共用 */
export function applyEditorTypography() {
  const root = document.documentElement
  const size = store.noteFontSize
  const style =
    NOTE_FONT_STYLES.find((s) => s.id === store.noteFontStyle) ?? NOTE_FONT_STYLES[0]!
  const layout =
    NOTE_LAYOUTS.find((l) => l.id === store.noteLayout) ?? NOTE_LAYOUTS[1]!
  root.style.setProperty('--gn-editor-font-size', `${size}px`)
  root.style.setProperty('--gn-editor-font', style.css)
  root.style.setProperty('--gn-editor-line-height', String(layout.lineHeight))
  root.style.setProperty('--gn-line-h', `${(size * layout.lineHeight).toFixed(1)}px`)
  root.style.setProperty('--gn-text-pad', `${layout.textPad}px`)
  root.style.setProperty('--gn-block-gap', `${layout.blockGap}px`)
  root.style.setProperty('--gn-heading-space', String(layout.headingSpace))
}

export async function initEditorPrefs() {
  const mode = await getMeta<NoteWidthMode>('noteWidthMode', 'fixed')
  const ratio = await getMeta<NoteWidthRatio>('noteWidthRatio', 70)
  const fontSize = await getMeta<NoteFontSize>('noteFontSize', 16)
  const fontStyle = await getMeta<NoteFontStyle>('noteFontStyle', 'default')
  const layout = await getMeta<NoteLayout>('noteLayout', 'default')
  const toc = await getMeta<boolean>('tocVisible', false)
  store.noteWidthMode = mode === 'auto' ? 'auto' : 'fixed'
  store.noteWidthRatio = NOTE_WIDTH_RATIOS.includes(ratio) ? ratio : 70
  store.noteFontSize = NOTE_FONT_SIZES.includes(fontSize) ? fontSize : 16
  store.noteFontStyle = NOTE_FONT_STYLES.some((s) => s.id === fontStyle) ? fontStyle : 'default'
  store.noteLayout = NOTE_LAYOUTS.some((l) => l.id === layout) ? layout : 'default'
  store.tocVisible = !!toc
  applyEditorTypography()
}

export function setNoteWidthMode(mode: NoteWidthMode) {
  store.noteWidthMode = mode
  void setMeta('noteWidthMode', mode)
}

export function setNoteWidthRatio(ratio: NoteWidthRatio) {
  store.noteWidthMode = 'fixed'
  store.noteWidthRatio = ratio
  void setMeta('noteWidthMode', 'fixed')
  void setMeta('noteWidthRatio', ratio)
}

export function setNoteFontSize(size: NoteFontSize) {
  store.noteFontSize = size
  applyEditorTypography()
  void setMeta('noteFontSize', size)
}

export function setNoteFontStyle(style: NoteFontStyle) {
  store.noteFontStyle = style
  applyEditorTypography()
  void setMeta('noteFontStyle', style)
}

export function setNoteLayout(layout: NoteLayout) {
  store.noteLayout = layout
  applyEditorTypography()
  void setMeta('noteLayout', layout)
}

export function setTocVisible(visible: boolean) {
  store.tocVisible = visible
  void setMeta('tocVisible', visible)
}

export function toggleTocVisible() {
  setTocVisible(!store.tocVisible)
}

/* ---------------- History 路由（/、/trash、/:pageId） ---------------- */

const RESERVED_PATHS = new Set(['trash', 'profile'])

/** 旧版 `#/p/:id`、`#/trash` 一次性迁到 pathname，避免书签失效 */
export function migrateLegacyHash() {
  const hash = window.location.hash
  if (!hash || hash === '#') return
  const body = hash.replace(/^#\/?/, '')
  if (!body || body === '/') {
    history.replaceState(null, '', `/${window.location.search}`)
    return
  }
  const page = /^p\/([^?/]+)(\?.*)?$/.exec(body)
  if (page) {
    const q = page[2] || window.location.search || ''
    history.replaceState(null, '', `/${page[1]}${q}`)
    return
  }
  if (body.startsWith('trash')) {
    history.replaceState(null, '', `/trash${window.location.search}`)
    return
  }
}

export function parseRoute(): { view: ViewKind; pageId: string | null } {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { view: 'empty', pageId: null }
  if (path === '/trash') return { view: 'trash', pageId: null }
  if (path === '/profile') return { view: 'profile', pageId: null }
  const id = path.slice(1)
  if (!id || id.includes('/') || RESERVED_PATHS.has(id)) {
    return { view: 'empty', pageId: null }
  }
  return { view: 'note', pageId: id }
}

/** @deprecated 使用 parseRoute；保留别名以免旧引用断裂 */
export const parseHash = parseRoute

function pushPath(path: string) {
  const next = path || '/'
  const cur = `${window.location.pathname}${window.location.search}`
  if (cur === next) {
    store.route = parseRoute()
    return
  }
  history.pushState(null, '', next)
  store.route = parseRoute()
}

export function goToPage(id: string) {
  if (!id) {
    goHome()
    return
  }
  pushPath(`/${id}`)
}

export function goHome() {
  pushPath('/')
}

export function goTrash() {
  pushPath('/trash')
}

export function goProfile() {
  store.settingsOpen = true
}

export function pageUrl(id: string, blockIndex?: number) {
  const base = `${window.location.origin}/${id}`
  if (blockIndex == null) return base
  return `${base}?b=${blockIndex}`
}

/** 修改当前登录账号密码 */
export async function changePassword(currentPassword: string, newPassword: string) {
  await api('POST', '/auth/password', { currentPassword, newPassword })
}

/** 更新昵称 / 头像；传 null 表示清除 */
export async function updateProfile(patch: { nickname?: string | null; avatar?: string | null }) {
  const { user } = await api<{ user: User }>('PATCH', '/auth/profile', patch)
  store.user = user
}

/** 对外展示的名字：有昵称用昵称，否则用户名 */
export const displayName = computed(
  () => store.user?.nickname?.trim() || store.user?.username || '',
)
