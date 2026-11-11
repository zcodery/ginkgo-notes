/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

export {}

declare module 'vue' {
  interface HTMLAttributes {
    /** 自定义悬停提示，见 v-tooltip */
    tooltip?: import('./directives/tooltip').TooltipValue
  }
}
