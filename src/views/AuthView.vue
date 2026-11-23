<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Eye, EyeOff, Loader2, Moon, Sun } from 'lucide-vue-next'
import { goToPage, login, loginTwoFactor, register, store, toggleTheme } from '@/store'
import { authProviders } from '@/api/features'
import { LOCALES, locale, setLocale, t, type LocaleCode } from '@/i18n'
import GnSelect from '@/components/GnSelect.vue'
import BrandMark from '@/components/BrandMark.vue'

const localeOptions = LOCALES.map((l) => ({ value: l.code, label: l.label }))
const localeValue = computed({
  get: () => locale.value,
  set: (v: string) => setLocale(v as LocaleCode),
})

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

const title = computed(() => (mode.value === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')))
const submitLabel = computed(() =>
  mode.value === 'login' ? t('auth.submitLogin') : t('auth.submitRegister'),
)

function switchMode(next: Mode) {
  mode.value = next
  error.value = ''
  confirm.value = ''
  void nextTick(() => usernameRef.value?.focus())
}

function validate(): string {
  const name = username.value.trim()
  if (!name) return t('auth.errUsernameRequired')
  if (!password.value) return t('auth.errPasswordRequired')
  if (mode.value === 'register') {
    if (!USERNAME_RE.test(name)) return t('auth.errUsernameInvalid')
    if (password.value.length < 6) return t('auth.errPasswordShort')
    if (password.value !== confirm.value) return t('auth.errPasswordMismatch')
  }
  return ''
}

/** 两步验证：密码通过后拿到的票据；非空时表单切成输入动态码 */
const ticket = ref('')
const code = ref('')
const codeRef = ref<HTMLInputElement | null>(null)
const githubEnabled = ref(false)

async function submitCode() {
  if (!/^\d{6}$/.test(code.value.trim())) {
    error.value = t('auth.errCode')
    return
  }
  busy.value = true
  try {
    await loginTwoFactor(ticket.value, code.value.trim())
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('auth.errFailed')
    if (/超时|过期/.test(error.value)) ticket.value = ''
  } finally {
    busy.value = false
  }
}

function backToPassword() {
  ticket.value = ''
  code.value = ''
  error.value = ''
}

async function submit() {
  if (busy.value) return
  if (ticket.value) return submitCode()
  error.value = validate()
  if (error.value) return
  busy.value = true
  try {
    const name = username.value.trim()
    if (mode.value === 'login') {
      const need = await login(name, password.value)
      if (need) {
        ticket.value = need.ticket
        code.value = ''
        void nextTick(() => codeRef.value?.focus())
      }
    } else {
      await register(name, password.value)
      // 新用户直接落到系统发给他的第一篇示例笔记
      const first = store.pages
        .filter((p) => !p.trashed && !p.parentId)
        .sort((a, b) => a.order - b.order)[0]
      if (first) goToPage(first.id)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('auth.errFailed')
  } finally {
    busy.value = false
  }
}

watch([username, password, confirm, code], () => {
  error.value = ''
})

onMounted(() => {
  usernameRef.value?.focus()
  const q = new URLSearchParams(window.location.search)
  const oauthErr = q.get('oauth_error')
  const oauth2fa = q.get('oauth_2fa')
  if (oauthErr) error.value = oauthErr
  if (oauth2fa) {
    ticket.value = oauth2fa
    void nextTick(() => codeRef.value?.focus())
  }
  if (oauthErr || oauth2fa) history.replaceState(null, '', window.location.pathname)
  authProviders()
    .then((p) => (githubEnabled.value = p.github))
    .catch(() => undefined)
})
</script>

<template>
  <div class="auth">
    <div class="auth-lang">
      <GnSelect v-model="localeValue" :options="localeOptions" :min-width="112" />
    </div>
    <button
      class="gn-icon-btn auth-theme"
      v-tooltip="store.theme === 'dark' ? t('auth.light') : t('auth.dark')"
      @click="toggleTheme"
    >
      <component :is="store.theme === 'dark' ? Sun : Moon" :size="15" :stroke-width="1.8" />
    </button>

    <div class="auth-card gn-pop">
      <div class="auth-brand">
        <span class="auth-logo" aria-hidden="true"><BrandMark :size="20" /></span>
        <span class="auth-name">{{ t('app.name') }}</span>
      </div>

      <template v-if="ticket">
        <h1 class="auth-title">{{ t('auth.twoFactorTitle') }}</h1>
        <p class="auth-sub">{{ t('auth.twoFactorSub') }}</p>
        <form class="auth-form" @submit.prevent="submit">
          <label class="auth-field">
            <span>{{ t('auth.code') }}</span>
            <input
              ref="codeRef"
              v-model="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              class="auth-code"
              placeholder="000000"
            />
          </label>
          <p v-if="error" class="auth-error">{{ error }}</p>
          <button type="submit" class="auth-submit" :disabled="busy">
            <Loader2 v-if="busy" :size="15" class="auth-spin" />
            <span>{{ t('auth.verify') }}</span>
          </button>
        </form>
        <p class="auth-switch">
          <button @click="backToPassword">{{ t('auth.backToPassword') }}</button>
        </p>
      </template>

      <template v-else>
      <h1 class="auth-title">{{ title }}</h1>
      <p class="auth-sub">
        {{ mode === 'login' ? t('auth.loginSub') : t('auth.registerSub') }}
      </p>

      <div class="auth-tabs" role="tablist">
        <button
          role="tab"
          :aria-selected="mode === 'login'"
          :class="{ on: mode === 'login' }"
          @click="switchMode('login')"
        >
          {{ t('auth.login') }}
        </button>
        <button
          role="tab"
          :aria-selected="mode === 'register'"
          :class="{ on: mode === 'register' }"
          @click="switchMode('register')"
        >
          {{ t('auth.register') }}
        </button>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label class="auth-field">
          <span>{{ t('auth.username') }}</span>
          <input
            ref="usernameRef"
            v-model="username"
            autocomplete="username"
            maxlength="24"
            :placeholder="mode === 'register' ? t('auth.usernameRule') : t('auth.usernamePlaceholder')"
          />
        </label>

        <label class="auth-field">
          <span>{{ t('auth.password') }}</span>
          <div class="auth-pw">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              maxlength="128"
              :placeholder="mode === 'register' ? t('auth.passwordRule') : t('auth.passwordPlaceholder')"
            />
            <button
              type="button"
              class="auth-eye"
              v-tooltip="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
              @click="showPassword = !showPassword"
            >
              <component :is="showPassword ? EyeOff : Eye" :size="15" :stroke-width="1.8" />
            </button>
          </div>
        </label>

        <label v-if="mode === 'register'" class="auth-field">
          <span>{{ t('auth.confirmPassword') }}</span>
          <input
            v-model="confirm"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            maxlength="128"
            :placeholder="t('auth.confirmPlaceholder')"
          />
        </label>

        <p v-if="error" class="auth-error">{{ error }}</p>

        <button type="submit" class="auth-submit" :disabled="busy">
          <Loader2 v-if="busy" :size="15" class="auth-spin" />
          <span>{{ submitLabel }}</span>
        </button>
      </form>

      <a v-if="githubEnabled && mode === 'login'" class="auth-github" href="/api/auth/github/login">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        <span>{{ t('auth.githubLogin') }}</span>
      </a>

      <p class="auth-switch">
        <template v-if="mode === 'login'">
          {{ t('auth.noAccount') }}<button @click="switchMode('register')">{{ t('auth.registerNow') }}</button>
        </template>
        <template v-else>
          {{ t('auth.haveAccount') }}<button @click="switchMode('login')">{{ t('auth.goLogin') }}</button>
        </template>
      </p>
      </template>
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
.auth-lang {
  position: absolute;
  top: 14px;
  right: 50px;
  z-index: 2;
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
  display: flex;
  width: 20px;
  height: 20px;
  color: var(--gn-accent);
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
  color: var(--gn-accent-ink);
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
.auth-code {
  letter-spacing: 0.4em;
  font-size: 18px !important;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.auth-github {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 38px;
  margin-top: 10px;
  border: 1px solid var(--gn-border-strong);
  border-radius: 8px;
  color: var(--gn-text);
  font-size: 13.5px;
  text-decoration: none;
  transition: background 0.12s ease;
}
.auth-github:hover {
  background: var(--gn-bg-hover);
}
</style>
