<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from 'vue'
import { PanelLeftOpen } from 'lucide-vue-next'
import Sidebar from '@/components/Sidebar.vue'
import SearchModal from '@/components/SearchModal.vue'
// 编辑器依赖较重，首页不必加载
const NoteView = defineAsyncComponent(() => import('@/views/NoteView.vue'))
import HomeView from '@/views/HomeView.vue'
import TrashView from '@/views/TrashView.vue'
import ProfileView from '@/views/ProfileView.vue'
import AuthView from '@/views/AuthView.vue'
import {
  store,
  parseRoute,
  migrateLegacyHash,
  initTheme,
  initEditorPrefs,
  initViewport,
  goHome,
  restoreSession,
} from '@/store'
import { t } from '@/i18n'

// 首帧之前就确定是否窄屏，避免手机上侧栏先展开再收起
initViewport()

const currentPageId = computed(() => store.route.pageId)

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

function onKeydown(e: KeyboardEvent) {
  if (!store.user) return
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return
  if (e.key.toLowerCase() === 'k') {
    e.preventDefault()
    store.searchOpen = !store.searchOpen
    return
  }
  if (e.key.toLowerCase() === 's') {
    e.preventDefault()
  }
}

onMounted(async () => {
  await initTheme()
  await initEditorPrefs()
  await restoreSession()
  migrateLegacyHash()
  store.route = parseRoute()
  // 旧的 /profile 地址：回到首页并打开设置弹窗
  if (store.route.view === 'profile') {
    history.replaceState(null, '', '/')
    store.route = parseRoute()
    store.settingsOpen = true
  }
  window.addEventListener('popstate', syncRoute)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', syncRoute)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="!store.authReady" class="app-boot"></div>
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
        v-if="!store.sidebarOpen && store.route.view !== 'note'"
        class="app-reopen gn-icon-btn"
        v-tooltip="t('sidebar.expand')"
        @click="store.sidebarOpen = true"
      >
        <PanelLeftOpen :size="16" :stroke-width="1.9" />
      </button>
    </Transition>
    <main class="app-main">
      <NoteView v-if="pageExists && currentPageId" :key="currentPageId" :page-id="currentPageId" />
      <TrashView v-else-if="store.route.view === 'trash'" />
      <HomeView v-else />
    </main>
    <SearchModal />
    <ProfileView v-if="store.settingsOpen" />
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
</style>
