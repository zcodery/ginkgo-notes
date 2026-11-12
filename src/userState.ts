import { reactive } from 'vue'
import {
  getUserSetting,
  listNotifications,
  listSharedWithMe,
  type NotificationItem,
  type SharedPageItem,
  type SharedRoot,
} from '@/api/features'

/**
 * 登录后才有意义的一些用户级数据：与我共享、通知、空间名称 / 图标。
 * 由 App 在登录后调用 initUserState()，退出登录时 resetUserState()。
 */

export interface SpaceInfo {
  name: string
  icon: string
}

export interface NotifyPrefs {
  /** 免打扰时段：只是不弹提示、不显示红点动画，通知仍然记录 */
  quiet: { enabled: boolean; start: string; end: string }
  types: Record<string, boolean>
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  quiet: { enabled: false, start: '22:00', end: '08:00' },
  types: { share: true, member: true, feedback: true, webhook: true, system: true },
}

export const userState = reactive({
  sharedRoots: [] as SharedRoot[],
  sharedPages: [] as SharedPageItem[],
  notifications: [] as NotificationItem[],
  unread: 0,
  space: { name: '', icon: '' } as SpaceInfo,
  notifyPrefs: structuredClone(DEFAULT_NOTIFY_PREFS) as NotifyPrefs,
})

export async function loadShared() {
  try {
    const res = await listSharedWithMe()
    userState.sharedRoots = res.roots
    userState.sharedPages = res.pages
  } catch {
    /* 离线时保持原样 */
  }
}

export async function loadNotifications() {
  try {
    const res = await listNotifications()
    const hadNewMember = res.items.some(
      (n) => !n.read && n.type === 'member' && !userState.notifications.some((o) => o.id === n.id),
    )
    userState.notifications = res.items
    userState.unread = res.unread
    if (hadNewMember) void loadShared()
  } catch {
    /* ignore */
  }
}

export async function loadSpaceInfo() {
  try {
    const s = await getUserSetting<SpaceInfo>('space')
    userState.space = { name: s?.name ?? '', icon: s?.icon ?? '' }
  } catch {
    /* ignore */
  }
}

export async function loadNotifyPrefs() {
  try {
    const p = await getUserSetting<NotifyPrefs>('notify')
    userState.notifyPrefs = {
      quiet: { ...DEFAULT_NOTIFY_PREFS.quiet, ...(p?.quiet ?? {}) },
      types: { ...DEFAULT_NOTIFY_PREFS.types, ...(p?.types ?? {}) },
    }
  } catch {
    /* ignore */
  }
}

/** 当前是否处在免打扰时段（支持跨零点，如 22:00-08:00） */
export function inQuietHours(now = new Date()): boolean {
  const q = userState.notifyPrefs.quiet
  if (!q.enabled) return false
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }
  const cur = now.getHours() * 60 + now.getMinutes()
  const start = toMin(q.start)
  const end = toMin(q.end)
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end
}

let pollTimer: number | null = null

export function initUserState() {
  void loadShared()
  void loadNotifications()
  void loadSpaceInfo()
  void loadNotifyPrefs()
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void loadNotifications()
  }, 60_000)
}

export function resetUserState() {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = null
  userState.sharedRoots = []
  userState.sharedPages = []
  userState.notifications = []
  userState.unread = 0
  userState.space = { name: '', icon: '' }
  userState.notifyPrefs = structuredClone(DEFAULT_NOTIFY_PREFS)
}
