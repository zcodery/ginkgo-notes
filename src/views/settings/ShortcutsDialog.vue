<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RotateCcw, X } from 'lucide-vue-next'
import SettingsModal from './SettingsModal.vue'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_GROUPS,
  SHORTCUT_LABELS,
  comboFromEvent,
  formatCombo,
  resetShortcuts,
  shortcuts,
  type ShortcutAction,
} from '@/shortcuts'

const emit = defineEmits<{ (e: 'close'): void }>()

const recording = ref<ShortcutAction | null>(null)
const hint = ref('')
const actions = Object.keys(SHORTCUT_LABELS) as ShortcutAction[]

const conflicts = computed(() => {
  const seen = new Map<string, ShortcutAction[]>()
  for (const a of actions) {
    const v = shortcuts[a]
    if (!v) continue
    seen.set(v, [...(seen.get(v) ?? []), a])
  }
  return new Set([...seen.values()].filter((l) => l.length > 1).flat())
})

function onKey(e: KeyboardEvent) {
  if (!recording.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    recording.value = null
    stop()
    return
  }
  if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    shortcuts[recording.value] = ''
    recording.value = null
    stop()
    return
  }
  const combo = comboFromEvent(e)
  if (!combo) return
  if (!combo.includes('+')) {
    hint.value = '至少要包含一个修饰键（Ctrl / ⌘ / Alt / Shift）'
    return
  }
  shortcuts[recording.value] = combo
  recording.value = null
  hint.value = ''
  stop()
}

function start(a: ShortcutAction) {
  stop()
  recording.value = a
  hint.value = '按下新的组合键，Esc 取消，Backspace 清除'
  window.addEventListener('keydown', onKey, true)
}

function stop() {
  window.removeEventListener('keydown', onKey, true)
}

onBeforeUnmount(stop)
</script>

<template>
  <SettingsModal title="快捷键" :width="480" :close-on-esc="!recording" @close="emit('close')">
    <div class="pf-list">
      <template v-for="group in SHORTCUT_GROUPS" :key="group.id">
        <div class="sc-group">{{ group.label }}</div>
        <div v-for="a in group.actions" :key="a" class="pf-list-item">
          <div class="pf-list-main">
            <div class="pf-list-title">{{ SHORTCUT_LABELS[a] }}</div>
            <div v-if="conflicts.has(a)" class="pf-err">与其它快捷键冲突</div>
          </div>
          <button
            type="button"
            class="sc-key"
            :class="{ rec: recording === a, empty: !shortcuts[a] }"
            @click="start(a)"
          >
            {{ recording === a ? '请按键…' : formatCombo(shortcuts[a]) || '未设置' }}
          </button>
          <button
            type="button"
            class="gn-icon-btn"
            v-tooltip="'恢复默认'"
            :disabled="shortcuts[a] === DEFAULT_SHORTCUTS[a]"
            @click="shortcuts[a] = DEFAULT_SHORTCUTS[a]"
          >
            <RotateCcw :size="13" />
          </button>
          <button
            type="button"
            class="gn-icon-btn danger"
            v-tooltip="'清除'"
            :disabled="!shortcuts[a]"
            @click="shortcuts[a] = ''"
          >
            <X :size="13" />
          </button>
        </div>
      </template>
    </div>
    <p class="pf-dialog-tip">
      {{
        hint ||
        '点击右侧按键区域后，直接按下想要的组合键。撤销 / 重做仍使用系统默认 Ctrl+Z / Ctrl+Y。'
      }}
    </p>
    <footer>
      <button type="button" class="pf-btn" @click="resetShortcuts">全部恢复默认</button>
      <span class="pf-grow"></span>
      <button type="button" class="pf-btn primary" @click="emit('close')">完成</button>
    </footer>
  </SettingsModal>
</template>

<style scoped>
.sc-group {
  padding: 10px 2px 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--gn-text-muted);
  letter-spacing: 0.02em;
}
.sc-group:first-child {
  padding-top: 0;
}
.sc-key {
  min-width: 110px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--gn-border-strong);
  border-radius: 6px;
  background: var(--gn-bg-sidebar);
  color: var(--gn-text);
  font-family: var(--gn-mono);
  font-size: 12px;
  cursor: pointer;
}
.sc-key.empty {
  color: var(--gn-text-muted);
  font-family: inherit;
}
.sc-key.rec {
  border-color: var(--gn-accent);
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
</style>
