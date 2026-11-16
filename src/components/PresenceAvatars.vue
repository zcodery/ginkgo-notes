<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { PencilLine } from 'lucide-vue-next'
import {
  heartbeatPresence,
  subscribePresence,
  type PresenceState,
} from '@/api/features'
import { store } from '@/store'

const props = defineProps<{ pageId: string }>()

const state = ref<PresenceState>({ users: [], editor: null, total: 0, updatedAt: 0 })

/** 只展示同时在线的其他人，自己的头像不显示 */
const others = computed(() => state.value.users.filter((u) => u.userId !== store.user?.id))

let connId = ''
let stopStream: (() => void) | null = null
let heartbeatTimer: number | null = null
let reconnectTimer: number | null = null
let stopped = false

const editorName = computed(() => {
  if (!state.value.editor) return ''
  if (state.value.editor === store.user?.id) return ''
  return state.value.users.find((u) => u.userId === state.value.editor)?.name ?? '其他成员'
})

function initial(name: string): string {
  return (name || '?').slice(0, 1).toUpperCase()
}

function connect() {
  if (stopped) return
  stopStream?.()
  stopStream = subscribePresence(
    props.pageId,
    (next) => {
      state.value = next
    },
    (id) => {
      connId = id
      void beat()
    },
  )
  // 首次连接迟迟拿不到 hello 时兜底重连
  if (reconnectTimer) window.clearTimeout(reconnectTimer)
  reconnectTimer = window.setTimeout(() => {
    if (!stopped && !connId) connect()
  }, 5000)
}

async function beat() {
  if (stopped) return
  // 没有连接标识时先建连，等 hello 回来触发心跳
  if (!connId) {
    connect()
    return
  }
  try {
    state.value = await heartbeatPresence(props.pageId, connId, false)
  } catch {
    // 鉴权失效或连接被回收：重建
    connId = ''
    connect()
  }
}

onMounted(() => {
  connect()
  heartbeatTimer = window.setInterval(() => void beat(), 25_000)
})

onBeforeUnmount(() => {
  stopped = true
  stopStream?.()
  if (heartbeatTimer) window.clearInterval(heartbeatTimer)
  if (reconnectTimer) window.clearTimeout(reconnectTimer)
})
</script>

<template>
  <div v-if="others.length" class="pa-wrap">
    <div class="pa-avatars">
      <span
        v-for="u in others.slice(0, 4)"
        :key="u.userId"
        class="pa-avatar"
        :class="{ editing: u.editing }"
        :title="`${u.name}${u.tabs > 1 ? `（${u.tabs} 个窗口）` : ''}${u.editing ? ' · 正在编辑' : ''}`"
      >
        <img v-if="u.avatar" :src="u.avatar" alt="" />
        <span v-else>{{ initial(u.name) }}</span>
      </span>
      <span v-if="others.length > 4" class="pa-more">+{{ others.length - 4 }}</span>
    </div>
    <span v-if="editorName" class="pa-editing">
      <PencilLine :size="11" :stroke-width="2" />{{ editorName }} 正在编辑
    </span>
  </div>
</template>

<style scoped>
.pa-wrap {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.pa-avatars {
  display: inline-flex;
  align-items: center;
}
.pa-avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: -5px;
  border: 2px solid var(--gn-bg);
  border-radius: 50%;
  overflow: hidden;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 10.5px;
  font-weight: 600;
}
.pa-avatar:first-child {
  margin-left: 0;
}
.pa-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pa-avatar.me {
  box-shadow: 0 0 0 1.5px var(--gn-accent);
}
.pa-avatar.editing::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2ecc71;
  box-shadow: 0 0 0 1.5px var(--gn-bg);
}
.pa-more {
  margin-left: 3px;
  font-size: 11px;
  color: var(--gn-text-soft);
}
.pa-editing {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 99px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-size: 11px;
  white-space: nowrap;
}
</style>