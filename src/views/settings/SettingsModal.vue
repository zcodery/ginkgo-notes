<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ title: string; width?: number; closeOnEsc?: boolean }>(), {
  width: 360,
  closeOnEsc: true,
})
const emit = defineEmits<{ (e: 'close'): void }>()

/** 挂在 window 捕获阶段，先于设置面板（document 捕获）拿到 Esc，只关自己 */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !props.closeOnEsc) return
  e.stopImmediatePropagation()
  e.stopPropagation()
  emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div class="pf-mask gn-fade" @mousedown.self="emit('close')">
      <div class="pf-dialog gn-pop" :style="{ width: `min(${props.width}px, calc(100vw - 32px))` }">
        <header>
          <span>{{ title }}</span>
          <button type="button" class="gn-icon-btn danger" @click="emit('close')"><X :size="14" /></button>
        </header>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
