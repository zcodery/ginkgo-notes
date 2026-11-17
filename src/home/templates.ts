import type { LocaleCode } from '@/i18n/types'

/**
 * 首页「今天从这里开始」的快捷模板。
 *
 * 点击后直接创建一篇带结构的笔记并跳进去编辑，
 * 省掉「新建 → 再想标题和结构」这一步。
 */

export interface QuickTemplate {
  id: string
  /** 按钮图标（lucide 组件名，由调用方映射） */
  icon: 'notebook' | 'repeat' | 'compass' | 'zap'
  /** 三语文案 */
  label: Record<LocaleCode, string>
  /** 页面标题（会带上日期） */
  title: Record<LocaleCode, (date: string) => string>
  /** 页面正文（Markdown） */
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
    body: {
      'zh-CN': `## 今天做了什么

- 

## 今天的灵感

> 

## 明天第一件事

- `,
      'zh-TW': `## 今天做了什麼

- 

## 今天的靈感

> 

## 明天第一件事

- `,
      en: `## What I did today

- 

## Ideas that came up

> 

## First thing tomorrow

- `,
    },
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
    body: {
      'zh-CN': `## 完成了什么

- 

## 卡在哪里

- 

## 明天怎么改

- `,
      'zh-TW': `## 完成了什麼

- 

## 卡在哪裡

- 

## 明天怎麼改

- `,
      en: `## What got done

- 

## Where I got stuck

- 

## What to change tomorrow

- `,
    },
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
    body: {
      'zh-CN': `## 问题的背景

## 我的判断

## 支撑它的证据

## 反面观点

## 下一步要验证什么

- `,
      'zh-TW': `## 問題的背景

## 我的判斷

## 支撐它的證據

## 反面觀點

## 下一步要驗證什麼

- `,
      en: `## Background

## My take

## Evidence

## The counter-argument

## What to verify next

- `,
    },
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
    body: {
      'zh-CN': ``,
      'zh-TW': ``,
      en: ``,
    },
  },
]

/** 本地化后的日期，如 2026-11-17 */
export function todayStamp(locale: LocaleCode, now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
