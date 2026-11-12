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
  /** 缩略图 */
  thumb: string
  /** 封面用大图 */
  full: string
}

/** 精选 Unsplash 封面（直链，无需 API Key） */
export const UNSPLASH_COVERS: UnsplashCover[] = [
  {
    id: 'u1',
    label: '雪山',
    tags: ['mountain', 'snow', 'nature', '山', '雪'],
    thumb: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&q=80&auto=format',
  },
  {
    id: 'u2',
    label: '海岸',
    tags: ['ocean', 'beach', 'blue', '海', '海岸'],
    thumb: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80&auto=format',
  },
  {
    id: 'u3',
    label: '森林晨雾',
    tags: ['forest', 'fog', 'green', '林', '雾'],
    thumb: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1600&q=80&auto=format',
  },
  {
    id: 'u4',
    label: '沙漠',
    tags: ['desert', 'sand', 'warm', '沙', '沙漠'],
    thumb: 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=1600&q=80&auto=format',
  },
  {
    id: 'u5',
    label: '城市夜景',
    tags: ['city', 'night', 'lights', '城', '夜'],
    thumb: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1600&q=80&auto=format',
  },
  {
    id: 'u6',
    label: '樱花',
    tags: ['cherry', 'blossom', 'pink', '樱', '花'],
    thumb: 'https://images.unsplash.com/photo-1522383225653-ed111181a951?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1522383225653-ed111181a951?w=1600&q=80&auto=format',
  },
  {
    id: 'u7',
    label: '极光',
    tags: ['aurora', 'north', 'sky', '极光', '天空'],
    thumb: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1600&q=80&auto=format',
  },
  {
    id: 'u8',
    label: '咖啡桌',
    tags: ['coffee', 'desk', 'warm', '咖啡', '桌'],
    thumb: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1600&q=80&auto=format',
  },
  {
    id: 'u9',
    label: '抽象几何',
    tags: ['abstract', 'geometry', 'color', '抽象', '几何'],
    thumb: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=1600&q=80&auto=format',
  },
  {
    id: 'u10',
    label: '湖面倒影',
    tags: ['lake', 'reflection', 'calm', '湖', '倒影'],
    thumb: 'https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=1600&q=80&auto=format',
  },
  {
    id: 'u11',
    label: '薰衣草田',
    tags: ['lavender', 'field', 'purple', '薰衣草', '田'],
    thumb: 'https://images.unsplash.com/photo-1499002238440-d647abb67575?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1499002238440-d647abb67575?w=1600&q=80&auto=format',
  },
  {
    id: 'u12',
    label: '书房',
    tags: ['books', 'library', 'study', '书', '书房'],
    thumb: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=1600&q=80&auto=format',
  },
  {
    id: 'u13',
    label: '星空',
    tags: ['stars', 'milky', 'night', '星', '夜空'],
    thumb: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1600&q=80&auto=format',
  },
  {
    id: 'u14',
    label: '秋叶',
    tags: ['autumn', 'leaves', 'fall', '秋', '叶'],
    thumb: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1600&q=80&auto=format',
  },
  {
    id: 'u15',
    label: '工作室建筑',
    tags: ['architecture', 'minimal', 'white', '建筑', '极简'],
    thumb: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1600&q=80&auto=format',
  },
  {
    id: 'u16',
    label: '雨窗',
    tags: ['rain', 'window', 'mood', '雨', '窗'],
    thumb: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=320&q=60&auto=format',
    full: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=1600&q=80&auto=format',
  },
]

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
    const url = cover.slice(URL_PREFIX.length)
    return url ? `center / cover no-repeat url("${url.replace(/"/g, '\\"')}")` : null
  }
  if (/^https?:\/\//i.test(cover)) {
    return `center / cover no-repeat url("${cover.replace(/"/g, '\\"')}")`
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
