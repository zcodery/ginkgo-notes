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
  label: string
  icon: Component
  soon?: boolean
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: '账号',
    items: [
      { id: 'account', label: '账号设置', icon: UserRound },
      { id: 'general', label: '通用设置', icon: SlidersHorizontal },
      { id: 'notify', label: '消息通知', icon: Bell, soon: true },
    ],
  },
  {
    group: '空间',
    items: [
      { id: 'space', label: '空间信息', icon: Box },
      { id: 'members', label: '成员', icon: Users, soon: true },
      { id: 'share', label: '公开分享', icon: Globe, soon: true },
      { id: 'data', label: '导入与导出', icon: Download, soon: true },
    ],
  },
  {
    group: '扩展',
    items: [
      { id: 'integrations', label: 'MCP 与集成', icon: Plug, soon: true },
      { id: 'ai', label: 'AI 助手', icon: Bot, soon: true },
      { id: 'about', label: '关于', icon: Info },
    ],
  },
]

const section = ref<Section>('account')
const current = computed(() => NAV.flatMap((g) => g.items).find((i) => i.id === section.value)!)

interface Roadmap {
  desc: string
  features: { title: string; desc: string }[]
}

const ROADMAPS: Partial<Record<Section, Roadmap>> = {
  notify: {
    desc: '评论、@提及与分享邀请的消息提醒，不错过协作动态。',
    features: [
      { title: '站内通知中心', desc: '集中查看评论回复、@提及和页面变更' },
      { title: '邮件提醒', desc: '重要消息同步发送到绑定邮箱' },
      { title: '免打扰时段', desc: '按时间段静音通知' },
    ],
  },
  members: {
    desc: '邀请成员加入空间，一起编辑和管理笔记。',
    features: [
      { title: '邀请成员', desc: '通过链接或用户名邀请加入空间' },
      { title: '角色权限', desc: '所有者 / 编辑者 / 只读成员' },
      { title: '页面级权限', desc: '单独设置某个页面的可见与可编辑范围' },
    ],
  },
  share: {
    desc: '把页面发布到网络，任何人通过链接即可阅读。',
    features: [
      { title: '公开链接', desc: '一键发布，取消发布后链接立即失效' },
      { title: '访问密码与有效期', desc: '限制访问者与链接有效时间' },
      { title: '分享管理', desc: '统一查看和撤销已分享的页面' },
    ],
  },
  data: {
    desc: '把笔记从别处搬进来，或整个空间打包带走。',
    features: [
      { title: '导入 Markdown', desc: '批量导入 .md 文件，保留目录层级' },
      { title: '导入 Notion', desc: '解析 Notion 导出包，图片一并迁移' },
      { title: '整空间导出', desc: '导出为 Markdown + 图片的压缩包' },
    ],
  },
  integrations: {
    desc: '让 AI 工具与外部服务安全地读写你的笔记。',
    features: [
      { title: 'MCP 服务', desc: 'Cursor、Claude 等 AI 工具可直接检索和编辑笔记' },
      { title: 'API Token', desc: '创建、限定范围与吊销个人访问令牌' },
      { title: 'Webhook', desc: '页面变更时推送事件到外部系统' },
    ],
  },
  ai: {
    desc: '在笔记里直接调用大模型，写作和整理更省力。',
    features: [
      { title: '续写与改写', desc: '选中文本后续写、润色、调整语气' },
      { title: '总结与翻译', desc: '一键生成摘要，或翻译整页内容' },
      { title: '自定义模型', desc: '填写自己的 API Key 与模型地址' },
    ],
  },
}

const roadmap = computed(() => ROADMAPS[section.value] ?? null)

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
    notify('ok', '已保存')
  } catch (e) {
    notify('err', e instanceof Error ? e.message : '保存失败')
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
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

async function onAvatarPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) return notify('err', '请选择图片文件')
  avatarBusy.value = true
  try {
    await updateProfile({ avatar: await shrinkImage(file) })
    notify('ok', '头像已更新')
  } catch (err) {
    notify('err', err instanceof Error ? err.message : '上传失败')
  } finally {
    avatarBusy.value = false
  }
}

