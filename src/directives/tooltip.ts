import type { Directive, DirectiveBinding } from 'vue'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

export type TooltipOptions = {
  title: string
  desc?: string
  placement?: TooltipPlacement
  /** 显示延迟 ms，默认 280 */
  delay?: number
}

export type TooltipValue = string | TooltipOptions | null | undefined | false

type Parsed = {
  title: string
  desc?: string
  placement: TooltipPlacement
  delay: number
}

type TipState = {
  value: TooltipValue
}

const STATE = new WeakMap<HTMLElement, TipState>()

let tipEl: HTMLDivElement | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let activeEl: HTMLElement | null = null
let activePlacement: TooltipPlacement = 'top'
let scrollBound = false

function ensureTip() {
  if (tipEl) return tipEl
  tipEl = document.createElement('div')
  tipEl.className = 'gn-tooltip'
  tipEl.setAttribute('role', 'tooltip')
  tipEl.setAttribute('aria-hidden', 'true')
  document.body.appendChild(tipEl)
  return tipEl
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parse(value: TooltipValue): Parsed | null {
  if (value == null || value === false) return null
  if (typeof value === 'string') {
    const title = value.trim()
    if (!title) return null
    return { title, placement: 'top', delay: 280 }
  }
  const title = (value.title ?? '').trim()
  if (!title) return null
  return {
    title,
    desc: value.desc?.trim() || undefined,
    placement: value.placement ?? 'top',
    delay: value.delay ?? 280,
  }
}

function clearShowTimer() {
  if (showTimer != null) {
    clearTimeout(showTimer)
    showTimer = null
  }
}

function hideTip() {
  clearShowTimer()
  activeEl = null
  if (!tipEl) return
  tipEl.classList.remove('show')
  tipEl.setAttribute('aria-hidden', 'true')
}

function placeTip(anchor: HTMLElement, placement: TooltipPlacement) {
  const tip = ensureTip()
  const gap = 8
  const rect = anchor.getBoundingClientRect()
  tip.style.visibility = 'hidden'
  tip.classList.add('show')
  const tw = tip.offsetWidth
  const th = tip.offsetHeight
  tip.classList.remove('show')
  tip.style.visibility = ''

  let top = 0
  let left = 0
  let used: TooltipPlacement = placement

  const tryPlace = (p: TooltipPlacement) => {
    switch (p) {
      case 'top':
        top = rect.top - th - gap
        left = rect.left + rect.width / 2 - tw / 2
        break
      case 'bottom':
        top = rect.bottom + gap
        left = rect.left + rect.width / 2 - tw / 2
        break
      case 'left':
        top = rect.top + rect.height / 2 - th / 2
        left = rect.left - tw - gap
        break
      case 'right':
        top = rect.top + rect.height / 2 - th / 2
        left = rect.right + gap
        break
    }
  }

  tryPlace(placement)

  // 视口边缘翻转 / 夹紧
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pad = 6

  if (placement === 'top' && top < pad) {
    used = 'bottom'
    tryPlace('bottom')
  } else if (placement === 'bottom' && top + th > vh - pad) {
    used = 'top'
    tryPlace('top')
  } else if (placement === 'right' && left + tw > vw - pad) {
    used = 'left'
    tryPlace('left')
  } else if (placement === 'left' && left < pad) {
    used = 'right'
    tryPlace('right')
  }

  left = Math.min(Math.max(pad, left), vw - tw - pad)
  top = Math.min(Math.max(pad, top), vh - th - pad)

  tip.dataset.placement = used
  tip.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
  tip.classList.add('show')
  tip.setAttribute('aria-hidden', 'false')
  activePlacement = used
}

function showTip(el: HTMLElement) {
  const state = STATE.get(el)
  if (!state) return
  const data = parse(state.value)
  if (!data) return

  const tip = ensureTip()
  tip.innerHTML =
    `<div class="gn-tooltip-title">${escapeHtml(data.title)}</div>` +
    (data.desc ? `<div class="gn-tooltip-desc">${escapeHtml(data.desc)}</div>` : '')

  activeEl = el
  placeTip(el, data.placement)
  bindScroll()
}

function bindScroll() {
  if (scrollBound) return
  scrollBound = true
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
}

function onScrollOrResize() {
  if (!activeEl || !tipEl?.classList.contains('show')) {
    hideTip()
    return
  }
  placeTip(activeEl, activePlacement)
}

function scheduleShow(el: HTMLElement) {
  clearShowTimer()
  const state = STATE.get(el)
  const data = parse(state?.value)
  if (!data) return
  showTimer = setTimeout(() => {
    showTimer = null
    if (STATE.get(el) && document.contains(el)) showTip(el)
  }, data.delay)
}

function onEnter(this: HTMLElement) {
  scheduleShow(this)
}

function onLeave(this: HTMLElement) {
  hideTip()
}

function onDown() {
  hideTip()
}

function bind(el: HTMLElement) {
  el.addEventListener('mouseenter', onEnter)
  el.addEventListener('mouseleave', onLeave)
  el.addEventListener('focus', onEnter)
  el.addEventListener('blur', onLeave)
  el.addEventListener('mousedown', onDown)
}

function unbind(el: HTMLElement) {
  el.removeEventListener('mouseenter', onEnter)
  el.removeEventListener('mouseleave', onLeave)
  el.removeEventListener('focus', onEnter)
  el.removeEventListener('blur', onLeave)
  el.removeEventListener('mousedown', onDown)
  if (activeEl === el) hideTip()
  STATE.delete(el)
}

function setValue(el: HTMLElement, value: TooltipValue) {
  const data = parse(value)
  if (!data) {
    unbind(el)
    return
  }
  const prev = STATE.get(el)
  STATE.set(el, { value })
  if (!prev) bind(el)
  if (activeEl === el) showTip(el)
}

export const vTooltip: Directive<HTMLElement, TooltipValue> = {
  mounted(el, binding: DirectiveBinding<TooltipValue>) {
    setValue(el, binding.value)
  },
  updated(el, binding: DirectiveBinding<TooltipValue>) {
    setValue(el, binding.value)
  },
  beforeUnmount(el) {
    unbind(el)
  },
}

export default vTooltip
