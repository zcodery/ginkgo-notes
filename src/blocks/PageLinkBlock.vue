<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { ChevronRight, FileText } from 'lucide-vue-next'
import PageIcon from '@/components/PageIcon.vue'
import { goToPage, store } from '@/store'
import { t } from '@/i18n'

const props = defineProps<{
  node: any
  selected: boolean
}>()

const pageId = computed(() => String(props.node?.attrs?.pageId ?? ''))
const page = computed(() => store.pages.find((p) => p.id === pageId.value && !p.trashed) ?? null)
const missing = computed(() => !!pageId.value && !page.value)

function open() {
  if (!page.value) return
  goToPage(page.value.id)
}
</script>

<template>
  <NodeViewWrapper
    class="pl-card"
    :class="{ selected, missing }"
    contenteditable="false"
    @click="open"
  >
    <span class="pl-icon">
      <PageIcon v-if="page?.icon" :icon="page.icon" :size="16" />
      <FileText v-else :size="15" :stroke-width="1.8" />
    </span>
    <span class="pl-title">
      {{ missing ? '页面已删除或不存在' : page?.title || t('app.untitled') }}
    </span>
    <ChevronRight class="pl-arrow" :size="14" :stroke-width="1.8" />
  </NodeViewWrapper>
</template>

<style scoped>
.pl-card {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  margin: 2px 0;
  padding: 6px 10px 6px 8px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg-sidebar);
  color: var(--gn-text);
  cursor: pointer;
  user-select: none;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}
.pl-card:hover {
  background: var(--gn-bg-hover);
  border-color: var(--gn-border-strong);
}
.pl-card.selected {
  border-color: color-mix(in srgb, var(--gn-accent) 55%, transparent);
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--gn-accent) 35%, transparent);
}
.pl-card.missing {
  color: var(--gn-text-muted);
  font-style: italic;
}
.pl-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: 5px;
  background: var(--gn-bg);
  color: var(--gn-text-muted);
}
.pl-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pl-arrow {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.pl-card:hover .pl-arrow {
  opacity: 1;
}
</style>
