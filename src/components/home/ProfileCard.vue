<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Bell,
  Github,
  Star,
  Trash2,
  Users,
  UserRound,
  Pencil,
  Check,
  X,
} from 'lucide-vue-next'
import { displayName, goFriends, goTeams, goTrash, store } from '@/store'
import { userState, saveProfileBio } from '@/userState'
import { t } from '@/i18n'
import { dayKey } from '@/home/metrics'

const props = defineProps<{
  /** 每日活跃度（近 30 天），用于底部柱状图 */
  activity: { key: string; count: number }[]
  /** 本月活跃天数 */
  activeDays: number
  /** 本月活跃次数 */
  activeCount: number
  /** 概览：笔记数 / 收藏数 / 字数 */
  overview: { pages: number; favorite: number; words: number }
  /** 全年活跃天数 */
  yearActiveDays: number
  /** 全年最长连续记录天数 */
  yearStreak: number
  /** 全年月度峰值（次数 + 峰值所在月） */
  yearPeak: { count: number; month: number }
  /** 统计年份 */
  year: number
}>()

const editing = ref(false)
const draft = ref('')
const saving = ref(false)

const bio = computed(() => userState.profile.bio)
const avatar = computed(() => store.user?.avatar ?? null)
const initial = computed(() => (displayName.value || '?').slice(0, 1).toUpperCase())

const peak = computed(() => Math.max(1, ...props.activity.map((a) => a.count)))

/**
 * 快捷入口。
 *
 * 原设计稿这里是六个社交平台图标，本项目没有社交账号体系，
 * 所以换成产品内真实存在的入口：通知、好友、团队、资料、回收站、GitHub 主页。
 */
const links = computed(() => {
  const out: { key: string; icon: unknown; label: string; color: string; run: () => void }[] = []
  out.push({
    key: 'notify',
    icon: Bell,
    label: t('home.linkNotify'),
    color: '#e8a33d',
    run: () => {
      store.settingsOpen = true
      store.settingsSection = 'notify'
    },
  })
  out.push({
    key: 'friends',
    icon: UserRound,
    label: t('home.linkFriends'),
    color: '#5b8def',
    run: goFriends,
  })
  out.push({
    key: 'teams',
    icon: Users,
    label: t('home.linkTeams'),
    color: '#3fae8c',
    run: goTeams,
  })
  out.push({
    key: 'profile',
    icon: Star,
    label: t('home.linkProfile'),
    color: '#d9773c',
    run: () => {
      store.settingsOpen = true
      store.settingsSection = 'account'
    },
  })
  out.push({
    key: 'trash',
    icon: Trash2,
    label: t('home.linkTrash'),
    color: '#c96a6a',
    run: goTrash,
  })
  const gh = store.user?.github
  if (gh) {
    out.push({
      key: 'github',
      icon: Github,
      label: gh,
      color: '#4a5568',
      run: () => window.open(`https://github.com/${gh}`, '_blank', 'noopener'),
    })
  }
  return out
})

function startEdit() {
  draft.value = bio.value
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  draft.value = ''
}

async function saveEdit() {
  saving.value = true
  try {
    await saveProfileBio(draft.value.trim())
    editing.value = false
  } finally {
    saving.value = false
  }
}

/** 最近 30 天的活跃日期（用于柱状图上标出今天） */
const todayKey = dayKey(Date.now())
</script>

