<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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

/** 趋势图画布高度（px）。宽度按容器实际像素宽动态计算。 */
const TREND_H = 84
/**
 * viewBox 与像素 1:1 映射（宽=容器像素宽，高=TREND_H）。
 * 之前用固定的 680×120 + preserveAspectRatio="none"，非等比拉伸会把
 * 峰值圆点压成椭圆、虚线间距错乱；1:1 之后圆是圆的、描边也是等宽的。
 */
const trendWidth = ref(680)

/**
 * Catmull-Rom 转三次贝塞尔：把折线拐点替换成切线连续的曲线，
 * 让趋势线呈现自然的波动而不是生硬折角。
 * 端点处做镜像延拓，避免首尾段被拉直。
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  const p = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = p(i - 1)
    const p1 = p(i)
    const p2 = p(i + 1)
    const p3 = p(i + 2)
    // 张力系数：过大会让曲线在峰值处鼓包，过小则接近原折线
    const k = 0.18
    const c1x = p1.x + ((p2.x - p0.x) / 6) * k * 3
    const c1y = p1.y + ((p2.y - p0.y) / 6) * k * 3
    const c2x = p2.x - ((p3.x - p1.x) / 6) * k * 3
    const c2y = p2.y - ((p3.y - p1.y) / 6) * k * 3
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

/** 把趋势序列画成平滑曲线 + 面积，返回 SVG path */
function trendPaths(series: { count: number }[], width: number) {
  if (!series.length) return { line: '', area: '', max: 0, pts: [] as { x: number; y: number }[] }
  const max = Math.max(1, ...series.map((s) => s.count))
  const step = series.length > 1 ? width / (series.length - 1) : width
  const pts = series.map((s, i) => {
    const x = i * step
    const y = TREND_H - (s.count / max) * (TREND_H - 8) - 4
    return { x, y, count: s.count }
  })
  const line = smoothPath(pts)
  // 面积沿用同一条平滑曲线的起点/终点，闭合到基线
  const area = `${line} L${width},${TREND_H} L0,${TREND_H} Z`
  return { line, area, max, pts }
}

const signupTrend = computed(() => trendPaths(overview.value?.signup ?? [], trendWidth.value))
const activeTrend = computed(() => trendPaths(overview.value?.active ?? [], trendWidth.value))

/** 量出图表容器实际像素宽，让 viewBox 与像素 1:1 对齐 */
const trendSvgRef = ref<SVGSVGElement | null>(null)
let trendResizeObserver: ResizeObserver | null = null

/**
 * SVG 在 loading 结束前不会渲染（外层是 v-if），
 * 所以 onMounted 时 ref 还是 null，必须等 ref 真正拿到元素后再挂 ResizeObserver。
 */
watch(trendSvgRef, (el) => {
  trendResizeObserver?.disconnect()
  trendResizeObserver = null
  if (!el || typeof ResizeObserver === 'undefined') return
  const sync = () => {
    const w = Math.round(el.clientWidth)
    if (w > 0 && w !== trendWidth.value) trendWidth.value = w
  }
  sync()
  trendResizeObserver = new ResizeObserver(sync)
  trendResizeObserver.observe(el)
})

