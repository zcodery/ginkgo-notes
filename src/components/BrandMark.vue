<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 20 })
</script>

<template>
  <span
    class="brand-mark"
    :style="{ width: size + 'px', height: size + 'px', fontSize: size + 'px' }"
    aria-hidden="true"
  >🍃</span>
</template>

<style scoped>
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  line-height: 1;
}
</style>