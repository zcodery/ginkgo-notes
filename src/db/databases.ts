import { api, apiMaybe } from '@/api/client'
import { listPages, serial, uid } from './repo'
import type {
  Database,
  DbField,
  DbRow,
  DbView,
  FieldOption,
  FieldType,
  ViewType,
} from '@/types'

/* ============================================================
 *  多维表格数据访问
 * ============================================================ */

/** Vue 的 reactive 代理对象先转成普通对象再提交 */
function plain<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function newField(
  name: string,
  type: FieldType = 'text',
  options?: FieldOption[],
): DbField {
  const f: DbField = { id: 'f_' + uid().slice(0, 8), name, type }
  if (type === 'select' || type === 'multiSelect') {
    f.options = options ?? [
      { id: 'o_' + uid().slice(0, 8), name: '选项 1', color: 'blue' },
      { id: 'o_' + uid().slice(0, 8), name: '选项 2', color: 'green' },
    ]
  }
  return f
}

export function newView(name: string, type: ViewType, groupBy: string | null = null): DbView {
  return {
    id: 'v_' + uid().slice(0, 8),
    name,
    type,
    groupBy,
    filters: [],
    sorts: [],
    hiddenFields: [],
  }
}

async function putDatabase(database: Database): Promise<void> {
  await api('PUT', `/databases/${encodeURIComponent(database.id)}`, plain(database))
}

async function putRow(row: DbRow): Promise<void> {
  await api('PUT', `/rows/${encodeURIComponent(row.id)}`, plain(row))
}

async function batchRows(upsert: DbRow[], remove: string[] = []): Promise<void> {
  if (!upsert.length && !remove.length) return
  await api('POST', '/rows/batch', { upsert: plain(upsert), remove })
}

/** 对同一张表的「读 → 改 → 写」串行执行 */
function updateDatabase(
  id: string,
  change: (cur: Database) => Database,
): Promise<void> {
  return serial(`db:${id}`, async () => {
    const cur = await getDatabase(id)
    if (!cur) return
    await putDatabase({ ...change(cur), updatedAt: Date.now() })
  })
}

/** 新建一张表：默认列（可选示例行） */
export async function createDatabase(
  init: Partial<Database> = {},
  withSample = false,
): Promise<Database> {
  const now = Date.now()
  const fields =
    init.fields ??
    ([
      newField('名称'),
      newField('状态', 'select', [
        { id: 'o_todo', name: '待开始', color: 'gray' },
        { id: 'o_doing', name: '进行中', color: 'blue' },
        { id: 'o_done', name: '已完成', color: 'green' },
      ]),
      newField('优先级', 'select', [
        { id: 'o_p0', name: 'P0', color: 'red' },
        { id: 'o_p1', name: 'P1', color: 'orange' },
        { id: 'o_p2', name: 'P2', color: 'gray' },
      ]),
      newField('截止日期', 'date'),
      newField('完成', 'checkbox'),
    ] as DbField[])

  const database: Database = {
    id: 'db_' + uid().slice(0, 10),
    title: init.title ?? '未命名多维表格',
    icon: init.icon ?? '🗂️',
    fields,
    views: init.views ?? [
      newView('表格', 'table'),
      newView('看板', 'board', fields.find((f) => f.type === 'select')?.id ?? null),
    ],
    createdAt: now,
    updatedAt: now,
  }
  await putDatabase(database)

  if (init.fields === undefined && withSample) {
    const seed = [
      { 名称: '梳理需求', 状态: 'o_todo', 优先级: 'o_p0' },
      { 名称: '画一版原型', 状态: 'o_doing', 优先级: 'o_p1' },
      { 名称: '写完第一篇笔记', 状态: 'o_done', 优先级: 'o_p2' },
    ]
    const rows: DbRow[] = seed.map((s, i) => {
      const cells: Record<string, unknown> = {}
      for (const f of fields) {
        if (f.type !== 'select') continue
        const v = (s as any)[f.name]
        if (v) cells[f.id] = v
      }
      cells[fields[0].id] = (s as any)[fields[0].name] ?? ''
      return {
        id: 'r_' + uid().slice(0, 10),
        dbId: database.id,
        cells,
        order: i + 1,
        createdAt: now,
        updatedAt: now,
      }
    })
    await batchRows(rows)
  }
  return database
}

export async function getDatabase(id: string): Promise<Database | undefined> {
  return apiMaybe<Database>('GET', `/databases/${encodeURIComponent(id)}`)
}

export async function listDatabases(): Promise<Database[]> {
  return api<Database[]>('GET', '/databases')
}

export function saveDatabase(id: string, patch: Partial<Database>): Promise<void> {
  return updateDatabase(id, (cur) => ({ ...cur, ...plain(patch) }))
}

export async function deleteDatabase(id: string): Promise<void> {
  await api('DELETE', `/databases/${encodeURIComponent(id)}`)
}

/* ---------------- 行 ---------------- */

