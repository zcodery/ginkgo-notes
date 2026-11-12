<script setup lang="ts">
import { computed, ref } from 'vue'
import { renderSVG } from 'uqr'
import { Laptop, Lock, ShieldCheck, Trash2 } from 'lucide-vue-next'
import SettingsModal from './SettingsModal.vue'
import GnSelect from '@/components/GnSelect.vue'
import { applyUser, logout, store, updateProfile } from '@/store'
import { lockNow, pinLock } from '@/pinLock'
import {
  authProviders,
  bindGithub,
  deleteAccount,
  disableTwoFactor,
  enableTwoFactor,
  errorText,
  formatDateTime,
  listSessions,
  removePin,
  revokeOtherSessions,
  revokeSession,
  setPin,
  setupTwoFactor,
  unbindGithub,
  type SessionInfo,
} from '@/api/features'

const emit = defineEmits<{ (e: 'toast', type: 'ok' | 'err', text: string): void }>()
const ok = (text: string) => emit('toast', 'ok', text)
const fail = (e: unknown) => emit('toast', 'err', errorText(e))

const user = computed(() => store.user)
type Dialog = null | 'email' | 'phone' | 'devices' | 'pin' | 'pinRemove' | '2fa' | '2faOff' | 'delete'
const dialog = ref<Dialog>(null)
const busy = ref(false)
const err = ref('')

function open(d: Dialog) {
  err.value = ''
  dialog.value = d
}

async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  err.value = ''
  try {
    await fn()
  } catch (e) {
    err.value = errorText(e)
  } finally {
    busy.value = false
  }
}

function mask(v: string | null | undefined, kind: 'email' | 'phone') {
  if (!v) return ''
  if (kind === 'phone') return v.length > 7 ? `${v.slice(0, 3)}****${v.slice(-4)}` : v
  const [name, domain] = v.split('@')
  return `${name!.slice(0, 2)}${'*'.repeat(Math.max(1, name!.length - 2))}@${domain}`
}

/* ---------------- 邮箱 / 手机号 ---------------- */

const contactDraft = ref('')

function openContact(kind: 'email' | 'phone') {
  contactDraft.value = (kind === 'email' ? user.value?.email : user.value?.phone) ?? ''
  open(kind)
}

function saveContact(kind: 'email' | 'phone', value: string | null) {
  return run(async () => {
    await updateProfile({ [kind]: value })
    dialog.value = null
    ok(value ? '已保存' : '已解除绑定')
  })
}

/* ---------------- 设备管理 ---------------- */

const sessions = ref<SessionInfo[]>([])

async function openDevices() {
  open('devices')
  try {
    sessions.value = await listSessions()
  } catch (e) {
    err.value = errorText(e)
  }
}

function kick(id: string) {
  return run(async () => {
    await revokeSession(id)
    sessions.value = sessions.value.filter((s) => s.id !== id)
    ok('已退出该设备')
  })
}

function kickOthers() {
  return run(async () => {
    await revokeOtherSessions()
    sessions.value = sessions.value.filter((s) => s.current)
    ok('其它设备已全部退出')
  })
}

/* ---------------- PIN ---------------- */

const pinForm = ref({ pin: '', confirm: '', password: '' })
const idleOptions = [
  { value: '0', label: '不自动锁定' },
  { value: '5', label: '离开 5 分钟' },
  { value: '15', label: '离开 15 分钟' },
  { value: '30', label: '离开 30 分钟' },
  { value: '60', label: '离开 1 小时' },
]
const idleValue = computed({
  get: () => String(pinLock.idleMinutes),
  set: (v: string) => (pinLock.idleMinutes = Number(v)),
})

function openPin() {
  pinForm.value = { pin: '', confirm: '', password: '' }
  open('pin')
}

function savePin() {
  const f = pinForm.value
  if (!/^\d{4,8}$/.test(f.pin)) return void (err.value = 'PIN 码需为 4-8 位数字')
  if (f.pin !== f.confirm) return void (err.value = '两次输入的 PIN 码不一致')
  return run(async () => {
    const { user: u } = await setPin(f.pin, f.password)
    applyUser(u)
    dialog.value = null
    ok('PIN 码已设置')
  })
}

