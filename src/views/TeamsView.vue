<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Crown,
  FolderTree,
  GripVertical,
  Plus,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-vue-next'
import GnSelect from '@/components/GnSelect.vue'
import GnCascader, { type GnCascadeOption } from '@/components/GnCascader.vue'
import GnConfirm from '@/components/GnConfirm.vue'
import PeoplePicker from '@/components/PeoplePicker.vue'
import OrgTree from '@/components/OrgTree.vue'
import {
  checkMemberPhones,
  createSpace,
  errorText,
  getSpaceOrg,
  importOrg,
  inviteToSpace,
  listFriends,
  listSentFriendRequests,
  listSpaceInvites,
  listSpaces,
  registerSpaceMember,
  removeSpaceMember,
  sendFriendRequest,
  setNodeLead,
  updateSpaceMember,
  type BackendRole,
  type OrgImportResult,
  type OrgNodeInfo,
  type SpaceInfo,
  type SpaceMemberInfo,
} from '@/api/features'
import { goHome, reloadPages, reloadSpaces, store, switchSpace } from '@/store'
import {
  MEMBER_TEMPLATE_FORMATS,
  makeMemberTemplate,
  readMemberFile,
  type MemberTemplateFormat,
} from '@/utils/memberImport'

const spaces = ref<SpaceInfo[]>([])
const current = ref<SpaceInfo | null>(null)
const nodes = ref<OrgNodeInfo[]>([])
const members = ref<SpaceMemberInfo[]>([])
const pending = ref<{ id: string; invitee: SpaceMemberInfo | null; role: string; orgNodeId: string }[]>([])
/** 邀请候选里要排除的人：已经在团队里的成员 */
const memberUsernames = computed(() => members.value.map((m) => m.username))
const loading = ref(true)
const busy = ref(false)
const err = ref('')

const newSpace = ref('')
const navCreateOpen = ref(false)
const inviteDraft = ref({ usernames: [] as string[], role: 'viewer', orgNodeId: '' })
/** 添加成员：邀请已有账号 / 代注册新账号 */
const inviteMode = ref<'pick' | 'create'>('pick')
/** 添加成员：邀请已有账号 / 批量代注册新账号（`rows` 一行一个手机号） */
const createDraft = ref({ rows: '', role: 'viewer', orgNodeId: '' })

/** 一次性提示（移动成员、建号成功等），2.6s 自动消失 */
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function flash(text: string) {
  notice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 2600)
}

const importOpen = ref(false)
const importText = ref('')
const importFormat = ref<'csv' | 'xlsx' | 'docx' | 'json'>('csv')
const importResult = ref<OrgImportResult | null>(null)

const ROLE_RANK: Record<string, number> = { guest: 1, viewer: 2, editor: 3, admin: 4, owner: 5 }
const roleRank = (role: string | undefined) => (role && ROLE_RANK[role]) || 0
/** 空间级管理员：能管整个团队 */
const canManage = computed(() => roleRank(current.value?.role) >= 4)

/* ---------------- 部门负责人（作用范围 = 自己负责的节点及整棵子树） ---------------- */

const myId = computed(() => store.user?.id ?? '')
const nodeById = computed(() => new Map(nodes.value.map((n) => [n.id, n])))
/** 我负责的节点 */
const myLeadNodes = computed(() => nodes.value.filter((n) => n.leadUserId && n.leadUserId === myId.value))
const leadPaths = computed(() => myLeadNodes.value.map((n) => n.path))
/** 节点是否落在我的负责范围里（含自身、含所有下级） */
function inMyScope(nodeId: string | null | undefined): boolean {
  if (!nodeId) return false
  const path = nodeById.value.get(nodeId)?.path
  return !!path && leadPaths.value.some((led) => path.startsWith(led))
}
/** 我能不能动这个节点（管理员全能动，负责人只动自己子树） */
function canManageNode(nodeId: string): boolean {
  return canManage.value || inMyScope(nodeId)
}
/** 我能不能管这个成员 */
function canManageMember(m: SpaceMemberInfo): boolean {
  return canManage.value || inMyScope(m.orgNodeId)
}
/** 他是不是所在部门的负责人 */
function isDeptLead(m: SpaceMemberInfo): boolean {
  return !!m.orgNodeId && nodeById.value.get(m.orgNodeId)?.leadUserId === m.id
}
/**
 * 负责人永远排在最前，其余保持后端返回的入队顺序（`sort` 是稳定排序，
 * 同权重不会被打乱）。组内成员很多时，负责人埋在中段很难找。
 */
function orderMembers(list: SpaceMemberInfo[]): SpaceMemberInfo[] {
  return list.sort((a, b) => Number(isDeptLead(b)) - Number(isDeptLead(a)))
}
/** 每个部门直属的人数（不含下级） */
const nodeMemberCount = computed(() => {
  const map = new Map<string, number>()
  for (const m of members.value) {
    if (!m.orgNodeId) continue
    map.set(m.orgNodeId, (map.get(m.orgNodeId) ?? 0) + 1)
  }
  return map
})
/** 部门里只有他一个人：负责人由系统自动指定，撤销没有意义 */
function isSoloLead(m: SpaceMemberInfo): boolean {
  return isDeptLead(m) && (m.orgNodeId ? (nodeMemberCount.value.get(m.orgNodeId) ?? 0) : 0) <= 1
}
/** 所在部门现任负责人姓名（换人时提示会替代谁） */
function currentLeadName(m: SpaceMemberInfo): string {
  const node = m.orgNodeId ? nodeById.value.get(m.orgNodeId) : undefined
  return node?.leadUserId && node.leadUserId !== m.id ? node.leadName ?? '其他人' : ''
}
/** 有没有任何管理范围：空间管理员，或至少负责一个部门 */
const canManagePeople = computed(() => canManage.value || myLeadNodes.value.length > 0)
/** 交给组织树的管理范围：管理员不用传（canManage 已经放开） */
const manageNodeIds = computed(() =>
  canManage.value ? [] : nodes.value.filter((n) => inMyScope(n.id)).map((n) => n.id),
)
/** 负责人最多授到 editor，不能自己造管理员 */
const assignableRoles = computed(() =>
  canManage.value ? roleOptions : roleOptions.filter((r) => roleRank(r.value) < 4),
)


/** 供人员选择器做横向团队 tab */
const teamSpaces = computed(() =>
  spaces.value.filter((s) => s.type === 'team').map((s) => ({ id: s.id, name: s.name })),
)

const ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '可编辑',
  viewer: '可查看',
  guest: '访客',
}
const roleLabel = (role: string) => ROLE_LABEL[role] ?? role

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

/**
 * 真正拉数据的那一层。select 里套 run 会撞上忙碌保护，
 * 所以增删改之后在 run 内部刷新必须直接调 load，否则界面不更新。
 */
