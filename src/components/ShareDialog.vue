<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, Copy, ExternalLink, Globe, RefreshCw, UserPlus, Users, X } from 'lucide-vue-next'
import SettingsModal from '@/views/settings/SettingsModal.vue'
import GnSelect from './GnSelect.vue'
import PeoplePicker from './PeoplePicker.vue'
import {
  createGrant,
  createShare,
  deleteGrant,
  deleteShare,
  errorText,
  formatDateTime,
  listGrants,
  listSpaces,
  shareOfPage,
  shareUrl,
  updateGrant,
  updateShare,
  type GrantInfo,
  type ShareInfo,
  type SpaceInfo,
} from '@/api/features'
import { store } from '@/store'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{ pageId: string; pageTitle: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const tab = ref<'publish' | 'members'>('publish')
const share = ref<ShareInfo | null>(null)
const loading = ref(true)
const busy = ref(false)
const err = ref('')
const copied = ref(false)
const linkInput = ref<HTMLInputElement | null>(null)
const isPublicSpace = computed(() => store.space === 'public')

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

/* ---------------- 发布 ---------------- */

const link = computed(() => (share.value ? shareUrl(share.value.token) : ''))

function togglePublish() {
  return run(async () => {
    if (share.value) {
      await deleteShare(share.value.id)
      share.value = null
    } else {
      share.value = await createShare(props.pageId)
    }
  })
}

async function copyLink() {
  const ok = await copyText(link.value)
  if (!ok) {
    err.value = '复制失败，请手动选择链接'
    // 退一步把链接选中，用户可以直接 Ctrl+C
    linkInput.value?.select()
    return
  }
  err.value = ''
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

const expiryOptions = [
  { value: 'never', label: '永久有效' },
  { value: '1', label: '1 天后失效' },
  { value: '7', label: '7 天后失效' },
  { value: '30', label: '30 天后失效' },
  { value: 'custom', label: '自定义日期…' },
]
const customDate = ref('')
const customMode = ref(false)
const expiryValue = computed({
  get: () => (customMode.value || share.value?.expiresAt ? 'custom' : 'never'),
  set: (v: string) => {
    if (!share.value) return
    if (v === 'custom') {
      customMode.value = true
      customDate.value = toDateInput(share.value.expiresAt ?? Date.now() + 7 * 86_400_000)
      return
    }
    customMode.value = false
    const expiresAt = v === 'never' ? null : Date.now() + Number(v) * 86_400_000
    void run(async () => {
      share.value = await updateShare(share.value!.id, { expiresAt })
    })
  },
})

function toDateInput(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function saveCustomDate() {
  if (!share.value || !customDate.value) return
  const ts = new Date(`${customDate.value}T23:59:59`).getTime()
  void run(async () => {
    share.value = await updateShare(share.value!.id, { expiresAt: ts })
  })
}

const pwdDraft = ref('')
function savePassword(clear = false) {
  if (!share.value) return
  return run(async () => {
    share.value = await updateShare(share.value!.id, { password: clear ? null : pwdDraft.value })
    pwdDraft.value = ''
  })
}

function toggleChildren() {
  if (!share.value) return
  return run(async () => {
    share.value = await updateShare(share.value!.id, { includeChildren: !share.value!.includeChildren })
  })
}

function regenerate() {
  if (!share.value) return
  if (!window.confirm('重新生成后，旧链接会立即失效。继续吗？')) return
  return run(async () => {
    share.value = await updateShare(share.value!.id, { regenerate: true })
  })
}

/* ---------------- 成员 ---------------- */

const grants = ref<GrantInfo[]>([])
const invite = ref({ usernames: [] as string[], role: 'viewer' as 'viewer' | 'editor' })
const roleOptions = [
  { value: 'viewer', label: '可查看' },
  { value: 'editor', label: '可编辑' },
]

const teamSpaces = ref<SpaceInfo[]>([])
const teamSpaceChoices = computed(() => teamSpaces.value.map((s) => ({ id: s.id, name: s.name })))

function addMembers() {
  if (!invite.value.usernames.length) return
  return run(async () => {
    const names = [...invite.value.usernames]
    const errors: string[] = []
    for (const username of names) {
      try {
        const g = await createGrant(props.pageId, username, invite.value.role)
        grants.value = [...grants.value.filter((x) => x.id !== g.id), g]
      } catch (e) {
        errors.push(`${username}：${errorText(e)}`)
      }
    }
    invite.value.usernames = []
    if (errors.length) err.value = errors.join('；')
  })
}

function changeRole(g: GrantInfo, role: string) {
  return run(async () => {
    const next = await updateGrant(g.id, role as 'viewer' | 'editor')
    grants.value = grants.value.map((x) => (x.id === g.id ? next : x))
  })
}

function removeMember(g: GrantInfo) {
  return run(async () => {
    await deleteGrant(g.id)
    grants.value = grants.value.filter((x) => x.id !== g.id)
  })
}

onMounted(async () => {
  try {
    const [s, g, spaces] = await Promise.all([
      shareOfPage(props.pageId),
      isPublicSpace.value ? [] : listGrants(props.pageId),
      isPublicSpace.value ? [] : listSpaces(),
    ])
    share.value = s
    grants.value = g
    teamSpaces.value = spaces.filter((x) => x.type === 'team')

  } catch (e) {
    err.value = errorText(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <SettingsModal :title="`分享「${pageTitle || '未命名'}」`" :width="460" @close="emit('close')">
    <div class="sd-tabs">
      <button type="button" :class="{ on: tab === 'publish' }" @click="tab = 'publish'">
        <Globe :size="13" :stroke-width="2" />发布到网络
      </button>
      <button type="button" :class="{ on: tab === 'members' }" @click="tab = 'members'">
        <Users :size="13" :stroke-width="2" />邀请成员<span v-if="grants.length" class="sd-count">{{ grants.length }}</span>
      </button>
    </div>

    <div v-if="loading" class="pf-empty">加载中…</div>

    <template v-else-if="tab === 'publish'">
      <div class="sd-row">
        <div>
          <div class="sd-title">公开链接</div>
          <div class="pf-row-desc">开启后，任何拿到链接的人都能阅读这个页面{{ share?.includeChildren ? '及其子页面' : '' }}</div>
        </div>
        <button type="button" class="pf-switch" :class="{ on: !!share }" :disabled="busy" @click="togglePublish"><i></i></button>
      </div>

      <template v-if="share">
        <div class="pf-copy">
          <input ref="linkInput" :value="link" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button type="button" class="pf-btn" @click="copyLink">
            <component :is="copied ? Check : Copy" :size="12" :stroke-width="2" />{{ copied ? '已复制' : '复制' }}
          </button>
          <a class="pf-btn" :href="link" target="_blank" rel="noopener" v-tooltip="'在新窗口打开'"><ExternalLink :size="12" :stroke-width="2" /></a>
        </div>

        <div class="sd-row">
          <div class="sd-title">有效期</div>
          <GnSelect v-model="expiryValue" :options="expiryOptions" :min-width="132" />
        </div>
        <div v-if="expiryValue === 'custom'" class="sd-row">
          <span class="pf-row-desc">{{ share.expiresAt ? `将于 ${formatDateTime(share.expiresAt)} 失效` : '选择失效日期' }}</span>
          <div class="pf-copy">
            <input v-model="customDate" type="date" />
            <button type="button" class="pf-btn" :disabled="busy" @click="saveCustomDate">设置</button>
          </div>
        </div>

        <div class="sd-row">
          <div>
            <div class="sd-title">访问密码</div>
            <div class="pf-row-desc">{{ share.hasPassword ? '已设置，访问者需输入密码' : '未设置，任何人都能直接打开' }}</div>
          </div>
          <div class="pf-copy">
            <input v-model="pwdDraft" type="text" :placeholder="share.hasPassword ? '输入新密码' : '4-64 位'" maxlength="64" />
            <button type="button" class="pf-btn" :disabled="busy || pwdDraft.length < 4" @click="savePassword()">保存</button>
            <button v-if="share.hasPassword" type="button" class="pf-btn" :disabled="busy" @click="savePassword(true)">清除</button>
          </div>
        </div>

        <div class="sd-row">
          <div class="sd-title">包含子页面</div>
          <button type="button" class="pf-switch" :class="{ on: share.includeChildren }" :disabled="busy" @click="toggleChildren"><i></i></button>
        </div>

        <div class="sd-row sd-foot">
          <span class="pf-row-desc">已被访问 {{ share.views }} 次{{ share.lastViewedAt ? ` · 最近 ${formatDateTime(share.lastViewedAt)}` : '' }}</span>
          <button type="button" class="pf-btn" :disabled="busy" @click="regenerate"><RefreshCw :size="12" :stroke-width="2" />重新生成链接</button>
        </div>
      </template>
    </template>

    <template v-else>
      <p v-if="isPublicSpace" class="pf-dialog-tip">公共原稿不支持邀请成员。</p>
      <template v-else>
        <div class="sd-invite">
          <PeoplePicker
            v-model="invite.usernames"
            source="both"
            :spaces="teamSpaceChoices"
            placeholder="选择好友或团队成员"
          />
          <GnSelect v-model="invite.role" :options="roleOptions" :min-width="92" />
          <button
            type="button"
            class="pf-btn primary"
            :disabled="busy || !invite.usernames.length"
            @click="addMembers"
          >
            <UserPlus :size="12" :stroke-width="2" />邀请{{ invite.usernames.length ? `（${invite.usernames.length}）` : '' }}
          </button>
        </div>
        <p class="pf-dialog-tip sd-tip">可以邀请好友，也可以邀请同团队的成员。被邀请的人会收到站内通知，可在侧栏「与我共享」中打开这个页面及其子页面。</p>
        <div v-if="grants.length" class="pf-list gn-scroll sd-grants">
          <div v-for="g in grants" :key="g.id" class="pf-list-item">
            <div class="pf-list-main">
              <div class="pf-list-title">{{ g.grantee.name }}</div>
              <div class="pf-row-desc">@{{ g.grantee.username }} · 邀请于 {{ formatDateTime(g.createdAt) }}</div>
            </div>
            <GnSelect
              :model-value="g.role"
              :options="roleOptions"
              :min-width="92"
              v-tooltip="'这个人拿到的权限'"
              @update:model-value="changeRole(g, $event)"
            />
            <button type="button" class="gn-icon-btn danger" v-tooltip="'移除'" :disabled="busy" @click="removeMember(g)"><X :size="14" /></button>
          </div>
        </div>
        <div v-else class="pf-empty">还没有邀请任何成员</div>
      </template>
    </template>

    <p v-if="err" class="pf-err">{{ err }}</p>
  </SettingsModal>
</template>

<style scoped>
.sd-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--gn-bg-hover);
}
.sd-tabs button {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  cursor: pointer;
}
.sd-tabs button.on {
  background: var(--gn-bg);
  color: var(--gn-text);
  box-shadow: var(--gn-shadow-sm);
}
.sd-count {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 99px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 10.5px;
}
.sd-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.sd-title {
  font-size: 13px;
  color: var(--gn-text);
}
.sd-foot {
  padding-top: 8px;
  border-top: 1px solid var(--gn-border);
}
.sd-friends {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.sd-invite {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.sd-invite .gn-select {
  margin-top: 2px;
}
.sd-invite .pf-btn {
  margin-top: 2px;
  flex: 0 0 auto;
}
.sd-tip {
  margin-top: 10px;
  line-height: 1.65;
}
/* 提示文字与成员列表之间留白，避免列表边框贴住文字下沿 */
.sd-grants {
  margin-top: 10px;
}
</style>
