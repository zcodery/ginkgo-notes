<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Sparkles, Zap } from 'lucide-vue-next'
import { errorText, getAiConfig, saveAiConfig, streamChat, type AiConfigInfo } from '@/api/features'

const emit = defineEmits<{ (e: 'toast', type: 'ok' | 'err', text: string): void }>()

const PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' },
]

const cfg = ref<AiConfigInfo | null>(null)
const form = ref({ baseUrl: '', apiKey: '', model: '' })
const saving = ref(false)
const testing = ref(false)
const testOutput = ref('')

async function load() {
  cfg.value = await getAiConfig()
  form.value = { baseUrl: cfg.value.baseUrl, apiKey: '', model: cfg.value.model }
}

function usePreset(p: (typeof PRESETS)[number]) {
  form.value.baseUrl = p.baseUrl
  form.value.model = p.model
}

async function save() {
  saving.value = true
  try {
    await saveAiConfig({
      baseUrl: form.value.baseUrl,
      model: form.value.model,
      ...(form.value.apiKey ? { apiKey: form.value.apiKey } : {}),
    })
    await load()
    emit('toast', 'ok', '已保存')
  } catch (e) {
    emit('toast', 'err', errorText(e))
  } finally {
    saving.value = false
  }
}

async function clearKey() {
  if (!window.confirm('清除已保存的 API Key？')) return
  await saveAiConfig({ apiKey: '' })
  await load()
}

async function test() {
  testing.value = true
  testOutput.value = ''
  try {
    await streamChat([{ role: 'user', content: '用一句话介绍你自己。' }], (_d, full) => (testOutput.value = full))
    emit('toast', 'ok', '连接成功')
  } catch (e) {
    testOutput.value = ''
    emit('toast', 'err', errorText(e))
  } finally {
    testing.value = false
  }
}

onMounted(() => load().catch((e) => emit('toast', 'err', errorText(e))))
</script>

<template>
  <p class="pf-row-desc">
    在正文中选中文字，点浮动工具条上的 <b>AI</b> 可以润色、精简、扩写、翻译、总结；输入 <code>/ai</code> 让 AI 写作，<code>/xx</code> 续写；
    页面右上角「更多」里可以对整篇笔记做总结或翻译。支持任意 OpenAI 兼容接口。
  </p>

  <div v-if="cfg" class="ai-status" :class="cfg.source">
    <Sparkles :size="13" :stroke-width="2" />
    <template v-if="cfg.source === 'user'">正在使用你自己的配置</template>
    <template v-else-if="cfg.source === 'server'">正在使用服务端提供的默认模型；填写下方配置可改用自己的</template>
    <template v-else>尚未配置模型，AI 功能暂不可用</template>
  </div>

  <div class="pf-section-head"><div class="pf-sub">模型配置</div></div>
  <div class="ai-presets">
    <span class="pf-row-desc">快速填入：</span>
    <button v-for="p in PRESETS" :key="p.label" type="button" class="pf-btn" @click="usePreset(p)">{{ p.label }}</button>
  </div>
  <div class="pf-block">
    <div class="pf-label">接口地址（Base URL）</div>
    <input v-model="form.baseUrl" class="pf-input" placeholder="https://api.openai.com/v1" />
  </div>
  <div class="pf-block">
    <div class="pf-label">API Key{{ cfg?.hasKey ? `（已保存 ${cfg.keyHint}，留空则不修改）` : '' }}</div>
    <div class="pf-copy">
      <input v-model="form.apiKey" class="pf-input" type="password" autocomplete="off" placeholder="sk-..." />
      <button v-if="cfg?.hasKey" type="button" class="pf-btn" @click="clearKey">清除</button>
    </div>
  </div>
  <div class="pf-block">
    <div class="pf-label">模型名称</div>
    <input v-model="form.model" class="pf-input" placeholder="gpt-4o-mini" />
  </div>
  <div class="ai-btns">
    <button type="button" class="pf-btn primary" :disabled="saving" @click="save">保存</button>
    <button type="button" class="pf-btn" :disabled="testing || cfg?.source === 'none'" @click="test"><Zap :size="12" :stroke-width="2" />测试连接</button>
  </div>
  <div v-if="testOutput || testing" class="ai-test">{{ testOutput || '请求中…' }}</div>
  <p class="pf-row-desc ai-note">API Key 只保存在服务器上，浏览器里不会出现完整密钥；请求经由银杏笔记服务端转发。</p>
</template>

<style scoped>
.ai-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 12.5px;
}
.ai-status.user,
.ai-status.server {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.ai-presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
}
.ai-btns {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.ai-test {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.ai-note {
  margin-top: 12px;
}
code {
  font-family: var(--gn-mono);
  font-size: 11.5px;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--gn-bg-hover);
}
</style>
