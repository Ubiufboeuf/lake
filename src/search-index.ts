import type { SearchItem, SearchResults } from '.'
import { normalize } from './normalize'
import { fuzzy } from './fuzzy'

type Document = {
  item: SearchItem
  origin: string
}

function bigrams (value: string): string[] {
  const result: string[] = []

  for (let i = 0; i < value.length - 1; i++) {
    result.push(value.slice(i, i + 2))
  }

  return result
}

export function buildIndex<T extends SearchItem> (
  resultsList: SearchResults[],
  fields: (keyof T)[]
) {
  const documents: Document[] = []

  // Token → identificadores internos de documentos
  const postings = new Map<string, Set<number>>()

  // Bigrama → palabras del vocabulario
  const gramIndex = new Map<string, Set<string>>()

  for (const { origin, items } of resultsList) {
    for (const item of items) {
      const documentId = documents.length
      documents.push({ item, origin })

      const tokens = new Set<string>()

      for (const field of fields) {
        const value = (item as T)[field]

        if (typeof value !== 'string' && typeof value !== 'number') {
          continue
        }

        for (const token of normalize(String(value)).split(/\s+/)) {
          if (token) tokens.add(token)
        }
      }

      for (const token of tokens) {
        if (!postings.has(token)) {
          postings.set(token, new Set())

          if (token.length >= 3 && !/\d/.test(token)) {
            for (const gram of bigrams(token)) {
              if (!gramIndex.has(gram)) {
                gramIndex.set(gram, new Set())
              }

              gramIndex.get(gram)!.add(token)
            }
          }
        }

        postings.get(token)!.add(documentId)
      }
    }
  }

  function findToken (token: string): Set<number> {
    const matches = new Set<number>()

    const add = (word: string) => {
      for (const id of postings.get(word) ?? []) {
        matches.add(id)
      }
    }

    // Coincidencia exacta
    add(token)

    // Coincidencia por prefijo
    if (!/\d/.test(token)) {
      for (const word of postings.keys()) {
        if (word !== token && word.startsWith(token)) {
          add(word)
        }
      }
    }

    // Coincidencia aproximada mediante bigramas
    if (token.length >= 3 && !/\d/.test(token)) {
      const candidates = new Set<string>()

      for (const gram of bigrams(token)) {
        for (const word of gramIndex.get(gram) ?? []) {
          candidates.add(word)
        }
      }

      for (const word of candidates) {
        if (word !== token && fuzzy(token, word) > 0) {
          add(word)
        }
      }
    }

    return matches
  }

  function search (query: string): SearchResults[] {
    const queryTokens = [
      ...new Set(normalize(query).split(/\s+/).filter(Boolean))
    ]

    if (!queryTokens.length) return []

    let matchedIds: Set<number> | undefined

    for (const token of queryTokens) {
      const tokenMatches = findToken(token)

      if (!tokenMatches.size) return []

      matchedIds = matchedIds
        ? new Set([...matchedIds].filter(id => tokenMatches.has(id)))
        : tokenMatches

      if (!matchedIds.size) return []
    }

    const grouped = new Map<string, SearchItem[]>()

    for (const id of matchedIds ?? []) {
      const { item, origin } = documents[id]

      if (!grouped.has(origin)) {
        grouped.set(origin, [])
      }

      grouped.get(origin)!.push(item)
    }

    return [...grouped].map(([origin, items]) => ({
      origin,
      items
    }))
  }

  return {
    search,
    size: documents.length,
    vocabularySize: postings.size
  }
}
