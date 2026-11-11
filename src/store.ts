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
}

export type ViewKind = 'note' | 'empty' | 'trash'
/** 笔记正文宽度：auto 铺满可用区域；fixed 按比例限制 max-width */
export type NoteWidthMode = 'auto' | 'fixed'
export type NoteWidthRatio = 50 | 60 | 70 | 80 | 90

export const NOTE_WIDTH_RATIOS: NoteWidthRatio[] = [50, 60, 70, 80, 90]

interface State {
  pages: Page[]
  route: { view: ViewKind; pageId: string | null }
  theme: 'light' | 'dark'
  sidebarOpen: boolean
  searchOpen: boolean
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
  /** 是否显示页面目录 */
  tocVisible: boolean
}

export const store = reactive<State>({
  pages: [],
  route: { view: 'empty', pageId: null },
  theme: 'light',
  sidebarOpen: true,
  searchOpen: false,
  saveState: 'idle',
  loaded: false,
  user: null,
  authReady: false,
  space: 'me',
  noteWidthMode: 'fixed',
  noteWidthRatio: 70,
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

export async function initEditorPrefs() {
  const mode = await getMeta<NoteWidthMode>('noteWidthMode', 'fixed')
  const ratio = await getMeta<NoteWidthRatio>('noteWidthRatio', 70)
  const toc = await getMeta<boolean>('tocVisible', false)
  store.noteWidthMode = mode === 'auto' ? 'auto' : 'fixed'
  store.noteWidthRatio = NOTE_WIDTH_RATIOS.includes(ratio) ? ratio : 70
  store.tocVisible = !!toc
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

export function setTocVisible(visible: boolean) {
  store.tocVisible = visible
  void setMeta('tocVisible', visible)
}

export function toggleTocVisible() {
  setTocVisible(!store.tocVisible)
}

/* ---------------- 极简 hash 路由 ---------------- */

export function parseHash(): { view: ViewKind; pageId: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (raw.startsWith('p/')) {
    const id = raw.slice(2).split('?')[0]
    if (id) return { view: 'note', pageId: id }
  }
  if (raw.startsWith('trash')) return { view: 'trash', pageId: null }
  return { view: 'empty', pageId: null }
}

export function goToPage(id: string) {
  window.location.hash = `#/p/${id}`
}

export function goHome() {
  window.location.hash = '#/'
}

export function goTrash() {
  window.location.hash = '#/trash'
}
