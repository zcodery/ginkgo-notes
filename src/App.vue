<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PanelLeftOpen, RefreshCw, X } from 'lucide-vue-next'
import Sidebar from '@/components/Sidebar.vue'
import SearchModal from '@/components/SearchModal.vue'
// 编辑器依赖较重，首页不必加载
const NoteView = defineAsyncComponent(() => import('@/views/NoteView.vue'))
const SharedNoteView = defineAsyncComponent(() => import('@/views/SharedNoteView.vue'))
const SharedPublicView = defineAsyncComponent(() => import('@/views/SharedPublicView.vue'))
import HomeView from '@/views/HomeView.vue'
import TrashView from '@/views/TrashView.vue'
import FriendsView from '@/views/FriendsView.vue'
import TeamsView from '@/views/TeamsView.vue'
import ProfileView from '@/views/ProfileView.vue'
import AuthView from '@/views/AuthView.vue'
import PinLock from '@/components/PinLock.vue'
import {
  store,
  parseRoute,
  migrateLegacyHash,
  initTheme,
  initEditorPrefs,
  initViewport,
  goHome,
  goToPage,
  goProfile,
  loginWithToken,
  restoreSession,
  toggleTheme,
  reloadPages,
  reloadGutterTuningPref,
} from '@/store'
import { createPage } from '@/db/repo'
import { t } from '@/i18n'
import { tr } from '@/i18n/phrases'
import { matchShortcut, loadShortcuts, NOTE_SHORTCUTS } from '@/shortcuts'
import { lockNow, pinLock, setPinIdleWatch } from '@/pinLock'
import { initUserState, resetUserState } from '@/userState'
import { fetchServerVersion } from '@/api/features'

// 首帧之前就确定是否窄屏，避免手机上侧栏先展开再收起
initViewport()

const currentPageId = computed(() => store.route.pageId)
const isPublicShare = computed(() => store.route.view === 'publicShare')

const pageExists = computed(() => {
  if (store.route.view !== 'note' || !store.route.pageId) return false
  return store.pages.some((p) => p.id === store.route.pageId && !p.trashed)
})

function syncRoute() {
  store.route = parseRoute()
  if (store.route.view === 'note' && !pageExists.value && store.loaded) {
    // 页面已被删除或不存在
    goHome()
  }
}

async function newPageShortcut() {
  const page = await createPage({ parentId: null })
  await reloadPages()
  goToPage(page.id)
}

function onKeydown(e: KeyboardEvent) {
  if (!store.user || isPublicShare.value || pinLock.locked) return
  const action = matchShortcut(e)
  // 笔记页专属快捷键交给 NoteView 处理
  if (action && NOTE_SHORTCUTS.has(action)) return
  if (action) {
    e.preventDefault()
    switch (action) {
      case 'search':
        store.searchOpen = !store.searchOpen
        break
      case 'newPage':
        void newPageShortcut()
        break
      case 'toggleSidebar':
        store.sidebarOpen = !store.sidebarOpen
        break
      case 'toggleTheme':
        toggleTheme()
        break
      case 'openSettings':
        store.settingsOpen ? (store.settingsOpen = false) : goProfile()
        break
      case 'goHome':
        goHome()
        break
      case 'lock':
        if (store.user.hasPin) lockNow()
        break
    }
    return
  }
  // 屏蔽浏览器默认的「保存网页」
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') e.preventDefault()
}

/* ---------------- 新版本提示 ---------------- */

const newVersion = ref('')
let versionTimer: number | null = null

function reloadApp() {
  window.location.reload()
}

async function checkVersion() {
  try {
    const v = await fetchServerVersion()
    if (v && v !== __APP_VERSION__) newVersion.value = v
  } catch {
    /* 离线 */
  }
}

/* ---------------- 第三方登录回跳 ---------------- */

async function handleOAuthReturn() {
  const q = new URLSearchParams(window.location.search)
  const token = q.get('oauth_token')
  const bound = q.get('oauth')
  if (!token && !bound) return
  history.replaceState(null, '', window.location.pathname)
  if (token) {
    try {
      await loginWithToken(token)
    } catch {
      /* 令牌无效则停留在登录页 */
    }
  }
  if (bound === 'bound') goProfile('account')
}

watch(
  () => store.user?.id,
  (id) => {
    if (id) {
      initUserState()
      void loadShortcuts()
      void reloadGutterTuningPref()
    } else {
      resetUserState()
      store.gutterTuning = false
    }
  },
)

watch(
  () => !!store.user?.hasPin,
  (on) => setPinIdleWatch(on),
)

