<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
const searched = ref(false)
const loading = ref(true)
const busy = ref(false)
const err = ref('')

const confirming = ref<{ id: string; kind: 'remove' | 'block' } | null>(null)

const incomingCount = computed(() => incoming.value.length)
/** 右侧栏只在有待处理 / 已发出申请时才占位，否则好友列表铺满整行 */
const hasSide = computed(() => incomingCount.value > 0 || outgoing.value.length > 0)

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
    searched.value = true
  })
}

function clearSearch() {
  keyword.value = ''
  results.value = []
  searched.value = false
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
              placeholder="搜索用户名或昵称"
              @keydown.enter="doSearch"
            />
            <button
              v-if="searched || keyword"
              type="button"
              class="fr-search-clear"
              v-tooltip="'清空搜索'"
              @click="clearSearch"
            >
              <X :size="12" />
            </button>
          </div>
          <button type="button" class="fr-btn primary" :disabled="busy || !keyword.trim()" @click="doSearch">
            搜索
          </button>
        </div>
      </header>

      <div class="fr-cols" :class="{ 'has-side': hasSide }">
        <div class="fr-main-col">
          <section v-if="results.length || (searched && !loading)" class="fr-card">
            <div class="fr-card-head">
              <UserPlus :size="14" />
              <span>搜索结果</span>
              <span class="fr-count">{{ results.length }}</span>
              <button type="button" class="fr-head-link" @click="clearSearch">关闭</button>
            </div>
            <div v-if="results.length" class="fr-list">
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
                <button v-else type="button" class="fr-btn primary" :disabled="busy" @click="add(u)">
                  <UserPlus :size="12" />加好友
                </button>
              </div>
            </div>
            <p v-else class="fr-empty">没有找到匹配的用户，换个用户名或昵称再试试。</p>
          </section>

          <section class="fr-card">
            <div class="fr-card-head">
              <span>我的好友</span>
              <span class="fr-count">{{ friends.length }}</span>
            </div>
            <div v-if="loading" class="fr-empty">加载中…</div>
            <div v-else-if="friends.length" class="fr-list">
              <div v-for="f in friends" :key="f.id" class="fr-row">
                <div class="fr-avatar">
                  <img v-if="f.avatar" :src="f.avatar" alt="" />
                  <span v-else>{{ avatarText(f.name) }}</span>
                </div>
                <div class="fr-main">
                  <div class="fr-name">{{ f.name }}</div>
                  <div class="fr-sub">@{{ f.username }}</div>
                </div>
                <div v-if="confirming?.id === f.id" class="fr-ops is-confirm">
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
                </div>
                <div v-else class="fr-ops">
                  <button
                    type="button"
                    class="fr-act danger"
                    :disabled="busy"
                    v-tooltip="'解除好友关系'"
                    @click="ask(f.id, 'remove')"
                  >
                    解除
                  </button>
                  <button
                    type="button"
                    class="fr-act"
                    :disabled="busy"
                    v-tooltip="'拉黑后不再接收对方的申请'"
                    @click="ask(f.id, 'block')"
                  >
                    拉黑
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="fr-empty-box">
              <UserPlus :size="16" />
              <p>还没有好友。在上方搜索用户名发送申请，通过后即可在分享面板直接邀请。</p>
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

/* 行内操作：默认清晰可见，悬停时加深 */
.fr-ops {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
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
.fr-act:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.fr-act.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
  color: var(--gn-danger);
}
.fr-request-ops {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 7px;
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
