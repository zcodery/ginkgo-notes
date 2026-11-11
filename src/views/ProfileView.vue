<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import {
  Bell,
  Bot,
  Box,
  CircleDashed,
  Download,
  Globe,
  Info,
  KeyRound,
  LogOut,
  Plug,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from 'lucide-vue-next'
import UserAvatar from '@/components/UserAvatar.vue'
import GnSelect from '@/components/GnSelect.vue'
import {
  NOTE_FONT_SIZES,
  NOTE_FONT_STYLES,
  NOTE_LAYOUTS,
  NOTE_WIDTH_RATIOS,
  changePassword,
  isAdmin,
  logout,
  setNoteFontSize,
  setNoteFontStyle,
  setNoteLayout,
  setNoteWidthMode,
  setNoteWidthRatio,
  setTheme,
  setTocVisible,
  store,
  trashedPages,
  updateProfile,
  type NoteFontSize,
  type NoteFontStyle,
  type NoteLayout,
  type NoteWidthRatio,
} from '@/store'
import { clearAssetCache } from '@/editor/assets'
import { LOCALES, locale, setLocale, t, type LocaleCode, type MessageKey } from '@/i18n'

type Section =
  | 'account'
  | 'general'
  | 'notify'
  | 'space'
  | 'members'
  | 'share'
  | 'data'
  | 'integrations'
  | 'ai'
  | 'about'

interface NavItem {
  id: Section
  labelKey: MessageKey
  icon: Component
  soon?: boolean
}

const NAV: { groupKey: MessageKey; items: NavItem[] }[] = [
  {
    groupKey: 'settings.groupAccount',
    items: [
      { id: 'account', labelKey: 'settings.account', icon: UserRound },
      { id: 'general', labelKey: 'settings.general', icon: SlidersHorizontal },
      { id: 'notify', labelKey: 'settings.notify', icon: Bell, soon: true },
    ],
  },
  {
    groupKey: 'settings.groupSpace',
    items: [
      { id: 'space', labelKey: 'settings.space', icon: Box },
      { id: 'members', labelKey: 'settings.members', icon: Users, soon: true },
      { id: 'share', labelKey: 'settings.share', icon: Globe, soon: true },
      { id: 'data', labelKey: 'settings.data', icon: Download, soon: true },
    ],
  },
  {
    groupKey: 'settings.groupExt',
    items: [
      { id: 'integrations', labelKey: 'settings.integrations', icon: Plug, soon: true },
      { id: 'ai', labelKey: 'settings.ai', icon: Bot, soon: true },
      { id: 'about', labelKey: 'settings.about', icon: Info },
    ],
  },
]

const section = ref<Section>('account')
const current = computed(() => {
  const item = NAV.flatMap((g) => g.items).find((i) => i.id === section.value)!
  return { ...item, label: t(item.labelKey) }
})

interface RoadmapKeys {
  desc: MessageKey
  features: { title: MessageKey; desc: MessageKey }[]
}

const ROADMAPS: Partial<Record<Section, RoadmapKeys>> = {
  notify: {
    desc: 'settings.roadmapNotifyDesc',
    features: [
      { title: 'settings.roadmapNotify1Title', desc: 'settings.roadmapNotify1Desc' },
      { title: 'settings.roadmapNotify2Title', desc: 'settings.roadmapNotify2Desc' },
      { title: 'settings.roadmapNotify3Title', desc: 'settings.roadmapNotify3Desc' },
    ],
  },
  members: {
    desc: 'settings.roadmapMembersDesc',
    features: [
      { title: 'settings.roadmapMembers1Title', desc: 'settings.roadmapMembers1Desc' },
      { title: 'settings.roadmapMembers2Title', desc: 'settings.roadmapMembers2Desc' },
      { title: 'settings.roadmapMembers3Title', desc: 'settings.roadmapMembers3Desc' },
    ],
  },
  share: {
    desc: 'settings.roadmapShareDesc',
    features: [
      { title: 'settings.roadmapShare1Title', desc: 'settings.roadmapShare1Desc' },
      { title: 'settings.roadmapShare2Title', desc: 'settings.roadmapShare2Desc' },
      { title: 'settings.roadmapShare3Title', desc: 'settings.roadmapShare3Desc' },
    ],
  },
  data: {
    desc: 'settings.roadmapDataDesc',
    features: [
      { title: 'settings.roadmapData1Title', desc: 'settings.roadmapData1Desc' },
      { title: 'settings.roadmapData2Title', desc: 'settings.roadmapData2Desc' },
      { title: 'settings.roadmapData3Title', desc: 'settings.roadmapData3Desc' },
    ],
  },
  integrations: {
    desc: 'settings.roadmapIntegrationsDesc',
    features: [
      { title: 'settings.roadmapIntegrations1Title', desc: 'settings.roadmapIntegrations1Desc' },
      { title: 'settings.roadmapIntegrations2Title', desc: 'settings.roadmapIntegrations2Desc' },
      { title: 'settings.roadmapIntegrations3Title', desc: 'settings.roadmapIntegrations3Desc' },
    ],
  },
  ai: {
    desc: 'settings.roadmapAiDesc',
    features: [
      { title: 'settings.roadmapAi1Title', desc: 'settings.roadmapAi1Desc' },
      { title: 'settings.roadmapAi2Title', desc: 'settings.roadmapAi2Desc' },
      { title: 'settings.roadmapAi3Title', desc: 'settings.roadmapAi3Desc' },
    ],
  },
}

const roadmap = computed(() => {
  const keys = ROADMAPS[section.value]
  if (!keys) return null
  return {
    desc: t(keys.desc),
    features: keys.features.map((f) => ({ title: t(f.title), desc: t(f.desc) })),
  }
})

/* ---------------- 账号设置 ---------------- */

const user = computed(() => store.user)
const nicknameDraft = ref(user.value?.nickname ?? '')
watch(
  () => user.value?.nickname,
  (v) => (nicknameDraft.value = v ?? ''),
)
const dirty = computed(() => (nicknameDraft.value.trim() || null) !== (user.value?.nickname ?? null))

const saving = ref(false)
const toast = ref<{ type: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | null = null

function notify(type: 'ok' | 'err', text: string) {
  toast.value = { type, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2200)
}

async function saveProfile() {
  if (!dirty.value) return
  saving.value = true
  try {
    await updateProfile({ nickname: nicknameDraft.value.trim() || null })
    notify('ok', t('settings.saved'))
  } catch (e) {
    notify('err', e instanceof Error ? e.message : t('settings.saveFail'))
  } finally {
    saving.value = false
  }
}

function cancelProfile() {
  nicknameDraft.value = user.value?.nickname ?? ''
}

const avatarInput = ref<HTMLInputElement | null>(null)
const avatarBusy = ref(false)

/** 压成 160px 方图，控制体积 */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const S = 160
      const c = document.createElement('canvas')
      c.width = S
      c.height = S
      const ctx = c.getContext('2d')!
      const side = Math.min(img.width, img.height)
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.86))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t('settings.avatarReadFail')))
    }
    img.src = url
  })
}

