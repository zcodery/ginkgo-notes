<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Lock, LogOut } from 'lucide-vue-next'
import { pinLock } from '@/pinLock'
import { verifyPin } from '@/api/features'
import { displayName, logout } from '@/store'
import UserAvatar from './UserAvatar.vue'

const pin = ref('')
const error = ref('')
const busy = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

async function unlock() {
  if (busy.value || !pin.value) return
  busy.value = true
  error.value = ''
  try {
    await verifyPin(pin.value)
    pinLock.locked = false
    pin.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : '解锁失败'
    pin.value = ''
  } finally {
    busy.value = false
    void nextTick(() => inputRef.value?.focus())
  }
}

function onInput() {
  error.value = ''
  pin.value = pin.value.replace(/\D/g, '').slice(0, 8)
}

async function switchAccount() {
  pinLock.locked = false
  await logout()
}

watch(
  () => pinLock.locked,
  (v) => v && void nextTick(() => inputRef.value?.focus()),
)
onMounted(() => inputRef.value?.focus())
</script>

<template>
  <div class="pin-lock">
    <form class="pin-card gn-pop" @submit.prevent="unlock">
      <UserAvatar :size="56" :radius="28" />
      <div class="pin-name">{{ displayName }}</div>
      <div class="pin-hint"><Lock :size="12" :stroke-width="2" />已锁定，输入 PIN 码解锁</div>
      <input
        ref="inputRef"
        v-model="pin"
        class="pin-input"
        type="password"
        inputmode="numeric"
        autocomplete="off"
        maxlength="8"
        placeholder="••••"
        @input="onInput"
      />
      <p class="pin-err">{{ error }}</p>
      <button type="submit" class="pin-btn" :disabled="busy || pin.length < 4">解锁</button>
      <button type="button" class="pin-link" @click="switchAccount">
        <LogOut :size="12" :stroke-width="2" />忘记 PIN？退出登录
      </button>
    </form>
  </div>
</template>

<style scoped>
.pin-lock {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--gn-bg-sidebar) 82%, transparent);
  backdrop-filter: blur(18px);
}
.pin-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: min(320px, calc(100vw - 32px));
  padding: 28px 24px 18px;
  border: 1px solid var(--gn-border);
  border-radius: 16px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
}
.pin-name {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 600;
}
.pin-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--gn-text-muted);
}
.pin-input {
  width: 100%;
  height: 42px;
  margin-top: 10px;
  border: 1px solid var(--gn-border-strong);
  border-radius: 9px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 22px;
  letter-spacing: 0.5em;
  text-align: center;
  outline: none;
}
.pin-input:focus {
  border-color: var(--gn-accent);
}
.pin-err {
  min-height: 16px;
  margin: 0;
  font-size: 12px;
  color: var(--gn-danger);
}
.pin-btn {
  width: 100%;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: var(--gn-text);
  color: var(--gn-bg);
  font-size: 13.5px;
  cursor: pointer;
}
.pin-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.pin-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  border: none;
  background: none;
  color: var(--gn-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.pin-link:hover {
  color: var(--gn-text-soft);
}
</style>
