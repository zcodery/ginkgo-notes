import { createApp } from 'vue'
import App from './App.vue'
import { vTooltip } from './directives/tooltip'
import './style.css'

createApp(App).directive('tooltip', vTooltip).mount('#app')
