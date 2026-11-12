<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronRight, FileText, Lock, Moon, Sun } from 'lucide-vue-next'
import PageIcon from '@/components/PageIcon.vue'
import { resolveCoverBackgroundSync } from '@/components/pageCover'
import { readPublicShare, type PublicSharePayload } from '@/api/features'
import { renderMarkdown } from '@/utils/renderMarkdown'
import { renderMermaid } from '@/blocks/mermaid'
import { store, toggleTheme } from '@/store'

const props = defineProps<{ token: string }>()

const ACCESS_KEY = `ginkgo-share-access:${props.token}`
const data = ref<PublicSharePayload | null>(null)
const error = ref('')
const needPassword = ref(false)
const password = ref('')
const loading = ref(true)
const access = ref<string | null>(sessionStorage.getItem(ACCESS_KEY))
const trail = ref<{ id: string; title: string; icon: string }[]>([])
const bodyRef = ref<HTMLElement | null>(null)

function assetUrl(id: string) {
  const k = access.value ? `?k=${encodeURIComponent(access.value)}` : ''
  return `/api/public/shares/${encodeURIComponent(props.token)}/assets/${encodeURIComponent(id)}${k}`
}

const html = computed(() =>
  data.value ? renderMarkdown(data.value.page.content, { assetUrl, databases: data.value.databases }) : '',
)

const coverStyle = computed(() => {
  const cover = data.value?.page.cover
  if (!cover) return null
  if (cover.startsWith('asset:')) {
    return { background: `center / cover no-repeat url("${assetUrl(cover.slice(6))}")` }
  }
  const bg = resolveCoverBackgroundSync(cover)
  return bg ? { background: bg } : null
})

/** 图标为上传图片时也走分享的图片代理 */
const iconAsset = computed(() => {
  const icon = data.value?.page.icon ?? ''
  const m = /^asset:([A-Za-z0-9_-]+)$/.exec(icon)
  return m ? assetUrl(m[1]!) : null
})

async function load(pageId?: string) {
  loading.value = true
  error.value = ''
  try {
    const res = await readPublicShare(props.token, {
      password: needPassword.value ? password.value : undefined,
      access: access.value,
      pageId,
    })
    if (res.access) {
      access.value = res.access
      sessionStorage.setItem(ACCESS_KEY, res.access)
    }
    needPassword.value = false
    data.value = res
    document.title = `${res.page.title || '未命名'} · 银杏笔记`
    if (!pageId || pageId === res.rootId) trail.value = []
    window.scrollTo({ top: 0 })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 401) {
      needPassword.value = true
      access.value = null
      sessionStorage.removeItem(ACCESS_KEY)
      if (password.value) error.value = (e as Error).message
    } else {
      error.value = (e as Error).message
    }
  } finally {
    loading.value = false
  }
}

function openChild(c: { id: string; title: string; icon: string }) {
  if (data.value) trail.value.push({ id: data.value.page.id, title: data.value.page.title, icon: data.value.page.icon })
  void load(c.id)
}

function goTrail(i: number) {
  const target = trail.value[i]!
  trail.value = trail.value.slice(0, i)
  void load(target.id)
}

async function enhance() {
  await nextTick()
  const root = bodyRef.value
  if (!root) return
  const blocks = root.querySelectorAll<HTMLElement>('pre code')
  if (blocks.length) {
    const hljs = (await import('highlight.js/lib/common')).default
    blocks.forEach((el) => hljs.highlightElement(el))
  }
  for (const el of root.querySelectorAll<HTMLElement>('.sv-mermaid')) {
    const r = await renderMermaid(el.dataset.code ?? '', store.theme === 'dark')
    el.innerHTML = r.svg ?? `<pre class="sv-mermaid-err">${r.error ?? ''}</pre>`
  }
}

watch([html, () => store.theme], enhance)
onMounted(() => load())
</script>

