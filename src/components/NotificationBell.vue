<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Bell, BellOff, CheckCheck, Globe, MessageSquare, ShieldAlert, Trash2, Users, Webhook, X } from 'lucide-vue-next'
import { clearNotifications, deleteNotification, markNotificationsRead, type NotificationItem } from '@/api/features'
import { inQuietHours, loadNotifications, userState } from '@/userState'
import { goProfile, openLink } from '@/store'
import { tr } from '@/i18n/phrases'

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const quiet = computed(() => inQuietHours())

const ICONS: Record<string, unknown> = {
  security: ShieldAlert,
  share: Globe,
  member: Users,
  feedback: MessageSquare,
  webhook: Webhook,
}

function timeAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return tr('刚刚')
  if (m < 60) return tr('{n} 分钟前', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return tr('{n} 小时前', { n: h })
  const d = Math.floor(h / 24)
  if (d < 30) return tr('{n} 天前', { n: d })
  return new Date(ts).toLocaleDateString()
}

async function toggle() {
  open.value = !open.value
  if (open.value) await loadNotifications()
}

async function readAll() {
  await markNotificationsRead()
  userState.notifications.forEach((n) => (n.read = true))
  userState.unread = 0
}

async function clickItem(n: NotificationItem) {
  if (!n.read) {
    n.read = true
    userState.unread = Math.max(0, userState.unread - 1)
    void markNotificationsRead([n.id])
  }
  if (n.link) {
    open.value = false
    openLink(n.link)
  }
}

async function remove(n: NotificationItem) {
  await deleteNotification(n.id)
  if (!n.read) userState.unread = Math.max(0, userState.unread - 1)
  userState.notifications = userState.notifications.filter((x) => x.id !== n.id)
}

async function clearAll() {
  if (!window.confirm(tr('清空全部通知？'))) return
  await clearNotifications()
  userState.notifications = []
  userState.unread = 0
}

function onDocDown(e: MouseEvent) {
  if (open.value && !rootRef.value?.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', onDocDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))
</script>

<template>
  <div ref="rootRef" class="nb">
    <button
      type="button"
      class="gn-icon-btn nb-btn"
      :class="{ active: open }"
      v-tooltip="quiet ? tr('消息通知（免打扰中）') : tr('消息通知')"
      @click="toggle"
    >
      <component :is="quiet ? BellOff : Bell" :size="15" :stroke-width="1.8" />
      <span v-if="userState.unread" class="nb-badge" :class="{ quiet }">{{ userState.unread > 99 ? '99+' : userState.unread }}</span>
    </button>

    <div v-if="open" class="nb-panel gn-pop">
      <header class="nb-head">
        <span>{{ tr('消息通知') }}</span>
        <span class="nb-grow"></span>
        <button type="button" class="gn-icon-btn" v-tooltip="tr('全部已读')" :disabled="!userState.unread" @click="readAll">
          <CheckCheck :size="14" />
        </button>
        <button type="button" class="gn-icon-btn danger" v-tooltip="tr('清空')" :disabled="!userState.notifications.length" @click="clearAll">
          <Trash2 :size="14" />
        </button>
        <button type="button" class="nb-link" @click="open = false; goProfile('notify')">{{ tr('设置') }}</button>
      </header>
      <div class="nb-list gn-scroll">
        <div
          v-for="n in userState.notifications"
          :key="n.id"
          class="nb-item"
          :class="{ unread: !n.read, clickable: !!n.link }"
          @click="clickItem(n)"
        >
          <component :is="ICONS[n.type] ?? Bell" :size="15" :stroke-width="1.8" class="nb-icon" :class="n.type" />
          <div class="nb-main">
            <div class="nb-title">{{ n.title }}</div>
            <div v-if="n.body" class="nb-body">{{ n.body }}</div>
            <div class="nb-time">{{ timeAgo(n.createdAt) }}</div>
          </div>
          <button type="button" class="nb-del" v-tooltip="tr('删除')" @click.stop="remove(n)"><X :size="12" /></button>
        </div>
        <div v-if="!userState.notifications.length" class="nb-empty">{{ tr('暂时没有通知') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nb {
  position: relative;
}
.nb-btn {
  position: relative;
}
.nb-btn.active {
  background: var(--gn-bg-hover);
}
.nb-badge {
  position: absolute;
  top: 1px;
  right: 0;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 99px;
  background: var(--gn-danger);
  color: var(--gn-danger-ink);
  font-size: 9.5px;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}
.nb-badge.quiet {
  background: var(--gn-text-muted);
}
.nb-panel {
  position: absolute;
  top: 32px;
  left: 0;
  z-index: 120;
  width: min(340px, calc(100vw - 24px));
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
  overflow: hidden;
}
.nb-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--gn-border);
  font-size: 13px;
  font-weight: 600;
}
.nb-grow {
  flex: 1 1 auto;
}
.nb-link {
  margin-left: 4px;
  border: none;
  background: none;
  color: var(--gn-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.nb-link:hover {
  color: var(--gn-text);
}
.nb-list {
  max-height: 420px;
  overflow-y: auto;
}
.nb-item {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--gn-border);
}
.nb-item.clickable {
  cursor: pointer;
}
.nb-item:hover {
  background: var(--gn-bg-hover);
}
.nb-item.unread::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 16px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gn-accent);
}
.nb-icon {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--gn-text-muted);
}
.nb-icon.security {
  color: #d9730d;
}
.nb-icon.member,
.nb-icon.share {
  color: var(--gn-accent);
}
.nb-main {
  flex: 1 1 auto;
  min-width: 0;
}
.nb-title {
  font-size: 13px;
  color: var(--gn-text);
  line-height: 1.45;
}
.nb-item:not(.unread) .nb-title {
  color: var(--gn-text-soft);
}
.nb-body {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--gn-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}
.nb-time {
  margin-top: 3px;
  font-size: 11px;
  color: var(--gn-text-muted);
}
.nb-del {
  align-self: flex-start;
  display: none;
  padding: 2px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.nb-item:hover .nb-del {
  display: block;
}
.nb-empty {
  padding: 36px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
@media (hover: none) {
  .nb-del {
    display: block;
  }
}
</style>
