/** 页面拖拽共用 MIME：侧栏 / 子页面列表 ↔ 正文页面卡片 */
export const PAGE_DRAG_MIME = 'application/x-ginkgo-page'

export function setPageDragData(dt: DataTransfer, pageId: string) {
  dt.setData(PAGE_DRAG_MIME, pageId)
  dt.setData('text/plain', pageId)
  dt.effectAllowed = 'copyMove'
}

export function readPageDragId(dt: DataTransfer | null | undefined): string | null {
  if (!dt) return null
  const typed = dt.getData(PAGE_DRAG_MIME)?.trim()
  if (typed) return typed
  // 侧栏树目前只写了 text/plain
  const plain = dt.getData('text/plain')?.trim()
  if (plain && /^[A-Za-z0-9_-]{6,}$/.test(plain)) return plain
  return null
}

export function hasPageDrag(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false
  const types = Array.from(dt.types || [])
  return types.includes(PAGE_DRAG_MIME) || types.includes('text/plain')
}
