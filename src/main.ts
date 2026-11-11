import { createApp } from 'vue'
import App from './App.vue'
import { vTooltip } from './directives/tooltip'
import { t } from './i18n'
import './style.css'

const app = createApp(App)
app.config.globalProperties.$t = t
app.directive('tooltip', vTooltip).mount('#app')
