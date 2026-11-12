import type { Transporter } from 'nodemailer'

/**
 * 邮件发送：配置 SMTP_URL（如 smtps://user:pass@smtp.example.com:465）后启用，
 * 发件人取 SMTP_FROM，缺省用 SMTP_URL 里的账号。未配置时所有发送静默跳过。
 */

const SMTP_URL = process.env.SMTP_URL ?? ''
const SMTP_FROM = process.env.SMTP_FROM ?? ''

export const mailEnabled = () => !!SMTP_URL

let transporter: Promise<Transporter> | null = null

function getTransporter(): Promise<Transporter> {
  if (!transporter) {
    transporter = import('nodemailer').then((m) => m.default.createTransport(SMTP_URL))
  }
  return transporter
}

function defaultFrom(): string {
  if (SMTP_FROM) return SMTP_FROM
  try {
    const u = new URL(SMTP_URL)
    return `银杏笔记 <${decodeURIComponent(u.username)}>`
  } catch {
    return '银杏笔记'
  }
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!mailEnabled() || !to) return
  const t = await getTransporter()
  await t.sendMail({ from: defaultFrom(), to, subject: `【银杏笔记】${subject}`, text })
}
