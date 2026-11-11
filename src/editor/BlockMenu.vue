<script setup lang="ts">
import { computed } from 'vue'
import {
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
} from 'lucide-vue-next'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
}>()

const emit = defineEmits<{ (e: 'action', type: string): void }>()

const style = computed(() => ({ left: `${props.x}px`, top: `${props.y}px` }))

const turnInto = [
  { type: 'paragraph', label: '正文', icon: Type },
  { type: 'h1', label: '一级标题', icon: Heading1 },
  { type: 'h2', label: '二级标题', icon: Heading2 },
  { type: 'h3', label: '三级标题', icon: Heading3 },
  { type: 'bulletList', label: '无序列表', icon: List },
  { type: 'orderedList', label: '有序列表', icon: ListOrdered },
  { type: 'taskList', label: '待办清单', icon: ListChecks },
  { type: 'blockquote', label: '引用', icon: Quote },
  { type: 'codeBlock', label: '代码块', icon: Code2 },
]
</script>

<template>
  <div v-if="visible" class="block-menu gn-pop" :style="style">
    <div class="bm-group">
      <button class="bm-item" @mousedown.prevent="emit('action', 'duplicate')">
        <Copy :size="15" :stroke-width="1.8" /><span>创建副本</span>
      </button>
      <button class="bm-item" @mousedown.prevent="emit('action', 'moveUp')">
        <ArrowUp :size="15" :stroke-width="1.8" /><span>上移</span>
      </button>
      <button class="bm-item" @mousedown.prevent="emit('action', 'moveDown')">
        <ArrowDown :size="15" :stroke-width="1.8" /><span>下移</span>
      </button>
    </div>

    <div class="bm-group">
      <div class="bm-label">转换为</div>
      <button
        v-for="t in turnInto"
        :key="t.type"
        class="bm-item"
        @mousedown.prevent="emit('action', 'turn:' + t.type)"
      >
        <component :is="t.icon" :size="15" :stroke-width="1.8" /><span>{{ t.label }}</span>
      </button>
    </div>

    <div class="bm-group">
      <button class="bm-item danger" @mousedown.prevent="emit('action', 'delete')">
        <Trash2 :size="15" :stroke-width="1.8" /><span>删除</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.block-menu {
  position: absolute;
  z-index: 60;
  width: 208px;
  max-height: 420px;
  overflow-y: auto;
  padding: 5px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  box-shadow: var(--gn-shadow-lg);
}
.bm-group + .bm-group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--gn-border);
}
.bm-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--gn-text-muted);
  padding: 4px 8px;
  text-transform: uppercase;
}
.bm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  font-size: 13.5px;
  color: var(--gn-text-soft);
  text-align: left;
  cursor: pointer;
}
.bm-item:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.bm-item.danger {
  color: var(--gn-danger);
}
.bm-item.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
}
</style>