async function load(space: SpaceInfo) {
  // 换空间才清掉成员筛选；同一空间内的增删改刷新不能把用户选的节点丢掉
  if (current.value?.id !== space.id) scopeId.value = ''
  current.value = space
  const org = await getSpaceOrg(space.id)
  nodes.value = org.nodes
  members.value = org.members
  // 已在团队里的人不能再「邀请加入」，候选里直接剔掉，顺手清掉已选中的
  const inTeam = new Set(org.members.map((m) => m.username))
  if (inviteDraft.value.usernames.some((u) => inTeam.has(u))) {
    inviteDraft.value.usernames = inviteDraft.value.usernames.filter((u) => !inTeam.has(u))
  }
  pending.value = canManagePeople.value ? await listSpaceInvites(space.id) : []
  resolveScope()
  // 负责人没有「空间根」这个选项：草稿里的节点不在自己范围内就落到自己负责的节点
  if (!canManage.value && myLeadNodes.value.length) {
    const fallback = myLeadNodes.value[0]!.id
    if (!inMyScope(inviteDraft.value.orgNodeId)) inviteDraft.value.orgNodeId = fallback
    if (!inMyScope(createDraft.value.orgNodeId)) createDraft.value.orgNodeId = fallback
  }
}

async function select(space: SpaceInfo) {
  if (busy.value) return
  await run(() => load(space))
}

function create() {
  const name = newSpace.value.trim()
  if (!name) return
  return run(async () => {
    const space = await createSpace(name)
    newSpace.value = ''
    navCreateOpen.value = false
    await refreshSpaces()
    await load(space)
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
    await load(current.value!)
    if (errors.length) err.value = errors.join('；')
  })
}

/**
 * 二次确认弹窗。任命 / 撤销负责人、移出团队都是不可逆动作，
 * 统一走弹窗（行内二次确认太容易被右键、滚动带跑，也容易连点）。
 */
type ConfirmKind = 'lead' | 'unlead' | 'remove'
const confirmAsk = ref<{ kind: ConfirmKind; member: SpaceMemberInfo; nodeName: string; leadName: string } | null>(
  null,
)

function askLead(member: SpaceMemberInfo) {
  if (!member.orgNodeId) return
  const node = nodeById.value.get(member.orgNodeId)
  if (!node) return
  // 单人民部门的负责人是规则给的，撤销了也还是他，直接拦掉
  if (isSoloLead(member)) {
    flash(`「${node.name}」只有 1 人，负责人由系统自动指定`)
    return
  }
  confirmAsk.value = {
    kind: isDeptLead(member) ? 'unlead' : 'lead',
    member,
    nodeName: node.name,
    leadName: currentLeadName(member),
  }
}

function askRemove(member: SpaceMemberInfo) {
  if (!current.value) return
  const node = member.orgNodeId ? nodeById.value.get(member.orgNodeId) : undefined
  confirmAsk.value = { kind: 'remove', member, nodeName: node?.name ?? '', leadName: '' }
}

function closeConfirmAsk() {
  confirmAsk.value = null
}

const confirmDialog = computed(() => {
  const ask = confirmAsk.value
  if (!ask) {
    return {
      open: false,
      title: '',
      message: '',
      detail: '',
      confirmText: '确认',
      tone: 'primary' as 'primary' | 'danger',
    }
  }
  const name = ask.member.name || ask.member.username
  if (ask.kind === 'remove') {
    return {
      open: true,
      title: `将 ${name} 移出团队？`,
      message: `移出后 TA 会立刻失去「${current.value?.name ?? '该团队'}」内的全部文档与协作权限，需要重新邀请才能回来。`,
      detail: isDeptLead(ask.member)
        ? `TA 正在负责「${ask.nodeName}」，移出后该部门的负责人会按规则重新指定。`
        : '已共享给 TA 的文档访问权限会一并失效。',
      confirmText: '移出团队',
      tone: 'danger' as const,
    }
  }
  if (ask.kind === 'unlead') {
    return {
      open: true,
      title: `撤销 ${name} 的「${ask.nodeName}」负责人？`,
      message: '撤销后 TA 不再拥有该部门及下级部门的人员管理权，部门文档也会退回团队默认角色。',
      detail: '之后可以随时在右键菜单里重新任命。',
      confirmText: '撤销负责人',
      tone: 'danger' as const,
    }
  }
  // 部门已经有负责人：换人前必须明确提醒会顶掉谁
  if (ask.leadName) {
    return {
      open: true,
      title: `「${ask.nodeName}」已经有负责人了`,
      message: `现任负责人是 ${ask.leadName}。确认后改为 ${name}，${ask.leadName} 会立刻失去该部门及下级部门的人员管理权与文档完全控制。`,
      detail: '一个部门同一时间只有一位负责人；下级部门各自的负责人不受影响。',
      confirmText: '替换负责人',
      tone: 'danger' as const,
    }
  }
  return {
    open: true,
    title: `将 ${name} 设为「${ask.nodeName}」负责人？`,
    message: 'TA 将获得该部门及所有下级部门的人员管理权，以及这些部门文档的完全控制权限。',
    detail: '部门内成员会收到一条通知；团队所有者与管理员不受影响。',
    confirmText: '设为负责人',
    tone: 'primary' as const,
  }
})

/** 确认之后真正执行 */
function submitConfirm() {
  const ask = confirmAsk.value
  closeConfirmAsk()
  if (!ask) return
  if (ask.kind === 'remove') return removeMember(ask.member)
  return applyLead(ask.member, ask.kind === 'lead')
}

/** 任命 / 撤销部门负责人：作用范围是该成员所在节点及整棵子树 */
function applyLead(member: SpaceMemberInfo, on: boolean) {
  if (!current.value || !member.orgNodeId) return
  const node = nodeById.value.get(member.orgNodeId)
  if (!node) return
  const spaceId = current.value.id
  const nodeId = member.orgNodeId
  return run(async () => {
    await setNodeLead(spaceId, nodeId, on ? member.id : null)
    await load(current.value!)
    flash(
      on
        ? `已将 ${member.name} 设为「${node.name}」负责人`
        : `已撤销 ${member.name} 的「${node.name}」负责人`,
    )
  })
}

function changeRole(member: SpaceMemberInfo, role: string) {
  if (!current.value) return
  return run(async () => {
    await updateSpaceMember(current.value!.id, member.id, { role })
    await load(current.value!)
  })
}

/* ---------------- 拖成员到部门节点 ---------------- */

/** 和 OrgTree 约定的私有 MIME：避免和节点排序的 text/plain 混在一起 */
const MEMBER_MIME = 'application/x-ginkgo-member'
const draggingMemberId = ref('')

