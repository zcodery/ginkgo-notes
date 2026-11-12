import { reactive, watch } from 'vue'

/**
 * PIN 锁屏：离开一段时间（或手动锁定）后盖一层遮罩，输入 PIN 解锁。
 * 锁定状态记在本机，刷新页面后依然锁着；自动锁定时长按设备保存。
 */

const LOCK_KEY = 'ginkgo-pin-locked'
const IDLE_KEY = 'ginkgo-pin-idle-minutes'

function readNumber(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : Number(v) || 0
  } catch {
    return fallback
  }
}

export const pinLock = reactive({
  locked: (() => {
    try {
      return localStorage.getItem(LOCK_KEY) === '1'
    } catch {
      return false
    }
  })(),
  /** 0 表示不自动锁定 */
  idleMinutes: readNumber(IDLE_KEY, 15),
})

watch(
  () => pinLock.locked,
  (v) => {
    try {
      if (v) localStorage.setItem(LOCK_KEY, '1')
      else localStorage.removeItem(LOCK_KEY)
    } catch {
      /* ignore */
    }
  },
)

watch(
  () => pinLock.idleMinutes,
  (v) => {
    try {
      localStorage.setItem(IDLE_KEY, String(v))
    } catch {
      /* ignore */
    }
  },
)

export function lockNow() {
  pinLock.locked = true
}

let idleTimer: number | null = null
let enabled = false

function resetIdle() {
  if (idleTimer) window.clearTimeout(idleTimer)
  idleTimer = null
  if (!enabled || pinLock.locked || !pinLock.idleMinutes) return
  idleTimer = window.setTimeout(() => (pinLock.locked = true), pinLock.idleMinutes * 60_000)
}

const EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'] as const

/** 用户设置了 PIN 时才开启空闲计时 */
export function setPinIdleWatch(on: boolean) {
  if (on === enabled) {
    resetIdle()
    return
  }
  enabled = on
  for (const ev of EVENTS) {
    if (on) window.addEventListener(ev, resetIdle, { passive: true })
    else window.removeEventListener(ev, resetIdle)
  }
  if (!on) pinLock.locked = false
  resetIdle()
}

watch(() => pinLock.idleMinutes, resetIdle)
