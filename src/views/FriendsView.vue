<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowRightLeft,
  Check,
  ChevronRight,
  Folder,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  UserPlus,
  X,
} from 'lucide-vue-next'
import {
  UNGROUPED,
  acceptFriendRequest,
  blockFriend,
  createFriendGroup,
  declineFriendRequest,
  deleteFriendGroup,
  errorText,
  listFriendGroups,
  listFriendRequests,
  listFriends,
  listSentFriendRequests,
  mergeFriendGroup,
  removeFriend,
  renameFriendGroup,
  searchUsers,
  sendFriendRequest,
  setDefaultFriendGroup,
  setFriendGroup,
  type FriendInfo,
  type FriendGroupInfo,
  type FriendRequestInfo,
  type UserSearchItem,
} from '@/api/features'
import GnConfirm from '@/components/GnConfirm.vue'
import GnSelect from '@/components/GnSelect.vue'

const friends = ref<FriendInfo[]>([])
const groups = ref<FriendGroupInfo[]>([])
const incoming = ref<FriendRequestInfo[]>([])
const outgoing = ref<FriendRequestInfo[]>([])
const keyword = ref('')

/** 加好友面板：独立的全平台搜索，和上面的「过滤我的好友」分开 */
const addOpen = ref(false)
const addKeyword = ref('')
const addResults = ref<UserSearchItem[]>([])
const addSearched = ref(false)
const addTimer: { id?: ReturnType<typeof setTimeout>; seq: number } = { seq: 0 }

const loading = ref(true)
const busy = ref(false)
const err = ref('')

/** 一次性轻提示（迁移成员等），2.6s 自动消失 */
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function flash(text: string) {
  notice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 2600)
}

const confirming = ref<{ id: string; kind: 'remove' | 'block' } | null>(null)

/** 加好友时选的分组；__none__ 表示显式放进「未分组」 */
const addGroupId = ref<string>(UNGROUPED)
const addGroupTouched = ref(false)
const acceptGroups = ref<Record<string, string>>({})

/** 所有选组入口共用：未分组永远可选，哪怕当前没有正式分组 */
const groupOptions = computed(() => [
  { value: UNGROUPED, label: '未分组' },
  ...groups.value.map((g) => ({ value: g.id, label: g.name })),
])
const defaultGroupValue = computed(
  () => groups.value.find((g) => g.isDefault)?.id ?? UNGROUPED,
)

const incomingCount = computed(() => incoming.value.length)
/** 右侧栏只在有待处理 / 已发出申请时才占位，否则好友列表铺满整行 */
const hasSide = computed(() => incomingCount.value > 0 || outgoing.value.length > 0)

async function refresh() {
  const [f, i, o, g] = await Promise.all([
    listFriends(),
    listFriendRequests(),
    listSentFriendRequests(),
    listFriendGroups(),
  ])
  friends.value = f
  incoming.value = i
  outgoing.value = o
  groups.value = g
  // 默认组来自后端配置；用户手动改过这一批次的选择就不再覆盖
  if (!addGroupTouched.value) addGroupId.value = defaultGroupValue.value
  const fresh: Record<string, string> = {}
  for (const r of i) fresh[r.id] = acceptGroups.value[r.id] || defaultGroupValue.value
  acceptGroups.value = fresh
}

async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  err.value = ''
  try {
    await fn()
  } catch (e) {
    err.value = errorText(e)
  } finally {
    busy.value = false
  }
}

/** 搜索只过滤「我的好友」列表：输入后 220ms 防抖再应用，快速输入不会卡 */
const filterText = ref('')
let filterTimer: ReturnType<typeof setTimeout> | undefined

watch(keyword, () => {
  if (filterTimer) clearTimeout(filterTimer)
  const q = keyword.value.trim()
  filterTimer = setTimeout(() => (filterText.value = q), 220)
})

function clearSearch() {
  if (filterTimer) clearTimeout(filterTimer)
  keyword.value = ''
  filterText.value = ''
}

onBeforeUnmount(() => {
  if (filterTimer) clearTimeout(filterTimer)
  if (addTimer.id) clearTimeout(addTimer.id)
})

function openAdd() {
  addOpen.value = !addOpen.value
  if (!addOpen.value) closeAdd()
}

function closeAdd() {
  addOpen.value = false
  addKeyword.value = ''
  addResults.value = []
  addSearched.value = false
}

