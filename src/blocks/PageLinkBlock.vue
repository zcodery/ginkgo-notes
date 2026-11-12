<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { FileText } from 'lucide-vue-next'
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
    class="pl-chip"
    :class="{ selected, missing }"
    as="span"
    @click="open"
  >
    <span class="pl-icon">
      <PageIcon v-if="page?.icon" :icon="page.icon" :size="14" />
      <FileText v-else :size="13" :stroke-width="1.8" />
    </span>
    <span class="pl-title">
      {{ missing ? '页面已删除' : page?.title || t('app.untitled') }}
    </span>
  </NodeViewWrapper>
</template>

<style scoped>
.pl-chip {
  display: inline-grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 4px;
  vertical-align: baseline;
  line-height: 1.6;
  height: 1.6em;
  padding: 0;
  margin: 0;
  border: none;
  border-bottom: 1px dashed currentColor;
  background: transparent;
  color: var(--gn-accent);
  font-size: inherit;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  max-width: 240px;
  transition: color 0.12s ease;
}
.pl-chip:hover {
  color: color-mix(in srgb, var(--gn-accent) 70%, var(--gn-text));
}
.pl-chip.selected {
  border-bottom-style: solid;
}
.pl-chip.missing {
  color: var(--gn-text-muted);
  font-style: italic;
}
.pl-icon {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 0;
  background: transparent;
  color: inherit;
}
.pl-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