<template>
  <section class="pc-card">
    <!-- 头部：头像 + 名字 + 简介合成一组，组内紧凑排布 -->
    <div class="pc-head">
      <div class="pc-avatar">
        <img v-if="avatar" :src="avatar" alt="" />
        <span v-else>{{ initial }}</span>
      </div>

      <h2 class="pc-name">{{ displayName || t('app.untitled') }}</h2>

      <div class="pc-bio">
        <p v-if="!editing" class="pc-bio-text" :class="{ empty: !bio }" @click="startEdit">
          {{ bio || t('home.bioEmpty') }}
        </p>
        <textarea
          v-else
          v-model="draft"
          class="pc-bio-input"
          rows="2"
          maxlength="120"
          :placeholder="t('home.bioPlaceholder')"
          autofocus
          @keydown.enter.exact.prevent="saveEdit"
          @keydown.esc.prevent="cancelEdit"
          @blur="saveEdit"
        ></textarea>
        <div v-if="editing" class="pc-bio-actions">
          <button class="pc-bio-ok" :disabled="saving" @mousedown.prevent @click="saveEdit">
            <Check :size="12" :stroke-width="2.4" />{{ t('home.bioSave') }}
          </button>
          <button class="pc-bio-cancel" @mousedown.prevent @click="cancelEdit">
            <X :size="12" :stroke-width="2.2" />{{ t('home.bioCancel') }}
          </button>
        </div>
        <button v-else class="pc-bio-edit" :title="t('home.bioEdit')" @click="startEdit">
          <Pencil :size="11" :stroke-width="2" />
        </button>
      </div>
    </div>

    <div class="pc-links">
      <button
        v-for="l in links"
        :key="l.key"
        class="pc-link"
        v-tooltip="l.label"
        @click="l.run"
      >
        <component :is="l.icon" :size="15" :stroke-width="1.9" />
      </button>
    </div>

    <div class="pc-activity">
      <div class="pc-act-head">
        <span class="pc-act-label">{{ t('home.activity') }}</span>
        <span class="pc-act-value">{{ activeCount }}</span>
      </div>
      <div class="pc-bars">
        <span
          v-for="a in activity"
          :key="a.key"
          class="pc-bar"
          :class="{ today: a.key === todayKey }"
          :style="{ height: `${Math.max(6, (a.count / peak) * 100)}%` }"
          :title="`${a.key} · ${a.count}`"
        ></span>
      </div>
      <div class="pc-act-foot">
        {{ t('home.activeDays', { n: activeDays }) }}
      </div>
    </div>

    <div class="pc-stats">
      <div class="pc-stat">
        <span class="pc-stat-num">{{ overview.pages }}</span>
        <span class="pc-stat-label">{{ t('home.statPages') }}</span>
      </div>
      <div class="pc-stat">
        <span class="pc-stat-num">{{ overview.favorite }}</span>
        <span class="pc-stat-label">{{ t('home.statFav') }}</span>
      </div>
      <div class="pc-stat">
        <span class="pc-stat-num">{{ overview.words }}</span>
        <span class="pc-stat-label">{{ t('home.statWords') }}</span>
      </div>
    </div>

    <!-- 全年活跃：活跃天数 / 最长连续 / 月峰值 -->
    <div class="pc-year">
      <span class="pc-year-label">{{ t('home.yearRecord', { y: year }) }}</span>
      <div class="pc-year-grid">
        <div class="pc-year-cell">
          <span class="pc-year-num">{{ yearActiveDays }}</span>
          <span class="pc-year-unit">{{ t('home.statActiveDays') }}</span>
        </div>
        <div class="pc-year-cell">
          <span class="pc-year-num">{{ yearStreak }}</span>
          <span class="pc-year-unit">{{ t('home.statStreak') }}</span>
        </div>
        <div class="pc-year-cell" :title="t('home.statPeakMonth', { m: yearPeak.month })">
          <span class="pc-year-num">{{ yearPeak.count }}</span>
          <span class="pc-year-unit">{{ t('home.statPeak') }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pc-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 各内容块均匀分布（沿用原有做法），卡片下方不留空洞。
     头部三块已合并成 .pc-head 组，组内按 gap 紧凑排布 ——
     之前它们是卡片的直接子元素，space-between 把空隙摊到了
     「头像 → 名字」之间，那一段空得最刺眼。 */
  justify-content: space-between;
  gap: 10px;
  padding: 18px 16px 14px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
  flex: 1 1 auto;
  min-height: 0;
}
/**
 * 头部组：头像、名字、简介合成一块。
 *
 * 之前这三块是卡片的直接子元素，卡片用 justify-content: space-between
 * 把剩余高度平均摊到每个缝隙里 —— 头像底部到名字顶部就空出了 50 多像素，
 * 看着像「上面空了一块」。合成一组后组内按 gap 紧凑排布，
 * 剩余高度交给下面的柱状图。
 */
