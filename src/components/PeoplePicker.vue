<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown, Search, X } from 'lucide-vue-next'
import {
  getSpaceOrg,
  listFriends,
  type FriendInfo,
  type SpaceMemberInfo,
} from '@/api/features'

/**
 * 人员多选器：可从好友、当前团队成员中选择。
 * 值统一为用户名字符串，后端邀请/分享接口都以用户名定位用户。
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
}

const FRIENDS_TAB = '__friends__'

const open = ref(false)
const dropUp = ref(false)
const keyword = ref('')
const rootRef = ref<HTMLElement | null>(null)
const friends = ref<Person[]>([])
const friendsLoaded = ref(false)
/** 按空间缓存成员，切换 tab 不重复请求 */
const membersBySpace = ref<Record<string, Person[]>>({})
const loadingSpace = ref('')
/** 当前 tab：FRIENDS_TAB 或空间 id */
const activeTab = ref(FRIENDS_TAB)

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

const visible = (rows: Person[]) => rows.filter((p) => !excludeSet.value.has(p.username))

const tabs = computed(() => {
  const out: { key: string; label: string; count: number }[] = []
  if (props.source !== 'team') {
    out.push({ key: FRIENDS_TAB, label: '好友', count: visible(friends.value).length })
  }
  if (props.source !== 'friends') {
    for (const s of teamSpaces.value) {
      out.push({ key: s.id, label: s.name, count: visible(membersBySpace.value[s.id] ?? []).length })
    }
  }
  return out
})

const pool = computed<Person[]>(() => {
  const all = [friends.value, ...Object.values(membersBySpace.value)].flat()
  const seen = new Set<string>()
  return all.filter((p) => (seen.has(p.username) ? false : (seen.add(p.username), true)))
})

const nameOf = (username: string) => pool.value.find((p) => p.username === username)?.name || username

function matches(p: Person): boolean {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return true
  return p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)
}

/** 只渲染当前 tab 的成员，团队再多也不用来回滚动 */
const currentRows = computed<Person[]>(() =>
  activeTab.value === FRIENDS_TAB ? friends.value : (membersBySpace.value[activeTab.value] ?? []),
)

const currentList = computed<Person[]>(() => visible(currentRows.value).filter(matches))

/** 候选池里全是已有成员：提示去「新建成员」，而不是说「暂无成员」 */
const allAlreadyIn = computed(
  () => currentRows.value.length > 0 && !visible(currentRows.value).length,
)

const currentTabLabel = computed(
  () => tabs.value.find((t) => t.key === activeTab.value)?.label ?? '成员',
)

const emptyText = computed(() => {
  if (allAlreadyIn.value) return '这些人已在团队里，新人请用「新建成员」'
  return activeTab.value === FRIENDS_TAB
    ? '还没有好友，可前往「好友」页添加'
    : `「${currentTabLabel.value}」暂无成员`
})

function toPerson(v: FriendInfo | SpaceMemberInfo): Person {
  return { id: v.id, username: v.username, name: v.name, avatar: v.avatar }
}

async function loadFriends() {
  if (friendsLoaded.value || props.source === 'team') return
  friendsLoaded.value = true
  try {
    const rows = await listFriends()
    friends.value = rows.filter((r) => r.username).map(toPerson)
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
    membersBySpace.value = { ...membersBySpace.value, [id]: org.members.map(toPerson) }
  } catch {
    /* 失败保持空列表，切换 tab 会重试 */
  } finally {
    loadingSpace.value = ''
  }
}

/** 展开面板时一次性把好友与各团队成员都取回来，tab 上的人数才不会是 0 */
function loadAll() {
  if (props.source !== 'team') void loadFriends()
  if (props.source !== 'friends') {
    for (const s of teamSpaces.value) void loadSpace(s.id)
  }
}

function switchTab(key: string) {
  if (activeTab.value === key) return
  activeTab.value = key
}

function toggleOpen() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    measureDrop()
    loadAll()
  }
}

/** 下方空间不足时向上展开，避免面板被视口或对话框底边裁掉 */
function measureDrop() {
  const el = rootRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const below = window.innerHeight - r.bottom
  dropUp.value = below < 300 && r.top > below
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
  if (rootRef.value?.contains(e.target as Node)) return
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

    <div v-if="open" class="pp-panel gn-pop" :class="{ up: dropUp }">
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

      <div class="pp-list">
        <button
          v-for="p in currentList"
          :key="p.username"
          type="button"
          class="pp-row"
          :class="{ on: selected.includes(p.username) }"
          @click="toggle(p.username)"
        >
          <span class="pp-check"><Check v-if="selected.includes(p.username)" :size="11" :stroke-width="2.6" /></span>
          <span class="pp-avatar">
            <img v-if="p.avatar" :src="p.avatar" alt="" />
            <span v-else>{{ (p.name || '?').slice(0, 1) }}</span>
          </span>
          <span class="pp-name">{{ p.name }}</span>
          <span class="pp-sub">@{{ p.username }}</span>
        </button>

        <div v-if="!currentList.length" class="pp-empty">
          {{ keyword.trim() ? '没有匹配的成员' : emptyText }}
        </div>
      </div>
    </div>
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
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  width: max(100%, 280px);
  padding: 4px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-md);
}
.pp-panel.up {
  top: auto;
  bottom: calc(100% + 4px);
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
  max-height: 240px;
  overflow-y: auto;
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
.pp-empty {
  padding: 10px 8px;
  font-size: 12px;
  color: var(--gn-text-muted);
}
</style>