/**
 * 公开分享页直接挂在 template 根上，不在 .app-shell 里。
 * 应用外壳依赖 body { overflow:hidden } 做内部滚动，分享页必须放开文档滚动，
 * 否则长文章只能看到首屏（body 被锁死，页面无处可滚）。
 */
watch(
  isPublicShare,
  (v) => {
    document.documentElement.classList.toggle('gn-standalone', v)
    document.body.classList.toggle('gn-standalone', v)
  },
  { immediate: true },
)

onMounted(async () => {
  await initTheme()
  await initEditorPrefs()
  migrateLegacyHash()
  store.route = parseRoute()
  if (!isPublicShare.value) {
    await restoreSession()
    await reloadGutterTuningPref()
    await handleOAuthReturn()
  } else {
    store.authReady = true
  }
  // 旧的 /profile 地址：回到首页并打开设置弹窗
  if (store.route.view === 'profile') {
    history.replaceState(null, '', '/')
    store.route = parseRoute()
    store.settingsOpen = true
  }
  window.addEventListener('popstate', syncRoute)
  document.addEventListener('keydown', onKeydown)
  void checkVersion()
  versionTimer = window.setInterval(checkVersion, 30 * 60_000)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', syncRoute)
  document.removeEventListener('keydown', onKeydown)
  document.documentElement.classList.remove('gn-standalone')
  document.body.classList.remove('gn-standalone')
  if (versionTimer) window.clearInterval(versionTimer)
})
</script>

<template>
  <SharedPublicView v-if="isPublicShare && currentPageId" :token="currentPageId" />
  <div v-else-if="!store.authReady" class="app-boot"></div>
  <AuthView v-else-if="!store.user" />
  <div v-else class="app-shell" :class="{ 'is-mobile': store.isMobile }">
    <Transition :name="store.isMobile ? 'gn-drawer' : 'gn-sidebar'">
      <Sidebar v-if="store.sidebarOpen" />
    </Transition>
    <Transition name="gn-fade-t">
      <div
        v-if="store.isMobile && store.sidebarOpen"
        class="app-backdrop"
        @click="store.sidebarOpen = false"
      ></div>
    </Transition>
    <Transition name="gn-fade-t">
      <button
        v-if="!store.sidebarOpen && store.route.view !== 'note' && store.route.view !== 'shared'"
        class="app-reopen gn-icon-btn"
        v-tooltip="t('sidebar.expand')"
        @click="store.sidebarOpen = true"
      >
        <PanelLeftOpen :size="16" :stroke-width="1.9" />
      </button>
    </Transition>
    <main class="app-main">
      <NoteView v-if="pageExists && currentPageId" :key="currentPageId" :page-id="currentPageId" />
      <SharedNoteView
        v-else-if="store.route.view === 'shared' && currentPageId"
        :key="`shared-${currentPageId}`"
        :page-id="currentPageId"
      />
      <TrashView v-else-if="store.route.view === 'trash'" />
      <FriendsView v-else-if="store.route.view === 'friends'" />
      <TeamsView v-else-if="store.route.view === 'teams'" />
      <HomeView v-else />
    </main>
    <SearchModal />
    <ProfileView v-if="store.settingsOpen" />
    <PinLock v-if="pinLock.locked && store.user.hasPin" />
    <Transition name="gn-drop">
      <div v-if="newVersion" class="app-update gn-pop">
        <RefreshCw :size="13" :stroke-width="2" />
        <span>{{ tr('发现新版本 {v}，刷新后即可使用', { v: newVersion }) }}</span>
        <button type="button" class="app-update-btn" @click="reloadApp">{{ tr('刷新') }}</button>
        <button type="button" class="gn-icon-btn danger" @click="newVersion = ''"><X :size="13" /></button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-boot {
  height: 100vh;
  background: var(--gn-bg);
}
.app-shell {
  display: flex;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  overflow: hidden;
  background: var(--gn-bg);
}
/* 窄屏：侧栏浮在内容之上，点遮罩收起 */
.app-shell.is-mobile .sidebar {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 260;
  width: min(300px, 86vw);
  flex-basis: auto;
  box-shadow: var(--gn-shadow-lg);
}
.app-backdrop {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(20, 20, 18, 0.36);
}
.app-main {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.app-reopen {
  position: fixed;
  left: 12px;
  top: 8px;
  z-index: 120;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  box-shadow: var(--gn-shadow-sm);
}
.app-update {
  position: fixed;
  left: 50%;
  bottom: 18px;
  z-index: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 14px;
  transform: translateX(-50%);
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
  font-size: 12.5px;
  white-space: nowrap;
}
.app-update-btn {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: var(--gn-text);
  color: var(--gn-bg);
  font-size: 12px;
  cursor: pointer;
}
</style>
