import type { Component } from 'vue'
import {
  Type,
  Hash,
  CircleDot,
  Tags,
  Calendar,
  SquareCheck,
  Link2,
} from 'lucide-vue-next'
import type { DbField, DbRow, DbView, FieldType, FilterOp, FieldOption } from '@/types'

export const FIELD_TYPE_META: Record<
  FieldType,
  { label: string; icon: Component; hint: string }
> = {
  text: { label: '文本', icon: Type, hint: '任意文字' },
  number: { label: '数字', icon: Hash, hint: '可参与排序与计算' },
  select: { label: '单选', icon: CircleDot, hint: '只能选一个选项，可作看板分组' },
  multiSelect: { label: '多选', icon: Tags, hint: '可以选多个标签' },
  date: { label: '日期', icon: Calendar, hint: 'YYYY-MM-DD' },
  checkbox: { label: '复选框', icon: SquareCheck, hint: '是 / 否' },
  url: { label: '链接', icon: Link2, hint: '网址，点击可打开' },
}

export const FIELD_TYPE_ORDER: FieldType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
]

export const OPTION_COLORS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const

export function optionOf(field: DbField | undefined, id: unknown): FieldOption | undefined {
  if (!field || typeof id !== 'string') return undefined
  return field.options?.find((o) => o.id === id)
}

/** 单元格的纯文本表示（用于搜索、导出、看板卡片） */
export function cellText(field: DbField, value: unknown): string {
  if (value == null || value === '') return ''
  switch (field.type) {
    case 'select':
      return optionOf(field, value)?.name ?? ''
    case 'multiSelect':
      return Array.isArray(value)
        ? value.map((id) => optionOf(field, id)?.name ?? '').filter(Boolean).join('、')
        : ''
    case 'checkbox':
      return value ? '是' : '否'
    case 'number':
      return typeof value === 'number' ? String(value) : String(value)
    default:
      return String(value)
  }
}

export function isEmptyValue(field: DbField, value: unknown): boolean {
  if (field.type === 'checkbox') return value !== true
  if (field.type === 'multiSelect') return !Array.isArray(value) || value.length === 0
  return value == null || value === ''
}

export function compareValues(field: DbField, a: unknown, b: unknown): number {
  const ea = isEmptyValue(field, a)
  const eb = isEmptyValue(field, b)
  if (ea && eb) return 0
  if (ea) return 1
  if (eb) return -1
  if (field.type === 'number') return Number(a) - Number(b)
  if (field.type === 'checkbox') return (a ? 1 : 0) - (b ? 1 : 0)
  return cellText(field, a).localeCompare(cellText(field, b), 'zh-Hans-CN')
}

/* ---------------- 筛选 ---------------- */

export function opsForType(type: FieldType): { op: FilterOp; label: string }[] {
  switch (type) {
    case 'number':
      return [
        { op: 'eq', label: '等于' },
        { op: 'neq', label: '不等于' },
        { op: 'gt', label: '大于' },
        { op: 'lt', label: '小于' },
        { op: 'isEmpty', label: '为空' },
        { op: 'isNotEmpty', label: '不为空' },
      ]
    case 'checkbox':
      return [
        { op: 'checked', label: '已勾选' },
        { op: 'unchecked', label: '未勾选' },
      ]
    case 'select':
      return [
        { op: 'is', label: '是' },
        { op: 'isNot', label: '不是' },
        { op: 'isEmpty', label: '为空' },
        { op: 'isNotEmpty', label: '不为空' },
      ]
    default:
      return [
        { op: 'contains', label: '包含' },
        { op: 'notContains', label: '不包含' },
        { op: 'is', label: '是' },
        { op: 'isNot', label: '不是' },
        { op: 'isEmpty', label: '为空' },
        { op: 'isNotEmpty', label: '不为空' },
      ]
  }
}

function matchFilter(field: DbField, row: DbRow, op: FilterOp, value: string): boolean {
  const raw = row.cells[field.id]
  const empty = isEmptyValue(field, raw)

  switch (op) {
    case 'isEmpty':
      return empty
    case 'isNotEmpty':
      return !empty
    case 'checked':
      return raw === true
    case 'unchecked':
      return raw !== true
    default:
      break
  }
  if (empty) return false

  if (field.type === 'select') {
    if (op === 'is') return raw === value
    if (op === 'isNot') return raw !== value
    const name = optionOf(field, raw)?.name ?? ''
    if (op === 'contains') return name.includes(value)
    if (op === 'notContains') return !name.includes(value)
    return true
  }

  if (field.type === 'multiSelect') {
    const ids = Array.isArray(raw) ? (raw as string[]) : []
    const names = ids.map((id) => optionOf(field, id)?.name ?? '')
    const hit = ids.includes(value) || names.some((n) => n.includes(value))
    if (op === 'is') return ids.includes(value)
    if (op === 'isNot') return !ids.includes(value)
    if (op === 'contains') return hit
    if (op === 'notContains') return !hit
    return true
  }

  if (field.type === 'number') {
    const n = Number(raw)
    const v = Number(value)
    if (Number.isNaN(v)) return true
    if (op === 'eq') return n === v
    if (op === 'neq') return n !== v
    if (op === 'gt') return n > v
    if (op === 'lt') return n < v
    return true
  }

  const text = cellText(field, raw)
  if (op === 'is') return text === value
  if (op === 'isNot') return text !== value
  if (op === 'contains') return text.toLowerCase().includes(value.toLowerCase())
  if (op === 'notContains') return !text.toLowerCase().includes(value.toLowerCase())
  return true
}

/** 按视图的筛选 + 排序，算出最终要渲染的行 */
export function applyView(rows: DbRow[], fields: DbField[], view: DbView | null): DbRow[] {
  if (!view) return rows
  let out = rows

  const filters = view.filters.filter((f) => fields.some((x) => x.id === f.fieldId))
  if (filters.length) {
    out = out.filter((row) =>
      filters.every((f) => {
        const field = fields.find((x) => x.id === f.fieldId)!
        return matchFilter(field, row, f.op, f.value)
      }),
    )
  }

  const sorts = view.sorts.filter((s) => fields.some((x) => x.id === s.fieldId))
  if (sorts.length) {
    out = [...out].sort((a, b) => {
      for (const s of sorts) {
        const field = fields.find((x) => x.id === s.fieldId)!
        const r = compareValues(field, a.cells[field.id], b.cells[field.id])
        if (r) return s.dir === 'asc' ? r : -r
      }
      return 0
    })
  }

  return out
}

/** 某个字段在数据里出现过的选项（含未被定义为选项的历史值） */
export function usedOptions(rows: DbRow[], field: DbField): FieldOption[] {
  const set = new Set<string>()
  for (const r of rows) {
    const v = r.cells[field.id]
    if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && set.add(x))
    else if (typeof v === 'string') set.add(v)
  }
  return (field.options ?? []).filter((o) => set.has(o.id))
}
