<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Compass, Repeat, Zap } from 'lucide-vue-next'
import { QUICK_TEMPLATES } from '@/home/templates'
import { locale, t } from '@/i18n'
import heroBg from '@/assets/home-hero.svg'

defineProps<{
  /** 创建模板笔记 */
  create: (id: string) => void
}>()

const ICONS = { notebook: BookOpen, repeat: Repeat, compass: Compass, zap: Zap }

const now = computed(() => new Date())
const dateText = computed(() => {
  const d = now.value
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return t('home.dashboardDate', {
    y: d.getFullYear(),
    m: String(d.getMonth() + 1).padStart(2, '0'),
    d: String(d.getDate()).padStart(2, '0'),
    w: week,
  })
})

const templates = computed(() =>
  QUICK_TEMPLATES.map((tpl) => ({
    ...tpl,
    icon: ICONS[tpl.icon],
    text: tpl.label[locale.value],
  })),
)
</script>

<template>
  <section class="qs-card">
    <!--
      背景图层：想换成自己的图，替换 src/assets/home-hero.svg 即可
      （或者直接改下面 background-image 的值）。
    -->
    <div class="qs-bg" :style="{ backgroundImage: `url(${heroBg})` }"></div>
    <div class="qs-scrim"></div>

    <div class="qs-inner">
      <div class="qs-eyebrow">{{ t('home.dashboardEyebrow') }}</div>
      <h2 class="qs-title">{{ t('home.dashboardTitle') }}</h2>
      <div class="qs-date">{{ dateText }}</div>
      <div class="qs-actions">
        <button
          v-for="tpl in templates"
          :key="tpl.id"
          class="qs-btn"
          @click="create(tpl.id)"
        >
          <component :is="tpl.icon" :size="13" :stroke-width="2" />
          <span>{{ tpl.text }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.qs-card {
  position: relative;
  overflow: hidden;
  padding: 16px 18px 15px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
  /* 撑满右栏剩余高度：这块是放背景图的主视觉区 */
  flex: 1 1 auto;
  min-height: 168px;
  display: flex;
}
.qs-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  /* 背景图本身不抢文字，透明度压低一点 */
  opacity: 0.9;
  pointer-events: none;
}
/* 暗色主题下背景图整体压暗，否则浅色 SVG 会从深色底里「发亮」 */
:global(html.dark) .qs-bg {
  opacity: 0.42;
  filter: saturate(0.85);
}
/* 文字下面的柔化层，保证前景文字在任何背景图上都读得清 */
.qs-scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      100deg,
      color-mix(in srgb, var(--gn-bg) 92%, transparent) 0%,
      color-mix(in srgb, var(--gn-bg) 70%, transparent) 46%,
      color-mix(in srgb, var(--gn-bg) 26%, transparent) 100%
    ),
    radial-gradient(120% 130% at 88% 0%, color-mix(in srgb, var(--gn-accent) 16%, transparent) 0%, transparent 58%);
  pointer-events: none;
}
.qs-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}
.qs-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--gn-accent);
  opacity: 0.9;
}
.qs-title {
  margin: 5px 0 3px;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--gn-text);
}
.qs-date {
  font-size: 12px;
  color: var(--gn-text-muted);
  font-variant-numeric: tabular-nums;
}
.qs-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 13px;
}
.qs-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--gn-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--gn-bg) 82%, transparent);
  color: var(--gn-text-soft);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.14s ease, color 0.14s ease, transform 0.14s ease;
}
.qs-btn:hover {
  border-color: var(--gn-accent);
  color: var(--gn-accent);
  transform: translateY(-1px);
}
</style>
