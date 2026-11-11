<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Eye, EyeOff, Loader2, Moon, Sun } from 'lucide-vue-next'
import { goToPage, login, register, store, toggleTheme } from '@/store'

type Mode = 'login' | 'register'

const mode = ref<Mode>('login')
const username = ref('')
const password = ref('')
const confirm = ref('')
const showPassword = ref(false)
const busy = ref(false)
const error = ref('')
const usernameRef = ref<HTMLInputElement | null>(null)

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,24}$/

const title = computed(() => (mode.value === 'login' ? '登录银杏笔记' : '创建账号'))
const submitLabel = computed(() => (mode.value === 'login' ? '登录' : '注册并开始使用'))

function switchMode(next: Mode) {
  mode.value = next
  error.value = ''
  confirm.value = ''
  void nextTick(() => usernameRef.value?.focus())
}

function validate(): string {
  const name = username.value.trim()
  if (!name) return '请输入用户名'
  if (!password.value) return '请输入密码'
  if (mode.value === 'register') {
    if (!USERNAME_RE.test(name)) return '用户名需为 3-24 位字母、数字、下划线或中文'
    if (password.value.length < 6) return '密码至少 6 位'
    if (password.value !== confirm.value) return '两次输入的密码不一致'
  }
  return ''
}

async function submit() {
  if (busy.value) return
  error.value = validate()
  if (error.value) return
  busy.value = true
  try {
    const name = username.value.trim()
    if (mode.value === 'login') {
      await login(name, password.value)
    } else {
      await register(name, password.value)
      // 新用户直接落到系统发给他的第一篇示例笔记
      const first = store.pages
        .filter((p) => !p.trashed && !p.parentId)
        .sort((a, b) => a.order - b.order)[0]
      if (first) goToPage(first.id)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作失败，请稍后再试'
  } finally {
    busy.value = false
  }
}

watch([username, password, confirm], () => {
  error.value = ''
})

onMounted(() => usernameRef.value?.focus())
</script>

<template>
  <div class="auth">
    <button
      class="gn-icon-btn auth-theme"
      v-tooltip="store.theme === 'dark' ? '浅色' : '深色'"
      @click="toggleTheme"
    >
      <component :is="store.theme === 'dark' ? Sun : Moon" :size="15" :stroke-width="1.8" />
    </button>

    <div class="auth-card gn-pop">
      <div class="auth-brand">
        <span class="auth-logo">🍃</span>
        <span class="auth-name">银杏笔记</span>
      </div>

      <h1 class="auth-title">{{ title }}</h1>
      <p class="auth-sub">
        {{ mode === 'login' ? '欢迎回来，继续写下你的想法。' : '注册后会收到几篇示例笔记，随时可以删除。' }}
      </p>

      <div class="auth-tabs" role="tablist">
        <button
          role="tab"
          :aria-selected="mode === 'login'"
          :class="{ on: mode === 'login' }"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          role="tab"
          :aria-selected="mode === 'register'"
          :class="{ on: mode === 'register' }"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label class="auth-field">
          <span>用户名</span>
          <input
            ref="usernameRef"
            v-model="username"
            autocomplete="username"
            maxlength="24"
            :placeholder="mode === 'register' ? '3-24 位字母、数字、下划线或中文' : '请输入用户名'"
          />
        </label>

        <label class="auth-field">
          <span>密码</span>
          <div class="auth-pw">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              maxlength="128"
              :placeholder="mode === 'register' ? '至少 6 位' : '请输入密码'"
            />
            <button
              type="button"
              class="auth-eye"
              v-tooltip="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <component :is="showPassword ? EyeOff : Eye" :size="15" :stroke-width="1.8" />
            </button>
          </div>
        </label>

        <label v-if="mode === 'register'" class="auth-field">
          <span>确认密码</span>
          <input
            v-model="confirm"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            maxlength="128"
            placeholder="再输入一次密码"
          />
        </label>

        <p v-if="error" class="auth-error">{{ error }}</p>

        <button type="submit" class="auth-submit" :disabled="busy">
          <Loader2 v-if="busy" :size="15" class="auth-spin" />
          <span>{{ submitLabel }}</span>
        </button>
      </form>

      <p class="auth-switch">
        <template v-if="mode === 'login'">
          还没有账号？<button @click="switchMode('register')">立即注册</button>
        </template>
        <template v-else>
          已有账号？<button @click="switchMode('login')">去登录</button>
        </template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at 18% 12%, var(--gn-accent-soft), transparent 42%),
    radial-gradient(circle at 85% 90%, color-mix(in srgb, var(--gn-accent-soft) 70%, transparent), transparent 40%),
    var(--gn-bg-sidebar);
  overflow-y: auto;
}
.auth-theme {
  position: absolute;
  top: 14px;
  right: 14px;
}
.auth-card {
  width: 100%;
  max-width: 380px;
  padding: 30px 30px 24px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 14px;
  box-shadow: var(--gn-shadow-lg);
}
.auth-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 22px;
}
.auth-logo {
  font-size: 20px;
  line-height: 1;
}
.auth-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--gn-text-soft);
}
.auth-title {
  margin: 0;
  font-size: 22px;
  font-weight: 680;
  letter-spacing: -0.015em;
  color: var(--gn-text);
}
.auth-sub {
  margin: 6px 0 18px;
  font-size: 13px;
  color: var(--gn-text-muted);
}
.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  padding: 3px;
  margin-bottom: 18px;
  border-radius: 8px;
  background: var(--gn-bg-hover);
}
.auth-tabs button {
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.auth-tabs button.on {
  background: var(--gn-bg);
  color: var(--gn-text);
  box-shadow: var(--gn-shadow-sm);
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.auth-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.auth-field > span {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--gn-text-soft);
}
.auth-field input {
  width: 100%;
  height: 38px;
  padding: 0 11px;
  border: 1px solid var(--gn-border-strong);
  border-radius: 8px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.auth-field input::placeholder {
  color: var(--gn-text-muted);
  opacity: 0.8;
}
.auth-field input:focus {
  border-color: var(--gn-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gn-accent) 16%, transparent);
}
.auth-pw {
  position: relative;
}
.auth-pw input {
  padding-right: 38px;
}
.auth-eye {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.auth-eye:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.auth-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--gn-danger);
  background: color-mix(in srgb, var(--gn-danger) 10%, transparent);
}
.auth-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 40px;
  margin-top: 4px;
  border: none;
  border-radius: 8px;
  background: var(--gn-accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: filter 0.12s ease, opacity 0.12s ease;
}
html.dark .auth-submit {
  color: #10241a;
}
.auth-submit:hover:not(:disabled) {
  filter: brightness(1.08);
}
.auth-submit:disabled {
  opacity: 0.65;
  cursor: default;
}
.auth-spin {
  animation: auth-spin 0.8s linear infinite;
}
@keyframes auth-spin {
  to {
    transform: rotate(360deg);
  }
}
.auth-switch {
  margin: 16px 0 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
.auth-switch button {
  padding: 0;
  border: none;
  background: none;
  color: var(--gn-accent);
  font-size: inherit;
  font-weight: 500;
  cursor: pointer;
}
.auth-switch button:hover {
  text-decoration: underline;
}
</style>
