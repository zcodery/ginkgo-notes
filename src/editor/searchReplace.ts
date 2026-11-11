import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

export type SearchMatch = { from: number; to: number }

export interface SearchReplaceOptions {
  matchClass: string
  currentClass: string
}

export interface SearchReplaceStorage {
  query: string
  replace: string
  caseSensitive: boolean
  wholeWord: boolean
  matches: SearchMatch[]
  current: number
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearchQuery: (query: string) => ReturnType
      setReplaceText: (text: string) => ReturnType
      setSearchCaseSensitive: (on: boolean) => ReturnType
      setSearchWholeWord: (on: boolean) => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
      replaceCurrent: () => ReturnType
      replaceAll: () => ReturnType
      clearSearch: () => ReturnType
    }
  }
}

export const searchReplacePluginKey = new PluginKey<{ decorations: DecorationSet }>('gnSearchReplace')

function isWordChar(ch: string) {
  return /[\p{L}\p{N}_]/u.test(ch)
}

function isWholeWord(text: string, start: number, end: number) {
  const before = start > 0 ? text[start - 1]! : ''
  const after = end < text.length ? text[end]! : ''
  return (!before || !isWordChar(before)) && (!after || !isWordChar(after))
}

export function collectMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): SearchMatch[] {
  if (!query) return []
  const needle = caseSensitive ? query : query.toLowerCase()
  const matches: SearchMatch[] = []

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const raw = node.text
    const hay = caseSensitive ? raw : raw.toLowerCase()
    let from = 0
    while (from <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, from)
      if (idx < 0) break
      const end = idx + needle.length
      if (!wholeWord || isWholeWord(raw, idx, end)) {
        matches.push({ from: pos + idx, to: pos + end })
      }
      from = idx + Math.max(1, needle.length)
    }
  })

  return matches
}

function buildDecorations(
  doc: ProseMirrorNode,
  matches: SearchMatch[],
  current: number,
  matchClass: string,
  currentClass: string,
) {
  if (!matches.length) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === current ? `${matchClass} ${currentClass}` : matchClass,
      }),
    ),
  )
}

function recompute(
  storage: SearchReplaceStorage,
  doc: ProseMirrorNode,
  opts: SearchReplaceOptions,
  preferFrom = -1,
) {
  const matches = collectMatches(doc, storage.query, storage.caseSensitive, storage.wholeWord)
  let current = -1
  if (matches.length) {
    if (preferFrom >= 0) {
      const near = matches.findIndex((m) => m.from >= preferFrom)
      current = near >= 0 ? near : matches.length - 1
    } else if (storage.current >= 0 && storage.current < matches.length) {
      current = storage.current
    } else {
      current = 0
    }
  }
  storage.matches = matches
  storage.current = current
  return buildDecorations(doc, matches, current, opts.matchClass, opts.currentClass)
}

function applySearchMeta(tr: Transaction, decorations: DecorationSet, silent = true) {
  tr.setMeta(searchReplacePluginKey, { decorations })
  if (silent) tr.setMeta('addToHistory', false)
  return tr
}

function selectCurrent(tr: Transaction, storage: SearchReplaceStorage) {
  const m = storage.matches[storage.current]
  if (!m) return tr
  try {
    return tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
  } catch {
    return tr
  }
}

