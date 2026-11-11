<script setup lang="ts">
import { computed } from 'vue'
import { displayName, store } from '@/store'

const props = withDefaults(defineProps<{ size?: number; radius?: number }>(), {
  size: 22,
  radius: 6,
})

const initial = computed(() => (displayName.value || '?').slice(0, 1).toUpperCase())
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${props.radius}px`,
  fontSize: `${Math.round(props.size * 0.5)}px`,
}))
</script>

<template>
  <span class="ua" :style="style">
    <img v-if="store.user?.avatar" :src="store.user.avatar" alt="" />
    <template v-else>{{ initial }}</template>
  </span>
</template>

<style scoped>
.ua {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  overflow: hidden;
  background: var(--gn-accent);
  color: var(--gn-bg);
  font-weight: 650;
  line-height: 1;
}
.ua img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
