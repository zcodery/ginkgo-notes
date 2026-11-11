<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import type { SlashItem } from './slashItems'

const props = defineProps<{
  visible: boolean
  /** 视口坐标：菜单用 position:fixed，避免被笔记滚动容器裁切 */
  x: number
  y: number
  maxHeight: number
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
  maxHeight: `${props.maxHeight}px`,
}))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="slash-menu gn-pop gn-scroll"
      :style="style"
      ref="listRef"
    >
      <template v-if="items.length">
        <div v-for="g in groups" :key="g.name" class="slash-group">
          <div class="slash-group-title">{{ g.name }}</div>
          <button
            v-for="row in g.list"
            :key="row.item.id"
            class="slash-item"
            v-tooltip="row.item.desc"
            :data-active="row.index === activeIndex"
            @mousedown.prevent="$emit('select', row.item)"
            @mouseenter="$emit('hover', row.index)"
          >
            <span class="slash-icon">
              <component :is="row.item.icon" :size="15" :stroke-width="1.8" />
            </span>
            <span class="slash-title">{{ row.item.title }}</span>
            <span class="slash-shortcut"><i>/</i>{{ row.item.shortcut }}</span>
          </button>
        </div>
      </template>
      <div v-else class="slash-empty">没有匹配的区块</div>
    </div>
  </Teleport>
</template>

<style scoped>
.slash-menu {
  position: fixed;
  z-index: 80;
  width: 248px;
  overflow-y: auto;
  padding: 4px 6px 6px;
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
  font-size: 12px;
  color: var(--gn-text-muted);
  padding: 7px 8px 5px;
}
.slash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 29px;
  padding: 0 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.slash-item[data-active='true'] {
  background: var(--gn-bg-hover);
}
.slash-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  flex: 0 0 auto;
  color: var(--gn-text-soft);
}
.slash-item[data-active='true'] .slash-icon {
  color: var(--gn-text);
}
.slash-title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--gn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slash-shortcut {
  flex: 0 0 auto;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
.slash-shortcut i {
  font-style: normal;
  color: var(--gn-accent);
  margin-right: 1px;
}
.slash-empty {
  padding: 14px 10px;
  font-size: 13px;
  color: var(--gn-text-muted);
  text-align: center;
}
</style>