<template>
  <div class="sv">
    <header class="sv-top">
      <a class="sv-brand" href="/"><span>🍃</span>银杏笔记</a>
      <nav v-if="trail.length" class="sv-trail">
        <template v-for="(t, i) in trail" :key="t.id">
          <button type="button" @click="goTrail(i)">{{ t.title || '未命名' }}</button>
          <ChevronRight :size="12" />
        </template>
        <span>{{ data?.page.title || '未命名' }}</span>
      </nav>
      <span class="sv-grow"></span>
      <button class="gn-icon-btn" v-tooltip="store.theme === 'dark' ? '浅色' : '深色'" @click="toggleTheme($event)">
        <component :is="store.theme === 'dark' ? Sun : Moon" :size="15" />
      </button>
    </header>

    <div v-if="needPassword" class="sv-center">
      <form class="sv-pwd gn-pop" @submit.prevent="load(data?.page.id)">
        <Lock :size="22" :stroke-width="1.6" />
        <h2>该页面需要访问密码</h2>
        <input v-model="password" type="password" placeholder="请输入访问密码" autofocus />
        <p v-if="error" class="sv-err">{{ error }}</p>
        <button type="submit" :disabled="!password || loading">打开</button>
      </form>
    </div>

    <div v-else-if="error && !data" class="sv-center">
      <div class="sv-gone">
        <FileText :size="28" :stroke-width="1.4" />
        <h2>{{ error }}</h2>
        <a href="/">前往银杏笔记</a>
      </div>
    </div>

    <article v-else-if="data" class="sv-article">
      <div v-if="coverStyle" class="sv-cover" :style="coverStyle"></div>
      <div class="sv-inner" :class="{ 'has-cover': coverStyle }">
        <div class="sv-icon">
          <img v-if="iconAsset" :src="iconAsset" alt="" />
          <PageIcon v-else-if="data.page.icon" :icon="data.page.icon" :size="56" :fallback="false" />
        </div>
        <h1 class="sv-title">{{ data.page.title || '未命名' }}</h1>
        <div v-if="data.page.updatedAt" class="sv-meta">更新于 {{ new Date(data.page.updatedAt).toLocaleString() }}</div>
        <div ref="bodyRef" class="sv-body gn-prose" v-html="html"></div>

        <section v-if="data.children.length" class="sv-children">
          <div class="sv-children-title">子页面</div>
          <button v-for="c in data.children" :key="c.id" type="button" class="sv-child" @click="openChild(c)">
            <PageIcon :icon="c.icon" :size="15" />
            <span>{{ c.title || '未命名' }}</span>
          </button>
        </section>
        <footer class="sv-foot">由 <a href="/">银杏笔记</a> 发布</footer>
      </div>
    </article>

    <div v-else class="sv-center sv-loading">加载中…</div>
  </div>
</template>