/** 加好友面板的全平台搜索：300ms 防抖 + 序号丢弃过期结果 */
function doAddSearch() {
  if (addTimer.id) clearTimeout(addTimer.id)
  const q = addKeyword.value.trim()
  if (!q) {
    addResults.value = []
    addSearched.value = false
    return
  }
  const seq = ++addTimer.seq
  err.value = ''
  void (async () => {
    try {
      const found = await searchUsers(q)
      if (seq !== addTimer.seq) return
      addResults.value = found
      addSearched.value = true
    } catch (e) {
      if (seq !== addTimer.seq) return
      err.value = errorText(e)
    }
  })()
}

watch(addKeyword, () => {
  if (addTimer.id) clearTimeout(addTimer.id)
  if (!addKeyword.value.trim()) {
    ++addTimer.seq
    addResults.value = []
    addSearched.value = false
    return
  }
  addTimer.id = setTimeout(doAddSearch, 300)
})

function add(item: UserSearchItem) {
  return run(async () => {
    await sendFriendRequest(item.username, undefined, addGroupId.value)
    addResults.value = addResults.value.map((x) =>
      x.id === item.id ? { ...x, relation: 'pending' } : x,
    )
    await refresh()
  })
}

function accept(id: string) {
  return run(async () => {
    await acceptFriendRequest(id, acceptGroups.value[id] || defaultGroupValue.value)
    await refresh()
  })
}

function decline(id: string) {
  return run(async () => {
    await declineFriendRequest(id)
    await refresh()
  })
}

function ask(id: string, kind: 'remove' | 'block') {
  confirming.value = { id, kind }
}

function cancelConfirm() {
  confirming.value = null
}

function remove(id: string) {
  confirming.value = null
  return run(async () => {
    await removeFriend(id)
    await refresh()
  })
}

function block(id: string) {
  confirming.value = null
  return run(async () => {
    await blockFriend(id)
    await refresh()
  })
}

/* ---------------- 好友分组 ---------------- */

interface FriendSection {
  key: string
  id: string | null
  name: string
  count: number
  friends: FriendInfo[]
  isNone: boolean
}

/** 搜索框只过滤列表里的人：昵称 / 用户名不区分大小写命中即可 */
function matchesFilter(f: FriendInfo): boolean {
  const q = filterText.value.toLowerCase()
  if (!q) return true
  return f.name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q)
}

/** 分组 + 落单的人。「未分组」只在真的有人时出现，空了就整组消失 */
const friendSections = computed<FriendSection[]>(() => {
  const visible = friends.value.filter(matchesFilter)
  const out: FriendSection[] = groups.value.map((g) => {
    const list = visible.filter((f) => f.groupId === g.id)
    return {
      key: g.id,
      id: g.id,
      name: g.name,
      // 搜索时人数跟着过滤结果走，没命中就整组不显示
      count: filterText.value ? list.length : g.count,
      friends: list,
      isNone: false,
    }
  })
  const known = new Set(groups.value.map((g) => g.id))
  const rest = visible.filter((f) => !f.groupId || !known.has(f.groupId))
  // 没建过分组时，全体好友都在未分组里；建过之后它是显式选择的结果，没人就不显示
  if (rest.length) {
    out.push({ key: UNGROUPED, id: null, name: '未分组', count: rest.length, friends: rest, isNone: true })
  }
  return filterText.value ? out.filter((s) => s.friends.length) : out
})

/** 过滤时展示命中数，无过滤时展示总数 */
const visibleFriendCount = computed(() =>
  filterText.value ? friends.value.filter(matchesFilter).length : friends.value.length,
)

const groupExpanded = ref<Record<string, boolean>>({})
const isGroupOpen = (key: string) => groupExpanded.value[key] !== false
function toggleGroup(key: string) {
  groupExpanded.value = { ...groupExpanded.value, [key]: !isGroupOpen(key) }
}

/**
 * 列表扁平化成「分组头 / 好友行 / 空组提示」三种行，模板只写一份好友行。
 * 好友行带上所属分组，让「拖到组成员上」也能落进那个分组。
 */
type FriendRowItem =
  | { kind: 'section'; key: string; section: FriendSection }
  | { kind: 'friend'; key: string; friend: FriendInfo; section: FriendSection | null }
  | { kind: 'hint'; key: string; section: FriendSection }

const friendRows = computed<FriendRowItem[]>(() => {
  const out: FriendRowItem[] = []
  for (const s of friendSections.value) {
    out.push({ kind: 'section', key: `s-${s.key}`, section: s })
    if (!isGroupOpen(s.key)) continue
    if (!s.friends.length) {
      out.push({ kind: 'hint', key: `h-${s.key}`, section: s })
      continue
    }
    for (const f of s.friends) {
      out.push({ kind: 'friend', key: `f-${s.key}-${f.id}`, friend: f, section: s })
    }
  }
  return out
})

