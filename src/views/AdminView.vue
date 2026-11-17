<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Search,
  ShieldCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-vue-next'
import {
  errorText,
  formatDateTime,
  getAdminUser,
  listAdminOverview,
  listAdminUsers,
  type AdminOverview,
  type AdminUserSort,
  type PersonDetail,
  type PersonStat,
} from '@/api/features'
import GnSelect from '@/components/GnSelect.vue'
import { buildCsv, buildXlsx, downloadBlob } from '@/utils/xlsx'

/* ---------------- 概览 ---------------- */

const overview = ref<AdminOverview | null>(null)
const loading = ref(true)
const err = ref('')

/* ---------------- 人员列表 ---------------- */

const people = ref<PersonStat[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const totalPages = ref(1)
const listLoading = ref(false)

const keyword = ref('')
const roleFilter = ref('')
const sort = ref<AdminUserSort>('createdAt')
const order = ref<'asc' | 'desc'>('desc')

/** 搜索防抖：输入停顿 250ms 才发请求 */
const searchTimer: { id?: ReturnType<typeof setTimeout> } = {}
watch(keyword, () => {
  if (searchTimer.id) clearTimeout(searchTimer.id)
  searchTimer.id = setTimeout(() => {
    page.value = 1
    void loadPeople()
  }, 250)
})

const roleOptions = [
  { value: '', label: '全部角色' },
  { value: 'admin', label: '管理员' },
  { value: 'user', label: '普通用户' },
]

const sortOptions: { value: AdminUserSort; label: string }[] = [
  { value: 'createdAt', label: '注册时间' },
  { value: 'lastActiveAt', label: '最后活跃' },
  { value: 'pageCount', label: '笔记数' },
  { value: 'charCount', label: '字数' },
  { value: 'friendCount', label: '好友数' },
  { value: 'assetBytes', label: '附件占用' },
  { value: 'username', label: '账号' },
]

/* ---------------- 详情抽屉 ---------------- */

const detail = ref<PersonDetail | null>(null)
const detailLoading = ref(false)
const detailOpen = ref(false)

/* ---------------- 导出 ---------------- */

const exportOpen = ref(false)
const exportFormat = ref<'xlsx' | 'csv'>('xlsx')
const exporting = ref(false)

async function loadOverview() {
  try {
    overview.value = await listAdminOverview()
  } catch (e) {
    err.value = errorText(e, '加载统计失败')
  }
}

async function loadPeople() {
  listLoading.value = true
  try {
    const r = await listAdminUsers({
      q: keyword.value.trim() || undefined,
      role: roleFilter.value || undefined,
      sort: sort.value,
      order: order.value,
      page: page.value,
      pageSize: pageSize.value,
    })
    people.value = r.items
    total.value = r.total
    totalPages.value = r.totalPages
  } catch (e) {
    err.value = errorText(e, '加载人员列表失败')
  } finally {
    listLoading.value = false
  }
}

async function refresh() {
  await Promise.all([loadOverview(), loadPeople()])
}

async function openDetail(id: string) {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await getAdminUser(id)
  } catch (e) {
    err.value = errorText(e, '加载详情失败')
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  detailOpen.value = false
  detail.value = null
}

/** 点表头排序：同列再点一次切换升降序 */
function toggleSort(key: AdminUserSort) {
  if (sort.value === key) order.value = order.value === 'desc' ? 'asc' : 'desc'
  else {
    sort.value = key
    order.value = 'desc'
  }
  page.value = 1
  void loadPeople()
}

function applyFilter() {
  page.value = 1
  void loadPeople()
}

function goPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  void loadPeople()
}

/** 分页按钮：当前页附近最多显示 5 个 */
const pageButtons = computed<number[]>(() => {
  const totalCount = totalPages.value
  const cur = page.value
  if (totalCount <= 5) return Array.from({ length: totalCount }, (_, i) => i + 1)
  const out: number[] = []
  const start = Math.max(1, Math.min(cur - 2, totalCount - 4))
  for (let i = start; i < start + 5; i++) out.push(i)
  return out
})

/* ---------------- 格式化 ---------------- */

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

function displayName(p: { nickname: string | null; username: string }): string {
  return p.nickname || p.username
}

function avatarText(name: string): string {
  return (name || '?').slice(0, 1).toUpperCase()
}

