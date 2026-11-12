<script setup lang="ts">
/**
 * 正文底部的子页面管理：新建、排序，以及从侧栏拖入成为子页。
 * 子页也可拖到正文，插入为页面卡片。
 */
import { computed, ref } from 'vue'
import { ChevronRight, Plus } from 'lucide-vue-next'
import PageIcon from '@/components/PageIcon.vue'
import { goToPage, reloadPages, store } from '@/store'
import { createPage, movePage, reorderSiblings } from '@/db/repo'
import { hasPageDrag, readPageDragId, setPageDragData } from '@/editor/pageDrag'
import { t } from '@/i18n'

const props = defineProps<{
  pageId: string
  editable?: boolean
}>()

const children = computed(() =>
  store.pages
    .filter((p) => p.parentId === props.pageId && !p.trashed)
    .slice()
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
)

const creating = ref(false)
const dragId = ref<string | null>(null)
const dropOver = ref(false)
const dropIndex = ref<number | null>(null)

async function addChild() {
  if (!props.editable || creating.value) return
  creating.value = true
  try {
    const page = await createPage({ parentId: props.pageId, title: '' })
    await reloadPages()
    goToPage(page.id)
  } finally {
    creating.value = false
  }
}

function onItemDragStart(e: DragEvent, id: string) {
  if (!props.editable) {
    e.preventDefault()
    return
  }
  dragId.value = id
  if (e.dataTransfer) setPageDragData(e.dataTransfer, id)
}

function onItemDragEnd() {
  dragId.value = null
  dropIndex.value = null
  dropOver.value = false
}

function onListDragOver(e: DragEvent) {
  if (!props.editable || !hasPageDrag(e.dataTransfer)) return
  e.preventDefault()
  e.dataTransfer && (e.dataTransfer.dropEffect = 'move')
  dropOver.value = true

  const list = e.currentTarget as HTMLElement
  const items = Array.from(list.querySelectorAll<HTMLElement>('[data-child-id]'))
  if (!items.length) {
    dropIndex.value = 0
    return
  }
  let idx = items.length
  for (let i = 0; i < items.length; i++) {
    const r = items[i]!.getBoundingClientRect()
    if (e.clientY < r.top + r.height / 2) {
      idx = i
      break
    }
  }
  dropIndex.value = idx
}

function onListDragLeave(e: DragEvent) {
  const list = e.currentTarget as HTMLElement
  if (e.relatedTarget instanceof Node && list.contains(e.relatedTarget)) return
  dropOver.value = false
  dropIndex.value = null
}

async function onListDrop(e: DragEvent) {
  if (!props.editable) return
  e.preventDefault()
  e.stopPropagation()
  const id = readPageDragId(e.dataTransfer)
  const at = dropIndex.value
  dropOver.value = false
  dropIndex.value = null
  dragId.value = null
  if (!id || id === props.pageId) return

  const siblings = children.value.map((c) => c.id).filter((x) => x !== id)
  const insertAt = Math.max(0, Math.min(at ?? siblings.length, siblings.length))
  siblings.splice(insertAt, 0, id)

  const page = store.pages.find((p) => p.id === id)
  if (!page || page.trashed) return
  if (page.parentId !== props.pageId) {
    await movePage(id, props.pageId, insertAt + 1)
  }
  await reorderSiblings(siblings)
  await reloadPages()
}
</script>

<template>
  <section
    v-if="children.length || editable"
    class="cp"
    :class="{ 'drop-over': dropOver }"
    :aria-label="t('childPages.title')"
  >
    <div class="cp-head">
      <span class="cp-title">{{ t('childPages.title') }}</span>
      <span v-if="children.length" class="cp-count">{{ children.length }}</span>
      <span v-if="editable" class="cp-hint">{{ t('childPages.dragHint') }}</span>
    </div>

    <div
      class="cp-list"
      @dragover="onListDragOver"
      @dragleave="onListDragLeave"
      @drop="onListDrop"
    >
      <div
        v-if="dropOver && dropIndex === 0"
        class="cp-drop-line"
      ></div>
      <template v-for="(c, i) in children" :key="c.id">
        <button
          type="button"
          class="cp-item"
          :class="{ dragging: dragId === c.id }"
          :data-child-id="c.id"
          :draggable="!!editable"
          @click="goToPage(c.id)"
          @dragstart="onItemDragStart($event, c.id)"
          @dragend="onItemDragEnd"
        >
          <span class="cp-icon">
            <PageIcon :icon="c.icon" :size="16" />
          </span>
          <span class="cp-name">{{ c.title || t('app.untitled') }}</span>
          <ChevronRight class="cp-arrow" :size="14" :stroke-width="1.8" />
        </button>
        <div
          v-if="dropOver && dropIndex === i + 1"
          class="cp-drop-line"
        ></div>
      </template>

      <button
        v-if="editable"
        type="button"
        class="cp-item add"
        :disabled="creating"
        @click="addChild"
      >
        <span class="cp-icon plus">
          <Plus :size="14" :stroke-width="2.2" />
        </span>
        <span class="cp-name">{{ creating ? t('childPages.creating') : t('childPages.new') }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.cp {
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid var(--gn-border);
  border-radius: 0;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
.cp.drop-over {
  background: color-mix(in srgb, var(--gn-accent) 6%, transparent);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--gn-accent) 40%, transparent);
  border-radius: 10px;
  padding: 18px 8px 8px;
  margin-left: -8px;
  margin-right: -8px;
}
.cp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 0 2px;
}
.cp-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--gn-text-muted);
}
.cp-count {
  font-size: 11px;
  color: var(--gn-text-muted);
  padding: 0 6px;
  height: 16px;
  line-height: 16px;
  border-radius: 999px;
  background: var(--gn-bg-hover);
}
.cp-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--gn-text-muted);
  opacity: 0.85;
}
.cp-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 40px;
}
.cp-drop-line {
  height: 2px;
  margin: 1px 6px;
  border-radius: 2px;
  background: var(--gn-accent);
}
.cp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 4px 8px 4px 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--gn-text);
  font-size: 14px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    opacity 0.12s ease;
}
.cp-item:hover {
  background: var(--gn-bg-hover);
}
.cp-item:hover .cp-arrow {
  opacity: 1;
}
.cp-item.dragging {
  opacity: 0.45;
}
.cp-item.add {
  color: var(--gn-text-muted);
}
.cp-item.add:hover {
  color: var(--gn-text-soft);
}
.cp-item:disabled {
  opacity: 0.55;
  cursor: default;
}
.cp-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: 5px;
  background: var(--gn-bg-sidebar);
}
.cp-icon.plus {
  background: transparent;
  border: 1px dashed var(--gn-border-strong);
  color: var(--gn-text-muted);
}
.cp-name {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-arrow {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  opacity: 0;
  transition: opacity 0.12s ease;
}
</style>