onUnmounted(() => {
  trendResizeObserver?.disconnect()
  trendResizeObserver = null
})

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
            <svg
              ref="trendSvgRef"
              class="ad-trend-svg"
              :viewBox="`0 0 ${trendWidth} ${TREND_H}`"
              preserveAspectRatio="none"
            >
              <path :d="signupTrend.area" class="ad-trend-area" />
              <path :d="signupTrend.line" class="ad-trend-line" />
              <!-- 流光层：同一条路径用虚线沿路径循环推进，制造"波动的动态效果"。
                   pathLength="1" 把路径长度归一化成 1，dash 比例就精确对应路径本身，
                   不受视口对角线（SVG 规范里百分比基准是它）干扰。 -->
              <path :d="signupTrend.line" class="ad-trend-flow" pathLength="1" />
              <circle
                v-if="signupTrend.pts.length"
                :cx="signupTrend.pts[signupTrend.pts.length - 1]!.x"
                :cy="signupTrend.pts[signupTrend.pts.length - 1]!.y"
                r="3"
                class="ad-trend-peak"
              />
            </svg>
          </div>
          <div class="ad-trend-card">
            <div class="ad-trend-head">
              <span class="ad-trend-title">近 30 天活跃</span>
              <span class="ad-trend-meta">{{ trendDates.activeFirst }} ~ {{ trendDates.activeLast }} · 峰值 {{ activeTrend.max }}</span>
            </div>
            <svg class="ad-trend-svg" :viewBox="`0 0 ${trendWidth} ${TREND_H}`" preserveAspectRatio="none">
              <path :d="activeTrend.area" class="ad-trend-area alt" />
              <path :d="activeTrend.line" class="ad-trend-line alt" />
              <path :d="activeTrend.line" class="ad-trend-flow alt" pathLength="1" />
              <circle
                v-if="activeTrend.pts.length"
                :cx="activeTrend.pts[activeTrend.pts.length - 1]!.x"
                :cy="activeTrend.pts[activeTrend.pts.length - 1]!.y"
                r="3"
                class="ad-trend-peak alt"
              />
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
                      <span class="ad-avatar">
                        <img v-if="p.avatar" :src="p.avatar" alt="" />
                        <template v-else>{{ avatarText(displayName(p)) }}</template>
                      </span>
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
              <span class="ad-avatar big">
                <img v-if="detail.person.avatar" :src="detail.person.avatar" alt="" />
                <template v-else>{{ avatarText(detail.person.nickname || detail.person.username) }}</template>
              </span>
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
                <span class="ad-avatar sm">
                  <img v-if="f.avatar" :src="f.avatar" alt="" />
                  <template v-else>{{ avatarText(f.name) }}</template>
                </span>
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
  color: var(--gn-accent-ink);
}
/* 注意：.ad-btn:hover:not(:disabled) 的特异性高于 .ad-btn.primary，
   hover 时会把主色按钮的底色换成 --gn-bg-hover 而文字仍是主色 ink（可能撞底看不见），
   所以这里必须显式重设 background。 */
.ad-btn.primary:hover:not(:disabled) {
  background: var(--gn-accent);
  color: var(--gn-accent-ink);
  filter: brightness(1.06);
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
/* 流光层：沿路径循环推进的亮线，叠在主线上形成"波动的动态效果"。
   pathLength="1" 把路径长度归一化，dash 值就是路径本身的占比：
   0.16 = 前 16% 路径画亮线，0.84 = 空 84% 路径，两者合计正好一个完整周期。
   亮线用近白色而不是主色本身——同色叠加在深色背景上几乎看不出差别。 */
.ad-trend-flow {
  fill: none;
  stroke: color-mix(in srgb, var(--gn-accent) 20%, #ffffff);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 0.16 0.84;
  stroke-dashoffset: 0;
  opacity: 0.95;
  vector-effect: non-scaling-stroke;
  animation: ad-trend-flow 4.2s linear infinite;
  pointer-events: none;
}
.ad-trend-flow.alt {
  stroke: color-mix(in srgb, var(--gn-text-muted) 20%, #ffffff);
  animation-duration: 5.4s;
}
@keyframes ad-trend-flow {
  from {
    /* offset 越负，亮段越靠路径末端；从 -1 递到 -0.05 才是"起点 → 终点"正向流动 */
    stroke-dashoffset: -1;
  }
  to {
    stroke-dashoffset: -0.05;
  }
}
/* 末端峰值点：呼吸脉动，提示"最新一天" */
.ad-trend-peak {
  fill: var(--gn-accent);
  stroke: var(--gn-bg);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
  animation: ad-trend-peak 2.4s ease-in-out infinite;
}
.ad-trend-peak.alt {
  fill: var(--gn-text-muted);
}
@keyframes ad-trend-peak {
  0%,
  100% {
    opacity: 1;
    r: 3;
  }
  50% {
    opacity: 0.55;
    r: 4.2;
  }
}
/* 用户在系统里关掉了动效：静态呈现，不再有流光与脉动 */
@media (prefers-reduced-motion: reduce) {
  .ad-trend-flow,
  .ad-trend-peak {
    animation: none;
  }
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
  overflow: hidden;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 13px;
  font-weight: 620;
}
.ad-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ad-avatar.big {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  font-size: 17px;
}
.ad-avatar.sm {
  width: 20px;
  height: 20px;
  border-radius: 6px;
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
