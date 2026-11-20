/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

export {}

declare global {
  /** 构建时注入的 package.json 版本号，用于检查更新 */
  const __APP_VERSION__: string
  interface Window {
    /** 关闭 index.html 里的启动加载屏（由内联脚本注入，见 index.html） */
    gnBootDone?: () => void
  }
}

declare module 'vue' {
  interface HTMLAttributes {
    /** 自定义悬停提示，见 v-tooltip */
    tooltip?: import('./directives/tooltip').TooltipValue
  }
}
