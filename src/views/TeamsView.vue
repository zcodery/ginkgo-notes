<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, Plus, Upload, UserPlus, Users, X } from 'lucide-vue-next'
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
import { goHome, reloadPages, reloadSpaces, store, switchSpace } from '@/store'

const spaces = ref<SpaceInfo[]>([])
const current = ref<SpaceInfo | null>(null)
const nodes = ref<OrgNodeInfo[]>([])
const members = ref<SpaceMemberInfo[]>([])
const pending = ref<{ id: string; invitee: SpaceMemberInfo | null; role: string }[]>([])
const loading = ref(true)
const busy = ref(false)
const err = ref('')

const newSpace = ref('')
const inviteDraft = ref({ usernames: [] as string[], role: 'viewer', orgNodeId: '' })
const confirmingMember = ref('')

const importOpen = ref(false)
const importText = ref('')
const importFormat = ref<'csv' | 'json'>('csv')
const importResult = ref<OrgImportResult | null>(null)

const ROLE_RANK: Record<string, number> = { guest: 1, viewer: 2, editor: 3, admin: 4, owner: 5 }
const roleRank = (role: string | undefined) => (role && ROLE_RANK[role]) || 0
const canManage = computed(() => roleRank(current.value?.role) >= 4)

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
  current.value = space
  await run(async () => {
    const org = await getSpaceOrg(space.id)
    nodes.value = org.nodes
    members.value = org.members
    pending.value = canManage.value ? await listSpaceInvites(space.id) : []
  })
}

