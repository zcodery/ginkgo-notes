<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, ChevronRight, FolderTree, Plus, Upload, UserPlus, Users, X } from 'lucide-vue-next'
import GnSelect from '@/components/GnSelect.vue'
import PeoplePicker from '@/components/PeoplePicker.vue'
import OrgTree from '@/components/OrgTree.vue'
import {
  createSpace,
  errorText,
  getSpaceOrg,
  importOrg,
  inviteToSpace,
  listSpaces,
  listSpaceInvites,
  removeSpaceMember,
  updateSpaceMember,
  type BackendRole,
  type OrgImportResult,
  type OrgNodeInfo,
  type SpaceInfo,
  type SpaceMemberInfo,
} from '@/api/features'
import { goHome, reloadPages, reloadSpaces, switchSpace } from '@/store'

const spaces = ref<SpaceInfo[]>([])
const current = ref<SpaceInfo | null>(null)
const nodes = ref<OrgNodeInfo[]>([])
const members = ref<SpaceMemberInfo[]>([])
const pending = ref<{ id: string; invitee: SpaceMemberInfo | null; role: string; orgNodeId: string }[]>([])
const loading = ref(true)
const busy = ref(false)
const err = ref('')

const newSpace = ref('')
const navCreateOpen = ref(false)
const inviteDraft = ref({ usernames: [] as string[], role: 'viewer', orgNodeId: '' })
const confirmingMember = ref('')

const importOpen = ref(false)
const importText = ref('')
const importFormat = ref<'csv' | 'json'>('csv')
const importResult = ref<OrgImportResult | null>(null)

const ROLE_RANK: Record<string, number> = { guest: 1, viewer: 2, editor: 3, admin: 4, owner: 5 }
const roleRank = (role: string | undefined) => (role && ROLE_RANK[role]) || 0
const canManage = computed(() => roleRank(current.value?.role) >= 4)

/** 供人员选择器做横向团队 tab */
const teamSpaces = computed(() =>
  spaces.value.filter((s) => s.type === 'team').map((s) => ({ id: s.id, name: s.name })),
)

const roleOptions: { value: BackendRole; label: string }[] = [
  { value: 'viewer', label: '可查看' },
  { value: 'editor', label: '可编辑' },
  { value: 'admin', label: '管理员' },
]

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

async function refreshSpaces() {
  spaces.value = await listSpaces()
}

async function select(space: SpaceInfo) {
  // 换空间才清掉成员筛选；同一空间内的增删改刷新不能把用户选的节点丢掉
  if (current.value?.id !== space.id) scopeId.value = ''
  current.value = space
  await run(async () => {
    const org = await getSpaceOrg(space.id)
    nodes.value = org.nodes
    members.value = org.members
    pending.value = canManage.value ? await listSpaceInvites(space.id) : []
    resolveScope()
  })
}

function create() {
  const name = newSpace.value.trim()
  if (!name) return
  return run(async () => {
    const space = await createSpace(name)
    newSpace.value = ''
    navCreateOpen.value = false
    await refreshSpaces()
    await select(space)
  })
}

function closeNavCreate() {
  navCreateOpen.value = false
  newSpace.value = ''
}

function invite() {
  if (!current.value || !inviteDraft.value.usernames.length) return
  return run(async () => {
    const spaceId = current.value!.id
    const errors: string[] = []
    for (const username of [...inviteDraft.value.usernames]) {
      try {
        await inviteToSpace(spaceId, {
          username,
          role: inviteDraft.value.role,
          orgNodeId: inviteDraft.value.orgNodeId || undefined,
        })
      } catch (e) {
        errors.push(`${username}：${errorText(e)}`)
      }
    }
    inviteDraft.value.usernames = []
    await select(current.value!)
    if (errors.length) err.value = errors.join('；')
  })
}

function changeRole(member: SpaceMemberInfo, role: string) {
  if (!current.value) return
  return run(async () => {
    await updateSpaceMember(current.value!.id, member.id, { role })
    await select(current.value!)
  })
}

function removeMember(member: SpaceMemberInfo) {
  if (!current.value) return
  confirmingMember.value = ''
  return run(async () => {
    await removeSpaceMember(current.value!.id, member.id)
    await select(current.value!)
  })
}

