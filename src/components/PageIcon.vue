<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { FileText } from 'lucide-vue-next'
import { ASSET_PREFIX, assetToUrl } from '@/editor/assets'
import { LUCIDE_ICON_MAP, parsePageIcon } from './pageIcon'

const props = withDefaults(
  defineProps<{
    icon?: string | null
    /** 用于侧栏等小尺寸；笔记标题处传大尺寸 */
    size?: number
    fallback?: boolean
  }>(),
  { size: 16, fallback: true },
)

const parsed = computed(() => parsePageIcon(props.icon))
const assetUrl = ref<string | null>(null)

async function resolveAsset() {
  assetUrl.value = null
  if (parsed.value.kind !== 'asset') return
  assetUrl.value = await assetToUrl(parsed.value.value)
}

watch(
  () => parsed.value.raw,
  () => {
    void resolveAsset()
  },
  { immediate: true },
)

onMounted(() => {
  void resolveAsset()
})

const lucideComp = computed(() => {
  if (parsed.value.kind !== 'lucide') return null
  return LUCIDE_ICON_MAP[parsed.value.value] ?? null
})
</script>

<template>
  <span class="page-icon" :style="{ width: size + 'px', height: size + 'px', fontSize: size + 'px' }">
    <span v-if="parsed.kind === 'emoji'" class="pi-emoji">{{ parsed.value }}</span>
    <component
      :is="lucideComp"
      v-else-if="lucideComp"
      class="pi-lucide"
      :size="size"
      :stroke-width="1.7"
    />
    <img v-else-if="parsed.kind === 'url'" class="pi-img" :src="parsed.value" alt="" />
    <img v-else-if="parsed.kind === 'asset' && assetUrl" class="pi-img" :src="assetUrl" alt="" />
    <FileText
      v-else-if="fallback"
      class="pi-fallback"
      :size="size"
      :stroke-width="1.7"
    />
  </span>
</template>

<style scoped>
.page-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  line-height: 1;
  overflow: hidden;
}
.pi-emoji {
  line-height: 1;
}
.pi-lucide,
.pi-fallback {
  color: var(--gn-text-soft);
}
.pi-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}
</style>
