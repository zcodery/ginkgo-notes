<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import {
  createOrgNode,
  deleteOrgNode,
  moveOrgNode,
  updateOrgNode,
  type OrgNodeInfo,
} from '@/api/features'

const props = defineProps<{
  spaceId: string
  nodes: OrgNodeInfo[]
  canManage: boolean
  /** 当前选中的节点，右侧成员列表按它过滤 */
  selectedId?: string
}>()

const emit = defineEmits<{
  (e: 'changed'): void
  (e: 'select', id: string): void
  /** 右侧成员被拖到某个节点上：把成员的归属改到该节点 */
  (e: 'assign-member', payload: { userId: string; nodeId: string }): void
}>()

/** 成员拖拽用的私有 MIME，和节点排序的 text/plain 分开，互不干扰 */
const MEMBER_MIME = 'application/x-ginkgo-member'

const collapsed = ref<string[]>([])
const err = ref('')
const busy = ref(false)

const editingId = ref('')
const editingName = ref('')
const confirmingId = ref('')
const addingParentId = ref<string | null | undefined>(undefined)
const addingName = ref('')

const isCollapsed = (id: string) => collapsed.value.includes(id)

function toggle(id: string) {
  collapsed.value = isCollapsed(id)
    ? collapsed.value.filter((x) => x !== id)
    : [...collapsed.value, id]
}

/**
 * 扁平化的可见行。除了真实节点，还会在「正在新建下级」的父节点后面
 * 插一条 add 行——这样输入框就长在那一行的下面、缩进一格，一眼看出是谁的下级。
 */
type TreeRow =
  | { kind: 'node'; key: string; node: OrgNodeInfo; depth: number; hasChildren: boolean }
  | { kind: 'add'; key: string; depth: number; parentId: string | null }

const rows = computed<TreeRow[]>(() => {
  const byParent = new Map<string, OrgNodeInfo[]>()
  for (const n of props.nodes) {
    const key = n.parentId ?? ''
    const arr = byParent.get(key) ?? []
    arr.push(n)
    byParent.set(key, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sort - b.sort)

  const out: TreeRow[] = []
  const walk = (parentId: string, depth: number) => {
    for (const n of byParent.get(parentId) ?? []) {
      const children = byParent.get(n.id) ?? []
      out.push({ kind: 'node', key: n.id, node: n, depth, hasChildren: children.length > 0 })
      // 新建下级：紧跟在父节点下面，缩进一格
      if (addingParentId.value === n.id) {
        out.push({ kind: 'add', key: `add-${n.id}`, depth: depth + 1, parentId: n.id })
      }
      if (!isCollapsed(n.id)) walk(n.id, depth + 1)
    }
  }
  walk('', 0)
  // 根级新增：贴在整棵树末尾，不缩进
  if (addingParentId.value === null) {
    out.push({ kind: 'add', key: 'add-root', depth: 0, parentId: null })
  }
  return out
})

function resetInline() {
  editingId.value = ''
  confirmingId.value = ''
  addingParentId.value = undefined
  addingName.value = ''
}

async function apply(fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  err.value = ''
  try {
    await fn()
    resetInline()
    emit('changed')
  } catch (e) {
    err.value = e instanceof Error ? e.message : '操作失败'
  } finally {
    busy.value = false
  }
}

function startAdd(parentId: string | null) {
  resetInline()
  addingParentId.value = parentId
  addingName.value = ''
  // 父节点收着的话先展开，否则新行会挂在一个看不见的层级下
  if (parentId) collapsed.value = collapsed.value.filter((x) => x !== parentId)
}

// 新建行出现时自动聚焦
const addInput = ref<HTMLInputElement | null>(null)
function setAddInput(el: unknown) {
  addInput.value = (el as HTMLInputElement) ?? null
}
watch(addingParentId, async (v) => {
  if (v === undefined) return
  await nextTick()
  addInput.value?.focus()
})

function saveAdd() {
  const name = addingName.value.trim()
  if (!name || addingParentId.value === undefined) return
  void apply(() =>
    createOrgNode(props.spaceId, {
      name,
      parentId: addingParentId.value,
    }),
  )
}

function startRename(node: OrgNodeInfo) {
  resetInline()
  editingId.value = node.id
  editingName.value = node.name
}

// 重命名输入框就地渲染在标题位置，进入编辑后自动聚焦并全选
const renameInput = ref<HTMLInputElement | null>(null)
function setRenameInput(el: unknown) {
  renameInput.value = (el as HTMLInputElement) ?? null
}
watch(editingId, async (id) => {
  if (!id) return
  await nextTick()
  const el = renameInput.value
  if (!el) return
  el.focus()
  el.select()
})

function saveRename() {
  const name = editingName.value.trim()
  if (!name || !editingId.value) return
  void apply(() => updateOrgNode(props.spaceId, editingId.value, { name }))
}

/** 失焦即落定：名称没改或为空则视为取消，避免留下一个悬空的输入框 */
function onRenameBlur() {
  const id = editingId.value
  if (!id) return
  const original = props.nodes.find((n) => n.id === id)?.name ?? ''
  const name = editingName.value.trim()
  if (!name || name === original) {
    resetInline()
    return
  }
  saveRename()
}

/* ---------------- 拖拽调整层级 ---------------- */

type DropZone = 'before' | 'after' | 'inside'

const dragId = ref('')
const dropHint = ref<{ id: string; zone: DropZone } | null>(null)
const rootZone = ref(false)
/** 正在拖成员时命中的节点 id（只做高亮，不参与节点排序逻辑） */
const memberHintId = ref('')
// 拖完松手时浏览器有时仍会补一个 click，用它把紧跟其后的点击吞掉
let dragEndAt = 0

function isMemberDrag(e: DragEvent) {
  return !!e.dataTransfer?.types.includes(MEMBER_MIME)
}

function clearMemberHint() {
  memberHintId.value = ''
}

/** 点行 = 选中该节点，右侧成员列表跟着过滤；点的是按钮/输入框则交给它们自己处理 */
function onRowClick(node: OrgNodeInfo, e: MouseEvent) {
  if (editingId.value === node.id) return
  if (Date.now() - dragEndAt < 150) return
  if ((e.target as HTMLElement | null)?.closest('button, input, a, textarea')) return
  emit('select', node.id)
}

const nodeById = (id: string) => props.nodes.find((n) => n.id === id)

/** 拖拽目标是「自己或自己的下级」时不允许作为落点（会把子树挂成自己的下级） */
function blockedTarget(id: string): boolean {
  const src = nodeById(dragId.value)
  const dst = nodeById(id)
  if (!src || !dst) return true
  return dst.id === src.id || dst.path.startsWith(src.path)
}

function onRowDragStart(node: OrgNodeInfo, e: DragEvent) {
  if (!props.canManage || busy.value || editingId.value === node.id) {
    e.preventDefault()
    return
  }
  dragId.value = node.id
  dropHint.value = null
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.id)
  }
}

