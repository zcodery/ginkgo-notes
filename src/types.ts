export interface Page {
  id: string
  title: string
  icon: string
  parentId: string | null
  /** Markdown 原文 —— 这是笔记的底层真实数据 */
  content: string
  /** 纯文本摘要，用于搜索与列表展示 */
  excerpt: string
  favorite: boolean
  trashed: boolean
  trashedAt: number | null
  createdAt: number
  updatedAt: number
  order: number
  /** 封面：`gradient:<预设 id>` 或 `asset:<图片 id>` */
  cover: string | null
  /** 页面级评论，旧数据没有此字段 */
  comments?: PageComment[]
  /** 锁定后页面只读，不可编辑 */
  locked?: boolean
  /** 服务端乐观锁版本；读取时由后端注入 */
  version?: number
}

export interface PageComment {
  id: string
  author: string
  text: string
  createdAt: number
}

export interface Asset {
  id: string
  blob: Blob
  name: string
  type: string
  size: number
  createdAt: number
}

export interface MetaRecord {
  key: string
  value: unknown
}

export interface TreeNode extends Page {
  children: TreeNode[]
  depth: number
}

/* ============================================================
 *  多维表格（Database）
 *
 *  它是一份独立实体，而不是页面正文的一部分：
 *  正文里只留一个引用（```ginkgo-db <id>），
 *  这样同一张表可以被多个页面嵌入，编辑后处处同步。
 * ============================================================ */

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'date'
  | 'checkbox'
  | 'url'

export interface FieldOption {
  id: string
  name: string
  /** 颜色键，见 dbTypes.ts 里的 OPTION_COLORS */
  color: string
}

export interface DbField {
  id: string
  name: string
  type: FieldType
  options?: FieldOption[]
  /** 数字/日期列宽，单位 px */
  width?: number
}

export type ViewType = 'table' | 'board'

export type FilterOp =
  | 'contains'
  | 'notContains'
  | 'is'
  | 'isNot'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'lt'
  | 'eq'
  | 'neq'
  | 'checked'
  | 'unchecked'

export interface DbFilter {
  id: string
  fieldId: string
  op: FilterOp
  value: string
}

export interface DbSort {
  fieldId: string
  dir: 'asc' | 'desc'
}

export interface DbView {
  id: string
  name: string
  type: ViewType
  /** 看板视图按哪个单选字段分组 */
  groupBy: string | null
  filters: DbFilter[]
  sorts: DbSort[]
  hiddenFields: string[]
}

export interface Database {
  id: string
  title: string
  icon: string
  fields: DbField[]
  views: DbView[]
  /** 上次停留的视图，重新打开时恢复 */
  lastViewId?: string
  createdAt: number
  updatedAt: number
}

export interface DbRow {
  id: string
  dbId: string
  /** fieldId → 值。text/url/date 为 string，number 为 number，checkbox 为 boolean，
   *  select 为 optionId，multiSelect 为 optionId[] */
  cells: Record<string, unknown>
  order: number
  createdAt: number
  updatedAt: number
}
