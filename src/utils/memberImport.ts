import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

/**
 * 成员批量导入的文档支持：CSV / TXT / Excel(.xlsx) / Word(.docx)。
 * xlsx 与 docx 本质都是 zip + XML，项目已有 fflate，不必再引入重型解析库。
 */

export type MemberTemplateFormat = 'csv' | 'xlsx' | 'docx'

const TEMPLATE_ROWS = [
  ['手机号', '姓名'],
  ['13800000001', '张三'],
  ['13800000002', '李四'],
]

const utf8 = new TextDecoder('utf-8')

/** Excel 另存的 CSV 在国内机器上多半是 GBK：UTF-8 解出替换字符就退回 GBK */
function decodeCsv(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const text = utf8.decode(bytes)
  if (!text.includes('\ufffd')) return text
  try {
    return new TextDecoder('gbk').decode(bytes)
  } catch {
    return text
  }
}

function xml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (Array.from(doc.children).some((el) => el.localName === 'parsererror')) {
    throw new Error('文件内部格式无法解析，请换一个文件重试')
  }
  return doc
}

function byName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', name))
}

function textOf(root: Document | Element, name: string): string {
  return byName(root, name)
    .map((el) => el.textContent ?? '')
    .join('')
}

/** Excel 单元格坐标 A1 / B12 → 列序号（从 0 开始） */
function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const code = ch.charCodeAt(0)
    if (code >= 65 && code <= 90) n = n * 26 + code - 64
    else if (code >= 97 && code <= 122) n = n * 26 + code - 96
    else break
  }
  return Math.max(0, n - 1)
}

/** 把 xlsx 的每个工作表读成文本行，单元格之间用逗号隔开 */
function xlsxToLines(buf: ArrayBuffer): string[] {
  const files = unzipSync(new Uint8Array(buf))
  const sharedXml = files['xl/sharedStrings.xml']
  const shared = sharedXml
    ? byName(xml(utf8.decode(sharedXml)), 'si').map((si) => textOf(si, 't'))
    : []
  const sheets = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort()

  const lines: string[] = []
  for (const name of sheets) {
    for (const row of byName(xml(utf8.decode(files[name]!)), 'row')) {
      const cells: string[] = []
      for (const c of byName(row, 'c')) {
        const type = c.getAttribute('t')
        let value = ''
        if (type === 'inlineStr') value = textOf(c, 't')
        else if (type === 's') value = shared[Number(textOf(c, 'v'))] ?? ''
        else value = textOf(c, 'v')
        const valueTrimmed = value.trim()
        if (!valueTrimmed) continue
        const i = colIndex(c.getAttribute('r') ?? '')
        while (cells.length < i) cells.push('')
        cells[i] = valueTrimmed
      }
      if (cells.some((v) => v)) lines.push(cells.join(','))
    }
  }
  return lines
}

/** Word 的段落、表格（按行按单元格）都读成一行文本 */
function docxToLines(buf: ArrayBuffer): string[] {
  const files = unzipSync(new Uint8Array(buf))
  const main = files['word/document.xml']
  if (!main) throw new Error('这不是有效的 Word 文档')
  const body = byName(xml(utf8.decode(main)), 'body')[0]
  const paraText = (p: Element) => textOf(p, 't')
  const lines: string[] = []
  for (const child of Array.from(body?.children ?? [])) {
    if (child.localName === 'p') {
      const text = paraText(child).trim()
      if (text) lines.push(text)
    } else if (child.localName === 'tbl') {
      for (const tr of byName(child, 'tr')) {
        const cells = byName(tr, 'tc').map((tc) =>
          byName(tc, 'p')
            .map(paraText)
            .join(' ')
            .trim(),
        )
        if (cells.some(Boolean)) lines.push(cells.join(','))
      }
    }
  }
  return lines
}

/** 读取任意受支持的文件，统一返回可直接粘进输入框的多行文本 */
export async function readMemberFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  const buf = await file.arrayBuffer()
  let lines: string[]
  if (name.endsWith('.xlsx')) lines = xlsxToLines(buf)
  else if (name.endsWith('.docx')) lines = docxToLines(buf)
  else lines = decodeCsv(buf).split(/\r?\n/)
  return lines
    .map((line) => line.replace(/^\ufeff/, '').trim())
    .filter(Boolean)
    .join('\n')
}

/* ---------------- 模板下载 ---------------- */

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function xlsxTemplate(): Uint8Array {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const rows = TEMPLATE_ROWS.map((cells, r) => {
    const cs = cells
      .map((cell, c) => {
        const ref = `${String.fromCharCode(65 + c)}${r + 1}`
        return `<c r="${ref}" t="inlineStr"><is><t>${esc(cell)}</t></is></c>`
      })
      .join('')
    return `<row r="${r + 1}">${cs}</row>`
  }).join('')
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
        '<sheets><sheet name="成员" sheetId="1" r:id="rId1"/></sheets></workbook>',
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
        `<sheetData>${rows}</sheetData></worksheet>`,
    ),
  }
  return zipSync(files, { level: 6 })
}

function docxTemplate(): Uint8Array {
  const paras = TEMPLATE_ROWS.map(
    (cells) => `<w:p><w:r><w:t>${cells.join(',')}</w:t></w:r></w:p>`,
  ).join('')
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    ),
    'word/document.xml': strToU8(
      `${DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>${paras}<w:sectPr/></w:body></w:document>`,
    ),
  }
  return zipSync(files, { level: 6 })
}

export const MEMBER_TEMPLATE_FORMATS: {
  id: MemberTemplateFormat
  label: string
  ext: string
  mime: string
}[] = [
  { id: 'csv', label: 'CSV（Excel 可直接打开）', ext: 'csv', mime: 'text/csv;charset=utf-8' },
  { id: 'xlsx', label: 'Excel 工作簿（.xlsx）', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { id: 'docx', label: 'Word 文档（.docx）', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
]

/** 生成模板文件；CSV 带 BOM，否则 Excel 打开中文表头会乱码 */
export function makeMemberTemplate(format: MemberTemplateFormat): { blob: Blob; filename: string } {
  if (format === 'xlsx') {
    const bytes = xlsxTemplate()
    return {
      blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: MEMBER_TEMPLATE_FORMATS[1]!.mime }),
      filename: '成员导入模板.xlsx',
    }
  }
  if (format === 'docx') {
    const bytes = docxTemplate()
    return {
      blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: MEMBER_TEMPLATE_FORMATS[2]!.mime }),
      filename: '成员导入模板.docx',
    }
  }
  const csv = TEMPLATE_ROWS.map((cells) => cells.join(',')).join('\r\n')
  return {
    blob: new Blob([`\ufeff${csv}`], { type: MEMBER_TEMPLATE_FORMATS[0]!.mime }),
    filename: '成员导入模板.csv',
  }
}