function create() {
  const name = newSpace.value.trim()
  if (!name) return
  return run(async () => {
    const space = await createSpace(name)
    newSpace.value = ''
    await refreshSpaces()
    await select(space)
  })
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
  { value: '', label: '不指定部门' },
  ...nodes.value.map((n) => ({ value: n.id, label: `${'　'.repeat(n.depth)}${n.name}` })),
])
const formatOptions = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
]

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
    const team = spaces.value.find((s) => s.type === 'team')
    if (team) await select(team)
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
        <div class="tm-nav-title">我的空间</div>
        <button
          v-for="s in spaces"
          :key="s.id"
          type="button"
          class="tm-nav-item"
          :class="{ on: current?.id === s.id }"
          @click="select(s)"
        >
          <span class="tm-nav-name">{{ s.name }}</span>
          <span class="tm-nav-meta">{{ s.type === 'personal' ? '个人' : `${s.memberCount} 人` }}</span>
        </button>
        <div class="tm-nav-create">
          <input v-model="newSpace" placeholder="新团队名称" @keydown.enter="create" />
          <button type="button" class="tm-btn primary" :disabled="busy || !newSpace.trim()" @click="create">
            <Plus :size="13" />创建
          </button>
        </div>
      </aside>

      <main class="tm-main">
        <div v-if="loading" class="tm-empty">加载中…</div>

        <template v-else-if="current && current.type === 'team'">
          <header class="tm-main-head">
            <div>
              <h1>{{ current.name }}</h1>
              <p class="tm-desc">组织架构按节点继承权限；成员离职只移出空间，文档仍归团队所有。</p>
            </div>
            <button type="button" class="tm-btn" @click="enterTeam">
              进入团队<ArrowRight :size="13" />
            </button>
          </header>

          <div class="tm-cols">
            <section class="tm-card">
              <div class="tm-card-title"><Users :size="14" />组织架构</div>
        <OrgTree
          :space-id="current.id"
          :nodes="nodes"
          :can-manage="canManage"
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
            placeholder="CSV：部门路径,用户名,角色&#10;研发部/前端组,zhangsan,editor&#10;研发部/后端组,lisi,viewer&#10;&#10;也支持粘贴 JSON：{ &quot;nodes&quot;: [...], &quot;members&quot;: [...] }"
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
      </section>

            <section class="tm-card">
              <div class="tm-card-title"><Users :size="14" />成员<span class="tm-count">{{ members.length }}</span></div>
        <div class="tm-member-list">
          <div v-for="m in members" :key="m.id" class="tm-member">
            <div class="tm-avatar">{{ m.name.slice(0, 1) }}</div>
            <div class="tm-member-main">
              <div class="tm-member-name">{{ m.name }}</div>
              <div class="tm-member-sub">@{{ m.username }}</div>
            </div>
            <GnSelect
              v-if="canManage"
              :model-value="m.role"
              :options="roleOptions"
              :min-width="92"
              @update:model-value="changeRole(m, $event)"
            />
            <span v-else class="tm-tag">{{ m.role }}</span>
            <template v-if="confirmingMember === m.id">
              <span class="tm-tag">确认移出？</span>
              <button type="button" class="tm-btn" :disabled="busy" @click="removeMember(m)">确认</button>
              <button type="button" class="tm-btn" :disabled="busy" @click="confirmingMember = ''">取消</button>
            </template>
            <button v-else-if="canManage" type="button" class="tm-icon" @click="confirmingMember = m.id">
              <X :size="13" />
            </button>
          </div>
        </div>

        <div v-if="canManage" class="tm-invite">
          <PeoplePicker
            v-model="inviteDraft.usernames"
            source="both"
            :space-id="current.id"
            placeholder="选择好友或团队成员"
          />
          <div class="tm-inline tm-wrap">
            <GnSelect v-model="inviteDraft.role" :options="roleOptions" :min-width="92" />
            <GnSelect v-model="inviteDraft.orgNodeId" :options="orgOptions" :min-width="150" />
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

        <div v-if="pending.length" class="tm-pending">
          <div class="tm-subtitle">待接受</div>
          <div v-for="p in pending" :key="p.id" class="tm-member">
            <div class="tm-member-main">{{ p.invitee?.name || p.invitee?.username || p.id }}</div>
            <span class="tm-tag">{{ p.role }}</span>
          </div>
        </div>
      </section>
          </div>
        </template>

        <div v-else-if="current" class="tm-card">
          <p class="tm-empty">个人空间是私有的，不能添加成员。创建一个团队即可开始协作。</p>
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
.tm-shell {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  max-width: 1560px;
  margin: 0 auto;
  padding: 24px 32px 80px;
}
.tm-nav {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 208px;
  flex: 0 0 208px;
  padding: 10px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
}
.tm-nav-title {
  padding: 2px 8px 8px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--gn-text-muted);
}
.tm-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.tm-nav-item:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.tm-nav-item.on {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-weight: 600;
}
.tm-nav-name {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tm-nav-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--gn-text-muted);
}
.tm-nav-item.on .tm-nav-meta {
  color: var(--gn-accent);
}
.tm-nav-create {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--gn-border);
}
.tm-nav-create input {
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg-soft);
  color: var(--gn-text);
  font-size: 12px;
  outline: none;
}
.tm-nav-create input:focus {
  border-color: var(--gn-accent);
}
.tm-main {
  flex: 1 1 auto;
  min-width: 0;
}
.tm-main-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.tm-main-head h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 650;
  color: var(--gn-text);
}
.tm-main-head .tm-desc {
  margin: 0;
  max-width: 620px;
}
@media (max-width: 900px) {
  .tm-shell {
    flex-direction: column;
    padding: 18px 16px 60px;
  }
  .tm-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    width: 100%;
    flex: 1 1 auto;
  }
  .tm-nav-title {
    display: none;
  }
  .tm-nav-item {
    flex: 1 1 140px;
  }
  .tm-nav-create {
    flex: 1 1 100%;
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
}
.tm-cols {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}
.tm-cols .tm-card {
  margin-bottom: 0;
}
@media (min-width: 1280px) {
  .tm-cols {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  }
}
.tm-head h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 650;
  color: var(--gn-text);
}
.tm-desc {
  margin: 0 0 20px;
  max-width: 640px;
  font-size: 13px;
  color: var(--gn-text-soft);
}
.tm-card {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
}
.tm-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--gn-text);
}
.tm-card-title .tm-btn {
  margin-left: auto;
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
.tm-space-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tm-space {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg-soft);
  color: var(--gn-text);
  font-size: 12.5px;
  cursor: pointer;
}
.tm-space.on {
  border-color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.tm-space-meta {
  color: var(--gn-text-soft);
  font-size: 11px;
}
.tm-inline {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.tm-wrap {
  flex-wrap: wrap;
}
.tm-inline input,
.tm-inline select {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg-soft);
  color: var(--gn-text);
  font-size: 12.5px;
  outline: none;
}
.tm-inline input {
  flex: 1 1 160px;
  min-width: 120px;
}
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
  cursor: pointer;
}
.tm-btn.primary {
  border-color: transparent;
  background: var(--gn-accent);
  color: var(--gn-bg);
}
.tm-btn:disabled {
  opacity: 0.5;
  cursor: default;
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
  font-family: var(--gn-editor-font, ui-monospace, monospace);
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
  color: #c0392b;
}
.tm-invite {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--gn-border);
}
.tm-invite .tm-inline {
  margin-top: 0;
}
.tm-subtitle {
  margin: 14px 0 8px;
  font-size: 12px;
  color: var(--gn-text-soft);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tm-node-list,
.tm-member-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tm-node,
.tm-member {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--gn-bg-soft);
}
.tm-node-name,
.tm-member-name {
  font-size: 13px;
  color: var(--gn-text);
}
.tm-node-type,
.tm-node-count,
.tm-member-sub {
  font-size: 11.5px;
  color: var(--gn-text-soft);
}
.tm-node-count {
  margin-left: auto;
}
.tm-member-main {
  flex: 1 1 auto;
  min-width: 0;
}
.tm-member select {
  height: 26px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12px;
}
.tm-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 12px;
  font-weight: 600;
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
  color: var(--gn-text-soft);
  cursor: pointer;
}
.tm-icon:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.tm-tag {
  font-size: 11.5px;
  color: var(--gn-text-soft);
}
.tm-empty {
  font-size: 12.5px;
  color: var(--gn-text-soft);
}
.tm-err {
  margin: 0;
  font-size: 12.5px;
  color: #c0392b;
}
</style>