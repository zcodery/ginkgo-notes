<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown, Globe, Home, NotebookPen, Plus, Users } from 'lucide-vue-next'
import PageIcon from '@/components/PageIcon.vue'
import { createSpace, errorText } from '@/api/features'
import { goHome, goTeams, isAdmin, reloadSpaces, store, switchSpace } from '@/store'
import { userState } from '@/userState'
import { t } from '@/i18n'

/** 面板开关 */
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

/** 快速新建团队 */
const creating = ref(false)
const newName = ref('')
const busy = ref(false)
const err = ref('')

/** 我加入的团队（后端已按成员关系过滤） */
const teamSpaces = computed(() => store.spaces.filter((s) => s.type === 'team'))
/** 当前所在的团队空间 */
const currentTeam = computed(() => store.spaces.find((s) => s.id === store.space) ?? null)

/** 顶栏显示的当前空间名：个人空间用设置里的名字，公共原稿用固定文案，团队用团队名 */
const currentName = computed(() => {
  if (store.space === 'public') return t('sidebar.publicDraft')
  if (currentTeam.value) return currentTeam.value.name
  return userState.space.name || t('app.name')
})

/** 个人空间的显示名：设置里改过就用改后的 */
const personalName = computed(() => userState.space.name || t('sidebar.myNotes'))

/** 团队空间没有自定义图标，用首字做成色块，和团队管理页保持一致 */
const teamInitial = computed(() => (currentTeam.value?.name || '?').slice(0, 1))

async function pick(space: 'me' | 'public' | (string & {})) {
  open.value = false
  creating.value = false
  try {
    await switchSpace(space)
  } catch (e) {
    err.value = errorText(e, t('sidebar.createFailed'))
  }
}

async function submitCreate() {
  const name = newName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  err.value = ''
  try {
    const space = await createSpace(name)
    newName.value = ''
    creating.value = false
    await reloadSpaces()
    open.value = false
    // 建完直接进新团队，省得再点一次
    await switchSpace(space.id)
  } catch (e) {
    err.value = errorText(e, t('sidebar.createFailed'))
  } finally {
    busy.value = false
  }
}

function cancelCreate() {
  creating.value = false
  newName.value = ''
  err.value = ''
}

function onDocDown(e: MouseEvent) {
  if (open.value && !rootRef.value?.contains(e.target as Node)) open.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="rootRef" class="ssw">
    <button class="ssw-btn" :class="{ open }" @click="open = !open">
      <span class="ssw-logo">
        <span v-if="currentTeam" class="ssw-initial">{{ teamInitial }}</span>
        <PageIcon v-else :icon="userState.space.icon || '🍃'" :size="16" />
      </span>
      <span class="ssw-name">{{ currentName }}</span>
      <ChevronDown class="ssw-caret" :size="13" :stroke-width="2" />
    </button>

    <div v-if="open" class="ssw-panel gn-pop">
      <button class="ssw-item" @click="open = false; goHome()">
        <Home :size="14" :stroke-width="1.8" /><span>{{ t('sidebar.home') }}</span>
      </button>

      <div class="ssw-sep"></div>

      <button class="ssw-item" :class="{ on: store.space === 'me' }" @click="pick('me')">
        <NotebookPen :size="14" :stroke-width="1.8" /><span>{{ personalName }}</span>
        <Check v-if="store.space === 'me'" class="ssw-check" :size="13" :stroke-width="2.2" />
      </button>
      <button
        v-if="isAdmin"
        class="ssw-item"
        :class="{ on: store.space === 'public' }"
        @click="pick('public')"
      >
        <Globe :size="14" :stroke-width="1.8" /><span>{{ t('sidebar.publicDraft') }}</span>
        <Check v-if="store.space === 'public'" class="ssw-check" :size="13" :stroke-width="2.2" />
      </button>

      <div class="ssw-sep"></div>
      <div class="ssw-label">{{ t('sidebar.teams') }}</div>

      <button
        v-for="s in teamSpaces"
        :key="s.id"
        class="ssw-item"
        :class="{ on: store.space === s.id }"
        @click="pick(s.id)"
      >
        <Users :size="14" :stroke-width="1.8" />
        <span class="ssw-item-text">{{ s.name }}</span>
        <span class="ssw-meta">{{ s.memberCount }}</span>
        <Check v-if="store.space === s.id" class="ssw-check" :size="13" :stroke-width="2.2" />
      </button>

      <div class="ssw-sep"></div>

      <form v-if="creating" class="ssw-form" @submit.prevent="submitCreate">
        <input v-model="newName" :placeholder="t('sidebar.teamName')" maxlength="60" autofocus />
        <div class="ssw-form-actions">
          <button type="submit" class="ssw-ok" :disabled="busy || !newName.trim()">
            {{ t('sidebar.create') }}
          </button>
          <button type="button" class="ssw-cancel" @click="cancelCreate">{{ t('sidebar.cancel') }}</button>
        </div>
        <p v-if="err" class="ssw-err">{{ err }}</p>
      </form>
      <button v-else class="ssw-item" @click="creating = true">
        <Plus :size="14" :stroke-width="2" /><span>{{ t('sidebar.newTeam') }}</span>
      </button>

      <button class="ssw-item" @click="open = false; goTeams()">
        <Users :size="14" :stroke-width="1.8" /><span>{{ t('sidebar.manageTeams') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ssw {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}
.ssw-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.ssw-btn:hover {
  background: var(--gn-bg-hover);
}
.ssw-btn.open {
  background: var(--gn-bg-hover);
}
.ssw-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  font-size: 15px;
  line-height: 1;
}
.ssw-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--gn-accent);
  color: var(--gn-accent-ink);
  font-size: 11px;
  font-weight: 650;
}
.ssw-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--gn-text);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ssw-caret {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  transition: transform 0.15s;
}
.ssw-btn.open .ssw-caret {
  transform: rotate(180deg);
}

.ssw-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 130;
  width: 244px;
  max-width: calc(100vw - 24px);
  padding: 5px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  box-shadow: var(--gn-shadow-lg);
}
.ssw-item {
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
  text-align: left;
  cursor: pointer;
}
.ssw-item:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.ssw-item.on {
  color: var(--gn-accent);
  font-weight: 500;
}
.ssw-item-text {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ssw-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--gn-text-muted);
}
.ssw-check {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--gn-accent);
}
.ssw-label {
  padding: 6px 8px 3px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--gn-text-muted);
}
.ssw-sep {
  height: 1px;
  margin: 4px 3px;
  background: var(--gn-border);
}
.ssw-form {
  padding: 3px;
}
.ssw-form input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--gn-border-strong);
  border-radius: 5px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 13px;
  outline: none;
}
.ssw-form input:focus {
  border-color: var(--gn-accent);
}
.ssw-form-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.ssw-ok {
  flex: 1 1 auto;
  height: 26px;
  border: none;
  border-radius: 5px;
  background: var(--gn-accent);
  color: var(--gn-accent-ink);
  font-size: 12.5px;
  cursor: pointer;
}
.ssw-ok:disabled {
  opacity: 0.55;
  cursor: default;
}
.ssw-cancel {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--gn-border-strong);
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  cursor: pointer;
}
.ssw-cancel:hover {
  color: var(--gn-text);
}
.ssw-err {
  margin: 6px 0 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--gn-danger);
}
</style>
