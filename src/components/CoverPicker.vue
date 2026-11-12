<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Ban, Link2, Loader2, Search, Sparkles, Upload } from 'lucide-vue-next'
import { putAsset } from '@/db/repo'
import { ASSET_PREFIX } from '@/editor/assets'
import { tr } from '@/i18n/phrases'
import {
  COLOR_PRESETS,
  COVER_PRESETS,
  GALLERY_COVERS,
  UNSPLASH_COVERS,
  aiCoverUrl,
  colorCover,
  galleryCover,
  gradientCover,
  urlCover,
} from './pageCover'

type Tab = 'gallery' | 'upload' | 'link' | 'unsplash' | 'ai'

const props = defineProps<{
  current?: string | null
}>()

const emit = defineEmits<{
  (e: 'pick', cover: string): void
  (e: 'clear'): void
}>()

const tab = ref<Tab>('gallery')
const linkUrl = ref('')
const linkError = ref('')
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
const unsplashQuery = ref('')
const aiPrompt = ref('')
const aiBusy = ref(false)
const aiPreview = ref<string | null>(null)
const aiError = ref('')
const tabs: { id: Tab; label: string }[] = [
  { id: 'gallery', label: '图库' },
  { id: 'upload', label: '上传' },
  { id: 'link', label: '链接' },
  { id: 'unsplash', label: 'Unsplash' },
  { id: 'ai', label: 'AI 生成' },
]

watch(tab, () => {
  linkError.value = ''
  aiError.value = ''
})

const filteredUnsplash = computed(() => {
  const q = unsplashQuery.value.trim().toLowerCase()
  if (!q) return UNSPLASH_COVERS
  return UNSPLASH_COVERS.filter(
    (u) =>
      u.label.toLowerCase().includes(q) ||
      u.tags.some((t) => t.toLowerCase().includes(q)),
  )
})

function pick(cover: string) {
  emit('pick', cover)
}

function onClear() {
  emit('clear')
}

function pickGradient(id: string) {
  pick(gradientCover(id))
}

function pickGallery(id: string) {
  pick(galleryCover(id))
}

function pickColor(id: string) {
  pick(colorCover(id))
}

function pickUnsplash(full: string) {
  pick(urlCover(full))
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await uploadFile(file)
}

async function uploadFile(file: File) {
  if (!file.type.startsWith('image/')) return
  uploading.value = true
  try {
    const asset = await putAsset(file, file.name)
    pick(`${ASSET_PREFIX}${asset.id}`)
  } finally {
    uploading.value = false
  }
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) void uploadFile(file)
}

function submitLink() {
  const raw = linkUrl.value.trim()
  if (!raw) {
    linkError.value = tr('请输入图片链接')
    return
  }
  let url = raw
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad')
  } catch {
    linkError.value = tr('链接格式不正确')
    return
  }
  linkError.value = ''
  pick(urlCover(url))
}

async function generateAi() {
  const prompt = aiPrompt.value.trim()
  if (!prompt) {
    aiError.value = tr('请输入描述')
    return
  }
  aiError.value = ''
  aiBusy.value = true
  aiPreview.value = null
  try {
    const url = aiCoverUrl(prompt)
    // 预热图片；失败也允许用户直接套用链接
    await new Promise<void>((resolve) => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = url
      setTimeout(() => resolve(), 8000)
    })
    aiPreview.value = url
  } finally {
    aiBusy.value = false
  }
}

function applyAiPreview() {
  if (!aiPreview.value) return
  pick(urlCover(aiPreview.value))
}

function isOn(value: string) {
  return props.current === value
}
</script>

