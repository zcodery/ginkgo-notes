<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronRight, Folder, Search, X } from 'lucide-vue-next'
import {
  getSpaceOrg,
  listFriendGroups,
  listFriends,
  type FriendGroupInfo,
  type FriendInfo,
  type OrgNodeInfo,
  type SpaceMemberInfo,
} from '@/api/features'

/**
 * 人员多选器：可从好友、当前团队成员中选择。
 * 值统一为用户名字符串，后端邀请/分享接口都以用户名定位用户。
 *
 * 团队按组织架层级联展开：部门和人都出现在同一份列表里，
 * 部门行只能点击展开下一级，人才能勾选。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string[]
    source?: 'friends' | 'team' | 'both'
    spaceId?: string
    /** 可切换的团队空间；传入后下拉面板内会出现空间选择 */
    spaces?: { id: string; name: string }[]
    placeholder?: string
    disabled?: boolean
    /** 已在团队里、不能再选的人（用户名）；命中的不列表也不计数 */
    exclude?: string[]
  }>(),
  {
    source: 'both',
    spaceId: '',
    spaces: () => [],
    placeholder: '选择成员',
    disabled: false,
    exclude: () => [],
  },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void }>()

interface Person {
  id: string
  username: string
  name: string
  avatar: string | null
  /** 好友在我这边的分组；团队成员没有这个概念 */
  groupId: string | null
}

/** 团队成员 = 人 + 他挂在哪个组织节点上 */
interface Entry {
  person: Person
  orgNodeId: string
}

const FRIENDS_TAB = '__friends__'

const open = ref(false)
const dropUp = ref(false)
/** 面板 teleport 到 body 后按触发器坐标 fixed 定位，避免被卡片滚动容器裁掉 */
const panelStyle = ref<Record<string, string>>({})
const keyword = ref('')
const rootRef = ref<HTMLElement | null>(null)
/** 面板 teleport 到 body：点面板内部（切 tab / 选人）不能再被当成点外部而关掉 */
const panelRef = ref<HTMLElement | null>(null)
const friends = ref<Person[]>([])
const friendGroups = ref<FriendGroupInfo[]>([])
const friendGroupOpen = ref<Record<string, boolean>>({})
const friendsLoaded = ref(false)
/** 按空间缓存，切换 tab 不重复请求 */
const membersBySpace = ref<Record<string, Entry[]>>({})
const nodesBySpace = ref<Record<string, OrgNodeInfo[]>>({})
const loadingSpace = ref('')
/** 展开的部门节点 id */
const expanded = ref<Record<string, boolean>>({})
/** 已经做过默认展开的空间，避免重新加载时把用户的手动收起又打开 */
const primed = ref<Record<string, boolean>>({})
/** 当前 tab：FRIENDS_TAB 或空间 id */
const activeTab = ref(FRIENDS_TAB)
/** 用户自己切过 tab 之后就别再自动换，免得刚点开好友又被抢回去 */
const manualTab = ref(false)

const selected = computed(() => props.modelValue ?? [])

/** 已在团队里的成员：列表里直接不出现，避免选了才报「已是团队成员」 */
const excludeSet = computed(() => new Set(props.exclude ?? []))

/** 参与 tab 的团队空间；未显式传入 spaces 时退化为「当前团队」单 tab */
const teamSpaces = computed<{ id: string; name: string }[]>(() =>
  props.spaces.length
    ? props.spaces
    : props.spaceId
      ? [{ id: props.spaceId, name: '团队成员' }]
      : [],
)

const isTeamTab = computed(() => activeTab.value !== FRIENDS_TAB)

const entriesOf = (spaceId: string): Entry[] =>
  (membersBySpace.value[spaceId] ?? []).filter((e) => !excludeSet.value.has(e.person.username))

const nodesOf = (spaceId: string): OrgNodeInfo[] => nodesBySpace.value[spaceId] ?? []

const tabs = computed(() => {
  const out: { key: string; label: string; count: number }[] = []
  if (props.source !== 'team') {
    out.push({
      key: FRIENDS_TAB,
      label: '好友',
      count: friends.value.filter((p) => !excludeSet.value.has(p.username)).length,
    })
  }
  if (props.source !== 'friends') {
    for (const s of teamSpaces.value) {
      out.push({ key: s.id, label: s.name, count: entriesOf(s.id).length })
    }
  }
  return out
})

