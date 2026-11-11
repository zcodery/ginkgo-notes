import html2canvas from 'html2canvas-pro'
import { jsPDF } from 'jspdf'

export function safeFileName(title: string | null | undefined) {
  return (title || '未命名').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名'
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export type ExportPaper = 'plain' | 'cream' | 'lined' | 'grid'
export type ExportTheme = 'light' | 'dark'

export interface ImageExportOptions {
  paper: ExportPaper
  theme: ExportTheme
  watermark: boolean
  watermarkText?: string
}

export const EXPORT_PAPERS: { id: ExportPaper; label: string }[] = [
  { id: 'plain', label: '白纸' },
  { id: 'cream', label: '米纸' },
  { id: 'lined', label: '横线纸' },
  { id: 'grid', label: '方格纸' },
]

export const EXPORT_THEMES: { id: ExportTheme; label: string }[] = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
]

const PAPER_BG: Record<ExportPaper, { light: string; dark: string }> = {
  plain: { light: '#ffffff', dark: '#1c1c1b' },
  cream: { light: '#f7f3ea', dark: '#242018' },
  lined: { light: '#fffef8', dark: '#1e1d18' },
  grid: { light: '#fbfbfa', dark: '#1a1a19' },
}

function pageBackground(theme: ExportTheme = 'light', paper: ExportPaper = 'plain'): string {
  return PAPER_BG[paper][theme]
}

function hideInteractive(root: HTMLElement) {
  const selectors = [
    '.nv-head-actions',
    '.nv-cover-actions',
    '.nv-icon-picker',
    '.cover-pop',
    '.nv-comment-compose',
    '.nv-comment-del',
    '.block-handle',
    '.slash-menu',
    '.bubble-bar',
    '.ProseMirror-widget',
    '.dg-tools',
    '.cb-btn.danger',
    '.cp-item.add',
    '.cp-arrow',
  ]
  for (const sel of selectors) {
    root.querySelectorAll(sel).forEach((n) => {
      ;(n as HTMLElement).style.display = 'none'
    })
  }
  root.querySelectorAll('.note-editor .ProseMirror').forEach((n) => {
    const el = n as HTMLElement
    el.style.minHeight = '0'
    el.style.paddingBottom = '24px'
  })
}

function applyPaperStyle(el: HTMLElement, paper: ExportPaper, theme: ExportTheme) {
  const bg = pageBackground(theme, paper)
  el.style.background = bg
  el.style.padding = '28px 24px 36px'
  el.style.boxSizing = 'border-box'
  if (paper === 'lined') {
    const line = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(80,100,140,0.12)'
    el.style.backgroundImage = `repeating-linear-gradient(to bottom, transparent 0, transparent 27px, ${line} 27px, ${line} 28px)`
  } else if (paper === 'grid') {
    const line = theme === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(80,100,140,0.1)'
    el.style.backgroundImage = `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`
    el.style.backgroundSize = '20px 20px'
  }
  if (theme === 'dark') {
    el.style.color = '#ececea'
    el.querySelectorAll('.nv-title, .ProseMirror, .nv-meta, .nv-comment-text').forEach((n) => {
      ;(n as HTMLElement).style.color = '#ececea'
    })
  }
}

function addWatermark(el: HTMLElement, text: string, theme: ExportTheme) {
  const wm = document.createElement('div')
  wm.dataset.exportWatermark = '1'
  wm.textContent = text
  wm.style.cssText = [
    'position:absolute',
    'inset:0',
    'pointer-events:none',
    'z-index:50',
    'display:flex',
    'flex-wrap:wrap',
    'align-content:space-around',
    'justify-content:space-around',
    'gap:80px 48px',
    'padding:40px',
    'overflow:hidden',
    `color:${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
    'font-size:22px',
    'font-weight:600',
    'letter-spacing:0.08em',
    'transform:rotate(-24deg) scale(1.2)',
    'user-select:none',
  ].join(';')
  // 铺几行水印字
  wm.innerHTML = Array.from({ length: 18 }, () => `<span style="white-space:nowrap">${text}</span>`).join('')
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:relative;'
  // 把 el 内容包一层不太方便；直接 append 到 el
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
  el.appendChild(wm)
  return wm
}

/** 克隆笔记区域并按选项渲成 canvas（不打扰当前编辑态） */
export async function captureNoteCanvas(
  source: HTMLElement,
  options: Partial<ImageExportOptions> = {},
): Promise<HTMLCanvasElement> {
  const paper = options.paper ?? 'plain'
  const theme = options.theme ?? 'light'
  const watermark = options.watermark ?? false
  const watermarkText = options.watermarkText?.trim() || '银杏笔记'

  await document.fonts?.ready.catch(() => undefined)

  const stage = document.createElement('div')
  stage.style.cssText =
    'position:fixed;left:-12000px;top:0;width:720px;pointer-events:none;opacity:1;z-index:-1;'
  const clone = source.cloneNode(true) as HTMLElement
  clone.style.width = '720px'
  clone.style.maxWidth = '720px'
  hideInteractive(clone)
  applyPaperStyle(clone, paper, theme)
  if (watermark) addWatermark(clone, watermarkText, theme)

  stage.appendChild(clone)
  document.body.appendChild(stage)

  try {
    await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    return await html2canvas(clone, {
      scale: Math.min(2, window.devicePixelRatio || 2),
      useCORS: true,
      allowTaint: true,
      backgroundColor: pageBackground(theme, paper),
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: clone.scrollWidth,
      windowHeight: clone.scrollHeight,
    })
  } finally {
    stage.remove()
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.95) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('图片导出失败'))
        else resolve(blob)
      },
      type,
      quality,
    )
  })
}

export async function copyBlobToClipboard(blob: Blob) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器不支持复制图片到剪贴板')
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

export async function exportNoteAsImage(
  el: HTMLElement,
  title: string,
  options?: Partial<ImageExportOptions>,
) {
  const canvas = await captureNoteCanvas(el, options)
  const blob = await canvasToBlob(canvas)
  downloadBlob(blob, `${safeFileName(title)}.png`)
}

export async function exportNoteAsPdf(
  el: HTMLElement,
  title: string,
  options?: Partial<ImageExportOptions>,
) {
  const canvas = await captureNoteCanvas(el, options)
  const name = safeFileName(title)
  const imgData = canvas.toDataURL('image/png')

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 8
  const contentW = pageW - margin * 2
  const contentH = pageH - margin * 2
  const imgH = (canvas.height * contentW) / canvas.width

  let heightLeft = imgH
  let offsetY = 0

  pdf.addImage(imgData, 'PNG', margin, margin, contentW, imgH, undefined, 'FAST')
  heightLeft -= contentH

  while (heightLeft > 0.5) {
    offsetY += contentH
    pdf.addPage()
    pdf.addImage(imgData, 'PNG', margin, margin - offsetY, contentW, imgH, undefined, 'FAST')
    heightLeft -= contentH
  }

  pdf.save(`${name}.pdf`)
}
