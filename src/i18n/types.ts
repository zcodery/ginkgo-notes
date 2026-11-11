import type zhCN from './locales/zh-CN'

export type Messages = {
  [K in keyof typeof zhCN]: {
    [P in keyof (typeof zhCN)[K]]: string
  }
}

export type LocaleCode = 'zh-CN' | 'zh-TW' | 'en'

/** 点分路径，如 settings.language */
export type MessageKey = {
  [G in keyof Messages]: {
    [K in keyof Messages[G]]: `${G & string}.${K & string}`
  }[keyof Messages[G]]
}[keyof Messages]