const pool = computed<Person[]>(() => {
  const all = [
    friends.value,
    ...Object.values(membersBySpace.value).map((rows) => rows.map((e) => e.person)),
  ].flat()
  const seen = new Set<string>()
  return all.filter((p) => (seen.has(p.username) ? false : (seen.add(p.username), true)))
})

const nameOf = (username: string) => pool.value.find((p) => p.username === username)?.name || username

function matches(p: Person): boolean {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return true
  return p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)
}

const currentTabLabel = computed(
  () => tabs.value.find((t) => t.key === activeTab.value)?.label ?? '成员',
)

/** 好友 tab 的可见名单（已剔掉团队里的人） */
const friendList = computed<Person[]>(() =>
  friends.value.filter((p) => !excludeSet.value.has(p.username)).filter(matches),
)

/**
 * 好友按我设定的分组展示，和团队 tab 的组织树口径一致。
 * 没建过分组时 name 为空，模板就不渲染分组头，保持原来的扁平列表。
 */
const friendSections = computed<{ key: string; name: string; people: Person[] }[]>(() => {
  const visible = friendList.value
  if (!friendGroups.value.length) return [{ key: '__all__', name: '', people: visible }]
  const out = friendGroups.value.map((g) => ({
    key: g.id,
    name: g.name,
    people: visible.filter((p) => p.groupId === g.id),
  }))
  const known = new Set(friendGroups.value.map((g) => g.id))
  const rest = visible.filter((p) => !p.groupId || !known.has(p.groupId))
  // 没建过分组时全体好友都在未分组；空了就别显示这个头
  if (rest.length) out.push({ key: '__none__', name: '未分组', people: rest })
  return out
})

const isFriendGroupOpen = (key: string) => friendGroupOpen.value[key] !== false
function toggleFriendGroup(key: string) {
  friendGroupOpen.value = { ...friendGroupOpen.value, [key]: !isFriendGroupOpen(key) }
}

/** 团队 tab 的部门树：按 parent_id 建树（GET /org 是层序，不能按 depth 堆） */
const treeRows = computed<PickerRow[]>(() => {
  const spaceId = activeTab.value
  if (!isTeamTab.value) return []
  const nodes = nodesOf(spaceId)
  const entries = entriesOf(spaceId)
  if (!nodes.length) return []

  const ids = new Set(nodes.map((n) => n.id))
  const byParent = new Map<string, OrgNodeInfo[]>()
  for (const n of nodes) {
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : ''
    const arr = byParent.get(key) ?? []
    arr.push(n)
    byParent.set(key, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))

  const direct = new Map<string, Person[]>()
  for (const e of entries) {
    const key = e.orgNodeId && ids.has(e.orgNodeId) ? e.orgNodeId : ''
    const arr = direct.get(key) ?? []
    arr.push(e.person)
    direct.set(key, arr)
  }

  // 子树人数，用来在部门行上显示「这个部门一共多少人」
  const totalCache = new Map<string, number>()
  const totalOf = (id: string): number => {
    const hit = totalCache.get(id)
    if (hit !== undefined) return hit
    let sum = (direct.get(id) ?? []).length
    for (const child of byParent.get(id) ?? []) sum += totalOf(child.id)
    totalCache.set(id, sum)
    return sum
  }

  const out: PickerRow[] = []
  const walk = (parentId: string, depth: number) => {
    for (const n of byParent.get(parentId) ?? []) {
      const kids = byParent.get(n.id) ?? []
      const people = direct.get(n.id) ?? []
      const isOpen = !!expanded.value[n.id]
      out.push({
        kind: 'dept',
        key: `d-${n.id}`,
        id: n.id,
        name: n.name,
        depth,
        total: totalOf(n.id),
        open: isOpen,
        canOpen: kids.length > 0 || people.length > 0,
      })
      if (!isOpen) continue
      walk(n.id, depth + 1)
      for (const p of people) {
        out.push({ kind: 'person', key: `p-${p.username}`, person: p, depth: depth + 1 })
      }
    }
  }
  walk('', 0)
  // 没挂到任何节点（或节点已被删）的人，铺在根上
  for (const p of direct.get('') ?? []) {
    out.push({ kind: 'person', key: `p-${p.username}`, person: p, depth: 0 })
  }
  return out
})

