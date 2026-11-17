<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { buildYearHeat, type DayStat } from '@/home/metrics'
import { t } from '@/i18n'

const props = defineProps<{
  /** 每日统计 */
  stats: Map<string, DayStat>
  /** 选中的年份 */
  year: number
}>()

const emit = defineEmits<{
  (e: 'update:year', year: number): void
}>()

/** 格子尺寸（px）与间隙 */
const CELL = 11
const GAP = 3
const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日']

const weeks = computed(() => buildYearHeat(props.year, props.stats))

/**
 * 每个月第一列所在的列下标，用于月份标签。
 *
 * 首列可能落在上一年年末（2026-01-01 所在周从 2025-12-29 开始），
 * 那种列不标月份，否则会误显示成「12月」。
 */
const monthMarks = computed(() => {
  const out: { index: number; label: number }[] = []
  let last = -1
  weeks.value.forEach((w, i) => {
    const d = new Date(w.cells[0]!.ts)
    if (d.getFullYear() !== props.year) return
    if (d.getMonth() !== last) {
      last = d.getMonth()
      out.push({ index: i, label: d.getMonth() + 1 })
    }
  })
  return out
})

/** 全年活跃天数与总活跃次数 */
const summary = computed(() => {
  let days = 0
  let total = 0
  for (const w of weeks.value) {
    for (const c of w.cells) {
      if (c.level < 0) continue
      if (c.count > 0) days++
      total += c.count
    }
  }
  return { days, total }
})

function shift(delta: number) {
  emit('update:year', props.year + delta)
}

/** 悬浮提示里的日期 */
function cellTitle(ts: number, count: number) {
  const d = new Date(ts)
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${key} · ${t('home.heatCount', { n: count })}`
}
</script>

<template>
  <section class="ht-card">
    <header class="ht-head">
      <div class="ht-title-wrap">
        <h3 class="ht-title">{{ t('home.heatTitle') }}</h3>
        <span class="ht-sub">{{ t('home.heatSub', { n: summary.total }) }}</span>
      </div>
      <div class="ht-year">
        <button class="ht-btn" :title="t('home.prevYear')" @click="shift(-1)">
          <ChevronLeft :size="13" :stroke-width="2.2" />
        </button>
        <span class="ht-year-num">{{ year }}</span>
        <button class="ht-btn" :title="t('home.nextYear')" @click="shift(1)">
          <ChevronRight :size="13" :stroke-width="2.2" />
        </button>
      </div>
    </header>

    <div class="ht-scroll gn-scroll">
      <div class="ht-inner" :style="{ width: `${weeks.length * (CELL + GAP)}px` }">
        <div class="ht-months">
          <span
            v-for="m in monthMarks"
            :key="m.index"
            class="ht-month"
            :style="{ left: `${m.index * (CELL + GAP)}px` }"
          >
            {{ m.label }}月
          </span>
        </div>
        <div class="ht-body">
          <div class="ht-weekhead">
            <span v-for="(w, i) in WEEK_HEAD" :key="w" class="ht-weeklabel" :style="{ top: `${i * (CELL + GAP)}px` }">
              {{ i % 2 === 0 ? w : '' }}
            </span>
          </div>
          <div class="ht-grid">
            <div v-for="(w, wi) in weeks" :key="wi" class="ht-col">
              <span
                v-for="(c, ci) in w.cells"
                :key="ci"
                class="ht-cell"
                :class="`lv${c.level}`"
                :title="cellTitle(c.ts, c.count)"
              ></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer class="ht-foot">
      <span>{{ t('home.heatFoot', { n: summary.days }) }}</span>
      <span class="ht-legend">
        {{ t('home.heatLess') }}
        <span class="ht-cell lv0"></span>
        <span class="ht-cell lv1"></span>
        <span class="ht-cell lv2"></span>
        <span class="ht-cell lv3"></span>
        <span class="ht-cell lv4"></span>
        {{ t('home.heatMore') }}
      </span>
    </footer>
  </section>
</template>

<style scoped>
.ht-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 14px 12px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
}
.ht-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.ht-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ht-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--gn-text);
}
.ht-sub {
  font-size: 11px;
  color: var(--gn-text-muted);
}
.ht-year {
  display: flex;
  align-items: center;
  gap: 2px;
}
.ht-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.ht-btn:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.ht-year-num {
  min-width: 34px;
  text-align: center;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--gn-text-soft);
  font-variant-numeric: tabular-nums;
}
.ht-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}
.ht-inner {
  position: relative;
}
.ht-months {
  position: relative;
  height: 14px;
}
.ht-month {
  position: absolute;
  top: 0;
  font-size: 10px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
.ht-body {
  display: flex;
  gap: 5px;
}
.ht-weekhead {
  position: relative;
  width: 12px;
  flex: 0 0 auto;
  height: calc(7 * (11px + 3px) - 3px);
}
.ht-weeklabel {
  position: absolute;
  left: 0;
  font-size: 9.5px;
  line-height: 11px;
  color: var(--gn-text-muted);
}
/* 星期标签按格子中心对齐：标签行高 11px，格子从 0 开始，故上移 3px */
.ht-weeklabel:nth-child(even) {
  transform: translateY(-3px);
}
.ht-grid {
  display: flex;
  gap: 3px;
}
.ht-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ht-cell {
  width: 11px;
  height: 11px;
  border-radius: 2.5px;
  background: var(--gn-bg-soft);
  border: 1px solid var(--gn-border);
  flex: 0 0 auto;
}
.ht-cell.lv0 {
  background: var(--gn-bg-soft);
}
.ht-cell.lv1 {
  background: color-mix(in srgb, var(--gn-accent) 26%, var(--gn-bg));
  border-color: transparent;
}
.ht-cell.lv2 {
  background: color-mix(in srgb, var(--gn-accent) 48%, var(--gn-bg));
  border-color: transparent;
}
.ht-cell.lv3 {
  background: color-mix(in srgb, var(--gn-accent) 72%, var(--gn-bg));
  border-color: transparent;
}
.ht-cell.lv4 {
  background: var(--gn-accent);
  border-color: transparent;
}
.ht-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
.ht-legend {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.ht-legend .ht-cell {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
</style>
