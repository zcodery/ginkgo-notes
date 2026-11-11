<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Dices, Ban, Search, Upload, Link2 } from 'lucide-vue-next'
import { putAsset } from '@/db/repo'
import {
  ALL_EMOJIS,
  EMOJI_CATEGORIES,
  LUCIDE_ICON_MAP,
  LUCIDE_ICON_NAMES,
  assetIcon,
  emojiIcon,
  loadRecentIcons,
  lucideIcon,
  pushRecentIcon,
  urlIcon,
} from './pageIcon'
import PageIcon from './PageIcon.vue'

type Tab = 'emoji' | 'icons' | 'upload' | 'link'

const props = defineProps<{
  /** 当前图标，用于高亮 */
  current?: string | null
}>()

const emit = defineEmits<{
  (e: 'pick', icon: string): void
  (e: 'clear'): void
}>()

const tab = ref<Tab>('emoji')
const query = ref('')
const recent = ref<string[]>([])
const categoryId = ref(EMOJI_CATEGORIES[0]!.id)
const linkUrl = ref('')
const linkError = ref('')
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const gridRef = ref<HTMLElement | null>(null)

const tabs: { id: Tab; label: string }[] = [
  { id: 'emoji', label: 'Emoji' },
  { id: 'icons', label: 'Icons' },
  { id: 'upload', label: '上传' },
  { id: 'link', label: '链接' },
]

const searchPlaceholder = computed(() => {
  if (tab.value === 'emoji') return '搜索 Emoji'
  if (tab.value === 'icons') return '搜索 Icons'
  return '搜索'
})

onMounted(async () => {
  recent.value = await loadRecentIcons()
  await nextTick()
  searchRef.value?.focus()
})

watch(tab, () => {
  query.value = ''
  linkError.value = ''
  void nextTick(() => {
    if (tab.value === 'emoji' || tab.value === 'icons') searchRef.value?.focus()
  })
})

const q = computed(() => query.value.trim().toLowerCase())

const filteredRecent = computed(() => {
  if (!q.value) return recent.value
  return recent.value.filter((icon) => icon.toLowerCase().includes(q.value))
})

const activeCategory = computed(
  () => EMOJI_CATEGORIES.find((c) => c.id === categoryId.value) ?? EMOJI_CATEGORIES[0]!,
)

const filteredEmojis = computed(() => {
  const list = q.value
    ? ALL_EMOJIS.filter((e) => e.includes(query.value.trim()))
    : activeCategory.value.emojis
  return [...new Set(list)]
})

const filteredLucide = computed(() => {
  if (!q.value) return LUCIDE_ICON_NAMES
  return LUCIDE_ICON_NAMES.filter((n) => n.toLowerCase().includes(q.value))
})

async function pick(icon: string) {
  if (!icon) return
  recent.value = await pushRecentIcon(icon)
  emit('pick', icon)
}

function pickEmoji(e: string) {
  void pick(emojiIcon(e))
}

function pickLucide(name: string) {
  void pick(lucideIcon(name))
}

function onClear() {
  emit('clear')
}

function onRandom() {
  if (tab.value === 'icons') {
    const name = LUCIDE_ICON_NAMES[Math.floor(Math.random() * LUCIDE_ICON_NAMES.length)]
    if (name) pickLucide(name)
    return
  }
  const pool = ALL_EMOJIS
  const e = pool[Math.floor(Math.random() * pool.length)]
  if (e) pickEmoji(e)
}

function scrollToCategory(id: string) {
  categoryId.value = id
  query.value = ''
  void nextTick(() => {
    gridRef.value?.scrollTo({ top: 0 })
  })
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !file.type.startsWith('image/')) return
  uploading.value = true
  try {
    const asset = await putAsset(file, file.name)
    await pick(assetIcon(asset.id))
  } finally {
    uploading.value = false
  }
}