type PickerRow =
  | {
      kind: 'dept'
      key: string
      id: string
      name: string
      depth: number
      total: number
      open: boolean
      canOpen: boolean
    }
  | { kind: 'person'; key: string; person: Person; depth: number }

/** 搜索态：跨部门扁平列出命中的人，部门只在副标题里出现 */
const searchRows = computed<{ person: Person; path: string }[]>(() => {
  if (!keyword.value.trim() || !isTeamTab.value) return []
  const spaceId = activeTab.value
  const nodes = nodesOf(spaceId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const pathOf = (id: string): string => {
    const names: string[] = []
    let cur = byId.get(id)
    let guard = 0
    while (cur && guard++ < 12) {
      names.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return names.join(' / ')
  }
  return entriesOf(spaceId)
    .filter((e) => matches(e.person))
    .map((e) => ({ person: e.person, path: e.orgNodeId ? pathOf(e.orgNodeId) : '' }))
})

const emptyText = computed(() => {
  const rows =
    activeTab.value === FRIENDS_TAB
      ? friends.value
      : (membersBySpace.value[activeTab.value] ?? []).map((e) => e.person)
  if (rows.length && rows.every((p) => excludeSet.value.has(p.username))) {
    return '这些人已在团队里，新人请用「新建成员」'
  }
  if (activeTab.value === FRIENDS_TAB) return '还没有好友，可前往「好友」页添加'
  if (keyword.value.trim()) return '没有匹配的成员'
  return `「${currentTabLabel.value}」暂无成员`
})

function indent(depth: number) {
  return { paddingLeft: `${7 + depth * 13}px` }
}

function toPerson(v: FriendInfo | SpaceMemberInfo): Person {
  return {
    id: v.id,
    username: v.username,
    name: v.name,
    avatar: v.avatar,
    groupId: 'groupId' in v ? v.groupId : null,
  }
}

async function loadFriends() {
  if (friendsLoaded.value || props.source === 'team') return
  friendsLoaded.value = true
  try {
    const [rows, gs] = await Promise.all([listFriends(), listFriendGroups()])
    friends.value = rows.filter((r) => r.username).map(toPerson)
    friendGroups.value = gs
  } catch {
    friendsLoaded.value = false
  }
}

async function loadSpace(id: string) {
  if (!id || props.source === 'friends') return
  if (membersBySpace.value[id] || loadingSpace.value === id) return
  loadingSpace.value = id
  try {
    const org = await getSpaceOrg(id)
    nodesBySpace.value = { ...nodesBySpace.value, [id]: org.nodes }
    membersBySpace.value = {
      ...membersBySpace.value,
      [id]: org.members.map((m) => ({ person: toPerson(m), orgNodeId: m.orgNodeId ?? '' })),
    }
    primeExpand(id)
  } catch {
    /* 失败保持空列表，切换 tab 会重试 */
  } finally {
    loadingSpace.value = ''
  }
}

/**
 * 首次拿到组织树时给一个合理的初始展开：根层全开，
 * 单链条的部门（只有一个下级、自己没有直属成员）也一并打开，
 * 免得「全员 → 公司 → 部门 → 组」这种一条线要点三次才看到人。
 */
function primeExpand(spaceId: string) {
  if (primed.value[spaceId]) return
  const nodes = nodesOf(spaceId)
  if (!nodes.length) return
  primed.value = { ...primed.value, [spaceId]: true }

  const ids = new Set(nodes.map((n) => n.id))
  const byParent = new Map<string, OrgNodeInfo[]>()
  for (const n of nodes) {
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : ''
    const arr = byParent.get(key) ?? []
    arr.push(n)
    byParent.set(key, arr)
  }
  const direct = new Map<string, number>()
  for (const e of membersBySpace.value[spaceId] ?? []) {
    if (e.orgNodeId) direct.set(e.orgNodeId, (direct.get(e.orgNodeId) ?? 0) + 1)
  }

  const next = { ...expanded.value }
  const walk = (parentId: string, depth: number) => {
    for (const n of byParent.get(parentId) ?? []) {
      const kids = byParent.get(n.id) ?? []
      const people = direct.get(n.id) ?? 0
      // 根层全开；一条线的部门自动穿透；叶子部门人不多时直接把人也摊开
      if (depth === 0 || (kids.length === 1 && !people) || (!kids.length && people > 0 && people <= 6)) {
        next[n.id] = true
      }
      walk(n.id, depth + 1)
    }
  }
  walk('', 0)
  expanded.value = next
}

function toggleDept(id: string) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}

function loadAll() {
  if (props.source !== 'team') void loadFriends()
  if (props.source !== 'friends') {
    for (const s of teamSpaces.value) void loadSpace(s.id)
  }
}

function switchTab(key: string) {
  if (activeTab.value === key) return
  activeTab.value = key
  manualTab.value = true
  keyword.value = ''
}

function toggleOpen() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    manualTab.value = false
    measureDrop()
    loadAll()
  }
}