export const SearchReplace = Extension.create<SearchReplaceOptions, SearchReplaceStorage>({
  name: 'searchReplace',

  addOptions() {
    return {
      matchClass: 'gn-search-match',
      currentClass: 'gn-search-current',
    }
  },

  addStorage() {
    return {
      query: '',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      matches: [],
      current: -1,
    }
  },

  addCommands() {
    return {
      setSearchQuery:
        (query) =>
        ({ tr, dispatch, state }) => {
          this.storage.query = query
          const decos = recompute(this.storage, state.doc, this.options)
          if (dispatch) {
            let next = applySearchMeta(tr, decos)
            next = selectCurrent(next, this.storage)
            dispatch(next)
          }
          return true
        },

      setReplaceText:
        (text) =>
        () => {
          this.storage.replace = text
          return true
        },

      setSearchCaseSensitive:
        (on) =>
        ({ tr, dispatch, state }) => {
          this.storage.caseSensitive = on
          const prefer = this.storage.matches[this.storage.current]?.from ?? -1
          const decos = recompute(this.storage, state.doc, this.options, prefer)
          if (dispatch) dispatch(applySearchMeta(tr, decos))
          return true
        },

      setSearchWholeWord:
        (on) =>
        ({ tr, dispatch, state }) => {
          this.storage.wholeWord = on
          const prefer = this.storage.matches[this.storage.current]?.from ?? -1
          const decos = recompute(this.storage, state.doc, this.options, prefer)
          if (dispatch) dispatch(applySearchMeta(tr, decos))
          return true
        },

      findNext:
        () =>
        ({ tr, dispatch, state }) => {
          const { matches } = this.storage
          if (!matches.length) return false
          this.storage.current = (this.storage.current + 1) % matches.length
          const decos = buildDecorations(
            state.doc,
            matches,
            this.storage.current,
            this.options.matchClass,
            this.options.currentClass,
          )
          if (dispatch) {
            let next = applySearchMeta(tr, decos)
            next = selectCurrent(next, this.storage)
            dispatch(next)
          }
          return true
        },

      findPrev:
        () =>
        ({ tr, dispatch, state }) => {
          const { matches } = this.storage
          if (!matches.length) return false
          this.storage.current =
            (this.storage.current - 1 + matches.length) % matches.length
          const decos = buildDecorations(
            state.doc,
            matches,
            this.storage.current,
            this.options.matchClass,
            this.options.currentClass,
          )
          if (dispatch) {
            let next = applySearchMeta(tr, decos)
            next = selectCurrent(next, this.storage)
            dispatch(next)
          }
          return true
        },

      replaceCurrent:
        () =>
        ({ tr, dispatch }) => {
          const { matches, current, replace, query } = this.storage
          if (!query || current < 0 || !matches[current]) return false
          const m = matches[current]!
          tr.insertText(replace, m.from, m.to)

          const mappedPrefer = tr.mapping.map(m.from)
          const decos = recompute(this.storage, tr.doc, this.options, mappedPrefer)
          if (dispatch) {
            let next = applySearchMeta(tr, decos, false)
            next = selectCurrent(next, this.storage)
            dispatch(next)
          }
          return true
        },

      replaceAll:
        () =>
        ({ tr, dispatch, state }) => {
          const { query, replace, caseSensitive, wholeWord } = this.storage
          if (!query) return false
          const matches = collectMatches(state.doc, query, caseSensitive, wholeWord)
          if (!matches.length) return false
          for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i]!
            tr.insertText(replace, m.from, m.to)
          }
          this.storage.matches = []
          this.storage.current = -1
          if (dispatch) {
            dispatch(applySearchMeta(tr, DecorationSet.empty, false))
          }
          return true
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          this.storage.query = ''
          this.storage.replace = ''
          this.storage.matches = []
          this.storage.current = -1
          if (dispatch) dispatch(applySearchMeta(tr, DecorationSet.empty))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const extension = this
    return [
      new Plugin({
        key: searchReplacePluginKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(searchReplacePluginKey) as
              | { decorations?: DecorationSet }
              | undefined
            if (meta?.decorations) return { decorations: meta.decorations }

            if (!tr.docChanged || !extension.storage.query) {
              if (!extension.storage.query) return { decorations: DecorationSet.empty }
              return { decorations: value.decorations.map(tr.mapping, tr.doc) }
            }

            const prefer = extension.storage.matches[extension.storage.current]
              ? tr.mapping.map(extension.storage.matches[extension.storage.current]!.from)
              : -1
            const decorations = recompute(extension.storage, tr.doc, extension.options, prefer)
            return { decorations }
          },
        },
        props: {
          decorations(state) {
            return searchReplacePluginKey.getState(state)?.decorations ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})

/** 读取扩展当前匹配状态（供 UI 展示） */
export function getSearchReplaceState(editor: unknown): SearchReplaceStorage | null {
  const storage = (editor as { storage?: { searchReplace?: SearchReplaceStorage } } | null)
    ?.storage
  return storage?.searchReplace ?? null
}
