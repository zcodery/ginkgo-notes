<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Plus,
  Upload,
  Clock,
  ArrowRight,
  Download,
  Sparkles,
} from 'lucide-vue-next'
import { store, recentPages, goToPage, reloadPages } from '@/store'
import { createPage, listPages } from '@/db/repo'
import { exportDatabaseData, importDatabaseData } from '@/db/databases'
import PageIcon from '@/components/PageIcon.vue'
import { t } from '@/i18n'

const importInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)

const totalPages = computed(() => store.pages.filter((p) => !p.trashed).length)
const totalWords = computed(() =>
  store.pages
    .filter((p) => !p.trashed)
    .reduce((n, p) => n + p.excerpt.length, 0),
)

async function newPage() {
  const page = await createPage({ parentId: null })
  await reloadPages()
  goToPage(page.id)
}

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

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files?.length) return
  busy.value = true
  for (const file of Array.from(files)) {
    if (file.name.endsWith('.json')) {
      try {
        const data = JSON.parse(await file.text())
        if (Array.isArray(data.databases) && data.databases.length) {
          await importDatabaseData(data.databases, Array.isArray(data.dbRows) ? data.dbRows : [])
        }
        if (Array.isArray(data.pages)) {
          for (const p of data.pages) {
            await createPage({
              title: p.title ?? '',
              icon: p.icon ?? '',
              content: p.content ?? '',
              parentId: null,
            })
          }
        }
      } catch {
        /* ignore */
      }
      continue
    }
    const text = await file.text()
    const name = file.name.replace(/\.(md|markdown|txt)$/i, '')
    let title = name
    let content = text
    // 以 H1 开头的 Markdown 文件，把这个 H1 收作页面标题，避免和页面标题重复
    const m = /^#\s+(.+?)\s*\n+/.exec(text)
    if (m) {
      title = m[1].replace(/[*_`~]/g, '').trim() || name
      content = text.slice(m[0].length)
    }
    await createPage({ title, content })
  }
  input.value = ''
  await reloadPages()
  busy.value = false
}

async function exportAll() {
  const pages = await listPages()
  const dbData = await exportDatabaseData()
  const payload = {
    app: 'ginkgo-notes',
    version: 2,
    exportedAt: new Date().toISOString(),
    pages: pages.filter((p) => !p.trashed),
    databases: dbData.databases,
    dbRows: dbData.rows,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ginkgo-notes-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="home">
    <div class="home-scroll gn-scroll">
      <div class="home-inner">
        <div class="home-hero">
          <div class="home-hero-text">
            <h1>{{ store.space === 'public' ? t('home.publicTitle') : t('home.title') }}</h1>
            <p v-if="store.space === 'public'">
              {{ t('home.publicSubtitle', { n: totalPages }) }}
            </p>
            <p v-else>
              {{ t('home.subtitle', { name: store.user?.nickname || store.user?.username || '', n: totalPages }) }}
            </p>
          </div>
          <div class="home-hero-actions">
            <button class="gn-btn gn-btn-primary" @click="newPage">
              <Plus :size="15" :stroke-width="2.2" />{{ t('home.newNote') }}
            </button>
            <button class="gn-btn" @click="importInput?.click()">
              <Upload :size="14" :stroke-width="1.8" />{{ t('home.import') }}
            </button>
            <button class="gn-btn" @click="exportAll">
              <Download :size="14" :stroke-width="1.8" />{{ t('home.backup') }}
            </button>
          </div>
        </div>

        <div class="home-stats">
          <div class="stat">
            <span class="stat-num">{{ totalPages }}</span>
            <span class="stat-label">{{ t('home.statPages') }}</span>
          </div>
          <div class="stat">
            <span class="stat-num">{{ totalWords.toLocaleString() }}</span>
            <span class="stat-label">{{ t('home.statWords') }}</span>
          </div>
          <div class="stat">
            <span class="stat-num">{{ store.pages.filter((p) => p.favorite).length }}</span>
            <span class="stat-label">{{ t('home.statFav') }}</span>
          </div>
        </div>

        <div class="home-section-head">
          <Clock :size="13" :stroke-width="2" />
          <span>{{ t('home.recent') }}</span>
        </div>

        <div v-if="recentPages.length" class="home-grid">
          <button
            v-for="p in recentPages"
            :key="p.id"
            class="card"
            @click="goToPage(p.id)"
          >
            <div class="card-top">
              <span class="card-icon">
                <PageIcon :icon="p.icon" :size="18" />
              </span>
              <ArrowRight :size="13" class="card-arrow" />
            </div>
            <div class="card-title">{{ p.title || t('app.untitled') }}</div>
            <div class="card-excerpt">{{ p.excerpt || t('home.excerptEmpty') }}</div>
            <div class="card-foot">{{ timeAgo(p.updatedAt) }}</div>
          </button>
        </div>

        <div v-else class="home-empty">
          <div class="home-empty-icon"><Sparkles :size="22" :stroke-width="1.5" /></div>
          <p>{{ t('home.empty') }}</p>
          <button class="gn-btn gn-btn-primary" @click="newPage">
            <Plus :size="15" :stroke-width="2.2" />{{ t('home.newNote') }}
          </button>
        </div>

        <div class="home-tip">{{ t('home.tip') }}</div>
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
  max-width: 900px;
  margin: 0 auto;
  padding: 48px 40px 60px;
}
.home-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.home-hero h1 {
  font-size: 27px;
  font-weight: 680;
  letter-spacing: -0.025em;
  margin: 0 0 6px;
}
.home-hero p {
  margin: 0;
  font-size: 13.5px;
  color: var(--gn-text-muted);
}
.home-hero p strong {
  color: var(--gn-text-soft);
  font-weight: 600;
}
.home-hero-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.home-stats {
  display: flex;
  gap: 8px;
  margin: 26px 0 30px;
}
.stat {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg-sidebar);
}
.stat-num {
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--gn-text);
}
.stat-label {
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.home-section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--gn-text-muted);
  margin-bottom: 10px;
}
.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 13px 14px 12px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s ease, box-shadow 0.14s ease, transform 0.14s ease;
  min-height: 132px;
}
.card:hover {
  border-color: var(--gn-border-strong);
  box-shadow: var(--gn-shadow-sm);
  transform: translateY(-1px);
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--gn-border);
  font-size: 14px;
  color: var(--gn-text-muted);
}
.card-arrow {
  color: var(--gn-border-strong);
  opacity: 0;
  transition: opacity 0.14s ease;
}
.card:hover .card-arrow {
  opacity: 1;
  color: var(--gn-text-muted);
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--gn-text);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-excerpt {
  font-size: 12.2px;
  line-height: 1.55;
  color: var(--gn-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1 1 auto;
}
.card-foot {
  font-size: 11px;
  color: var(--gn-text-muted);
  opacity: 0.8;
}
.home-empty {
  padding: 48px 0;
  text-align: center;
  color: var(--gn-text-muted);
}
.home-empty-icon {
  display: flex;
  justify-content: center;
  margin-bottom: 10px;
  opacity: 0.6;
}
.home-empty p {
  margin: 0 0 14px;
  font-size: 13.5px;
}
.home-tip {
  margin-top: 34px;
  padding-top: 16px;
  border-top: 1px solid var(--gn-border);
  font-size: 12px;
  color: var(--gn-text-muted);
  line-height: 1.8;
}
.home-tip kbd {
  font-family: var(--gn-font);
  border: 1px solid var(--gn-border-strong);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11px;
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
</style>