function relativeTime(ts: number | null): string {
  if (!ts) return '从未登录'
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return formatDateTime(ts)
}

/* ---------------- 导出 ---------------- */

function exportRows(): (string | number)[][] {
  const head = [
    '账号',
    '昵称',
    '角色',
    '手机号',
    '邮箱',
    '注册时间',
    '最后活跃',
    '笔记数',
    '回收站笔记',
    '正文字数',
    '数据库数',
    '表格行数',
    '附件数',
    '附件占用',
    '好友数',
    '好友分组',
    '团队空间',
    '负责节点',
    '访问令牌',
    '两步验证',
    'PIN 码',
    'GitHub',
  ]
  const body = people.value.map((p) => [
    p.username,
    p.nickname ?? '',
    p.role === 'admin' ? '管理员' : '普通用户',
    p.phone ?? '',
    p.email ?? '',
    formatDateTime(p.createdAt),
    p.lastActiveAt ? formatDateTime(p.lastActiveAt) : '从未登录',
    p.pageCount,
    p.trashedPageCount,
    p.charCount,
    p.databaseCount,
    p.databaseRowCount,
    p.assetCount,
    fmtBytes(p.assetBytes),
    p.friendCount,
    p.friendGroupCount,
    p.teamSpaceCount,
    p.leadNodeCount,
    p.tokenCount,
    p.twoFactor ? '已开启' : '未开启',
    p.hasPin ? '已设置' : '未设置',
    p.github ?? '',
  ])
  return [head, ...body]
}

