import { TableCell, TableHeader } from '@tiptap/extension-table'
import { COLOR_PRESETS, isPresetKey } from '../marks/colors'

export type CellAlign = 'left' | 'center' | 'right'

/** 单元格背景用预设色的浅色版本，深浅主题下都柔和 */
export function cellBgCss(key: string): string | null {
  if (!isPresetKey(key)) return null
  const swatch = COLOR_PRESETS.find((c) => c.key === key)!.swatch
  return `color-mix(in srgb, ${swatch} 16%, transparent)`
}

const cellAttributes = {
  bg: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-bg'),
    renderHTML: (attrs: Record<string, unknown>) => {
      const css = typeof attrs.bg === 'string' ? cellBgCss(attrs.bg) : null
      return css ? { 'data-bg': attrs.bg, style: `background-color: ${css}` } : {}
    },
  },
  align: {
    default: null as CellAlign | null,
    parseHTML: (el: HTMLElement) => {
      const v = el.style.textAlign || el.getAttribute('align')
      return v === 'left' || v === 'center' || v === 'right' ? v : null
    },
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.align ? { style: `text-align: ${attrs.align}` } : {},
  },
}

export const GnTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes }
  },
})

export const GnTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes }
  },
})
