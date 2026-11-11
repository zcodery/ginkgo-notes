<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue"
import { ChevronRight, Plus } from "lucide-vue-next"
import type { TreeNode } from "@/types"
import PageIcon from "./PageIcon.vue"
import CollapseTransition from "./CollapseTransition.vue"

defineOptions({ name: "PageTreeItem" })

const props = defineProps<{ node: TreeNode; depth: number }>()

const ctx = inject<any>("pageTree")

const expanded = computed(() => ctx.expanded.has(props.node.id))
const hasChildren = computed(() => props.node.children.length > 0)
const active = computed(() => ctx.activeId === props.node.id)
const isEditing = computed(() => ctx.editingId === props.node.id)
const inputRef = ref<HTMLInputElement | null>(null)

const dropHint = computed(() => (ctx.dropTarget?.id === props.node.id ? ctx.dropTarget.mode : null))

function toggle() {
  if (!hasChildren.value) return
  if (expanded.value) ctx.expanded.delete(props.node.id)
  else ctx.expanded.add(props.node.id)
  ctx.persist()
}

function onChevron(e: MouseEvent) {
  e.stopPropagation()
  toggle()
}

function onSelect() {
  if (isEditing.value) return
  ctx.select(props.node.id)
}

function onDoubleClick() {
  ctx.startRename(props.node.id)
}

function onMenu(e: MouseEvent) {
  e.stopPropagation()
  ctx.openMenu(e, props.node)
}

function onAddChild(e: MouseEvent) {
  e.stopPropagation()
  ctx.addChild(props.node)
}

function onDragStart(e: DragEvent) {
  ctx.dragId = props.node.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", props.node.id)
  }
}

function onDragOver(e: DragEvent) {
  if (!ctx.dragId || ctx.dragId === props.node.id) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const y = e.clientY - rect.top
  let mode: "before" | "after" | "inside" = "inside"
  if (y < rect.height * 0.3) mode = "before"
  else if (y > rect.height * 0.7) mode = "after"
  ctx.dropTarget = { id: props.node.id, mode }
}

function onDragLeave() {
  if (ctx.dropTarget?.id === props.node.id) ctx.dropTarget = null
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  ctx.commitDrop(props.node)
}

function onRenameKey(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault()
    commitRename()
  } else if (e.key === "Escape") {
    e.preventDefault()
    ctx.cancelRename()
  }
}

function commitRename() {
  if (!isEditing.value) return
  const v = inputRef.value?.value.trim() ?? ""
  ctx.commitRename(props.node.id, v)
}

async function focusInput() {
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

/** 点到输入框以外任何地方都提交，避免输入框没拿到焦点时一直停留在编辑态 */
function onOutsideDown(e: MouseEvent) {
  if (!isEditing.value) return
  if (inputRef.value && e.target instanceof Node && inputRef.value.contains(e.target)) return
  commitRename()
}

watch(
  isEditing,
  editing => {
    if (editing) {
      void focusInput()
      document.addEventListener("mousedown", onOutsideDown, true)
    } else {
      document.removeEventListener("mousedown", onOutsideDown, true)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => document.removeEventListener("mousedown", onOutsideDown, true))
</script>

<template>
  <div class="pt-wrap">
    <div class="pt-item" :class="{ active }" :style="{ paddingLeft: depth * 14 + 6 + 'px' }" :data-drop="dropHint" draggable="true" @click="onSelect" @dblclick="onDoubleClick" @contextmenu="onMenu" @dragstart="onDragStart" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop" @dragend="ctx.endDrag()">
      <!-- 箭头浮在左侧，不占文档流：顶层图标与「私人」标题左对齐，子级依次 +14px -->
      <button v-if="hasChildren" class="pt-chevron" :class="{ open: expanded }" :style="{ left: depth * 14 - 16 + 'px' }" @click="onChevron">
        <ChevronRight :size="13" :stroke-width="2.2" />
      </button>

      <span class="pt-icon">
        <PageIcon :icon="node.icon" :size="15" />
      </span>

      <input v-if="isEditing" ref="inputRef" class="pt-title-input" :value="node.title" placeholder="未命名" @click.stop @keydown="onRenameKey" @blur="commitRename" />
      <span v-else class="pt-title">{{ node.title || "未命名" }}</span>

      <button
        class="pt-add"
        v-tooltip="{ title: '创建新页面', desc: '只有你可以访问', placement: 'right' }"
        @click="onAddChild"
      >
        <Plus :size="13" :stroke-width="2.2" />
      </button>
      <button class="pt-more" v-tooltip="{ title: '更多', placement: 'right' }" @click="onMenu">⋯</button>
    </div>

    <CollapseTransition>
      <div v-if="hasChildren && expanded" class="pt-children">
        <PageTreeItem v-for="child in node.children" :key="child.id" :node="child" :depth="depth + 1" />
      </div>
    </CollapseTransition>
  </div>
</template>

<style scoped>
.pt-wrap {
  position: relative;
}
.pt-item {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 27px;
  margin: 1px 6px 1px 8px;
  padding-right: 5px;
  border-radius: 5px;
  cursor: pointer;
  color: var(--gn-text-soft);
  position: relative;
  user-select: none;
}
.pt-item:hover {
  background: var(--gn-bg-hover);
}
.pt-item.active {
  background: var(--gn-bg-active);
  color: var(--gn-text);
  font-weight: 560;
  box-shadow: inset 3px 0 0 var(--gn-accent);
}
.pt-item.active .pt-title {
  color: var(--gn-text);
}
.pt-item[data-drop="inside"] {
  background: var(--gn-accent-soft);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--gn-accent) 55%, transparent);
}
.pt-item[data-drop="before"]::before,
.pt-item[data-drop="after"]::after {
  content: "";
  position: absolute;
  left: 4px;
  right: 4px;
  height: 2px;
  background: var(--gn-accent);
  border-radius: 2px;
}
.pt-item[data-drop="before"]::before {
  top: -1px;
}
.pt-item[data-drop="after"]::after {
  bottom: -1px;
}
.pt-chevron {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--gn-text-muted);
  border-radius: 3px;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    transform 0.12s ease,
    background 0.12s ease;
}
.pt-item:hover > .pt-chevron,
.pt-chevron.open {
  opacity: 1;
}
.pt-chevron.open {
  transform: translateY(-50%) rotate(90deg);
}
.pt-chevron:hover {
  background: var(--gn-bg-active);
  color: var(--gn-text);
}
.pt-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  flex: 0 0 auto;
  font-size: 13px;
  line-height: 1;
}
.pt-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}
.pt-title-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 21px;
  padding: 0 4px;
  font-size: 13.5px;
  font-family: inherit;
  color: var(--gn-text);
  background: var(--gn-bg);
  border: 1px solid var(--gn-accent);
  border-radius: 4px;
  outline: none;
}
.pt-add,
.pt-more {
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--gn-text-muted);
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.pt-item:hover .pt-add,
.pt-item:hover .pt-more {
  display: flex;
}
.pt-add:hover,
.pt-more:hover {
  background: var(--gn-bg-active);
  color: var(--gn-text);
}

/* 触屏没有悬停：展开箭头与更多按钮常显，行高放大便于点按 */
@media (hover: none) {
  .pt-item {
    height: 34px;
  }
  .pt-chevron {
    opacity: 0.7;
  }
  .pt-more {
    display: flex;
  }
}
</style>
