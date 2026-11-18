<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Upload, Download, Sparkles, Clock, ArrowRight, Search, CalendarDays } from 'lucide-vue-next'
import {
  store,
  recentPages,
  goToPage,
  reloadPages,
  favoritePages,
  trashedPages,
  displayName,
} from '@/store'
import { createPage } from '@/db/repo'
import PageIcon from '@/components/PageIcon.vue'
import ProfileCard from '@/components/home/ProfileCard.vue'
import ActivityCalendar from '@/components/home/ActivityCalendar.vue'
import StatCards from '@/components/home/StatCards.vue'
import QuickStart from '@/components/home/QuickStart.vue'
import ActivityHeatmap from '@/components/home/ActivityHeatmap.vue'
import { t, locale, LOCALES } from '@/i18n'
import type { Page } from '@/types'
import { userState } from '@/userState'
import { QUICK_TEMPLATES, todayStamp } from '@/home/templates'
import { importFiles, exportBackup } from '@/home/backup'
import {
  activeDayCount,
  collectDayStats,
  countCreatedLastMonth,
  countCreatedLastWeek,
  countCreatedThisMonth,
  countCreatedThisWeek,
  dayKey,
  longestStreak,
  monthPeak,
  recentDailyCreated,
  recentMonthlyCreated,
  startOfDay,
} from '@/home/metrics'

const importInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const heatYear = ref(new Date().getFullYear())
const selectedDay = ref<number | null>(null)
/** 底部「最近编辑 / 当天笔记」共用一个卡，用 tab 切换，不再单独占右栏高度 */
const recentTab = ref<'recent' | 'day'>('recent')

/** 当前空间里的页面（不含回收站） */
const livePages = computed(() => store.pages.filter((p) => !p.trashed))
const stats = computed(() => collectDayStats(store.pages))

/* ---------------- 左栏：个人卡片 ---------------- */

/** 近 30 天每日活跃次数（柱状图） */
const activity = computed(() => {
  const today = startOfDay(Date.now())
  const out: { key: string; count: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const ts = today - i * 86400000
    out.push({ key: dayKey(ts), count: stats.value.get(dayKey(ts))?.active ?? 0 })
  }
  return out
})

const monthActive = computed(() => {
  const prefix = dayKey(Date.now()).slice(0, 7)
  let days = 0
  let count = 0
  for (const [key, s] of stats.value) {
    if (!key.startsWith(prefix)) continue
    if (s.active > 0) days++
    count += s.active
  }
  return { days, count }
})

/** 左栏概览：笔记数 / 收藏数 / 正文字数 */
const overview = computed(() => ({
  pages: livePages.value.length,
  favorite: favoritePages.value.length,
  words: livePages.value.reduce((n, p) => n + p.excerpt.length, 0),
}))

/** 左栏年度指标：活跃天数 / 最长连续 / 月峰值（跟随热力图选中的年份） */
const yearStat = computed(() => ({
  activeDays: activeDayCount(stats.value, heatYear.value),
  streak: longestStreak(stats.value, heatYear.value),
  peak: monthPeak(stats.value, heatYear.value),
}))

/* ---------------- 中栏：统计 ---------------- */

const weekStat = computed(() => ({
  current: countCreatedThisWeek(livePages.value),
  previous: countCreatedLastWeek(livePages.value),
  points: recentDailyCreated(livePages.value, 7),
}))

const monthStat = computed(() => ({
  current: countCreatedThisMonth(livePages.value),
  previous: countCreatedLastMonth(livePages.value),
  points: recentMonthlyCreated(livePages.value, 12),
}))

const inboxStat = computed(() => ({
  unread: userState.unread,
  total: userState.notifications.length,
}))

const ideaStat = computed(() => ({
  total: favoritePages.value.length,
  pages: livePages.value.length,
}))

const draftStat = computed(() => ({
  total: trashedPages.value.length,
  pages: livePages.value.length,
}))

/* ---------------- 快捷模板 ---------------- */

/** 新建一篇空白笔记 */
async function createBlank() {
  const page = await createPage({ icon: '📝' })
  await reloadPages()
  goToPage(page.id)
}

/**
 * 今天已经由快捷模板生成的页面，按模板 id 索引。
 *
 * 判定条件是「标题匹配 + 今天创建」，不能用「正文与模板一致」——
 * 用户往往已经在模板里写了内容，正文早就变了；也不能只看标题，
 * 否则手动创建的同名笔记会被误认成模板生成，隔天也可能误判。
 * 标题同时比对三种语言，切换界面语言后仍认得出昨天/今天那篇。
 */
