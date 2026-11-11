import { Mark, mergeAttributes } from '@tiptap/core'

/** 命名预设色 */
export const COLOR_PRESETS = [
  { key: 'gray', label: '灰色', swatch: '#787774' },
  { key: 'slate', label: '石板', swatch: '#64748b' },
  { key: 'brown', label: '棕色', swatch: '#9a6b4f' },
  { key: 'orange', label: '橙色', swatch: '#d9730d' },
  { key: 'amber', label: '琥珀', swatch: '#d4a017' },
  { key: 'yellow', label: '黄色', swatch: '#cb912f' },
  { key: 'lime', label: '青柠', swatch: '#6b9a23' },
  { key: 'green', label: '绿色', swatch: '#448361' },
  { key: 'emerald', label: '翠绿', swatch: '#0f7b6c' },
  { key: 'teal', label: '青绿', swatch: '#0f7a8a' },
  { key: 'cyan', label: '青色', swatch: '#0e8c9e' },
  { key: 'blue', label: '蓝色', swatch: '#337ea9' },
  { key: 'indigo', label: '靛蓝', swatch: '#4f5db3' },
  { key: 'purple', label: '紫色', swatch: '#9065b0' },
  { key: 'violet', label: '堇紫', swatch: '#7c5cbf' },
  { key: 'pink', label: '粉色', swatch: '#c14c8a' },
  { key: 'rose', label: '玫红', swatch: '#d44d6e' },
  { key: 'red', label: '红色', swatch: '#e03e3e' },
] as const

export type ColorPresetKey = (typeof COLOR_PRESETS)[number]['key']

/** 颜色值：命名预设，或自定义 #hex */
export type ColorValue = ColorPresetKey | string

const PRESET_KEYS = new Set<string>(COLOR_PRESETS.map((c) => c.key))

export function isPresetKey(v: string | null | undefined): v is ColorPresetKey {
  return !!v && PRESET_KEYS.has(v)
}

/** 规范化为 #rrggbb；非法则返回 null */
export function normalizeHex(input: string): string | null {
  let s = input.trim()
  if (!s) return null
  if (!s.startsWith('#')) s = `#${s}`
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]
    const g = s[2]
    const b = s[3]
    s = `#${r}${r}${g}${g}${b}${b}`
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null
  return s.toLowerCase()
}

/** 解析 data-color / data-bg 属性 */
export function parseColorAttr(raw: string | null): ColorValue | null {
  if (!raw) return null
  if (isPresetKey(raw)) return raw
  return normalizeHex(raw)
}

export function colorAttrValid(raw: string): boolean {
  return parseColorAttr(raw) != null
}

/** 用于 UI 预览的实色 */
export function resolveSwatch(color: ColorValue | null): string {
  if (!color) return 'transparent'
  if (isPresetKey(color)) {
    return COLOR_PRESETS.find((c) => c.key === color)?.swatch ?? color
  }
  return color
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontColor: {
      setFontColor: (color: ColorValue) => ReturnType
      unsetFontColor: () => ReturnType
    }
    bgColor: {
      setBgColor: (color: ColorValue) => ReturnType
      unsetBgColor: () => ReturnType
    }
  }
}

function fontRenderAttrs(color: ColorValue | null) {
  if (!color) return {}
  if (isPresetKey(color)) {
    return { 'data-color': color, class: `gn-fc gn-fc-${color}` }
  }
  return { 'data-color': color, style: `color: ${color}` }
}

function bgRenderAttrs(color: ColorValue | null) {
  if (!color) return {}
  if (isPresetKey(color)) {
    return { 'data-bg': color, class: `gn-bgc gn-bgc-${color}` }
  }
  return {
    'data-bg': color,
    style: `background-color: color-mix(in srgb, ${color} 22%, transparent); color: inherit`,
  }
}

export const FontColor = Mark.create({
  name: 'fontColor',
  inclusive: true,
  addAttributes() {
    return {
      color: {
        default: null as ColorValue | null,
        parseHTML: (el) => parseColorAttr(el.getAttribute('data-color')),
        renderHTML: (attrs) => fontRenderAttrs(attrs.color),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'span[data-color]' },
      {
        // 兼容粘贴进来的纯 style 色
        tag: 'span[style]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false
          if (el.getAttribute('data-color')) return false
          const c = normalizeHex(el.style.color || '')
          return c ? { color: c } : false
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
  addCommands() {
    return {
      setFontColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetFontColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

export const BgColor = Mark.create({
  name: 'bgColor',
  inclusive: true,
  addAttributes() {
    return {
      color: {
        default: null as ColorValue | null,
        parseHTML: (el) => parseColorAttr(el.getAttribute('data-bg')),
        renderHTML: (attrs) => bgRenderAttrs(attrs.color),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'mark[data-bg]' },
      { tag: 'span[data-bg]' },
      {
        tag: 'mark[style]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false
          if (el.getAttribute('data-bg')) return false
          const c = normalizeHex(el.style.backgroundColor || '')
          return c ? { color: c } : false
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0]
  },
  addCommands() {
    return {
      setBgColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetBgColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})
