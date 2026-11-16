<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, Search, UserPlus, X } from 'lucide-vue-next'
import {
  acceptFriendRequest,
  blockFriend,
  declineFriendRequest,
  errorText,
  listFriendRequests,
  listFriends,
  listSentFriendRequests,
  removeFriend,
  searchUsers,
  sendFriendRequest,
  type FriendInfo,
  type FriendRequestInfo,
  type UserSearchItem,
} from '@/api/features'

const friends = ref<FriendInfo[]>([])
const incoming = ref<FriendRequestInfo[]>([])
const outgoing = ref<FriendRequestInfo[]>([])
const keyword = ref('')
const results = ref<UserSearchItem[]>([])
const loading = ref(true)
const busy = ref(false)
const err = ref('')

async function refresh() {
  const [f, i, o] = await Promise.all([listFriends(), listFriendRequests(), listSentFriendRequests()])
  friends.value = f
  incoming.value = i
  outgoing.value = o
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

function doSearch() {
  const q = keyword.value.trim()
  if (!q) return
  return run(async () => {
    results.value = await searchUsers(q)
  })
}

function add(item: UserSearchItem) {
  return run(async () => {
    await sendFriendRequest(item.username)
    results.value = results.value.map((x) =>
      x.id === item.id ? { ...x, relation: 'pending' } : x,
    )
    await refresh()
  })
}

function accept(id: string) {
  return run(async () => {
    await acceptFriendRequest(id)
    await refresh()
  })
}

function decline(id: string) {
  return run(async () => {
    await declineFriendRequest(id)
    await refresh()
  })
}

const confirming = ref<{ id: string; kind: 'remove' | 'block' } | null>(null)

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

function dateText(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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
    <div class="fr-bar">
      <div class="fr-bar-title">
        <h1>好友</h1>
        <p class="fr-desc">好友关系只用于文档分享与协作邀请，不会自动获得任何文档权限。</p>
      </div>
      <div class="fr-search">
        <input
          v-model="keyword"
          placeholder="输入用户名或昵称"
          @keydown.enter="doSearch"
        />
        <button type="button" :disabled="busy || !keyword.trim()" @click="doSearch">
          <Search :size="13" />搜索
        </button>
      </div>
    </div>

    <div v-if="results.length" class="fr-card">
      <div class="fr-card-title"><UserPlus :size="14" />搜索结果</div>
      <div class="fr-list">
        <div v-for="u in results" :key="u.id" class="fr-row">
          <div class="fr-avatar">
            <img v-if="u.avatar" :src="u.avatar" alt="" />
            <span v-else>{{ avatarText(u.name) }}</span>
          </div>
          <div class="fr-main">
            <div class="fr-name">{{ u.name }}</div>
            <div class="fr-sub">@{{ u.username }}</div>
          </div>
          <span v-if="u.relation" class="fr-tag">{{ relationText(u.relation) }}</span>
          <button
            v-else
            type="button"
            class="fr-btn primary"
            :disabled="busy"
            @click="add(u)"
          >
            加好友
          </button>
        </div>
      </div>

    </div>

    <div class="fr-cols">
    <div v-if="!incoming.length && !outgoing.length" class="fr-card">
      <div class="fr-card-title">好友申请</div>
      <p class="fr-empty">暂无新的好友申请。收到申请后会显示在这里。</p>
    </div>
    <div class="fr-card" v-if="incoming.length">
      <div class="fr-card-title">待处理申请<span class="fr-count">{{ incoming.length }}</span></div>
      <div class="fr-list">
        <div v-for="r in incoming" :key="r.id" class="fr-row">
          <div class="fr-avatar">
            <img v-if="r.from?.avatar" :src="r.from.avatar" alt="" />
            <span v-else>{{ avatarText(r.from?.name ?? '?') }}</span>
          </div>
          <div class="fr-main">
            <div class="fr-name">{{ r.from?.name }}</div>
            <div class="fr-sub">{{ r.message || '请求添加你为好友' }}</div>
          </div>
          <button type="button" class="fr-btn primary" :disabled="busy" @click="accept(r.id)">
            <Check :size="13" />同意
          </button>
          <button type="button" class="fr-btn" :disabled="busy" @click="decline(r.id)">
            <X :size="13" />拒绝
          </button>
        </div>
      </div>
    </div>

    <div class="fr-card">
      <div class="fr-card-title">我的好友<span class="fr-count">{{ friends.length }}</span></div>
      <div v-if="loading" class="fr-empty">加载中…</div>
      <div v-else-if="friends.length" class="fr-list">
        <div v-for="f in friends" :key="f.id" class="fr-row">
          <div class="fr-avatar">
            <img v-if="f.avatar" :src="f.avatar" alt="" />
            <span v-else>{{ avatarText(f.name) }}</span>
          </div>
          <div class="fr-main">
            <div class="fr-name">{{ f.name }}</div>
            <div class="fr-sub">
              @{{ f.username }}<template v-if="f.since"> · 添加于 {{ dateText(f.since) }}</template>
            </div>
          </div>
          <template v-if="confirming?.id === f.id">
            <span class="fr-confirm-text">确认{{ confirming.kind === 'remove' ? '解除好友' : '拉黑' }}？</span>
            <button
              type="button"
              class="fr-btn danger"
              :disabled="busy"
              @click="confirming.kind === 'remove' ? remove(f.id) : block(f.id)"
            >
              确认
            </button>
            <button type="button" class="fr-btn" :disabled="busy" @click="cancelConfirm">取消</button>
          </template>
          <template v-else>
            <button type="button" class="fr-btn danger" :disabled="busy" @click="ask(f.id, 'remove')">解除</button>
            <button type="button" class="fr-btn" :disabled="busy" @click="ask(f.id, 'block')">拉黑</button>
          </template>
        </div>
      </div>
      <p v-else class="fr-empty">还没有好友。添加好友后即可在分享面板中直接邀请。</p>
    </div>

    <div v-if="outgoing.length" class="fr-card">
      <div class="fr-card-title">已发出的申请</div>
      <div class="fr-list">
        <div v-for="r in outgoing" :key="r.id" class="fr-row">
          <div class="fr-avatar">{{ avatarText(r.to?.name ?? '?') }}</div>
          <div class="fr-main">
            <div class="fr-name">{{ r.to?.name }}</div>
            <div class="fr-sub">等待对方处理</div>
          </div>
        </div>
      </div>
    </div>
    </div>

    <p v-if="err" class="fr-err">{{ err }}</p>
    </div>
  </section>
</template>

<style scoped>
.fr-page {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}
.fr-inner {
  max-width: 1560px;
  margin: 0 auto;
  padding: 28px 32px 80px;
}
.fr-bar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.fr-cols {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}
.fr-cols .fr-card {
  margin-bottom: 0;
}
@media (min-width: 1024px) {
  .fr-cols {
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  }
}
.fr-head h1,
.fr-bar-title h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 650;
  color: var(--gn-text);
}
.fr-desc {
  margin: 0;
  max-width: 640px;
  font-size: 13px;
  color: var(--gn-text-soft);
}
.fr-card {
  margin-bottom: 16px;
  padding: 16px 18px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
}
.fr-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--gn-text);
}
.fr-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 11px;
  font-weight: 500;
}
.fr-search {
  display: flex;
  gap: 8px;
  flex: 1 1 320px;
  max-width: 440px;
}
.fr-search input {
  flex: 1 1 auto;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg-soft);
  color: var(--gn-text);
  font-size: 13px;
  outline: none;
}
.fr-search input:focus {
  border-color: var(--gn-accent);
}
.fr-search button,
.fr-btn {
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
.fr-btn.primary {
  border-color: transparent;
  background: var(--gn-accent);
  color: var(--gn-bg);
}
.fr-btn.danger {
  color: #c0392b;
}
.fr-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.fr-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fr-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--gn-bg-soft);
}
.fr-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 12.5px;
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
}
.fr-sub {
  font-size: 11.5px;
  color: var(--gn-text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fr-tag {
  font-size: 11.5px;
  color: var(--gn-text-soft);
}
.fr-confirm-text {
  font-size: 12px;
  color: var(--gn-text-soft);
  white-space: nowrap;
}
.fr-empty {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--gn-text-soft);
}
.fr-err {
  margin: 0;
  font-size: 12.5px;
  color: #c0392b;
}
</style>