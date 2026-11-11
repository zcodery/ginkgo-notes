import { ref, watch } from 'vue'

const LINE_NUMBERS_KEY = 'ginkgo-code-line-numbers'

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/** 代码块是否显示行号：所有代码块共用，记在本地 */
export const codeLineNumbers = ref(readBool(LINE_NUMBERS_KEY, true))

watch(codeLineNumbers, (v) => {
  try {
    localStorage.setItem(LINE_NUMBERS_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
})