const creatingGroup = ref(false)
const groupDraftName = ref('')
const editingGroupId = ref('')
const editingGroupName = ref('')
const groupToDelete = ref<FriendGroupInfo | null>(null)
const groupToMerge = ref<FriendGroupInfo | null>(null)
const mergeTarget = ref('')

function startCreateGroup() {
  creatingGroup.value = true
  groupDraftName.value = ''
}

function saveCreateGroup() {
  const name = groupDraftName.value.trim()
  if (!name) return
  const value = name
  creatingGroup.value = false
  groupDraftName.value = ''
  void run(async () => {
    await createFriendGroup(value)
    await refresh()
  })
}

/** 空着失焦就收掉输入行；有内容则留着，避免光标移开一瞬间辛苦打的字没了 */
function onCreateGroupBlur() {
  if (!groupDraftName.value.trim()) creatingGroup.value = false
}

function askRenameGroup(section: FriendSection) {
  // 「未分组」改名 = 直接转成正式组，原来的人一起带过去
  editingGroupId.value = section.key
  editingGroupName.value = section.isNone ? '' : section.name
}

function askDeleteGroup(section: FriendSection) {
  const g = groups.value.find((x) => x.id === section.id)
  if (!g || g.count) return
  groupToDelete.value = g
}

function askMergeGroup(section: FriendSection) {
  const g = groups.value.find((x) => x.id === section.id)
  if (!g || !g.count) return
  groupToMerge.value = g
  // 目标只能是不能是「未分组」哨兵：默认组可用就优先，否则取第一个别的真实分组。
  // defaultGroupValue 在没有默认组时会回落到 UNGROUPED（__none__），直接塞进选择器
  // 会因为选项里被过滤掉而把内部标识原样显示出来。
  const def = groups.value.find((x) => x.isDefault)?.id
  const other = groups.value.find((x) => x.id !== g.id)?.id ?? ''
  mergeTarget.value = def && def !== g.id ? def : other
}

function confirmMergeGroup() {
  const from = groupToMerge.value
  if (!from || !mergeTarget.value || mergeTarget.value === from.id) return
  groupToMerge.value = null
  void run(async () => {
    const res = await mergeFriendGroup(from.id, mergeTarget.value)
    await refresh()
    const targetName =
      res.targetGroupId === UNGROUPED
        ? '未分组'
        : (groups.value.find((g) => g.id === res.targetGroupId)?.name ?? '目标分组')
    flash(`已把 ${res.moved} 位好友移入「${targetName}」`)
  })
}

function setDefaultGroup(id: string, isDefault: boolean) {
  void run(async () => {
    await setDefaultFriendGroup(id, isDefault)
    await refresh()
  })
}

function startRenameGroup(g: FriendGroupInfo) {
  editingGroupId.value = g.id
  editingGroupName.value = g.name
}

function saveRenameGroup() {
  const id = editingGroupId.value
  const name = editingGroupName.value.trim()
  if (!id || !name) return
  editingGroupId.value = ''
  void run(async () => {
    if (id === UNGROUPED) {
      const none = friendSections.value.find((s) => s.isNone)
      await createFriendGroup(
        name,
        (none?.friends ?? []).map((f) => f.id),
      )
      flash(`「未分组」已改名为「${name}」，${none?.friends.length ?? 0} 位好友一起迁入`)
    } else {
      await renameFriendGroup(id, name)
    }
    await refresh()
  })
}

function onRenameGroupBlur() {
  if (!editingGroupName.value.trim()) editingGroupId.value = ''
}

function confirmDeleteGroup() {
  const g = groupToDelete.value
  groupToDelete.value = null
  if (!g) return
  void run(async () => {
    await deleteFriendGroup(g.id)
    await refresh()
  })
}

/** 好友拖拽用私有 MIME，和组织树的成员拖拽互不干扰 */
const FRIEND_MIME = 'application/x-ginkgo-friend'
const draggingFriendId = ref('')
const dropTarget = ref('')

function onFriendDragStart(f: FriendInfo, e: DragEvent) {
  draggingFriendId.value = f.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(FRIEND_MIME, f.id)
  }
}

function onFriendDragEnd() {
  draggingFriendId.value = ''
  dropTarget.value = ''
}

