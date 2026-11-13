<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, Copy, KeyRound, Plus, RefreshCw, Send, Trash2, Webhook } from 'lucide-vue-next'
import SettingsModal from './SettingsModal.vue'
import { copyText } from '@/utils/clipboard'
import GnSelect from '@/components/GnSelect.vue'
import {
  createToken,
  createWebhook,
  deleteToken,
  deleteWebhook,
  errorText,
  formatDateTime,
  listTokens,
  listWebhooks,
  testWebhook,
  updateWebhook,
  type ApiTokenInfo,
  type WebhookInfo,
} from '@/api/features'

const emit = defineEmits<{ (e: 'toast', type: 'ok' | 'err', text: string): void }>()
const fail = (e: unknown) => emit('toast', 'err', errorText(e))

const mcpUrl = `${window.location.origin}/api/mcp`
const copiedKey = ref('')

async function copy(text: string, key: string) {
  const ok = await copyText(text)
  if (!ok) {
    emit('toast', 'err', '复制失败')
    return
  }
  copiedKey.value = key
  window.setTimeout(() => copiedKey.value === key && (copiedKey.value = ''), 1500)
}

/* ---------------- 访问令牌 ---------------- */

const tokens = ref<ApiTokenInfo[]>([])
const tokenDialog = ref(false)
const tokenForm = ref({ name: '', scope: 'read', days: '0' })
const newToken = ref<string>('')
const busy = ref(false)
const scopeOptions = [
  { value: 'read', label: '只读' },
  { value: 'write', label: '可读写' },
]
const dayOptions = [
  { value: '0', label: '永不过期' },
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: '365', label: '1 年' },
]

const sampleToken = computed(() => newToken.value || '<你的访问令牌>')
const cursorConfig = computed(() =>
  JSON.stringify(
    { mcpServers: { 'ginkgo-notes': { url: mcpUrl, headers: { Authorization: `Bearer ${sampleToken.value}` } } } },
    null,
    2,
  ),
)
const claudeConfig = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        'ginkgo-notes': {
          command: 'npx',
          args: ['-y', 'mcp-remote', mcpUrl, '--header', `Authorization: Bearer ${sampleToken.value}`],
        },
      },
    },
    null,
    2,
  ),
)
const configTab = ref<'cursor' | 'claude' | 'curl'>('cursor')
const curlExample = computed(
  () =>
    `curl -X POST ${mcpUrl} \\\n  -H "Authorization: Bearer ${sampleToken.value}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_pages","arguments":{"query":"会议"}}}'`,
)
const configText = computed(() =>
  configTab.value === 'cursor' ? cursorConfig.value : configTab.value === 'claude' ? claudeConfig.value : curlExample.value,
)

async function addToken() {
  busy.value = true
  try {
    const t = await createToken(tokenForm.value.name.trim(), tokenForm.value.scope as 'read' | 'write', Number(tokenForm.value.days))
    newToken.value = t.token ?? ''
    tokens.value = [t, ...tokens.value]
    tokenDialog.value = false
  } catch (e) {
    fail(e)
  } finally {
    busy.value = false
  }
}

async function removeToken(t: ApiTokenInfo) {
  if (!window.confirm(`吊销令牌「${t.name}」？使用它的程序将立即失去访问权限。`)) return
  try {
    await deleteToken(t.id)
    tokens.value = tokens.value.filter((x) => x.id !== t.id)
  } catch (e) {
    fail(e)
  }
}

/* ---------------- Webhook ---------------- */

const EVENT_LABELS: Record<string, string> = {
  'page.created': '新建页面',
  'page.updated': '修改页面',
  'page.trashed': '移入回收站',
  'page.restored': '从回收站恢复',
  'page.deleted': '彻底删除',
}
const hooks = ref<WebhookInfo[]>([])
const events = ref<string[]>(Object.keys(EVENT_LABELS))
const hookDialog = ref(false)
const hookForm = ref({ url: '', events: ['page.created', 'page.updated'] as string[] })
const revealed = ref<Record<string, boolean>>({})

async function addHook() {
  busy.value = true
  try {
    const h = await createWebhook(hookForm.value.url.trim(), hookForm.value.events)
    hooks.value = [h, ...hooks.value]
    hookDialog.value = false
    hookForm.value = { url: '', events: ['page.created', 'page.updated'] }
  } catch (e) {
    fail(e)
  } finally {
    busy.value = false
  }
}

async function patchHook(h: WebhookInfo, patch: Parameters<typeof updateWebhook>[1]) {
  try {
    const next = await updateWebhook(h.id, patch)
    hooks.value = hooks.value.map((x) => (x.id === h.id ? next : x))
  } catch (e) {
    fail(e)
  }
}

