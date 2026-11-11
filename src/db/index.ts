/**
 * 旧版本机 IndexedDB。笔记已改存后端，这里只用于把旧数据导入公共原稿（见 legacy.ts）。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Asset, Database, DbRow, MetaRecord, Page } from '@/types'

interface GinkgoDB extends DBSchema {
  pages: {
    key: string
    value: Page
    indexes: { 'by-parent': string; 'by-updated': number }
  }
  assets: {
    key: string
    value: Asset
  }
  databases: {
    key: string
    value: Database
    indexes: { 'by-updated': number }
  }
  dbRows: {
    key: string
    value: DbRow
    indexes: { 'by-db': string }
  }
  meta: {
    key: string
    value: MetaRecord
  }
}

const DB_NAME = 'ginkgo-notes'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<GinkgoDB>> | null = null

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<GinkgoDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('pages')) {
          const store = db.createObjectStore('pages', { keyPath: 'id' })
          store.createIndex('by-parent', 'parentId')
          store.createIndex('by-updated', 'updatedAt')
        }
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' })
        }
        // v2：多维表格
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('databases')) {
            const dbs = db.createObjectStore('databases', { keyPath: 'id' })
            dbs.createIndex('by-updated', 'updatedAt')
          }
          if (!db.objectStoreNames.contains('dbRows')) {
            const rows = db.createObjectStore('dbRows', { keyPath: 'id' })
            rows.createIndex('by-db', 'dbId')
          }
        }
      },
    })
  }
  return dbPromise
}

export type { GinkgoDB }
