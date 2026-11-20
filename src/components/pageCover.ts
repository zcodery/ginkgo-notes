import { ASSET_PREFIX, assetToUrl } from '@/editor/assets'

export const GRADIENT_PREFIX = 'gradient:'
export const GALLERY_PREFIX = 'gallery:'
export const COLOR_PREFIX = 'color:'
export const URL_PREFIX = 'url:'

export const COVER_PRESETS = [
  { id: 'ginkgo', label: '银杏', css: 'linear-gradient(135deg, #e3eed2 0%, #9cc28a 100%)' },
  { id: 'mint', label: '薄荷', css: 'linear-gradient(135deg, #dcf4ec 0%, #86d0b6 100%)' },
  { id: 'sky', label: '晴空', css: 'linear-gradient(135deg, #dcefff 0%, #8fc1e8 100%)' },
  { id: 'lavender', label: '薰衣草', css: 'linear-gradient(135deg, #ece2f7 0%, #b9a0dd 100%)' },
  { id: 'rose', label: '玫瑰', css: 'linear-gradient(135deg, #fde3e8 0%, #f09cb0 100%)' },
  { id: 'sunrise', label: '朝霞', css: 'linear-gradient(135deg, #fee6cc 0%, #f6a57e 100%)' },
  { id: 'sand', label: '沙丘', css: 'linear-gradient(135deg, #f5eddc 0%, #d8c09a 100%)' },
  { id: 'slate', label: '石板', css: 'linear-gradient(135deg, #e6eaef 0%, #9aa6b4 100%)' },
  { id: 'forest', label: '森林', css: 'linear-gradient(135deg, #5d7f62 0%, #2f4a36 100%)' },
  { id: 'night', label: '夜空', css: 'linear-gradient(135deg, #596b8a 0%, #232c3d 100%)' },
  {
    id: 'aurora',
    label: '极光',
    css: 'linear-gradient(120deg, #0f2027 0%, #203a43 40%, #2c5364 70%, #1a5c4a 100%)',
  },
  {
    id: 'peach',
    label: '蜜桃',
    css: 'linear-gradient(160deg, #ffecd2 0%, #fcb69f 50%, #ff9a9e 100%)',
  },
] as const

/** 图库：CSS 艺术封面（不依赖外链） */
export const GALLERY_COVERS = [
  {
    id: 'leaf-grid',
    label: '银杏叶',
    css: 'radial-gradient(circle at 20% 30%, #c8e09a 0 18%, transparent 19%), radial-gradient(circle at 70% 20%, #a8c97a 0 14%, transparent 15%), radial-gradient(circle at 40% 70%, #8fb86a 0 22%, transparent 23%), linear-gradient(135deg, #eef6e0, #b7d48a)',
  },
  {
    id: 'pixel-dusk',
    label: '像素黄昏',
    css: 'repeating-linear-gradient(90deg, #2b1e3a 0 12px, #3d2a52 12px 24px), linear-gradient(180deg, #f6a26b 0%, #e06b8a 45%, #2b1e3a 46%)',
  },
  {
    id: 'soft-waves',
    label: '柔波',
    css: 'radial-gradient(120% 80% at 10% 100%, #7ec8e3 0%, transparent 55%), radial-gradient(100% 70% at 90% 0%, #f7b267 0%, transparent 50%), linear-gradient(180deg, #f7f2ea, #d9e8f5)',
  },
  {
    id: 'paper-plane',
    label: '纸飞机',
    css: 'linear-gradient(135deg, transparent 48%, #ffffff88 48% 52%, transparent 52%), linear-gradient(45deg, #89c2d9, #4a90a4)',
  },
  {
    id: 'moss-stone',
    label: '苔石',
    css: 'radial-gradient(ellipse at 30% 40%, #6b8f71 0%, transparent 55%), radial-gradient(ellipse at 80% 70%, #3f5d4a 0%, transparent 50%), linear-gradient(160deg, #c5d5c0, #5a7a62)',
  },
  {
    id: 'candy-stripe',
    label: '糖条',
    css: 'repeating-linear-gradient(45deg, #ffd6e0 0 16px, #fff5f7 16px 32px)',
  },
  {
    id: 'ink-wash',
    label: '水墨',
    css: 'radial-gradient(circle at 60% 40%, #1f1f1f 0%, transparent 42%), radial-gradient(circle at 30% 70%, #4a4a4a 0%, transparent 40%), linear-gradient(180deg, #f4f1ea, #d8d2c4)',
  },
  {
    id: 'neon-grid',
    label: '霓虹格',
    css: 'repeating-linear-gradient(0deg, transparent 0 22px, #00ffff33 22px 23px), repeating-linear-gradient(90deg, transparent 0 22px, #00ffff33 22px 23px), linear-gradient(135deg, #0b1020, #1a1030)',
  },
  {
    id: 'desert-dune',
    label: '沙丘线',
    css: 'radial-gradient(140% 90% at 50% 120%, #c9894a 0%, transparent 55%), linear-gradient(180deg, #f6e7c8 0%, #e8c48a 40%, #c9894a 100%)',
  },
  {
    id: 'ocean-deep',
    label: '深海',
    css: 'radial-gradient(circle at 50% 0%, #4ecdc4 0%, transparent 45%), linear-gradient(180deg, #1a535c, #0b1d26)',
  },
  {
    id: 'blossom',
    label: '樱色',
    css: 'radial-gradient(circle at 20% 80%, #ffb7c5 0 20%, transparent 21%), radial-gradient(circle at 75% 30%, #ffc9d4 0 16%, transparent 17%), linear-gradient(160deg, #fff0f3, #f7a8b8)',
  },
  {
    id: 'midnight-city',
    label: '午夜城',
    css: 'linear-gradient(90deg, #1e1b4b 0%, #312e81 35%, #4c1d95 70%, #1e1b4b 100%), repeating-linear-gradient(90deg, transparent 0 18px, #ffffff08 18px 19px)',
  },
] as const

