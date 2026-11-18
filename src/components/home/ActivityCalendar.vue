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
  /* 撑满中栏剩余高度 */
  flex: 1 1 auto;
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
  gap: 2px;
  align-items: center;
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
  aspect-ratio: 1;
  min-height: 26px;
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
</style>