const todayTemplatePages = computed(() => {
  const out = new Map<string, Page>()
  const stamp = todayStamp(locale.value)
  const today = dayKey(Date.now())
  const todayCreated = store.pages.filter(
    (p) => !p.trashed && dayKey(p.createdAt) === today,
  )
  for (const tpl of QUICK_TEMPLATES) {
    const titles = new Set(LOCALES.map((l) => tpl.title[l.code](stamp)))
    const hit = todayCreated
      .filter((p) => titles.has(p.title.trim()))
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    if (hit) out.set(tpl.id, hit)
  }
  return out
})

async function createFromTemplate(id: string) {
  const tpl = QUICK_TEMPLATES.find((x) => x.id === id)
  if (!tpl) return
  // 同一模板一天只生成一篇：已存在就直接打开，不再造一篇重复的
  const existing = todayTemplatePages.value.get(id)
  if (existing) {
    goToPage(existing.id)
    return
  }
  const stamp = todayStamp(locale.value)
  const page = await createPage({
    title: tpl.title[locale.value](stamp),
    content: tpl.body[locale.value],
    icon: '📝',
  })
  await reloadPages()
  goToPage(page.id)
}

/* ---------------- 导入 / 备份 ---------------- */

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files?.length) return
  busy.value = true
  try {
    await importFiles(Array.from(files))
  } finally {
    input.value = ''
    busy.value = false
  }
}

/* ---------------- 选中某天：列出当天笔记 ---------------- */

const dayPages = computed(() => {
  if (selectedDay.value == null) return []
  const key = dayKey(selectedDay.value)
  return store.pages
    .filter((p) => dayKey(p.updatedAt) === key)
    .sort((a, b) => b.updatedAt - a.updatedAt)
})

/**
 * 点日历某天：有笔记就自动切到「当天笔记」tab；
 * 没笔记就留在「最近编辑」（沿用之前「无笔记不展示板块」的行为）。
 */
function onPickDay(ts: number) {
  selectedDay.value = ts
  if (dayPages.value.length) recentTab.value = 'day'
  else if (recentTab.value === 'day') recentTab.value = 'recent'
}

/** 数据变化后当天不再有笔记时，自动退回「最近编辑」 */
watch(dayPages, (pages) => {
  if (recentTab.value === 'day' && !pages.length) recentTab.value = 'recent'
})

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('time.justNow')
  if (m < 60) return t('time.minutesAgo', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('time.hoursAgo', { n: h })
  const d = Math.floor(h / 24)
  if (d < 30) return t('time.daysAgo', { n: d })
  const date = new Date(ts)
  return t('time.monthDay', { m: date.getMonth() + 1, d: date.getDate() })
}
</script>