/** 下方空间不足时向上展开，避免面板被视口或对话框底边裁掉 */
function measureDrop() {
  const el = rootRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const GAP = 4
  const EDGE = 8
  const want = 300 // tab 行 + 列表 268 + 内边距
  const below = window.innerHeight - r.bottom - GAP - EDGE
  const above = r.top - GAP - EDGE
  dropUp.value = below < want && above > below
  const width = Math.max(r.width, 288)
  const left = Math.min(Math.max(EDGE, r.right - width), window.innerWidth - width - EDGE)
  const room = Math.max(96, dropUp.value ? above : below)
  const style: Record<string, string> = {
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    '--pp-list-max': `${Math.round(Math.min(268, room - 42))}px`,
  }
  if (dropUp.value) style.bottom = `${Math.round(window.innerHeight - r.top + GAP)}px`
  else style.top = `${Math.round(r.bottom + GAP)}px`
  panelStyle.value = style
}

/**
 * 点击容器空白处展开/收起。
 * 点在输入框或已选标签上时不处理：输入框的 focus 会自己打开面板，
 * 若这里再切换一次，同一次点击会「开→关」，表现为点了没反应。
 */
function onBoxClick(e: MouseEvent) {
  const el = e.target as Element | null
  if (el?.closest('input, .pp-chip')) return
  toggleOpen()
}

function onInputFocus() {
  if (!open.value) toggleOpen()
}

function toggle(username: string) {
  const next = selected.value.includes(username)
    ? selected.value.filter((u) => u !== username)
    : [...selected.value, username]
  emit('update:modelValue', next)
}

function remove(username: string) {
  emit('update:modelValue', selected.value.filter((u) => u !== username))
}

function onDocDown(e: MouseEvent) {
  if (!open.value) return
  const node = e.target as Node
  if (rootRef.value?.contains(node) || panelRef.value?.contains(node)) return
  open.value = false
}

watch(
  () => [props.source, props.spaceId, props.spaces.map((s) => s.id).join(',')],
  () => {
    // tab 失效（来源变化或团队被移除）时回到第一个可用 tab
    if (!tabs.value.some((t) => t.key === activeTab.value)) {
      activeTab.value = tabs.value[0]?.key ?? FRIENDS_TAB
    }
    if (open.value) loadAll()
  },
  { immediate: true },
)

onMounted(() => document.addEventListener('mousedown', onDocDown, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown, true))

/**
 * 打开面板后数据陆续回来：当前 tab 是空的（比如没有好友）而别的 tab 有人时，
 * 自动跳到第一个有人的 tab，否则用户看到的就是一片空白。
 */
watch(
  [friends, membersBySpace],
  () => {
    if (!open.value || manualTab.value) return
    const cur = tabs.value.find((t) => t.key === activeTab.value)
    if (cur && cur.count > 0) return
    const better = tabs.value.find((t) => t.count > 0)
    if (better) activeTab.value = better.key
  },
  { deep: true },
)
</script>