function dropPin() {
  return run(async () => {
    const { user: u } = await removePin(pinForm.value.password)
    applyUser(u)
    dialog.value = null
    ok('已移除 PIN 码')
  })
}

/* ---------------- 两步验证 ---------------- */

const totp = ref<{ secret: string; uri: string } | null>(null)
const totpCode = ref('')
const qrSvg = computed(() => (totp.value ? renderSVG(totp.value.uri, { border: 2 }) : ''))
const pwdForOff = ref('')

async function open2fa() {
  open('2fa')
  totp.value = null
  totpCode.value = ''
  try {
    totp.value = await setupTwoFactor()
  } catch (e) {
    err.value = errorText(e)
  }
}

function confirm2fa() {
  return run(async () => {
    const { user: u } = await enableTwoFactor(totpCode.value.trim())
    applyUser(u)
    dialog.value = null
    ok('两步验证已开启')
  })
}

function turnOff2fa() {
  return run(async () => {
    const { user: u } = await disableTwoFactor(pwdForOff.value)
    applyUser(u)
    dialog.value = null
    ok('两步验证已关闭')
  })
}

/* ---------------- 第三方账号 ---------------- */

const githubAvailable = ref<boolean | null>(null)
authProviders()
  .then((p) => (githubAvailable.value = p.github))
  .catch(() => (githubAvailable.value = false))

async function toggleGithub() {
  try {
    if (user.value?.github) {
      const { user: u } = await unbindGithub()
      applyUser(u)
      ok('已解除 GitHub 绑定')
    } else {
      const { url } = await bindGithub()
      window.location.href = url
    }
  } catch (e) {
    fail(e)
  }
}

/* ---------------- 注销 ---------------- */

const delForm = ref({ password: '', confirm: '' })

function openDelete() {
  delForm.value = { password: '', confirm: '' }
  open('delete')
}

function confirmDelete() {
  return run(async () => {
    await deleteAccount(delForm.value.password, delForm.value.confirm.trim())
    dialog.value = null
    store.settingsOpen = false
    await logout()
  })
}
</script>