async function onAvatarPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) return notify('err', t('settings.avatarPickImage'))
  avatarBusy.value = true
  try {
    await updateProfile({ avatar: await shrinkImage(file) })
    notify('ok', t('settings.avatarUpdated'))
  } catch (err) {
    notify('err', err instanceof Error ? err.message : t('settings.uploadFail'))
  } finally {
    avatarBusy.value = false
  }
}

async function removeAvatar() {
  avatarBusy.value = true
  try {
    await updateProfile({ avatar: null })
    notify('ok', t('settings.avatarRemoved'))
  } catch (err) {
    notify('err', err instanceof Error ? err.message : t('settings.opFail'))
  } finally {
    avatarBusy.value = false
  }
}

const createdLabel = computed(() => formatTime(user.value?.createdAt))

function formatTime(ts?: number | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* 修改密码弹窗 */
const pwdOpen = ref(false)
const pwd = ref({ current: '', next: '', confirm: '' })
const pwdErr = ref('')
const pwdSaving = ref(false)

function openPwd() {
  pwd.value = { current: '', next: '', confirm: '' }
  pwdErr.value = ''
  pwdOpen.value = true
}

async function submitPwd() {
  pwdErr.value = ''
  const { current, next, confirm } = pwd.value
  if (!current || !next) return void (pwdErr.value = t('settings.pwdFillBoth'))
  if (next.length < 6) return void (pwdErr.value = t('settings.pwdTooShort'))
  if (next !== confirm) return void (pwdErr.value = t('settings.pwdMismatch'))
  pwdSaving.value = true
  try {
    await changePassword(current, next)
    pwdOpen.value = false
    notify('ok', t('settings.pwdUpdated'))
  } catch (e) {
    pwdErr.value = e instanceof Error ? e.message : t('settings.pwdFail')
  } finally {
    pwdSaving.value = false
  }
}

/** 规划中的账号能力，统一展示为「即将上线」 */
const SOON_ACCOUNT: { label: MessageKey; desc: MessageKey; action: MessageKey }[] = [
  { label: 'settings.email', desc: 'settings.emailDesc', action: 'settings.bindEmail' },
  { label: 'settings.phone', desc: 'settings.phoneDesc', action: 'settings.bindPhone' },
  { label: 'settings.devices', desc: 'settings.devicesDesc', action: 'settings.manage' },
  { label: 'settings.pin', desc: 'settings.pinDesc', action: 'settings.addPin' },
  { label: 'settings.twoFactor', desc: 'settings.twoFactorDesc', action: 'settings.enable' },
  { label: 'settings.thirdParty', desc: 'settings.thirdPartyDesc', action: 'settings.bind' },
]

const LAYOUT_LABEL: Record<NoteLayout, MessageKey> = {
  loose: 'settings.layoutLoose',
  default: 'settings.layoutDefault',
  compact: 'settings.layoutCompact',
}

/* ---------------- 通用设置 ---------------- */

const widthValue = computed({
  get: () => (store.noteWidthMode === 'auto' ? 'auto' : String(store.noteWidthRatio)),
  set: (v: string) => {
    if (v === 'auto') setNoteWidthMode('auto')
    else {
      setNoteWidthMode('fixed')
      setNoteWidthRatio(Number(v) as NoteWidthRatio)
    }
  },
})

const widthOptions = computed(() => [
  { value: 'auto', label: t('settings.widthAuto') },
  ...NOTE_WIDTH_RATIOS.map((r) => ({ value: String(r), label: `${r}%` })),
])

const fontSizeValue = computed({
  get: () => String(store.noteFontSize),
  set: (v: string) => setNoteFontSize(Number(v) as NoteFontSize),
})

const fontSizeOptions = NOTE_FONT_SIZES.map((s) => ({ value: String(s), label: `${s}px` }))

const fontStyleValue = computed({
  get: () => store.noteFontStyle,
  set: (v: string) => setNoteFontStyle(v as NoteFontStyle),
})

const fontStyleOptions = NOTE_FONT_STYLES.map((f) => ({
  value: f.id,
  label: f.label,
  style: { fontFamily: f.css },
}))

const langOptions = LOCALES.map((l) => ({ value: l.code, label: l.label }))
const langValue = computed({
  get: () => locale.value,
  set: (v: string) => setLocale(v as LocaleCode),
})

/* ---------------- 空间信息 ---------------- */

const livePages = computed(() => store.pages.filter((p) => !p.trashed))
const stats = computed(() => {
  const pages = livePages.value
  const words = pages.reduce((n, p) => n + (p.content?.replace(/\s/g, '').length ?? 0), 0)
  const last = pages.reduce((m, p) => Math.max(m, p.updatedAt), 0)
  return {
    pages: pages.length,
    favorites: pages.filter((p) => p.favorite).length,
    trashed: trashedPages.value.length,
    words,
    last: formatTime(last || null),
  }
})

/* ---------------- 底部 ---------------- */

function clearCacheAndReload() {
  if (!window.confirm(t('settings.clearCacheConfirm'))) return
  clearAssetCache()
  try {
    localStorage.removeItem('ginkgo-expanded')
  } catch {
    /* ignore */
  }
  window.location.reload()
}

const APP_VERSION = '0.2.0'

function close() {
  store.settingsOpen = false
}

function onLogout() {
  close()
  void logout()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  if (pwdOpen.value) pwdOpen.value = false
  else close()
}

onMounted(() => document.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="pf-overlay gn-fade" @mousedown.self="close">
  <div class="pf gn-pop" role="dialog" :aria-label="t('settings.title')">
    <button type="button" class="pf-close gn-icon-btn" v-tooltip="t('settings.close')" @click="close">
      <X :size="15" :stroke-width="1.9" />
    </button>
    <!-- 左侧设置导航 -->
    <nav class="pf-nav gn-scroll">
      <div v-for="g in NAV" :key="g.groupKey" class="pf-group">
        <div class="pf-group-title">{{ t(g.groupKey) }}</div>
        <button
          v-for="item in g.items"
          :key="item.id"
          type="button"
          class="pf-nav-item"
          :class="{ on: section === item.id }"
          @click="section = item.id"
        >
          <component :is="item.icon" :size="15" :stroke-width="1.8" />
          <span>{{ t(item.labelKey) }}</span>
          <i v-if="item.soon" class="pf-dot" v-tooltip="t('settings.soon')"></i>
        </button>
      </div>

      <div class="pf-nav-foot">
        <button type="button" class="pf-nav-item" @click="onLogout">
          <LogOut :size="15" :stroke-width="1.8" /><span>{{ t('settings.logout') }}</span>
        </button>
        <button type="button" class="pf-nav-link" @click="clearCacheAndReload">
          <RefreshCw :size="12" :stroke-width="2" />{{ t('settings.clearCache') }}
        </button>
      </div>
    </nav>

    <!-- 右侧内容 -->
    <section class="pf-main">
      <div class="pf-scroll gn-scroll">
        <h1 class="pf-title">{{ current.label }}</h1>

        <!-- 账号设置 -->
        <template v-if="section === 'account'">
          <div class="pf-block">
            <div class="pf-label">{{ t('settings.avatar') }}</div>
            <div class="pf-row-flex">
              <UserAvatar :size="56" :radius="28" />
              <div class="pf-actions">
                <button
                  v-if="user?.avatar"
                  type="button"
                  class="pf-btn"
                  :disabled="avatarBusy"
                  @click="removeAvatar"
                >
                  {{ t('settings.removeAvatar') }}
                </button>
                <button type="button" class="pf-btn" :disabled="avatarBusy" @click="avatarInput?.click()">
                  {{ avatarBusy ? t('settings.processing') : t('settings.uploadAvatar') }}
                </button>
                <input
                  ref="avatarInput"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  @change="onAvatarPick"
                />
              </div>
            </div>
          </div>

          <div class="pf-block">
            <div class="pf-label">{{ t('settings.nickname') }}</div>
            <input
              v-model="nicknameDraft"
              class="pf-input"
              maxlength="32"
              :placeholder="user?.username"
              @keydown.enter="saveProfile"
            />
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.username') }}</div>
              <div class="pf-row-desc">{{ t('settings.usernameDesc') }}</div>
            </div>
            <span class="pf-value">{{ user?.username }}</span>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.role') }}</div>
              <div class="pf-row-desc">{{ t('settings.registeredAt', { time: createdLabel }) }}</div>
            </div>
            <span class="pf-tag" :class="{ admin: isAdmin }">{{
              isAdmin ? t('settings.admin') : t('settings.user')
            }}</span>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.password') }}</div>
              <div class="pf-row-desc">{{ t('settings.passwordDesc') }}</div>
            </div>
            <button type="button" class="pf-btn" @click="openPwd">
              <KeyRound :size="12" :stroke-width="2" />{{ t('settings.changePassword') }}
            </button>
          </div>

          <div v-for="s in SOON_ACCOUNT" :key="s.label" class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t(s.label) }}<span class="pf-soon">{{ t('settings.soon') }}</span></div>
              <div class="pf-row-desc">{{ t(s.desc) }}</div>
            </div>
            <button type="button" class="pf-btn" disabled>{{ t(s.action) }}</button>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title danger">
                {{ t('settings.deleteAccount') }}<span class="pf-soon">{{ t('settings.soon') }}</span>
              </div>
              <div class="pf-row-desc">{{ t('settings.deleteAccountDesc') }}</div>
            </div>
            <button type="button" class="pf-btn danger" disabled>{{ t('settings.deleteAction') }}</button>
          </div>
        </template>

        <!-- 通用设置 -->
        <template v-else-if="section === 'general'">
          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.appearance') }}</div>
              <div class="pf-row-desc">{{ t('settings.appearanceDesc') }}</div>
            </div>
            <div class="pf-seg">
              <button type="button" :class="{ on: store.theme === 'light' }" @click="setTheme('light', $event)">
                {{ t('settings.light') }}
              </button>
              <button type="button" :class="{ on: store.theme === 'dark' }" @click="setTheme('dark', $event)">
                {{ t('settings.dark') }}
              </button>
            </div>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.width') }}</div>
              <div class="pf-row-desc">{{ t('settings.widthDesc') }}</div>
            </div>
            <GnSelect v-model="widthValue" :options="widthOptions" :min-width="108" />
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.fontSize') }}</div>
            </div>
            <GnSelect v-model="fontSizeValue" :options="fontSizeOptions" :min-width="88" />
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.fontStyle') }}</div>
            </div>
            <GnSelect v-model="fontStyleValue" :options="fontStyleOptions" :min-width="96" />
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.layout') }}</div>
              <div class="pf-row-desc">{{ t('settings.layoutDesc') }}</div>
            </div>
            <div class="pf-seg">
              <button
                v-for="l in NOTE_LAYOUTS"
                :key="l.id"
                type="button"
                :class="{ on: store.noteLayout === l.id }"
                @click="setNoteLayout(l.id as NoteLayout)"
              >
                {{ t(LAYOUT_LABEL[l.id]) }}
              </button>
            </div>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.toc') }}</div>
              <div class="pf-row-desc">{{ t('settings.tocDesc') }}</div>
            </div>
            <button
              type="button"
              class="pf-switch"
              :class="{ on: store.tocVisible }"
              @click="setTocVisible(!store.tocVisible)"
            >
              <i></i>
            </button>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.language') }}</div>
              <div class="pf-row-desc">{{ t('settings.languageDesc') }}</div>
            </div>
            <GnSelect v-model="langValue" :options="langOptions" :min-width="120" />
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">
                {{ t('settings.shortcuts') }}<span class="pf-soon">{{ t('settings.soon') }}</span>
              </div>
              <div class="pf-row-desc">{{ t('settings.shortcutsDesc') }}</div>
            </div>
            <button type="button" class="pf-btn" disabled>{{ t('settings.set') }}</button>
          </div>
        </template>

        <!-- 空间信息 -->
        <template v-else-if="section === 'space'">
          <div class="pf-stats">
            <div class="pf-stat"><b>{{ stats.pages }}</b><span>{{ t('settings.spacePages') }}</span></div>
            <div class="pf-stat"><b>{{ stats.favorites }}</b><span>{{ t('settings.spaceFavorites') }}</span></div>
            <div class="pf-stat"><b>{{ stats.trashed }}</b><span>{{ t('settings.spaceTrash') }}</span></div>
            <div class="pf-stat">
              <b>{{ stats.words.toLocaleString() }}</b><span>{{ t('settings.spaceWords') }}</span>
            </div>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.currentSpace') }}</div>
              <div class="pf-row-desc">{{ t('settings.currentSpaceDesc') }}</div>
            </div>
            <span class="pf-value">{{
              store.space === 'public' ? t('settings.publicDraft') : t('settings.myNotes')
            }}</span>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ t('settings.lastEdited') }}</div>
            </div>
            <span class="pf-value">{{ stats.last }}</span>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">
                {{ t('settings.spaceNameIcon') }}<span class="pf-soon">{{ t('settings.soon') }}</span>
              </div>
              <div class="pf-row-desc">{{ t('settings.spaceNameIconDesc') }}</div>
            </div>
            <button type="button" class="pf-btn" disabled>{{ t('settings.edit') }}</button>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">
                {{ t('settings.storage') }}<span class="pf-soon">{{ t('settings.soon') }}</span>
              </div>
              <div class="pf-row-desc">{{ t('settings.storageDesc') }}</div>
            </div>
            <button type="button" class="pf-btn" disabled>{{ t('settings.view') }}</button>
          </div>
        </template>

        <!-- 关于 -->
        <template v-else-if="section === 'about'">
          <div class="pf-about">
            <span class="pf-about-logo">🍃</span>
            <div>
              <div class="pf-about-name">{{ t('app.name') }}</div>
              <div class="pf-row-desc">{{ t('settings.aboutVersion', { version: APP_VERSION }) }}</div>
            </div>
          </div>
          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">
                {{ t('settings.checkUpdate') }}<span class="pf-soon">{{ t('settings.soon') }}</span>
              </div>
            </div>
            <button type="button" class="pf-btn" disabled>{{ t('settings.check') }}</button>
          </div>
          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">
                {{ t('settings.feedback') }}<span class="pf-soon">{{ t('settings.soon') }}</span>
              </div>
              <div class="pf-row-desc">{{ t('settings.feedbackDesc') }}</div>
            </div>
            <button type="button" class="pf-btn" disabled>{{ t('settings.feedbackAction') }}</button>
          </div>
        </template>

        <!-- 规划中的模块 -->
        <template v-else-if="roadmap">
          <div class="pf-hero">
            <span class="pf-hero-icon">
              <component :is="current.icon" :size="18" :stroke-width="1.8" />
            </span>
            <div class="pf-hero-text">
              <div class="pf-hero-title">
                {{ current.label }}<span class="pf-soon">{{ t('settings.soon') }}</span>
              </div>
              <p>{{ roadmap.desc }}</p>
            </div>
          </div>

          <div class="pf-sub">{{ t('settings.plannedCaps') }}</div>
          <div v-for="f in roadmap.features" :key="f.title" class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">
                <CircleDashed :size="13" :stroke-width="2" class="pf-plan-icon" />{{ f.title }}
              </div>
              <div class="pf-row-desc indent">{{ f.desc }}</div>
            </div>
            <span class="pf-plan-tag">{{ t('settings.planned') }}</span>
          </div>

          <p class="pf-note">{{ t('settings.plannedNote') }}</p>
        </template>
      </div>

      <!-- 底部保存条：仅账号设置且有改动时 -->
      <footer v-if="section === 'account'" class="pf-foot">
        <button type="button" class="pf-btn primary" :disabled="!dirty || saving" @click="saveProfile">
          {{ saving ? t('settings.saving') : t('settings.save') }}
        </button>
        <button type="button" class="pf-btn" :disabled="!dirty || saving" @click="cancelProfile">
          {{ t('settings.cancel') }}
        </button>
        <span v-if="toast" class="pf-toast" :class="toast.type">{{ toast.text }}</span>
      </footer>
      <span v-else-if="toast" class="pf-toast floating" :class="toast.type">{{ toast.text }}</span>
    </section>

    <!-- 修改密码 -->
    <div v-if="pwdOpen" class="pf-mask gn-fade" @mousedown.self="pwdOpen = false">
      <form class="pf-dialog gn-pop" @submit.prevent="submitPwd">
        <header>
          <span>{{ t('settings.changePassword') }}</span>
          <button type="button" class="gn-icon-btn" @click="pwdOpen = false"><X :size="14" /></button>
        </header>
        <label>
          {{ t('settings.pwdCurrent') }}
          <input v-model="pwd.current" type="password" autocomplete="current-password" />
        </label>
        <label>
          {{ t('settings.pwdNew') }}
          <input v-model="pwd.next" type="password" autocomplete="new-password" />
        </label>
        <label>
          {{ t('settings.pwdConfirm') }}
          <input v-model="pwd.confirm" type="password" autocomplete="new-password" />
        </label>
        <p v-if="pwdErr" class="pf-err">{{ pwdErr }}</p>
        <footer>
          <button type="button" class="pf-btn" @click="pwdOpen = false">{{ t('settings.cancel') }}</button>
          <button type="submit" class="pf-btn primary" :disabled="pwdSaving">
            {{ pwdSaving ? t('settings.saving') : t('settings.pwdConfirmBtn') }}
          </button>
        </footer>
      </form>
    </div>
  </div>
  </div>
