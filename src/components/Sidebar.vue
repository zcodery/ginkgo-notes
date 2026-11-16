<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Search,
  Plus,
  Star,
  Trash2,
  PanelLeftClose,
  Moon,
  Sun,
  LogOut,
  Globe,
  NotebookPen,
  Import,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-vue-next'
import PageTree from './PageTree.vue'
import PageIcon from './PageIcon.vue'
import UserAvatar from './UserAvatar.vue'
import NotificationBell from './NotificationBell.vue'
import { userState } from '@/userState'
import { tr } from '@/i18n/phrases'
import {
  store,
  displayName,
  favoritePages,
  goToPage,
  goTrash,
  goHome,
  goProfile,
  goShared,
  goFriends,
  goTeams,
  toggleTheme,
  isAdmin,
  logout,
  switchSpace,
  reloadPages,
} from '@/store'
import { countLegacyPages, importLegacyToPublic, legacyAlreadyImported } from '@/db/legacy'
import { t } from '@/i18n'

const treeRef = ref<InstanceType<typeof PageTree> | null>(null)

/** 与我共享：按授权根页面展开成带层级的扁平列表 */
const sharedItems = computed(() => {
  const pages = userState.sharedPages
  const out: { id: string; title: string; icon: string; depth: number; owner: string; role: string }[] = []
  const walk = (parentId: string, depth: number, owner: string) => {
    for (const p of pages.filter((x) => x.parentId === parentId).sort((a, b) => a.order - b.order)) {
      out.push({ id: p.id, title: p.title, icon: p.icon, depth, owner, role: p.role })
      if (depth < 3) walk(p.id, depth + 1, owner)
    }
  }
  for (const r of userState.sharedRoots) {
    const root = pages.find((p) => p.id === r.pageId)
    if (!root || out.some((o) => o.id === root.id)) continue
    out.push({ id: root.id, title: root.title, icon: root.icon, depth: 0, owner: r.ownerName, role: r.role })
    walk(root.id, 1, r.ownerName)
  }
  return out
})
const userMenuOpen = ref(false)
const legacyCount = ref(0)
const importing = ref(false)

function onSearch() {
  store.searchOpen = true
}

function onNew() {
  treeRef.value?.newPage()
}

async function checkLegacy() {
  legacyCount.value = isAdmin.value && !legacyAlreadyImported() ? await countLegacyPages() : 0
}

const teamSpaces = computed(() => store.spaces.filter((s) => s.type === 'team'))

/** 侧栏顶部显示当前空间名：个人空间用设置里的名字，团队用团队名 */
const workspaceName = computed(() => {
  if (store.space !== 'me' && store.space !== 'public') {
    return store.spaces.find((s) => s.id === store.space)?.name || t('app.name')
  }
  return userState.space.name || t('app.name')
})

async function toSpace(space: string) {
  userMenuOpen.value = false
  await switchSpace(space)
}