<template>
  <div class="home">
    <div class="home-scroll gn-scroll">
      <div class="home-inner">
        <!-- 顶部标题栏 -->
        <header class="dh-head">
          <div class="dh-head-text">
            <h1>
              {{ store.space === 'public' ? t('home.publicTitle') : t('home.dashboardTitle') }}
            </h1>
            <p v-if="store.space === 'public'">
              {{ t('home.publicSubtitle', { n: livePages.length }) }}
            </p>
            <p v-else>
              {{ t('home.subtitle', { name: displayName || '', n: livePages.length }) }}
            </p>
          </div>
          <div class="dh-head-actions">
            <button class="gn-btn gn-btn-primary" @click="createBlank">
              <Plus :size="15" :stroke-width="2.2" />{{ t('home.newNote') }}
            </button>
            <button class="gn-btn" @click="importInput?.click()">
              <Upload :size="14" :stroke-width="1.8" />{{ t('home.import') }}
            </button>
            <button class="gn-btn" @click="exportBackup">
              <Download :size="14" :stroke-width="1.8" />{{ t('home.backup') }}
            </button>
          </div>
        </header>

        <!-- 仪表盘三栏 -->
        <div class="dh-grid">
          <div class="dh-col dh-col-left">
            <ProfileCard
              :activity="activity"
              :active-days="monthActive.days"
              :active-count="monthActive.count"
              :overview="overview"
              :year-active-days="yearStat.activeDays"
              :year-streak="yearStat.streak"
              :year-peak="yearStat.peak"
              :year="heatYear"
            />
          </div>

          <div class="dh-col dh-col-mid">
            <ActivityCalendar :stats="stats" @pick="onPickDay" />
            <StatCards
              :week="weekStat"
              :month="monthStat"
              :inbox="inboxStat"
              :idea="ideaStat"
              :draft="draftStat"
            />
          </div>

          <div class="dh-col dh-col-right">
            <QuickStart
              :create="createFromTemplate"
              :existing="[...todayTemplatePages.keys()]"
            />
            <ActivityHeatmap :stats="stats" v-model:year="heatYear" />
          </div>

          <!-- 底部整行：最近编辑 / 当天笔记 共用一个卡，tab 切换。
               之前「当天笔记」单独挂在右栏底部，挤掉了热力图一大截高度；
               挪到这里后右栏只剩 Hero + 热力图，热力图能完整铺开。 -->
          <section class="dh-recent">
            <header class="dh-recent-head">
              <div class="dh-tabs" role="tablist">
                <button
                  class="dh-tab"
                  :class="{ on: recentTab === 'recent' }"
                  role="tab"
                  :aria-selected="recentTab === 'recent'"
                  @click="recentTab = 'recent'"
                >
                  <Clock :size="13" :stroke-width="2" />
                  <span>{{ t('home.recent') }}</span>
                </button>
                <button
                  v-if="selectedDay != null && dayPages.length"
                  class="dh-tab"
                  :class="{ on: recentTab === 'day' }"
                  role="tab"
                  :aria-selected="recentTab === 'day'"
                  @click="recentTab = 'day'"
                >
                  <CalendarDays :size="13" :stroke-width="2" />
                  <span>{{ dayKey(selectedDay) }}</span>
                  <span class="dh-tab-count">{{ dayPages.length }}</span>
                </button>
              </div>
              <button class="dh-recent-more" @click="store.searchOpen = true">
                <Search :size="12" :stroke-width="2" />{{ t('home.findMore') }}
              </button>
            </header>

            <div v-show="recentTab === 'recent'">
              <div v-if="recentPages.length" class="dh-recent-grid">
                <button
                  v-for="p in recentPages"
                  :key="p.id"
                  class="dh-recent-card"
                  @click="goToPage(p.id)"
                >
                  <span class="dh-recent-icon"><PageIcon :icon="p.icon" :size="16" /></span>
                  <span class="dh-recent-title">{{ p.title || t('app.untitled') }}</span>
                  <span class="dh-recent-time">{{ timeAgo(p.updatedAt) }}</span>
                </button>
              </div>
              <div v-else class="dh-empty">
                <Sparkles :size="20" :stroke-width="1.5" />
                <p>{{ t('home.empty') }}</p>
                <button class="gn-btn gn-btn-primary" @click="createBlank">
                  <Plus :size="15" :stroke-width="2.2" />{{ t('home.newNote') }}
                </button>
              </div>
            </div>

            <!-- 选中日期当天写下的笔记 -->
            <div v-show="recentTab === 'day'" class="dh-day">
              <div class="dh-day-list">
                <button
                  v-for="p in dayPages"
                  :key="p.id"
                  class="dh-day-item"
                  @click="goToPage(p.id)"
                >
                  <span class="dh-day-icon"><PageIcon :icon="p.icon" :size="14" /></span>
                  <span class="dh-day-title">{{ p.title || t('app.untitled') }}</span>
                  <span class="dh-day-time">{{ timeAgo(p.updatedAt) }}</span>
                  <ArrowRight :size="12" class="dh-day-arrow" />
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <input
      ref="importInput"
      type="file"
      accept=".md,.markdown,.txt,.json"
      multiple
      class="hidden"
      @change="onImport"
    />
    <div v-if="busy" class="home-busy">{{ t('home.importing') }}</div>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--gn-bg);
  position: relative;
}
.home-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
}
.home-inner {
  /* 撑满整个主页空间：只保留一个很宽松的上限，避免超宽屏上过于松散 */
  width: 100%;
  max-width: 2600px;
  margin: 0 auto;
  /* 顶部只留一点呼吸感：标题往上贴，别在页头留一条空白带 */
  padding: 12px 28px 22px;
  /* 竖向也铺满：内容不足一屏时把仪表盘撑到满高，页面就不会出现滚动条 */
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.dh-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.dh-head h1 {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 680;
  letter-spacing: -0.025em;
  color: var(--gn-text);
}
.dh-head p {
  margin: 0;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
.dh-head-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.dh-grid {
  display: grid;
  /* 左栏个人卡固定（上限 262px：个人卡内容较多，再窄头像下的简介和图标行就挤了），
     中栏日历按内容，右栏吃掉剩余空间 */
  grid-template-columns: minmax(228px, 262px) minmax(290px, 340px) minmax(420px, 1fr);
  /* 第 1 行吃掉剩余高度（各栏等高铺满），第 2 行是最近编辑（自适应） */
  grid-template-rows: minmax(min-content, 1fr) auto;
  gap: 14px;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
}
.dh-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
.dh-col-left {
  position: static;
}
/* 当天笔记列表：现在嵌在底部卡里，不再是一张独立卡 */
.dh-day {
  /* 与「最近编辑」卡片等高：切换 tab 时底部行高度不变，上方热力图不会被挤 */
  height: 76px;
}
.dh-day-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 4px 12px;
  height: 100%;
  overflow-y: auto;
  scrollbar-width: thin;
}
.dh-day-list::-webkit-scrollbar {
  height: 5px;
  width: 5px;
}
.dh-day-list::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--gn-border);
}
.dh-day-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.dh-day-item:hover {
  background: var(--gn-bg-hover);
}
.dh-day-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  font-size: 12px;
}
.dh-day-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  color: var(--gn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dh-day-time {
  font-size: 10.5px;
  color: var(--gn-text-muted);
  flex: 0 0 auto;
}
.dh-day-arrow {
  color: var(--gn-text-muted);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.dh-day-item:hover .dh-day-arrow {
  opacity: 1;
}
.dh-day-empty {
  margin: 0;
  font-size: 12px;
  color: var(--gn-text-muted);
}
.dh-recent {
  /* 最近编辑独占整行，铺满整个主页宽度 */
  grid-column: 1 / -1;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px 14px 10px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
}
.dh-recent-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--gn-text-muted);
}
/* tab 切换：只在有选中日期且有笔记时出现「当天笔记」页签 */
.dh-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.dh-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.dh-tab:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.dh-tab.on {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.dh-tab-count {
  font-size: 10.5px;
  font-weight: 500;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
/* 「最近编辑」和「当天笔记」两个面板同高，切换时不会让底部行跳动 */
.dh-recent > div:not(.dh-recent-head) {
  height: 76px;
}
.dh-recent-more {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: none;
  border-radius: 6px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 11px;
  cursor: pointer;
}
.dh-recent-more:hover {
  color: var(--gn-text);
}
.dh-recent-grid {
  display: grid;
  /* 单行横向排布：条目变多时横向滚动，而不是换行把整页撑高、逼出滚动条。
     auto-flow: column + auto-columns 的 1fr 会在条目放得下时平分宽度，放不下时按最小宽滚动。 */
  grid-auto-flow: column;
  grid-auto-columns: minmax(150px, 1fr);
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: thin;
}
.dh-recent-grid::-webkit-scrollbar {
  height: 6px;
}
.dh-recent-grid::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--gn-border);
}
.dh-recent-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s ease, transform 0.14s ease;
}
.dh-recent-card:hover {
  border-color: var(--gn-border-strong);
  transform: translateY(-1px);
}
.dh-recent-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  font-size: 13px;
  color: var(--gn-text-muted);
}
.dh-recent-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--gn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dh-recent-time {
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
.dh-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 22px 0;
  color: var(--gn-text-muted);
}
.dh-empty p {
  margin: 0;
  font-size: 12.5px;
}
.home-busy {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 7px 14px;
  border-radius: 8px;
  background: var(--gn-text);
  color: var(--gn-bg);
  font-size: 12.5px;
}

@media (max-width: 1180px) {
  .dh-grid {
    grid-template-columns: 262px minmax(0, 1fr);
    /* 两栏 + 右栏整行 + 最近编辑，共三行 */
    grid-template-rows: minmax(min-content, 1fr) auto auto;
  }
  .dh-col-right {
    grid-column: 1 / -1;
  }
}
@media (max-width: 768px) {
  .home-inner {
    padding: 22px 14px 32px;
  }
  .dh-head h1 {
    font-size: 21px;
  }
  .dh-grid {
    grid-template-columns: minmax(0, 1fr);
    /* 单栏：内容按自然高度堆叠，页面可滚动 */
    grid-template-rows: auto auto;
    flex: 0 0 auto;
  }
  .dh-col-left {
    position: sticky;
    top: 0;
    align-self: start;
    z-index: 2;
  }
  .dh-head-actions {
    flex-wrap: wrap;
  }
}
</style>
