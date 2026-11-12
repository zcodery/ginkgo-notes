<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface TocItem {
  level: number
  text: string
  index: number
}

const props = defineProps<{
  items: TocItem[]
  scrollRoot: HTMLElement | null
}>()

const activeIndex = ref(0)
let observer: IntersectionObserver | null = null

const hasItems = computed(() => props.items.length > 0)

function headingEls(): HTMLElement[] {
  const root = props.scrollRoot
  if (!root) return []
  return Array.from(root.querySelectorAll('.note-editor .ProseMirror h1, .note-editor .ProseMirror h2, .note-editor .ProseMirror h3'))
}

function scrollTo(index: number) {
  const el = headingEls()[index]
  if (!el) return
  activeIndex.value = index
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function bindObserver() {
  observer?.disconnect()
  observer = null
  const root = props.scrollRoot
  if (!root) return
  const els = headingEls()
  if (!els.length) return
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (!visible.length) return
      const el = visible[0].target as HTMLElement
      const idx = els.indexOf(el)
      if (idx >= 0) activeIndex.value = idx
    },
    { root, rootMargin: '-12% 0px -70% 0px', threshold: [0, 1] },
  )
  for (const el of els) observer.observe(el)
}

watch(
  () => props.items,
  async () => {
    await nextTick()
    bindObserver()
  },
  { deep: true },
)

onMounted(async () => {
  await nextTick()
  bindObserver()
})

onBeforeUnmount(() => {
  observer?.disconnect()
})
</script>

<template>
  <aside class="page-toc">
    <nav v-if="hasItems" class="toc-nav">
      <button
        v-for="item in items"
        :key="item.index"
        class="toc-item"
        :class="[`lv-${item.level}`, { active: activeIndex === item.index }]"
        v-tooltip="item.text"
        @click="scrollTo(item.index)"
      >
        {{ item.text }}
      </button>
    </nav>
    <div v-else class="toc-empty">暂无标题</div>
  </aside>
</template>

<style scoped>
/* 跟在封面下方、正文右侧；内容高度 + 吸顶 */
.page-toc {
  position: sticky;
  top: 20px;
  z-index: 20;
  flex: 0 0 156px;
  width: 156px;
  max-height: calc(100dvh - 88px);
  margin-top: 36px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 2px 4px 24px 0;
  scrollbar-width: none;
}
.page-toc::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
.toc-empty {
  font-size: 12px;
  color: var(--gn-text-muted);
  padding: 4px 8px;
  opacity: 0.7;
}
.toc-nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.toc-item {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--gn-text-muted);
  font-size: 12.5px;
  line-height: 1.35;
  padding: 4px 8px;
  border-radius: 5px;
  border-left: 2px solid transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition:
    color 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease;
}
.toc-item:hover {
  color: var(--gn-text);
  background: var(--gn-bg-hover);
}
.toc-item.active {
  color: var(--gn-accent);
  border-left-color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.toc-item.lv-2 {
  padding-left: 16px;
}
.toc-item.lv-3 {
  padding-left: 24px;
  font-size: 12px;
}

@media (max-width: 960px) {
  .page-toc {
    display: none;
  }
}
</style>
