/**
 * Mermaid 渲染封装
 *
 * mermaid 体积不小（含 d3 / dagre / cytoscape 相关代码），
 * 所以整包动态 import，首页不加载；主题切换时重新初始化配色。
 */

type MermaidModule = typeof import('mermaid')

let mod: MermaidModule['default'] | null = null
let loading: Promise<MermaidModule['default']> | null = null
let curTheme: 'light' | 'dark' | null = null
let seq = 0

const LIGHT_SCALE = [
  '#e7f0ea', '#eef2e2', '#eceaf5', '#f5ece7',
  '#e6eef5', '#f3f0da', '#f0e7f0', '#e4f1f1',
  '#f6e8e8', '#eaecef', '#eef3e5', '#f2eaf0',
]

const DARK_SCALE = [
  '#22362c', '#2d3327', '#2a2739', '#33291f',
  '#1f2b38', '#332f1c', '#2e2433', '#1e3232',
  '#332424', '#2a2d33', '#2a3324', '#332433',
]

/** mermaid 的思维导图/时间线按 cScale0..11 取色，不给的话会退化成纯黑 */
function scaleVars(colors: string[], labelColor: string) {
  const out: Record<string, string> = {}
  colors.forEach((c, i) => {
    out[`cScale${i}`] = c
    out[`cScaleLabel${i}`] = labelColor
    out[`cScalePeer${i}`] = labelColor
    out[`cScaleInv${i}`] = labelColor
  })
  return out
}

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`

const LIGHT = {
  background: '#ffffff',
  primaryColor: '#edf4ef',
  primaryBorderColor: '#8fb3a0',
  primaryTextColor: '#252523',
  secondaryColor: '#f6f4ea',
  secondaryBorderColor: '#d9d4bd',
  tertiaryColor: '#f5f7f8',
  tertiaryBorderColor: '#dbdfe2',
  lineColor: '#96a89d',
  textColor: '#252523',
  mainBkg: '#edf4ef',
  nodeBorder: '#8fb3a0',
  clusterBkg: '#fbfbfa',
  clusterBorder: '#e2e5e2',
  edgeLabelBackground: '#ffffff',
  titleColor: '#252523',
  actorBkg: '#edf4ef',
  actorBorder: '#8fb3a0',
  actorTextColor: '#252523',
  signalColor: '#96a89d',
  signalTextColor: '#252523',
  labelBoxBkgColor: '#edf4ef',
  labelBoxBorderColor: '#8fb3a0',
  noteBkgColor: '#fdf6dd',
  noteBorderColor: '#ddd0a0',
  noteTextColor: '#252523',
}

const DARK = {
  background: '#1c1c1b',
  primaryColor: '#22362c',
  primaryBorderColor: '#4f7f66',
  primaryTextColor: '#ececea',
  secondaryColor: '#2b2a24',
  secondaryBorderColor: '#5c5a46',
  tertiaryColor: '#242423',
  tertiaryBorderColor: '#3a3a37',
  lineColor: '#6f8478',
  textColor: '#ececea',
  mainBkg: '#22362c',
  nodeBorder: '#4f7f66',
  clusterBkg: '#1f1f1e',
  clusterBorder: '#33332f',
  edgeLabelBackground: '#1c1c1b',
  titleColor: '#ececea',
  actorBkg: '#22362c',
  actorBorder: '#4f7f66',
  actorTextColor: '#ececea',
  signalColor: '#6f8478',
  signalTextColor: '#ececea',
  labelBoxBkgColor: '#22362c',
  labelBoxBorderColor: '#4f7f66',
  noteBkgColor: '#3a3622',
  noteBorderColor: '#5c5638',
  noteTextColor: '#ececea',
}

async function getMermaid(dark: boolean) {
  if (!loading) loading = import('mermaid').then((m) => m.default)
  mod = await loading
  const theme = dark ? 'dark' : 'light'
  if (curTheme !== theme) {
    mod.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: FONT,
      themeVariables: {
        fontFamily: FONT,
        fontSize: '13.5px',
        ...(dark ? DARK : LIGHT),
        ...scaleVars(dark ? DARK_SCALE : LIGHT_SCALE, dark ? '#ececea' : '#252523'),
      },
      flowchart: { curve: 'basis', padding: 8, nodeSpacing: 30, rankSpacing: 40, htmlLabels: true },
      sequence: { actorMargin: 46, boxMargin: 8, mirrorActors: false },
      er: { layoutDirection: 'TB', minEntityWidth: 92, entityPadding: 12 },
      gantt: { fontSize: 12, barHeight: 22, gridLineStartPadding: 34 },
      mindmap: { padding: 10 },
      class: { padding: 10 },
      state: { padding: 8 },
    })
    curTheme = theme
  }
  return mod
}

export interface RenderResult {
  svg: string | null
  error: string | null
}

/** 把 mermaid 源码渲染成 SVG 字符串；语法错误时返回错误信息而不是抛异常 */
export async function renderMermaid(code: string, dark: boolean): Promise<RenderResult> {
  const src = code.trim()
  if (!src) return { svg: null, error: null }
  try {
    const m = await getMermaid(dark)
    const id = `gn-mmd-${++seq}`
    const { svg } = await m.render(id, src)
    // mermaid 渲染失败时会残留临时节点
    document.getElementById(`d${id}`)?.remove()
    document.getElementById(id)?.remove()
    return { svg, error: null }
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    // 错误信息后半段是整段源码，这里只保留第一行
    return { svg: null, error: msg.split('\n').find((l: string) => l.trim()) ?? '图表语法有误' }
  }
}

/** 语法检查，返回 null 表示通过 */
export async function validateMermaid(code: string): Promise<string | null> {
  if (!code.trim()) return null
  try {
    const m = await getMermaid(curTheme === 'dark')
    await m.parse(code)
    return null
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    return msg.split('\n').find((l: string) => l.trim()) ?? '语法有误'
  }
}
