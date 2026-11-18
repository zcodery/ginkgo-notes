import type { Page } from '@/types'

/**
 * 首页仪表盘的指标计算。
 *
 * 全部是纯函数：不依赖 Vue、不依赖 DOM，方便单独跑测试。
 * 数据来源只有 store.pages（当前空间的页面列表），
 * 所以切到「公共原稿」或某个团队空间时，统计口径会自然跟着空间走。
 */

/** 某一天的活动统计 */
export interface DayStat {
  /** 当天有更新的页面数（活跃） */
  active: number
  /** 当天新建的页面数（发布） */
  created: number
}

export interface DayCell {
  /** 当天的零点时间戳 */
  ts: number
  /** 日，1~31 */
  day: number
  /** 是否属于当前展示的月份 */
  inMonth: boolean
  /** 是否是今天 */
  isToday: boolean
  /** 当天活跃页数 */
  active: number
  /** 当天新建页数 */
  created: number
}

export interface WeekRow {
  /** ISO 周数 */
  weekNo: number
  /** 7 天，周一 → 周日 */
  days: DayCell[]
}

export interface HeatCell {
  ts: number
  count: number
  /** 0~4 色阶 */
  level: number
}

export interface HeatWeek {
  /** 该列第一天的 ISO 周数 */
  weekNo: number
  cells: HeatCell[]
}

export interface TrendPoint {
  /** 该点的时间戳 */
  ts: number
  count: number
}

/** 取某时间戳所在那天的零点 */
export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本地时区的日期键 YYYY-MM-DD */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** ISO 周数（周一为一周的第一天） */
export function isoWeek(date: Date): number {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // ISO：以周四所在的年份为基准，把日期挪到本周四
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  firstThursday.setDate(
    firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7),
  )
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000))
}

/**
 * 统计所有页面每天的活动。
 *
 * 「活跃」按 updatedAt 归集、「发布」按 createdAt 归集。
 * 注意：本项目只保存页面的最后一次更新时间，
 * 所以热力图反映的是「这一天页面处于活跃状态」，而不是精确的编辑次数。
 */
export function collectDayStats(pages: Page[]): Map<string, DayStat> {
  const map = new Map<string, DayStat>()
  const touch = (ts: number): DayStat => {
    const key = dayKey(ts)
    let s = map.get(key)
    if (!s) {
      s = { active: 0, created: 0 }
      map.set(key, s)
    }
    return s
  }
  for (const p of pages) {
    touch(p.updatedAt).active++
    touch(p.createdAt).created++
  }
  return map
}

/** 取某天（本地时区）的日期对象 */
function dateOf(year: number, month: number, day: number): Date {
  return new Date(year, month, day)
}

/**
 * 生成月历网格：周一开头，每行一周，左侧带 ISO 周数。
 * 网格从「包含当月 1 号的那一周」开始，到「包含当月最后一天的那一周」结束。
 */
export function buildMonthMatrix(
  year: number,
  month: number,
  stats: Map<string, DayStat>,
  now = Date.now(),
): WeekRow[] {
  const first = dateOf(year, month, 1)
  const lead = (first.getDay() + 6) % 7
  const last = dateOf(year, month + 1, 0)
  const total = last.getDate()
  const rows = Math.ceil((lead + total) / 7)
  const today = startOfDay(now)

  const weeks: WeekRow[] = []
  for (let w = 0; w < rows; w++) {
    const days: DayCell[] = []
    for (let i = 0; i < 7; i++) {
      const dayNum = w * 7 + i - lead + 1
      const d = dateOf(year, month, dayNum)
      const ts = d.getTime()
      const s = stats.get(dayKey(ts))
      days.push({
        ts,
        day: d.getDate(),
        inMonth: dayNum >= 1 && dayNum <= total,
        isToday: ts === today,
        active: s?.active ?? 0,
        created: s?.created ?? 0,
      })
    }
    weeks.push({ weekNo: isoWeek(dateOf(year, month, w * 7 - lead + 1)), days })
  }
  return weeks
}

/**
 * 生成整年的热力图（GitHub 贡献图风格）。
 * 列 = 周（周一起），行 = 周内 7 天；首列可能不足一年，末列可能跨年。
 */
export function buildYearHeat(
  year: number,
  stats: Map<string, DayStat>,
  now = Date.now(),
): HeatWeek[] {
  const first = dateOf(year, 0, 1)
  const lead = (first.getDay() + 6) % 7
  const start = new Date(year, 0, 1 - lead)
  const end = dateOf(year, 11, 31)
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  const cols = Math.ceil(days / 7)

  // 先算出全年峰值，用来定色阶
  let max = 0
  for (const [, s] of stats) max = Math.max(max, s.active)
  const today = startOfDay(now)

  const weeks: HeatWeek[] = []
  for (let c = 0; c < cols; c++) {
    const cells: HeatCell[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime())
      d.setDate(start.getDate() + c * 7 + i)
      const ts = d.getTime()
      const inYear = d.getFullYear() === year
      const count = inYear ? (stats.get(dayKey(ts))?.active ?? 0) : 0
      cells.push({ ts, count, level: inYear ? heatLevel(count, max) : -1 })
    }
    weeks.push({ weekNo: isoWeek(new Date(cells[0]!.ts)), cells })
  }
  return weeks
}

