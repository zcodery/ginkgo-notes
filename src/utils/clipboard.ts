/**
 * 复制文本到剪贴板。
 *
 * 通过局域网地址（http://192.168.x.x）访问时页面属于**非安全上下文**，
 * navigator.clipboard 通常不存在，writeText 也会抛 NotAllowedError —— 这就是
 * 「复制失败，请手动选择链接」的根因。此时退回临时 textarea + execCommand('copy')。
 * 复制完会恢复原来的焦点和选区，避免把编辑器光标拽走。
 */

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null
  const selection = document.getSelection()
  const ranges: Range[] = []
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange())
  }

  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  // 不能用 display:none / visibility:hidden，否则部分浏览器选不中内容
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(ta)

  let ok = false
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    ta.remove()
    try {
      active?.focus?.({ preventScroll: true })
    } catch {
      /* 原焦点元素可能已经卸载 */
    }
    if (selection && ranges.length) {
      try {
        selection.removeAllRanges()
        ranges.forEach((r) => selection.addRange(r))
      } catch {
        /* 选区已失效 */
      }
    }
  }
  return ok
}

/** 成功返回 true；所有路径都失败时返回 false，由调用方决定提示文案 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* 权限被拒或焦点不在页面，继续降级 */
    }
  }
  return legacyCopy(text)
}
