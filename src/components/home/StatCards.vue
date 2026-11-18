<script setup lang="ts">
import { computed, useId } from 'vue'
import { ArrowDownRight, ArrowUpRight } from 'lucide-vue-next'
import { deltaPercent, type TrendPoint } from '@/home/metrics'
import { t } from '@/i18n'

const props = defineProps<{
  /** 本周发布 */
  week: { current: number; previous: number; points: TrendPoint[] }
  /** 本月发布 */
  month: { current: number; previous: number; points: TrendPoint[] }
  /** 收件箱：未读通知 / 通知总数 */
  inbox: { unread: number; total: number }
  /** 灵感清单：收藏的笔记 / 收藏的页面数（同一口径的总量） */
  idea: { total: number; pages: number }
  /** 草稿箱：回收站里的笔记 / 总数 */
  draft: { total: number; pages: number }
}>()

const TREND_H = 30

/**
 * 迷你趋势线：把序列画成折线 + 面积。
 * 这里数据点少（7~12 个），用直线段即可，不需要首页大图那套贝塞尔平滑。
 */
function sparkPath(points: TrendPoint[]) {
  if (!points.length) return { line: '', area: '' }
  const max = Math.max(1, ...points.map((p) => p.count))
  const step = points.length > 1 ? 100 / (points.length - 1) : 0
  const pts = points.map((p, i) => ({
    x: i * step,
    y: TREND_H - 3 - (p.count / max) * (TREND_H - 6),
  }))
  let d = `M${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    d += ` L${pts[i]!.x.toFixed(1)},${pts[i]!.y.toFixed(1)}`
  }
  return { line: d, area: `${d} L100,${TREND_H} L0,${TREND_H} Z` }
}

const weekSpark = computed(() => sparkPath(props.week.points))
const monthSpark = computed(() => sparkPath(props.month.points))

const weekDelta = computed(() => deltaPercent(props.week.current, props.week.previous))
const monthDelta = computed(() => deltaPercent(props.month.current, props.month.previous))

/**
 * 裁剪区域 id：折线从左往右画出时用它做「扫过」遮罩。
 * 用 useId 保证同一页面多个实例不会撞 id。
 */
const uid = useId()
const weekClipId = `sc-clip-week-${uid}`
const monthClipId = `sc-clip-month-${uid}`
</script>

<template>
  <section class="sc-wrap">
    <div class="sc-grid">
      <article class="sc-card">
        <div class="sc-head">
          <span class="sc-label">{{ t('home.weekPublish') }}</span>
          <span class="sc-delta" :class="weekDelta > 0 ? 'up' : weekDelta < 0 ? 'down' : 'flat'">
            <ArrowUpRight v-if="weekDelta > 0" :size="12" :stroke-width="2.4" />
            <ArrowDownRight v-else-if="weekDelta < 0" :size="12" :stroke-width="2.4" />
            <template v-if="weekDelta !== 0">{{ Math.abs(weekDelta) }}%</template>
            <template v-else>{{ t('home.flat') }}</template>
          </span>
        </div>
        <div class="sc-num">{{ week.current }}</div>
        <!-- key 绑路径数据：数据是异步到的，路径从空变成有值时整段 SVG 重建，动画重新播放一次 -->
        <svg
          :key="weekSpark.line"
          class="sc-spark"
          :viewBox="`0 0 100 ${TREND_H}`"
          preserveAspectRatio="none"
        >
          <defs>
            <clipPath :id="weekClipId">
              <rect class="sc-spark-reveal" x="0" y="0" width="100" :height="TREND_H" />
            </clipPath>
          </defs>
          <g :clip-path="`url(#${weekClipId})`">
            <path :d="weekSpark.area" class="sc-spark-area" />
            <path :d="weekSpark.line" class="sc-spark-line" />
          </g>
        </svg>
        <div class="sc-foot">{{ t('home.weekTrend') }}</div>
      </article>

      <article class="sc-card">
        <div class="sc-head">
          <span class="sc-label">{{ t('home.monthPublish') }}</span>
          <span class="sc-delta" :class="monthDelta > 0 ? 'up' : monthDelta < 0 ? 'down' : 'flat'">
            <ArrowUpRight v-if="monthDelta > 0" :size="12" :stroke-width="2.4" />
            <ArrowDownRight v-else-if="monthDelta < 0" :size="12" :stroke-width="2.4" />
            <template v-if="monthDelta !== 0">{{ Math.abs(monthDelta) }}%</template>
            <template v-else>{{ t('home.flat') }}</template>
          </span>
        </div>
        <div class="sc-num">{{ month.current }}</div>
        <svg
          :key="monthSpark.line"
          class="sc-spark"
          :viewBox="`0 0 100 ${TREND_H}`"
          preserveAspectRatio="none"
        >
          <defs>
            <clipPath :id="monthClipId">
              <rect class="sc-spark-reveal" x="0" y="0" width="100" :height="TREND_H" />
            </clipPath>
          </defs>
          <g :clip-path="`url(#${monthClipId})`">
            <path :d="monthSpark.area" class="sc-spark-area" />
            <path :d="monthSpark.line" class="sc-spark-line" />
          </g>
        </svg>
        <div class="sc-foot">{{ t('home.monthTrend') }}</div>
      </article>
    </div>

    <div class="sc-mini">
      <article class="sm-card">
        <div class="sm-icon inbox">✉</div>
        <div class="sm-body">
          <div class="sm-num">{{ inbox.unread }}</div>
          <div class="sm-label">{{ t('home.inbox') }}</div>
        </div>
        <div class="sm-extra">
          <div>{{ t('home.inboxUnread', { n: inbox.unread }) }}</div>
          <div>{{ t('home.inboxTotal', { n: inbox.total }) }}</div>
        </div>
      </article>

      <article class="sm-card">
        <div class="sm-icon idea">✦</div>
        <div class="sm-body">
          <div class="sm-num">{{ idea.total }}</div>
          <div class="sm-label">{{ t('home.ideas') }}</div>
        </div>
        <div class="sm-extra">
          <div>{{ t('home.ideaTotal', { n: idea.total }) }}</div>
          <div>{{ t('home.ideaPages', { n: idea.pages }) }}</div>
        </div>
      </article>

      <article class="sm-card">
        <div class="sm-icon draft">✎</div>
        <div class="sm-body">
          <div class="sm-num">{{ draft.total }}</div>
          <div class="sm-label">{{ t('home.drafts') }}</div>
        </div>
        <div class="sm-extra">
          <div>{{ t('home.draftTotal', { n: draft.total }) }}</div>
          <div>{{ t('home.draftPages', { n: draft.pages }) }}</div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.sc-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.sc-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 13px 10px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
}
.sc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.sc-label {
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.sc-delta {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 10.5px;
  font-weight: 600;
}
.sc-delta.up {
  color: var(--gn-accent);
}
.sc-delta.down {
  color: var(--gn-danger);
}
.sc-delta.flat {
  color: var(--gn-text-muted);
}
.sc-num {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.03em;
  color: var(--gn-text);
  line-height: 1.15;
}
.sc-spark {
  width: 100%;
  height: 30px;
  display: block;
  overflow: visible;
}
/**
 * 折线「从左到右」画出来：
 * 用一个裁剪矩形罩住图表，矩形从 0 宽横向拉开（scaleX 0→1），
 * 线和填充区域就跟着被逐步揭示出来。
 * 每个月度卡片的动画错开一点延迟，避免两张卡同时动显得僵硬。
 */
.sc-spark-reveal {
  transform-box: view-box;
  transform-origin: left center;
  animation: sc-sweep 0.85s cubic-bezier(0.22, 0.65, 0.3, 1) both;
}
.sc-card:nth-child(2) .sc-spark-reveal {
  animation-delay: 0.12s;
}
@keyframes sc-sweep {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
/* 尊重「减少动态效果」的系统偏好：不画动画，直接呈现完整图表 */
@media (prefers-reduced-motion: reduce) {
  .sc-spark-reveal {
    animation: none;
  }
}
.sc-spark-area {
  fill: color-mix(in srgb, var(--gn-accent) 14%, transparent);
  stroke: none;
}
.sc-spark-line {
  fill: none;
  stroke: var(--gn-accent);
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.sc-foot {
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
.sc-mini {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.sm-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 12px 10px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
}
.sm-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  font-size: 12.5px;
  line-height: 1;
}
.sm-icon.inbox {
  background: color-mix(in srgb, #5b8def 16%, transparent);
  color: #5b8def;
}
.sm-icon.idea {
  background: color-mix(in srgb, #e8a33d 18%, transparent);
  color: #d08c1f;
}
.sm-icon.draft {
  background: color-mix(in srgb, #3fae8c 16%, transparent);
  color: #2f9074;
}
.sm-body {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.sm-num {
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.03em;
  color: var(--gn-text);
}
.sm-label {
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.sm-extra {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 10.5px;
  color: var(--gn-text-muted);
  line-height: 1.5;
}
</style>