</template>

<style scoped>
.pf-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(20, 20, 18, 0.42);
}
.pf {
  position: relative;
  width: min(880px, 100%);
  height: min(760px, calc(100vh - 40px));
  display: flex;
  overflow: hidden;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 14px;
  box-shadow: var(--gn-shadow-lg);
  font-size: 13px;
}
.pf-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
}

/* 左侧导航 */
.pf-nav {
  width: 196px;
  flex: 0 0 196px;
  display: flex;
  flex-direction: column;
  padding: 14px 8px 10px;
  background: var(--gn-bg-sidebar);
  border-right: 1px solid var(--gn-border);
  overflow-y: auto;
}
.pf-group + .pf-group {
  margin-top: 10px;
}
.pf-group-title {
  padding: 0 8px 4px;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.pf-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.pf-nav-item:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.pf-nav-item.on {
  background: var(--gn-bg-active);
  color: var(--gn-text);
  font-weight: 560;
}
.pf-nav-item span {
  flex: 1 1 auto;
}
.pf-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--gn-border-strong);
}
.pf-nav-foot {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--gn-border);
}
.pf-nav-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 8px 8px 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--gn-text-muted);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
}
.pf-nav-link:hover {
  color: var(--gn-text-soft);
}

/* 右侧 */
.pf-main {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.pf-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 36px 24px;
}
.pf-scroll > * {
  max-width: 680px;
}
.pf-title {
  margin: 0 0 14px;
  font-size: 15px;
  font-weight: 600;
}
.pf-block {
  padding: 12px 0;
  border-bottom: 1px solid var(--gn-border);
}
.pf-label {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--gn-text);
}
.pf-row-flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.pf-actions {
  display: flex;
  gap: 8px;
}
.pf-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--gn-bg-hover);
  color: var(--gn-text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.pf-input:focus {
  background: var(--gn-bg);
  border-color: var(--gn-border-strong);
}

.pf-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 48px;
  padding: 8px 0;
  border-bottom: 1px solid var(--gn-border);
}
.pf-row-text {
  min-width: 0;
}
.pf-row-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--gn-text);
}
.pf-row-title.danger {
  color: var(--gn-danger);
}
.pf-row-desc {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.pf-value {
  font-size: 12.5px;
  color: var(--gn-text-soft);
}
.pf-soon {
  padding: 0 5px;
  height: 16px;
  line-height: 16px;
  border-radius: 4px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-muted);
  font-size: 10.5px;
  font-weight: 500;
}
.pf-tag {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
  font-size: 11.5px;
}
.pf-tag.admin {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}