<style scoped>
.sv {
  min-height: 100vh;
  background: var(--gn-bg);
  color: var(--gn-text);
}
.sv-top {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 16px;
  background: color-mix(in srgb, var(--gn-bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--gn-border);
}
.sv-brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--gn-text);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
}
.sv-trail {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  font-size: 12.5px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
.sv-trail button {
  border: none;
  background: none;
  color: var(--gn-text-muted);
  font-size: inherit;
  cursor: pointer;
}
.sv-trail button:hover {
  color: var(--gn-text);
}
.sv-grow {
  flex: 1 1 auto;
}
.sv-center {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 46px);
  padding: 24px;
}
.sv-loading {
  color: var(--gn-text-muted);
  font-size: 13px;
}
.sv-pwd,
.sv-gone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(340px, 100%);
  padding: 28px 24px;
  border: 1px solid var(--gn-border);
  border-radius: 14px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-md);
  color: var(--gn-text-soft);
  text-align: center;
}
.sv-pwd h2,
.sv-gone h2 {
  margin: 0;
  font-size: 15px;
  color: var(--gn-text);
}
.sv-pwd input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--gn-border-strong);
  border-radius: 8px;
  background: var(--gn-bg);
  color: var(--gn-text);
  outline: none;
}
.sv-pwd button {
  width: 100%;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: var(--gn-text);
  color: var(--gn-bg);
  cursor: pointer;
}
.sv-pwd button:disabled {
  opacity: 0.45;
}
.sv-err {
  margin: 0;
  font-size: 12px;
  color: var(--gn-danger);
}
.sv-gone a {
  color: var(--gn-accent);
  font-size: 13px;
}
.sv-cover {
  height: 220px;
}
.sv-inner {
  max-width: 760px;
  margin: 0 auto;
  padding: 40px 24px 60px;
}
.sv-inner.has-cover {
  padding-top: 0;
}
.sv-inner.has-cover .sv-icon {
  margin-top: -36px;
}
.sv-icon img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 10px;
}
.sv-title {
  margin: 10px 0 4px;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.sv-meta {
  margin-bottom: 18px;
  font-size: 12px;
  color: var(--gn-text-muted);
}
.sv-body {
  font-size: 16px;
  line-height: 1.75;
  word-wrap: break-word;
}
.sv-body :deep(h1),
.sv-body :deep(h2),
.sv-body :deep(h3),
.sv-body :deep(h4) {
  margin: 1.4em 0 0.5em;
  line-height: 1.35;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.sv-body :deep(h1) {
  font-size: 1.85em;
}
.sv-body :deep(h2) {
  font-size: 1.5em;
}
.sv-body :deep(h3) {
  font-size: 1.25em;
}
.sv-body :deep(h4) {
  font-size: 1.08em;
}
.sv-body :deep(ul),
.sv-body :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.5em;
}
.sv-body :deep(ul) {
  list-style: disc;
}
.sv-body :deep(ol) {
  list-style: decimal;
}
.sv-body :deep(li) {
  margin: 0.15em 0;
}
.sv-body :deep(hr) {
  margin: 1.4em 0;
  border: none;
  border-top: 1px solid var(--gn-border);
}
.sv-body :deep(a) {
  color: var(--gn-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.sv-body :deep(mark.sv-highlight),
.sv-body :deep(mark:not([data-bg])) {
  border-radius: 3px;
  padding: 0 2px;
  background: color-mix(in srgb, #fef08a 70%, transparent);
}
.sv-body :deep(p) {
  margin: 0.4em 0;
}
.sv-body :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}
.sv-body :deep(pre) {
  padding: 12px 14px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg-code);
  overflow-x: auto;
  font-size: 13.5px;
  line-height: 1.6;
}
.sv-body :deep(code) {
  font-family: var(--gn-mono);
}
.sv-body :deep(:not(pre) > code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--gn-bg-hover);
  font-size: 0.88em;
}
.sv-body :deep(blockquote) {
  margin: 0.6em 0;
  padding-left: 14px;
  border-left: 3px solid var(--gn-border-strong);
  color: var(--gn-text-soft);
}
.sv-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 14.5px;
}
.sv-body :deep(th),
.sv-body :deep(td) {
  padding: 6px 9px;
  border: 1px solid var(--gn-border-strong);
  text-align: left;
  vertical-align: top;
}
.sv-body :deep(th) {
  background: var(--gn-bg-hover);
}
.sv-body :deep(.sv-task) {
  list-style: none;
  margin-left: -1.3em;
}
.sv-body :deep(.sv-task input) {
  margin-right: 6px;
  vertical-align: -1px;
}
.sv-body :deep(.sv-mermaid) {
  display: flex;
  justify-content: center;
  margin: 12px 0;
  overflow-x: auto;
}
.sv-body :deep(.sv-db) {
  margin: 12px 0;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  overflow: hidden;
}
.sv-body :deep(.sv-db-title) {
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--gn-border);
}
.sv-body :deep(.sv-db-scroll) {
  overflow-x: auto;
}
.sv-body :deep(.sv-db table) {
  margin: 0;
}
.sv-children {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--gn-border);
}
.sv-children-title {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--gn-text-muted);
}
.sv-child {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.sv-child:hover {
  background: var(--gn-bg-hover);
}
.sv-foot {
  margin-top: 48px;
  font-size: 12px;
  color: var(--gn-text-muted);
  text-align: center;
}
.sv-foot a {
  color: inherit;
}
@media (max-width: 768px) {
  .sv-cover {
    height: 140px;
  }
  .sv-inner {
    padding: 24px 18px 48px;
  }
  .sv-title {
    font-size: 27px;
  }
}
</style>
