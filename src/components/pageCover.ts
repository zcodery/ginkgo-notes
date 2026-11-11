import { ASSET_PREFIX, assetToUrl } from '@/editor/assets'

export const GRADIENT_PREFIX = 'gradient:'

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
] as const

export function randomGradientCover(): string {
  const p = COVER_PRESETS[Math.floor(Math.random() * COVER_PRESETS.length)]!
  return `${GRADIENT_PREFIX}${p.id}`
}

/** 把封面值解析成可直接用于 style 的 background；图片需异步取 blob URL */
export async function resolveCoverBackground(cover: string | null | undefined): Promise<string | null> {
  if (!cover) return null
  if (cover.startsWith(GRADIENT_PREFIX)) {
    const id = cover.slice(GRADIENT_PREFIX.length)
    return COVER_PRESETS.find((p) => p.id === id)?.css ?? COVER_PRESETS[0].css
  }
  if (cover.startsWith(ASSET_PREFIX)) {
    const url = await assetToUrl(cover.slice(ASSET_PREFIX.length))
    return url ? `center / cover no-repeat url("${url}")` : null
  }
  return null
}