export const COLOR_PRESETS = [
  { id: 'white', label: '白', css: '#f7f7f5' },
  { id: 'gray', label: '灰', css: '#e3e2e0' },
  { id: 'brown', label: '棕', css: '#eee0da' },
  { id: 'orange', label: '橙', css: '#fadec9' },
  { id: 'yellow', label: '黄', css: '#fdecc8' },
  { id: 'green', label: '绿', css: '#dbeddb' },
  { id: 'blue', label: '蓝', css: '#d3e5ef' },
  { id: 'purple', label: '紫', css: '#e8deee' },
  { id: 'pink', label: '粉', css: '#f5e0e9' },
  { id: 'red', label: '红', css: '#ffe2dd' },
  { id: 'dark', label: '深灰', css: '#37352f' },
  { id: 'navy', label: '藏青', css: '#1e3a5f' },
] as const

export type UnsplashCover = {
  id: string
  label: string
  tags: string[]
  /** 缩略图（本地文件，见 public/covers/unsplash） */
  thumb: string
  /** 封面用大图（本地文件） */
  full: string
  /** 原始 Unsplash 图号，仅用于把历史数据里的外链迁到本地 */
  photo: string
}

/**
 * 精选 Unsplash 封面。
 *
 * 图片已本地化到 `public/covers/unsplash/`：Unsplash 直连在国内经常 4–12 秒甚至超时，
 * 造成「封面网格偶尔空白」「换封面要等很久」。改为随应用一起分发后即开即用，
 * 也不再有外链失效（原「薰衣草田」那张已经 404）。
 */
const COVER_DIR = '/covers/unsplash'

function cover(
  id: string,
  label: string,
  tags: string[],
  photo: string,
): UnsplashCover {
  return { id, label, tags, photo, thumb: `${COVER_DIR}/${id}-t.webp`, full: `${COVER_DIR}/${id}.webp` }
}

export const UNSPLASH_COVERS: UnsplashCover[] = [
  cover('u1', '雪山', ['mountain', 'snow', 'nature', '山', '雪'], 'photo-1506905925346-21bda4d32df4'),
  cover('u2', '海岸', ['ocean', 'beach', 'blue', '海', '海岸'], 'photo-1507525428034-b723cf961d3e'),
  cover('u3', '森林晨雾', ['forest', 'fog', 'green', '林', '雾'], 'photo-1441974231531-c6227db76b6e'),
  cover('u4', '沙漠', ['desert', 'sand', 'warm', '沙', '沙漠'], 'photo-1509316785289-025f5b846b35'),
  cover('u5', '城市夜景', ['city', 'night', 'lights', '城', '夜'], 'photo-1514565131-fce0801e5785'),
  cover('u6', '樱花', ['cherry', 'blossom', 'pink', '樱', '花'], 'photo-1522383225653-ed111181a951'),
  cover('u7', '极光', ['aurora', 'north', 'sky', '极光', '天空'], 'photo-1531366936337-7c912a4589a7'),
  cover('u8', '咖啡桌', ['coffee', 'desk', 'warm', '咖啡', '桌'], 'photo-1495474472287-4d71bcdd2085'),
  cover('u9', '抽象几何', ['abstract', 'geometry', 'color', '抽象', '几何'], 'photo-1557683316-973673baf926'),
  cover('u10', '湖面倒影', ['lake', 'reflection', 'calm', '湖', '倒影'], 'photo-1439066615861-d1af74d74000'),
  cover('u11', '向日葵', ['sunflower', 'flower', 'yellow', '花', '向日葵'], 'photo-1470509037663-253afd7f0f51'),
  cover('u12', '书房', ['books', 'library', 'study', '书', '书房'], 'photo-1481627834876-b7833e8f5570'),
  cover('u13', '星空', ['stars', 'milky', 'night', '星', '夜空'], 'photo-1419242902214-272b3f66ee7a'),
  cover('u14', '人像', ['portrait', 'person', 'face', '人', '肖像'], 'photo-1507003211169-0a1dd7228f2d'),
  cover('u15', '现代建筑', ['architecture', 'minimal', 'white', '建筑', '极简'], 'photo-1487958449943-2429e8be8625'),
  cover('u16', '雨窗', ['rain', 'window', 'mood', '雨', '窗'], 'photo-1515694346937-94d85e41e6f0'),
]

