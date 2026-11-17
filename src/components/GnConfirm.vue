<script setup lang="ts">
/**
 * 系统公用二次确认弹窗。
 *
 * 为什么不继续用行内「确认 / 取消」：行内确认会被右键菜单、悬停态、列表滚动带跑，
 * 而且危险操作的按钮离手太近，容易连点。这里统一成一个居中弹窗，遮罩挡住背景，
 * 危险项默认把焦点放在「取消」上，误按回车不会执行。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { AlertTriangle, Trash2 } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    /** 主说明，一两句话讲清楚会发生什么 */
    message?: string
    /** 补充说明：不可逆的后果、会影响到谁 */
    detail?: string
    confirmText?: string
    cancelText?: string
    /** danger 用红色填充按钮，并默认聚焦「取消」 */
    tone?: 'primary' | 'danger'
    /** 图标：提醒用 alert，删除类用 trash */
    icon?: 'alert' | 'trash'
    /** 需要放预览表格等内容时加宽弹窗 */
    wide?: boolean
    /** 没有可确认内容时禁用确认按钮 */
    confirmDisabled?: boolean
  }>(),
  {
    message: '',
    detail: '',
    confirmText: '确认',
    cancelText: '取消',
    tone: 'primary',
    icon: 'alert',
    wide: false,
    confirmDisabled: false,
  },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const okRef = ref<HTMLButtonElement | null>(null)
const cancelRef = ref<HTMLButtonElement | null>(null)
const iconComp = computed(() => (props.icon === 'trash' ? Trash2 : AlertTriangle))

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('cancel')
  }
}

watch(
  () => props.open,
  async (v) => {
    if (v) {
      document.addEventListener('keydown', onKey, true)
      await nextTick()
      // 危险操作别把焦点放在确认上
      if (props.tone === 'danger') cancelRef.value?.focus()
      else okRef.value?.focus()
    } else {
      document.removeEventListener('keydown', onKey, true)
    }
  },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="gcf">
      <div v-if="open" class="gcf-mask" @mousedown.self="emit('cancel')">
        <div class="gcf-card" :class="[tone, { wide }]" role="dialog" aria-modal="true" :aria-label="title">
          <div class="gcf-card-main">
            <span class="gcf-icon" :class="tone"><component :is="iconComp" :size="15" /></span>
            <div class="gcf-text">
              <div class="gcf-title">{{ title }}</div>
              <p v-if="message" class="gcf-msg">{{ message }}</p>
              <p v-if="detail" class="gcf-detail">{{ detail }}</p>
            </div>
          </div>
          <div v-if="$slots.body" class="gcf-body"><slot name="body" /></div>
          <div class="gcf-ops">
            <button ref="cancelRef" type="button" class="gcf-btn" @click="emit('cancel')">
              {{ cancelText }}
            </button>
            <button
              ref="okRef"
              type="button"
              class="gcf-btn"
              :class="tone"
              :disabled="confirmDisabled"
              @click="emit('confirm')"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.gcf-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 15, 14, 0.34);
  backdrop-filter: blur(1.5px);
}
.gcf-card {
  width: 100%;
  max-width: 380px;
  padding: 18px 18px 14px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
}
.gcf-card.wide {
  max-width: 540px;
}
.gcf-body {
  margin-top: 12px;
}
.gcf-card-main {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}
.gcf-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: 8px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.gcf-icon.danger {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
  color: var(--gn-danger);
}
.gcf-text {
  min-width: 0;
  padding-top: 2px;
}
.gcf-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--gn-text);
  word-break: break-word;
}
.gcf-msg {
  margin: 6px 0 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--gn-text-soft);
  word-break: break-word;
}
.gcf-detail {
  margin: 7px 0 0;
  padding: 7px 9px;
  border-radius: 7px;
  background: var(--gn-bg-soft);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--gn-text-muted);
  word-break: break-word;
}
.gcf-ops {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.gcf-btn {
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--gn-border-strong);
  border-radius: 8px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s ease, filter 0.12s ease;
}
.gcf-btn:hover {
  background: var(--gn-bg-hover);
}
.gcf-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.gcf-btn.primary {
  border-color: transparent;
  background: var(--gn-accent);
  color: var(--gn-bg);
}
.gcf-btn.primary:hover {
  filter: brightness(1.06);
}
.gcf-btn.danger {
  border-color: transparent;
  background: var(--gn-danger);
  color: var(--gn-danger-ink);
}
.gcf-btn.danger:hover {
  filter: brightness(1.06);
}

.gcf-enter-active,
.gcf-leave-active {
  transition: opacity 0.16s ease;
}
.gcf-enter-active .gcf-card,
.gcf-leave-active .gcf-card {
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.16s ease;
}
.gcf-enter-from,
.gcf-leave-to {
  opacity: 0;
}
.gcf-enter-from .gcf-card,
.gcf-leave-to .gcf-card {
  opacity: 0;
  transform: translateY(6px) scale(0.985);
}
</style>