function onRowDragOver(node: OrgNodeInfo, e: DragEvent) {
  // 拖的是右侧成员：整行都是落点，直接把成员挂到该节点
  if (isMemberDrag(e)) {
    if (!props.canManage) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dropHint.value = null
    rootZone.value = false
    memberHintId.value = node.id
    return
  }
  if (!dragId.value) return
  if (blockedTarget(node.id)) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    if (dropHint.value?.id === node.id) dropHint.value = null
    return
  }
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  rootZone.value = false
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const edge = Math.min(10, r.height * 0.3)
  const y = e.clientY - r.top
  const zone: DropZone = y < edge ? 'before' : y > r.height - edge ? 'after' : 'inside'
  dropHint.value = { id: node.id, zone }
}

function onRowDragLeave(node: OrgNodeInfo, e: DragEvent) {
  const to = e.relatedTarget as Node | null
  if (to && (e.currentTarget as HTMLElement).contains(to)) return
  if (dropHint.value?.id === node.id) dropHint.value = null
  if (memberHintId.value === node.id) memberHintId.value = ''
}

function resetDrag() {
  dragId.value = ''
  dropHint.value = null
  rootZone.value = false
  clearMemberHint()
  dragEndAt = Date.now()
}

function onRowDrop(node: OrgNodeInfo, e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  // 成员落点：发出归属变更，由团队页调接口
  if (isMemberDrag(e)) {
    const userId = e.dataTransfer?.getData(MEMBER_MIME) ?? ''
    clearMemberHint()
    dragEndAt = Date.now()
    if (userId) emit('assign-member', { userId, nodeId: node.id })
    return
  }
  const hint = dropHint.value
  const moving = dragId.value
  resetDrag()
  if (!moving || !hint) return
  if (hint.zone === 'inside') {
    void doMove(moving, node.id, null)
    return
  }
  // 上下换位：保持同一父节点，插到目标之前 / 目标的下一个兄弟之前
  if (hint.zone === 'before') {
    void doMove(moving, node.parentId, node.id)
    return
  }
  const siblings = props.nodes
    .filter((n) => (n.parentId ?? '') === (node.parentId ?? ''))
    .sort((a, b) => a.sort - b.sort)
  const next = siblings[siblings.findIndex((s) => s.id === node.id) + 1] ?? null
  void doMove(moving, node.parentId, next ? next.id : null)
}

