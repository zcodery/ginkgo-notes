<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from 'vue'
import { PanelLeftOpen } from 'lucide-vue-next'
import Sidebar from '@/components/Sidebar.vue'
import SearchModal from '@/components/SearchModal.vue'
// 编辑器依赖较重，首页不必加载
const NoteView = defineAsyncComponent(() => import('@/views/NoteView.vue'))
import HomeView from '@/views/HomeView.vue'
import TrashView from '@/views/TrashView.vue'
import AuthView from '@/views/AuthView.vue'
import { store, parseHash, initTheme, initEditorPrefs, goHome, restoreSession } from '@/store'

const currentPageId = computed(() => store.route.pageId)

const pageExists = computed(() => {
  if (store.route.view !== 'note' || !store.route.pageId) return false
  return store.pages.some((p) => p.id === store.route.pageId && !p.trashed)
})

function syncRoute() {
  store.route = parseHash()
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
  store.route = parseHash()
  window.addEventListener('hashchange', syncRoute)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', syncRoute)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="!store.authReady" class="app-boot"></div>
  <AuthView v-else-if="!store.user" />
  <div v-else class="app-shell">
    <Sidebar v-if="store.sidebarOpen" />
    <button
      v-if="!store.sidebarOpen && store.route.view !== 'note'"
      class="app-reopen gn-icon-btn"
      title="展开侧边栏"
      @click="store.sidebarOpen = true"
    >
      <PanelLeftOpen :size="16" :stroke-width="1.9" />
    </button>
    <main class="app-main">
      <NoteView v-if="pageExists && currentPageId" :key="currentPageId" :page-id="currentPageId" />
      <TrashView v-else-if="store.route.view === 'trash'" />
      <HomeView v-else />
    </main>
    <SearchModal />
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
  width: 100%;
  overflow: hidden;
  background: var(--gn-bg);
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
