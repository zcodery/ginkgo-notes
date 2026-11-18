<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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

/** 格子间隙（px）；格子尺寸由容器宽度等分决定 */
const GAP = 3
/** 星期标签列宽 */
const WEEK_COL = 12
/** 格子最小边长：容器不够宽时保持这个尺寸并横向滚动 */
const CELL_MIN = 9
const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日']

const weeks = computed(() => buildYearHeat(props.year, props.stats))

/**
 * 全年周列按上下半年切成两段。
 *
 * 一整年 53 列挤在一行里，列宽被压到 15px 左右，网格只有 140px 高，
 * 右栏剩下的高度只能留成空白。拆成两段（每段约 27 列）后列宽翻倍、
 * 格子更大，网格也更高，能把 Hero 让出的空间吃干净而不留空洞。
 *
 * 但两种情况下要退回一整年 53 列：
 * ① 卡片本身很窄（宽度不足 450px）—— 拆两段会把格子压到 9px、几乎看不清，
 *    改成整年一行 + 横向滚动；
 * ② 视口窄到 1180px 以下 —— 此时右栏变成「独占一整行」的自适应高度区域，
 *    卡片高度由内容决定，两段网格（各 7 行）会把卡片撑得过高、
 *    把日期格子挤扁，不如一行来得紧凑。
 */
const narrow = ref(false)
const scrollEl = ref<HTMLElement | null>(null)
let ro: ResizeObserver | null = null
/** 断点：与首页布局的「两栏 → 上下堆叠」断点保持一致 */
const narrowMq = window.matchMedia('(max-width: 1180px)')

function applyNarrow() {
  const w = scrollEl.value?.clientWidth ?? 999
  // 450 是实测分界：27 列 × 13px + 星期标签列 + 间距 ≈ 440px，
  // 再窄格子就小到看不清了。
  narrow.value = narrowMq.matches || w < 450
}

onMounted(() => {
  if (!scrollEl.value) return
  ro = new ResizeObserver(() => applyNarrow())
  ro.observe(scrollEl.value)
  narrowMq.addEventListener('change', applyNarrow)
  applyNarrow()
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  narrowMq.removeEventListener('change', applyNarrow)
})

const segments = computed(() => {
  const w = weeks.value
  if (narrow.value) return [w]
  const cut = Math.ceil(w.length / 2)
  return [w.slice(0, cut), w.slice(cut)].filter((s) => s.length > 0)
})

/**
 * 每段里每个月第一列所在的列下标，用于月份标签。
 *
 * 首列可能落在上一年年末（2026-01-01 所在周从 2025-12-29 开始），
 * 那种列不标月份，否则会误显示成「12月」。
 */
function marksOf(list: typeof weeks.value) {
  const out: { index: number; label: number }[] = []
  let last = -1
  list.forEach((w, i) => {
    const d = new Date(w.cells[0]!.ts)
    if (d.getFullYear() !== props.year) return
    if (d.getMonth() !== last) {
      last = d.getMonth()
      out.push({ index: i, label: d.getMonth() + 1 })
    }
  })
  return out
}

/** 每一段各自的月份标签 */
const segMarks = computed(() => segments.value.map(marksOf))

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

    <div ref="scrollEl" class="ht-scroll gn-scroll">
      <!--
        全年拆成上下半年两段渲染：
        53 列挤在一行时列宽只有 15px、网格高 140px，右栏多出来的高度只能留成空白；
        拆成两段后列宽翻倍，格子更大，网格高度也跟着涨，正好把空间吃满。
      -->
      <div
        v-for="(seg, si) in segments"
        :key="si"
        class="ht-grid"
        :style="{
          gridTemplateColumns: `${WEEK_COL}px repeat(${seg.length}, minmax(${CELL_MIN}px, 1fr))`,
          gap: `${GAP}px`,
        }"
      >        <!-- 月份标签直接落在对应周列上，列宽变化时自动对齐 -->
        <span
          v-for="m in segMarks[si]"
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

        <template v-for="(w, wi) in seg" :key="wi">
          <span
            v-for="(c, ci) in w.cells"
            :key="c.ts"
            class="ht-cell"
            :class="`lv${c.level}`"
            :style="{ gridColumn: `${wi + 2}`, gridRow: `${ci + 2}` }"
            :title="cellTitle(c.ts, c.count)"
          ></span>
        </template>
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
  /* 两段网格纵向平分剩余高度，段与段之间留一点间隔，
     免得下一段的月份标签紧贴上一段最后一行 */
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
/* 窄屏只有一段（整年 53 列），不需要段间距 */
.ht-scroll:has(> .ht-grid:only-child) {
  gap: 0;
}
/**
 * 每一段是一张独立的二维网格：
 * 第 1 列是星期标签列，其后是 N 个等宽的周列。
 * 格子宽度取满所在列（列宽由容器宽度 1fr 均分得到，minmax 下限 9px），
 * 高度用 aspect-ratio 推出，保证始终是正方形；
 * 因此容器一放宽，格子与整张图就跟着撑满；容器不够宽时保持最小尺寸并横向滚动。
 * 第 1 行留给月份标签，标签直接落在对应周列上，列宽变化时自动对齐。
 * 行高用 auto 跟随格子，段内剩余高度由 align-content 均匀分配，
 * 这样段被拉高时格子不会变形、行距也不会散开。
 */
.ht-grid {
  display: grid;
  /* 行高用 1fr 平分：卡片被拉高时格子跟着变大，被压矮时格子跟着变小，
     7 行始终完整显示 —— 固定行高的话，卡片一矮下半段就被裁掉了 */
  grid-template-rows: auto repeat(7, minmax(0, 1fr));
  flex: 1 1 0;
  min-height: 0;
}
/* 单段（窄屏）：整年 53 列一行，格子按最小尺寸排布即可，
   给一个最小高度，保证 7 行格子完整可见 */
.ht-grid:only-child {
  flex: 0 0 auto;
  min-height: 118px;
  grid-template-rows: auto repeat(7, auto);
}
.ht-month {
  /* 列宽由 1fr 均分，格子在列内居中（见 .ht-cell），
     月份标签同样居中，才能和它标注的那个格子对齐 */
  justify-self: center;
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
/**
 * 格子高度取所在行（1fr 平分出来的那一行），宽度由 aspect-ratio 推出，
 * 所以无论卡片被拉高还是压矮，格子始终是正方形；
 * max-height / max-width 兜住上限，避免在超宽屏上格子变得过大。
 */
.ht-cell {
  height: 100%;
  max-height: 20px;
  width: auto;
  aspect-ratio: 1;
  max-width: 20px;
  align-self: center;
  justify-self: center;
  border-radius: 2.5px;
  background: var(--gn-bg-soft);
  border: 1px solid var(--gn-border);
}
/* 单段（窄屏）：53 列挤在窄容器里，格子尺寸改由列宽决定，
   行高也回到 auto，让 7 行紧凑排列 */
.ht-grid:only-child .ht-cell {
  height: auto;
  max-height: none;
  width: 100%;
  max-width: none;
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
/**
 * 窄屏断点（≤1180px）：右栏变成「独占一整行」的自适应高度区域，
 * 容器高度由内容决定。此时 flex 的收缩会把卡片压到比内容还矮，
 * 7 行格子就被裁掉半段 —— 所以改成不收缩，高度完全由内容决定。
 * （此时热力图已是单段 53 列，一行放下，高度本来就够。）
 */
@media (max-width: 1180px) {
  .ht-card {
    flex: 0 0 auto;
  }
}
</style>