function onRootDragOver(e: DragEvent) {
  if (!dragId.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropHint.value = null
  rootZone.value = true
}

function onRootDrop(e: DragEvent) {
  e.preventDefault()
  const moving = dragId.value
  resetDrag()
  if (moving) void doMove(moving, null, null)
}

/** 落到新上级后自动展开，避免「拖进去了却看不见」 */
async function doMove(nodeId: string, parentId: string | null, beforeId: string | null) {
  const src = nodeById(nodeId)
  if (!src) return
  const sameParent = (src.parentId ?? '') === (parentId ?? '')
  if (sameParent) {
    if (beforeId === nodeId) return
    if (!beforeId) {
      const last = props.nodes
        .filter((n) => (n.parentId ?? '') === (parentId ?? ''))
        .sort((a, b) => a.sort - b.sort)
        .at(-1)
      if (last?.id === nodeId) return
    }
  }
  await apply(() => moveOrgNode(props.spaceId, nodeId, { parentId, beforeId }))
  if (parentId) collapsed.value = collapsed.value.filter((x) => x !== parentId)
}

function doDelete(id: string) {
  void apply(() => deleteOrgNode(props.spaceId, id))
}

// 拖拽源在右侧成员列表，松手/取消时树这边收不到 dragend，用全局事件兜底清高亮
onMounted(() => {
  document.addEventListener('dragend', clearMemberHint)
  document.addEventListener('drop', clearMemberHint)
})

onBeforeUnmount(() => {
  document.removeEventListener('dragend', clearMemberHint)
  document.removeEventListener('drop', clearMemberHint)
})

/* ---------------- 行出现/消失的高度动画 ---------------- */
// TransitionGroup 只能过渡有具体数值的属性，进入/离开时先把高度定死再改成 0，
// 这样收起最外层时整段下级是「滑上去」而不是瞬间消失。
function onRowBeforeEnter(el: Element) {
  const e = el as HTMLElement
  e.style.height = '0px'
  e.style.opacity = '0'
}

function onRowEnter(el: Element) {
  const e = el as HTMLElement
  const h = e.scrollHeight
  requestAnimationFrame(() => {
    e.style.height = h + 'px'
    e.style.opacity = '1'
  })
}

function onRowAfterEnter(el: Element) {
  const e = el as HTMLElement
  e.style.height = ''
  e.style.opacity = ''
}

function onRowLeave(el: Element) {
  const e = el as HTMLElement
  e.style.height = e.getBoundingClientRect().height + 'px'
  requestAnimationFrame(() => {
    e.style.height = '0px'
    e.style.opacity = '0'
  })
}
</script>

<template>
  <div class="ot">
    <div class="ot-head">
      <span class="ot-title">组织架构</span>
      <button v-if="canManage" type="button" class="ot-add-root" :disabled="busy" @click="startAdd(null)">
        <Plus :size="12" :stroke-width="2.2" />根级节点
      </button>
    </div>

    <TransitionGroup
      tag="div"
      class="ot-list"
      :class="{ 'is-dragging': !!dragId }"
      name="otk"
      @before-enter="onRowBeforeEnter"
      @enter="onRowEnter"
      @after-enter="onRowAfterEnter"
      @leave="onRowLeave"
    >
      <div v-for="row in rows" :key="row.key" class="ot-slot">
        <!-- 新建下级：长在父节点下面、缩进一格 -->
        <div
          v-if="row.kind === 'add'"
          class="ot-row ot-add-row"
          :style="{ paddingLeft: 4 + row.depth * 16 + 'px' }"
        >
          <span class="ot-branch" :class="{ plain: !row.parentId }" aria-hidden="true" />
          <input
            :ref="setAddInput"
            v-model="addingName"
            class="ot-add-input"
            :placeholder="row.parentId ? '下级名称' : '根节点名称'"
            :disabled="busy"
            @keydown.enter.prevent="saveAdd"
            @keydown.esc.prevent="resetInline"
          />
          <button type="button" class="ot-btn primary sm" :disabled="busy || !addingName.trim()" @click="saveAdd">
            确定
          </button>
          <button type="button" class="ot-btn sm" :disabled="busy" @click="resetInline">取消</button>
        </div>

        <div v-else class="ot-item">
          <div
            class="ot-row"
            :draggable="canManage && editingId !== row.node.id"
            :class="{
              editing: editingId === row.node.id,
              on: selectedId === row.node.id,
              dragging: dragId === row.node.id,
              'member-drop': memberHintId === row.node.id,
              'drop-before': dropHint?.id === row.node.id && dropHint.zone === 'before',
              'drop-after': dropHint?.id === row.node.id && dropHint.zone === 'after',
              'drop-inside': dropHint?.id === row.node.id && dropHint.zone === 'inside',
            }"
            :style="{ paddingLeft: 4 + row.depth * 16 + 'px' }"
            @click="onRowClick(row.node, $event)"
            @dragstart="onRowDragStart(row.node, $event)"
            @dragover="onRowDragOver(row.node, $event)"
            @dragleave="onRowDragLeave(row.node, $event)"
            @drop="onRowDrop(row.node, $event)"
            @dragend="resetDrag"
          >
            <button
              type="button"
              class="ot-toggle"
              :class="{ ghost: !row.hasChildren }"
              :disabled="!row.hasChildren"
              v-tooltip="row.hasChildren ? (isCollapsed(row.node.id) ? '展开下级' : '收起下级') : null"
              @click="toggle(row.node.id)"
            >
              <ChevronRight :size="13" :class="{ open: row.hasChildren && !isCollapsed(row.node.id) }" />
            </button>

            <!-- 重命名：标题就地变成输入框，不再在下方多占一行 -->
            <template v-if="editingId === row.node.id">
              <input
                :ref="setRenameInput"
                v-model="editingName"
                class="ot-name-input"
                :disabled="busy"
                @keydown.enter.prevent="saveRename"
                @keydown.esc.prevent="resetInline"
                @blur="onRenameBlur"
              />
              <button
                type="button"
                class="ot-btn primary sm"
                :disabled="busy || !editingName.trim()"
                @mousedown.prevent
                @click="saveRename"
              >
                保存
              </button>
              <button type="button" class="ot-btn sm" :disabled="busy" @mousedown.prevent @click="resetInline">
                取消
              </button>
            </template>

            <template v-else>
              <span class="ot-name">{{ row.node.name }}</span>
              <span class="ot-count">{{ row.node.memberCount }} 人</span>
              <div v-if="canManage" class="ot-actions">
                <button type="button" v-tooltip="'新增下级'" @click="startAdd(row.node.id)">
                  <Plus :size="12" />
                </button>
                <button type="button" v-tooltip="'重命名'" @click="startRename(row.node)">
                  <Pencil :size="12" />
                </button>
                <button
                  v-if="row.node.parentId"
                  type="button"
                  v-tooltip="'删除节点（成员与授权会迁移到上级）'"
                  @click="confirmingId = row.node.id"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </template>
          </div>

          <div v-if="confirmingId === row.node.id" class="ot-inline" :style="{ marginLeft: 24 + row.depth * 16 + 'px' }">
            <span class="ot-warn">删除「{{ row.node.name }}」？成员与授权会迁移到上级节点。</span>
            <button type="button" class="ot-btn danger" :disabled="busy" @click="doDelete(row.node.id)">确认删除</button>
            <button type="button" class="ot-btn" :disabled="busy" @click="resetInline">取消</button>
          </div>
        </div>
      </div>
    </TransitionGroup>

    <!-- 移到最外层：拖任意节点到这里即变成根节点 -->
    <div
      v-if="canManage"
      class="ot-root-drop"
      :class="{ live: !!dragId, on: rootZone }"
      @dragover="onRootDragOver"
      @dragleave="rootZone = false"
      @drop="onRootDrop"
    >
      {{
        dragId
          ? '松手 → 移到最外层（根节点）'
          : memberHintId
            ? '松手 → 把成员挂到该节点下'
            : '按住节点可拖动调整层级'
      }}
    </div>

    <p v-if="err" class="ot-err">{{ err }}</p>
  </div>
