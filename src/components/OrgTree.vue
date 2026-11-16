<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import {
  createOrgNode,
  deleteOrgNode,
  updateOrgNode,
  type OrgNodeInfo,
} from '@/api/features'
import GnSelect from './GnSelect.vue'

const props = defineProps<{
  spaceId: string
  nodes: OrgNodeInfo[]
  canManage: boolean
}>()

const emit = defineEmits<{ (e: 'changed'): void }>()

const collapsed = ref<string[]>([])
const err = ref('')
const busy = ref(false)

const editingId = ref('')
const editingName = ref('')
const movingId = ref('')
const moveTarget = ref('')
const confirmingId = ref('')
const addingParentId = ref<string | null | undefined>(undefined)
const addingName = ref('')
const addingType = ref<'department' | 'team'>('department')

const typeOptions = [
  { value: 'department', label: '部门' },
  { value: 'team', label: '团队' },
]

const isCollapsed = (id: string) => collapsed.value.includes(id)

function toggle(id: string) {
  collapsed.value = isCollapsed(id)
    ? collapsed.value.filter((x) => x !== id)
    : [...collapsed.value, id]
}

interface TreeRow {
  node: OrgNodeInfo
  depth: number
  hasChildren: boolean
}

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
      out.push({ node: n, depth, hasChildren: children.length > 0 })
      if (!isCollapsed(n.id)) walk(n.id, depth + 1)
    }
  }
  walk('', 0)
  return out
})

const moveOptions = computed(() => {
  const current = props.nodes.find((n) => n.id === movingId.value)
  const blocked = new Set<string>()
  if (current) {
    for (const n of props.nodes) {
      if (n.id === current.id || n.path.startsWith(current.path)) blocked.add(n.id)
    }
  }
  return [
    { value: '', label: '作为根节点' },
    ...props.nodes
      .filter((n) => !blocked.has(n.id))
      .map((n) => ({ value: n.id, label: `${'　'.repeat(n.depth)}${n.name}` })),
  ]
})

function resetInline() {
  editingId.value = ''
  movingId.value = ''
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
  addingType.value = 'department'
}

function saveAdd() {
  const name = addingName.value.trim()
  if (!name || addingParentId.value === undefined) return
  void apply(() =>
    createOrgNode(props.spaceId, {
      name,
      type: addingType.value,
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

function startMove(node: OrgNodeInfo) {
  resetInline()
  movingId.value = node.id
  moveTarget.value = node.parentId ?? ''
}

function saveMove() {
  if (!movingId.value) return
  void apply(() =>
    updateOrgNode(props.spaceId, movingId.value, { parentId: moveTarget.value || null }),
  )
}

function doDelete(id: string) {
  void apply(() => deleteOrgNode(props.spaceId, id))
}
</script>

<template>
  <div class="ot">
    <div class="ot-head">
      <span class="ot-title">组织架构</span>
      <button v-if="canManage" type="button" class="ot-add-root" :disabled="busy" @click="startAdd(null)">
        <Plus :size="12" :stroke-width="2.2" />根级部门
      </button>
    </div>

    <div v-if="addingParentId !== undefined" class="ot-inline ot-add">
      <input
        v-model="addingName"
        :placeholder="addingParentId ? '下级部门 / 团队名称' : '根级部门名称'"
        @keydown.enter="saveAdd"
      />
      <GnSelect v-model="addingType" :options="typeOptions" :min-width="78" />
      <button type="button" class="ot-btn primary" :disabled="busy || !addingName.trim()" @click="saveAdd">
        确定
      </button>
      <button type="button" class="ot-btn" :disabled="busy" @click="resetInline">取消</button>
    </div>

    <div class="ot-list">
      <div v-for="row in rows" :key="row.node.id" class="ot-item">
        <div
          class="ot-row"
          :class="{ editing: editingId === row.node.id }"
          :style="{ paddingLeft: 4 + row.depth * 16 + 'px' }"
        >
          <button
            type="button"
            class="ot-toggle"
            :class="{ ghost: !row.hasChildren }"
            :disabled="!row.hasChildren"
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
            <span class="ot-type">{{ row.node.type === 'team' ? '团队' : '部门' }}</span>
            <span class="ot-count">{{ row.node.memberCount }} 人</span>
            <div v-if="canManage" class="ot-actions">
              <button type="button" title="新增下级" @click="startAdd(row.node.id)">
                <Plus :size="12" />
              </button>
              <button type="button" title="重命名" @click="startRename(row.node)">
                <Pencil :size="12" />
              </button>
              <button v-if="row.node.parentId" type="button" title="删除" @click="confirmingId = row.node.id">
                <Trash2 :size="12" />
              </button>
            </div>
          </template>
        </div>

        <div v-if="movingId === row.node.id" class="ot-inline" :style="{ marginLeft: 24 + row.depth * 16 + 'px' }">
          <GnSelect v-model="moveTarget" :options="moveOptions" :min-width="150" />
          <button type="button" class="ot-btn primary" :disabled="busy" @click="saveMove">移动</button>
          <button type="button" class="ot-btn" :disabled="busy" @click="resetInline">取消</button>
        </div>

        <div v-if="confirmingId === row.node.id" class="ot-inline" :style="{ marginLeft: 24 + row.depth * 16 + 'px' }">
          <span class="ot-warn">删除「{{ row.node.name }}」？成员与授权会迁移到上级节点。</span>
          <button type="button" class="ot-btn danger" :disabled="busy" @click="doDelete(row.node.id)">确认删除</button>
          <button type="button" class="ot-btn" :disabled="busy" @click="resetInline">取消</button>
        </div>
      </div>
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
.ot-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ot-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding-right: 4px;
  border-radius: 6px;
}
.ot-row:hover {
  background: var(--gn-bg-soft);
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
  height: 24px;
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
.ot-type,
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
  height: 22px;
  padding: 0 7px;
  font-size: 11.5px;
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