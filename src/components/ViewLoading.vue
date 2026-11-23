<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: '正在加载…' })
</script>

<template>
  <div class="view-loading" role="status" aria-live="polite">
    <span class="vl-ring" aria-hidden="true"></span>
    <span class="vl-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.view-loading {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 240px;
  height: 100%;
  color: var(--gn-text-muted);
  font-size: 12px;
  letter-spacing: 0.06em;
}
.vl-ring {
  flex: none;
  width: 15px;
  height: 15px;
  border: 1.5px solid color-mix(in srgb, var(--gn-text-muted) 26%, transparent);
  border-radius: 50%;
  border-top-color: var(--gn-accent);
  animation: vl-turn 1.15s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}
.vl-label {
  padding-left: 0.06em;
}
@keyframes vl-turn {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .vl-ring {
    animation: none;
    border-top-color: color-mix(in srgb, var(--gn-accent) 55%, transparent);
  }
}
</style>
