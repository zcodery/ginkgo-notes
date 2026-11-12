<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BellOff } from 'lucide-vue-next'
import { errorText, fetchServerInfo, putUserSetting } from '@/api/features'
import { inQuietHours, userState } from '@/userState'
import { store } from '@/store'

const mailAvailable = ref<boolean | null>(null)
onMounted(() => {
  fetchServerInfo()
    .then((i) => (mailAvailable.value = i.mail))
    .catch(() => (mailAvailable.value = false))
})

const emit = defineEmits<{ (e: 'toast', type: 'ok' | 'err', text: string): void }>()

const TYPES: { key: string; title: string; desc: string }[] = [
  { key: 'member', title: '成员邀请', desc: '有人邀请你查看或编辑页面' },
  { key: 'share', title: '公开分享', desc: '你分享的链接首次被访问' },
  { key: 'feedback', title: '意见反馈', desc: '反馈收到回复；管理员收到新反馈' },
  { key: 'webhook', title: 'Webhook', desc: 'Webhook 投递失败' },
  { key: 'system', title: '系统消息', desc: '版本更新等系统公告' },
]

const prefs = computed(() => userState.notifyPrefs)
const quietNow = computed(() => inQuietHours())
const saving = ref(false)

async function save() {
  saving.value = true
  try {
    await putUserSetting('notify', prefs.value)
  } catch (e) {
    emit('toast', 'err', errorText(e))
  } finally {
    saving.value = false
  }
}

function toggleType(key: string) {
  prefs.value.types[key] = prefs.value.types[key] === false
  void save()
}

function toggleQuiet() {
  prefs.value.quiet.enabled = !prefs.value.quiet.enabled
  void save()
}
</script>

<template>
  <p class="pf-row-desc">
    通知集中显示在侧栏顶部的铃铛里。安全类通知（新设备登录、修改密码、两步验证变更等）始终开启。
  </p>

  <div class="pf-section-head"><div class="pf-sub">通知类型</div></div>
  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">账号安全</div>
      <div class="pf-row-desc">新设备登录、密码与两步验证变更、创建访问令牌</div>
    </div>
    <button type="button" class="pf-switch on" disabled v-tooltip="'安全通知不可关闭'"><i></i></button>
  </div>
  <div v-for="tp in TYPES" :key="tp.key" class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">{{ tp.title }}</div>
      <div class="pf-row-desc">{{ tp.desc }}</div>
    </div>
    <button type="button" class="pf-switch" :class="{ on: prefs.types[tp.key] !== false }" @click="toggleType(tp.key)"><i></i></button>
  </div>

  <div class="pf-section-head"><div class="pf-sub">免打扰</div></div>
  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">
        免打扰时段<span v-if="quietNow" class="pf-tag"><BellOff :size="10" /> 生效中</span>
      </div>
      <div class="pf-row-desc">时段内通知照常记录，但铃铛不显示红色提醒</div>
    </div>
    <div class="pf-actions">
      <template v-if="prefs.quiet.enabled">
        <input v-model="prefs.quiet.start" type="time" class="pf-input nt-time" @change="save" />
        <span class="pf-row-desc">至</span>
        <input v-model="prefs.quiet.end" type="time" class="pf-input nt-time" @change="save" />
      </template>
      <button type="button" class="pf-switch" :class="{ on: prefs.quiet.enabled }" @click="toggleQuiet"><i></i></button>
    </div>
  </div>

  <div class="pf-section-head"><div class="pf-sub">邮件提醒</div></div>
  <div class="pf-row">
    <div class="pf-row-text">
      <div class="pf-row-title">同步发送到邮箱</div>
      <div class="pf-row-desc">
        <template v-if="mailAvailable === false">服务端尚未配置邮件服务（SMTP_URL），当前仅站内通知</template>
        <template v-else-if="!store.user?.email">请先在「账号设置」中绑定邮箱</template>
        <template v-else>开启的通知类型会同时发送到 {{ store.user.email }}</template>
      </div>
    </div>
    <button
      type="button"
      class="pf-switch"
      :class="{ on: prefs.email }"
      :disabled="!mailAvailable || (!store.user?.email && !prefs.email)"
      @click="prefs.email = !prefs.email; save()"
    >
      <i></i>
    </button>
  </div>
</template>

<style scoped>
.nt-time {
  width: 96px;
  height: 28px;
}
</style>
