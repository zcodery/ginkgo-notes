<script setup lang="ts">
import { ref } from 'vue'
import { RotateCcw, Trash2, AlertTriangle } from 'lucide-vue-next'
import { store, trashedPages, reloadPages, goHome } from '@/store'
import { deletePageForever, restorePage } from '@/db/repo'
import PageIcon from '@/components/PageIcon.vue'

const confirming = ref(false)

async function restore(id: string) {
  await restorePage(id)
  await reloadPages()
}

async function removeForever(id: string) {
  await deletePageForever(id)
  await reloadPages()
}

async function emptyTrash() {
  for (const p of trashedPages.value) {
    await deletePageForever(p.id)
  }
  confirming.value = false
  await reloadPages()
}

function timeLabel(ts: number | null) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div class="trash">
    <header class="trash-head">
      <div>
        <h1>回收站</h1>
        <p>移到回收站的笔记会保留在这里，彻底删除后无法恢复。</p>
      </div>
      <button
        v-if="trashedPages.length"
        class="gn-btn gn-btn-danger"
        @click="confirming = true"
      >
        <Trash2 :size="14" :stroke-width="1.8" />清空回收站
      </button>
    </header>

    <div class="trash-scroll gn-scroll">
      <div v-if="!trashedPages.length" class="trash-empty">
        <Trash2 :size="24" :stroke-width="1.3" />
        <p>回收站是空的</p>
        <button class="gn-btn" @click="goHome">返回笔记</button>
      </div>

      <div v-else class="trash-list">
        <div v-for="p in trashedPages" :key="p.id" class="trash-item">
          <span class="trash-icon">
            <PageIcon :icon="p.icon" :size="16" />
          </span>
          <div class="trash-body">
            <div class="trash-title">{{ p.title || '未命名' }}</div>
            <div class="trash-meta">删除于 {{ timeLabel(p.trashedAt) }}</div>
          </div>
          <div class="trash-actions">
            <button class="gn-btn" @click="restore(p.id)">
              <RotateCcw :size="13.5" :stroke-width="1.9" />恢复
            </button>
            <button class="gn-btn gn-btn-danger" @click="removeForever(p.id)">
              <Trash2 :size="13.5" :stroke-width="1.9" />彻底删除
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="confirming" class="confirm-overlay gn-fade" @mousedown.self="confirming = false">
      <div class="confirm gn-pop">
        <div class="confirm-icon"><AlertTriangle :size="20" :stroke-width="1.8" /></div>
        <h3>清空回收站？</h3>
        <p>将永久删除 {{ trashedPages.length }} 篇笔记及其子页面，此操作不可撤销。</p>
        <div class="confirm-actions">
          <button class="gn-btn" @click="confirming = false">取消</button>
          <button class="gn-btn confirm-danger" @click="emptyTrash">确认清空</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trash {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--gn-bg);
}
.trash-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 40px 40px 18px;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}
.trash-head h1 {
  margin: 0 0 5px;
  font-size: 24px;
  font-weight: 680;
  letter-spacing: -0.022em;
}
.trash-head p {
  margin: 0;
  font-size: 13px;
  color: var(--gn-text-muted);
}
.trash-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0 40px 60px;
}
.trash-scroll > * {
  max-width: 820px;
  margin-left: auto;
  margin-right: auto;
}
.trash-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  overflow: hidden;
}
.trash-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 14px;
  background: var(--gn-bg);
  border-bottom: 1px solid var(--gn-border);
}
.trash-item:last-child {
  border-bottom: none;
}
.trash-item:hover {
  background: var(--gn-bg-sidebar);
}
.trash-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--gn-border);
  color: var(--gn-text-muted);
  font-size: 14px;
  flex: 0 0 auto;
}
.trash-body {
  flex: 1 1 auto;
  min-width: 0;
}
.trash-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--gn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trash-meta {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  margin-top: 2px;
}
.trash-actions {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.trash-item:hover .trash-actions {
  opacity: 1;
}
.trash-empty {
  padding: 90px 0;
  text-align: center;
  color: var(--gn-text-muted);
}
.trash-empty p {
  margin: 12px 0 16px;
  font-size: 13.5px;
}
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: color-mix(in srgb, var(--gn-text) 26%, transparent);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.confirm {
  width: 366px;
  padding: 22px;
  background: var(--gn-bg);
  border-radius: 12px;
  box-shadow: var(--gn-shadow-lg);
  text-align: center;
}
.confirm-icon {
  display: flex;
  justify-content: center;
  color: var(--gn-danger);
  margin-bottom: 10px;
}
.confirm h3 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 650;
}
.confirm p {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--gn-text-muted);
}
.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.confirm-danger {
  background: var(--gn-danger);
  color: #fff;
}
.confirm-danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 85%, #000);
  color: #fff;
}
</style>
