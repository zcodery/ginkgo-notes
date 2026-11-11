/**
 * prettier 集成
 *
 * 浏览器端用 prettier/standalone + 按需加载的 parser 插件。
 * 注意：babel / typescript / json 三个 parser 必须搭配 estree printer，
 * 否则会报 `Couldn't find plugin for AST format "estree"`。
 *
 * 所有插件都是动态 import，避免主包膨胀 2MB+。
 */

type PrettierModule = typeof import('prettier/standalone')
type Plugin = unknown

const standalonePromise = import('prettier/standalone')

const pluginLoaders: Record<string, () => Promise<Plugin>> = {
  babel: () => import('prettier/plugins/babel').then((m) => m.default),
  estree: () => import('prettier/plugins/estree').then((m) => m.default),
  typescript: () => import('prettier/plugins/typescript').then((m) => m.default),
  postcss: () => import('prettier/plugins/postcss').then((m) => m.default),
  html: () => import('prettier/plugins/html').then((m) => m.default),
  markdown: () => import('prettier/plugins/markdown').then((m) => m.default),
  yaml: () => import('prettier/plugins/yaml').then((m) => m.default),
  graphql: () => import('prettier/plugins/graphql').then((m) => m.default),
}

/** 插件缓存，避免重复 import */
const pluginCache = new Map<string, Plugin>()

async function loadPlugin(name: string): Promise<Plugin> {
  const cached = pluginCache.get(name)
  if (cached) return cached
  const loader = pluginLoaders[name]
  if (!loader) throw new Error(`未知的 prettier 插件: ${name}`)
  const plugin = await loader()
  pluginCache.set(name, plugin)
  return plugin
}

/** 语言 id -> prettier parser */
const PARSER_BY_LANGUAGE: Record<string, string> = {
  javascript: 'babel',
  js: 'babel',
  jsx: 'babel',
  mjs: 'babel',
  cjs: 'babel',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  jsonl: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  vue: 'vue',
  svelte: 'html',
  xml: 'html',
  svg: 'html',
  haml: 'html',
  markdown: 'markdown',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  graphql: 'graphql',
  gql: 'graphql',
}

/** parser -> 需要的插件组合 */
const PLUGINS_BY_PARSER: Record<string, string[]> = {
  babel: ['babel', 'estree'],
  typescript: ['typescript', 'estree'],
  json: ['babel', 'estree'],
  css: ['postcss'],
  scss: ['postcss'],
  less: ['postcss'],
  html: ['html'],
  vue: ['html'],
  markdown: ['markdown'],
  yaml: ['yaml'],
  graphql: ['graphql'],
}

/** 该语言是否支持格式化 */
export function canFormat(language: string | null | undefined): boolean {
  if (!language) return false
  const key = language.trim().toLowerCase()
  return key in PARSER_BY_LANGUAGE
}

/**
 * 格式化代码
 * @param code 原始代码
 * @param language 语言 id
 * @returns 格式化后的代码；失败时抛错
 */
export async function formatCode(code: string, language: string | null | undefined): Promise<string> {
  if (!language) throw new Error('未选择语言，无法格式化')
  const key = language.trim().toLowerCase()
  const parser = PARSER_BY_LANGUAGE[key]
  if (!parser) throw new Error(`暂不支持 ${language} 的格式化`)

  const pluginNames = PLUGINS_BY_PARSER[parser] ?? []
  const plugins = await Promise.all(pluginNames.map((n) => loadPlugin(n)))

  const prettier: PrettierModule = await standalonePromise
  return prettier.format(code, { parser, plugins: plugins as never[] })
}
