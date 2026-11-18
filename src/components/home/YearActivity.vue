<script setup lang="ts">
import { computed } from 'vue'
import {
  activeDayCount,
  longestStreak,
  monthlyActive,
  type DayStat,
} from '@/home/metrics'
import { t } from '@/i18n'

const props = defineProps<{
  /** 每日统计 */
  stats: Map<string, DayStat>
  /** 展示年份 */
  year: number
}>()

/** 12 个月的活跃次数 */
const months = computed(() => monthlyActive(props.stats, props.year))

/** 峰值，用于柱高归一化 */
const peak = computed(() => Math.max(1, ...months.value))

/** 全年有记录的天数 */
const activeDays = computed(() => activeDayCount(props.stats, props.year))

/** 最长连续记录天数 */
const streak = computed(() => longestStreak(props.stats, props.year))

/** 单月峰值（次数 + 是哪个月） */
const peakMonth = computed(() => {
  const list = months.value
  const count = Math.max(...list)
  return { count, month: list.indexOf(count) + 1 }
})

/** 月份标签：只显示 1/4/7/10，避免挤在一起 */
const marks = [1, 4, 7, 10]
</script>

<template>
  <section class="ma-card">
    <header class="ma-head">
      <h3 class="ma-title">{{ t('home.monthlyTitle') }}</h3>
      <span class="ma-sub">{{ t('home.monthlySub', { n: months.reduce((a, b) => a + b, 0) }) }}</span>
    </header>

    <div class="ma-bars">
      <div v-for="(count, i) in months" :key="i" class="ma-col">
        <span
          class="ma-bar"
          :class="{ peak: count > 0 && count === peak }"
          :style="{ height: `${Math.max(count > 0 ? 6 : 2, (count / peak) * 100)}%` }"
          :title="`${i + 1}月 · ${count}`"
        ></span>
      </div>
    </div>

    <div class="ma-axis">
      <span v-for="m in marks" :key="m" :style="{ left: `${((m - 0.5) / 12) * 100}%` }">
        {{ m }}
      </span>
    </div>

    <footer class="ma-stats">
      <div class="ma-stat">
        <span class="ma-stat-num">{{ activeDays }}</span>
        <span class="ma-stat-label">{{ t('home.statActiveDays') }}</span>
      </div>
      <div class="ma-stat">
        <span class="ma-stat-num">{{ streak }}</span>
        <span class="ma-stat-label">{{ t('home.statStreak') }}</span>
      </div>
      <div class="ma-stat">
        <span class="ma-stat-num">{{ peakMonth.count }}</span>
        <span class="ma-stat-label">{{ t('home.statPeak') }}</span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.ma-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 14px 12px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
  /* 吸收右栏剩余高度，让竖向空间用满 */
  flex: 1 1 auto;
  min-height: 0;
}
.ma-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.ma-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--gn-text);
}
.ma-sub {
  font-size: 11px;
  color: var(--gn-text-muted);
}
.ma-bars {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  flex: 1 1 auto;
  min-height: 56px;
  padding-top: 4px;
}
.ma-col {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.ma-bar {
  width: 100%;
  border-radius: 3px 3px 0 0;
  background: color-mix(in srgb, var(--gn-accent) 38%, var(--gn-bg));
}
.ma-bar.peak {
  background: var(--gn-accent);
}
.ma-axis {
  position: relative;
  height: 13px;
  font-size: 9.5px;
  color: var(--gn-text-muted);
}
.ma-axis span {
  position: absolute;
  transform: translateX(-50%);
  font-variant-numeric: tabular-nums;
}
.ma-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.ma-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 4px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg-soft);
}
.ma-stat-num {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--gn-text);
  font-variant-numeric: tabular-nums;
}
.ma-stat-label {
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
</style>