/** 图号 → 本地封面（含已失效图号的历史映射） */
const LOCAL_BY_PHOTO = new Map<string, string>([
  ...UNSPLASH_COVERS.map((c) => [c.photo, c.full] as [string, string]),
  // 原「薰衣草田」图片已 404，历史封面统一迁到向日葵
  ['photo-1499002238440-d647abb67575', `${COVER_DIR}/u11.webp`],
])

/** 把历史数据里的 Unsplash 外链换成随包分发的本地文件 */
export function localizeCoverUrl(url: string): string {
  if (!url.includes('images.unsplash.com/')) return url
  const m = /images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/.exec(url)
  const local = m ? LOCAL_BY_PHOTO.get(m[1]!) : undefined
  return local ?? url
}

/** 比较封面是否同一张（历史外链与本地文件视为同一张） */
export function normalizeCoverValue(cover: string | null | undefined): string {
  if (!cover) return ''
  if (cover.startsWith(URL_PREFIX)) {
    return `${URL_PREFIX}${localizeCoverUrl(cover.slice(URL_PREFIX.length))}`
  }
  return localizeCoverUrl(cover)
}

export function gradientCover(id: string): string {
  return `${GRADIENT_PREFIX}${id}`
}

export function colorCover(id: string): string {
  return `${COLOR_PREFIX}${id}`
}

export function urlCover(url: string): string {
  return `${URL_PREFIX}${url}`
}

export function galleryCover(id: string): string {
  return `${GALLERY_PREFIX}${id}`
}

export function randomGradientCover(): string {
  const p = COVER_PRESETS[Math.floor(Math.random() * COVER_PRESETS.length)]!
  return gradientCover(p.id)
}

function resolveGalleryCss(id: string): string | null {
  const g = GALLERY_COVERS.find((p) => p.id === id)
  if (!g) return null
  return g.css
}

function resolveCssCover(cover: string): string | null {
  if (cover.startsWith(GALLERY_PREFIX)) {
    return resolveGalleryCss(cover.slice(GALLERY_PREFIX.length)) ?? COVER_PRESETS[0].css
  }
  if (cover.startsWith(GRADIENT_PREFIX)) {
    const id = cover.slice(GRADIENT_PREFIX.length)
    return COVER_PRESETS.find((p) => p.id === id)?.css ?? COVER_PRESETS[0].css
  }
  if (cover.startsWith(COLOR_PREFIX)) {
    const id = cover.slice(COLOR_PREFIX.length)
    return COLOR_PRESETS.find((p) => p.id === id)?.css ?? COLOR_PRESETS[0].css
  }
  if (cover.startsWith(URL_PREFIX)) {
    const url = localizeCoverUrl(cover.slice(URL_PREFIX.length))
    return url ? `center / cover no-repeat url("${url.replace(/"/g, '\\"')}")` : null
  }
  if (/^https?:\/\//i.test(cover)) {
    const url = localizeCoverUrl(cover)
    return `center / cover no-repeat url("${url.replace(/"/g, '\\"')}")`
  }
  return null
}

/** 把封面值解析成可直接用于 style 的 background；图片需异步取 blob URL */
export async function resolveCoverBackground(cover: string | null | undefined): Promise<string | null> {
  if (!cover) return null
  if (cover.startsWith(ASSET_PREFIX)) {
    const url = await assetToUrl(cover.slice(ASSET_PREFIX.length))
    return url ? `center / cover no-repeat url("${url}")` : null
  }
  return resolveCssCover(cover)
}

/** 同步解析（分享页等无法读本地 asset 时可用；asset 需自行处理） */
export function resolveCoverBackgroundSync(cover: string | null | undefined): string | null {
  if (!cover) return null
  return resolveCssCover(cover)
}

export function aiCoverUrl(prompt: string, seed?: number): string {
  const q = encodeURIComponent(prompt.trim() || 'abstract watercolor cover')
  const s = seed ?? Math.floor(Math.random() * 1_000_000)
  return `https://image.pollinations.ai/prompt/${q}?width=1600&height=600&nologo=true&seed=${s}`
}
