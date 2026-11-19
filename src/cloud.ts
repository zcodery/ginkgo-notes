/**
 * 云服务客户端（WorkBuddy Cloud Service）。
 *
 * 下面的公开值来自本应用「云服务激活」返回的 publicConfig：
 * - endpoint / publishableKey 是前端可用配置，服务端按发布域名校验 Origin，
 *   publishableKey 本身不含任何权限，因此可随前端代码发布；
 * - 敏感的环境 id 与供应商密钥不下发、也不出现在仓库里。
 *
 * 所有云模块（当前用到 llm）共享这一个客户端实例，初始化一次即可。
 */
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

export const cloud = createWorkBuddyCloud({
  endpoint: 'https://ginkgo-notes.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_uJT61yaFOVaT1Hy69NvxF7_fWu4bIws2jhpfpHB4p7kqit96NfZSeCT',
})

let cachedModel: string | null = null

/**
 * 选一个可用的模型并缓存：优先 auto（由云端路由），否则取第一个未禁用的。
 * 模型列表为空是合法结果，抛出明确错误而不是回退到硬编码模型名。
 */
export async function pickCloudModel(): Promise<string> {
  if (cachedModel) return cachedModel
  const models = await cloud.llm.models.list()
  const enabled = models.filter((m) => m.disabled !== true)
  const chosen = enabled.find((m) => m.id === 'auto') ?? enabled[0]
  if (!chosen) throw new Error('云服务当前没有可用的 AI 模型')
  cachedModel = chosen.id
  return cachedModel
}

/** 探测云服务是否可用（供设置页展示状态；不打印任何配置值） */
export async function cloudAvailable(): Promise<boolean> {
  try {
    const models = await cloud.llm.models.list()
    return models.some((m) => m.disabled !== true)
  } catch {
    return false
  }
}