function onMemberDragStart(member: SpaceMemberInfo, e: DragEvent) {
  if (!canManage.value) {
    e.preventDefault()
    return
  }
  draggingMemberId.value = member.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(MEMBER_MIME, member.id)
  }
}

function onMemberDragEnd() {
  draggingMemberId.value = ''
}

/** 树上的节点接了成员：改归属后刷新，人少的节点会从列表里消失，所以不改变当前筛选 */
function assignMember(payload: { userId: string; nodeId: string }) {
  if (!current.value) return
  const member = members.value.find((m) => m.id === payload.userId)
  if (!member) return
  if (memberNodeId(member.orgNodeId) === payload.nodeId) return
  draggingMemberId.value = ''
  const target = nodeMap.value.get(payload.nodeId)
  return run(async () => {
    await updateSpaceMember(current.value!.id, payload.userId, { orgNodeId: payload.nodeId })
    await load(current.value!)
    flash(`已把 ${member.name || member.username} 移到「${target?.name ?? '该节点'}」`)
  })
}

/* ---------------- 代注册成员（支持一次多条 / CSV 导入） ---------------- */

interface MemberSeed {
  phone: string
  name: string
}

/**
 * 一行一条：`手机号` 或 `手机号,姓名`。不靠固定分隔符切列——直接在行里找 11 位手机号，
 * 剩下的文字就当姓名，所以「张三,13800000001」「13800000001 张三」「张三<TAB>13800000001」
 * 三种写法都认；表头行（没有手机号）自然被丢掉。
 */
