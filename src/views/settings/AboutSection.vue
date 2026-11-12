<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { MessageSquare, RefreshCw, Send } from 'lucide-vue-next'
import SettingsModal from './SettingsModal.vue'
import {
  errorText,
  fetchServerVersion,
  formatDateTime,
  listAllFeedback,
  listMyFeedback,
  replyFeedback,
  sendFeedback,
  type FeedbackInfo,
} from '@/api/features'
import { isAdmin } from '@/store'

const props = defineProps<{ version: string }>()
const emit = defineEmits<{ (e: 'toast', type: 'ok' | 'err', text: string): void }>()

/* ---------------- 检查更新 ---------------- */

const checking = ref(false)
const serverVersion = ref('')

function reloadPage() {
  window.location.reload()
}

async function check() {
  checking.value = true
  try {
    serverVersion.value = await fetchServerVersion()
    if (serverVersion.value === props.version) emit('toast', 'ok', '已是最新版本')
  } catch (e) {
    emit('toast', 'err', errorText(e, '检查失败'))
  } finally {
    checking.value = false
  }
}

/* ---------------- 意见反馈 ---------------- */

const feedbackOpen = ref(false)
const form = ref({ content: '', contact: '' })
const sending = ref(false)
const mine = ref<FeedbackInfo[]>([])
const all = ref<FeedbackInfo[]>([])
const replyDraft = ref<Record<string, string>>({})

async function submit() {
  sending.value = true
  try {
    const f = await sendFeedback(form.value.content.trim(), form.value.contact.trim())
    mine.value = [f, ...mine.value]
    form.value = { content: '', contact: '' }
    feedbackOpen.value = false
    emit('toast', 'ok', '感谢反馈，我们会尽快处理')
  } catch (e) {
    emit('toast', 'err', errorText(e))
  } finally {
    sending.value = false
  }
}

async function reply(f: FeedbackInfo) {
  const text = replyDraft.value[f.id]?.trim()
  if (!text) return
  try {
    const next = await replyFeedback(f.id, text)
    all.value = all.value.map((x) => (x.id === f.id ? next : x))
    replyDraft.value[f.id] = ''
    emit('toast', 'ok', '已回复，用户会收到通知')
  } catch (e) {
    emit('toast', 'err', errorText(e))
  }
}

onMounted(async () => {
  try {
    mine.value = await listMyFeedback()
    if (isAdmin.value) all.value = await listAllFeedback()
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">检查更新</div>
      <div class="pf-row-desc">
        <template v-if="serverVersion && serverVersion !== version">服务器已更新到 {{ serverVersion }}，刷新页面即可使用新版本</template>
        <template v-else>当前版本 {{ version }}；服务端更新后会自动在页面底部提示</template>
      </div>
    </div>
    <button v-if="serverVersion && serverVersion !== version" type="button" class="pf-btn primary" @click="reloadPage">
      刷新
    </button>
    <button v-else type="button" class="pf-btn" :disabled="checking" @click="check">
      <RefreshCw :size="12" :stroke-width="2" :class="{ 'ab-spin': checking }" />检查
    </button>
  </div>

  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">意见反馈</div>
      <div class="pf-row-desc">告诉我们你遇到的问题或想要的功能，回复会通过站内通知送达</div>
    </div>
    <button type="button" class="pf-btn" @click="feedbackOpen = true"><MessageSquare :size="12" :stroke-width="2" />反馈</button>
  </div>

  <template v-if="mine.length">
    <div class="pf-sub ab-sub">我的反馈</div>
    <div class="pf-list">
      <div v-for="f in mine" :key="f.id" class="pf-list-item ab-item">
        <div class="pf-list-main">
          <div class="ab-content">{{ f.content }}</div>
          <div class="pf-row-desc">{{ formatDateTime(f.createdAt) }}</div>
          <div v-if="f.reply" class="ab-reply"><b>回复：</b>{{ f.reply }}</div>
        </div>
      </div>
    </div>
  </template>

  <template v-if="isAdmin">
    <div class="pf-sub ab-sub">全部反馈（管理员）</div>
    <div v-if="!all.length" class="pf-empty">还没有收到反馈</div>
    <div v-else class="pf-list">
      <div v-for="f in all" :key="f.id" class="pf-list-item ab-item">
        <div class="pf-list-main">
          <div class="pf-list-title">{{ f.user?.name ?? '已注销用户' }}<span class="pf-row-desc">{{ formatDateTime(f.createdAt) }}</span></div>
          <div class="ab-content">{{ f.content }}</div>
          <div v-if="f.contact" class="pf-row-desc">联系方式：{{ f.contact }}</div>
          <div v-if="f.reply" class="ab-reply"><b>已回复：</b>{{ f.reply }}</div>
          <div v-else class="pf-copy ab-reply-form">
            <input v-model="replyDraft[f.id]" placeholder="回复该用户…" @keydown.enter="reply(f)" />
            <button type="button" class="pf-btn" @click="reply(f)"><Send :size="12" :stroke-width="2" />回复</button>
          </div>
        </div>
      </div>
    </div>
  </template>

  <SettingsModal v-if="feedbackOpen" title="意见反馈" :width="440" @close="feedbackOpen = false">
    <label>问题或建议<textarea v-model="form.content" rows="6" maxlength="4000" placeholder="请尽量描述清楚：在什么页面、做了什么操作、期望的结果是什么"></textarea></label>
    <label>联系方式（选填）<input v-model="form.contact" maxlength="120" placeholder="邮箱 / 微信等" /></label>
    <footer>
      <button type="button" class="pf-btn" @click="feedbackOpen = false">取消</button>
      <button type="button" class="pf-btn primary" :disabled="sending || form.content.trim().length < 4" @click="submit">提交</button>
    </footer>
  </SettingsModal>
</template>

<style scoped>
.ab-sub {
  margin: 18px 0 6px;
}
.ab-item {
  align-items: flex-start;
}
.ab-content {
  font-size: 13px;
  line-height: 1.55;
  color: var(--gn-text);
  white-space: pre-wrap;
  word-break: break-word;
}
.ab-reply {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--gn-accent-soft);
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.ab-reply-form {
  margin-top: 6px;
}
.ab-reply-form input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12.5px;
  outline: none;
}
.ab-spin {
  animation: gn-spin 0.9s linear infinite;
}
</style>
