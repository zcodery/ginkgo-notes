import { strToU8, zipSync, type Zippable } from 'fflate'

/**
 * 轻量 xlsx 写出：单工作表、内联字符串、无公式。
 *
 * 只做「把二维数组写成一张表」这件事，够用且不引第三方依赖。
 * 需要数字/日期参与后续计算时，写成字符串即可，Excel 打开仍然可读。
 */

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 列号转 Excel 列标：0 -> A，26 -> AA */
export function colName(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/**
 * 生成 xlsx 字节流。
 * @param sheetName 工作表名（Excel 限制 31 字符内）
 * @param rows 行数据，第一行通常是表头
 */
export function buildXlsx(sheetName: string, rows: (string | number)[][]): Uint8Array<ArrayBuffer> {
  const body = rows
    .map((cells, r) => {
      const cs = cells
        .map((cell, c) => {
          const ref = `${colName(c)}${r + 1}`
          const text = cell === null || cell === undefined ? '' : String(cell)
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cs}</row>`
    })
    .join('')

  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `${DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${esc(sheetName.slice(0, 31) || 'Sheet1')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    ),
    'xl/styles.xml': strToU8(
      `${DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
        '<borders count="1"><border/></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
        '</styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `${DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetData>${body}</sheetData></worksheet>`,
    ),
  }
  return zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** CSV（带 BOM，Excel 打开中文不乱码） */
export function buildCsv(rows: (string | number)[][]): Blob {
  const text = rows
    .map((cells) =>
      cells
        .map((cell) => {
          const s = cell === null || cell === undefined ? '' : String(cell)
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\r\n')
  return new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' })
}