<template>
  <div
    class="cover-pop gn-pop flex w-[540px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[12px] border border-gn-border bg-gn-bg shadow-gn-lg"
    @mousedown.stop
  >
    <div class="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
      <div class="flex min-w-0 flex-wrap items-center gap-0.5">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          class="h-7 rounded-md border-0 bg-transparent px-2.5 font-gn text-[13px] text-gn-soft cursor-pointer hover:bg-gn-hover hover:text-gn-text data-[on=true]:bg-gn-active data-[on=true]:font-medium data-[on=true]:text-gn-text"
          :data-on="tab === t.id"
          @click="tab = t.id"
        >
          {{ tr(t.label) }}
        </button>
      </div>
      <button
        type="button"
        class="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border-0 bg-transparent px-2 font-gn text-[12px] whitespace-nowrap text-gn-muted cursor-pointer hover:bg-gn-hover hover:text-gn-soft"
        @click="onClear"
      >
        <Ban :size="13" :stroke-width="1.8" /><span>{{ tr('清除') }}</span>
      </button>
    </div>

    <!-- 图库 -->
    <div v-if="tab === 'gallery'" class="gn-scroll max-h-[360px] overflow-y-auto px-3 pb-3 pt-1">
      <div class="px-0.5 pb-1.5 text-[12px] font-medium text-gn-muted">Ginkgo</div>
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="g in GALLERY_COVERS"
          :key="g.id"
          type="button"
          class="cover-thumb relative aspect-[16/10] overflow-hidden rounded-lg border-2 border-transparent cursor-pointer outline-none hover:opacity-90 data-[on=true]:border-[var(--gn-accent)]"
          :data-on="isOn(galleryCover(g.id))"
          :style="{ background: g.css }"
          :title="g.label"
          @click="pickGallery(g.id)"
        ></button>
      </div>

      <div class="px-0.5 pt-3 pb-1.5 text-[12px] font-medium text-gn-muted">{{ tr('渐变') }}</div>
      <div class="grid grid-cols-6 gap-1.5">
        <button
          v-for="c in COVER_PRESETS"
          :key="c.id"
          type="button"
          class="cover-thumb aspect-[16/10] rounded-md border-2 border-transparent cursor-pointer outline-none hover:opacity-90 data-[on=true]:border-[var(--gn-accent)]"
          :data-on="isOn(gradientCover(c.id))"
          :style="{ background: c.css }"
          :title="c.label"
          @click="pickGradient(c.id)"
        ></button>
      </div>

      <div class="px-0.5 pt-3 pb-1.5 text-[12px] font-medium text-gn-muted">
        {{ tr('颜色') }}
      </div>
      <div class="grid grid-cols-6 gap-1.5">
        <button
          v-for="c in COLOR_PRESETS"
          :key="c.id"
          type="button"
          class="cover-thumb aspect-[16/10] rounded-md border border-gn-border border-solid cursor-pointer outline-none hover:opacity-90 data-[on=true]:!border-[var(--gn-accent)] data-[on=true]:border-2"
          :data-on="isOn(colorCover(c.id))"
          :style="{ background: c.css }"
          :title="c.label"
          @click="pickColor(c.id)"
        ></button>
      </div>
    </div>

    <!-- 上传 -->
    <div v-else-if="tab === 'upload'" class="px-3 pb-3 pt-2">
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />
      <button
        type="button"
        class="flex h-[200px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gn-border bg-gn-hover/40 font-gn text-gn-soft cursor-pointer transition-colors hover:border-gn-accent hover:bg-gn-hover hover:text-gn-text data-[drag=true]:border-[var(--gn-accent)] data-[drag=true]:bg-gn-accent-soft"
        :data-drag="dragOver"
        :disabled="uploading"
        @click="fileInput?.click()"
        @dragenter.prevent="dragOver = true"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <Loader2 v-if="uploading" :size="22" :stroke-width="1.8" class="animate-spin" />
        <Upload v-else :size="22" :stroke-width="1.8" />
        <span class="text-[13px]">{{ uploading ? tr('上传中…') : tr('点击或拖拽图片到此处') }}</span>
        <span class="text-[11px] text-gn-muted">JPG / PNG / WebP / GIF</span>
      </button>
    </div>

    <!-- 链接 -->
    <div v-else-if="tab === 'link'" class="px-3 pb-3 pt-2">
      <div class="flex items-center gap-2 rounded-lg border border-gn-border bg-gn-hover px-2.5 h-9">
        <Link2 :size="14" :stroke-width="1.8" class="shrink-0 text-gn-muted" />
        <input
          v-model="linkUrl"
          class="min-w-0 flex-1 border-0 bg-transparent font-gn text-[13px] text-gn-text outline-none"
          :placeholder="tr('粘贴图片链接…')"
          spellcheck="false"
          @keydown.enter.prevent="submitLink"
        />
      </div>
      <p v-if="linkError" class="mt-1.5 px-0.5 text-[12px] text-[var(--gn-danger)]">{{ linkError }}</p>
      <button
        type="button"
        class="mt-2.5 h-8 w-full rounded-lg border-0 bg-gn-accent font-gn text-[13px] font-medium text-white cursor-pointer hover:opacity-90"
        @click="submitLink"
      >
        {{ tr('应用') }}
      </button>
    </div>

    <!-- Unsplash -->
    <div v-else-if="tab === 'unsplash'" class="flex flex-col px-3 pb-3 pt-1">
      <div class="mb-2 flex h-8 items-center gap-1.5 rounded-lg border border-gn-border bg-gn-hover px-2.5 text-gn-muted">
        <Search :size="13" :stroke-width="1.8" />
        <input
          v-model="unsplashQuery"
          class="min-w-0 flex-1 border-0 bg-transparent font-gn text-[12.5px] text-gn-text outline-none"
          :placeholder="tr('搜索 Unsplash…')"
          spellcheck="false"
        />
      </div>
      <div class="gn-scroll max-h-[300px] overflow-y-auto">
        <div v-if="filteredUnsplash.length" class="grid grid-cols-4 gap-2">
          <button
            v-for="u in filteredUnsplash"
            :key="u.id"
            type="button"
            class="cover-thumb relative aspect-[16/10] overflow-hidden rounded-lg border-2 border-transparent bg-gn-hover cursor-pointer outline-none hover:opacity-90 data-[on=true]:border-[var(--gn-accent)]"
            :data-on="isOn(urlCover(u.full))"
            :title="u.label"
            @click="pickUnsplash(u.full)"
          >
            <img :src="u.thumb" :alt="u.label" class="h-full w-full object-cover" loading="lazy" />
          </button>
        </div>
        <div v-else class="py-10 text-center text-[12px] text-gn-muted">{{ tr('没有匹配的图片') }}</div>
      </div>
      <p class="mt-2 text-[10.5px] text-gn-muted">Photos via Unsplash</p>
    </div>

    <!-- AI -->
    <div v-else class="px-3 pb-3 pt-2">
      <div class="flex items-start gap-2 rounded-lg border border-gn-border bg-gn-hover px-2.5 py-2">
        <Sparkles :size="14" :stroke-width="1.8" class="mt-0.5 shrink-0 text-gn-muted" />
        <textarea
          v-model="aiPrompt"
          rows="2"
          class="min-w-0 flex-1 resize-none border-0 bg-transparent font-gn text-[13px] leading-5 text-gn-text outline-none"
          :placeholder="tr('描述想要的封面，例如：水彩银杏叶与秋日暖阳')"
          spellcheck="false"
          @keydown.enter.exact.prevent="generateAi"
        />
      </div>
      <p v-if="aiError" class="mt-1.5 px-0.5 text-[12px] text-[var(--gn-danger)]">{{ aiError }}</p>
      <div class="mt-2.5 flex gap-2">
        <button
          type="button"
          class="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border-0 bg-gn-accent font-gn text-[13px] font-medium text-white cursor-pointer hover:opacity-90 disabled:opacity-60"
          :disabled="aiBusy"
          @click="generateAi"
        >
          <Loader2 v-if="aiBusy" :size="14" :stroke-width="1.8" class="animate-spin" />
          <span>{{ aiBusy ? tr('生成中…') : tr('生成') }}</span>
        </button>
        <button
          type="button"
          class="h-8 flex-1 rounded-lg border border-gn-border bg-transparent font-gn text-[13px] text-gn-soft cursor-pointer hover:bg-gn-hover hover:text-gn-text disabled:opacity-50"
          :disabled="!aiPreview || aiBusy"
          @click="applyAiPreview"
        >
          {{ tr('应用') }}
        </button>
      </div>
      <div
        v-if="aiPreview"
        class="mt-2.5 overflow-hidden rounded-xl border border-gn-border bg-gn-hover"
      >
        <img :src="aiPreview" alt="" class="aspect-[8/3] w-full object-cover" />
      </div>
      <p class="mt-2 text-[10.5px] text-gn-muted">{{ tr('由 AI 根据描述生成封面图') }}</p>
    </div>

  </div>
</template>
