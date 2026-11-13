/**
 * 折叠 / 展开的过渡动画（编辑器里的 details 块、普通列表项、任务列表项）。
 *
 * 为什么必须用 Web Animations API：
 * 1. ProseMirror 的 `setNodeMarkup` 通过 ReplaceStep 实现，会**重建整个节点 DOM**。
 *    新元素一诞生就带着终态的 data-open / data-collapsed，纯 CSS transition
 *    没有起始值可过渡，结果就是「点一下瞬间跳变」。
 * 2. 往 PM 管理的节点上写 inline style / class 也不行 —— DOMObserver 会把这些
 *    非文档属性当成脏 DOM 立刻重置，动画刚开始就被掐断。
 *
 * WAAPI 不改任何 DOM 属性，动画值的优先级高于样式表，播放结束自动回到 CSS 终态，
 * PM 完全感知不到。所以流程是：先 dispatch 提交文档状态，再用 view.nodeDOM(pos)
 * 拿到重建后的新元素，在它上面补一段从旧态到新态的动画。
 *
 * 三处宿主的结构不一样，动画目标也不同：
 * - details / 普通 listItem：内容面板是 li 的第二个 grid item，动画 grid-template-rows。
 * - taskItem：子列表被包在 contentDOM 的 div 里（`li > label + div > p + ul`），
 *   根本不是 li 的 grid item，只能对子列表本身做 height 过渡。
 *
 * 为什么首行要钉成像素值：
 * keyframes 里若写 `auto minmax(0, 1fr)`，Chromium 会把 `auto` 也当可插值的轨道
 * 一起算，实测第一行从 41.8px 鼓到 59.4px 再缩回 —— 标题行忽高忽低、文字不再
 * 垂直居中，内容跟着上下漂移。改成从 getComputedStyle 读出首行的实际像素高度，
 * 两条 keyframe 都固定这个值，只有第二行在动，视觉才稳定。
 */

const DURATION = 300
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const OPEN = 'minmax(0, 1fr)'
const CLOSED = 'minmax(0, 0fr)'

/** 找内容面板：details 是内层 div，普通列表项是子 ul/ol */
function panelOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>(':scope > .gn-details-content')
    ?? host.querySelector<HTMLElement>(':scope > ul, :scope > ol')
}

/**
 * 高度收拢时内容是从下往上被裁掉的，硬切一刀会显得突兀。给内容面板补一层
 * 淡入淡出：收起时先淡出再裁完，展开时等高度张开一点再淡入。
 * 同样只用 WAAPI，不碰 DOM 属性；fill:none 让动画结束后自动回到 CSS 的 opacity:1。
 */
function fade(panel: HTMLElement, expanding: boolean): void {
  if (typeof panel.animate !== 'function') return
  try {
    panel.animate(
      expanding
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: 0.3 },
            { opacity: 1, offset: 1 },
          ]
        : [
            { opacity: 1, offset: 0 },
            { opacity: 0, offset: 0.65 },
            { opacity: 0, offset: 1 },
          ],
      { duration: DURATION, easing: 'ease-out' },
    )
  } catch {
    /* 忽略：高度动画仍然生效 */
  }
}

/**
 * 任务列表项：子列表在 `li > div > ul` 里，不是 li 的 grid item。
 * 静态终态由 CSS 给 height:0 / auto，这里用 WAAPI 在像素高度之间补过渡。
 * 收起态元素虽然 height:0 + overflow:hidden，scrollHeight 仍返回内容完整高度，
 * 所以两个方向都能拿到同一个自然高度，不用在 dispatch 前额外测量。
 */
function animateTaskFold(host: HTMLElement, expanding: boolean): void {
  const panel = host.querySelector<HTMLElement>(':scope > div > ul, :scope > div > ol')
  if (!panel || typeof panel.animate !== 'function') return

  const natural = Math.max(panel.scrollHeight, panel.getBoundingClientRect().height)
  if (!(natural > 0)) return
  const from = expanding ? 0 : natural
  const to = expanding ? natural : 0

  try {
    panel.animate(
      [
        { height: `${from}px`, offset: 0 },
        { height: `${to}px`, offset: 1 },
      ],
      { duration: DURATION, easing: EASE },
    )
  } catch {
    /* 不支持时保持即时切换 */
  }
  fade(panel, expanding)
}

/** @param expanding true = 展开，false = 收起 */
export function animateFold(host: Node | null | undefined, expanding: boolean): void {
  if (!(host instanceof HTMLElement) || !host.isConnected) return
  if (typeof host.animate !== 'function') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  // 任务列表项单独走 height 过渡，别去动它的 grid-template-rows
  if (host.parentElement?.getAttribute('data-type') === 'taskList') {
    animateTaskFold(host, expanding)
    return
  }

  // 静态终态的第一行是 auto，取它的计算像素值钉住；拿不到就退化为不动画，
  // 也不要把 auto 写进 keyframes（会让标题行跟着一起被插值）。
  const head = getComputedStyle(host).gridTemplateRows.trim().split(/\s+/)[0]
  if (!/^[\d.]+px$/.test(head ?? '')) return

  try {
    host.animate(
      [
        { gridTemplateRows: `${head} ${expanding ? CLOSED : OPEN}` },
        { gridTemplateRows: `${head} ${expanding ? OPEN : CLOSED}` },
      ],
      { duration: DURATION, easing: EASE },
    )
  } catch {
    /* 浏览器不支持给该属性做动画时，保持即时切换即可 */
  }

  const panel = panelOf(host)
  if (panel) fade(panel, expanding)
}