async function importLegacy() {
  userMenuOpen.value = false
  const ok = window.confirm(
    `将把本机浏览器里的 ${legacyCount.value} 篇旧笔记导入为公共原稿，并替换现有的公共原稿。\n已注册用户手里的副本不受影响，之后新注册的用户会收到这些内容。\n确定继续吗？`,
  )
  if (!ok) return
  importing.value = true
  try {
    const n = await importLegacyToPublic(store.space)
    legacyCount.value = 0
    if (store.space === 'public') await reloadPages()
    else await switchSpace('public')
    window.alert(`已导入 ${n} 篇笔记到公共原稿。`)
  } catch (err) {
    window.alert(`导入失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    importing.value = false
  }
}

function onLogout() {
  userMenuOpen.value = false
  logout()
}

function onGlobalDown(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (userMenuOpen.value && !t.closest('.sb-user-menu') && !t.closest('.sb-user')) {
    userMenuOpen.value = false
  }
}

watch(() => store.user?.id, () => void checkLegacy())

onMounted(() => {
  document.addEventListener('mousedown', onGlobalDown)
  void checkLegacy()
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onGlobalDown))
</script>

<template>
  <aside class="sidebar">
    <div class="sb-head">
      <button class="sb-workspace" @click="goHome">
        <span class="sb-logo"><PageIcon :icon="userState.space.icon || '🍃'" :size="16" /></span>
        <span class="sb-name">{{ workspaceName }}</span>
      </button>
      <NotificationBell />
      <button class="gn-icon-btn" v-tooltip="t('sidebar.collapse')" @click="store.sidebarOpen = false">
        <PanelLeftClose :size="15" :stroke-width="1.8" />
      </button>
    </div>

    <div v-if="store.space === 'public'" class="sb-public">
      <div class="sb-public-title">
        <Globe :size="13" :stroke-width="2" />
        <span>{{ t('sidebar.publicEditing') }}</span>
      </div>
      <p>{{ t('sidebar.publicHint') }}</p>
      <button @click="toSpace('me')">{{ t('sidebar.backToMine') }}</button>
    </div>

    <div class="sb-actions">
      <button class="sb-action" @click="onSearch">
        <Search :size="15" :stroke-width="1.9" />
        <span class="sb-action-text">{{ t('sidebar.search') }}</span>
        <kbd class="sb-kbd">⌘K</kbd>
      </button>
      <button class="sb-action" @click="onNew">
        <Plus :size="15" :stroke-width="1.9" />
        <span class="sb-action-text">{{ t('sidebar.newPage') }}</span>
      </button>
    </div>

    <div class="sb-scroll gn-scroll">
      <template v-if="favoritePages.length">
        <div class="sb-section-title">
          <Star :size="12" :stroke-width="2" />
          <span>{{ t('sidebar.favorites') }}</span>
        </div>
        <button
          v-for="p in favoritePages"
          :key="p.id"
          class="sb-fav"
          :class="{ active: store.route.pageId === p.id }"
          @click="goToPage(p.id)"
        >
          <PageIcon :icon="p.icon" :size="14" />
          <span class="sb-fav-title">{{ p.title || t('app.untitled') }}</span>
        </button>
      </template>

      <div class="sb-section-title">
        <span>{{ t('sidebar.private') }}</span>
        <button
          class="sb-section-add"
          v-tooltip="{ title: t('sidebar.newPageTip'), desc: t('sidebar.newPageDesc'), placement: 'right' }"
          @click="onNew"
        >
          <Plus :size="13" :stroke-width="2.2" />
        </button>
      </div>

      <PageTree ref="treeRef" />

      <template v-if="sharedItems.length && store.space !== 'public'">
        <div class="sb-section-title">
          <Users :size="12" :stroke-width="2" />
          <span>{{ tr('与我共享') }}</span>
        </div>
        <button
          v-for="p in sharedItems"
          :key="p.id"
          class="sb-fav"
          :class="{ active: store.route.view === 'shared' && store.route.pageId === p.id }"
          :style="{ paddingLeft: 7 + p.depth * 14 + 'px' }"
          v-tooltip="p.depth === 0 ? { title: p.title || t('app.untitled'), desc: tr('来自 {owner} · {role}', { owner: p.owner, role: p.role === 'editor' ? tr('可编辑') : tr('只读') }), placement: 'right' } : undefined"
          @click="goShared(p.id)"
        >
          <PageIcon :icon="p.icon" :size="14" />
          <span class="sb-fav-title">{{ p.title || t('app.untitled') }}</span>
        </button>
      </template>
    </div>

    <div class="sb-foot">
      <button class="sb-foot-btn" @click="goTrash">
        <Trash2 :size="14" :stroke-width="1.8" />
        <span>{{ t('sidebar.trash') }}</span>
      </button>
      <button
        class="sb-foot-btn icon-only"
        v-tooltip="store.theme === 'dark' ? t('sidebar.light') : t('sidebar.dark')"
        @click="toggleTheme"
      >
        <component :is="store.theme === 'dark' ? Sun : Moon" :size="14" :stroke-width="1.8" />
      </button>
    </div>

    <div class="sb-user-wrap">
      <button class="sb-user" :class="{ open: userMenuOpen }" @click="userMenuOpen = !userMenuOpen">
        <UserAvatar :size="22" :radius="6" />
        <span class="sb-user-name">{{ displayName }}</span>
        <span v-if="isAdmin" class="sb-badge" v-tooltip="t('sidebar.admin')">
          <ShieldCheck :size="11" :stroke-width="2.2" />{{ t('sidebar.admin') }}
        </span>
      </button>

      <div v-if="userMenuOpen" class="sb-user-menu gn-pop">
        <button
          :class="{ on: store.settingsOpen }"
          @click="userMenuOpen = false; goProfile()"
        >
          <UserRound :size="14" :stroke-width="1.8" /><span>{{ t('sidebar.profile') }}</span>
        </button>
        <div class="sb-menu-sep"></div>
        <button @click="userMenuOpen = false; goFriends()">
          <Users :size="14" :stroke-width="1.8" /><span>好友</span>
        </button>
        <button @click="userMenuOpen = false; goTeams()">
          <Users :size="14" :stroke-width="1.8" /><span>团队</span>
        </button>
        <template v-if="teamSpaces.length">
          <div class="sb-menu-sep"></div>
          <button
            v-for="s in teamSpaces"
            :key="s.id"
            :class="{ on: store.space === s.id }"
            @click="toSpace(s.id)"
          >
            <Users :size="14" :stroke-width="1.8" /><span>{{ s.name }}</span>
          </button>
        </template>
        <template v-if="isAdmin">
          <div class="sb-menu-sep"></div>
          <button :class="{ on: store.space === 'me' }" @click="toSpace('me')">
            <NotebookPen :size="14" :stroke-width="1.8" /><span>{{ t('sidebar.myNotes') }}</span>
          </button>
          <button :class="{ on: store.space === 'public' }" @click="toSpace('public')">
            <Globe :size="14" :stroke-width="1.8" /><span>{{ t('sidebar.publicDraft') }}</span>
          </button>
          <button v-if="legacyCount > 0" :disabled="importing" @click="importLegacy">
            <Import :size="14" :stroke-width="1.8" />
            <span>{{
              importing ? t('sidebar.importing') : t('sidebar.importLegacy', { n: legacyCount })
            }}</span>
          </button>
        </template>
        <div class="sb-menu-sep"></div>
        <button class="danger" @click="onLogout">
          <LogOut :size="14" :stroke-width="1.8" /><span>{{ t('sidebar.logout') }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 248px;
  flex: 0 0 248px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--gn-bg-sidebar);
  border-right: 1px solid var(--gn-border);
  user-select: none;
}
.sb-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 9px 8px 5px 10px;
}
.sb-workspace {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.sb-workspace:hover {
  background: var(--gn-bg-hover);
}
.sb-logo {
  font-size: 15px;
  line-height: 1;
}
.sb-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--gn-text);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-actions {
  padding: 2px 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.sb-action {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 29px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
  font-size: 13.5px;
  text-align: left;
}
.sb-action:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.sb-action-text {
  flex: 1 1 auto;
}
.sb-kbd {
  font-family: var(--gn-font);
  font-size: 10.5px;
  color: var(--gn-text-muted);
  border: 1px solid var(--gn-border-strong);
  border-radius: 4px;
  padding: 0 4px;
  line-height: 15px;
}
.sb-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 10px;
}
.sb-section-title {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 12px 14px 4px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--gn-text-muted);
}
.sb-section-title > span {
  flex: 1 1 auto;
}
.sb-section-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.sb-section-add:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.sb-fav {
  display: flex;
  align-items: center;
  gap: 6px;
  width: calc(100% - 12px);
  margin: 1px 6px;
  height: 27px;
  padding: 0 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
  font-size: 13.5px;
  text-align: left;
}
.sb-fav:hover {
  background: var(--gn-bg-hover);
}
.sb-fav.active {
  background: var(--gn-bg-active);
  color: var(--gn-text);
  font-weight: 560;
  box-shadow: inset 3px 0 0 var(--gn-accent);
}
.sb-fav-title {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-foot {
  border-top: 1px solid var(--gn-border);
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.sb-foot-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1 1 auto;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 13px;
  cursor: pointer;
}
.sb-foot-btn:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.sb-foot-btn.icon-only {
  flex: 0 0 auto;
  width: 28px;
  padding: 0;
  justify-content: center;
}

.sb-public {
  margin: 2px 8px 8px;
  padding: 9px 10px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, #d9730d 12%, var(--gn-bg-sidebar));
  border: 1px solid color-mix(in srgb, #d9730d 30%, transparent);
}
.sb-public-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: color-mix(in srgb, #d9730d 80%, var(--gn-text));
}
.sb-public p {
  margin: 4px 0 8px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--gn-text-soft);
}
.sb-public button {
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--gn-border-strong);
  border-radius: 5px;
  background: var(--gn-bg);
  color: var(--gn-text-soft);
  font-size: 12px;
  cursor: pointer;
}
.sb-public button:hover {
  color: var(--gn-text);
  border-color: var(--gn-text-muted);
}

.sb-user-wrap {
  position: relative;
  padding: 0 8px 8px;
}
.sb-user {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
  text-align: left;
}
.sb-user:hover,
.sb-user.open {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.sb-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 6px;
  background: var(--gn-accent);
  color: var(--gn-bg);
  font-size: 12px;
  font-weight: 650;
}
.sb-user-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.sb-user-menu {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% + 2px);
  padding: 5px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  box-shadow: var(--gn-shadow-lg);
  z-index: 90;
}
.sb-user-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.sb-user-menu button:hover:not(:disabled) {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.sb-user-menu button.on {
  color: var(--gn-accent);
  font-weight: 500;
}
.sb-user-menu button.danger {
  color: var(--gn-danger);
}
.sb-user-menu button.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
}
.sb-user-menu button:disabled {
  opacity: 0.6;
  cursor: default;
}
.sb-menu-sep {
  height: 1px;
  margin: 4px 3px;
  background: var(--gn-border);
}
</style>
