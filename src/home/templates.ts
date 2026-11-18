import type { LocaleCode } from '@/i18n/types'

/**
 * 首页「今天从这里开始」的快捷入口。
 *
 * 点击后只创建一篇带标题的空笔记并跳进去编辑：
 * 正文完全留空，不预置任何标题层级或列表骨架，
 * 结构由用户自己决定（用户明确要求「完全用户去编辑操作」）。
 */

export interface QuickTemplate {
  id: string
  /** 按钮图标（lucide 组件名，由调用方映射） */
  icon: 'notebook' | 'repeat' | 'compass' | 'zap'
  /** 三语文案 */
  label: Record<LocaleCode, string>
  /** 页面标题（会带上日期） */
  title: Record<LocaleCode, (date: string) => string>
  /** 页面正文：一律留空，用户要求不预置任何默认内容 */
  body: Record<LocaleCode, string>
}

export const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    id: 'daily',
    icon: 'notebook',
    label: { 'zh-CN': '今日日记', 'zh-TW': '今日日記', en: 'Daily log' },
    title: {
      'zh-CN': (d) => `${d} 日记`,
      'zh-TW': (d) => `${d} 日記`,
      en: (d) => `${d} Log`,
    },
    body: { 'zh-CN': '', 'zh-TW': '', en: '' },
  },
  {
    id: 'review',
    icon: 'repeat',
    label: { 'zh-CN': '每日复盘', 'zh-TW': '每日覆盤', en: 'Daily review' },
    title: {
      'zh-CN': (d) => `${d} 复盘`,
      'zh-TW': (d) => `${d} 覆盤`,
      en: (d) => `${d} Review`,
    },
    body: { 'zh-CN': '', 'zh-TW': '', en: '' },
  },
  {
    id: 'deep',
    icon: 'compass',
    label: { 'zh-CN': '深度思考', 'zh-TW': '深度思考', en: 'Deep think' },
    title: {
      'zh-CN': () => '深度思考',
      'zh-TW': () => '深度思考',
      en: () => 'Deep think',
    },
    body: { 'zh-CN': '', 'zh-TW': '', en: '' },
  },
  {
    id: 'quick',
    icon: 'zap',
    label: { 'zh-CN': '快速记录', 'zh-TW': '快速記錄', en: 'Quick capture' },
    title: {
      'zh-CN': (d) => `${d} 速记`,
      'zh-TW': (d) => `${d} 速記`,
      en: (d) => `${d} Scratch`,
    },
    body: { 'zh-CN': '', 'zh-TW': '', en: '' },
  },
]

/** 本地化后的日期，如 2026-11-17 */
export function todayStamp(locale: LocaleCode, now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