<template>
  <div ref="rootRef" class="pp" :class="{ open, disabled }">
    <div class="pp-box" @click="onBoxClick">
      <span v-for="u in selected" :key="u" class="pp-chip">
        {{ nameOf(u) }}
        <button type="button" class="pp-chip-x" v-tooltip="'移除'" @click.stop="remove(u)">
          <X :size="11" :stroke-width="2.4" />
        </button>
      </span>
      <span class="pp-input-wrap">
        <Search :size="12" class="pp-search-icon" />
        <input
          v-model="keyword"
          class="pp-input"
          :placeholder="selected.length ? '' : placeholder"
          :disabled="disabled"
          @focus="onInputFocus"
          @keydown.enter.prevent="toggleOpen"
        />
      </span>
      <ChevronDown :size="13" class="pp-caret" :class="{ flip: open }" />
    </div>

    <Teleport to="body">
      <div v-if="open" ref="panelRef" class="pp-panel gn-pop" :style="panelStyle">
      <div v-if="tabs.length > 1" class="pp-tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="pp-tab"
          :class="{ on: activeTab === t.key }"
          :title="t.label"
          @click="switchTab(t.key)"
        >
          <span class="pp-tab-label">{{ t.label }}</span>
          <span class="pp-tab-count">{{ t.count }}</span>
        </button>
      </div>

      <div class="pp-list gn-scroll">
        <!-- 好友：按我设定的分组展示，和团队 tab 的组织树口径一致 -->
        <template v-if="!isTeamTab">
          <template v-for="sec in friendSections" :key="sec.key">
            <button
              v-if="sec.name"
              type="button"
              class="pp-dept pp-friend-group"
              @click="toggleFriendGroup(sec.key)"
            >
              <ChevronRight
                :size="12"
                class="pp-chev"
                :class="{ on: isFriendGroupOpen(sec.key) }"
              />
              <Folder :size="12" class="pp-folder" />
              <span class="pp-name">{{ sec.name }}</span>
              <span class="pp-dept-count">{{ sec.people.length }}</span>
            </button>
            <template v-if="isFriendGroupOpen(sec.key)">
              <button
                v-for="p in sec.people"
                :key="p.username"
                type="button"
                class="pp-row pp-person"
                :class="{ on: selected.includes(p.username) }"
                @click="toggle(p.username)"
              >
                <span class="pp-check">
                  <Check v-if="selected.includes(p.username)" :size="11" :stroke-width="2.6" />
                </span>
                <span class="pp-avatar">
                  <img v-if="p.avatar" :src="p.avatar" alt="" />
                  <span v-else>{{ (p.name || '?').slice(0, 1) }}</span>
                </span>
                <span class="pp-name">{{ p.name }}</span>
                <span class="pp-sub">@{{ p.username }}</span>
              </button>
            </template>
          </template>
          <div v-if="!friendList.length" class="pp-empty">{{ emptyText }}</div>
        </template>

        <!-- 搜索：跨部门扁平出结果，路径放副标题 -->
        <template v-else-if="keyword.trim()">
          <button
            v-for="row in searchRows"
            :key="row.person.username"
            type="button"
            class="pp-row"
            :class="{ on: selected.includes(row.person.username) }"
            @click="toggle(row.person.username)"
          >
            <span class="pp-check">
              <Check v-if="selected.includes(row.person.username)" :size="11" :stroke-width="2.6" />
            </span>
            <span class="pp-avatar">
              <img v-if="row.person.avatar" :src="row.person.avatar" alt="" />
              <span v-else>{{ (row.person.name || '?').slice(0, 1) }}</span>
            </span>
            <span class="pp-name">{{ row.person.name }}</span>
            <span v-if="row.path" class="pp-path" :title="row.path">{{ row.path }}</span>
          </button>
          <div v-if="!searchRows.length" class="pp-empty">{{ emptyText }}</div>
        </template>

        <!-- 团队：部门可展开、人可勾选 -->
        <template v-else>
          <template v-for="row in treeRows" :key="row.key">
            <button
              v-if="row.kind === 'dept'"
              type="button"
              class="pp-dept"
              :class="{ open: row.open, ghost: !row.canOpen }"
              :style="indent(row.depth)"
              @click="row.canOpen && toggleDept(row.id)"
            >
              <ChevronRight :size="12" class="pp-chev" :class="{ on: row.open }" />
              <Folder :size="12" class="pp-folder" />
              <span class="pp-name">{{ row.name }}</span>
              <span class="pp-dept-count">{{ row.total }}</span>
            </button>
            <button
              v-else
              type="button"
              class="pp-row pp-person"
              :class="{ on: selected.includes(row.person.username) }"
              :style="indent(row.depth)"
              @click="toggle(row.person.username)"
            >
              <span class="pp-check">
                <Check v-if="selected.includes(row.person.username)" :size="11" :stroke-width="2.6" />
              </span>
              <span class="pp-avatar">
                <img v-if="row.person.avatar" :src="row.person.avatar" alt="" />
                <span v-else>{{ (row.person.name || '?').slice(0, 1) }}</span>
              </span>
              <span class="pp-name">{{ row.person.name }}</span>
              <span class="pp-sub">@{{ row.person.username }}</span>
            </button>
          </template>
          <div v-if="!treeRows.length" class="pp-empty">{{ emptyText }}</div>
        </template>
      </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pp {
  position: relative;
  flex: 1 1 220px;
  min-width: 180px;
}
.pp-box {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-height: 32px;
  padding: 3px 26px 3px 8px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg-soft);
  cursor: text;
}
.pp.open .pp-box {
  border-color: var(--gn-accent);
}
.pp.disabled .pp-box {
  opacity: 0.6;
  cursor: not-allowed;
}
.pp-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 150px;
  height: 22px;
  padding: 0 4px 0 7px;
  border-radius: 5px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 11.5px;
  white-space: nowrap;
}
.pp-chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.pp-chip-x:hover {
  background: rgba(0, 0, 0, 0.08);
}
.pp-input-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 70px;
  min-width: 60px;
}
.pp-search-icon {
  color: var(--gn-text-muted);
  flex: 0 0 auto;
}
.pp-input {
  flex: 1 1 auto;
  min-width: 40px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--gn-text);
  font-size: 12.5px;
  outline: none;
}
.pp-caret {
  position: absolute;
  right: 9px;
  color: var(--gn-text-muted);
  transition: transform 0.14s ease;
  pointer-events: none;
}
.pp-caret.flip {
  transform: rotate(180deg);
}
.pp-panel {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-md);
}
.pp-tabs {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  overflow-x: auto;
  margin-bottom: 4px;
  padding: 2px 2px 0;
  border-bottom: 1px solid var(--gn-border);
  scrollbar-width: none;
}
.pp-tabs::-webkit-scrollbar {
  display: none;
}
.pp-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  max-width: 150px;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 5px 5px 0 0;
  background: transparent;
  color: var(--gn-text-soft);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.pp-tab:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.pp-tab.on {
  border-bottom-color: var(--gn-accent);
  color: var(--gn-accent);
  font-weight: 600;
}
.pp-tab-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pp-tab-count {
  min-width: 14px;
  padding: 0 3px;
  border-radius: 99px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-muted);
  font-size: 10px;
  font-weight: 500;
  text-align: center;
}
.pp-tab.on .pp-tab-count {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.pp-list {
  max-height: var(--pp-list-max, 268px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 1px;
}
.pp-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 30px;
  padding: 0 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.pp-row:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.pp-row.on {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
/* 展开/收起时新行淡入一点，避免整块内容硬跳 */
.pp-person,
.pp-dept {
  animation: pp-row-in 0.14s ease;
}
@keyframes pp-row-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}
.pp-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  border: 1px solid var(--gn-border-strong);
  border-radius: 4px;
}
.pp-row.on .pp-check {
  border-color: var(--gn-accent);
  background: var(--gn-accent);
  color: var(--gn-bg);
}
.pp-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  background: var(--gn-bg-hover);
  font-size: 10px;
}
.pp-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pp-name {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pp-sub {
  margin-left: auto;
  font-size: 11px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
/* 搜索结果的部门路径：挤在右侧，太长就省略 */
.pp-path {
  margin-left: auto;
  max-width: 45%;
  font-size: 10.5px;
  color: var(--gn-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* ---------- 部门行：只能展开，不能勾选 ---------- */
.pp-dept {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  height: 28px;
  padding: 0 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.pp-dept:hover {
  background: var(--gn-bg-hover);
}
.pp-dept.ghost {
  cursor: default;
}
.pp-chev {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.pp-chev.on {
  transform: rotate(90deg);
}
.pp-dept.ghost .pp-chev {
  visibility: hidden;
}
.pp-folder {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
}
.pp-dept.open .pp-folder {
  color: var(--gn-accent);
}
.pp-dept .pp-name {
  font-weight: 500;
}
.pp-dept-count {
  margin-left: auto;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 99px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-muted);
  font-size: 10px;
  text-align: center;
}
.pp-empty {
  padding: 10px 8px;
  font-size: 12px;
  color: var(--gn-text-muted);
}
</style>
