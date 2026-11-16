<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown, Search, X } from 'lucide-vue-next'
import GnSelect from './GnSelect.vue'
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
  }>(),
  { source: 'both', spaceId: '', spaces: () => [], placeholder: '选择成员', disabled: false },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void }>()

interface Person {
  id: string
  username: string
  name: string
  avatar: string | null
}

const open = ref(false)
const keyword = ref('')
const loaded = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const friends = ref<Person[]>([])
const teamMembers = ref<Person[]>([])

const selected = computed(() => props.modelValue ?? [])

const activeSpaceId = ref('')
const spaceOptions = computed(() => props.spaces.map((s) => ({ value: s.id, label: s.name })))
const currentSpaceId = computed(() => props.spaceId || activeSpaceId.value)

const pool = computed<Person[]>(() => {
  const all = [...friends.value, ...teamMembers.value]
  const seen = new Set<string>()
  return all.filter((p) => (seen.has(p.username) ? false : (seen.add(p.username), true)))
})

const nameOf = (username: string) => pool.value.find((p) => p.username === username)?.name || username

function matches(p: Person): boolean {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return true
  return p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)
}

const friendUsers = computed(() => new Set(friends.value.map((p) => p.username)))
const friendList = computed(() => (props.source === 'team' ? [] : friends.value.filter(matches)))
// 好友同时也在团队里时只出现在「好友」分组，避免重复
const teamList = computed(() =>
  props.source === 'friends'
    ? []
    : teamMembers.value.filter((p) => !friendUsers.value.has(p.username)).filter(matches),
)

function toPerson(v: FriendInfo | SpaceMemberInfo): Person {
  return { id: v.id, username: v.username, name: v.name, avatar: v.avatar }
}

async function load() {
  if (loaded.value) return
  loaded.value = true
  try {
    const tasks: Promise<void>[] = []
    if (props.source !== 'team') {
      tasks.push(
        listFriends().then((rows) => {
          friends.value = rows.filter((r) => r.username).map(toPerson)
        }),
      )
    }
    if (props.source !== 'friends' && currentSpaceId.value) {
      tasks.push(
        getSpaceOrg(currentSpaceId.value).then((org) => {
          teamMembers.value = org.members.map(toPerson)
        }),
      )
    }
    await Promise.all(tasks)
  } catch {
    /* 加载失败保持空列表，用户可重试 */
    loaded.value = false
  }
}

function toggleOpen() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) void load()
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
    if (!activeSpaceId.value || !spaceOptions.value.some((o) => o.value === activeSpaceId.value)) {
      activeSpaceId.value = props.spaceId || props.spaces[0]?.id || ''
    }
    loaded.value = false
    friends.value = []
    teamMembers.value = []
    if (open.value) void load()
  },
  { immediate: true },
)

onMounted(() => document.addEventListener('mousedown', onDocDown, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown, true))
</script>

<template>
  <div ref="rootRef" class="pp" :class="{ open, disabled }">
    <div class="pp-box" @click="toggleOpen">
      <span v-for="u in selected" :key="u" class="pp-chip">
        {{ nameOf(u) }}
        <button type="button" class="pp-chip-x" @click.stop="remove(u)">
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
          @focus="!open && toggleOpen()"
          @keydown.enter.prevent="toggleOpen"
        />
      </span>
      <ChevronDown :size="13" class="pp-caret" :class="{ flip: open }" />
    </div>

    <div v-if="open" class="pp-panel gn-pop">
      <div v-if="source !== 'friends' && spaceOptions.length > 1" class="pp-space">
        <GnSelect v-model="activeSpaceId" :options="spaceOptions" :min-width="150" />
      </div>
      <template v-if="friendList.length">
        <div class="pp-group-title">好友</div>
        <button
          v-for="p in friendList"
          :key="`f-${p.id}`"
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
      </template>

      <template v-if="teamList.length">
        <div class="pp-group-title">团队成员</div>
        <button
          v-for="p in teamList"
          :key="`t-${p.id}`"
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
      </template>

      <div v-if="!friendList.length && !teamList.length" class="pp-empty">
        {{ keyword.trim() ? '没有匹配的成员' : source === 'friends' ? '还没有好友，可前往「好友」页添加' : '暂无可选成员' }}
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
  width: max(100%, 260px);
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-md);
}
.pp-group-title {
  padding: 6px 8px 3px;
  font-size: 11px;
  color: var(--gn-text-muted);
}
.pp-space {
  display: flex;
  padding: 4px 4px 6px;
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