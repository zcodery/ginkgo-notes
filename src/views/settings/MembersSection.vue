<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LogOut, UserPlus, X } from 'lucide-vue-next'
import GnSelect from '@/components/GnSelect.vue'
import PageIcon from '@/components/PageIcon.vue'
import { createGrant, deleteGrant, errorText, formatDateTime, listGrants, updateGrant, type GrantInfo } from '@/api/features'
import { goShared, goToPage, store } from '@/store'
import { loadShared, userState } from '@/userState'

const emit = defineEmits<{ (e: 'toast', type: 'ok' | 'err', text: string): void }>()

const grants = ref<GrantInfo[]>([])
const loading = ref(true)
const busy = ref(false)
const roleOptions = [
  { value: 'viewer', label: '可查看' },
  { value: 'editor', label: '可编辑' },
]

const pageOptions = computed(() =>
  store.pages
    .filter((p) => !p.trashed)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({ value: p.id, label: p.title || '未命名' })),
)
const invite = ref({ pageId: '', username: '', role: 'viewer' })

/** 按页面分组展示 */
const groups = computed(() => {
  const map = new Map<string, { pageId: string; title: string; icon: string; items: GrantInfo[] }>()
  for (const g of grants.value) {
    const cur = map.get(g.pageId) ?? { pageId: g.pageId, title: g.pageTitle, icon: g.pageIcon, items: [] }
    cur.items.push(g)
    map.set(g.pageId, cur)
  }
  return [...map.values()]
})

async function run(fn: () => Promise<void>) {
  busy.value = true
  try {
    await fn()
  } catch (e) {
    emit('toast', 'err', errorText(e))
  } finally {
    busy.value = false
  }
}

function add() {
  const { pageId, username, role } = invite.value
  if (!pageId || !username.trim()) return
  return run(async () => {
    const g = await createGrant(pageId, username.trim(), role as 'viewer' | 'editor')
    grants.value = [g, ...grants.value.filter((x) => x.id !== g.id)]
    invite.value.username = ''
    emit('toast', 'ok', `已邀请 ${g.grantee.name}`)
  })
}

function setRole(g: GrantInfo, role: string) {
  return run(async () => {
    const next = await updateGrant(g.id, role as 'viewer' | 'editor')
    grants.value = grants.value.map((x) => (x.id === g.id ? next : x))
  })
}

function remove(g: GrantInfo) {
  return run(async () => {
    await deleteGrant(g.id)
    grants.value = grants.value.filter((x) => x.id !== g.id)
  })
}

function leave(grantId: string) {
  if (!window.confirm('退出后将无法再访问该页面，确定吗？')) return
  return run(async () => {
    await deleteGrant(grantId)
    await loadShared()
    emit('toast', 'ok', '已退出')
  })
}

function sharedTitle(pageId: string) {
  return userState.sharedPages.find((p) => p.id === pageId)?.title || '未命名'
}

function openOwn(id: string) {
  store.settingsOpen = false
  goToPage(id)
}

function openShared(id: string) {
  store.settingsOpen = false
  goShared(id)
}

onMounted(async () => {
  try {
    grants.value = await listGrants()
    await loadShared()
  } catch (e) {
    emit('toast', 'err', errorText(e))
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <p class="pf-row-desc">
    把页面（连同子页面）授权给其他用户：「可查看」只能阅读，「可编辑」可以修改标题和正文。页面始终归你所有，随时可以撤销。
  </p>

  <template v-if="store.space === 'me'">
    <div class="pf-section-head"><div class="pf-sub">邀请成员</div></div>
    <div class="mb-invite">
      <GnSelect v-model="invite.pageId" :options="[{ value: '', label: '选择页面…' }, ...pageOptions]" :min-width="160" />
      <input v-model="invite.username" class="pf-input" placeholder="对方用户名" @keydown.enter="add" />
      <GnSelect v-model="invite.role" :options="roleOptions" :min-width="92" />
      <button type="button" class="pf-btn primary" :disabled="busy || !invite.pageId || !invite.username.trim()" @click="add">
        <UserPlus :size="12" :stroke-width="2" />邀请
      </button>
    </div>

    <div class="pf-section-head"><div class="pf-sub">我共享出去的页面</div></div>
    <div v-if="loading" class="pf-empty">加载中…</div>
    <div v-else-if="!groups.length" class="pf-empty">还没有邀请任何成员</div>
    <div v-for="g in groups" :key="g.pageId" class="mb-group">
      <button type="button" class="mb-page pf-link" @click="openOwn(g.pageId)">
        <PageIcon :icon="g.icon" :size="15" />{{ g.title || '未命名' }}
      </button>
      <div class="pf-list">
        <div v-for="m in g.items" :key="m.id" class="pf-list-item">
          <div class="pf-list-main">
            <div class="pf-list-title">{{ m.grantee.name }}</div>
            <div class="pf-row-desc">@{{ m.grantee.username }} · {{ formatDateTime(m.createdAt) }}</div>
          </div>
          <GnSelect :model-value="m.role" :options="roleOptions" :min-width="92" @update:model-value="setRole(m, $event)" />
          <button type="button" class="gn-icon-btn" v-tooltip="'撤销'" :disabled="busy" @click="remove(m)"><X :size="14" /></button>
        </div>
      </div>
    </div>
  </template>
  <p v-else class="pf-dialog-tip">公共原稿不支持邀请成员，请切回「我的笔记」。</p>

  <div class="pf-section-head"><div class="pf-sub">别人共享给我的</div></div>
  <div v-if="!userState.sharedRoots.length" class="pf-empty">暂时没有</div>
  <div v-else class="pf-list">
    <div v-for="r in userState.sharedRoots" :key="r.grantId" class="pf-list-item">
      <div class="pf-list-main">
        <div class="pf-list-title">
          <button type="button" class="pf-link" @click="openShared(r.pageId)">{{ sharedTitle(r.pageId) }}</button>
        </div>
        <div class="pf-row-desc">来自 {{ r.ownerName }} · {{ r.role === 'editor' ? '可编辑' : '可查看' }}</div>
      </div>
      <button type="button" class="pf-btn" :disabled="busy" @click="leave(r.grantId)"><LogOut :size="12" :stroke-width="2" />退出</button>
    </div>
  </div>
</template>

<style scoped>
.mb-invite {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mb-invite .pf-input {
  flex: 1 1 140px;
  width: auto;
  height: 30px;
}
.mb-group + .mb-group {
  margin-top: 12px;
}
.mb-page {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
}
</style>
