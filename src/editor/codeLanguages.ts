/**
 * 代码块语言清单
 *
 * 数据来自 highlight.js 11.11.2 的注册表（192 种语言），
 * 由 .workbuddy/tmp/extract.mjs 从 highlight.js 自身读取 name / aliases 生成。
 * 这里只存元信息，语法定义本体按需从 highlight.js 动态加载（见 codeLanguages.ts）。
 */

export interface CodeLanguage {
  /** highlight.js 的语言 id，同时是 markdown fence 上的标识 */
  id: string
  /** highlight.js 官方显示名 */
  name: string
  /** 界面展示名，常用语言带中文 */
  label: string
  /** 别名，markdown 里写别名也能识别 */
  aliases: string[]
  /**
   * 实际用于高亮的语法 id。
   * 少数语言 highlight.js 本身没有（vue / svelte），借用 xml 的语法。
   */
  hl?: string
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: '1c', name: '1C:Enterprise', label: '1C:Enterprise', aliases: [] },
  { id: 'actionscript', name: 'ActionScript', label: 'ActionScript', aliases: ['as'] },
  { id: 'ada', name: 'Ada', label: 'Ada', aliases: [] },
  { id: 'angelscript', name: 'AngelScript', label: 'AngelScript', aliases: ['asc'] },
  { id: 'apache', name: 'Apache config', label: 'Apache', aliases: ['apacheconf'] },
  { id: 'applescript', name: 'AppleScript', label: 'AppleScript', aliases: ['osascript'] },
  { id: 'arcade', name: 'ArcGIS Arcade', label: 'ArcGIS Arcade', aliases: [] },
  { id: 'arduino', name: 'Arduino', label: 'Arduino', aliases: ['ino'] },
  { id: 'armasm', name: 'ARM Assembly', label: 'ARM Assembly', aliases: ['arm'] },
  { id: 'asciidoc', name: 'AsciiDoc', label: 'AsciiDoc', aliases: ['adoc'] },
  { id: 'aspectj', name: 'AspectJ', label: 'AspectJ', aliases: [] },
  { id: 'abnf', name: 'Augmented Backus-Naur Form', label: 'Augmented Backus-Naur Form', aliases: [] },
  { id: 'autohotkey', name: 'AutoHotkey', label: 'AutoHotkey', aliases: ['ahk'] },
  { id: 'autoit', name: 'AutoIt', label: 'AutoIt', aliases: [] },
  { id: 'avrasm', name: 'AVR Assembly', label: 'AVR Assembly', aliases: [] },
  { id: 'awk', name: 'Awk', label: 'AWK', aliases: [] },
  { id: 'bnf', name: 'Backus–Naur Form', label: 'Backus–Naur Form', aliases: [] },
  { id: 'bash', name: 'Bash', label: 'Bash', aliases: ['sh', 'zsh'] },
  { id: 'basic', name: 'BASIC', label: 'BASIC', aliases: [] },
  { id: 'brainfuck', name: 'Brainfuck', label: 'Brainfuck', aliases: ['bf'] },
  { id: 'c', name: 'C', label: 'C', aliases: ['h'] },
  { id: 'cal', name: 'C/AL', label: 'C/AL', aliases: [] },
  { id: 'csharp', name: 'C#', label: 'C#', aliases: ['cs', 'c#'] },
  { id: 'cpp', name: 'C++', label: 'C++', aliases: ['cc', 'c++', 'h++', 'hpp', 'hh', 'hxx', 'cxx'] },
  { id: 'cos', name: 'Caché Object Script', label: 'Caché Object Script', aliases: ['cls'] },
  { id: 'capnproto', name: 'Cap’n Proto', label: 'Cap’n Proto', aliases: ['capnp'] },
  { id: 'ceylon', name: 'Ceylon', label: 'Ceylon', aliases: [] },
  { id: 'clean', name: 'Clean', label: 'Clean', aliases: ['icl', 'dcl'] },
  { id: 'clojure', name: 'Clojure', label: 'Clojure', aliases: ['clj', 'edn'] },
  { id: 'clojure-repl', name: 'Clojure REPL', label: 'Clojure REPL', aliases: [] },
  { id: 'cmake', name: 'CMake', label: 'CMake', aliases: ['cmake.in'] },
  { id: 'coffeescript', name: 'CoffeeScript', label: 'CoffeeScript', aliases: ['coffee', 'cson', 'iced'] },
  { id: 'coq', name: 'Coq', label: 'Coq', aliases: [] },
  { id: 'crmsh', name: 'crmsh', label: 'crmsh', aliases: ['crm', 'pcmk'] },
  { id: 'crystal', name: 'Crystal', label: 'Crystal', aliases: ['cr'] },
  { id: 'csp', name: 'CSP', label: 'CSP', aliases: [] },
  { id: 'css', name: 'CSS', label: 'CSS', aliases: [] },
  { id: 'd', name: 'D', label: 'D', aliases: [] },
  { id: 'dart', name: 'Dart', label: 'Dart', aliases: [] },
  { id: 'delphi', name: 'Delphi', label: 'Delphi', aliases: ['dpr', 'dfm', 'pas', 'pascal'] },
  { id: 'dts', name: 'Device Tree', label: 'Device Tree', aliases: [] },
  { id: 'diff', name: 'Diff', label: 'Diff', aliases: ['patch'] },
  { id: 'django', name: 'Django', label: 'Django 模板', aliases: ['jinja'] },
  { id: 'dns', name: 'DNS Zone', label: 'DNS Zone', aliases: ['bind', 'zone'] },
  { id: 'dockerfile', name: 'Dockerfile', label: 'Dockerfile', aliases: ['docker'] },
  { id: 'dos', name: 'Batch file (DOS)', label: 'DOS', aliases: ['bat', 'cmd'] },
  { id: 'dsconfig', name: 'dsconfig', label: 'dsconfig', aliases: [] },
  { id: 'dust', name: 'Dust', label: 'Dust', aliases: ['dst'] },
  { id: 'elixir', name: 'Elixir', label: 'Elixir', aliases: ['ex', 'exs'] },
  { id: 'elm', name: 'Elm', label: 'Elm', aliases: [] },
  { id: 'erb', name: 'ERB', label: 'ERB', aliases: [] },
  { id: 'erlang', name: 'Erlang', label: 'Erlang', aliases: ['erl'] },
  { id: 'erlang-repl', name: 'Erlang REPL', label: 'Erlang REPL', aliases: [] },
  { id: 'excel', name: 'Excel formulae', label: 'Excel formulae', aliases: ['xlsx', 'xls'] },
  { id: 'ebnf', name: 'Extended Backus-Naur Form', label: 'Extended Backus-Naur Form', aliases: [] },
  { id: 'fsharp', name: 'F#', label: 'F#', aliases: ['fs', 'f#'] },
  { id: 'fix', name: 'FIX', label: 'FIX', aliases: [] },
  { id: 'flix', name: 'Flix', label: 'Flix', aliases: [] },
  { id: 'fortran', name: 'Fortran', label: 'Fortran', aliases: ['f90', 'f95'] },
  { id: 'gcode', name: 'G-code (ISO 6983)', label: 'G-code (ISO 6983)', aliases: ['nc'] },
  { id: 'gams', name: 'GAMS', label: 'GAMS', aliases: ['gms'] },
  { id: 'gauss', name: 'GAUSS', label: 'GAUSS', aliases: ['gss'] },
  { id: 'gherkin', name: 'Gherkin', label: 'Gherkin', aliases: ['feature'] },
  { id: 'glsl', name: 'GLSL', label: 'GLSL', aliases: [] },
  { id: 'gml', name: 'GML', label: 'GML', aliases: [] },
  { id: 'go', name: 'Go', label: 'Go', aliases: ['golang'] },
  { id: 'golo', name: 'Golo', label: 'Golo', aliases: [] },
  { id: 'gradle', name: 'Gradle', label: 'Gradle', aliases: [] },
  { id: 'graphql', name: 'GraphQL', label: 'GraphQL', aliases: ['gql'] },
  { id: 'groovy', name: 'Groovy', label: 'Groovy', aliases: [] },
  { id: 'haml', name: 'HAML', label: 'Haml', aliases: [] },
  { id: 'handlebars', name: 'Handlebars', label: 'Handlebars', aliases: ['hbs', 'html.hbs', 'html.handlebars', 'htmlbars'] },
  { id: 'haskell', name: 'Haskell', label: 'Haskell', aliases: ['hs'] },
  { id: 'haxe', name: 'Haxe', label: 'Haxe', aliases: ['hx'] },
  { id: 'hsp', name: 'HSP', label: 'HSP', aliases: [] },
  { id: 'http', name: 'HTTP', label: 'HTTP', aliases: ['https'] },
  { id: 'hy', name: 'Hy', label: 'Hy', aliases: ['hylang'] },
  { id: 'inform7', name: 'Inform 7', label: 'Inform 7', aliases: ['i7'] },
  { id: 'ini', name: 'TOML, also INI', label: 'INI', aliases: ['toml'] },
  { id: 'x86asm', name: 'Intel x86 Assembly', label: 'Intel x86 Assembly', aliases: [] },
  { id: 'irpf90', name: 'IRPF90', label: 'IRPF90', aliases: [] },
  { id: 'isbl', name: 'ISBL', label: 'ISBL', aliases: [] },
  { id: 'java', name: 'Java', label: 'Java', aliases: ['jsp'] },
  { id: 'javascript', name: 'JavaScript', label: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'jboss-cli', name: 'JBoss CLI', label: 'JBoss CLI', aliases: ['wildfly-cli'] },
  { id: 'json', name: 'JSON', label: 'JSON', aliases: ['jsonc', 'json5'] },
  { id: 'julia', name: 'Julia', label: 'Julia', aliases: [] },
  { id: 'julia-repl', name: 'Julia REPL', label: 'Julia REPL', aliases: ['jldoctest'] },
  { id: 'kotlin', name: 'Kotlin', label: 'Kotlin', aliases: ['kt', 'kts'] },
  { id: 'lasso', name: 'Lasso', label: 'Lasso', aliases: ['ls', 'lassoscript'] },
  { id: 'latex', name: 'LaTeX', label: 'LaTeX', aliases: ['tex'] },
  { id: 'ldif', name: 'LDIF', label: 'LDIF', aliases: [] },
  { id: 'leaf', name: 'Leaf', label: 'Leaf', aliases: [] },
  { id: 'less', name: 'Less', label: 'Less', aliases: [] },
  { id: 'lisp', name: 'Lisp', label: 'Lisp', aliases: [] },
  { id: 'livecodeserver', name: 'LiveCode', label: 'LiveCode', aliases: [] },
  { id: 'livescript', name: 'LiveScript', label: 'LiveScript', aliases: ['ls'] },
  { id: 'llvm', name: 'LLVM IR', label: 'LLVM IR', aliases: [] },
  { id: 'lsl', name: 'LSL (Linden Scripting Language)', label: 'LSL (Linden Scripting Language)', aliases: [] },
  { id: 'lua', name: 'Lua', label: 'Lua', aliases: ['pluto'] },
  { id: 'makefile', name: 'Makefile', label: 'Makefile', aliases: ['mk', 'mak', 'make'] },
  { id: 'markdown', name: 'Markdown', label: 'Markdown', aliases: ['md', 'mkdown', 'mkd'] },
  { id: 'mathematica', name: 'Mathematica', label: 'Mathematica', aliases: ['mma', 'wl'] },
  { id: 'matlab', name: 'Matlab', label: 'MATLAB', aliases: [] },
  { id: 'maxima', name: 'Maxima', label: 'Maxima', aliases: [] },
  { id: 'mel', name: 'MEL', label: 'MEL', aliases: [] },
  { id: 'mercury', name: 'Mercury', label: 'Mercury', aliases: ['m', 'moo'] },
  { id: 'routeros', name: 'MikroTik RouterOS script', label: 'MikroTik RouterOS script', aliases: ['mikrotik'] },
  { id: 'mipsasm', name: 'MIPS Assembly', label: 'MIPS Assembly', aliases: ['mips'] },
  { id: 'mizar', name: 'Mizar', label: 'Mizar', aliases: [] },
  { id: 'mojolicious', name: 'Mojolicious', label: 'Mojolicious', aliases: [] },
  { id: 'monkey', name: 'Monkey', label: 'Monkey', aliases: [] },
  { id: 'moonscript', name: 'MoonScript', label: 'MoonScript', aliases: ['moon'] },
  { id: 'n1ql', name: 'N1QL', label: 'N1QL', aliases: [] },
  { id: 'nestedtext', name: 'Nested Text', label: 'Nested Text', aliases: ['nt'] },
  { id: 'nginx', name: 'Nginx config', label: 'Nginx', aliases: ['nginxconf'] },
  { id: 'nim', name: 'Nim', label: 'Nim', aliases: [] },
  { id: 'nix', name: 'Nix', label: 'Nix', aliases: ['nixos'] },
  { id: 'node-repl', name: 'Node REPL', label: 'Node REPL', aliases: [] },
  { id: 'nsis', name: 'NSIS', label: 'NSIS', aliases: [] },
  { id: 'objectivec', name: 'Objective-C', label: 'Objective-C', aliases: ['mm', 'objc', 'obj-c', 'obj-c++', 'objective-c++'] },
  { id: 'ocaml', name: 'OCaml', label: 'OCaml', aliases: ['ml'] },
  { id: 'openscad', name: 'OpenSCAD', label: 'OpenSCAD', aliases: ['scad'] },
  { id: 'ruleslanguage', name: 'Oracle Rules Language', label: 'Oracle Rules Language', aliases: [] },
  { id: 'oxygene', name: 'Oxygene', label: 'Oxygene', aliases: [] },
  { id: 'pf', name: 'Packet Filter config', label: 'Packet Filter config', aliases: ['pf.conf'] },
  { id: 'parser3', name: 'Parser3', label: 'Parser3', aliases: [] },
  { id: 'perl', name: 'Perl', label: 'Perl', aliases: ['pl', 'pm'] },
  { id: 'php', name: 'php', label: 'PHP', aliases: [] },
  { id: 'php-template', name: 'PHP template', label: 'PHP 模板', aliases: [] },
  { id: 'pony', name: 'Pony', label: 'Pony', aliases: [] },
  { id: 'pgsql', name: 'PostgreSQL', label: 'PostgreSQL', aliases: ['postgres', 'postgresql'] },
  { id: 'powershell', name: 'PowerShell', label: 'PowerShell', aliases: ['pwsh', 'ps', 'ps1'] },
  { id: 'processing', name: 'Processing', label: 'Processing', aliases: ['pde'] },
  { id: 'prolog', name: 'Prolog', label: 'Prolog', aliases: [] },
  { id: 'protobuf', name: 'Protocol Buffers', label: 'Protocol Buffers', aliases: ['proto'] },
  { id: 'puppet', name: 'Puppet', label: 'Puppet', aliases: ['pp'] },
  { id: 'purebasic', name: 'PureBASIC', label: 'PureBASIC', aliases: ['pb', 'pbi'] },
  { id: 'python', name: 'Python', label: 'Python', aliases: ['py', 'gyp', 'ipython'] },
  { id: 'profile', name: 'Python profiler', label: 'Python profiler', aliases: [] },
  { id: 'python-repl', name: 'python-repl', label: 'python-repl', aliases: ['pycon'] },
  { id: 'q', name: 'Q', label: 'Q', aliases: ['k', 'kdb'] },
  { id: 'qml', name: 'QML', label: 'QML', aliases: ['qt'] },
  { id: 'r', name: 'R', label: 'R', aliases: [] },
  { id: 'reasonml', name: 'ReasonML', label: 'ReasonML', aliases: ['re'] },
  { id: 'rib', name: 'RenderMan RIB', label: 'RenderMan RIB', aliases: [] },
  { id: 'rsl', name: 'RenderMan RSL', label: 'RenderMan RSL', aliases: [] },
  { id: 'roboconf', name: 'Roboconf', label: 'Roboconf', aliases: ['graph', 'instances'] },
  { id: 'ruby', name: 'Ruby', label: 'Ruby', aliases: ['rb', 'gemspec', 'podspec', 'thor', 'irb'] },
  { id: 'rust', name: 'Rust', label: 'Rust', aliases: ['rs'] },
  { id: 'sas', name: 'SAS', label: 'SAS', aliases: [] },
  { id: 'scala', name: 'Scala', label: 'Scala', aliases: [] },
  { id: 'scheme', name: 'Scheme', label: 'Scheme', aliases: ['scm'] },
  { id: 'scilab', name: 'Scilab', label: 'Scilab', aliases: ['sci'] },
  { id: 'scss', name: 'SCSS', label: 'SCSS', aliases: [] },
  { id: 'shell', name: 'Shell Session', label: 'Shell', aliases: ['console', 'shellsession'] },
  { id: 'smali', name: 'Smali', label: 'Smali', aliases: [] },
  { id: 'smalltalk', name: 'Smalltalk', label: 'Smalltalk', aliases: ['st'] },
  { id: 'sml', name: 'SML (Standard ML)', label: 'SML (Standard ML)', aliases: ['ml'] },
  { id: 'sqf', name: 'SQF', label: 'SQF', aliases: [] },
  { id: 'sql', name: 'SQL', label: 'SQL', aliases: [] },
  { id: 'stan', name: 'Stan', label: 'Stan', aliases: ['stanfuncs'] },
  { id: 'stata', name: 'Stata', label: 'Stata', aliases: ['do', 'ado'] },
  { id: 'step21', name: 'STEP Part 21', label: 'STEP Part 21', aliases: ['p21', 'step', 'stp'] },
  { id: 'stylus', name: 'Stylus', label: 'Stylus', aliases: ['styl'] },
  { id: 'subunit', name: 'SubUnit', label: 'SubUnit', aliases: [] },
  { id: 'swift', name: 'Swift', label: 'Swift', aliases: [] },
  { id: 'taggerscript', name: 'Tagger Script', label: 'Tagger Script', aliases: [] },
  { id: 'tcl', name: 'Tcl', label: 'Tcl', aliases: ['tk'] },
  { id: 'tap', name: 'Test Anything Protocol', label: 'Test Anything Protocol', aliases: [] },
  { id: 'thrift', name: 'Thrift', label: 'Thrift', aliases: [] },
  { id: 'tp', name: 'TP', label: 'TP', aliases: [] },
  { id: 'twig', name: 'Twig', label: 'Twig', aliases: ['craftcms'] },
  { id: 'typescript', name: 'TypeScript', label: 'TypeScript', aliases: ['ts', 'tsx', 'mts', 'cts'] },
  { id: 'vala', name: 'Vala', label: 'Vala', aliases: [] },
  { id: 'vbscript', name: 'VBScript', label: 'VBScript', aliases: ['vbs'] },
  { id: 'vbscript-html', name: 'VBScript in HTML', label: 'VBScript in HTML', aliases: [] },
  { id: 'verilog', name: 'Verilog', label: 'Verilog', aliases: ['v', 'sv', 'svh'] },
  { id: 'vhdl', name: 'VHDL', label: 'VHDL', aliases: [] },
  { id: 'vim', name: 'Vim Script', label: 'Vim Script', aliases: [] },
  { id: 'vbnet', name: 'Visual Basic .NET', label: 'Visual Basic .NET', aliases: ['vb'] },
  { id: 'wasm', name: 'WebAssembly', label: 'WebAssembly', aliases: [] },
  { id: 'wren', name: 'Wren', label: 'Wren', aliases: [] },
  { id: 'axapta', name: 'X++', label: 'X++', aliases: ['x++'] },
  { id: 'xl', name: 'XL', label: 'XL', aliases: ['tao'] },
  { id: 'xml', name: 'HTML, XML', label: 'HTML / XML', aliases: ['html', 'xhtml', 'rss', 'atom', 'xjb', 'xsd', 'xsl', 'plist', 'wsf', 'svg'] },
  { id: 'xquery', name: 'XQuery', label: 'XQuery', aliases: ['xpath', 'xq', 'xqm'] },
  { id: 'yaml', name: 'YAML', label: 'YAML', aliases: ['yml'] },
  { id: 'zephir', name: 'Zephir', label: 'Zephir', aliases: ['zep'] },
  { id: 'properties', name: '.properties', label: '属性文件', aliases: [] },
  { id: 'plaintext', name: 'Plain text', label: '纯文本', aliases: ['text', 'txt'] },
  { id: 'accesslog', name: 'Apache Access Log', label: '访问日志', aliases: [] },
  // —— 以下两种 highlight.js 本身没有，借用 xml 的语法高亮 ——
  { id: 'vue', name: 'Vue', label: 'Vue', aliases: [], hl: 'xml' },
  { id: 'svelte', name: 'Svelte', label: 'Svelte', aliases: [], hl: 'xml' },
]

