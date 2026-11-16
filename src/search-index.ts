import type { SearchItem, SearchResults } from '.'
import { normalize } from './normalize'
import { fuzzy } from './fuzzy'

export const PREPARED_DOCUMENTS = Symbol('lake.preparedDocuments')

export type PreparedValue = {
  normalized: string
  tokens: string[]
}

export type PreparedDocument = {
  // Los nombres de los campos se comparten entre documentos con el mismo esquema.
  keys: string[]
  values: PreparedValue[]
}

export type PreparedSearchResults = SearchResults & {
  [PREPARED_DOCUMENTS]?: PreparedDocument[]
}

type Document = {
  item: SearchItem
  origin: string
  prepared: PreparedDocument
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
  const postings = new Map<string, Set<number>>()
  const gramIndex = new Map<string, Set<string>>()

  // Internar valores frecuentes evita duplicar tokens normalizados entre artículos.
  // El límite impide que el diccionario crezca indefinidamente con textos únicos.
  const valuePool = new Map<string, PreparedValue>()
  const schemaPool = new Map<string, string[]>()
  const VALUE_POOL_LIMIT = 65_536

  function prepareValue (raw: string): PreparedValue {
    const cached = valuePool.get(raw)
    if (cached) return cached

    const normalized = normalize(raw)
    const prepared = { normalized, tokens: normalized ? normalized.split(/\s+/) : [] }
    if (valuePool.size < VALUE_POOL_LIMIT) valuePool.set(raw, prepared)
    return prepared
  }

  for (const { origin, items } of resultsList) {
    for (const item of items) {
      const documentId = documents.length
      const fieldKeys: string[] = []
      const fieldValues: PreparedValue[] = []
      const preparedValues = new Map<string, PreparedValue>()

      // Rank evalúa todos los campos enumerables, no solo los elegidos para
      // recuperar candidatos. Respetamos esa distinción.
      for (const [key, value] of Object.entries(item)) {
        if (typeof value !== 'string' && typeof value !== 'number') continue

        const prepared = prepareValue(String(value))
        fieldKeys.push(key)
        fieldValues.push(prepared)
        preparedValues.set(key, prepared)
      }

      const schemaKey = JSON.stringify(fieldKeys)
      let sharedKeys = schemaPool.get(schemaKey)
      if (!sharedKeys) {
        sharedKeys = fieldKeys
        schemaPool.set(schemaKey, sharedKeys)
      }
      documents.push({ item, origin, prepared: { keys: sharedKeys, values: fieldValues } })

      const tokens = new Set<string>()
      for (const field of fields) {
        const rawValue = (item as T)[field]
        if (typeof rawValue !== 'string' && typeof rawValue !== 'number') continue

        // Los valores no enumerables también podían participar en el índice anterior.
        const prepared = preparedValues.get(String(field)) ?? prepareValue(String(rawValue))
        for (const token of prepared.tokens) {
          if (token) tokens.add(token)
        }
      }

      for (const token of tokens) {
        if (!postings.has(token)) {
          postings.set(token, new Set())

          if (token.length >= 3 && !/\d/.test(token)) {
            for (const gram of bigrams(token)) {
              if (!gramIndex.has(gram)) gramIndex.set(gram, new Set())
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
      for (const id of postings.get(word) ?? []) matches.add(id)
    }

    add(token)

    if (!/\d/.test(token)) {
      for (const word of postings.keys()) {
        if (word !== token && word.startsWith(token)) add(word)
      }
    }

    if (token.length >= 3 && !/\d/.test(token)) {
      const candidates = new Set<string>()

      for (const gram of bigrams(token)) {
        for (const word of gramIndex.get(gram) ?? []) candidates.add(word)
      }

      for (const word of candidates) {
        if (word !== token && fuzzy(token, word) > 0) add(word)
      }
    }

    return matches
  }

  function search (query: string): SearchResults[] {
    const queryTokens = [...new Set(normalize(query).split(/\s+/).filter(Boolean))]
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

    const grouped = new Map<string, PreparedSearchResults>()

    for (const id of matchedIds ?? []) {
      const { item, origin, prepared } = documents[id]

      let group = grouped.get(origin)
      if (!group) {
        group = { origin, items: [] }
        // Metadatos internos invisibles para Object.keys(), JSON y comparaciones públicas.
        Object.defineProperty(group, PREPARED_DOCUMENTS, { value: [] })
        grouped.set(origin, group)
      }

      group.items.push(item)
      group[PREPARED_DOCUMENTS]!.push(prepared)
    }

    return [...grouped.values()]
  }

  return {
    search,
    size: documents.length,
    vocabularySize: postings.size
  }
}