/* 按钮 */
.pf-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12.5px;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
}
.pf-btn:hover:not(:disabled) {
  background: var(--gn-bg-hover);
}
.pf-btn:disabled {
  color: var(--gn-text-muted);
  cursor: not-allowed;
  opacity: 0.7;
}
.pf-btn.primary {
  border-color: transparent;
  background: #3b82f6;
  color: #fff;
}
.pf-btn.primary:hover:not(:disabled) {
  background: #2f74e6;
}
.pf-btn.primary:disabled {
  opacity: 0.5;
  color: #fff;
}
.pf-btn.danger {
  color: var(--gn-danger);
}

.pf-seg {
  display: inline-flex;
  padding: 2px;
  border-radius: 7px;
  background: var(--gn-bg-hover);
}
.pf-seg button {
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.pf-seg button.on {
  background: var(--gn-bg);
  color: var(--gn-text);
  box-shadow: var(--gn-shadow-sm);
}
.pf-switch {
  position: relative;
  width: 32px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 99px;
  background: var(--gn-bg-active);
  cursor: pointer;
  transition: background 0.15s ease;
}
.pf-switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 0.15s ease;
}
.pf-switch.on {
  background: var(--gn-accent);
}
.pf-switch.on i {
  transform: translateX(14px);
}