async function enterTeam() {
  if (!current.value) return
  await switchSpace(current.value.id)
  await reloadPages()
  goHome()
}

const orgOptions = computed(() => [
  { value: '', label: '不指定节点' },
  ...nodes.value.map((n) => ({ value: n.id, label: `${'　'.repeat(n.depth)}${n.name}` })),
])
const formatOptions = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
]

/* ---------------- 成员按组织节点过滤 / 分组 ---------------- */

const scopeId = ref('')
/** 是否把下级节点的成员一起列出；开启时按节点分组，标题给出完整组织路径 */
const includeChildren = ref(true)

const nodeMap = computed(() => new Map(nodes.value.map((n) => [n.id, n])))
const rootNodeId = computed(() => nodes.value.find((n) => !n.parentId)?.id ?? '')
const scopeNode = computed(() => (scopeId.value ? nodeMap.value.get(scopeId.value) ?? null : null))

/** 成员归属节点：没挂节点的算「全员」（根节点）成员 */
const memberNodeId = (orgNodeId: string) => orgNodeId || rootNodeId.value

const childrenOf = (id: string) =>
  nodes.value.filter((n) => (n.parentId ?? '') === id).sort((a, b) => a.sort - b.sort)

/** 子树节点 id，按树的展示顺序（深度优先 + 同级 sort），保证分组顺序与左侧一致 */
function subtreeOrder(id: string): string[] {
  const out: string[] = []
  const walk = (nid: string) => {
    out.push(nid)
    for (const child of childrenOf(nid)) walk(child.id)
  }
  walk(id)
  return out
}

/** 根到该节点的名称链，分组标题里的组织路径靠它 */
function pathOf(id: string): string[] {
  const segs: string[] = []
  let cur = nodeMap.value.get(id)
  let guard = 0
  while (cur && guard++ < 32) {
    segs.unshift(cur.name)
    cur = cur.parentId ? nodeMap.value.get(cur.parentId) : undefined
  }
  return segs
}

interface MemberGroup {
  key: string
  /** 为空表示不分组（没有选中节点 / 不含下级时只有一条平铺列表） */
  segs: string[]
  members: SpaceMemberInfo[]
}

const groups = computed<MemberGroup[]>(() => {
  const scope = scopeNode.value
  if (!scope) return [{ key: 'all', segs: [], members: members.value }]
  if (!includeChildren.value) {
    return [
      {
        key: scope.id,
        segs: [],
        members: members.value.filter((m) => memberNodeId(m.orgNodeId) === scope.id),
      },
    ]
  }
  const out: MemberGroup[] = []
  for (const id of subtreeOrder(scope.id)) {
    const list = members.value.filter((m) => memberNodeId(m.orgNodeId) === id)
    if (list.length) out.push({ key: id, segs: pathOf(id), members: list })
  }
  return out
})

const visibleMembers = computed(() => groups.value.flatMap((g) => g.members))
const scopePath = computed(() => (scopeNode.value ? pathOf(scopeNode.value.id) : []))
const scopePathText = computed(() => scopePath.value.join(' / '))

const visiblePending = computed(() => {
  const scope = scopeNode.value
  if (!scope) return pending.value
  const ids = new Set(includeChildren.value ? subtreeOrder(scope.id) : [scope.id])
  return pending.value.filter((p) => ids.has(memberNodeId(p.orgNodeId ?? '')))
})

function selectNode(id: string) {
  scopeId.value = id
}
function clearScope() {
  scopeId.value = ''
}
function toggleChildren() {
  if (scopeNode.value) includeChildren.value = !includeChildren.value
}
/** 节点被删/换空间后，选中的 id 可能已失效，回落到「全部成员」 */
function resolveScope() {
  if (scopeId.value && !nodeMap.value.has(scopeId.value)) scopeId.value = ''
}

async function reloadOrg() {
  if (current.value) await select(current.value)
}

function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.name.toLowerCase().endsWith('.json')) importFormat.value = 'json'
  const reader = new FileReader()
  reader.onload = () => {
    importText.value = String(reader.result ?? '')
  }
  reader.readAsText(file)
}

