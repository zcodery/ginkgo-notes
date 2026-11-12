/** 在宿主（li / details）上动画 grid-template-rows，子列表在 Grid 里才能看见过渡 */

const DURATION_MS = 300
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function measurePanel(panel: HTMLElement): number {
  panel.classList.add('gn-fold-panel-anim')
  panel.style.overflow = 'hidden'
  panel.style.maxHeight = 'none'
  const h = panel.scrollHeight
  panel.classList.remove('gn-fold-panel-anim')
  panel.style.overflow = ''
  panel.style.maxHeight = ''
  return h
}

function cleanupHost(host: HTMLElement) {
  host.classList.remove('gn-fold-host-anim')
  host.style.gridTemplateRows = ''
  host.style.transition = ''
  host.style.overflow = ''
}

function animateRows(host: HTMLElement, from: string, to: string, commit: () => void) {
  host.classList.add('gn-fold-host-anim')
  host.style.overflow = 'hidden'
  host.style.transition = 'none'
  host.style.gridTemplateRows = from
  void host.offsetHeight
  host.style.transition = `grid-template-rows ${DURATION_MS}ms ${EASE}`
  host.style.gridTemplateRows = to

  let done = false
  const finish = () => {
    if (done) return
    done = true
    host.removeEventListener('transitionend', onEnd)
    cleanupHost(host)
    commit()
  }

  const onEnd = (e: TransitionEvent) => {
    if (e.target === host && e.propertyName === 'grid-template-rows') finish()
  }

  host.addEventListener('transitionend', onEnd)
  window.setTimeout(finish, DURATION_MS + 80)
}

export function runFoldAnimation(
  host: HTMLElement | null | undefined,
  panel: HTMLElement | null | undefined,
  expanding: boolean,
  commit: () => void,
) {
  if (!host?.isConnected || !panel?.isConnected || prefersReducedMotion()) {
    commit()
    return
  }

  const h = measurePanel(panel)
  if (h < 1) {
    commit()
    return
  }

  if (expanding) {
    animateRows(host, `auto 0px`, `auto ${h}px`, commit)
  } else {
    animateRows(host, `auto ${h}px`, `auto 0px`, commit)
  }
}
