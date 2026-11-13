<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Copy, ExternalLink, Lock, Trash2 } from 'lucide-vue-next'
import PageIcon from '@/components/PageIcon.vue'
import { deleteShare, errorText, formatDateTime, listShares, shareUrl, type ShareInfo } from '@/api/features'
import { goToPage, store } from '@/store'
import { copyText } from '@/utils/clipboard'

const emit = defineEmits<{ (e: 'toast', type: 'ok' | 'err', text: string): void }>()

const shares = ref<ShareInfo[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    shares.value = await listShares()
  } catch (e) {
    emit('toast', 'err', errorText(e))
  } finally {
    loading.value = false
  }
}

async function copy(s: ShareInfo) {
  const ok = await copyText(shareUrl(s.token))
  emit('toast', ok ? 'ok' : 'err', ok ? '链接已复制' : '复制失败')
}

async function revoke(s: ShareInfo) {
  if (!window.confirm(`取消「${s.pageTitle || '未命名'}」的公开分享？链接会立即失效。`)) return
  try {
    await deleteShare(s.id)
    shares.value = shares.value.filter((x) => x.id !== s.id)
    emit('toast', 'ok', '已取消分享')
  } catch (e) {
    emit('toast', 'err', errorText(e))
  }
}

function open(s: ShareInfo) {
  store.settingsOpen = false
  goToPage(s.pageId)
}

function expired(s: ShareInfo) {
  return !!s.expiresAt && s.expiresAt < Date.now()
}

onMounted(load)
</script>

<template>
  <p class="pf-row-desc">
    在任意页面右上角「分享」中开启公开链接，可设置访问密码、有效期以及是否包含子页面。这里统一查看和撤销所有已分享的页面。
  </p>

  <div class="pf-section-head">
    <div class="pf-sub">已分享的页面（{{ shares.length }}）</div>
  </div>

  <div v-if="loading" class="pf-empty">加载中…</div>
  <div v-else-if="!shares.length" class="pf-empty">还没有公开分享任何页面</div>
  <div v-else class="pf-list">
    <div v-for="s in shares" :key="s.id" class="pf-list-item">
      <PageIcon :icon="s.pageIcon" :size="16" />
      <div class="pf-list-main">
        <div class="pf-list-title">
          <button type="button" class="pf-link" @click="open(s)">{{ s.pageTitle || '未命名' }}</button>
          <Lock v-if="s.hasPassword" :size="11" :stroke-width="2.2" v-tooltip="'需要访问密码'" />
          <span v-if="expired(s)" class="pf-tag">已过期</span>
        </div>
        <div class="pf-row-desc">
          访问 {{ s.views }} 次 · {{ s.expiresAt ? `${formatDateTime(s.expiresAt)} 失效` : '永久有效' }}
          {{ s.includeChildren ? '· 含子页面' : '' }}
        </div>
      </div>
      <button type="button" class="gn-icon-btn" v-tooltip="'复制链接'" @click="copy(s)"><Copy :size="14" /></button>
      <a class="gn-icon-btn" :href="shareUrl(s.token)" target="_blank" rel="noopener" v-tooltip="'打开'"><ExternalLink :size="14" /></a>
      <button type="button" class="gn-icon-btn" v-tooltip="'取消分享'" @click="revoke(s)"><Trash2 :size="14" /></button>
    </div>
  </div>
</template>

<style>
.pf-link {
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pf-link:hover {
  text-decoration: underline;
}
</style>
