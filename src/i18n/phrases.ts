import { locale } from './index'

/**
 * 按中文原文查表的短语翻译：tr('撤回') → 'Undo'。
 * 适合散落在各组件里的界面短句，免去为每句话起键名；简体中文直接返回原文。
 * 支持 {name} 占位符。缺少译文时回退到原文。
 */
const PHRASES: Record<string, { tw: string; en: string }> = {
  // 笔记页顶栏
  全部笔记: { tw: '全部筆記', en: 'All notes' },
  未命名: { tw: '未命名', en: 'Untitled' },
  保存中: { tw: '儲存中', en: 'Saving' },
  已保存: { tw: '已儲存', en: 'Saved' },
  '保存失败，继续编辑会自动重试': { tw: '儲存失敗，繼續編輯會自動重試', en: 'Save failed — will retry as you edit' },
  分享: { tw: '分享', en: 'Share' },
  '公开分享 / 邀请成员': { tw: '公開分享 / 邀請成員', en: 'Publish / invite members' },
  收藏: { tw: '收藏', en: 'Favorite' },
  取消收藏: { tw: '取消收藏', en: 'Remove from favorites' },
  更多: { tw: '更多', en: 'More' },
  展开侧边栏: { tw: '展開側邊欄', en: 'Expand sidebar' },
  // 更多菜单
  撤回: { tw: '復原', en: 'Undo' },
  重做: { tw: '重做', en: 'Redo' },
  已复制链接: { tw: '已複製連結', en: 'Link copied' },
  复制页面链接: { tw: '複製頁面連結', en: 'Copy page link' },
  创建副本: { tw: '建立副本', en: 'Duplicate' },
  查找或替换: { tw: '尋找或取代', en: 'Find & replace' },
  分享与协作: { tw: '分享與協作', en: 'Share & collaborate' },
  'AI 总结全文': { tw: 'AI 總結全文', en: 'AI: summarize page' },
  'AI 提取待办': { tw: 'AI 擷取待辦', en: 'AI: extract to-dos' },
  'AI 翻译成英文': { tw: 'AI 翻譯成英文', en: 'AI: translate to English' },
  '问问 AI…': { tw: '問問 AI…', en: 'Ask AI…' },
  '导出中…': { tw: '匯出中…', en: 'Exporting…' },
  导出: { tw: '匯出', en: 'Export' },
  图片: { tw: '圖片', en: 'Image' },
  页面宽度: { tw: '頁面寬度', en: 'Page width' },
  字体大小: { tw: '字體大小', en: 'Font size' },
  字体样式: { tw: '字體樣式', en: 'Font' },
  页面布局: { tw: '頁面版面', en: 'Layout' },
  页面目录: { tw: '頁面目錄', en: 'Outline' },
  解除锁定: { tw: '解除鎖定', en: 'Unlock page' },
  锁定页面: { tw: '鎖定頁面', en: 'Lock page' },
  移到回收站: { tw: '移到回收站', en: 'Move to trash' },
  自动调节: { tw: '自動調節', en: 'Auto' },
  默认: { tw: '預設', en: 'Default' },
  宋体: { tw: '宋體', en: 'Serif' },
  黑体: { tw: '黑體', en: 'Sans' },
  楷体: { tw: '楷體', en: 'Kai' },
  仿宋: { tw: '仿宋', en: 'FangSong' },
  圆体: { tw: '圓體', en: 'Rounded' },
  等宽: { tw: '等寬', en: 'Mono' },
  宽松: { tw: '寬鬆', en: 'Loose' },
  紧密: { tw: '緊密', en: 'Compact' },
  // 封面 / 图标 / 评论
  更换封面: { tw: '更換封面', en: 'Change cover' },
  移除: { tw: '移除', en: 'Remove' },
  渐变: { tw: '漸層', en: 'Gradients' },
  上传图片: { tw: '上傳圖片', en: 'Upload image' },
  移除封面: { tw: '移除封面', en: 'Remove cover' },
  更换图标: { tw: '更換圖示', en: 'Change icon' },
  页面已锁定: { tw: '頁面已鎖定', en: 'Page is locked' },
  添加图标: { tw: '新增圖示', en: 'Add icon' },
  添加封面: { tw: '新增封面', en: 'Add cover' },
  添加评论: { tw: '新增評論', en: 'Add comment' },
  已锁定: { tw: '已鎖定', en: 'Locked' },
  '{n} 字': { tw: '{n} 字', en: '{n} chars' },
  '· 编辑于 {time}': { tw: '· 編輯於 {time}', en: '· edited {time}' },
  '今天 {time}': { tw: '今天 {time}', en: 'Today {time}' },
  '{m} 月 {d} 日 {time}': { tw: '{m} 月 {d} 日 {time}', en: '{m}/{d} {time}' },
  删除评论: { tw: '刪除評論', en: 'Delete comment' },
  '添加评论…  Enter 发送，Shift+Enter 换行': {
    tw: '新增評論…  Enter 送出，Shift+Enter 換行',
    en: 'Add a comment…  Enter to send, Shift+Enter for newline',
  },
  发送: { tw: '送出', en: 'Send' },
  '{title} 副本': { tw: '{title} 副本', en: '{title} (copy)' },
  '导出失败，请稍后重试': { tw: '匯出失敗，請稍後重試', en: 'Export failed. Please try again.' },
  // 侧栏 / 通知 / 锁屏 / 版本
  与我共享: { tw: '與我共享', en: 'Shared with me' },
  '来自 {owner} · {role}': { tw: '來自 {owner} · {role}', en: 'From {owner} · {role}' },
  可编辑: { tw: '可編輯', en: 'Can edit' },
  只读: { tw: '唯讀', en: 'View only' },
  消息通知: { tw: '訊息通知', en: 'Notifications' },
  '消息通知（免打扰中）': { tw: '訊息通知（勿擾中）', en: 'Notifications (do not disturb)' },
  全部已读: { tw: '全部已讀', en: 'Mark all read' },
  清空: { tw: '清空', en: 'Clear' },
  设置: { tw: '設定', en: 'Settings' },
  删除: { tw: '刪除', en: 'Delete' },
  暂时没有通知: { tw: '暫時沒有通知', en: 'No notifications' },
  '清空全部通知？': { tw: '清空全部通知？', en: 'Clear all notifications?' },
  刚刚: { tw: '剛剛', en: 'Just now' },
  '{n} 分钟前': { tw: '{n} 分鐘前', en: '{n} min ago' },
  '{n} 小时前': { tw: '{n} 小時前', en: '{n} hr ago' },
  '{n} 天前': { tw: '{n} 天前', en: '{n} days ago' },
  '已锁定，输入 PIN 码解锁': { tw: '已鎖定，輸入 PIN 碼解鎖', en: 'Locked — enter your PIN to unlock' },
  解锁: { tw: '解鎖', en: 'Unlock' },
  '忘记 PIN？退出登录': { tw: '忘記 PIN？登出', en: 'Forgot PIN? Sign out' },
  '发现新版本 {v}，刷新后即可使用': { tw: '發現新版本 {v}，重新整理後即可使用', en: 'Version {v} is available — refresh to update' },
  刷新: { tw: '重新整理', en: 'Refresh' },
  // AI 面板 / 分享弹窗常用
  'AI 改写 / 翻译 / 总结': { tw: 'AI 改寫 / 翻譯 / 總結', en: 'AI rewrite / translate / summarize' },
}

export function tr(source: string, vars?: Record<string, string | number>): string {
  const lang = locale.value
  const hit = PHRASES[source]
  let text = lang === 'zh-TW' ? (hit?.tw ?? source) : lang === 'en' ? (hit?.en ?? source) : source
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v))
  return text
}