async function removeAvatar() {
  avatarBusy.value = true
  try {
    await updateProfile({ avatar: null })
    notify('ok', '已移除头像')
  } catch (err) {
    notify('err', err instanceof Error ? err.message : '操作失败')
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
  if (!current || !next) return void (pwdErr.value = '请填写当前密码和新密码')
  if (next.length < 6) return void (pwdErr.value = '新密码至少 6 位')
  if (next !== confirm) return void (pwdErr.value = '两次输入的新密码不一致')
  pwdSaving.value = true
  try {
    await changePassword(current, next)
    pwdOpen.value = false
    notify('ok', '密码已更新')
  } catch (e) {
    pwdErr.value = e instanceof Error ? e.message : '修改失败'
  } finally {
    pwdSaving.value = false
  }
}

/** 规划中的账号能力，统一展示为「即将上线」 */
const SOON_ACCOUNT: { label: string; desc?: string; action: string; danger?: boolean }[] = [
  { label: '邮箱', desc: '用于找回密码与接收通知', action: '绑定邮箱' },
  { label: '手机号', desc: '用于登录与安全验证', action: '绑定手机号' },
  { label: '设备管理', desc: '查看登录设备，支持退出指定设备', action: '管理' },
  { label: 'PIN 码', desc: '离开时锁定屏幕，回来输入 PIN 解锁', action: '添加 PIN 码' },
  { label: '两步验证', desc: '登录时额外校验一次身份', action: '开启' },
  { label: '第三方账号', desc: '微信 / QQ / GitHub 快捷登录', action: '绑定' },
]

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

const widthOptions = [
  { value: 'auto', label: '自动铺满' },
  ...NOTE_WIDTH_RATIOS.map((r) => ({ value: String(r), label: `${r}%` })),
]

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

const langOptions = [{ value: 'zh-CN', label: '简体中文' }]

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
  if (!window.confirm('将清除本地图片缓存与侧栏展开状态并重新加载，笔记数据不受影响。继续吗？')) return
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
  <div class="pf gn-pop" role="dialog" aria-label="设置">
    <button type="button" class="pf-close gn-icon-btn" v-tooltip="'关闭 Esc'" @click="close">
      <X :size="15" :stroke-width="1.9" />
    </button>
    <!-- 左侧设置导航 -->
    <nav class="pf-nav gn-scroll">
      <div v-for="g in NAV" :key="g.group" class="pf-group">
        <div class="pf-group-title">{{ g.group }}</div>
        <button
          v-for="item in g.items"
          :key="item.id"
          type="button"
          class="pf-nav-item"
          :class="{ on: section === item.id }"
          @click="section = item.id"
        >
          <component :is="item.icon" :size="15" :stroke-width="1.8" />
          <span>{{ item.label }}</span>
          <i v-if="item.soon" class="pf-dot" v-tooltip="'即将上线'"></i>
        </button>
      </div>

      <div class="pf-nav-foot">
        <button type="button" class="pf-nav-item" @click="onLogout">
          <LogOut :size="15" :stroke-width="1.8" /><span>退出登录</span>
        </button>
        <button type="button" class="pf-nav-link" @click="clearCacheAndReload">
          <RefreshCw :size="12" :stroke-width="2" />清除缓存并重启
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
            <div class="pf-label">头像</div>
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
                  移除头像
                </button>
                <button type="button" class="pf-btn" :disabled="avatarBusy" @click="avatarInput?.click()">
                  {{ avatarBusy ? '处理中…' : '上传头像' }}
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
            <div class="pf-label">昵称</div>
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
              <div class="pf-row-title">用户名</div>
              <div class="pf-row-desc">登录时使用，暂不支持修改</div>
            </div>
            <span class="pf-value">{{ user?.username }}</span>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">账号身份</div>
              <div class="pf-row-desc">注册于 {{ createdLabel }}</div>
            </div>
            <span class="pf-tag" :class="{ admin: isAdmin }">{{ isAdmin ? '管理员' : '普通用户' }}</span>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">登录密码</div>
              <div class="pf-row-desc">建议定期更换，长度 6-128 位</div>
            </div>
            <button type="button" class="pf-btn" @click="openPwd">
              <KeyRound :size="12" :stroke-width="2" />修改密码
            </button>
          </div>

          <div v-for="s in SOON_ACCOUNT" :key="s.label" class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">{{ s.label }}<span class="pf-soon">即将上线</span></div>
              <div v-if="s.desc" class="pf-row-desc">{{ s.desc }}</div>
            </div>
            <button type="button" class="pf-btn" disabled>{{ s.action }}</button>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title danger">注销账号<span class="pf-soon">即将上线</span></div>
              <div class="pf-row-desc">永久删除账号及全部笔记，无法恢复</div>
            </div>
            <button type="button" class="pf-btn danger" disabled>注销</button>
          </div>
        </template>

        <!-- 通用设置 -->
        <template v-else-if="section === 'general'">
          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">外观</div>
              <div class="pf-row-desc">界面的浅色 / 深色主题</div>
            </div>
            <div class="pf-seg">
              <button type="button" :class="{ on: store.theme === 'light' }" @click="setTheme('light')">浅色</button>
              <button type="button" :class="{ on: store.theme === 'dark' }" @click="setTheme('dark')">深色</button>
            </div>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">正文宽度</div>
              <div class="pf-row-desc">笔记内容区占可用宽度的比例</div>
            </div>
            <GnSelect v-model="widthValue" :options="widthOptions" :min-width="108" />
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">正文字号</div>
            </div>
            <GnSelect v-model="fontSizeValue" :options="fontSizeOptions" :min-width="88" />
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">正文字体</div>
            </div>
            <GnSelect v-model="fontStyleValue" :options="fontStyleOptions" :min-width="96" />
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">页面布局</div>
              <div class="pf-row-desc">行距与块间距的疏密程度</div>
            </div>
            <div class="pf-seg">
              <button
                v-for="l in NOTE_LAYOUTS"
                :key="l.id"
                type="button"
                :class="{ on: store.noteLayout === l.id }"
                @click="setNoteLayout(l.id as NoteLayout)"
              >
                {{ l.label }}
              </button>
            </div>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">显示页面目录</div>
              <div class="pf-row-desc">在笔记右侧显示标题大纲</div>
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
              <div class="pf-row-title">语言<span class="pf-soon">即将上线</span></div>
              <div class="pf-row-desc">界面显示语言</div>
            </div>
            <GnSelect model-value="zh-CN" :options="langOptions" disabled :min-width="96" />
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">快捷键自定义<span class="pf-soon">即将上线</span></div>
              <div class="pf-row-desc">修改搜索、新建页面等常用快捷键</div>
            </div>
            <button type="button" class="pf-btn" disabled>设置</button>
          </div>
        </template>

        <!-- 空间信息 -->
        <template v-else-if="section === 'space'">
          <div class="pf-stats">
            <div class="pf-stat"><b>{{ stats.pages }}</b><span>页面</span></div>
            <div class="pf-stat"><b>{{ stats.favorites }}</b><span>收藏</span></div>
            <div class="pf-stat"><b>{{ stats.trashed }}</b><span>回收站</span></div>
            <div class="pf-stat"><b>{{ stats.words.toLocaleString() }}</b><span>总字数</span></div>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">当前空间</div>
              <div class="pf-row-desc">管理员可在左下角菜单切换「公共原稿」</div>
            </div>
            <span class="pf-value">{{ store.space === 'public' ? '公共原稿' : '我的笔记' }}</span>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">最近编辑</div>
            </div>
            <span class="pf-value">{{ stats.last }}</span>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">空间名称与图标<span class="pf-soon">即将上线</span></div>
              <div class="pf-row-desc">自定义侧栏顶部显示的空间名称与 Logo</div>
            </div>
            <button type="button" class="pf-btn" disabled>编辑</button>
          </div>

          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">存储用量<span class="pf-soon">即将上线</span></div>
              <div class="pf-row-desc">图片、附件占用的空间统计</div>
            </div>
            <button type="button" class="pf-btn" disabled>查看</button>
          </div>
        </template>

        <!-- 关于 -->
        <template v-else-if="section === 'about'">
          <div class="pf-about">
            <span class="pf-about-logo">🍃</span>
            <div>
              <div class="pf-about-name">银杏笔记</div>
              <div class="pf-row-desc">版本 {{ APP_VERSION }} · 底层就是 Markdown 的块编辑笔记</div>
            </div>
          </div>
          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">检查更新<span class="pf-soon">即将上线</span></div>
            </div>
            <button type="button" class="pf-btn" disabled>检查</button>
          </div>
          <div class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">意见反馈<span class="pf-soon">即将上线</span></div>
              <div class="pf-row-desc">告诉我们你遇到的问题或想要的功能</div>
            </div>
            <button type="button" class="pf-btn" disabled>反馈</button>
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
                {{ current.label }}<span class="pf-soon">即将上线</span>
              </div>
              <p>{{ roadmap.desc }}</p>
            </div>
          </div>

          <div class="pf-sub">规划中的能力</div>
          <div v-for="f in roadmap.features" :key="f.title" class="pf-row">
            <div class="pf-row-text">
              <div class="pf-row-title">
                <CircleDashed :size="13" :stroke-width="2" class="pf-plan-icon" />{{ f.title }}
              </div>
              <div class="pf-row-desc indent">{{ f.desc }}</div>
            </div>
            <span class="pf-plan-tag">规划中</span>
          </div>

          <p class="pf-note">有更想要的功能？上线后可在「关于 → 意见反馈」告诉我们。</p>
        </template>
      </div>

      <!-- 底部保存条：仅账号设置且有改动时 -->
      <footer v-if="section === 'account'" class="pf-foot">
        <button type="button" class="pf-btn primary" :disabled="!dirty || saving" @click="saveProfile">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <button type="button" class="pf-btn" :disabled="!dirty || saving" @click="cancelProfile">取消</button>
        <span v-if="toast" class="pf-toast" :class="toast.type">{{ toast.text }}</span>
      </footer>
      <span v-else-if="toast" class="pf-toast floating" :class="toast.type">{{ toast.text }}</span>
    </section>

    <!-- 修改密码 -->
    <div v-if="pwdOpen" class="pf-mask gn-fade" @mousedown.self="pwdOpen = false">
      <form class="pf-dialog gn-pop" @submit.prevent="submitPwd">
        <header>
          <span>修改密码</span>
          <button type="button" class="gn-icon-btn" @click="pwdOpen = false"><X :size="14" /></button>
        </header>
        <label>当前密码<input v-model="pwd.current" type="password" autocomplete="current-password" /></label>
        <label>新密码<input v-model="pwd.next" type="password" autocomplete="new-password" /></label>
        <label>确认新密码<input v-model="pwd.confirm" type="password" autocomplete="new-password" /></label>
        <p v-if="pwdErr" class="pf-err">{{ pwdErr }}</p>
        <footer>
          <button type="button" class="pf-btn" @click="pwdOpen = false">取消</button>
          <button type="submit" class="pf-btn primary" :disabled="pwdSaving">
            {{ pwdSaving ? '保存中…' : '确认修改' }}
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
</style>
