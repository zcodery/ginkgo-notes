<script setup lang="ts">
/**
 * 高度折叠过渡：包住 v-if / v-show 的单个元素即可。
 * height:auto 无法直接过渡，进出场时临时写死像素高度。
 */
const props = withDefaults(defineProps<{ duration?: number }>(), { duration: 200 })

function run(el: Element, from: string, to: string, opacityFrom: string, opacityTo: string, done: () => void) {
  const s = (el as HTMLElement).style
  s.overflow = 'hidden'
  s.height = from
  s.opacity = opacityFrom
  void (el as HTMLElement).offsetHeight
  s.transition = `height ${props.duration}ms ease, opacity ${props.duration}ms ease`
  s.height = to
  s.opacity = opacityTo
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    el.removeEventListener('transitionend', onEnd)
    done()
  }
  const onEnd = (e: Event) => {
    if (e.target === el && (e as TransitionEvent).propertyName === 'height') finish()
  }
  el.addEventListener('transitionend', onEnd)
  window.setTimeout(finish, props.duration + 60)
}

function reset(el: Element) {
  const s = (el as HTMLElement).style
  s.overflow = ''
  s.height = ''
  s.opacity = ''
  s.transition = ''
}

function onEnter(el: Element, done: () => void) {
  run(el, '0px', `${(el as HTMLElement).scrollHeight}px`, '0', '1', done)
}

function onLeave(el: Element, done: () => void) {
  run(el, `${(el as HTMLElement).scrollHeight}px`, '0px', '1', '0', done)
}
</script>

<template>
  <Transition :css="false" @enter="onEnter" @after-enter="reset" @leave="onLeave" @after-leave="reset">
    <slot />
  </Transition>
</template>