function doImport() {
  if (!current.value || !importText.value.trim()) return
  return run(async () => {
    const text = importText.value.trim()
    let payload: Record<string, unknown>
    if (importFormat.value === 'csv') {
      payload = { format: 'csv', text }
    } else {
      const parsed = JSON.parse(text) as unknown
      payload = Array.isArray(parsed)
        ? { format: 'json', nodes: parsed, members: [] }
        : {
            format: 'json',
            nodes: (parsed as { nodes?: unknown[] })?.nodes ?? [],
            members: (parsed as { members?: unknown[] })?.members ?? [],
          }
    }
    importResult.value = await importOrg(current.value!.id, payload)
    await select(current.value!)
  })
}

onMounted(async () => {
  try {
    await refreshSpaces()
    await reloadSpaces()
    // 优先打开第一个团队；没有团队时退到个人空间，避免主区整片空白
    const initial = spaces.value.find((s) => s.type === 'team') ?? spaces.value[0]
    if (initial) await select(initial)
  } catch (e) {
    err.value = errorText(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="tm-page gn-scroll">
    <div class="tm-shell">
      <aside class="tm-nav">
        <div class="tm-nav-head">空间</div>
        <button
          v-for="s in spaces"
          :key="s.id"
          type="button"
          class="tm-nav-item"
          :class="{ on: current?.id === s.id }"
          @click="select(s)"
        >
          <span class="tm-nav-avatar">{{ (s.name || '?').slice(0, 1) }}</span>
          <span class="tm-nav-text">
            <span class="tm-nav-name">{{ s.name }}</span>
            <span class="tm-nav-meta">{{ s.type === 'personal' ? '个人空间' : `${s.memberCount} 名成员` }}</span>
          </span>
        </button>

        <div class="tm-nav-foot">
          <button v-if="!navCreateOpen" type="button" class="tm-nav-new" @click="navCreateOpen = true">
            <Plus :size="13" />新建团队
          </button>
          <form v-else class="tm-nav-form" @submit.prevent="create">
            <input v-model="newSpace" placeholder="团队名称" autofocus />
            <div class="tm-nav-form-actions">
              <button type="submit" class="tm-btn primary" :disabled="busy || !newSpace.trim()">创建</button>
              <button type="button" class="tm-btn" @click="closeNavCreate">取消</button>
            </div>
          </form>
        </div>
      </aside>

      <main class="tm-main">
        <div v-if="loading" class="tm-empty">加载中…</div>

        <template v-else-if="current && current.type === 'team'">
          <header class="tm-head">
            <div class="tm-head-text">
              <div class="tm-head-line">
                <h1>{{ current.name }}</h1>
                <span class="tm-badge">{{ members.length }} 名成员</span>
              </div>
              <p class="tm-desc">组织架构按节点继承权限；成员离职只移出空间，文档仍归团队所有。</p>
            </div>
            <button type="button" class="tm-btn" @click="enterTeam">
              进入团队<ArrowRight :size="13" />
            </button>
          </header>

          <div class="tm-cols">
            <section class="tm-card">
              <div class="tm-card-head">
                <Users :size="14" /><span>组织架构</span>
                <span class="tm-count">{{ nodes.length }}</span>
              </div>
              <div class="tm-card-body tm-scroll">
                <OrgTree
                  :space-id="current.id"
                  :nodes="nodes"
                  :can-manage="canManage"
                  :selected-id="scopeId"
                  @select="selectNode"
                  @changed="reloadOrg"
                />

                <div v-if="canManage" class="tm-import">
                  <button type="button" class="tm-link" @click="importOpen = !importOpen">
                    <Upload :size="13" />{{ importOpen ? '收起导入' : '导入组织架构' }}
                  </button>
                  <span v-if="importResult" class="tm-import-summary">
                    新增 {{ importResult.createdNodes }} 个节点 · 复用 {{ importResult.reusedNodes }} 个 · 成员 {{ importResult.members }} 人
                  </span>
                </div>
                <div v-if="canManage && importOpen" class="tm-import-panel">
                  <textarea
                    v-model="importText"
                    rows="6"
                    placeholder="CSV：节点路径,用户名,角色&#10;研发部/前端组,zhangsan,editor&#10;研发部/后端组,lisi,viewer&#10;&#10;也支持粘贴 JSON：{ &quot;nodes&quot;: [...], &quot;members&quot;: [...] }"
                  ></textarea>
                  <div class="tm-inline tm-wrap">
                    <label class="tm-btn tm-file">
                      选择文件
                      <input type="file" accept=".csv,.txt,.json" @change="onImportFile" />
                    </label>
                    <GnSelect v-model="importFormat" :options="formatOptions" :min-width="78" />
                    <button type="button" class="tm-btn primary" :disabled="busy || !importText.trim()" @click="doImport">
                      开始导入
                    </button>
                  </div>
                  <div v-if="importResult?.errors?.length" class="tm-import-errors">
                    <span v-for="(item, i) in importResult.errors.slice(0, 6)" :key="i">{{ item }}</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="tm-card tm-people">
              <div class="tm-card-head">
                <Users :size="14" /><span>成员</span>
                <span class="tm-count">{{ visibleMembers.length }}</span>
                <span v-if="scopeNode && visibleMembers.length !== members.length" class="tm-head-of">
                  共 {{ members.length }} 人
                </span>
              </div>

              <!-- 跟随左侧组织：显示当前选中节点 + 是否加载下级 -->
              <div class="tm-scope">
                <button
                  v-if="scopeNode"
                  type="button"
                  class="tm-scope-chip"
                  v-tooltip="`只看「${scopePathText}」下的成员，点击清除`"
                  @click="clearScope"
                >
                  <FolderTree :size="12" />
                  <span class="tm-scope-text">{{ scopePathText }}</span>
                  <X :size="11" />
                </button>
                <span v-else class="tm-scope-all">全部成员</span>

                <div
                  class="tm-scope-toggle"
                  :class="{ off: !scopeNode }"
                  v-tooltip="scopeNode ? '开启后连同所有下级节点的成员一起列出，并按组织路径分组' : '先在左侧组织架构里点一个节点'"
                  @click="toggleChildren"
                >
                  <span>包含下级</span>
                  <span class="tm-switch" :class="{ on: includeChildren && !!scopeNode }"><i /></span>
                </div>
              </div>

              <div class="tm-card-body tm-people-body tm-scroll">
                <section v-for="g in groups" :key="g.key" class="tm-group">
                  <div v-if="g.segs.length" class="tm-group-head">
                    <span class="tm-group-path">
                      <template v-for="(seg, i) in g.segs" :key="i">
                        <ChevronRight v-if="i" :size="10" class="tm-seg-sep" />
                        <span class="tm-seg" :class="{ last: i === g.segs.length - 1 }">{{ seg }}</span>
                      </template>
                    </span>
                    <span class="tm-group-count">{{ g.members.length }} 人</span>
                  </div>

                  <div
                    v-for="m in g.members"
                    :key="m.id"
                    class="tm-member"
                    :class="{ 'is-grouped': g.segs.length }"
                  >
                    <div class="tm-avatar">{{ (m.name || '?').slice(0, 1) }}</div>
                    <div class="tm-member-main">
                      <div class="tm-member-name">{{ m.name }}</div>
                      <div class="tm-member-sub">@{{ m.username }}</div>
                    </div>
                    <GnSelect
                      v-if="canManage"
                      :model-value="m.role"
                      :options="roleOptions"
                      :min-width="92"
                      v-tooltip="'成员角色：可管理 / 可编辑 / 可查看'"
                      @update:model-value="changeRole(m, $event)"
                    />
                    <span v-else class="tm-tag">{{ m.role }}</span>
                    <template v-if="confirmingMember === m.id">
                      <span class="tm-tag">确认移出？</span>
                      <button type="button" class="tm-btn" :disabled="busy" @click="removeMember(m)">确认</button>
                      <button type="button" class="tm-btn" :disabled="busy" @click="confirmingMember = ''">取消</button>
                    </template>
                    <button
                      v-else-if="canManage"
                      type="button"
                      class="tm-icon"
                      v-tooltip="'移出成员'"
                      @click="confirmingMember = m.id"
                    >
                      <X :size="13" />
                    </button>
                  </div>
                </section>

                <div v-if="!visibleMembers.length" class="tm-people-empty">
                  <span>{{ scopeNode ? '这个节点下还没有成员' : '还没有成员' }}</span>
                  <span class="tm-people-empty-tip">
                    {{ scopeNode ? '可以打开「包含下级」，或邀请时把成员挂到这个节点下' : '用下方「添加成员」邀请同事加入' }}
                  </span>
                </div>

                <div v-if="visiblePending.length" class="tm-pending">
                  <div class="tm-subtitle">待接受邀请<span class="tm-count">{{ visiblePending.length }}</span></div>
                  <div v-for="p in visiblePending" :key="p.id" class="tm-member is-pending">
                    <div class="tm-member-main">{{ p.invitee?.name || p.invitee?.username || p.id }}</div>
                    <span class="tm-tag">{{ p.role }}</span>
                  </div>
                </div>
              </div>

              <div v-if="canManage" class="tm-invite">
                <div class="tm-subtitle">添加成员</div>
                <PeoplePicker
                  v-model="inviteDraft.usernames"
                  source="both"
                  :space-id="current.id"
                  :spaces="teamSpaces"
                  placeholder="选择好友或团队成员"
                />
                <div class="tm-inline tm-wrap">
                  <GnSelect
                    v-model="inviteDraft.role"
                    :options="roleOptions"
                    :min-width="92"
                    v-tooltip="'邀请后授予的角色'"
                  />
                  <GnSelect
                    v-model="inviteDraft.orgNodeId"
                    :options="orgOptions"
                    :min-width="150"
                    v-tooltip="'挂到哪个节点，成员会继承该节点权限'"
                  />
                  <button
                    type="button"
                    class="tm-btn primary"
                    :disabled="busy || !inviteDraft.usernames.length"
                    @click="invite"
                  >
                    <UserPlus :size="13" />邀请{{ inviteDraft.usernames.length ? `（${inviteDraft.usernames.length}）` : '' }}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </template>

        <div v-else-if="current" class="tm-card tm-private">
          <div class="tm-private-icon"><Users :size="18" /></div>
          <div>
            <h2>个人空间是私有的</h2>
            <p class="tm-desc">个人空间只能自己访问。创建一个团队即可邀请好友、按部门分配权限。</p>
          </div>
          <button type="button" class="tm-btn primary" @click="navCreateOpen = true">
            <Plus :size="13" />新建团队
          </button>
        </div>

        <p v-if="err" class="tm-err">{{ err }}</p>
      </main>
    </div>
  </section>
</template>

<style scoped>
.tm-page {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}
/* 卡片内部滚动：滚动条宽度归零（仍可滚动），避免再出现一条外框滚动条 */
.tm-scroll {
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.tm-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}
.tm-shell {
  display: flex;
  align-items: flex-start;
  gap: 22px;
  max-width: 1440px;
  margin: 0 auto;
  padding: 26px 30px 72px;
}

/* ---------- 左侧空间导航 ---------- */
.tm-nav {
  position: sticky;
  top: 18px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 206px;
  flex: 0 0 206px;
  padding: 8px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
}
.tm-nav-head {
  padding: 4px 8px 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--gn-text-muted);
}
.tm-nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--gn-text-soft);
  text-align: left;
  cursor: pointer;
}
.tm-nav-item:hover {
  background: var(--gn-bg-hover);
}
.tm-nav-item.on {
  background: var(--gn-accent-soft);
}
.tm-nav-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border-radius: 8px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 12px;
  font-weight: 600;
}
.tm-nav-item.on .tm-nav-avatar {
  background: var(--gn-accent);
  color: var(--gn-bg);
}
.tm-nav-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.tm-nav-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--gn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tm-nav-meta {
  font-size: 11px;
  color: var(--gn-text-muted);
}
.tm-nav-item.on .tm-nav-meta {
  color: var(--gn-accent);
}
.tm-nav-foot {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--gn-border);
}
.tm-nav-new {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--gn-accent);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.tm-nav-new:hover {
  background: var(--gn-accent-soft);
}
.tm-nav-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px;
}
.tm-nav-form input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg-soft);
  color: var(--gn-text);
  font-size: 12.5px;
  outline: none;
}
.tm-nav-form input:focus {
  border-color: var(--gn-accent);
}
.tm-nav-form-actions {
  display: flex;
  gap: 6px;
}

