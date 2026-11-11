import { computed, ref } from 'vue'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import en from './locales/en'
import type { LocaleCode, MessageKey, Messages } from './types'

export type { LocaleCode, MessageKey, Messages }

const STORAGE_KEY = 'ginkgo-locale'

export const LOCALES: { code: LocaleCode; label: string }[] = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'zh-TW', label: '中文（繁體）' },
  { code: 'en', label: 'English' },
]

const catalogs: Record<LocaleCode, Messages> = {
  'zh-CN': zhCN as unknown as Messages,
  'zh-TW': zhTW,
  en,
}

function detectLocale(): LocaleCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as LocaleCode | null
    if (saved && saved in catalogs) return saved
  } catch {
    /* ignore */
  }
  const nav = (navigator.language || '').toLowerCase()
  if (nav.startsWith('zh-tw') || nav.startsWith('zh-hk') || nav.startsWith('zh-mo')) return 'zh-TW'
  if (nav.startsWith('zh')) return 'zh-CN'
  if (nav.startsWith('en')) return 'en'
  return 'zh-CN'
}

export const locale = ref<LocaleCode>(detectLocale())

export const messages = computed(() => catalogs[locale.value])

function applyHtmlLang(code: LocaleCode) {
  document.documentElement.lang = code === 'en' ? 'en' : code
}

applyHtmlLang(locale.value)

export function setLocale(code: LocaleCode) {
  if (!(code in catalogs)) return
  locale.value = code
  applyHtmlLang(code)
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    /* ignore */
  }
}

/** 取文案；支持 {name} 占位符 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const [group, name] = key.split('.') as [keyof Messages, string]
  const table = messages.value[group] as Record<string, string> | undefined
  let text = table?.[name] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
}

/** 组合式：模板里直接用 t()，切换语言自动重渲染 */
export function useI18n() {
  return { t, locale, setLocale, LOCALES }
}
