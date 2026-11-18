<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { buildMonthMatrix, dayKey, type DayStat } from '@/home/metrics'
import { t } from '@/i18n'

const props = defineProps<{
  /** 每日统计 */
  stats: Map<string, DayStat>
}>()

const emit = defineEmits<{
  (e: 'pick', ts: number): void
}>()

const today = new Date()
const cursor = ref(new Date(today.getFullYear(), today.getMonth(), 1))
const selected = ref(dayKey(Date.now()))

const matrix = computed(() =>
  buildMonthMatrix(cursor.value.getFullYear(), cursor.value.getMonth(), props.stats),
)

const monthLabel = computed(() =>
  t('home.calendarMonth', {
    y: cursor.value.getFullYear(),
    m: cursor.value.getMonth() + 1,
  }),
)

/** 周一 → 周日 */
const weekHead = ['一', '二', '三', '四', '五', '六', '日']

function shift(delta: number) {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1)
}

function backToToday() {
  cursor.value = new Date(today.getFullYear(), today.getMonth(), 1)
  selected.value = dayKey(Date.now())
  emit('pick', Date.now())
}

function pick(ts: number, key: string) {
  selected.value = key
  emit('pick', ts)
}

/** 该月有活动的天数 */
const activeDays = computed(
  () => matrix.value.filter((w) => w.days.some((d) => d.inMonth && d.active > 0)).length,
)
</script>

<template>
  <section class="cal-card">
    <header class="cal-head">
      <span class="cal-month">{{ monthLabel }}</span>
      <div class="cal-nav">
        <button class="cal-btn" :title="t('home.prevMonth')" @click="shift(-1)">
          <ChevronLeft :size="14" :stroke-width="2.2" />
        </button>
        <button class="cal-btn cal-today" @click="backToToday">{{ t('home.today') }}</button>
        <button class="cal-btn" :title="t('home.nextMonth')" @click="shift(1)">
          <ChevronRight :size="14" :stroke-width="2.2" />
        </button>
      </div>
    </header>

    <div class="cal-grid">
      <div class="cal-corner"></div>
      <div v-for="w in weekHead" :key="w" class="cal-weekday">{{ w }}</div>

      <template v-for="(row, ri) in matrix" :key="ri">
        <div class="cal-weekno">{{ row.weekNo }}</div>
        <button
          v-for="d in row.days"
          :key="d.ts"
          class="cal-day"
          :class="{
            out: !d.inMonth,
            today: d.isToday,
            on: dayKey(d.ts) === selected,
            has: d.inMonth && d.active > 0,
          }"
          @click="pick(d.ts, dayKey(d.ts))"
        >
          <span class="cal-day-num">{{ d.day }}</span>
          <span v-if="d.inMonth && d.active > 0" class="cal-dot"></span>
        </button>
      </template>
    </div>

    <footer class="cal-foot">
      {{ t('home.calendarFoot', { n: activeDays }) }}
    </footer>
  </section>
</template>

<style scoped>
.cal-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px 12px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
  /* 高度锁定为中栏的 46%：右栏的 Hero 卡用的是同一个比例，
     两栏等高 → 百分比等价 → 顶部这两张卡天然等高、底边对齐。
     剩下的高度让给下面的统计卡。 */
  flex: 0 0 auto;
  height: 45%;
  min-height: 0;
}
.cal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cal-month {
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--gn-text);
}
.cal-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}
.cal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  min-width: 24px;
  padding: 0 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 11.5px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.cal-btn:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.cal-today {
  padding: 0 9px;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-weight: 600;
}
.cal-today:hover {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.cal-grid {
  display: grid;
  grid-template-columns: 20px repeat(7, 1fr);
  /* 第 1 行是「星期」表头（auto），下面 6 行按 1fr 平分卡片剩余高度：
     卡片被拉高或压矮时，日期格跟着等比伸缩，不会留下底部空洞 */
  grid-template-rows: auto repeat(6, minmax(0, 1fr));
  gap: 2px;
  align-items: center;
  flex: 1 1 auto;
  min-height: 0;
}
.cal-corner {
  height: 18px;
}
.cal-weekday {
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
.cal-weekno {
  font-size: 9.5px;
  color: var(--gn-text-muted);
  opacity: 0.65;
  text-align: right;
  padding-right: 3px;
  font-variant-numeric: tabular-nums;
}
.cal-day {
  position: relative;
  /* 高度取所在行（1fr 平分出来的那一行），宽度由 aspect-ratio 推出，
     所以格子始终是正方形；宽度再被 max-width 兜住，不会顶到相邻列 */
  height: 100%;
  width: auto;
  aspect-ratio: 1;
  max-width: 100%;
  justify-self: center;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.cal-day:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.cal-day.out {
  color: var(--gn-text-muted);
  opacity: 0.35;
}
.cal-day.today {
  color: var(--gn-text);
  font-weight: 700;
}
.cal-day.on {
  background: var(--gn-accent);
  color: var(--gn-accent-ink);
  font-weight: 600;
}
.cal-day.on .cal-dot {
  background: var(--gn-accent-ink);
}
.cal-day-num {
  line-height: 1;
}
.cal-dot {
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--gn-accent);
}
.cal-foot {
  font-size: 11px;
  color: var(--gn-text-muted);
}
/**
 * 窄屏断点（≤768px）：整页变成单栏堆叠，日历卡片所在容器是「自适应高度」，
 * 此时 `height: 45%` 同样形成循环依赖，且日期格子会被压扁。
 * 改成按内容自然展开：格子宽度取满列宽、高度由 aspect-ratio 推出，
 * 每一行保持正方形。
 */
@media (max-width: 768px) {
  .cal-card {
    height: auto;
    flex: 0 0 auto;
  }
  .cal-grid {
    grid-template-rows: auto repeat(6, auto);
  }
  .cal-day {
    height: auto;
    width: 100%;
    max-width: none;
  }
}
</style>
