<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { buildYearHeat, monthlyActiveCounts, type DayStat } from '@/home/metrics'
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

/** 格子间隙（px） */
const GAP = 3
/** 星期标签列宽 */
const WEEK_COL = 12
/** 格子最小边长：容器不够宽时保持这个尺寸并横向滚动 */
const CELL_MIN = 9
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

/** 12 个月的活跃次数（用于月度分布柱图） */
const monthly = computed(() => monthlyActiveCounts(props.stats, props.year))
const monthMax = computed(() => Math.max(1, ...monthly.value))

/** 峰值月份（1-12）与该月次数，用于标题右侧的说明 */
const monthPeak = computed(() => {
  let m = 0
  monthly.value.forEach((c, i) => {
    if (c > monthly.value[m]!) m = i
  })
  return { month: m + 1, count: monthly.value[m] ?? 0 }
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
        <button class="ht-btn" v-tooltip="t('home.prevYear')" @click="shift(-1)">
          <ChevronLeft :size="13" :stroke-width="2.2" />
        </button>
        <span class="ht-year-num">{{ year }}</span>
        <button class="ht-btn" v-tooltip="t('home.nextYear')" @click="shift(1)">
          <ChevronRight :size="13" :stroke-width="2.2" />
        </button>
      </div>
    </header>

    <!--
      GitHub 贡献图样式：整年 53 个周列排成一行。
      之前拆成上下两段（各 27 列）是为了把右栏的竖向空间填满，
      但那样每列被拉到 35px 宽、格子只有 18px 居中，
      横向每列都留一条空隙，整张图看起来稀疏零散、不像一张图。
      恢复成单行 53 列后格子紧凑相连；腾出来的高度交给下方的月度分布。
    -->
    <div class="ht-scroll gn-scroll">
      <div
        class="ht-grid"
        :style="{
          gridTemplateColumns: `${WEEK_COL}px repeat(${weeks.length}, minmax(${CELL_MIN}px, 1fr))`,
          gap: `${GAP}px`,
        }"
      >
        <!-- 月份标签直接落在对应周列上，列宽变化时自动对齐 -->
        <span
          v-for="m in monthMarks"
          :key="m.index"
          class="ht-month"
          :style="{ gridColumn: `${m.index + 2}`, gridRow: '1' }"
        >
          {{ m.label }}月
        </span>

        <span
          v-for="(w, i) in WEEK_HEAD"
          :key="`wd-${i}`"
          class="ht-weeklabel"
          :style="{ gridColumn: '1', gridRow: `${i + 2}` }"
        >
          {{ i % 2 === 0 ? w : '' }}
        </span>

        <template v-for="(w, wi) in weeks" :key="wi">
          <span
            v-for="(c, ci) in w.cells"
            :key="c.ts"
            class="ht-cell"
            :class="`lv${c.level}`"
            :style="{ gridColumn: `${wi + 2}`, gridRow: `${ci + 2}` }"
            v-tooltip="cellTitle(c.ts, c.count)"
          ></span>
        </template>
      </div>
    </div>

    <!-- 月度活跃分布：把热力图腾出来的高度填成有用的信息 -->
    <div class="ht-months">
      <div class="ht-months-head">
        <span class="ht-months-label">{{ t('home.heatMonthly') }}</span>
        <span class="ht-months-peak">{{ t('home.heatMonthlyPeak', { m: monthPeak.month, n: monthPeak.count }) }}</span>
      </div>
      <div class="ht-months-chart">
        <div
          v-for="(c, i) in monthly"
          :key="i"
          class="ht-mcol"
          v-tooltip="t('home.heatMonthlyTip', { m: i + 1, n: c })"
        >
          <span class="ht-mbar-wrap">
            <span
              class="ht-mbar"
              :class="{ peak: c === monthMax && c > 0 }"
              :style="{ height: `${Math.max(3, (c / monthMax) * 100)}%` }"
            ></span>
          </span>
          <span class="ht-mlabel">{{ i + 1 }}</span>
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
  /* 吃掉右栏剩余高度：上半年的 Hero 让出多少，这里就填多少 */
  flex: 1 1 auto;
  min-height: 0;
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
  /* 网格按内容撑开（宽度不够时横向滚动），不跟卡片抢竖向空间 */
  flex: 0 0 auto;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}
/**
 * 整张热力图是一个二维网格：
 * 第 1 列是星期标签列，其后是 53 个等宽的周列（1fr 均分）。
 * 格子宽度取满所在列、高度由 aspect-ratio 推出，所以始终是正方形，
 * 且横向紧密相连 —— 这是 GitHub 贡献图的标准观感。
 * 第 1 行留给月份标签，标签直接落在对应周列上，列宽变化时自动对齐。
 */
.ht-grid {
  display: grid;
  grid-template-rows: auto repeat(7, auto);
}
.ht-month {
  /* 标签比格子宽，居中会压到相邻月份，这里靠左对齐到所属周列 */
  justify-self: start;
  align-self: end;
  font-size: 10px;
  line-height: 13px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
.ht-weeklabel {
  align-self: center;
  font-size: 9.5px;
  line-height: 11px;
  color: var(--gn-text-muted);
}
.ht-cell {
  width: 100%;
  aspect-ratio: 1;
  max-width: 20px;
  justify-self: center;
  border-radius: 2.5px;
  background: var(--gn-bg-soft);
}
.ht-cell.lv0 {
  background: var(--gn-bg-soft);
}
.ht-cell.lv1 {
  background: color-mix(in srgb, var(--gn-accent) 26%, var(--gn-bg));
}
.ht-cell.lv2 {
  background: color-mix(in srgb, var(--gn-accent) 48%, var(--gn-bg));
}
.ht-cell.lv3 {
  background: color-mix(in srgb, var(--gn-accent) 72%, var(--gn-bg));
}
.ht-cell.lv4 {
  background: var(--gn-accent);
}

/* ---- 月度活跃分布 ---- */
.ht-months {
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 吸收热力图腾出来的高度 */
  flex: 1 1 auto;
  min-height: 0;
}
.ht-months-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex: 0 0 auto;
}
.ht-months-label {
  font-size: 10.5px;
  color: var(--gn-text-muted);
  letter-spacing: 0.02em;
}
.ht-months-peak {
  font-size: 10.5px;
  color: var(--gn-text-soft);
  font-variant-numeric: tabular-nums;
}
.ht-months-chart {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 6px;
  align-items: end;
}
.ht-mcol {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  height: 100%;
  min-width: 0;
}
.ht-mbar-wrap {
  flex: 1 1 auto;
  /* 轨道和柱子同宽：数据稀疏时也能看出这是一张有结构的柱状图，
     而不是「一排贴底的碎条 + 大片空白」 */
  width: 100%;
  max-width: 26px;
  min-height: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: var(--gn-bg-soft);
  border-radius: 3px;
  overflow: hidden;
}
.ht-mbar {
  width: 100%;
  border-radius: 3px 3px 1px 1px;
  background: var(--gn-accent-soft);
}
.ht-mbar.peak {
  background: var(--gn-accent);
}
.ht-mlabel {
  flex: 0 0 auto;
  font-size: 9.5px;
  line-height: 11px;
  color: var(--gn-text-muted);
  font-variant-numeric: tabular-nums;
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