/** id -> 语言元信息 */
export const LANGUAGE_MAP: Record<string, CodeLanguage> = Object.fromEntries(
  CODE_LANGUAGES.map((l) => [l.id, l]),
)

/** 别名 -> 规范 id（js -> javascript 这种） */
export const ALIAS_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const l of CODE_LANGUAGES) {
    map[l.id] = l.id
    for (const a of l.aliases) {
      if (!(a in map)) map[a] = l.id
    }
  }
  return map
})()

/** 把用户写的任意标识（id 或别名）归一成规范 id */
export function normalizeLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  return ALIAS_MAP[key] ?? (LANGUAGE_MAP[key] ? key : null)
}

/** 取语言的展示名 */
export function languageLabel(raw: string | null | undefined): string {
  const id = normalizeLanguage(raw)
  if (!id) return '纯文本'
  return LANGUAGE_MAP[id]?.label ?? LANGUAGE_MAP[id]?.name ?? id
}

/**
 * 取真正用于语法高亮的 id。
 * 大多数语言 id 就是高亮 id；vue / svelte 这类借用 xml 的会返回 'xml'。
 */
export function highlightId(raw: string | null | undefined): string | null {
  const id = normalizeLanguage(raw)
  if (!id) return null
  return LANGUAGE_MAP[id]?.hl ?? id
}