function onGroupDragOver(section: FriendSection, e: DragEvent) {
  if (!draggingFriendId.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTarget.value = section.key
}

function onGroupDrop(section: FriendSection, e: DragEvent) {
  e.preventDefault()
  const id = draggingFriendId.value || e.dataTransfer?.getData(FRIEND_MIME)
  onFriendDragEnd()
  if (!id) return
  const f = friends.value.find((x) => x.id === id)
  if (!f || f.groupId === section.id) return
  void run(async () => {
    await setFriendGroup(id, section.id)
    await refresh()
  })
}

function relationText(relation: UserSearchItem['relation']) {
  switch (relation) {
    case 'accepted':
      return '已是好友'
    case 'pending':
      return '已发送申请'
    case 'blocked':
      return '已拉黑'
    case 'rejected':
      return '曾被拒绝'
    default:
      return ''
  }
}

function avatarText(name: string) {
  return (name || '?').slice(0, 1).toUpperCase()
}

onMounted(async () => {
  try {
    await refresh()
  } catch (e) {
    err.value = errorText(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="fr-page gn-scroll">
    <div class="fr-inner">
      <header class="fr-head">
        <div class="fr-head-text">
          <div class="fr-title-line">
            <h1>好友</h1>
            <span class="fr-badge">{{ friends.length }}</span>
            <span v-if="incomingCount" class="fr-badge warn">{{ incomingCount }} 条待处理</span>
          </div>
          <p class="fr-desc">好友关系只用于文档分享与协作邀请，不会自动获得任何文档权限。</p>
        </div>
        <div class="fr-search">
          <div class="fr-search-box">
            <Search :size="13" class="fr-search-icon" />
            <input
              v-model="keyword"
              placeholder="过滤我的好友（昵称 / 用户名）"
            />
            <button
              v-if="keyword"
              type="button"
              class="fr-search-clear"
              v-tooltip="'清空过滤'"
              @click="clearSearch"
            >
              <X :size="12" />
            </button>
          </div>
          <button
            type="button"
            class="fr-btn primary"
            :class="{ on: addOpen }"
            @click="openAdd"
          >
            <UserPlus :size="13" />加好友
          </button>
        </div>
      </header>

      <div class="fr-cols" :class="{ 'has-side': hasSide }">
        <div class="fr-main-col">
          <section v-if="addOpen" class="fr-card">
            <div class="fr-card-head">
              <UserPlus :size="14" />
              <span>加好友</span>
              <label class="fr-add-group">
                加好友后放入
                <GnSelect
                  v-model="addGroupId"
                  :options="groupOptions"
                  :min-width="104"
                  @update:model-value="addGroupTouched = true"
                />
              </label>
              <button type="button" class="fr-head-link" @click="closeAdd">关闭</button>
            </div>
            <div class="fr-add-search">
              <div class="fr-search-box">
                <Search :size="13" class="fr-search-icon" />
                <input v-model="addKeyword" placeholder="搜索平台用户名或昵称" />
              </div>
            </div>
            <div v-if="addResults.length" class="fr-list">
              <div v-for="u in addResults" :key="u.id" class="fr-row">
                <div class="fr-avatar">
                  <img v-if="u.avatar" :src="u.avatar" alt="" />
                  <span v-else>{{ avatarText(u.name) }}</span>
                </div>
                <div class="fr-main">
                  <div class="fr-name">{{ u.name }}</div>
                  <div class="fr-sub">@{{ u.username }}</div>
                </div>
                <span v-if="u.relation" class="fr-tag">{{ relationText(u.relation) }}</span>
                <button v-else type="button" class="fr-btn primary" :disabled="busy" @click="add(u)">
                  <UserPlus :size="12" />加好友
                </button>
              </div>
            </div>
            <p v-else-if="addSearched && !loading" class="fr-empty">没有找到匹配的用户，换个用户名或昵称再试试。</p>
            <p v-else class="fr-empty">输入用户名或昵称，找到后即可发送好友申请。</p>
          </section>

          <section class="fr-card">
            <div class="fr-card-head">
              <span>我的好友</span>
              <span class="fr-count">{{ visibleFriendCount }}</span>
              <button
                v-if="!creatingGroup && friends.length"
                type="button"
                class="fr-head-link with-icon"
                @click="startCreateGroup"
              >
                <Plus :size="12" />新建分组
              </button>
            </div>
            <div v-if="creatingGroup" class="fr-group-create">
              <input
                v-model="groupDraftName"
                class="fr-input"
                maxlength="20"
                placeholder="分组名称"
                @keydown.enter.prevent="saveCreateGroup"
                @keydown.esc.prevent="creatingGroup = false"
                @blur="onCreateGroupBlur"
              />
              <button
                type="button"
                class="fr-btn primary"
                :disabled="busy || !groupDraftName.trim()"
                @mousedown.prevent
                @click="saveCreateGroup"
              >
                确定
              </button>
              <button type="button" class="fr-btn" @mousedown.prevent @click="creatingGroup = false">取消</button>
            </div>
            <div v-if="loading" class="fr-empty">加载中…</div>
            <div v-else-if="friends.length" class="fr-list">
              <template
                v-for="row in friendRows"
                :key="row.key"
              >
                <!-- 分组头：本身就是一个拖拽落点 -->
                <div
                  v-if="row.kind === 'section'"
                  class="fr-group-head"
                  :class="{ 'is-drop': dropTarget === row.section.key }"
                  @dragover="onGroupDragOver(row.section, $event)"
                  @dragleave="dropTarget === row.section.key && (dropTarget = '')"
                  @drop="onGroupDrop(row.section, $event)"
                >
                  <button type="button" class="fr-group-toggle" @click="toggleGroup(row.section.key)">
                    <ChevronRight
                      :size="12"
                      class="fr-group-chev"
                      :class="{ open: isGroupOpen(row.section.key) }"
                    />
                    <Folder :size="13" />
                    <input
                      v-if="editingGroupId === row.section.key"
                      v-model="editingGroupName"
                      class="fr-input fr-group-edit"
                      maxlength="20"
                      @click.stop
                      @keydown.enter.prevent="saveRenameGroup"
                      @keydown.esc.prevent="editingGroupId = ''"
                      @blur="onRenameGroupBlur"
                    />
                    <span v-else class="fr-group-name">{{ row.section.name }}</span>
                    <span v-if="!row.section.isNone && groups.find((g) => g.id === row.section.id)?.isDefault" class="fr-default-tag">
                      默认
                    </span>
                    <span class="fr-group-count">{{ row.section.count }}</span>
                  </button>
                  <div class="fr-group-ops">
                    <button
                      type="button"
                      class="fr-group-act"
                      v-tooltip="row.section.isNone ? '改成正式分组（里面的人一起迁入）' : '重命名分组'"
                      @click="askRenameGroup(row.section)"
                    >
                      <Pencil :size="12" />
                    </button>
                    <template v-if="!row.section.isNone">
                      <button
                        type="button"
                        class="fr-group-act"
                        :class="{ on: groups.find((g) => g.id === row.section.id)?.isDefault }"
                        v-tooltip="
                          groups.find((g) => g.id === row.section.id)?.isDefault
                            ? '取消默认：新加的好友将归入未分组'
                            : '设为默认：新加的好友放进这个组'
                        "
                        @click="setDefaultGroup(row.section.id ?? '', !groups.find((g) => g.id === row.section.id)?.isDefault)"
                      >
                        <Star :size="12" :fill="groups.find((g) => g.id === row.section.id)?.isDefault ? 'currentColor' : 'none'" />
                      </button>
                      <button
                        v-if="row.section.count"
                        type="button"
                        class="fr-group-act"
                        v-tooltip="'把这个组的所有好友一键移入其他分组'"
                        @click="askMergeGroup(row.section)"
                      >
                        <ArrowRightLeft :size="12" />
                      </button>
                      <span
                        class="fr-group-act-wrap"
                        v-tooltip="row.section.count ? '组里还有人，请先移到其他分组' : '删除分组'"
                      >
                        <button
                          type="button"
                          class="fr-group-act danger"
                          :class="{ 'is-disabled': !!row.section.count }"
                          :disabled="!!row.section.count"
                          @click="askDeleteGroup(row.section)"
                        >
                          <Trash2 :size="12" />
                        </button>
                      </span>
                    </template>
                  </div>
                </div>

                <!-- 好友行：拖到别的分组头上即可改分组 -->
                <div
                  v-else-if="row.kind === 'friend'"
                  class="fr-row is-friend"
                  :class="{
                    'is-dragging': draggingFriendId === row.friend.id,
                    'is-drop': !!row.section && dropTarget === row.section.key,
                  }"
                  :draggable="groups.length > 0"
                  @dragstart="onFriendDragStart(row.friend, $event)"
                  @dragend="onFriendDragEnd"
                  @dragover="row.section && onGroupDragOver(row.section, $event)"
                  @drop="row.section && onGroupDrop(row.section, $event)"
                >
                  <GripVertical v-if="groups.length" :size="12" class="fr-grip" aria-hidden="true" />
                  <div class="fr-avatar">
                    <img v-if="row.friend.avatar" :src="row.friend.avatar" alt="" />
                    <span v-else>{{ avatarText(row.friend.name) }}</span>
                  </div>
                  <div class="fr-main">
                    <div class="fr-name">{{ row.friend.name }}</div>
                    <div class="fr-sub">@{{ row.friend.username }}</div>
                  </div>
                  <div v-if="confirming?.id === row.friend.id" class="fr-ops is-confirm">
                    <span class="fr-confirm-text"
                      >确认{{ confirming.kind === 'remove' ? '解除好友' : '拉黑' }}？</span
                    >
                    <button
                      type="button"
                      class="fr-btn danger"
                      :disabled="busy"
                      @click="confirming.kind === 'remove' ? remove(row.friend.id) : block(row.friend.id)"
                    >
                      确认
                    </button>
                    <button type="button" class="fr-btn" :disabled="busy" @click="cancelConfirm">取消</button>
                  </div>
                  <div v-else class="fr-ops">
                    <button
                      type="button"
                      class="fr-act"
                      :disabled="busy"
                      v-tooltip="'解除好友关系'"
                      @click="ask(row.friend.id, 'remove')"
                    >
                      解除
                    </button>
                    <button
                      type="button"
                      class="fr-act"
                      :disabled="busy"
                      v-tooltip="'拉黑后不再接收对方的申请'"
                      @click="ask(row.friend.id, 'block')"
                    >
                      拉黑
                    </button>
                  </div>
                </div>

                <!-- 空分组：给拖拽一个明确的落点 -->
                <div
                  v-else
                  class="fr-group-hint"
                  :class="{ 'is-drop': dropTarget === row.section.key }"
                  @dragover="onGroupDragOver(row.section, $event)"
                  @dragleave="dropTarget === row.section.key && (dropTarget = '')"
                  @drop="onGroupDrop(row.section, $event)"
                >
                  把好友拖到这里
                </div>
              </template>
            </div>
            <div v-else-if="filterText" class="fr-empty-box">
              <Search :size="16" />
              <p>没有匹配「{{ filterText }}」的好友，换个关键词试试。</p>
            </div>
            <div v-else class="fr-empty-box">
              <UserPlus :size="16" />
              <p>还没有好友。点右上角「加好友」搜索用户名发送申请，通过后即可在分享面板直接邀请。</p>
            </div>
          </section>
        </div>

        <aside v-if="hasSide" class="fr-side-col">
          <!-- 没有待处理申请就整块不出现，避免右侧常驻一张空卡 -->
          <section v-if="incomingCount" class="fr-card">
            <div class="fr-card-head">
              <span>好友申请</span>
              <span class="fr-count">{{ incomingCount }}</span>
            </div>
            <div class="fr-list">
              <div v-for="r in incoming" :key="r.id" class="fr-row is-request">
                <div class="fr-avatar">
                  <img v-if="r.from?.avatar" :src="r.from.avatar" alt="" />
                  <span v-else>{{ avatarText(r.from?.name ?? '?') }}</span>
                </div>
                <div class="fr-main">
                  <div class="fr-name">{{ r.from?.name }}</div>
                  <div class="fr-sub">{{ r.message || '请求添加你为好友' }}</div>
                  <div class="fr-request-ops">
                    <GnSelect
                      v-model="acceptGroups[r.id]"
                      :options="groupOptions"
                      :min-width="96"
                      v-tooltip="'同意后把对方放进这个分组'"
                    />
                    <button type="button" class="fr-btn primary" :disabled="busy" @click="accept(r.id)">
                      <Check :size="12" />同意
                    </button>
                    <button type="button" class="fr-btn" :disabled="busy" @click="decline(r.id)">拒绝</button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section v-if="outgoing.length" class="fr-card">
            <div class="fr-card-head">
              <span>已发出的申请</span>
              <span class="fr-count">{{ outgoing.length }}</span>
            </div>
            <div class="fr-list">
              <div v-for="r in outgoing" :key="r.id" class="fr-row">
                <div class="fr-avatar">{{ avatarText(r.to?.name ?? '?') }}</div>
                <div class="fr-main">
                  <div class="fr-name">{{ r.to?.name }}</div>
                  <div class="fr-sub">等待对方处理</div>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <p v-if="err" class="fr-err">{{ err }}</p>
      <p v-if="notice" class="fr-notice">{{ notice }}</p>
    </div>

    <GnConfirm
      :open="!!groupToDelete"
      title="删除分组"
      :message="`删除「${groupToDelete?.name ?? ''}」？`"
      detail="这个分组里没有好友，删除后不会影响任何人。"
      confirm-text="删除分组"
      tone="danger"
      icon="trash"
      @confirm="confirmDeleteGroup"
      @cancel="groupToDelete = null"
    />

    <GnConfirm
      :open="!!groupToMerge"
      title="移出分组"
      :message="`把「${groupToMerge?.name ?? ''}」里的 ${groupToMerge?.count ?? 0} 位好友移到：`"
      detail="可选「未分组」或具体分组；迁移后原分组会被删除，好友本身不会受影响。"
      confirm-text="确认移入"
      :confirm-disabled="!mergeTarget || mergeTarget === groupToMerge?.id"
      @confirm="confirmMergeGroup"
      @cancel="groupToMerge = null"
    >
      <template #body>
        <div class="fr-merge-field">
          <span>目标分组</span>
          <GnSelect
            v-model="mergeTarget"
            :options="groupOptions.filter((o) => o.value !== groupToMerge?.id)"
            :min-width="150"
            :z-index="3100"
          />
        </div>
      </template>
    </GnConfirm>
  </section>
</template>

<style scoped>
.fr-page {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}
.fr-inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 30px 32px 80px;
}

/* ---------- 顶部 ---------- */
.fr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.fr-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
.fr-title-line h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  color: var(--gn-text);
}
.fr-badge {
  padding: 1px 7px;
  border-radius: 99px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 11.5px;
}
.fr-badge.warn {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.fr-desc {
  margin: 0;
  max-width: 560px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--gn-text-soft);
}
.fr-search {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 1 360px;
  min-width: 260px;
}
.fr-search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg);
}
.fr-search-box:focus-within {
  border-color: var(--gn-accent);
}
.fr-search-icon {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
}
.fr-search-box input {
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--gn-text);
  font-size: 12.5px;
  outline: none;
}
.fr-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.fr-search-clear:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}