async function test(h: WebhookInfo) {
  try {
    const next = await testWebhook(h.id)
    hooks.value = hooks.value.map((x) => (x.id === h.id ? next : x))
    emit('toast', next.lastError ? 'err' : 'ok', next.lastError ? `投递失败：${next.lastError}` : `投递成功（HTTP ${next.lastStatus}）`)
  } catch (e) {
    fail(e)
  }
}

async function removeHook(h: WebhookInfo) {
  if (!window.confirm(`删除 Webhook ${h.url}？`)) return
  try {
    await deleteWebhook(h.id)
    hooks.value = hooks.value.filter((x) => x.id !== h.id)
  } catch (e) {
    fail(e)
  }
}

onMounted(async () => {
  try {
    const [t, w] = await Promise.all([listTokens(), listWebhooks()])
    tokens.value = t
    hooks.value = w.items
    events.value = w.events
  } catch (e) {
    fail(e)
  }
})
</script>

<template>
  <!-- MCP -->
  <div class="pf-section-head"><div class="pf-sub">MCP 服务</div></div>
  <p class="pf-row-desc">
    Cursor、Claude 等支持 MCP 的 AI 工具可以通过下面的地址检索、阅读、新建和修改你的笔记。提供
    search_pages / list_pages / read_page / create_page / update_page / trash_page 六个工具。
  </p>
  <div class="pf-copy ig-url">
    <input class="pf-input" :value="mcpUrl" readonly />
    <button type="button" class="pf-btn" @click="copy(mcpUrl, 'url')">
      <component :is="copiedKey === 'url' ? Check : Copy" :size="12" :stroke-width="2" />复制
    </button>
  </div>
  <div class="ig-tabs">
    <button type="button" :class="{ on: configTab === 'cursor' }" @click="configTab = 'cursor'">Cursor</button>
    <button type="button" :class="{ on: configTab === 'claude' }" @click="configTab = 'claude'">Claude Desktop</button>
    <button type="button" :class="{ on: configTab === 'curl' }" @click="configTab = 'curl'">curl</button>
    <span class="pf-grow"></span>
    <button type="button" class="pf-btn" @click="copy(configText, 'cfg')">
      <component :is="copiedKey === 'cfg' ? Check : Copy" :size="12" :stroke-width="2" />复制配置
    </button>
  </div>
  <pre class="ig-code">{{ configText }}</pre>
  <p class="pf-row-desc">
    {{ configTab === 'cursor' ? '写入项目的 .cursor/mcp.json 或全局 ~/.cursor/mcp.json。' : configTab === 'claude' ? '写入 claude_desktop_config.json（需本机安装 Node.js）。' : '也可以直接用 HTTP 调用。' }}
    令牌在下方创建；只读令牌无法调用写入类工具。
  </p>

  <!-- 令牌 -->
  <div class="pf-section-head">
    <div class="pf-sub">个人访问令牌</div>
    <button type="button" class="pf-btn" @click="tokenForm = { name: '', scope: 'read', days: '0' }; tokenDialog = true">
      <Plus :size="12" :stroke-width="2" />新建令牌
    </button>
  </div>
  <div v-if="newToken" class="ig-new">
    <div class="pf-row-title">令牌已创建，只显示这一次，请立即复制保存：</div>
    <div class="pf-copy">
      <input class="pf-input pf-mono" :value="newToken" readonly @focus="($event.target as HTMLInputElement).select()" />
      <button type="button" class="pf-btn primary" @click="copy(newToken, 'tok')">
        <component :is="copiedKey === 'tok' ? Check : Copy" :size="12" :stroke-width="2" />复制
      </button>
    </div>
  </div>
  <div v-if="!tokens.length" class="pf-empty">还没有访问令牌</div>
  <div v-else class="pf-list">
    <div v-for="t in tokens" :key="t.id" class="pf-list-item">
      <KeyRound :size="15" :stroke-width="1.7" class="pf-list-icon" />
      <div class="pf-list-main">
        <div class="pf-list-title">
          {{ t.name }}<span class="pf-tag" :class="{ admin: t.scope === 'write' }">{{ t.scope === 'write' ? '可读写' : '只读' }}</span>
        </div>
        <div class="pf-row-desc">
          <span class="pf-mono">{{ t.prefix }}…</span> · 创建于 {{ formatDateTime(t.createdAt) }} ·
          {{ t.lastUsedAt ? `最近使用 ${formatDateTime(t.lastUsedAt)}` : '从未使用' }}
          {{ t.expiresAt ? ` · ${formatDateTime(t.expiresAt)} 过期` : '' }}
        </div>
      </div>
      <button type="button" class="gn-icon-btn" v-tooltip="'吊销'" @click="removeToken(t)"><Trash2 :size="14" /></button>
    </div>
  </div>

  <!-- Webhook -->
  <div class="pf-section-head">
    <div class="pf-sub">Webhook</div>
    <button type="button" class="pf-btn" @click="hookDialog = true"><Plus :size="12" :stroke-width="2" />添加</button>
  </div>
  <p class="pf-row-desc">
    页面变更时向你的地址 POST 一条 JSON。请求头 X-Ginkgo-Signature 为 sha256=HMAC(密钥, 请求体)，可用于校验来源；同一页面的修改事件 5 秒内合并为一次。
  </p>
  <div v-if="!hooks.length" class="pf-empty">还没有 Webhook</div>
  <div v-else class="pf-list">
    <div v-for="h in hooks" :key="h.id" class="pf-list-item ig-hook">
      <Webhook :size="15" :stroke-width="1.7" class="pf-list-icon" />
      <div class="pf-list-main">
        <div class="pf-list-title">{{ h.url }}</div>
        <div class="pf-row-desc">{{ h.events.map((e) => EVENT_LABELS[e] ?? e).join('、') }}</div>
        <div class="pf-row-desc">
          <template v-if="h.lastAt">
            最近投递 {{ formatDateTime(h.lastAt) }} ·
            <span :class="h.lastError ? 'ig-bad' : 'ig-ok'">{{ h.lastError ?? `HTTP ${h.lastStatus}` }}</span>
          </template>
          <template v-else>尚未投递</template>
        </div>
        <div class="pf-row-desc">
          密钥：<span class="pf-mono">{{ revealed[h.id] ? h.secret : 'whsec_••••••••' }}</span>
          <button type="button" class="pf-link ig-mini" @click="revealed[h.id] = !revealed[h.id]">{{ revealed[h.id] ? '隐藏' : '显示' }}</button>
          <button type="button" class="pf-link ig-mini" @click="copy(h.secret, h.id)">{{ copiedKey === h.id ? '已复制' : '复制' }}</button>
          <button type="button" class="pf-link ig-mini" @click="patchHook(h, { rotateSecret: true })"><RefreshCw :size="10" />重新生成</button>
        </div>
      </div>
      <div class="ig-hook-actions">
        <button type="button" class="pf-switch" :class="{ on: h.enabled }" @click="patchHook(h, { enabled: !h.enabled })"><i></i></button>
        <button type="button" class="gn-icon-btn" v-tooltip="'发送测试事件'" @click="test(h)"><Send :size="14" /></button>
        <button type="button" class="gn-icon-btn" v-tooltip="'删除'" @click="removeHook(h)"><Trash2 :size="14" /></button>
      </div>
    </div>
  </div>

  <SettingsModal v-if="tokenDialog" title="新建访问令牌" @close="tokenDialog = false">
    <label>名称<input v-model="tokenForm.name" maxlength="60" placeholder="例如：Cursor MCP" @keydown.enter="addToken" /></label>
    <div class="ig-form-row">
      <span>权限</span>
      <GnSelect v-model="tokenForm.scope" :options="scopeOptions" :min-width="110" />
    </div>
    <div class="ig-form-row">
      <span>有效期</span>
      <GnSelect v-model="tokenForm.days" :options="dayOptions" :min-width="110" />
    </div>
    <footer>
      <button type="button" class="pf-btn" @click="tokenDialog = false">取消</button>
      <button type="button" class="pf-btn primary" :disabled="busy" @click="addToken">创建</button>
    </footer>
  </SettingsModal>

  <SettingsModal v-if="hookDialog" title="添加 Webhook" :width="420" @close="hookDialog = false">
    <label>接收地址<input v-model="hookForm.url" placeholder="https://example.com/hooks/ginkgo" /></label>
    <div class="pf-row-desc">触发事件</div>
    <div class="pf-checks">
      <label v-for="e in events" :key="e">
        <input v-model="hookForm.events" type="checkbox" :value="e" />{{ EVENT_LABELS[e] ?? e }}
      </label>
    </div>
    <footer>
      <button type="button" class="pf-btn" @click="hookDialog = false">取消</button>
      <button type="button" class="pf-btn primary" :disabled="busy || !hookForm.url.trim() || !hookForm.events.length" @click="addHook">添加</button>
    </footer>
  </SettingsModal>
</template>

<style scoped>
.ig-url {
  margin: 8px 0;
}
.ig-url .pf-input {
  height: 30px;
  font-family: var(--gn-mono);
  font-size: 12px;
}
.ig-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ig-tabs > button:not(.pf-btn) {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.ig-tabs > button.on {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.ig-code {
  margin: 6px 0;
  padding: 10px 12px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg-code);
  font-family: var(--gn-mono);
  font-size: 11.5px;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre;
}
.ig-new {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--gn-accent) 40%, transparent);
  border-radius: 8px;
  background: var(--gn-accent-soft);
}
.ig-new .pf-input {
  height: 30px;
}
.ig-hook {
  align-items: flex-start;
}
.ig-hook-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.ig-ok {
  color: var(--gn-accent);
}
.ig-bad {
  color: var(--gn-danger);
}
.ig-mini {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.ig-form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--gn-text-muted);
}
</style>
