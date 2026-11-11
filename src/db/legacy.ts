import { api, setApiSpace, type Space } from '@/api/client'
import { getDB } from './index'
import { putAsset } from './repo'

/**
 * 旧版数据迁移：之前的笔记存在本机浏览器的 IndexedDB（ginkgo-notes）里。
 * 管理员可以把它们一次性导入成「公共原稿」，之后新注册的用户都会收到副本。
 */

const LEGACY_DB_NAME = 'ginkgo-notes'
const IMPORTED_FLAG = 'ginkgo-legacy-imported'

async function legacyDbExists(): Promise<boolean> {
  // 直接 open 会在不存在时新建一个空库，所以先查列表
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false
  const list = await indexedDB.databases()
  return list.some((d) => d.name === LEGACY_DB_NAME)
}

export function legacyAlreadyImported(): boolean {
  try {
    return localStorage.getItem(IMPORTED_FLAG) === '1'
  } catch {
    return false
  }
}

/** 本机旧库里还有多少未删除的页面；没有旧库返回 0 */
export async function countLegacyPages(): Promise<number> {
  if (!(await legacyDbExists())) return 0
  const db = await getDB()
  const pages = await db.getAll('pages')
  return pages.filter((p) => !p.trashed).length
}

/**
 * 用本机旧笔记替换公共原稿。
 * 图片保持原 id 上传，正文里的 asset:<id> 引用无需改写。
 */
export async function importLegacyToPublic(currentSpace: Space): Promise<number> {
  const db = await getDB()
  const pages = (await db.getAll('pages')).filter((p) => !p.trashed)
  const databases = await db.getAll('databases')
  const rows = await db.getAll('dbRows')
  const assets = await db.getAll('assets')

  setApiSpace('public')
  try {
    for (const a of assets) await putAsset(a.blob, a.name, a.id)
    await api('POST', '/admin/import', { pages, databases, rows, replace: true })
  } finally {
    setApiSpace(currentSpace)
  }
  try {
    localStorage.setItem(IMPORTED_FLAG, '1')
  } catch {
    /* ignore */
  }
  return pages.length
}
