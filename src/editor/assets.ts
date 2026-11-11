import { getAsset, putAsset } from '@/db/repo'

/**
 * 图片资源引用：Markdown 里存 `asset:<id>`，
 * 运行时替换成 blob: URL 交给编辑器渲染，导出时再换回可移植的 data URL。
 */

const urlCache = new Map<string, string>()

/** 切换账号 / 空间时释放已生成的 blob URL */
export function clearAssetCache(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
}

export const ASSET_PREFIX = 'asset:'

export function isAssetUrl(src: string): boolean {
  return typeof src === 'string' && src.startsWith(ASSET_PREFIX)
}

export function assetIdOf(src: string): string {
  return src.slice(ASSET_PREFIX.length)
}

export async function assetToUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const asset = await getAsset(id)
  if (!asset) return null
  const url = URL.createObjectURL(asset.blob)
  urlCache.set(id, url)
  return url
}

/** 把 Markdown 中的 asset: 引用换成本次会话可用的 blob URL */
export async function hydrateAssets(markdown: string): Promise<string> {
  const ids = new Set<string>()
  for (const m of markdown.matchAll(/asset:([a-zA-Z0-9-]+)/g)) ids.add(m[1])
  if (!ids.size) return markdown
  let out = markdown
  await Promise.all(
    [...ids].map(async (id) => {
      const url = await assetToUrl(id)
      if (url) out = out.split(`${ASSET_PREFIX}${id}`).join(url)
    }),
  )
  return out
}

/** 序列化回 Markdown 之前，把 blob URL 还原成 asset:<id> */
export function dehydrateAssets(docJson: string): string {
  let out = docJson
  for (const [id, url] of urlCache) {
    if (out.includes(url)) out = out.split(url).join(`${ASSET_PREFIX}${id}`)
  }
  // 兜底：本次会话中已不在缓存里的 blob url 无法还原，保持原样
  return out
}

export async function importImageFile(file: File): Promise<string> {
  const asset = await putAsset(file, file.name)
  const url = URL.createObjectURL(asset.blob)
  urlCache.set(asset.id, url)
  return url
}

/** 导出时把 asset: 转换成内联 data URL，保证 .md 单文件可用 */
export async function inflateAssetsForExport(markdown: string): Promise<string> {
  const ids = new Set<string>()
  for (const m of markdown.matchAll(/asset:([a-zA-Z0-9-]+)/g)) ids.add(m[1])
  if (!ids.size) return markdown
  let out = markdown
  for (const id of ids) {
    const asset = await getAsset(id)
    if (!asset) continue
    const dataUrl = await blobToDataURL(asset.blob)
    out = out.split(`${ASSET_PREFIX}${id}`).join(dataUrl)
  }
  return out
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