/* ---------- 主区 ---------- */
.tm-main {
  flex: 1 1 auto;
  min-width: 0;
}
.tm-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.tm-head-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.tm-head-line h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  color: var(--gn-text);
}
.tm-badge {
  padding: 1px 8px;
  border-radius: 99px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 11.5px;
}
.tm-desc {
  margin: 0;
  max-width: 620px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--gn-text-soft);
}

.tm-cols {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}
@media (min-width: 1024px) {
  .tm-cols {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
  }
}

/* ---------- 卡片 ---------- */
.tm-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
}
.tm-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--gn-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--gn-text);
}
.tm-card-head .tm-count {
  margin-left: 2px;
}
.tm-card-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 4px 14px 14px;
}
.tm-people-body {
  max-height: min(52vh, 520px);
  overflow-y: auto;
  padding-top: 0;
}
/* 顶部留白交给第一个分组，吸顶标题才能贴着滚动区上沿，不会漏出一条内容 */
.tm-group:first-child {
  padding-top: 8px;
}
.tm-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 11px;
  font-weight: 500;
}
.tm-subtitle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 6px;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}

/* ---------- 成员：跟随组织筛选 ---------- */
.tm-head-of {
  margin-left: auto;
  font-size: 11px;
  font-weight: 400;
  color: var(--gn-text-muted);
}
.tm-scope {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--gn-border);
  background: var(--gn-bg-soft);
}
.tm-scope-all {
  font-size: 12px;
  color: var(--gn-text-muted);
}
.tm-scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  padding: 3px 7px 3px 8px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 11.5px;
  cursor: pointer;
}
.tm-scope-chip:hover {
  border-color: var(--gn-border-strong);
  background: var(--gn-bg-hover);
}
.tm-scope-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tm-scope-chip svg {
  flex: 0 0 auto;
}
.tm-scope-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 6px;
  font-size: 11.5px;
  color: var(--gn-text-soft);
  cursor: pointer;
  user-select: none;
}
.tm-scope-toggle.off {
  opacity: 0.45;
  cursor: default;
}
.tm-switch {
  position: relative;
  width: 28px;
  height: 16px;
  flex: 0 0 auto;
  border-radius: 99px;
  background: var(--gn-bg-active);
  transition: background 0.15s ease;
}
.tm-switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 0.15s ease;
}
.tm-switch.on {
  background: var(--gn-accent);
}
.tm-switch.on i {
  transform: translateX(12px);
}