/* 空间统计 */
.pf-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 6px;
}
.pf-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
}
.pf-stat b {
  font-size: 17px;
  font-weight: 650;
  color: var(--gn-text);
}
.pf-stat span {
  font-size: 11.5px;
  color: var(--gn-text-muted);
}

/* 关于 */
.pf-about {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0 14px;
  border-bottom: 1px solid var(--gn-border);
}
.pf-about-logo {
  font-size: 30px;
}
.pf-about-name {
  font-size: 14px;
  font-weight: 600;
}

/* 规划中 */
.pf-hero {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: 10px;
  background: var(--gn-bg-sidebar);
}
.pf-hero-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 8px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  color: var(--gn-text-soft);
}
.pf-hero-text {
  min-width: 0;
}
.pf-hero-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--gn-text);
}
.pf-hero-text p {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--gn-text-muted);
}
.pf-sub {
  margin: 18px 0 2px;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.pf-plan-icon {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
}
.pf-row-desc.indent {
  padding-left: 19px;
}
.pf-plan-tag {
  flex: 0 0 auto;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.pf-note {
  margin: 12px 0 0;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}

/* 底部保存条 */
.pf-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 36px;
  border-top: 1px solid var(--gn-border);
}
.pf-toast {
  font-size: 12px;
}
.pf-toast.ok {
  color: var(--gn-accent);
}
.pf-toast.err {
  color: var(--gn-danger);
}
.pf-toast.floating {
  position: absolute;
  right: 20px;
  bottom: 14px;
}

/* 修改密码弹窗 */
.pf-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 20, 18, 0.4);
}
.pf-dialog {
  width: min(340px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px 16px;
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
}
.pf-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
}
.pf-dialog label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--gn-text-muted);
}
.pf-dialog input {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.pf-dialog input:focus {
  border-color: var(--gn-border-strong);
}
.pf-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}
.pf-err {
  margin: 0;
  font-size: 12px;
  color: var(--gn-danger);
}

/* 窄屏：全屏弹窗，左侧导航改为顶部横向滚动的标签条 */
@media (max-width: 768px) {
  .pf-overlay {
    padding: 0;
  }
  .pf {
    width: 100%;
    height: 100dvh;
    flex-direction: column;
    border: none;
    border-radius: 0;
  }
  .pf-close {
    top: 6px;
    right: 6px;
  }
  .pf-nav {
    width: auto;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    padding: 6px 46px 6px 8px;
    border-right: none;
    border-bottom: 1px solid var(--gn-border);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .pf-group {
    display: flex;
    gap: 2px;
  }
  .pf-group + .pf-group {
    margin-top: 0;
  }
  .pf-group-title,
  .pf-dot {
    display: none;
  }
  .pf-nav-item {
    width: auto;
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .pf-nav-foot {
    display: flex;
    align-items: center;
    margin: 0;
    padding: 0 0 0 4px;
    border-top: none;
    border-left: 1px solid var(--gn-border);
  }
  .pf-nav-link {
    margin: 0 8px;
    white-space: nowrap;
  }
  .pf-scroll {
    padding: 16px 16px 24px;
  }
  .pf-row {
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .pf-foot {
    padding: 10px 16px;
  }
}
</style>