async function doExport() {
  exporting.value = true
  try {
    const rows = exportRows()
    const stamp = new Date().toISOString().slice(0, 10)
    if (exportFormat.value === 'xlsx') {
      downloadBlob(new Blob([buildXlsx('人员统计', rows)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `人员统计-${stamp}.xlsx`)
    } else {
      downloadBlob(buildCsv(rows), `人员统计-${stamp}.csv`)
    }
    exportOpen.value = false
  } finally {
    exporting.value = false
  }
}

/* ---------------- 趋势图 ---------------- */

const TREND_W = 680
const TREND_H = 120

/** 把趋势序列画成折线 + 面积，返回 SVG path */
function trendPaths(series: { count: number }[]) {
  if (!series.length) return { line: '', area: '', max: 0 }
  const max = Math.max(1, ...series.map((s) => s.count))
  const step = series.length > 1 ? TREND_W / (series.length - 1) : TREND_W
  const pts = series.map((s, i) => {
    const x = i * step
    const y = TREND_H - (s.count / max) * (TREND_H - 8) - 4
    return { x, y, count: s.count }
  })
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${TREND_W},${TREND_H} L0,${TREND_H} Z`
  return { line, area, max, pts }
}

const signupTrend = computed(() => trendPaths(overview.value?.signup ?? []))
const activeTrend = computed(() => trendPaths(overview.value?.active ?? []))

/** 今日与趋势首日的对比 */
const trendDates = computed(() => {
  const s = overview.value?.signup ?? []
  const a = overview.value?.active ?? []
  return {
    signupFirst: s[0]?.date ?? '',
    signupLast: s[s.length - 1]?.date ?? '',
    activeFirst: a[0]?.date ?? '',
    activeLast: a[a.length - 1]?.date ?? '',
  }
})

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
  <section class="ad-page gn-scroll">
    <div class="ad-inner">
      <!-- 顶部 -->
      <header class="ad-head">
        <div class="ad-head-text">
          <div class="ad-title-line">
            <ShieldCheck :size="17" :stroke-width="1.9" class="ad-title-icon" />
            <h1>管理后台</h1>
            <span class="ad-badge">人员信息统计</span>
          </div>
          <p class="ad-desc">统计口径基于服务端实时查询：笔记归属个人空间，团队页面归属团队空间；好友关系双向计数。</p>
        </div>
        <div class="ad-head-actions">
          <button type="button" class="ad-btn" :disabled="loading" @click="refresh">
            <RefreshCw :size="13" :stroke-width="2" :class="{ 'ad-spin': loading }" />刷新
          </button>
          <button type="button" class="ad-btn primary" @click="exportOpen = true">
            <Download :size="13" :stroke-width="2" />导出统计表
          </button>
        </div>
      </header>

      <div v-if="err" class="ad-error">
        <span>{{ err }}</span>
        <button type="button" class="ad-icon-btn" @click="err = ''"><X :size="13" /></button>
      </div>

      <div v-if="loading" class="ad-empty">加载中…</div>

      <template v-else>
        <!-- 核心指标 -->
        <section class="ad-stats">
          <div class="ad-stat">
            <div class="ad-stat-top"><Users :size="13" :stroke-width="1.9" /><span>总人数</span></div>
            <div class="ad-stat-num">{{ fmtNum(overview?.users.total ?? 0) }}</div>
            <div class="ad-stat-sub">
              管理员 {{ overview?.users.admin ?? 0 }} · 近 7 天新增 {{ overview?.users.newWeek ?? 0 }}
            </div>
          </div>
          <div class="ad-stat">
            <div class="ad-stat-top"><Activity :size="13" :stroke-width="1.9" /><span>近 7 天活跃</span></div>
            <div class="ad-stat-num">{{ fmtNum(overview?.users.activeWeek ?? 0) }}</div>
            <div class="ad-stat-sub">近 30 天活跃 {{ overview?.users.activeMonth ?? 0 }} · 从未登录 {{ overview?.users.neverActive ?? 0 }}</div>
          </div>
          <div class="ad-stat">
            <div class="ad-stat-top"><FileSpreadsheet :size="13" :stroke-width="1.9" /><span>笔记总量</span></div>
            <div class="ad-stat-num">{{ fmtNum(overview?.content.pages ?? 0) }}</div>
            <div class="ad-stat-sub">
              公共原稿 {{ overview?.content.publicPages ?? 0 }} · 团队 {{ overview?.content.teamPages ?? 0 }} · 回收站 {{ overview?.content.trashedPages ?? 0 }}
            </div>
          </div>
          <div class="ad-stat">
            <div class="ad-stat-top"><BarChart3 :size="13" :stroke-width="1.9" /><span>正文字数</span></div>
            <div class="ad-stat-num">{{ fmtNum(overview?.content.chars ?? 0) }}</div>
            <div class="ad-stat-sub">数据库 {{ overview?.content.databases ?? 0 }} 个 · 行 {{ overview?.content.databaseRows ?? 0 }}</div>
          </div>
          <div class="ad-stat">
            <div class="ad-stat-top"><UserMinus :size="13" :stroke-width="1.9" /><span>协作规模</span></div>
            <div class="ad-stat-num">{{ fmtNum(overview?.collab.friendships ?? 0) }}</div>
            <div class="ad-stat-sub">
              好友关系 · 空间 {{ overview?.collab.spaces ?? 0 }} · 组织节点 {{ overview?.collab.orgNodes ?? 0 }}
            </div>
          </div>
          <div class="ad-stat">
            <div class="ad-stat-top"><ShieldCheck :size="13" :stroke-width="1.9" /><span>附件占用</span></div>
            <div class="ad-stat-num">{{ fmtBytes(overview?.content.assetBytes ?? 0) }}</div>
            <div class="ad-stat-sub">附件 {{ overview?.content.assets ?? 0 }} 个 · 访问令牌 {{ overview?.collab.tokens ?? 0 }}</div>
          </div>
        </section>

        <!-- 趋势 -->
        <section class="ad-trend">
          <div class="ad-trend-card">
            <div class="ad-trend-head">
              <span class="ad-trend-title">近 30 天注册</span>
              <span class="ad-trend-meta">{{ trendDates.signupFirst }} ~ {{ trendDates.signupLast }} · 峰值 {{ signupTrend.max }}</span>
            </div>
            <svg class="ad-trend-svg" :viewBox="`0 0 ${TREND_W} ${TREND_H}`" preserveAspectRatio="none">
              <path :d="signupTrend.area" class="ad-trend-area" />
              <path :d="signupTrend.line" class="ad-trend-line" />
            </svg>
          </div>
          <div class="ad-trend-card">
            <div class="ad-trend-head">
              <span class="ad-trend-title">近 30 天活跃</span>
              <span class="ad-trend-meta">{{ trendDates.activeFirst }} ~ {{ trendDates.activeLast }} · 峰值 {{ activeTrend.max }}</span>
            </div>
            <svg class="ad-trend-svg" :viewBox="`0 0 ${TREND_W} ${TREND_H}`" preserveAspectRatio="none">
              <path :d="activeTrend.area" class="ad-trend-area alt" />
              <path :d="activeTrend.line" class="ad-trend-line alt" />
            </svg>
          </div>
        </section>

        <!-- 人员列表 -->
        <section class="ad-card">
          <div class="ad-card-head">
            <span class="ad-card-title">人员明细</span>
            <span class="ad-count">{{ total }} 人</span>
            <div class="ad-filters">
              <div class="ad-search">
                <Search :size="13" :stroke-width="1.9" class="ad-search-icon" />
                <input v-model="keyword" placeholder="搜索账号 / 昵称 / 手机号 / 邮箱" />
                <button v-if="keyword" type="button" class="ad-search-clear" @click="keyword = ''">
                  <X :size="12" :stroke-width="2" />
                </button>
              </div>
              <GnSelect v-model="roleFilter" :options="roleOptions" :min-width="118" @update:model-value="applyFilter" />
              <GnSelect v-model="sort" :options="sortOptions" :min-width="118" @update:model-value="applyFilter" />
              <button type="button" class="ad-order-btn" :title="order === 'desc' ? '当前降序，点击切换升序' : '当前升序，点击切换降序'" @click="order = order === 'desc' ? 'asc' : 'desc'; applyFilter()">
                {{ order === 'desc' ? '降序' : '升序' }}
              </button>
            </div>
          </div>

          <div class="ad-table-wrap">
            <table class="ad-table">
              <thead>
                <tr>
                  <th class="ad-th ad-th-user">人员</th>
                  <th class="ad-th" @click="toggleSort('lastActiveAt')">最后活跃</th>
                  <th class="ad-th num" @click="toggleSort('pageCount')">笔记</th>
                  <th class="ad-th num" @click="toggleSort('charCount')">字数</th>
                  <th class="ad-th num" @click="toggleSort('friendCount')">好友</th>
                  <th class="ad-th num">团队</th>
                  <th class="ad-th num">负责节点</th>
                  <th class="ad-th num" @click="toggleSort('assetBytes')">附件</th>
                  <th class="ad-th">安全</th>
                  <th class="ad-th" @click="toggleSort('username')">账号</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="listLoading" class="ad-row-empty">
                  <td colspan="10">加载中…</td>
                </tr>
                <tr v-else-if="!people.length" class="ad-row-empty">
                  <td colspan="10">没有匹配的人员</td>
                </tr>
                <tr v-for="p in people" :key="p.id" class="ad-row" @click="openDetail(p.id)">
                  <td class="ad-td ad-td-user">
                    <div class="ad-user-cell">
                      <span class="ad-avatar">{{ avatarText(displayName(p)) }}</span>
                      <span class="ad-user-text">
                        <span class="ad-user-name">
                          {{ displayName(p) }}
                          <span v-if="p.role === 'admin'" class="ad-tag admin">管理员</span>
                        </span>
                        <span class="ad-user-sub">{{ p.phone || p.email || '未填写联系方式' }}</span>
                      </span>
                    </div>
                  </td>
                  <td class="ad-td">
                    <span class="ad-time" :class="{ dim: !p.lastActiveAt }">{{ relativeTime(p.lastActiveAt) }}</span>
                  </td>
                  <td class="ad-td num">{{ p.pageCount }}</td>
                  <td class="ad-td num">{{ fmtNum(p.charCount) }}</td>
                  <td class="ad-td num">{{ p.friendCount }}</td>
                  <td class="ad-td num">{{ p.teamSpaceCount }}</td>
                  <td class="ad-td num">{{ p.leadNodeCount }}</td>
                  <td class="ad-td num">{{ fmtBytes(p.assetBytes) }}</td>
                  <td class="ad-td">
                    <span class="ad-sec">
                      <span v-if="p.twoFactor" class="ad-dot on" title="已开启两步验证" />
                      <span v-if="p.hasPin" class="ad-dot on" title="已设置 PIN 码" />
                      <span v-if="!p.twoFactor && !p.hasPin" class="ad-dot-off" title="未开启两步验证，也没有设置 PIN 码">弱</span>
                    </span>
                  </td>
                  <td class="ad-td ad-td-username">{{ p.username }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="ad-pager">
            <span class="ad-pager-info">
              第 {{ page }} / {{ totalPages }} 页 · 每页
              <GnSelect
                :model-value="String(pageSize)"
                :options="[
                  { value: '20', label: '20' },
                  { value: '50', label: '50' },
                  { value: '100', label: '100' },
                ]"
                :min-width="72"
                @update:model-value="(v) => { pageSize = Number(v); page = 1; loadPeople() }"
              />
            </span>
            <div class="ad-pager-btns">
              <button type="button" class="ad-page-btn" :disabled="page <= 1" @click="goPage(page - 1)">
                <ChevronLeft :size="13" :stroke-width="2" />
              </button>
              <button
                v-for="p in pageButtons"
                :key="p"
                type="button"
                class="ad-page-btn"
                :class="{ on: p === page }"
                @click="goPage(p)"
              >
                {{ p }}
              </button>
              <button type="button" class="ad-page-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">
                <ChevronRight :size="13" :stroke-width="2" />
              </button>
            </div>
          </div>
        </section>
      </template>
    </div>

    <!-- 详情抽屉 -->
    <div v-if="detailOpen" class="ad-drawer-mask" @click.self="closeDetail">
      <aside class="ad-drawer">
        <header class="ad-drawer-head">
          <span class="ad-drawer-title">人员详情</span>
          <button type="button" class="ad-icon-btn" @click="closeDetail"><X :size="14" :stroke-width="2" /></button>
        </header>
        <div class="ad-drawer-body gn-scroll">
          <div v-if="detailLoading" class="ad-empty">加载中…</div>
          <template v-else-if="detail">
            <div class="ad-dp-head">
              <span class="ad-avatar big">{{ avatarText(detail.person.nickname || detail.person.username) }}</span>
              <div class="ad-dp-id">
                <div class="ad-dp-name">
                  {{ displayName(detail.person) }}
                  <span v-if="detail.person.role === 'admin'" class="ad-tag admin">管理员</span>
                </div>
                <div class="ad-dp-sub">@{{ detail.person.username }}</div>
              </div>
            </div>

            <dl class="ad-dp-grid">
              <div><dt>手机号</dt><dd>{{ detail.person.phone || '—' }}</dd></div>
              <div><dt>邮箱</dt><dd>{{ detail.person.email || '—' }}</dd></div>
              <div><dt>注册时间</dt><dd>{{ formatDateTime(detail.person.createdAt) }}</dd></div>
              <div><dt>最后活跃</dt><dd>{{ detail.person.lastActiveAt ? formatDateTime(detail.person.lastActiveAt) : '从未登录' }}</dd></div>
              <div><dt>登录设备</dt><dd>{{ detail.person.sessionCount }} 个</dd></div>
              <div><dt>笔记</dt><dd>{{ detail.person.pageCount }} 篇（回收站 {{ detail.person.trashedPageCount }}）</dd></div>
              <div><dt>正文字数</dt><dd>{{ fmtNum(detail.person.charCount) }}</dd></div>
              <div><dt>数据库</dt><dd>{{ detail.person.databaseCount }} 个 / {{ detail.person.databaseRowCount }} 行</dd></div>
              <div><dt>附件</dt><dd>{{ detail.person.assetCount }} 个 / {{ fmtBytes(detail.person.assetBytes) }}</dd></div>
              <div><dt>好友</dt><dd>{{ detail.person.friendCount }} 位（分组 {{ detail.person.friendGroupCount }} 个）</dd></div>
              <div><dt>团队空间</dt><dd>{{ detail.person.teamSpaceCount }} 个</dd></div>
              <div><dt>负责节点</dt><dd>{{ detail.person.leadNodeCount }} 个</dd></div>
              <div><dt>访问令牌</dt><dd>{{ detail.person.tokenCount }} 个</dd></div>
              <div>
                <dt>安全状态</dt>
                <dd>
                  <span class="ad-tag" :class="detail.person.twoFactor ? 'ok' : 'off'">两步验证{{ detail.person.twoFactor ? '已开' : '未开' }}</span>
                  <span class="ad-tag" :class="detail.person.hasPin ? 'ok' : 'off'">PIN{{ detail.person.hasPin ? '已设' : '未设' }}</span>
                  <span v-if="detail.person.github" class="ad-tag ok">GitHub 已绑</span>
                </dd>
              </div>
            </dl>

            <section class="ad-dp-sec">
              <div class="ad-dp-sec-title">所在团队</div>
              <div v-if="!detail.teams.length" class="ad-dp-empty">未加入任何团队空间</div>
              <div v-for="t in detail.teams" :key="t.id" class="ad-dp-item">
                <span class="ad-dp-item-name">{{ t.name }}</span>
                <span class="ad-tag">{{ t.role }}</span>
                <span class="ad-dp-item-meta">{{ formatDateTime(t.joinedAt) }}</span>
              </div>
            </section>

            <section class="ad-dp-sec">
              <div class="ad-dp-sec-title">好友（{{ detail.friends.length }}）</div>
              <div v-if="!detail.friends.length" class="ad-dp-empty">暂无好友</div>
              <div v-for="f in detail.friends" :key="f.id" class="ad-dp-item">
                <span class="ad-avatar sm">{{ avatarText(f.name) }}</span>
                <span class="ad-dp-item-name">{{ f.name }}</span>
                <span class="ad-dp-item-meta">@{{ f.username }}</span>
              </div>
            </section>

            <section class="ad-dp-sec">
              <div class="ad-dp-sec-title">登录设备（{{ detail.sessions.length }}）</div>
              <div v-if="!detail.sessions.length" class="ad-dp-empty">没有有效会话</div>
              <div v-for="s in detail.sessions" :key="s.id" class="ad-dp-item">
                <span class="ad-dp-item-name">{{ s.ip || '未知 IP' }}</span>
                <span class="ad-dp-item-meta">{{ formatDateTime(s.lastSeen) }}</span>
              </div>
            </section>
          </template>
        </div>
      </aside>
    </div>

    <!-- 导出格式选择 -->
    <div v-if="exportOpen" class="ad-modal-mask" @click.self="exportOpen = false">
      <div class="ad-modal">
        <div class="ad-modal-title">导出人员统计表</div>
        <p class="ad-modal-desc">导出当前页的 {{ people.length }} 条人员数据（筛选与排序生效）。</p>
        <div class="ad-modal-opts">
          <button
            type="button"
            class="ad-opt"
            :class="{ on: exportFormat === 'xlsx' }"
            @click="exportFormat = 'xlsx'"
          >
            <FileSpreadsheet :size="15" :stroke-width="1.9" />
            <span class="ad-opt-name">Excel (.xlsx)</span>
            <span class="ad-opt-meta">可直接用 Excel / WPS 打开</span>
          </button>
          <button
            type="button"
            class="ad-opt"
            :class="{ on: exportFormat === 'csv' }"
            @click="exportFormat = 'csv'"
          >
            <Download :size="15" :stroke-width="1.9" />
            <span class="ad-opt-name">CSV (.csv)</span>
            <span class="ad-opt-meta">带 BOM，Excel 打开中文不乱码</span>
          </button>
        </div>
        <footer class="ad-modal-foot">
          <button type="button" class="ad-btn" @click="exportOpen = false">取消</button>
          <button type="button" class="ad-btn primary" :disabled="exporting" @click="doExport">
            {{ exporting ? '导出中…' : '开始导出' }}
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ad-page {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}
.ad-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 30px 32px 80px;
}

/* ---------- 顶部 ---------- */
.ad-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.ad-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
.ad-title-line h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  color: var(--gn-text);
}
.ad-title-icon {
  color: var(--gn-accent);
}
.ad-badge {
  padding: 1px 7px;
  border-radius: 99px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 11.5px;
}
.ad-desc {
  margin: 0;
  max-width: 620px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--gn-text-soft);
}
.ad-head-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
}
.ad-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
  color: var(--gn-text-soft);
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ad-btn:hover:not(:disabled) {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.ad-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.ad-btn.primary {
  border-color: transparent;
  background: var(--gn-accent);
  color: #fff;
}
.ad-btn.primary:hover:not(:disabled) {
  filter: brightness(1.06);
  color: #fff;
}
.ad-spin {
  animation: ad-spin 0.9s linear infinite;
}
@keyframes ad-spin {
  to {
    transform: rotate(360deg);
  }
}
.ad-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  padding: 9px 11px;
  border: 1px solid color-mix(in srgb, var(--gn-danger) 32%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--gn-danger) 9%, transparent);
  color: var(--gn-danger);
  font-size: 12.5px;
}
.ad-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.ad-icon-btn:hover {
  background: var(--gn-bg-hover);
}
.ad-empty {
  padding: 60px 0;
  text-align: center;
  color: var(--gn-text-muted);
  font-size: 13px;
}

/* ---------- 指标卡 ---------- */
.ad-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.ad-stat {
  padding: 12px 14px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
}
.ad-stat-top {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--gn-text-muted);
  font-size: 11.5px;
}
.ad-stat-num {
  margin: 5px 0 3px;
  font-size: 21px;
  font-weight: 640;
  line-height: 1.15;
  color: var(--gn-text);
  font-variant-numeric: tabular-nums;
}
.ad-stat-sub {
  font-size: 11px;
  line-height: 1.5;
  color: var(--gn-text-muted);
}

/* ---------- 趋势 ---------- */
.ad-trend {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.ad-trend-card {
  padding: 11px 13px 8px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
}
.ad-trend-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 7px;
}
.ad-trend-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--gn-text);
}
.ad-trend-meta {
  font-size: 10.5px;
  color: var(--gn-text-muted);
  font-variant-numeric: tabular-nums;
}
.ad-trend-svg {
  display: block;
  width: 100%;
  height: 84px;
}
.ad-trend-line {
  fill: none;
  stroke: var(--gn-accent);
  stroke-width: 1.8;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.ad-trend-line.alt {
  stroke: var(--gn-text-muted);
}
.ad-trend-area {
  fill: color-mix(in srgb, var(--gn-accent) 16%, transparent);
}
.ad-trend-area.alt {
  fill: color-mix(in srgb, var(--gn-text-muted) 12%, transparent);
}

/* ---------- 列表卡 ---------- */
.ad-card {
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
  overflow: hidden;
}
.ad-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 11px 13px;
  border-bottom: 1px solid var(--gn-border);
}
.ad-card-title {
  font-size: 13px;
  font-weight: 620;
  color: var(--gn-text);
}
.ad-count {
  padding: 1px 7px;
  border-radius: 99px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 11px;
}
.ad-filters {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  flex-wrap: wrap;
}
.ad-search {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 250px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
}
.ad-search:focus-within {
  border-color: var(--gn-accent);
}
.ad-search-icon {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
}
.ad-search input {
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--gn-text);
  font-size: 12.5px;
  outline: none;
}
.ad-search-clear {
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
.ad-search-clear:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.ad-order-btn {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
  color: var(--gn-text-soft);
  font-size: 12px;
  cursor: pointer;
}
.ad-order-btn:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}

/* ---------- 表格 ---------- */
.ad-table-wrap {
  overflow-x: auto;
}
.ad-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.ad-th {
  padding: 8px 11px;
  text-align: left;
  font-weight: 560;
  font-size: 11.5px;
  color: var(--gn-text-muted);
  border-bottom: 1px solid var(--gn-border);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.ad-th:hover {
  color: var(--gn-text);
}
.ad-th.num,
.ad-td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.ad-th-user {
  min-width: 186px;
  padding-left: 14px;
}
.ad-row {
  border-bottom: 1px solid var(--gn-border);
  cursor: pointer;
  transition: background 0.12s;
}
.ad-row:last-child {
  border-bottom: none;
}
.ad-row:hover {
  background: var(--gn-bg-hover);
}
.ad-row-empty td {
  padding: 44px 0;
  text-align: center;
  color: var(--gn-text-muted);
}
.ad-td {
  padding: 7px 11px;
  color: var(--gn-text);
  white-space: nowrap;
}
.ad-td-user {
  min-width: 186px;
  padding-left: 14px;
}
/* 人员单元格：内层容器承担 flex，保持 td 的表格语义与内边距 */
.ad-user-cell {
  display: flex;
  align-items: center;
  gap: 11px;
}
.ad-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 13px;
  font-weight: 620;
}
.ad-avatar.big {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  font-size: 17px;
}
.ad-avatar.sm {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  font-size: 10px;
}
.ad-user-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ad-user-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 560;
  color: var(--gn-text);
  line-height: 1.35;
}
.ad-user-sub {
  font-size: 11px;
  color: var(--gn-text-muted);
  line-height: 1.35;
}
.ad-time.dim {
  color: var(--gn-text-muted);
}
.ad-tag {
  padding: 0 6px;
  border-radius: 5px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 10.5px;
  font-weight: 500;
}
.ad-tag.admin {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.ad-tag.ok {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.ad-tag.off {
  background: var(--gn-bg-hover);
  color: var(--gn-text-muted);
}
.ad-sec {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ad-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--gn-border-strong);
}
.ad-dot.on {
  background: var(--gn-accent);
}
.ad-dot-off {
  padding: 0 5px;
  border-radius: 5px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-muted);
  font-size: 10px;
}
.ad-td-username {
  color: var(--gn-text-soft);
  font-family: var(--gn-mono);
  font-size: 11.5px;
}

/* ---------- 分页 ---------- */
.ad-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 9px 13px;
  border-top: 1px solid var(--gn-border);
}
.ad-pager-info {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.ad-pager-btns {
  display: flex;
  align-items: center;
  gap: 3px;
}
.ad-page-btn {
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12px;
  cursor: pointer;
}
.ad-page-btn:hover:not(:disabled) {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.ad-page-btn.on {
  border-color: var(--gn-border);
  background: var(--gn-bg-hover);
  color: var(--gn-text);
  font-weight: 600;
}
.ad-page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---------- 抽屉 ---------- */
.ad-drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.28);
}
.ad-drawer {
  display: flex;
  flex-direction: column;
  width: min(440px, 92vw);
  height: 100%;
  background: var(--gn-bg);
  border-left: 1px solid var(--gn-border);
  box-shadow: var(--gn-shadow-lg);
  animation: ad-slide-in 0.2s ease;
}
@keyframes ad-slide-in {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
}
.ad-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 15px;
  border-bottom: 1px solid var(--gn-border);
}
.ad-drawer-title {
  font-size: 13.5px;
  font-weight: 620;
  color: var(--gn-text);
}
.ad-drawer-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 15px;
}
.ad-dp-head {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 14px;
}
.ad-dp-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 620;
  color: var(--gn-text);
}
.ad-dp-sub {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  font-family: var(--gn-mono);
}
.ad-dp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 9px;
  margin: 0 0 16px;
}
.ad-dp-grid > div {
  padding: 8px 10px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg-soft);
}
.ad-dp-grid dt {
  margin-bottom: 2px;
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
.ad-dp-grid dd {
  margin: 0;
  font-size: 12.5px;
  color: var(--gn-text);
}
.ad-dp-sec {
  margin-bottom: 16px;
}
.ad-dp-sec-title {
  margin-bottom: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--gn-text-muted);
}
.ad-dp-empty {
  font-size: 12px;
  color: var(--gn-text-muted);
}
.ad-dp-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 0;
  border-bottom: 1px solid var(--gn-border);
  font-size: 12.5px;
}
.ad-dp-item:last-child {
  border-bottom: none;
}
.ad-dp-item-name {
  color: var(--gn-text);
  font-weight: 500;
}
.ad-dp-item-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--gn-text-muted);
}

/* ---------- 导出弹窗 ---------- */
.ad-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.32);
}
.ad-modal {
  width: min(420px, 100%);
  padding: 16px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
}
.ad-modal-title {
  margin-bottom: 4px;
  font-size: 14.5px;
  font-weight: 640;
  color: var(--gn-text);
}
.ad-modal-desc {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--gn-text-soft);
}
.ad-modal-opts {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 14px;
}
.ad-opt {
  display: grid;
  grid-template-columns: 18px 1fr;
  align-items: center;
  gap: 4px 9px;
  padding: 9px 11px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.ad-opt:hover {
  background: var(--gn-bg-hover);
}
.ad-opt.on {
  border-color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.ad-opt > svg {
  grid-row: span 2;
  color: var(--gn-text-soft);
}
.ad-opt.on > svg {
  color: var(--gn-accent);
}
.ad-opt-name {
  font-size: 13px;
  font-weight: 560;
  color: var(--gn-text);
}
.ad-opt-meta {
  font-size: 11px;
  color: var(--gn-text-muted);
}
.ad-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
}

/* ---------- 窄屏 ---------- */
@media (max-width: 720px) {
  .ad-inner {
    padding: 20px 14px 60px;
  }
  .ad-filters {
    width: 100%;
    margin-left: 0;
  }
  .ad-search {
    width: 100%;
  }
}
</style>