function submitLink() {
  const raw = linkUrl.value.trim()
  if (!raw) {
    linkError.value = '请输入图片链接'
    return
  }
  let url = raw
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad')
  } catch {
    linkError.value = '链接格式不正确'
    return
  }
  linkError.value = ''
  void pick(urlIcon(url))
}

const cellClass =
  'flex aspect-square items-center justify-center rounded-md border-0 bg-transparent text-gn-soft cursor-pointer hover:bg-gn-hover hover:text-gn-text data-[on=true]:bg-gn-accent-soft data-[on=true]:shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--gn-accent)_50%,transparent)]'
</script>

<template>
  <div
    class="icon-picker gn-pop flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[10px] border border-gn-border bg-gn-bg shadow-gn-lg"
    @mousedown.stop
  >
    <div class="flex items-center justify-between gap-1.5 px-2.5 pt-1.5">
      <div class="flex min-w-0 items-center gap-0.5">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          class="h-6 rounded-md border-0 bg-transparent px-2 font-gn text-xs text-gn-soft cursor-pointer hover:bg-gn-hover hover:text-gn-text data-[on=true]:bg-gn-active data-[on=true]:font-medium data-[on=true]:text-gn-text"
          :data-on="tab === t.id"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="inline-flex h-6 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 font-gn text-[11.5px] whitespace-nowrap text-gn-muted cursor-pointer hover:bg-gn-hover hover:text-gn-soft"
          v-tooltip="'随机选择'"
          @click="onRandom"
        >
          <Dices :size="12" :stroke-width="1.8" /><span>随机选择</span>
        </button>
        <button
          type="button"
          class="inline-flex h-6 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 font-gn text-[11.5px] whitespace-nowrap text-gn-muted cursor-pointer hover:bg-gn-hover hover:text-gn-soft"
          v-tooltip="'清除'"
          @click="onClear"
        >
          <Ban :size="12" :stroke-width="1.8" /><span>清除</span>
        </button>
      </div>
    </div>

    <div
      v-if="tab === 'emoji' || tab === 'icons'"
      class="mx-2.5 mt-1.5 flex h-7 items-center gap-1.5 rounded-lg border border-gn-border bg-gn-hover px-2 text-gn-muted"
    >
      <Search :size="12" :stroke-width="1.8" />
      <input
        ref="searchRef"
        v-model="query"
        class="min-w-0 flex-1 border-0 bg-transparent font-gn text-xs text-gn-text outline-none"
        :placeholder="searchPlaceholder"
        spellcheck="false"
      />
    </div>

    <!-- Emoji -->
    <template v-if="tab === 'emoji'">
      <div ref="gridRef" class="ip-body gn-scroll h-[232px] overflow-y-auto px-2.5 pt-1.5 pb-2.5">
        <template v-if="!q && filteredRecent.length">
          <div class="px-0.5 pt-1.5 pb-1 text-[11px] text-gn-muted">最近使用</div>
          <div class="grid grid-cols-11 gap-0.5">
            <button
              v-for="icon in filteredRecent"
              :key="'r-' + icon"
              type="button"
              :class="cellClass"
              :data-on="current === icon"
              @click="pick(icon)"
            >
              <PageIcon :icon="icon" :size="16" />
            </button>
          </div>
        </template>

        <div class="px-0.5 pt-1.5 pb-1 text-[11px] text-gn-muted">
          {{ q ? '搜索结果' : activeCategory.label }}
        </div>
        <div v-if="filteredEmojis.length" class="grid grid-cols-11 gap-0.5">
          <button
            v-for="e in filteredEmojis"
            :key="e"
            type="button"
            :class="cellClass"
            :data-on="current === e"
            @click="pickEmoji(e)"
          >
            <span class="text-[17px] leading-none">{{ e }}</span>
          </button>
        </div>
        <div v-else class="px-2 py-6 text-center text-xs text-gn-muted">没有匹配的 Emoji</div>
      </div>

      <div
        v-if="!q"
        class="flex gap-0.5 overflow-x-auto border-t border-gn-border px-1.5 pt-1 pb-1.5"
      >
        <button
          v-for="c in EMOJI_CATEGORIES"
          :key="c.id"
          type="button"
          class="relative h-6 shrink-0 border-0 bg-transparent px-2 font-gn text-[11.5px] text-gn-muted cursor-pointer hover:text-gn-soft data-[on=true]:font-medium data-[on=true]:text-gn-text after:absolute after:right-1.5 after:bottom-0.5 after:left-1.5 after:h-0.5 after:rounded-sm after:bg-transparent data-[on=true]:after:bg-gn-accent"
          :data-on="categoryId === c.id"
          @click="scrollToCategory(c.id)"
        >
          {{ c.label }}
        </button>
      </div>
    </template>

    <!-- Icons (Lucide) -->
    <template v-else-if="tab === 'icons'">
      <div class="gn-scroll h-[232px] overflow-y-auto px-2.5 pt-1.5 pb-2.5">
        <template v-if="!q && filteredRecent.length">
          <div class="px-0.5 pt-1.5 pb-1 text-[11px] text-gn-muted">最近使用</div>
          <div class="grid grid-cols-11 gap-0.5">
            <button
              v-for="icon in filteredRecent"
              :key="'ri-' + icon"
              type="button"
              :class="cellClass"
              :data-on="current === icon"
              @click="pick(icon)"
            >
              <PageIcon :icon="icon" :size="15" />
            </button>
          </div>
        </template>
        <div class="px-0.5 pt-1.5 pb-1 text-[11px] text-gn-muted">{{ q ? '搜索结果' : '图标' }}</div>
        <div v-if="filteredLucide.length" class="grid grid-cols-11 gap-0.5">
          <button
            v-for="name in filteredLucide"
            :key="name"
            type="button"
            :class="cellClass"
            :data-on="current === lucideIcon(name)"
            v-tooltip="name"
            @click="pickLucide(name)"
          >
            <component :is="LUCIDE_ICON_MAP[name]" :size="14" :stroke-width="1.7" />
          </button>
        </div>
        <div v-else class="px-2 py-6 text-center text-xs text-gn-muted">没有匹配的图标</div>
      </div>
    </template>

    <!-- 上传 -->
    <template v-else-if="tab === 'upload'">
      <div class="flex min-h-[180px] flex-col gap-2 px-3 py-3.5">
        <button
          type="button"
          class="flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-gn-border-strong bg-gn-hover font-gn text-sm text-gn-soft hover:border-gn-accent hover:text-gn-text disabled:cursor-default disabled:opacity-60"
          :disabled="uploading"
          @click="fileInput?.click()"
        >
          <Upload :size="18" :stroke-width="1.7" />
          <span>{{ uploading ? '上传中…' : '选择图片' }}</span>
          <span class="text-[11px] text-gn-muted">支持 PNG / JPG / GIF / WebP</span>
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onFile"
        />
      </div>
    </template>

    <!-- 链接 -->
    <template v-else>
      <div class="flex min-h-[180px] flex-col gap-2 px-3 py-3.5">
        <label class="inline-flex items-center gap-1.5 text-xs text-gn-soft">
          <Link2 :size="12" :stroke-width="1.8" />
          图片链接
        </label>
        <input
          v-model="linkUrl"
          class="h-7 rounded-lg border border-gn-border bg-gn-bg px-2.5 font-gn text-xs text-gn-text outline-none focus:border-gn-accent"
          placeholder="https://example.com/icon.png"
          spellcheck="false"
          @keydown.enter.prevent="submitLink"
        />
        <p v-if="linkError" class="m-0 text-[11.5px] text-gn-danger">{{ linkError }}</p>
        <button
          type="button"
          class="h-7 w-fit cursor-pointer rounded-lg border-0 bg-gn-accent px-3 font-gn text-xs text-white hover:brightness-105"
          @click="submitLink"
        >
          使用此链接
        </button>
      </div>
    </template>
  </div>
</template>
