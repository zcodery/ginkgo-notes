<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import type { SlashItem } from './slashItems'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  items: SlashItem[]
  activeIndex: number
}>()

const listRef = ref<HTMLElement | null>(null)

const groups = computed(() => {
  const map = new Map<string, { item: SlashItem; index: number }[]>()
  props.items.forEach((item, index) => {
    if (!map.has(item.group)) map.set(item.group, [])
    map.get(item.group)!.push({ item, index })
  })
  return [...map.entries()].map(([name, list]) => ({ name, list }))
})

watch(
  () => props.activeIndex,
  async () => {
    await nextTick()
    const el = listRef.value?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  },
)

const style = computed(() => ({
  left: `${props.x}px`,
  top: `${props.y}px`,
}))
</script>

<template>
  <div v-if="visible" class="slash-menu gn-pop gn-scroll" :style="style" ref="listRef">
    <template v-if="items.length">
      <div v-for="g in groups" :key="g.name" class="slash-group">
        <div class="slash-group-title">{{ g.name }}</div>
        <button
          v-for="row in g.list"
          :key="row.item.id"
          class="slash-item"
          :data-active="row.index === activeIndex"
          @mousedown.prevent="$emit('select', row.item)"
          @mouseenter="$emit('hover', row.index)"
        >
          <span class="slash-icon">
            <component :is="row.item.icon" :size="16" :stroke-width="1.8" />
          </span>
          <span class="slash-text">
            <span class="slash-title">{{ row.item.title }}</span>
            <span class="slash-desc">{{ row.item.desc }}</span>
          </span>
        </button>
      </div>
    </template>
    <div v-else class="slash-empty">没有匹配的区块</div>
  </div>
</template>

<style scoped>
.slash-menu {
  position: absolute;
  z-index: 60;
  width: 292px;
  max-height: 328px;
  overflow-y: auto;
  padding: 5px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  box-shadow: var(--gn-shadow-lg);
}
.slash-group + .slash-group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--gn-border);
}
.slash-group-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--gn-text-muted);
  padding: 4px 8px;
  text-transform: uppercase;
}
.slash-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 5px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s ease;
}
.slash-item[data-active='true'] {
  background: var(--gn-bg-hover);
}
.slash-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: 6px;
  border: 1px solid var(--gn-border);
  background: var(--gn-bg);
  color: var(--gn-text-soft);
}
.slash-item[data-active='true'] .slash-icon {
  color: var(--gn-text);
  border-color: var(--gn-border-strong);
}
.slash-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.slash-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--gn-text);
  line-height: 1.3;
}
.slash-desc {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slash-empty {
  padding: 14px 10px;
  font-size: 13px;
  color: var(--gn-text-muted);
  text-align: center;
}
</style>
