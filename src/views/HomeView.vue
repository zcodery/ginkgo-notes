<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Upload, Download, Sparkles, Clock, ArrowRight, Search } from 'lucide-vue-next'
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
import { t } from '@/i18n'
import { locale } from '@/i18n'
import { userState } from '@/userState'
import { QUICK_TEMPLATES, todayStamp } from '@/home/templates'
import { importFiles, exportBackup } from '@/home/backup'
import {
  collectDayStats,
  countCreatedLastMonth,
  countCreatedLastWeek,
  countCreatedThisMonth,
  countCreatedThisWeek,
  dayKey,
  recentDailyCreated,
  recentMonthlyCreated,
  startOfDay,
} from '@/home/metrics'

const importInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const heatYear = ref(new Date().getFullYear())
const selectedDay = ref<number | null>(null)

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

async function createFromTemplate(id: string) {
  const tpl = QUICK_TEMPLATES.find((x) => x.id === id)
  if (!tpl) return
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
            />
          </div>

          <div class="dh-col dh-col-mid">
            <ActivityCalendar :stats="stats" @pick="selectedDay = $event" />
            <StatCards
              :week="weekStat"
              :month="monthStat"
              :inbox="inboxStat"
              :idea="ideaStat"
              :draft="draftStat"
            />
          </div>

          <div class="dh-col dh-col-right">
            <QuickStart :create="createFromTemplate" />
            <ActivityHeatmap :stats="stats" v-model:year="heatYear" />

            <!-- 选中日期当天写下的笔记 -->
            <section v-if="selectedDay != null" class="dh-day">
              <header class="dh-day-head">
                <Clock :size="13" :stroke-width="2" />
                <span>{{ dayKey(selectedDay) }}</span>
                <span class="dh-day-count">{{ dayPages.length }}</span>
              </header>
              <div v-if="dayPages.length" class="dh-day-list">
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
              <p v-else class="dh-day-empty">{{ t('home.dayEmpty') }}</p>
            </section>
          </div>

          <!-- 最近编辑：独占整行，铺满整个主页宽度 -->
          <section class="dh-recent">
            <header class="dh-recent-head">
              <Clock :size="13" :stroke-width="2" />
              <span>{{ t('home.recent') }}</span>
              <button class="dh-recent-more" @click="store.searchOpen = true">
                <Search :size="12" :stroke-width="2" />{{ t('home.findMore') }}
              </button>
            </header>
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
  padding: 26px 28px 40px;
}
.dh-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 18px;
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
  /* 左栏个人卡固定，中栏日历按内容，右栏吃掉剩余空间 */
  grid-template-columns: minmax(228px, 240px) minmax(290px, 340px) minmax(420px, 1fr);
  gap: 14px;
  align-items: start;
}
.dh-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.dh-col-left {
  position: sticky;
  top: 0;
}
.dh-day {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 13px 14px 12px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
}
.dh-day-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--gn-text-muted);
}
.dh-day-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: var(--gn-text-muted);
}
.dh-day-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 13px 14px 12px;
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
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 8px;
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
    grid-template-columns: 232px minmax(0, 1fr);
  }
  .dh-col-right {
    grid-column: 1 / -1;
  }
  .dh-col-left {
    position: static;
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
  }
  .dh-head-actions {
    flex-wrap: wrap;
  }
}
</style>
