<script setup lang="ts">
import { reactive, provide, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-vue-next'
import PageTreeItem from './PageTreeItem.vue'
import {
  store,
  tree,
  goToPage,
  reloadPages,
} from '@/store'
import {
  createPage,
  descendantIds,
  movePage,
  reorderSiblings,
  savePage,
  trashPage,
} from '@/db/repo'
import type { TreeNode } from '@/types'

const ctx = reactive({
  expanded: new Set<string>(),
  activeId: null as string | null,
  editingId: null as string | null,
  dragId: null as string | null,
  dropTarget: null as { id: string; mode: 'before' | 'after' | 'inside' } | null,

  select(id: string) {
    ctx.activeId = id
    ctx.persist()
    goToPage(id)
  },

  startRename(id: string) {
    ctx.editingId = id
  },

  async commitRename(id: string, title: string) {
    ctx.editingId = null
    const p = store.pages.find((x) => x.id === id)
    if (!p || p.title === title) return
    await savePage(id, { title })
    await reloadPages()
  },

  cancelRename() {
    ctx.editingId = null
  },

  async addChild(node: TreeNode) {
    const page = await createPage({ parentId: node.id })
    ctx.expanded.add(node.id)
    ctx.persist()
    await reloadPages()
    goToPage(page.id)
  },

  openMenu(e: MouseEvent, node: TreeNode) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    menu.node = node
    menu.x = rect.left + 12
    menu.y = rect.bottom + 4
    menu.open = true
  },

  endDrag() {
    ctx.dragId = null
    ctx.dropTarget = null
  },

  async commitDrop(target: TreeNode) {
    const dragId = ctx.dragId
    const mode = ctx.dropTarget?.mode
    ctx.endDrag()
    if (!dragId || !mode || dragId === target.id) return

    const all = store.pages
    if (descendantIds(all, dragId).includes(target.id)) return

    if (mode === 'inside') {
      const kids = all.filter((p) => p.parentId === target.id && !p.trashed)
      const maxOrder = kids.reduce((m, p) => Math.max(m, p.order), 0)
      await movePage(dragId, target.id, maxOrder + 1)
      ctx.expanded.add(target.id)
    } else {
      const parentId = target.parentId
      const siblings = all
        .filter((p) => p.parentId === parentId && !p.trashed && p.id !== dragId)
        .sort((a, b) => a.order - b.order)
      const idx = siblings.findIndex((p) => p.id === target.id)
      const insertAt = mode === 'before' ? idx : idx + 1
      siblings.splice(insertAt, 0, { ...target, id: dragId } as any)
      await reorderSiblings(siblings.map((p) => p.id))
      const dragged = all.find((p) => p.id === dragId)
      if (dragged && dragged.parentId !== parentId) await movePage(dragId, parentId, 0)
    }
    await reloadPages()
  },

  persist() {
    try {
      localStorage.setItem('ginkgo-expanded', JSON.stringify([...ctx.expanded]))
    } catch {
      /* ignore */
    }
  },
})

provide('pageTree', ctx)

/** 跟当前路由同步高亮；从搜索/面包屑/新建进入时也要亮起来 */
watch(
  () => store.route.pageId,
  (id) => {
    ctx.activeId = id
    if (!id) return
    // 展开祖先，保证嵌套页的聚焦项可见
    let cur = store.pages.find((p) => p.id === id)
    while (cur?.parentId) {
      ctx.expanded.add(cur.parentId)
      cur = store.pages.find((p) => p.id === cur!.parentId)
    }
    ctx.persist()
  },
  { immediate: true },
)

const menu = reactive({ open: false, x: 0, y: 0, node: null as TreeNode | null })

async function onMenuAction(action: string) {
  const node = menu.node
  menu.open = false
  if (!node) return
  if (action === 'rename') {
    ctx.editingId = node.id
  } else if (action === 'child') {
    await ctx.addChild(node)
  } else if (action === 'favorite') {
    await savePage(node.id, { favorite: !node.favorite })
    await reloadPages()
  } else if (action === 'delete') {
    await trashPage(node.id)
    await reloadPages()
    if (store.route.pageId === node.id) goToPage('')
  }
}

function onGlobalDown(e: MouseEvent) {
  const el = document.querySelector('.pt-menu')
  if (menu.open && !el?.contains(e.target as Node)) menu.open = false
}

onMounted(() => {
  try {
    const raw = localStorage.getItem('ginkgo-expanded')
    if (raw) JSON.parse(raw).forEach((id: string) => ctx.expanded.add(id))
  } catch {
    /* ignore */
  }
  document.addEventListener('mousedown', onGlobalDown)
})

onBeforeUnmount(() => document.removeEventListener('mousedown', onGlobalDown))

async function newPage() {
  const page = await createPage({ parentId: null })
  await reloadPages()
  goToPage(page.id)
}

defineExpose({ newPage })
</script>

<template>
  <div class="pt-root">
    <div class="pt-list">
      <PageTreeItem v-for="node in tree" :key="node.id" :node="node" :depth="0" />
      <div v-if="!tree.length" class="pt-empty">还没有页面，点击上方 + 新建</div>
    </div>

    <div
      v-if="menu.open"
      class="pt-menu gn-pop"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
    >
      <button @click="onMenuAction('rename')">
        <Pencil :size="14" :stroke-width="1.8" /><span>重命名</span>
      </button>
      <button @click="onMenuAction('child')">
        <Plus :size="14" :stroke-width="1.8" /><span>新建子页面</span>
      </button>
      <button @click="onMenuAction('favorite')">
        <component
          :is="menu.node?.favorite ? StarOff : Star"
          :size="14"
          :stroke-width="1.8"
        />
        <span>{{ menu.node?.favorite ? '取消收藏' : '收藏' }}</span>
      </button>
      <div class="pt-menu-sep"></div>
      <button class="danger" @click="onMenuAction('delete')">
        <Trash2 :size="14" :stroke-width="1.8" /><span>移到回收站</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pt-root {
  position: relative;
}
.pt-list {
  padding-bottom: 8px;
}
.pt-empty {
  padding: 10px 14px;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
.pt-menu {
  position: fixed;
  z-index: 200;
  width: 176px;
  padding: 5px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  box-shadow: var(--gn-shadow-lg);
}
.pt-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  color: var(--gn-text-soft);
  text-align: left;
  cursor: pointer;
}
.pt-menu button:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.pt-menu button.danger {
  color: var(--gn-danger);
}
.pt-menu button.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
}
.pt-menu-sep {
  height: 1px;
  margin: 4px 3px;
  background: var(--gn-border);
}
</style>