<template>
  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">邮箱</div>
      <div class="pf-row-desc">{{ user?.email ? mask(user.email, 'email') : '用于找回密码与接收通知' }}</div>
    </div>
    <button type="button" class="pf-btn" @click="openContact('email')">{{ user?.email ? '修改' : '绑定邮箱' }}</button>
  </div>

  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">手机号</div>
      <div class="pf-row-desc">{{ user?.phone ? mask(user.phone, 'phone') : '用于联系与安全验证' }}</div>
    </div>
    <button type="button" class="pf-btn" @click="openContact('phone')">{{ user?.phone ? '修改' : '绑定手机号' }}</button>
  </div>

  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">设备管理</div>
      <div class="pf-row-desc">查看登录过的设备，可退出指定设备</div>
    </div>
    <button type="button" class="pf-btn" @click="openDevices"><Laptop :size="12" :stroke-width="2" />管理</button>
  </div>

  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">PIN 码锁屏<span v-if="user?.hasPin" class="pf-tag admin">已开启</span></div>
      <div class="pf-row-desc">离开时锁定屏幕，回来输入 PIN 解锁；快捷键可立即锁定</div>
    </div>
    <div class="pf-actions">
      <template v-if="user?.hasPin">
        <GnSelect v-model="idleValue" :options="idleOptions" :min-width="116" />
        <button type="button" class="pf-btn" @click="lockNow"><Lock :size="12" :stroke-width="2" />立即锁定</button>
        <button type="button" class="pf-btn" @click="openPin">修改</button>
        <button type="button" class="pf-btn danger" @click="pinForm.password = ''; open('pinRemove')">移除</button>
      </template>
      <button v-else type="button" class="pf-btn" @click="openPin">添加 PIN 码</button>
    </div>
  </div>

  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">两步验证<span v-if="user?.twoFactor" class="pf-tag admin">已开启</span></div>
      <div class="pf-row-desc">登录时额外输入验证器 App（Google / 微软 Authenticator 等）里的动态码</div>
    </div>
    <button v-if="user?.twoFactor" type="button" class="pf-btn danger" @click="pwdForOff = ''; open('2faOff')">关闭</button>
    <button v-else type="button" class="pf-btn" @click="open2fa"><ShieldCheck :size="12" :stroke-width="2" />开启</button>
  </div>

  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">第三方账号</div>
      <div class="pf-row-desc">
        <template v-if="user?.github">已绑定 GitHub：{{ user.github }}</template>
        <template v-else-if="githubAvailable === false">GitHub 快捷登录需管理员配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET</template>
        <template v-else>绑定后可用 GitHub 快捷登录</template>
      </div>
    </div>
    <button
      type="button"
      class="pf-btn"
      :disabled="!user?.github && githubAvailable === false"
      @click="toggleGithub"
    >
      {{ user?.github ? '解除绑定' : '绑定 GitHub' }}
    </button>
  </div>

  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title danger">注销账号</div>
      <div class="pf-row-desc">永久删除账号及全部笔记、图片与分享，无法恢复</div>
    </div>
    <button type="button" class="pf-btn danger" @click="openDelete"><Trash2 :size="12" :stroke-width="2" />注销</button>
  </div>

  <!-- 邮箱 / 手机号 -->
  <SettingsModal
    v-if="dialog === 'email' || dialog === 'phone'"
    :title="dialog === 'email' ? '绑定邮箱' : '绑定手机号'"
    @close="dialog = null"
  >
    <label>
      {{ dialog === 'email' ? '邮箱地址' : '手机号' }}
      <input
        v-model="contactDraft"
        :type="dialog === 'email' ? 'email' : 'tel'"
        :placeholder="dialog === 'email' ? 'name@example.com' : '13800000000'"
        @keydown.enter="saveContact(dialog as 'email' | 'phone', contactDraft.trim() || null)"
      />
    </label>
    <p class="pf-dialog-tip">当前版本不发送验证码，请确认填写正确。</p>
    <p v-if="err" class="pf-err">{{ err }}</p>
    <footer>
      <button
        v-if="dialog === 'email' ? user?.email : user?.phone"
        type="button"
        class="pf-btn danger"
        :disabled="busy"
        @click="saveContact(dialog as 'email' | 'phone', null)"
      >
        解除绑定
      </button>
      <span class="pf-grow"></span>
      <button type="button" class="pf-btn" @click="dialog = null">取消</button>
      <button
        type="button"
        class="pf-btn primary"
        :disabled="busy || !contactDraft.trim()"
        @click="saveContact(dialog as 'email' | 'phone', contactDraft.trim())"
      >
        保存
      </button>
    </footer>
  </SettingsModal>

  <!-- 设备管理 -->
  <SettingsModal v-if="dialog === 'devices'" title="设备管理" :width="520" @close="dialog = null">
    <div class="pf-list">
      <div v-for="s in sessions" :key="s.id" class="pf-list-item">
        <Laptop :size="16" :stroke-width="1.7" class="pf-list-icon" />
        <div class="pf-list-main">
          <div class="pf-list-title">
            {{ s.device }}<span v-if="s.current" class="pf-tag admin">当前设备</span>
          </div>
          <div class="pf-row-desc">
            {{ s.ip || '未知 IP' }} · 最近活动 {{ formatDateTime(s.lastSeen) }} · 登录于 {{ formatDateTime(s.createdAt) }}
          </div>
        </div>
        <button v-if="!s.current" type="button" class="pf-btn" :disabled="busy" @click="kick(s.id)">退出</button>
      </div>
      <p v-if="!sessions.length" class="pf-row-desc">加载中…</p>
    </div>
    <p v-if="err" class="pf-err">{{ err }}</p>
    <footer>
      <button type="button" class="pf-btn danger" :disabled="busy || sessions.length < 2" @click="kickOthers">
        退出其它全部设备
      </button>
    </footer>
  </SettingsModal>

  <!-- PIN -->
  <SettingsModal v-if="dialog === 'pin'" :title="user?.hasPin ? '修改 PIN 码' : '添加 PIN 码'" @close="dialog = null">
    <label>新 PIN 码（4-8 位数字）<input v-model="pinForm.pin" type="password" inputmode="numeric" maxlength="8" /></label>
    <label>再输入一次<input v-model="pinForm.confirm" type="password" inputmode="numeric" maxlength="8" /></label>
    <label>登录密码<input v-model="pinForm.password" type="password" autocomplete="current-password" /></label>
    <p v-if="err" class="pf-err">{{ err }}</p>
    <footer>
      <button type="button" class="pf-btn" @click="dialog = null">取消</button>
      <button type="button" class="pf-btn primary" :disabled="busy" @click="savePin">保存</button>
    </footer>
  </SettingsModal>

  <SettingsModal v-if="dialog === 'pinRemove'" title="移除 PIN 码" @close="dialog = null">
    <label>登录密码<input v-model="pinForm.password" type="password" autocomplete="current-password" @keydown.enter="dropPin" /></label>
    <p v-if="err" class="pf-err">{{ err }}</p>
    <footer>
      <button type="button" class="pf-btn" @click="dialog = null">取消</button>
      <button type="button" class="pf-btn danger" :disabled="busy" @click="dropPin">移除</button>
    </footer>
  </SettingsModal>

  <!-- 两步验证 -->
  <SettingsModal v-if="dialog === '2fa'" title="开启两步验证" :width="400" @close="dialog = null">
    <p class="pf-dialog-tip">1. 用验证器 App 扫描二维码，或手动输入密钥：</p>
    <div v-if="totp" class="pf-qr" v-html="qrSvg"></div>
    <code v-if="totp" class="pf-secret">{{ totp.secret.replace(/(.{4})/g, '$1 ').trim() }}</code>
    <p class="pf-dialog-tip">2. 输入 App 显示的 6 位动态码完成绑定：</p>
    <input
      v-model="totpCode"
      class="pf-code-input"
      inputmode="numeric"
      maxlength="6"
      placeholder="000000"
      @keydown.enter="confirm2fa"
    />
    <p v-if="err" class="pf-err">{{ err }}</p>
    <footer>
      <button type="button" class="pf-btn" @click="dialog = null">取消</button>
      <button type="button" class="pf-btn primary" :disabled="busy || totpCode.trim().length !== 6" @click="confirm2fa">
        验证并开启
      </button>
    </footer>
  </SettingsModal>

  <SettingsModal v-if="dialog === '2faOff'" title="关闭两步验证" @close="dialog = null">
    <label>登录密码<input v-model="pwdForOff" type="password" autocomplete="current-password" @keydown.enter="turnOff2fa" /></label>
    <p v-if="err" class="pf-err">{{ err }}</p>
    <footer>
      <button type="button" class="pf-btn" @click="dialog = null">取消</button>
      <button type="button" class="pf-btn danger" :disabled="busy" @click="turnOff2fa">关闭</button>
    </footer>
  </SettingsModal>

  <!-- 注销 -->
  <SettingsModal v-if="dialog === 'delete'" title="注销账号" :width="400" @close="dialog = null">
    <p class="pf-dialog-tip danger">
      注销后，你的全部笔记、多维表格、图片、分享链接与协作授权都会被永久删除，无法恢复。建议先在「导入与导出」中导出一份备份。
    </p>
    <label>登录密码<input v-model="delForm.password" type="password" autocomplete="current-password" /></label>
    <label>
      输入用户名「{{ user?.username }}」确认
      <input v-model="delForm.confirm" autocomplete="off" />
    </label>
    <p v-if="err" class="pf-err">{{ err }}</p>
    <footer>
      <button type="button" class="pf-btn" @click="dialog = null">取消</button>
      <button
        type="button"
        class="pf-btn danger solid"
        :disabled="busy || delForm.confirm.trim() !== user?.username || !delForm.password"
        @click="confirmDelete"
      >
        永久注销
      </button>
    </footer>
  </SettingsModal>
</template>
