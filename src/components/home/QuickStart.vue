<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Compass, Repeat, Zap } from 'lucide-vue-next'
import { QUICK_TEMPLATES } from '@/home/templates'
import { locale, t } from '@/i18n'

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
  </section>
</template>

<style scoped>
.qs-card {
  position: relative;
  overflow: hidden;
  padding: 16px 18px 15px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background:
    radial-gradient(120% 130% at 88% 0%, color-mix(in srgb, var(--gn-accent) 26%, transparent) 0%, transparent 58%),
    radial-gradient(100% 120% at 6% 100%, color-mix(in srgb, var(--gn-accent) 12%, transparent) 0%, transparent 60%),
    var(--gn-bg);
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
  background: var(--gn-bg);
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