/* ---------- 两列 ---------- */
/* 右侧没有内容时第二列收成 0 宽、间距归零，好友列表顺势铺满整行；
   第二列始终存在于轨道定义里，收起 / 展开才能过渡而不是跳变 */
.fr-cols {
  display: grid;
  gap: 0;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  transition:
    grid-template-columns 0.26s cubic-bezier(0.22, 1, 0.36, 1),
    gap 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}
.fr-main-col,
.fr-side-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.fr-side-col {
  /* 0 宽轨道里内容仍会画出来，必须裁掉 */
  overflow: hidden;
}
@media (min-width: 900px) {
  .fr-cols {
    /* 两端都用定长（330px / 0px）才能插值；minmax(0,0px) 在 Chrome 里不可过渡，会中途跳一下 */
    grid-template-columns: minmax(0, 1fr) 0px;
  }
  .fr-cols.has-side {
    gap: 16px;
    grid-template-columns: minmax(0, 1fr) 330px;
  }
  .fr-side-col {
    position: sticky;
    top: 20px;
  }
}

/* ---------- 卡片 ---------- */
.fr-card {
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
  overflow: hidden;
}
.fr-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--gn-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--gn-text);
}
.fr-head-link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.fr-head-link:hover {
  color: var(--gn-text);
}
.fr-add-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 10px;
  color: var(--gn-text-muted);
  font-size: 11.5px;
  font-weight: 400;
  white-space: nowrap;
}
.fr-notice {
  margin: 10px 0 0;
  padding: 7px 10px;
  border-radius: 7px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 12px;
}
.fr-default-tag {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 10px;
  font-weight: 500;
}
.fr-merge-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg-soft);
  font-size: 12px;
  color: var(--gn-text-soft);
}
.fr-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 11px;
  font-weight: 500;
  text-align: center;
}
.fr-list {
  display: flex;
  flex-direction: column;
  padding: 5px 6px;
}
.fr-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 7px 8px;
  border-radius: 8px;
}
.fr-row:hover {
  background: var(--gn-bg-soft);
}
.fr-row.is-request {
  align-items: flex-start;
}