</template>

<style scoped>
.ot {
  margin-top: 12px;
}
.ot-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.ot-title {
  font-size: 12px;
  color: var(--gn-text-soft);
}
.ot-add-root {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  height: 24px;
  padding: 0 8px;
  border: 1px dashed var(--gn-border-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--gn-accent);
  font-size: 11.5px;
  cursor: pointer;
}
.ot-add-root:hover {
  background: var(--gn-accent-soft);
}
.ot-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
/* 每行外面套一层，交给 TransitionGroup 做高度动画 */
.ot-slot {
  overflow: hidden;
}
.otk-enter-active,
.otk-leave-active {
  transition:
    height 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.16s ease;
}
.otk-move {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.ot-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ot-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding-right: 4px;
  border-radius: 6px;
  cursor: pointer;
}
.ot-row:hover {
  background: var(--gn-bg-soft);
}
/* 选中的节点：左侧一条主色竖条 + 淡底，右侧成员列表跟着它过滤 */
.ot-row.on {
  background: var(--gn-accent-soft);
  box-shadow: inset 2px 0 0 var(--gn-accent);
}
.ot-row.on .ot-name {
  font-weight: 600;
}
.ot-row.on .ot-count {
  color: var(--gn-accent);
}
/* ---------- 拖拽调整层级 ---------- */
.ot-list.is-dragging {
  user-select: none;
}
.ot-row[draggable='true'] {
  cursor: grab;
}
.ot-row.dragging {
  opacity: 0.45;
}
.ot-row.drop-inside {
  outline: 2px dashed var(--gn-accent);
  outline-offset: -2px;
  background: var(--gn-accent-soft);
}
/* 成员拖到这一行上：整行作落点，实线描边区别于节点排序的插入线 */
.ot-row.member-drop,
.ot-row.member-drop:hover {
  background: var(--gn-accent-soft);
  box-shadow: inset 0 0 0 1.5px var(--gn-accent);
}
.ot-row.member-drop .ot-name,
.ot-row.member-drop .ot-count {
  color: var(--gn-accent);
}
.ot-row.drop-inside:hover {
  background: var(--gn-accent-soft);
}
.ot-row.drop-before::before,
.ot-row.drop-after::after {
  content: '';
  position: absolute;
  left: 2px;
  right: 2px;
  height: 2px;
  border-radius: 2px;
  background: var(--gn-accent);
  pointer-events: none;
}
.ot-row.drop-before::before {
  top: -1px;
}
.ot-row.drop-after::after {
  bottom: -1px;
}
/* 落在最外层：把插入线画成一段更醒目的「放到根级」提示 */
.ot-root-drop {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  margin-top: 6px;
  border: 1px dashed transparent;
  border-radius: 6px;
  color: var(--gn-text-muted);
  font-size: 11.5px;
  transition:
    height 0.16s ease,
    margin 0.16s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}