function parseSeedLine(line: string): MemberSeed | null {
  const hit = line.match(/1[3-9]\d{9}/)
  if (!hit) return null
  const phone = hit[0]
  const name = line
    .replace(phone, ' ')
    .replace(/[,，、;；\t|]+/g, ' ')
    .replace(/^(手机号|手机|电话|姓名)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
  return { phone, name }
}

/** 解析出来的待建号名单：顺手去重，同一手机号写两遍只算一条 */
const createSeeds = computed<MemberSeed[]>(() => {
  const out: MemberSeed[] = []
  const seen = new Set<string>()
  for (const line of createDraft.value.rows.split(/\r?\n/)) {
    const seed = parseSeedLine(line.trim())
    if (!seed || seen.has(seed.phone)) continue
    seen.add(seed.phone)
    out.push(seed)
  }
  return out
})

/** 批量建号时没成功的手机号，就地显示在邀请区下方（页面底部的 err 离这里太远） */
const createErrors = ref<string[]>([])

const memberFile = ref<HTMLInputElement | null>(null)
const templateOpen = ref(false)
const templateUp = ref(false)
const templateRight = ref(false)

/** 下载菜单位于卡片底部，靠边时改成向上 / 右对齐，别让它被视口裁掉 */
function toggleTemplate(e: MouseEvent) {
  if (templateOpen.value) {
    templateOpen.value = false
    return
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  templateUp.value = window.innerHeight - r.bottom < 120
  templateRight.value = window.innerWidth - r.right < 190
  templateOpen.value = true
}

/** 模板只放表头 + 两行示例；角色与部门统一用下面的下拉，文档里不重复写 */
function downloadTemplate(format: MemberTemplateFormat) {
  const { blob, filename } = makeMemberTemplate(format)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  templateOpen.value = false
  flash(`已下载 ${filename}，照示例填好后导入即可`)
}

function pickMemberFile() {
  templateOpen.value = false
  memberFile.value?.click()
}

/* ---------------- 导入预览与手机号判重 ---------------- */

type ImportStatus = 'ok' | 'inTeam' | 'owner' | 'duplicate' | 'invalid'
interface ImportRow {
  phone: string
  name: string
  status: ImportStatus
  note: string
}

const importPreview = ref<{ fileName: string; rows: ImportRow[] } | null>(null)
const importBusy = ref(false)
const importOkCount = computed(() => importPreview.value?.rows.filter((r) => r.status === 'ok').length ?? 0)

/** 先本地解析 + 文件内判重；表头行直接丢掉，没有手机号的内容行标为无效 */
function buildImportRows(text: string): ImportRow[] {
  const out: ImportRow[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const seed = parseSeedLine(line)
    if (!seed) {
      // 「手机号,姓名」这类表头没有号码，不算错误行
      if (/手机号|手机|电话|姓名|phone|name/i.test(line)) continue
      out.push({ phone: '', name: line, status: 'invalid', note: '未找到 11 位手机号' })
      continue
    }
    if (seen.has(seed.phone)) {
      out.push({ ...seed, status: 'duplicate', note: '文件内重复，只保留第一条' })
      continue
    }
    seen.add(seed.phone)
    out.push({ ...seed, status: 'ok', note: '可导入' })
  }
  return out
}

/**
 * 导入文档后不直接写入输入框：先展示每一行的解析结果与判重结论，用户确认才载入。
 * 手机号判重分三层：文件内（上面）、团队内（后端预检）、已有账号（后端预检，
 * 已有账号不是错误——按约定会直接加入团队）。
 */
async function onMemberFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  try {
    const text = await readMemberFile(file)
    const rows = buildImportRows(text)
    if (!rows.length) {
      flash('这个文件里没找到手机号，检查一下格式')
      return
    }
    importPreview.value = { fileName: file.name, rows }
    importBusy.value = true
    try {
      const phones = rows.filter((r) => r.status === 'ok').map((r) => r.phone)
      if (current.value && phones.length) {
        const res = await checkMemberPhones(current.value.id, phones)
        const byPhone = new Map(res.results.map((x) => [x.phone, x]))
        for (const row of rows) {
          if (row.status !== 'ok') continue
          const hit = byPhone.get(row.phone)
          if (hit?.isOwner) {
            row.status = 'owner'
            row.note = '团队所有者，不能重复加入'
          } else if (hit?.inTeam) {
            row.status = 'inTeam'
            row.note = '已是团队成员'
          } else if (hit?.hasAccount) {
            row.note = '账号已存在，将直接加入团队'
          }
        }
      }
    } catch {
      // 预检失败也不能卡住导入：退化为用当前成员列表做一次本地判重
      const inTeam = new Set(memberUsernames.value)
      for (const row of rows) {
        if (row.status === 'ok' && inTeam.has(row.phone)) {
          row.status = 'inTeam'
          row.note = '已是团队成员'
        }
      }
    } finally {
      importBusy.value = false
    }
  } catch (e) {
    err.value = `导入失败：${errorText(e)}`
  }
}

function closeImportPreview() {
  importPreview.value = null
}

/** 只把可导入的行载入输入框，仍由用户点「建号并加入」完成真正的写入 */
function confirmImport() {
  const preview = importPreview.value
  if (!preview) return
  const rows = preview.rows.filter((r) => r.status === 'ok')
  if (!rows.length) return
  createDraft.value = {
    rows: rows.map((r) => (r.name ? `${r.phone},${r.name}` : r.phone)).join('\n'),
    role: createDraft.value.role,
    orgNodeId: createDraft.value.orgNodeId,
  }
  createErrors.value = []
  importPreview.value = null
  const skipped = preview.rows.length - rows.length
  flash(`已载入 ${rows.length} 人${skipped ? `，跳过 ${skipped} 条重复/无效` : ''}，确认后点「建号并加入」`)
}

function setInviteMode(mode: 'pick' | 'create') {
  inviteMode.value = mode
  createErrors.value = []
  // 正在看某个部门时，默认把新成员建到那个部门下
  if (mode === 'create' && scopeId.value && !createDraft.value.orgNodeId) {
    createDraft.value.orgNodeId = scopeId.value
  }
  // 负责人：没选节点时落到自己负责的部门
  if (!canManage.value && myLeadNodes.value.length) {
    if (mode === 'create' && !inMyScope(createDraft.value.orgNodeId)) {
      createDraft.value.orgNodeId = myLeadNodes.value[0]!.id
    }
    if (mode === 'pick' && !inMyScope(inviteDraft.value.orgNodeId)) {
      inviteDraft.value.orgNodeId = myLeadNodes.value[0]!.id
    }
  }
}

/**
 * 批量建号：共用当前选的角色与部门，逐个串行调接口（并发写 SQLite 容易撞锁）。
 * 单条失败不影响其他人，失败的手机号收集起来就地在邀请区下面提示。
 */
function createMembers() {
  const seeds = createSeeds.value
  if (!current.value || !seeds.length) return
  const draft = { ...createDraft.value }
  return run(async () => {
    let created = 0
    let joined = 0
    const failed: string[] = []
    const failedPhones: string[] = []
    for (const seed of seeds) {
      try {
        const res = await registerSpaceMember(current.value!.id, {
          phone: seed.phone,
          name: seed.name || undefined,
          role: draft.role,
          orgNodeId: draft.orgNodeId || undefined,
        })
        if (res.created) created++
        else joined++
      } catch (e) {
        failed.push(`${seed.phone}：${errorText(e)}`)
        failedPhones.push(seed.name ? `${seed.phone},${seed.name}` : seed.phone)
      }
    }
    // 失败的行留在输入框里，改一下就能重试，不用重新粘一遍
    createDraft.value = { rows: failedPhones.join('\n'), role: draft.role, orgNodeId: draft.orgNodeId }
    createErrors.value = failed
    await load(current.value!)
    const ok: string[] = []
    if (created) ok.push(`新建 ${created} 个账号（初始密码为手机号）`)
    if (joined) ok.push(`${joined} 个已有账号直接加入`)
    if (ok.length) flash(ok.join('，'))
  })
}

function removeMember(member: SpaceMemberInfo) {
  if (!current.value) return
  return run(async () => {
    await removeSpaceMember(current.value!.id, member.id)
    await load(current.value!)
  })
}

/* ---------------- 成员行右键菜单 ---------------- */

const menuMember = ref<SpaceMemberInfo | null>(null)
const menuPos = ref({ x: 0, y: 0 })
/** 我和谁是好友、已经向谁发过申请：决定右键里「添加好友」这条怎么显示 */
const friendUsernames = ref<Set<string>>(new Set())
const sentUsernames = ref<Set<string>>(new Set())

async function loadFriendState() {
  try {
    const [friends, sent] = await Promise.all([listFriends(), listSentFriendRequests()])
    friendUsernames.value = new Set(friends.map((f) => f.username))
    sentUsernames.value = new Set(sent.map((r) => r.to?.username).filter((u): u is string => !!u))
  } catch {
    // 好友接口挂了不该影响团队管理：菜单里的「添加好友」退化为可点，失败时再报错
  }
}

function openMemberMenu(member: SpaceMemberInfo, e: MouseEvent) {
  e.preventDefault()
  // 先按估算尺寸把菜单夹进视口，贴边右键时不会溢出屏幕
  const W = 186
  const H = 210
  menuPos.value = {
    x: Math.max(8, Math.min(e.clientX, window.innerWidth - W - 8)),
    y: Math.max(8, Math.min(e.clientY, window.innerHeight - H - 8)),
  }
  menuMember.value = member
}

function closeMemberMenu() {
  menuMember.value = null
}

/** me：自己；friend：已是好友；pending：已发申请；none：可以申请 */
function friendState(member: SpaceMemberInfo): 'me' | 'friend' | 'pending' | 'none' {
  if (member.id === myId.value) return 'me'
  if (friendUsernames.value.has(member.username)) return 'friend'
  if (sentUsernames.value.has(member.username)) return 'pending'
  return 'none'
}

function addFriendFromMenu(member: SpaceMemberInfo) {
  closeMemberMenu()
  return run(async () => {
    await sendFriendRequest(member.username)
    sentUsernames.value = new Set([...sentUsernames.value, member.username])
    flash(`已向 ${member.name || member.username} 发送好友申请`)
  })
}

function leadFromMenu(member: SpaceMemberInfo) {
  closeMemberMenu()
  askLead(member)
}

/** 移出是危险操作：右键点了也只是弹确认窗，不会当场执行 */
function removeFromMenu(member: SpaceMemberInfo) {
  closeMemberMenu()
  askRemove(member)
}

function onMenuDocDown(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (templateOpen.value && !target?.closest('.tm-format')) templateOpen.value = false
  if (!menuMember.value) return
  if (target?.closest('.tm-menu')) return
  closeMemberMenu()
}

function onMenuKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  templateOpen.value = false
  closeMemberMenu()
}

async function enterTeam() {
  if (!current.value) return
  await switchSpace(current.value.id)
  await reloadPages()
  goHome()
}

