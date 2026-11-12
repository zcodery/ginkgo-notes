import type { Request } from 'express'

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function param(req: Request, name: string): string {
  const v = req.params[name]
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, 'id 不合法')
  return v
}

export function str(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field}格式不正确`)
  const v = value.trim()
  if (v.length > max) throw new HttpError(400, `${field}过长`)
  return v
}

export function clientIp(req: Request): string | undefined {
  return req.ip?.replace(/^::ffff:/, '')
}
