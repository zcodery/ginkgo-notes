import { computed } from 'vue'
import { store } from '@/store'

/**
 * NodeView 跑在 TipTap 单独挂载的 Vue 应用里，拿不到 BlockEditor 的 provide。
 * 因此以当前路由页的 locked 为准（与 NoteView.canEdit 一致）。
 */
export function useEditorEditable() {
  return computed(() => {
    if (store.route.view !== 'note' || !store.route.pageId) return true
    const page = store.pages.find((p) => p.id === store.route.pageId)
    return !page?.locked
  })
}