/** 组织节点 → 级联选项：管理员可以从「不指定节点」起步，负责人只列自己能管的子树 */
const orgCascade = computed<GnCascadeOption[]>(() => {
  const list = canManage.value ? nodes.value : nodes.value.filter((n) => inMyScope(n.id))
  const ids = new Set(list.map((n) => n.id))
  const byParent = new Map<string, OrgNodeInfo[]>()
  const roots: OrgNodeInfo[] = []
  for (const n of list) {
    if (n.parentId && ids.has(n.parentId)) {
      const bucket = byParent.get(n.parentId)
      if (bucket) bucket.push(n)
      else byParent.set(n.parentId, [n])
    } else {
      roots.push(n)
    }
  }
  const toOption = (n: OrgNodeInfo): GnCascadeOption => {
    const kids = byParent.get(n.id) ?? []
    const opt: GnCascadeOption = { value: n.id, label: n.name }
    if (kids.length) opt.children = kids.map(toOption)
    return opt
  }
  const tree = roots.map(toOption)
  // 「不指定节点」等于挂到空间根上，只有管理员能这么放
  return canManage.value ? [{ value: '', label: '不指定节点' }, ...tree] : tree
})
const formatOptions = [
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'docx', label: 'Word (.docx)' },
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
  // 没选组织节点就不列成员：一次渲染几十上百行会明显拖慢首屏，先让用户点一个部门
  if (!scope) return []
  if (!includeChildren.value) {
    return [
      {
        key: scope.id,
        segs: [],
        members: orderMembers(members.value.filter((m) => memberNodeId(m.orgNodeId) === scope.id)),
      },
    ]
  }
  const out: MemberGroup[] = []
  for (const id of subtreeOrder(scope.id)) {
    const list = orderMembers(members.value.filter((m) => memberNodeId(m.orgNodeId) === id))
    if (list.length) out.push({ key: id, segs: pathOf(id), members: list })
  }
  return out
})

const visibleMembers = computed(() => groups.value.flatMap((g) => g.members))
/** 卡片标题上的数字：没选节点时给团队总人数，选了节点给节点内人数 */
const headCount = computed(() => (scopeNode.value ? visibleMembers.value.length : members.value.length))
const scopePath = computed(() => (scopeNode.value ? pathOf(scopeNode.value.id) : []))
const scopePathText = computed(() => scopePath.value.join(' / '))

const visiblePending = computed(() => {
  const scope = scopeNode.value
  if (!scope) return []
  const ids = new Set(includeChildren.value ? subtreeOrder(scope.id) : [scope.id])
  return pending.value.filter((p) => ids.has(memberNodeId(p.orgNodeId ?? '')))
})

/** 组织树传空 id 表示「再点一次取消了选择」，回到未选状态的收起布局 */
function selectNode(id: string) {
  scopeId.value = id
}
function clearScope() {
  scopeId.value = ''
}
function toggleChildren() {
  if (scopeNode.value) includeChildren.value = !includeChildren.value
}
/** 节点被删/换空间后，选中的 id 可能已失效，回落到「未选择节点」 */
function resolveScope() {
  if (scopeId.value && !nodeMap.value.has(scopeId.value)) scopeId.value = ''
}

async function reloadOrg() {
  if (current.value) await select(current.value)
}

/**
 * 选文件后立刻解析成可编辑文本填进输入框（CSV/TXT/XLSX/DOCX 走统一的 readMemberFile，
 * JSON 保留原文），用户在上方面板里改完、确认无误再点「开始导入」才真正写库。
 */
async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  try {
    const name = file.name.toLowerCase()
    if (name.endsWith('.json')) {
      importFormat.value = 'json'
      importText.value = (await file.text()).replace(/^\ufeff/, '')
    } else {
      // xlsx / docx / csv / txt 都解析成 CSV 行文本；后缀决定下拉显示的格式
      importFormat.value = name.endsWith('.xlsx')
        ? 'xlsx'
        : name.endsWith('.docx')
          ? 'docx'
          : 'csv'
      importText.value = await readMemberFile(file)
    }
    if (!importText.value.trim()) flash('文件里没有可识别的内容，检查一下格式')
  } catch (ex) {
    err.value = `文件解析失败：${errorText(ex)}`
  }
}

/** 输入区内容变化就实时给出解析概览（纯前端估算，不落库、不调后端） */
const importPreviewInfo = computed(() => {
  const text = importText.value.trim()
  if (!text) return null
  if (importFormat.value === 'json') {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown> | unknown[]
      const nodes = Array.isArray(parsed) ? parsed : ((parsed as { nodes?: unknown[] }).nodes ?? [])
      const members = Array.isArray(parsed) ? [] : ((parsed as { members?: unknown[] }).members ?? [])
      return { labels: `${nodes.length} 个节点 · ${members.length} 位成员`, error: '' }
    } catch {
      return { labels: '', error: 'JSON 格式不正确，请检查括号与逗号' }
    }
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const paths = new Set<string>()
  let members = 0
  let first = true
  for (const line of lines) {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (first) {
      first = false
      if (/部门|路径|path|name|dept|姓名|手机号/i.test(cols.join(' '))) continue
    }
    if (!cols[0]) continue
    paths.add(cols[0])
    if (cols[1]) members++
  }
  return { labels: `${paths.size} 条部门路径 · ${members} 位成员`, error: '' }
})