/* 分组标题：一条从根到该节点的组织路径；吸顶显示，滚长分组时也知道自己在哪一级 */
.tm-group-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 4px 6px;
  background: var(--gn-bg);
  border-bottom: 1px solid var(--gn-border);
}
.tm-group-head:first-child {
  padding-top: 2px;
}
.tm-group-path {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.tm-seg {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tm-seg.last {
  color: var(--gn-text);
  font-weight: 600;
}
.tm-seg-sep {
  flex: 0 0 auto;
  margin: 0 1px;
  opacity: 0.55;
}
.tm-group-count {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 11px;
  color: var(--gn-text-muted);
}
.tm-member.is-grouped {
  margin-left: 6px;
}
.tm-group-head + .tm-member {
  margin-top: 6px;
}
.tm-people-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-top: 16px;
  padding: 16px 10px;
  border: 1px dashed var(--gn-border);
  border-radius: 10px;
  color: var(--gn-text-muted);
  font-size: 12px;
  text-align: center;
}
.tm-people-empty-tip {
  font-size: 11px;
  opacity: 0.8;
}

/* ---------- 成员 ---------- */
.tm-member {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border-radius: 8px;
}
.tm-member + .tm-member {
  margin-top: 2px;
}
.tm-member:hover {
  background: var(--gn-bg-soft);
}
.tm-member.is-pending {
  color: var(--gn-text-soft);
}
.tm-member-main {
  flex: 1 1 auto;
  min-width: 0;
}
.tm-member-name {
  font-size: 13px;
  color: var(--gn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tm-member-sub {
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.tm-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border-radius: 50%;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 12.5px;
  font-weight: 600;
}
.tm-tag {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
.tm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.tm-icon:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.tm-pending {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--gn-border);
}

/* ---------- 邀请区 ---------- */
.tm-invite {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px 13px;
  border-top: 1px solid var(--gn-border);
  border-radius: 0 0 11px 11px;
  background: var(--gn-bg-soft);
}
.tm-invite .tm-subtitle {
  margin: 0;
}
/* PeoplePicker 默认带 flex:1 1 220px，在纵向容器里会被撑成 220px 高，这里收掉 */
.tm-invite :deep(.pp) {
  flex: 0 0 auto;
}
.tm-inline {
  display: flex;
  gap: 6px;
}
.tm-wrap {
  flex-wrap: wrap;
}

/* ---------- 通用控件 ---------- */
.tm-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}
.tm-btn:hover {
  background: var(--gn-bg-hover);
}
.tm-btn.primary {
  border-color: transparent;
  background: var(--gn-accent);
  color: var(--gn-bg);
}
.tm-btn.primary:hover {
  filter: brightness(1.06);
}
.tm-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.tm-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--gn-accent);
  font-size: 12.5px;
  cursor: pointer;
}
.tm-link:hover {
  text-decoration: underline;
}
.tm-import {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--gn-border);
}
.tm-import-summary {
  font-size: 11.5px;
  color: var(--gn-text-soft);
}
.tm-import-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg-soft);
}
.tm-import-panel textarea {
  width: 100%;
  padding: 8px 9px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-family: var(--gn-mono);
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}
.tm-import-panel textarea:focus {
  border-color: var(--gn-accent);
}
.tm-file {
  position: relative;
  overflow: hidden;
  cursor: pointer;
}
.tm-file input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.tm-import-errors {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11.5px;
  color: var(--gn-danger);
}

