<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'

withDefaults(defineProps<{ label?: string }>(), { label: '正在加载…' })
</script>

<template>
  <div class="view-loading" role="status" aria-live="polite">
    <Loader2 class="vl-spin" :size="18" :stroke-width="1.8" aria-hidden="true" />
    <span>{{ label }}</span>
  </div>
</template>

<style scoped>
.view-loading {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  height: 100%;
  color: var(--gn-text-muted);
  font-size: 12.5px;
}
.vl-spin {
  flex: none;
  color: var(--gn-accent);
  animation: vl-spin 1s linear infinite;
}
@keyframes vl-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .vl-spin {
    animation: none;
  }
}
</style>
