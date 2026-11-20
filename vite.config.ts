import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  /**
   * 静态资源一律不内联成 data URI。
   *
   * Vite 内联 SVG 时只做了部分百分号编码，`translate(1150 200)` 里的括号原样保留；
   * 而 CSS 的 `url()` 遇到未转义的右括号就提前结束，整条 background-image 声明作废，
   * 表现为「背景图整块不显示」。让资源走独立文件地址即可绕开。
   */
  assetsInclude: ['**/*.svg'],
  build: {
    assetsInlineLimit: 0,
  },
  server: {
    port: 3100,
    // 监听所有网卡：既保留 127.0.0.1 给本机/预览器，也允许同一局域网用 192.168.2.160 访问。
    // 发布走 server/index.ts，不受此项影响。
    host: '0.0.0.0',
    proxy: {
      '/api': `http://localhost:${process.env.GINKGO_API_PORT ?? 3101}`,
    },
  },
})