/* ---------- 行内元素 ---------- */
.fr-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 13px;
  font-weight: 600;
}
.fr-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.fr-main {
  flex: 1 1 auto;
  min-width: 0;
}
.fr-name {
  font-size: 13px;
  color: var(--gn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fr-sub {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fr-tag {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
.fr-confirm-text {
  font-size: 11.5px;
  color: var(--gn-text-soft);
  white-space: nowrap;
}

/* 行内操作：默认藏起来，鼠标移入整行才出现。两列布局下行尾常有空白，
   一直挂着「解除 / 拉黑」很容易误点；确认态要强制显示，否则用户找不到取消 */
.fr-ops {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.14s ease;
}
.fr-row:hover .fr-ops,
.fr-row:focus-within .fr-ops,
.fr-ops.is-confirm {
  opacity: 1;
}
.fr-act {
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
/* 移入后才出现的操作，一律用危险色提示「这个点了会删东西」 */
.fr-act:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
  color: var(--gn-danger);
}
.fr-request-ops {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 7px;
}

/* ---------- 分组 ---------- */
.fr-head-link.with-icon {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.fr-input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.fr-input:focus {
  border-color: var(--gn-accent);
}
.fr-group-create {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--gn-border);
  background: var(--gn-bg-soft);
}
.fr-group-create .fr-input {
  flex: 1 1 auto;
  min-width: 0;
}
.fr-group-head {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 34px;
  margin-top: 3px;
  padding: 2px 8px;
  border-radius: 8px;
  transition: background 0.14s ease, box-shadow 0.14s ease;
}
.fr-group-head:first-child {
  margin-top: 0;
}
.fr-group-head:hover {
  background: var(--gn-bg-soft);
}
.fr-group-head.is-drop,
.fr-row.is-drop,
.fr-group-hint.is-drop {
  background: var(--gn-accent-soft);
  box-shadow: inset 0 0 0 1px var(--gn-accent);
}
.fr-group-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.fr-group-chev {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  transition: transform 0.16s ease;
}
.fr-group-chev.open {
  transform: rotate(90deg);
}
.fr-group-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.fr-group-count {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 99px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-muted);
  font-size: 10.5px;
  text-align: center;
}
.fr-group-edit {
  flex: 1 1 auto;
  max-width: 140px;
  min-width: 60px;
  height: 24px;
}
.fr-group-ops {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.14s ease;
}
.fr-group-head:hover .fr-group-ops,
.fr-group-head:focus-within .fr-group-ops {
  opacity: 1;
}
.fr-group-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.fr-group-act:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
/* 默认组的实心星：一眼看出当前默认，点它即取消 */
.fr-group-act.on {
  color: var(--gn-accent);
}
.fr-group-act.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
  color: var(--gn-danger);
}
/* 非空组不能删：图标留着当说明，但明显置灰且不可点 */
.fr-group-act-wrap {
  display: inline-flex;
}
.fr-group-act:disabled,
.fr-group-act.is-disabled {
  opacity: 0.32;
  cursor: not-allowed;
}
.fr-group-act:disabled:hover,
.fr-group-act.is-disabled:hover {
  background: transparent;
  color: var(--gn-text-muted);
}
.fr-group-hint {
  margin: 0 8px 2px 28px;
  padding: 8px;
  border: 1px dashed var(--gn-border-strong);
  border-radius: 7px;
  color: var(--gn-text-muted);
  font-size: 11.5px;
  text-align: center;
}
.fr-grip {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  opacity: 0.5;
}
.fr-row.is-dragging {
  opacity: 0.45;
}

/* ---------- 按钮 ---------- */
.fr-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12px;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
}
.fr-btn:hover {
  background: var(--gn-bg-hover);
}
.fr-btn.primary {
  border-color: transparent;
  background: var(--gn-accent);
  color: var(--gn-bg);
}
.fr-btn.primary:hover {
  filter: brightness(1.06);
}
.fr-btn.primary.on {
  background: color-mix(in srgb, var(--gn-accent) 22%, transparent);
  color: var(--gn-accent);
  border-color: var(--gn-accent);
}
.fr-add-search {
  padding: 10px 13px 4px;
}
.fr-add-search .fr-search-box {
  max-width: 420px;
}
.fr-btn.danger {
  border-color: color-mix(in srgb, var(--gn-danger) 35%, var(--gn-border));
  color: var(--gn-danger);
}
.fr-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ---------- 空态 ---------- */
.fr-empty {
  margin: 0;
  padding: 14px 14px 16px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--gn-text-muted);
}
.fr-empty-box {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 12px;
  padding: 14px;
  border: 1px dashed var(--gn-border-strong);
  border-radius: 9px;
  color: var(--gn-text-muted);
}
.fr-empty-box p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
}
.fr-err {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--gn-danger);
}
</style>