/** 0 空 / 1~4 四档色阶 */
export function heatLevel(count: number, max: number): number {
  if (count <= 0) return 0
  if (max <= 1) return 4
  const r = count / max
  if (r <= 0.25) return 1
  if (r <= 0.5) return 2
  if (r <= 0.75) return 3
  return 4
}

/** 最近 n 天（不含今天）的每日新建数，用于迷你趋势线 */
export function recentDailyCreated(pages: Page[], days: number, now = Date.now()): TrendPoint[] {
  const today = startOfDay(now)
  const points: TrendPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    points.push({ ts: today - i * 86400000, count: 0 })
  }
  const buckets = new Map<string, number>()
  for (const p of pages) {
    const key = dayKey(p.createdAt)
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  for (const pt of points) {
    pt.count = buckets.get(dayKey(pt.ts)) ?? 0
  }
  return points
}

/** 最近 n 个自然月的新建数，用于迷你趋势线 */
export function recentMonthlyCreated(pages: Page[], months: number, now = Date.now()): TrendPoint[] {
  const ref = new Date(now)
  const points: TrendPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    points.push({ ts: d.getTime(), count: 0 })
  }
  const buckets = new Map<string, number>()
  for (const p of pages) {
    const d = new Date(p.createdAt)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  for (const pt of points) {
    const d = new Date(pt.ts)
    pt.count = buckets.get(`${d.getFullYear()}-${d.getMonth()}`) ?? 0
  }
  return points
}

/** 本周（周一起）新建数 */
export function countCreatedThisWeek(pages: Page[], now = Date.now()): number {
  const start = startOfWeek(now)
  return pages.filter((p) => p.createdAt >= start).length
}

/** 上周（周一起）新建数 */
export function countCreatedLastWeek(pages: Page[], now = Date.now()): number {
  const start = startOfWeek(now) - 7 * 86400000
  const end = startOfWeek(now)
  return pages.filter((p) => p.createdAt >= start && p.createdAt < end).length
}

/** 本月新建数 */
export function countCreatedThisMonth(pages: Page[], now = Date.now()): number {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  return pages.filter((p) => p.createdAt >= start).length
}

/** 上月新建数 */
export function countCreatedLastMonth(pages: Page[], now = Date.now()): number {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime()
  const end = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  return pages.filter((p) => p.createdAt >= start && p.createdAt < end).length
}

/** 本周起点（周一零点） */
export function startOfWeek(now = Date.now()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return d.getTime()
}

/**
 * 某年 12 个月的每日活跃次数总和。
 */
function monthlyActive(stats: Map<string, DayStat>, year: number): number[] {
  const out = new Array<number>(12).fill(0)
  const prefix = String(year)
  for (const [key, s] of stats) {
    if (!key.startsWith(prefix)) continue
    const m = Number(key.slice(5, 7))
    if (m >= 1 && m <= 12) out[m - 1] += s.active
  }
  return out
}

/**
 * 某年单月活跃峰值（次数 + 是哪个月）。
 *
 * 用于首页左栏的「月峰值」指标。
 */
export function monthPeak(
  stats: Map<string, DayStat>,
  year: number,
): { count: number; month: number } {
  const list = monthlyActive(stats, year)
  const count = Math.max(...list)
  return { count, month: list.indexOf(count) + 1 }
}

/**
 * 某年最长连续活跃天数。
 *
 * 日期键是本地时区的 YYYY-MM-DD，直接 `new Date(key)` 会按 UTC 解析导致差一天，
 * 所以这里按 y-m-d 本地构造。
 */
export function longestStreak(stats: Map<string, DayStat>, year: number): number {
  const prefix = String(year)
  const days: string[] = []
  for (const [key, s] of stats) {
    if (key.startsWith(prefix) && s.active > 0) days.push(key)
  }
  days.sort()
  let best = 0
  let run = 0
  let prev: number | null = null
  for (const key of days) {
    const ts = new Date(
      Number(key.slice(0, 4)),
      Number(key.slice(5, 7)) - 1,
      Number(key.slice(8, 10)),
    ).getTime()
    run = prev != null && Math.round((ts - prev) / 86400000) === 1 ? run + 1 : 1
    prev = ts
    if (run > best) best = run
  }
  return best
}

/** 某年有活跃记录的天数 */
export function activeDayCount(stats: Map<string, DayStat>, year: number): number {
  let n = 0
  for (const [key, s] of stats) {
    if (key.startsWith(String(year)) && s.active > 0) n++
  }
  return n
}

/**
 * 环比百分比。
 *
 * 上期为 0 时：本期也为 0 → 0%；本期 > 0 → 100%。
 */
export function deltaPercent(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100
  return Math.round(((current - previous) / previous) * 100)
}
