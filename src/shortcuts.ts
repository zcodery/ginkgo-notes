import { reactive, watch } from 'vue'
import { getUserSetting, putUserSetting } from '@/api/features'

/**
 * 可自定义的全局 / 笔记页快捷键。
 * 组合写法：Mod+Shift+K（Mod 在 macOS 为 ⌘，其它系统为 Ctrl）。
 * 本机 localStorage 立即生效，同时同步到账号。
 */

export type ShortcutAction =
  | 'search'
  | 'newPage'
  | 'toggleSidebar'
  | 'toggleTheme'
  | 'openSettings'
  | 'goHome'
  | 'lock'
  | 'find'
  | 'copyLink'
  | 'duplicate'
  | 'share'
  | 'favorite'
  | 'toggleToc'
  | 'lockPage'
  | 'aiSummary'
  | 'askAi'

export type ShortcutGroup = 'app' | 'note'

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  search: '全局搜索',
  newPage: '新建页面',
  toggleSidebar: '显示 / 隐藏侧边栏',
  toggleTheme: '切换浅色 / 深色',
  openSettings: '打开设置',
  goHome: '回到首页',
  lock: '立即锁屏（需设置 PIN）',
  find: '查找或替换',
  copyLink: '复制页面链接',
  duplicate: '创建页面副本',
  share: '分享与协作',
  favorite: '收藏 / 取消收藏',
  toggleToc: '显示 / 隐藏页面目录',
  lockPage: '锁定 / 解除锁定页面',
  aiSummary: 'AI 总结全文',
  askAi: '问问 AI',
}

export const SHORTCUT_GROUPS: { id: ShortcutGroup; label: string; actions: ShortcutAction[] }[] = [
  {
    id: 'app',
    label: '应用',
    actions: ['search', 'newPage', 'toggleSidebar', 'toggleTheme', 'openSettings', 'goHome', 'lock'],
  },
  {
    id: 'note',
    label: '笔记页',
    actions: [
      'find',
      'copyLink',
      'duplicate',
      'share',
      'favorite',
      'toggleToc',
      'lockPage',
      'aiSummary',
      'askAi',
    ],
  },
]

export const NOTE_SHORTCUTS = new Set<ShortcutAction>(
  SHORTCUT_GROUPS.find((g) => g.id === 'note')!.actions,
)

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  search: 'Mod+K',
  newPage: 'Mod+Alt+N',
  toggleSidebar: 'Mod+\\',
  toggleTheme: 'Mod+Shift+L',
  openSettings: 'Mod+,',
  goHome: 'Mod+Shift+H',
  lock: 'Mod+Alt+L',
  find: 'Mod+F',
  copyLink: 'Mod+Shift+C',
  duplicate: 'Mod+Shift+D',
  share: 'Mod+Shift+S',
  favorite: 'Mod+Shift+B',
  toggleToc: 'Mod+Shift+\\',
  lockPage: 'Mod+Shift+K',
  aiSummary: 'Mod+Shift+A',
  askAi: 'Mod+J',
}

const KEY = 'ginkgo-shortcuts'
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

function readLocal(): Record<ShortcutAction, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Record<ShortcutAction, string>> | null
    return { ...DEFAULT_SHORTCUTS, ...(raw ?? {}) }
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}

export const shortcuts = reactive<Record<ShortcutAction, string>>(readLocal())

let syncing = false
watch(
  shortcuts,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      /* ignore */
    }
    if (!syncing) void putUserSetting('shortcuts', { ...v }).catch(() => undefined)
  },
  { deep: true, flush: 'sync' },
)

/** 登录后从账号拉一次配置 */
export async function loadShortcuts() {
  try {
    const remote = await getUserSetting<Partial<Record<ShortcutAction, string>>>('shortcuts')
    if (!remote) return
    syncing = true
    Object.assign(shortcuts, { ...DEFAULT_SHORTCUTS, ...remote })
  } finally {
    syncing = false
  }
}

export function resetShortcuts() {
  Object.assign(shortcuts, DEFAULT_SHORTCUTS)
}

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

/** 从键盘事件生成组合字符串；只按了修饰键时返回 null */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null
  const parts: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod')
  if (isMac && e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = e.code.startsWith('Key')
    ? e.code.slice(3)
    : e.code.startsWith('Digit')
      ? e.code.slice(5)
      : e.key
  if (e.code === 'Backslash') key = '\\'
  if (e.code === 'Comma') key = ','
  if (e.code === 'Period') key = '.'
  if (e.code === 'Slash') key = '/'
  key = KEY_ALIASES[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  parts.push(key)
  return parts.join('+')
}

export function matchShortcut(e: KeyboardEvent): ShortcutAction | null {
  const combo = comboFromEvent(e)
  if (!combo || !combo.includes('+')) return null
  for (const [action, value] of Object.entries(shortcuts) as [ShortcutAction, string][]) {
    if (value && value === combo) return action
  }
  return null
}

/** 展示用：Mod 换成 ⌘ / Ctrl */
export function formatCombo(combo: string): string {
  if (!combo) return ''
  return combo
    .split('+')
    .map((p) =>
      p === 'Mod'
        ? isMac
          ? '⌘'
          : 'Ctrl'
        : p === 'Alt'
          ? isMac
            ? '⌥'
            : 'Alt'
          : p === 'Shift'
            ? isMac
              ? '⇧'
              : 'Shift'
            : p,
    )
    .join(isMac ? '' : '+')
}