function doImport() {
  if (!current.value || !importText.value.trim()) return
  return run(async () => {
    const text = importText.value.trim()
    let payload: Record<string, unknown>
    // xlsx / docx 已在选文件时解析成 CSV 行，提交时和 csv 走同一条后端路径
    if (importFormat.value !== 'json') {
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
    await load(current.value!)
  })
}

onMounted(async () => {
  document.addEventListener('mousedown', onMenuDocDown, true)
  document.addEventListener('keydown', onMenuKey)
  window.addEventListener('resize', closeMemberMenu)
  window.addEventListener('scroll', closeMemberMenu, true)
  try {
    await refreshSpaces()
    await reloadSpaces()
    // 优先打开第一个团队；没有团队时退到个人空间，避免主区整片空白
    const initial = spaces.value.find((s) => s.type === 'team') ?? spaces.value[0]
    if (initial) await select(initial)
    // 右键菜单要知道谁已经是好友，单独异步取，失败了也不影响页面
    void loadFriendState()
  } catch (e) {
    err.value = errorText(e)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
  document.removeEventListener('mousedown', onMenuDocDown, true)
  document.removeEventListener('keydown', onMenuKey)
  window.removeEventListener('resize', closeMemberMenu)
  window.removeEventListener('scroll', closeMemberMenu, true)
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

          <div class="tm-cols" :class="{ 'is-scopeless': !scopeNode }">
            <section class="tm-card">
              <div class="tm-card-head">
                <Users :size="14" /><span>组织架构</span>
                <span class="tm-count">{{ nodes.length }}</span>
                <span v-if="!scopeNode" class="tm-tree-hint">点任意节点查看成员</span>
              </div>
              <div class="tm-card-body tm-scroll">
                <OrgTree
                  :space-id="current.id"
                  :nodes="nodes"
                  :can-manage="canManage"
                  :manage-node-ids="manageNodeIds"
                  :selected-id="scopeId"
                  @select="selectNode"
                  @changed="reloadOrg"
                  @assign-member="assignMember"
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
                    placeholder="CSV：节点路径,用户名,角色&#10;研发部/前端组,zhangsan,editor&#10;研发部/后端组,lisi,viewer&#10;&#10;也支持 Excel / Word / JSON：选择文件后会自动解析到这里，可先修改再导入"
                  ></textarea>
                  <p v-if="importPreviewInfo" class="tm-import-live" :class="{ bad: importPreviewInfo.error }">
                    <template v-if="importPreviewInfo.error">{{ importPreviewInfo.error }}</template>
                    <template v-else>
                      <Check :size="12" /> 已解析：{{ importPreviewInfo.labels }} —— 可在上方调整，确认后点「开始导入」
                    </template>
                  </p>
                  <div class="tm-inline tm-wrap">
                    <label class="tm-btn tm-file">
                      选择文件
                      <input type="file" accept=".csv,.txt,.json,.xlsx,.docx" @change="onImportFile" />
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
                <span class="tm-count">{{ headCount }}</span>
                <span v-if="scopeNode && visibleMembers.length !== members.length" class="tm-head-of">
                  共 {{ members.length }} 人
                </span>
                <span v-if="canManagePeople" class="tm-head-tip">右键成员可管理</span>
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
                <span v-else class="tm-scope-all">未选择组织节点</span>

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

              <div class="tm-card-body tm-people-body tm-scroll" :class="{ 'is-idle': !scopeNode }">
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
                    :class="{
                      'is-grouped': g.segs.length,
                      'is-draggable': canManageMember(m),
                      'is-dragging': draggingMemberId === m.id,
                      'is-lead': isDeptLead(m),
                    }"
                    :draggable="canManageMember(m)"
                    @dragstart="onMemberDragStart(m, $event)"
                    @dragend="onMemberDragEnd"
                    @contextmenu.prevent="openMemberMenu(m, $event)"
                  >
                    <span
                      v-if="canManageMember(m)"
                      class="tm-grip"
                      aria-hidden="true"
                      v-tooltip="'拖到左侧组织节点上即可改归属'"
                    >
                      <GripVertical :size="12" />
                    </span>
                    <div class="tm-avatar">{{ (m.name || '?').slice(0, 1) }}</div>
                    <div class="tm-member-main">
                      <div class="tm-member-name">
                        <span class="tm-name-text">{{ m.name }}</span>
                        <span
                          v-if="isDeptLead(m) && m.role !== 'owner'"
                          class="tm-lead-tag"
                          v-tooltip="'部门负责人：可管理该部门及下级的人员与文档'"
                        >
                          <Crown :size="10" />负责人
                        </span>
                      </div>
                      <div class="tm-member-sub">@{{ m.username }}</div>
                    </div>
                    <GnSelect
                      v-if="canManageMember(m) && m.role !== 'owner' && !isDeptLead(m)"
                      :model-value="m.role"
                      :options="canManage ? roleOptions : assignableRoles"
                      :min-width="92"
                      v-tooltip="'成员角色：可管理 / 可编辑 / 可查看'"
                      @update:model-value="changeRole(m, $event)"
                    />
                    <span
                      v-else-if="isDeptLead(m) && m.role !== 'owner'"
                      class="tm-tag tm-tag-full"
                      v-tooltip="'部门负责人：对该部门及下级的人员、文档都是完全控制，不需要再单独设角色'"
                    >
                      <ShieldCheck :size="11" />完全控制
                    </span>
                    <span v-else class="tm-tag">{{ roleLabel(m.role) }}</span>
                    <!-- 任命 / 移出这类不可逆操作只在右键菜单里给，行内不放按钮，避免误点 -->
                  </div>
                </section>

                <div v-if="!visibleMembers.length" class="tm-people-empty">
                  <template v-if="!scopeNode">
                    <FolderTree :size="18" class="tm-people-empty-icon" />
                    <span>先选一个组织节点</span>
                    <span class="tm-people-empty-tip">
                      点左侧组织架构里的任意节点查看成员；团队共 {{ members.length }} 人，不一次性全部列出
                    </span>
                  </template>
                  <template v-else>
                    <span>这个节点下还没有成员</span>
                    <span class="tm-people-empty-tip">
                      可以打开「包含下级」，或邀请时把成员挂到这个节点下
                    </span>
                  </template>
                </div>

                <div v-if="visiblePending.length" class="tm-pending">
                  <div class="tm-subtitle">待接受邀请<span class="tm-count">{{ visiblePending.length }}</span></div>
                  <div v-for="p in visiblePending" :key="p.id" class="tm-member is-pending">
                    <div class="tm-member-main">{{ p.invitee?.name || p.invitee?.username || p.id }}</div>
                    <span class="tm-tag">{{ p.role }}</span>
                  </div>
                </div>
              </div>

              <div v-if="canManagePeople" class="tm-invite">
                <div class="tm-invite-head">
                  <div class="tm-tabs">
                    <button
                      type="button"
                      :class="{ on: inviteMode === 'pick' }"
                      @click="setInviteMode('pick')"
                    >
                      邀请加入
                    </button>
                    <button
                      type="button"
                      :class="{ on: inviteMode === 'create' }"
                      @click="setInviteMode('create')"
                    >
                      新建成员
                    </button>
                  </div>
                  <span class="tm-invite-tip">
                    {{ inviteMode === 'create' ? '账号与初始密码都是手机号' : '已在团队的人不会出现在候选里' }}
                  </span>
                </div>

                <template v-if="inviteMode === 'pick'">
                  <PeoplePicker
                    v-model="inviteDraft.usernames"
                    source="both"
                    :space-id="current.id"
                    :spaces="teamSpaces"
                    :exclude="memberUsernames"
                    placeholder="选择好友或团队成员"
                  />
                  <div class="tm-inline tm-wrap">
                    <GnSelect
                      v-model="inviteDraft.role"
                      :options="assignableRoles"
                      :min-width="92"
                      v-tooltip="'邀请后授予的角色'"
                    />
                    <GnCascader
                      v-model="inviteDraft.orgNodeId"
                      :options="orgCascade"
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
                </template>

                <template v-else>
                  <div class="tm-batch">
                    <textarea
                      v-model="createDraft.rows"
                      class="tm-input tm-batch-input"
                      rows="3"
                      spellcheck="false"
                      placeholder="一行一个：手机号 或 手机号,姓名"
                      @input="createErrors = []"
                    />
                    <div class="tm-batch-bar">
                      <span class="tm-batch-count" :class="{ empty: !createSeeds.length }">
                        {{ createSeeds.length ? `已识别 ${createSeeds.length} 人` : '一行一个手机号' }}
                      </span>
                      <div class="tm-format">
                        <button type="button" class="tm-link" @click="toggleTemplate">
                          下载模板 <span class="tm-caret">▾</span>
                        </button>
                        <div
                          v-if="templateOpen"
                          class="tm-format-menu"
                          :class="{ up: templateUp, right: templateRight }"
                        >
                          <button
                            v-for="f in MEMBER_TEMPLATE_FORMATS"
                            :key="f.id"
                            type="button"
                            @click="downloadTemplate(f.id)"
                          >
                            {{ f.label }}
                          </button>
                        </div>
                      </div>
                      <button type="button" class="tm-link" @click="pickMemberFile">导入文档</button>
                      <input
                        ref="memberFile"
                        type="file"
                        accept=".csv,.txt,.xlsx,.docx"
                        class="tm-file"
                        @change="onMemberFile"
                      />
                    </div>
                  </div>
                  <div class="tm-inline tm-wrap">
                    <GnSelect
                      v-model="createDraft.role"
                      :options="assignableRoles"
                      :min-width="78"
                      v-tooltip="'这批新成员的角色'"
                    />
                    <GnCascader
                      v-model="createDraft.orgNodeId"
                      :options="orgCascade"
                      :min-width="120"
                      v-tooltip="'建号后直接挂到这个节点'"
                    />
                    <button
                      type="button"
                      class="tm-btn primary"
                      :disabled="busy || !createSeeds.length"
                      @click="createMembers"
                    >
                      <UserPlus :size="13" />建号并加入{{
                        createSeeds.length > 1 ? `（${createSeeds.length}）` : ''
                      }}
                    </button>
                  </div>
                  <p v-if="createErrors.length" class="tm-create-err">
                    {{ createErrors.slice(0, 3).join('；') }}{{ createErrors.length > 3 ? ` 等 ${createErrors.length} 条` : '' }}
                  </p>
                </template>
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

    <Transition name="tm-notice">
      <div v-if="notice" class="tm-notice">{{ notice }}</div>
    </Transition>

    <!-- 成员行右键菜单：和行内按钮同源，只是换成鼠标右键触发 -->
    <div
      v-if="menuMember"
      class="tm-menu gn-pop"
      role="menu"
      :style="{ left: menuPos.x + 'px', top: menuPos.y + 'px' }"
      @contextmenu.prevent
    >
      <div class="tm-menu-head">
        <span class="tm-menu-name">{{ menuMember.name }}</span>
        <span class="tm-menu-sub">@{{ menuMember.username }}</span>
      </div>

      <template v-if="friendState(menuMember) === 'none'">
        <button type="button" @click="addFriendFromMenu(menuMember)">
          <UserPlus :size="14" :stroke-width="1.8" /><span>添加好友</span>
        </button>
      </template>
      <button v-else type="button" class="is-muted" disabled>
        <component
          :is="friendState(menuMember) === 'friend' ? Check : friendState(menuMember) === 'pending' ? Clock : Users"
          :size="14"
          :stroke-width="1.8"
        />
        <span>
          {{
            friendState(menuMember) === 'friend'
              ? '已是好友'
              : friendState(menuMember) === 'pending'
                ? '已发送好友申请'
                : '这是你自己'
          }}
        </span>
      </button>

      <template v-if="canManageMember(menuMember)">
        <div class="tm-menu-sep" />
        <template v-if="menuMember.orgNodeId && menuMember.role !== 'owner'">
          <button v-if="isSoloLead(menuMember)" type="button" class="is-muted" disabled>
            <Crown :size="14" :stroke-width="1.8" />
            <span>负责人（自动指定）</span>
          </button>
          <button v-else type="button" @click="leadFromMenu(menuMember)">
            <Crown :size="14" :stroke-width="1.8" />
            <span>{{ isDeptLead(menuMember) ? '取消部门负责人' : '设为部门负责人' }}</span>
          </button>
        </template>
        <button type="button" class="danger" @click="removeFromMenu(menuMember)">
          <X :size="14" :stroke-width="1.8" /><span>移出团队</span>
        </button>
      </template>
    </div>

    <GnConfirm
      :open="confirmDialog.open"
      :title="confirmDialog.title"
      :message="confirmDialog.message"
      :detail="confirmDialog.detail"
      :confirm-text="confirmDialog.confirmText"
      :tone="confirmDialog.tone"
      :icon="confirmAsk?.kind === 'remove' ? 'trash' : 'alert'"
      @cancel="closeConfirmAsk"
      @confirm="submitConfirm"
    />

    <!-- 文档导入预览：先把解析与判重结果摆出来，确认后才写进输入框 -->
    <GnConfirm
      :open="!!importPreview"
      title="确认导入名单"
      :message="`已从「${importPreview?.fileName ?? ''}」识别 ${importPreview?.rows.length ?? 0} 行`"
      :detail="'只载入标记「可导入」的行；已有账号会直接加入团队，已有的团队成员会被跳过。'"
      confirm-text="确认载入"
      cancel-text="取消"
      wide
      :confirm-disabled="!importOkCount"
      @cancel="closeImportPreview"
      @confirm="confirmImport"
    >
      <template v-if="importBusy" #body>
        <p class="tm-import-check">正在检查手机号是否已存在…</p>
      </template>
      <template v-else-if="importPreview" #body>
        <div class="tm-import-table">
          <div class="tm-import-head">
            <span>手机号</span><span>姓名</span><span>结果</span>
          </div>
          <div v-for="(row, i) in importPreview.rows" :key="`${row.phone}-${i}`" class="tm-import-row" :class="row.status">
            <span>{{ row.phone || '—' }}</span>
            <span>{{ row.name || '—' }}</span>
            <span :title="row.note">
              {{ row.status === 'ok' ? (row.note === '可导入' ? '可导入' : row.note) : row.note }}
            </span>
          </div>
        </div>
        <p class="tm-import-sum">
          可导入 {{ importOkCount }} 人<template v-if="importPreview.rows.length > importOkCount">
            。其余 {{ importPreview.rows.length - importOkCount }} 条已跳过</template>
        </p>
      </template>
    </GnConfirm>
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
    /* 收起 / 展开成员列时让整块跟着走，不做「先消失再补位」的跳变 */
    transition:
      grid-template-columns 0.26s cubic-bezier(0.4, 0, 0.2, 1),
      gap 0.26s ease;
  }
  /* 没选组织节点：成员列压到 0 宽，把地方全让给组织树 */
  .tm-cols.is-scopeless {
    grid-template-columns: minmax(0, 1fr) minmax(0, 0px);
    gap: 0;
  }
}
.tm-people {
  transition:
    opacity 0.16s ease,
    transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
}
.tm-cols.is-scopeless .tm-people {
  opacity: 0;
  transform: translateX(10px);
  pointer-events: none;
  overflow: hidden;
}
@media (max-width: 1023px) {
  /* 窄屏是上下堆叠，没有横向空间可让，直接不占位 */
  .tm-cols.is-scopeless .tm-people {
    display: none;
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
.tm-tree-hint {
  margin-left: auto;
  font-size: 11px;
  font-weight: 400;
  color: var(--gn-text-muted);
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
.tm-people-empty-icon {
  margin-bottom: 2px;
  opacity: 0.65;
}
/* 未选节点：成员区整块空着，提示居中，避免一大片空白 */
.tm-people-body.is-idle {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 8px;
}
.tm-people-body.is-idle .tm-people-empty {
  max-width: 260px;
  margin-top: 0;
}

/* ---------- 成员 ---------- */
.tm-member {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border-radius: 8px;
}
.tm-member.is-draggable {
  cursor: grab;
}
/* 部门负责人：名字后面的小徽标（任命操作在右键菜单里，行内不再放按钮） */
.tm-lead-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  margin-left: 4px;
  padding: 0 5px;
  height: 16px;
  border-radius: 99px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  vertical-align: 1px;
  white-space: nowrap;
}
.tm-member.is-lead {
  background: var(--gn-bg-soft);
}
.tm-member.is-dragging {
  opacity: 0.45;
}
/* 拖拽手柄：常驻占位、仅悬停显形，避免每次 hover 都跳一下 */
.tm-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  flex: 0 0 10px;
  margin: 0 -5px 0 -3px;
  color: var(--gn-text-muted);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.tm-member:hover .tm-grip {
  opacity: 0.6;
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
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: 13px;
  color: var(--gn-text);
}
.tm-name-text {
  min-width: 0;
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
/* 负责人的角色位：不用下拉，直接标成完全控制 */
.tm-tag-full {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  height: 22px;
  padding: 0 7px;
  border-radius: 6px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 11.5px;
  white-space: nowrap;
}
/* 表头提示：管理操作都在右键菜单里，给一句引导 */
.tm-head-tip {
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid var(--gn-border);
  border-radius: 99px;
  background: var(--gn-bg-soft);
  font-size: 10.5px;
  font-weight: 400;
  color: var(--gn-text-muted);
  white-space: nowrap;
  /* 列变窄时让位给人数，而不是把表头撑出去 */
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
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
.tm-invite-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.tm-invite-tip {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--gn-text-muted);
}
.tm-tabs {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 2px;
  border-radius: 7px;
  background: var(--gn-bg-hover);
}
.tm-tabs button {
  height: 22px;
  padding: 0 9px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
}
.tm-tabs button.on {
  background: var(--gn-bg);
  color: var(--gn-text);
  box-shadow: var(--gn-shadow-sm);
}
.tm-input {
  flex: 1 1 0;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}
.tm-input:focus {
  border-color: var(--gn-accent);
}
.tm-input::placeholder {
  color: var(--gn-text-muted);
}
/* 批量建号：多行输入 + 模板下载 / CSV 导入 */
.tm-batch {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tm-batch-input {
  flex: none;
  height: auto;
  min-height: 62px;
  max-height: 128px;
  padding: 7px 9px;
  line-height: 1.55;
  font-size: 12px;
  resize: vertical;
}
.tm-batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.tm-batch-count {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--gn-accent);
}
.tm-batch-count.empty {
  color: var(--gn-text-muted);
}
.tm-batch-bar .tm-link {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--gn-text-soft);
}
/* 窄卡（成员卡只有 330px）里「可查看 + 部门 + 按钮」一行放不下：
   按钮给个下限宽度，剩余空间不够就整行换到下一行，不会把文字挤掉 */
.tm-invite .tm-btn {
  flex: 1 1 132px;
  white-space: nowrap;
}
.tm-batch-bar .tm-link:hover {
  color: var(--gn-accent);
}
.tm-caret {
  font-size: 9px;
}
/* 包装 div 必须自己也是 flex，否则会比旁边的 .tm-link 多出一行盒模型的基线偏移 */
.tm-format {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}
.tm-format-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: -6px;
  z-index: 80;
  display: flex;
  flex-direction: column;
  min-width: 184px;
  padding: 4px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-md);
}
.tm-format-menu.up {
  top: auto;
  bottom: calc(100% + 6px);
}
.tm-format-menu.right {
  left: auto;
  right: 0;
}
.tm-format-menu button {
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text);
  font-size: 11.5px;
  font-family: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.tm-format-menu button:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-accent);
}
.tm-import-table {
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
}
.tm-import-head,
.tm-import-row {
  display: grid;
  grid-template-columns: 116px 1fr 1fr;
  gap: 6px;
  padding: 6px 9px;
  font-size: 11.5px;
}
.tm-import-head {
  position: sticky;
  top: 0;
  background: var(--gn-bg-soft);
  color: var(--gn-text-muted);
}
.tm-import-row {
  border-top: 1px solid var(--gn-border);
  color: var(--gn-text);
}
.tm-import-row span:last-child {
  color: var(--gn-text-soft);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tm-import-row.ok span:last-child {
  color: var(--gn-accent);
}
.tm-import-row.inTeam span:last-child,
.tm-import-row.owner span:last-child,
.tm-import-row.duplicate span:last-child,
.tm-import-row.invalid span:last-child {
  color: var(--gn-danger);
}
.tm-import-sum,
.tm-import-check {
  margin: 9px 0 0;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.tm-file {
  display: none;
}
.tm-create-err {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--gn-danger);
}
/* 一次性提示：底部居中的小胶囊 */
.tm-notice {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 900;
  max-width: min(420px, calc(100vw - 40px));
  padding: 7px 14px;
  border-radius: 99px;
  background: var(--gn-text);
  color: var(--gn-bg);
  font-size: 12.5px;
  box-shadow: var(--gn-shadow-md);
  transform: translateX(-50%);
}
.tm-notice-enter-active,
.tm-notice-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.tm-notice-enter-from,
.tm-notice-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
/* ---------- 成员右键菜单 ---------- */
.tm-menu {
  position: fixed;
  z-index: 600;
  width: 186px;
  padding: 5px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
}
.tm-menu-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 8px 6px;
  border-bottom: 1px solid var(--gn-border);
  margin-bottom: 3px;
}
.tm-menu-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--gn-text);
}
.tm-menu-sub {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--gn-text-muted);
}
.tm-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.tm-menu button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tm-menu button:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.tm-menu button.danger {
  color: var(--gn-danger);
}
.tm-menu button.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
}
/* 已是好友 / 已申请 / 自己：保留位置但不给点 */
.tm-menu button.is-muted,
.tm-menu button.is-muted:hover {
  background: transparent;
  color: var(--gn-text-muted);
  cursor: default;
}
.tm-menu-sep {
  height: 1px;
  margin: 4px 3px;
  background: var(--gn-border);
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
.tm-import-live {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--gn-text-soft);
}
.tm-import-live :deep(svg) {
  color: var(--gn-accent);
  flex: 0 0 auto;
}
.tm-import-live.bad {
  color: var(--gn-danger);
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
