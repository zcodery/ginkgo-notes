<script setup lang="ts">
/**
 * 主页面与侧栏树的强关联：在正文底部列出当前页的直接子页面。
 * 新建子页也会落到这里，和侧栏「私人」树保持一致。
 */
import { computed, ref } from 'vue'
import { ChevronRight, Plus } from 'lucide-vue-next'
import PageIcon from '@/components/PageIcon.vue'
import { goToPage, reloadPages, store } from '@/store'
import { createPage } from '@/db/repo'

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
</script>

<template>
  <section v-if="children.length || editable" class="cp" aria-label="子页面">
    <div class="cp-head">
      <span class="cp-title">子页面</span>
      <span v-if="children.length" class="cp-count">{{ children.length }}</span>
    </div>

    <div class="cp-list">
      <button
        v-for="c in children"
        :key="c.id"
        type="button"
        class="cp-item"
        @click="goToPage(c.id)"
      >
        <span class="cp-icon">
          <PageIcon :icon="c.icon" :size="16" />
        </span>
        <span class="cp-name">{{ c.title || '未命名' }}</span>
        <ChevronRight class="cp-arrow" :size="14" :stroke-width="1.8" />
      </button>

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
        <span class="cp-name">{{ creating ? '创建中…' : '新建子页面' }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.cp {
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid var(--gn-border);
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
.cp-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
    border-color 0.12s ease;
}
.cp-item:hover {
  background: var(--gn-bg-hover);
}
.cp-item:hover .cp-arrow {
  opacity: 1;
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
