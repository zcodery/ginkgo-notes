<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BookOpen, Compass, Repeat, Zap } from 'lucide-vue-next'
import { QUICK_TEMPLATES } from '@/home/templates'
import { locale, t } from '@/i18n'
// 想换成自己的图，替换 src/assets/home-hero.jpg（同时重新导出 .webp）即可
// 静态资源不会被 Vite 内联成 data URI，走独立文件地址
import heroBgWebp from '@/assets/home-hero.webp'
import heroBgJpg from '@/assets/home-hero.jpg'

defineProps<{
  /** 创建模板笔记 */
  create: (id: string) => void
}>()

const ICONS = { notebook: BookOpen, repeat: Repeat, compass: Compass, zap: Zap }

/** WebP 体积约为 JPEG 的一半，浏览器不支持时回落到 JPEG */
const heroBg = ref(heroBgJpg)
onMounted(() => {
  const probe = document.createElement('canvas')
  if (probe.toDataURL('image/webp').startsWith('data:image/webp')) {
    heroBg.value = heroBgWebp
  }
})

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
      背景图层：整张图全出血铺满卡片，人物落在画面偏右、不会压到左侧文字。
      想换成自己的图，替换 src/assets/home-hero.jpg / home-hero.webp 即可
      （或者直接改下面 background-image 的值）。
    -->
    <div class="qs-bg" :style="{ backgroundImage: `url(${heroBg})` }"></div>
    <div class="qs-scrim"></div>

    <div class="qs-inner">
      <div class="qs-head">
        <div class="qs-eyebrow">{{ t('home.dashboardEyebrow') }}</div>
        <h2 class="qs-title">{{ t('home.dashboardTitle') }}</h2>
        <div class="qs-date">{{ dateText }}</div>
      </div>
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
  /* 高度锁定为右栏的 46%：中栏的日历卡用的是同一个比例，
     两栏等高 → 百分比等价 → 顶部这两张卡天然等高、底边对齐。
     剩下的高度让给下面的年度热力图。 */
  flex: 0 0 auto;
  height: 45%;
  min-height: 168px;
  display: flex;
}
.qs-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  /* 卡片与原图比例接近（1.79 vs 1.78），基本整张都露出来；
     稍微右移一点，让人物落在卡片中偏右，别压住左侧文字 */
  background-position: 55% 45%;
  pointer-events: none;
}
/* 暗色主题下背景图整体压暗，否则亮色照片会从深色底里「发亮」 */
:global(html.dark) .qs-bg {
  opacity: 0.3;
  filter: saturate(0.7) brightness(0.72);
}
/* 文字下面的柔化层，保证前景文字在任何背景图上都读得清 */
.qs-scrim {
  position: absolute;
  inset: 0;
  background:
    /* 底部再压一层，四个按钮不会浮在花色背景上 */
    linear-gradient(
      to top,
      color-mix(in srgb, var(--gn-bg) 66%, transparent) 0%,
      color-mix(in srgb, var(--gn-bg) 12%, transparent) 22%,
      transparent 40%
    ),
    /* 左侧渐隐：文字区还原成背景色，照片在右侧完整露出 */
    linear-gradient(
      100deg,
      color-mix(in srgb, var(--gn-bg) 80%, transparent) 0%,
      color-mix(in srgb, var(--gn-bg) 48%, transparent) 38%,
      color-mix(in srgb, var(--gn-bg) 10%, transparent) 70%,
      transparent 100%
    );
  pointer-events: none;
}
.qs-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  /* 标题组贴顶、按钮贴底，中间整块留给背景照片 */
  height: 100%;
  justify-content: space-between;
  gap: 12px;
}
.qs-head {
  display: flex;
  flex-direction: column;
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
}
.qs-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 13px;
  border: 1px solid color-mix(in srgb, var(--gn-accent) 30%, transparent);
  border-radius: 999px;
  /* 按钮压在照片上，用半透明浅底 + 强调色描边保证任何背景下都读得清 */
  background: color-mix(in srgb, var(--gn-bg) 72%, transparent);
  color: var(--gn-text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(3px);
  transition: border-color 0.14s ease, background-color 0.14s ease, transform 0.14s ease;
}
.qs-btn:hover {
  border-color: var(--gn-accent);
  background: color-mix(in srgb, var(--gn-accent) 18%, var(--gn-bg) 66%);
  color: var(--gn-accent);
  transform: translateY(-1px);
}
/* 第一个按钮做主操作，实心强调色 */
.qs-btn:first-child {
  border-color: transparent;
  background: var(--gn-accent);
  color: var(--gn-accent-ink);
}
.qs-btn:first-child:hover {
  background: color-mix(in srgb, var(--gn-accent) 86%, var(--gn-text));
  color: var(--gn-accent-ink);
}
/**
 * 窄屏断点（≤1180px）：右栏变成「独占一整行」的自适应高度区域，
 * 此时 `height: 45%` 会形成循环依赖（百分比参照的高度本身由内容决定），
 * 浏览器只能猜一个值。改成固定高度，行为可预期。
 */
@media (max-width: 1180px) {
  .qs-card {
    height: auto;
    min-height: 240px;
    flex: 0 0 auto;
  }
}
</style>