export async function listRows(dbId: string): Promise<DbRow[]> {
  const rows = await api<DbRow[]>('GET', `/databases/${encodeURIComponent(dbId)}/rows`)
  return rows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

export function addRow(
  dbId: string,
  cells: Record<string, unknown> = {},
  afterOrder?: number,
): Promise<DbRow> {
  return serial(`rows:${dbId}`, async () => {
    const rows = await listRows(dbId)
    const now = Date.now()
    let order: number
    const shifted: DbRow[] = []
    if (afterOrder != null) {
      // 插到指定位置后面，其余行顺延
      const tail = rows.filter((r) => r.order > afterOrder).sort((a, b) => a.order - b.order)
      let cur = Math.ceil(afterOrder + 0.5)
      for (const r of tail) shifted.push({ ...r, order: ++cur + 0.5 })
      order = afterOrder + 0.5
    } else {
      order = rows.reduce((m, r) => Math.max(m, r.order), 0) + 1
    }
    const row: DbRow = {
      id: 'r_' + uid().slice(0, 10),
      dbId,
      cells: plain(cells),
      order,
      createdAt: now,
      updatedAt: now,
    }
    await batchRows([...shifted, row])
    return row
  })
}

function getRow(rowId: string): Promise<DbRow | undefined> {
  return apiMaybe<DbRow>('GET', `/rows/${encodeURIComponent(rowId)}`)
}

export function updateRow(rowId: string, cells: Record<string, unknown>): Promise<void> {
  return serial(`row:${rowId}`, async () => {
    const cur = await getRow(rowId)
    if (!cur) return
    await putRow({ ...cur, cells: { ...cur.cells, ...plain(cells) }, updatedAt: Date.now() })
  })
}

export async function deleteRow(rowId: string): Promise<void> {
  await api('DELETE', `/rows/${encodeURIComponent(rowId)}`)
}

export async function reorderRows(rows: { id: string; order: number }[]): Promise<void> {
  if (!rows.length) return
  const first = await getRow(rows[0].id)
  if (!first) return
  const all = await listRows(first.dbId)
  const byId = new Map(all.map((r) => [r.id, r]))
  const upsert: DbRow[] = []
  for (const r of rows) {
    const cur = byId.get(r.id)
    if (cur) upsert.push({ ...cur, order: r.order })
  }
  await batchRows(upsert)
}

/* ---------------- 字段操作 ---------------- */

export function addField(dbId: string, field: DbField): Promise<void> {
  return updateDatabase(dbId, (cur) => ({ ...cur, fields: [...cur.fields, plain(field)] }))
}

export function updateField(dbId: string, field: DbField): Promise<void> {
  return updateDatabase(dbId, (cur) => ({
    ...cur,
    fields: cur.fields.map((f) => (f.id === field.id ? plain(field) : f)),
  }))
}

export function removeField(dbId: string, fieldId: string): Promise<void> {
  return updateDatabase(dbId, (cur) => ({
    ...cur,
    fields: cur.fields.filter((f) => f.id !== fieldId),
    views: cur.views.map((v) => ({
      ...v,
      hiddenFields: v.hiddenFields.filter((id) => id !== fieldId),
      groupBy: v.groupBy === fieldId ? null : v.groupBy,
      filters: v.filters.filter((f) => f.fieldId !== fieldId),
      sorts: v.sorts.filter((s) => s.fieldId !== fieldId),
    })),
  }))
}

export function saveViews(dbId: string, views: DbView[]): Promise<void> {
  return updateDatabase(dbId, (cur) => ({ ...cur, views: plain(views) }))
}

/* ---------------- 页面引用 ---------------- */

const DB_REF_RE = /```ginkgo-db[^\n]*\n([\s\S]*?)```/g

/** 页面正文里引用了哪些数据库 */
export function databaseRefs(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(DB_REF_RE)) {
    const id = m[1].trim().split('\n')[0].trim()
    if (id) out.push(id)
  }
  return out
}

/** 记录所有页面 → 数据库的引用关系，用于「这表被哪些页面用了」 */
export async function findDatabaseUsage(dbId: string): Promise<{ id: string; title: string }[]> {
  const pages = await listPages()
  return pages
    .filter((p) => !p.trashed && databaseRefs(p.content).includes(dbId))
    .map((p) => ({ id: p.id, title: p.title || '未命名' }))
}

/** 清理没有任何页面引用的表（删除页面后调用） */
export async function gcDatabases(): Promise<number> {
  const pages = await listPages()
  const used = new Set<string>()
  for (const p of pages) {
    if (p.trashed) continue
    for (const id of databaseRefs(p.content)) used.add(id)
  }
  let n = 0
  for (const d of await listDatabases()) {
    if (!used.has(d.id)) {
      await deleteDatabase(d.id)
      n++
    }
  }
  return n
}

/* ---------------- 全库备份 / 还原 ---------------- */

export async function exportDatabaseData(): Promise<{ databases: Database[]; rows: DbRow[] }> {
  const databases = await listDatabases()
  const rows = (await Promise.all(databases.map((d) => listRows(d.id)))).flat()
  return { databases, rows }
}

export async function importDatabaseData(databases: Database[], rows: DbRow[]): Promise<void> {
  for (const d of databases) await putDatabase(d)
  await batchRows(rows)
}