.ot-root-drop.live {
  border-color: var(--gn-border-strong);
  border-style: dashed;
}
.ot-root-drop.on {
  border-color: var(--gn-accent);
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
/* 新建下级的行：缩进与子节点名称对齐，前面画一段「└」虚线，明确它属于上一级 */
.ot-add-row,
.ot-add-row:hover {
  background: var(--gn-bg-soft);
}
.ot-branch {
  flex: 0 0 auto;
  width: 18px;
  height: 22px;
  border-left: 1px dashed var(--gn-border-strong);
  border-bottom: 1px dashed var(--gn-border-strong);
  border-bottom-left-radius: 7px;
}
/* 根级新增没有上级，只留占位对齐 */
.ot-branch.plain {
  border-color: transparent;
}
.ot-add-input {
  flex: 1 1 auto;
  min-width: 88px;
  max-width: 230px;
  height: 26px;
  padding: 0 7px;
  border: 1px solid var(--gn-accent);
  border-radius: 5px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}
.ot-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.ot-toggle.ghost {
  visibility: hidden;
}
.ot-toggle :deep(svg) {
  transition: transform 0.14s ease;
}
.ot-toggle :deep(svg.open) {
  transform: rotate(90deg);
}
.ot-name {
  font-size: 13px;
  color: var(--gn-text);
  white-space: nowrap;
}
/* 标题就地编辑：输入框接管 .ot-name 的位置与字号 */
.ot-name-input {
  flex: 0 1 auto;
  min-width: 84px;
  max-width: 260px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--gn-accent);
  border-radius: 5px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.ot-row.editing .ot-name-input,
.ot-row.editing .ot-btn {
  /* 编辑态不跟着悬停一起淡出 */
  opacity: 1;
}
.ot-count {
  font-size: 11px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
.ot-count {
  margin-left: auto;
}
.ot-actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.ot-row:hover .ot-actions {
  opacity: 1;
}
.ot-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
}
.ot-actions button:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.ot-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--gn-bg-soft);
}
.ot-inline input {
  flex: 1 1 140px;
  min-width: 100px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12.5px;
  outline: none;
}
.ot-inline input:focus {
  border-color: var(--gn-accent);
}
.ot-warn {
  font-size: 11.5px;
  color: var(--gn-text-soft);
}
.ot-btn {
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12px;
  cursor: pointer;
}
.ot-btn.primary {
  border-color: transparent;
  background: var(--gn-accent);
  color: var(--gn-bg);
}
/* 行内紧凑按钮：跟标题同一行放得下 */
.ot-btn.sm {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  flex: 0 0 auto;
}
.ot-btn.danger {
  border-color: transparent;
  background: #c0392b;
  color: #fff;
}
.ot-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.ot-err {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: #c0392b;
}
</style>