/* ---------- 个人空间提示 ---------- */
.tm-private {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 18px;
}
.tm-private h2 {
  margin: 0 0 3px;
  font-size: 14px;
  font-weight: 600;
  color: var(--gn-text);
}
.tm-private .tm-btn {
  margin-left: auto;
}
.tm-private-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border-radius: 10px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
}

.tm-empty {
  font-size: 12.5px;
  color: var(--gn-text-soft);
}
.tm-err {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--gn-danger);
}

/* 宽屏：整页不滚动，左右卡片各自内部滚动（滚动条宽度 0） */
@media (min-width: 1180px) {
  .tm-page {
    overflow: hidden;
  }
  .tm-shell {
    height: 100%;
    padding-bottom: 26px;
  }
  .tm-main {
    display: flex;
    flex-direction: column;
    align-self: stretch;
    min-height: 0;
  }
  .tm-cols {
    flex: 1 1 auto;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
    align-items: stretch;
  }
  .tm-card {
    min-height: 0;
  }
  .tm-nav {
    max-height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .tm-nav::-webkit-scrollbar {
    width: 0;
  }
  .tm-people-body {
    max-height: none;
  }
}

/* 窄屏（笔记本分屏、侧栏展开时）左导航改为顶部横排，把宽度让给卡片区 */
@media (max-width: 1179px) {
  .tm-shell {
    flex-direction: column;
    align-items: stretch;
    padding: 18px 18px 60px;
  }
  .tm-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    width: 100%;
    flex: 1 1 auto;
  }
  .tm-nav-head {
    display: none;
  }
  .tm-nav-item {
    flex: 0 1 auto;
    padding: 5px 10px 5px 6px;
  }
  .tm-nav-foot {
    margin-top: 0;
    margin-left: auto;
    padding-top: 0;
    border-top: none;
  }
  .tm-nav-form {
    flex-direction: row;
    align-items: center;
  }
  .tm-nav-form input {
    width: 140px;
  }
}
</style>