.pc-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  flex: 0 0 auto;
}
.pc-avatar {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gn-accent);
  color: var(--gn-accent-ink);
  font-size: 30px;
  font-weight: 700;
  border: 3px solid var(--gn-bg);
  box-shadow: 0 0 0 2px var(--gn-accent-soft);
}
.pc-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pc-name {
  margin: 0;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--gn-text);
}
.pc-bio {
  position: relative;
  width: 100%;
  min-height: 38px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pc-bio-text {
  margin: 0;
  padding: 0 14px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--gn-text-muted);
  text-align: center;
  cursor: text;
  border-radius: 6px;
  transition: background 0.12s ease;
}
.pc-bio-text:hover {
  background: var(--gn-bg-hover);
}
.pc-bio-text.empty {
  opacity: 0.65;
}
.pc-bio-edit {
  position: absolute;
  right: 0;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease;
}
.pc-bio:hover .pc-bio-edit {
  opacity: 1;
}
.pc-bio-edit:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.pc-bio-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--gn-accent);
  border-radius: 7px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.6;
  resize: none;
  outline: none;
}
.pc-bio-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.pc-bio-ok,
.pc-bio-cancel {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border: none;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
}
.pc-bio-ok {
  background: var(--gn-accent);
  color: var(--gn-accent-ink);
}
.pc-bio-cancel {
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
}
.pc-links {
  /* 快捷入口数量随账号而变（没有 GitHub 主页时是 5 个），
     用 flex 居中排布，5 个 / 6 个都对称，不会像等分网格那样偏在一侧留白 */
  display: flex;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 2px;
  flex: 0 0 auto;
}
.pc-link {
  flex: 0 1 30px;
  width: 30px;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 9px;
  color: #fff;
  cursor: pointer;
  transition: transform 0.14s ease, filter 0.14s ease;
}
.pc-link:hover {
  transform: translateY(-2px);
  filter: brightness(1.06);
}
.pc-link:nth-child(1) {
  background: #e8a33d;
}
.pc-link:nth-child(2) {
  background: #5b8def;
}
.pc-link:nth-child(3) {
  background: #3fae8c;
}
.pc-link:nth-child(4) {
  background: #d9773c;
}
.pc-link:nth-child(5) {
  background: #c96a6a;
}
.pc-link:nth-child(6) {
  background: #4a5568;
}
.pc-activity {
  width: 100%;
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px solid var(--gn-border);
  /* 改成纵向 flex 容器：柱状图必须拿到一个「确定高度」，
     里面的 height:% 才能解析出实际像素。
     之前这里是普通块容器，父高度不定，30 根柱子全被压成 0 高，
     图表整个是空的 —— 视觉上就是「本月活跃」下面一大块空白。 */
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
}
.pc-act-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 6px;
}
.pc-act-label {
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.pc-act-value {
  font-size: 15px;
  font-weight: 650;
  color: var(--gn-accent);
  letter-spacing: -0.01em;
}
.pc-bars {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  /* 固定绘图区高度：柱子必须在一个「确定高度」的容器里，
     height:% 才解析得出来；同时不让它无限长高 ——
     近 30 天往往只有几天有记录，柱子一高就是一孤零零的长条。 */
  flex: 0 1 160px;
  min-height: 92px;
  /* 水平参考线：数据稀疏时，绘图区也是一张完整的图表画布，
     而不是「两根柱子 + 一片空白」。线要淡，不能抢柱子的视线。 */
  background-image: repeating-linear-gradient(
    to top,
    color-mix(in srgb, var(--gn-border) 60%, transparent) 0 1px,
    transparent 1px 40px
  );
  background-repeat: no-repeat;
  background-position: left bottom;
  background-size: 100% 100%;
}
.pc-bar {
  flex: 1 1 0;
  min-width: 0;
  border-radius: 2px 2px 0 0;
  background: var(--gn-accent-soft);
  transition: background 0.12s ease;
}
.pc-bar.today {
  background: var(--gn-accent);
}
.pc-act-foot {
  margin-top: 5px;
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
.pc-stats {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 2px;
  flex: 0 0 auto;
}
.pc-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg-soft);
}
.pc-stat-num {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--gn-text);
}
.pc-stat-label {
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
/* 全年活跃：三个数字并排，作为一整块铺在概览统计下方 */
.pc-year {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--gn-border);
  flex: 0 0 auto;
}
.pc-year-label {
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
.pc-year-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.pc-year-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 2px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg-soft);
}
.pc-year-num {
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--gn-accent);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.pc-year-unit {
  font-size: 10px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
</style>
