import type { ChatMessage } from '@/api/features'

/** 编辑器里的 AI 动作：选中文字改写类、光标处续写、整页总结 / 翻译 */

export type AiMode = 'selection' | 'cursor' | 'page'

export interface AiAction {
  id: string
  label: string
  modes: AiMode[]
  /** 生成给模型的指令；text 为选中内容 / 上文 / 全文 */
  prompt: (text: string, extra?: string) => string
}

const SYSTEM =
  '你是「银杏笔记」里的写作助手。只输出结果正文，使用 Markdown；不要解释、不要寒暄、不要用代码块包裹整段结果。' +
  '除翻译任务外，保持与原文相同的语言。'

export const AI_ACTIONS: AiAction[] = [
  {
    id: 'continue',
    label: '续写',
    modes: ['cursor', 'selection'],
    prompt: (t) => `请顺着下面的内容自然地续写一段（不要重复原文）：\n\n${t}`,
  },
  { id: 'polish', label: '润色', modes: ['selection'], prompt: (t) => `请润色下面的文字，使其更通顺、准确，保持原意：\n\n${t}` },
  { id: 'fix', label: '修正错别字与语病', modes: ['selection'], prompt: (t) => `请修正下面文字中的错别字、标点和语病，尽量少改动：\n\n${t}` },
  { id: 'shorter', label: '精简', modes: ['selection'], prompt: (t) => `请在保留关键信息的前提下精简下面的文字：\n\n${t}` },
  { id: 'longer', label: '扩写', modes: ['selection'], prompt: (t) => `请把下面的文字扩写得更充实具体：\n\n${t}` },
  { id: 'formal', label: '改为正式语气', modes: ['selection'], prompt: (t) => `请把下面的文字改写成正式、专业的语气：\n\n${t}` },
  { id: 'casual', label: '改为轻松语气', modes: ['selection'], prompt: (t) => `请把下面的文字改写成轻松、口语化的语气：\n\n${t}` },
  { id: 'bullets', label: '整理成要点', modes: ['selection', 'page'], prompt: (t) => `请把下面的内容整理成层次清晰的要点列表：\n\n${t}` },
  { id: 'summary', label: '总结', modes: ['selection', 'page'], prompt: (t) => `请用几句话总结下面内容的核心要点：\n\n${t}` },
  { id: 'todo', label: '提取待办', modes: ['selection', 'page'], prompt: (t) => `请从下面的内容中提取需要执行的事项，输出为 Markdown 待办列表（- [ ] 开头）：\n\n${t}` },
  { id: 'en', label: '翻译成英文', modes: ['selection', 'page'], prompt: (t) => `请把下面的内容翻译成英文，保持 Markdown 格式：\n\n${t}` },
  { id: 'zh', label: '翻译成中文', modes: ['selection', 'page'], prompt: (t) => `请把下面的内容翻译成简体中文，保持 Markdown 格式：\n\n${t}` },
  { id: 'explain', label: '解释', modes: ['selection'], prompt: (t) => `请用通俗的语言解释下面这段内容：\n\n${t}` },
]

export function buildMessages(prompt: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt },
  ]
}

export function customPrompt(instruction: string, mode: AiMode, text: string): string {
  if (!text.trim()) return instruction
  const label = mode === 'selection' ? '选中的内容' : mode === 'page' ? '整篇笔记' : '上文'
  return `${instruction}\n\n以下是${label}：\n\n${text}`
}
