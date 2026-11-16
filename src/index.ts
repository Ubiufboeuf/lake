
/* eslint-disable @typescript-eslint/no-explicit-any */
import { deduplicate } from './deduplicate'
import { rank } from './rank'
import { buildIndex } from './search-index'

export type Source = (query: string) => SearchResults | Promise<SearchResults>

export type SearchItem = {
  id: string
  title: string
  [key: string]: any
}

export type SearchResults = {
  origin: string
  items: SearchItem[]
}

export type ScoredItem = {
  item: SearchItem
  origin: string
  score: number
}

export type Duplicated = {
  key?: (result: ScoredItem) => string | number
  join: (a: ScoredItem, b: ScoredItem) => boolean
  resolve: (a: ScoredItem, b: ScoredItem) => ScoredItem
}

export type Weights<T extends SearchItem = SearchItem> =
  | Partial<Record<keyof T, number>>
  | ((item: T, origin: string) => Partial<Record<keyof T, number>>)

export interface LakeProps<T extends SearchItem> {
  sources?: Source[]
  indexed?: SearchResults[]
  fields?: (keyof T)[]
  duplicated?: Duplicated
  weights?: Weights<T>
  minScore?: number
  timeout?: number
}

export type QueryOptions = {
  /** Cantidad máxima de resultados devueltos (entero >= 0). */
  limit?: number
  onUpdate?: (results: ScoredItem[]) => void
  onError?: (error: unknown, sourceIndex: number) => void
}

function withTimeout<T> (promise: Promise<T>, timeout: number): Promise<T> {
  if (timeout <= 0) return promise

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Lake source timed out after ${timeout} ms`))
    }, timeout)

    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

const DEFAULT_WEIGHTS = {
  id: 10,
  title: 7
}

export function createLake<T extends SearchItem> ({
  sources = [],
  indexed = [],
  fields,
  duplicated,
  weights = DEFAULT_WEIGHTS as Weights<T>,
  minScore = 1,
  timeout = 2000
}: LakeProps<T>) {
  if (!sources.length && !indexed.length) return null

  const getFields = (data: SearchResults[]): (keyof T)[] => {
    if (fields) return fields

    const keys = new Set<keyof T>()

    for (const { items } of data) {
      for (const item of items) {
        for (const [key, value] of Object.entries(item)) {
          if (typeof value === 'string' || typeof value === 'number') {
            keys.add(key as keyof T)
          }
        }
      }
    }

    return [...keys]
  }

  let index = indexed.length
    ? buildIndex<T>(indexed, getFields(indexed))
    : null

  return {
    query: async (query: string, { onUpdate, onError, limit }: QueryOptions = {}) => {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
        throw new RangeError('limit debe ser un entero no negativo')
      }
      if (!query.trim()) {
        onUpdate?.([])
        return []
      }

      // Consultamos el índice antes de esperar respuestas externas.
      const resultsList: SearchResults[] = index?.search(query) ?? []

      const getResults = (): ScoredItem[] => {
        // Con deduplicación, resolve() puede modificar puntuaciones y resultados.
        // Por eso debemos deduplicar el conjunto completo antes de aplicar limit.
        const ranked = rank<T>(query, resultsList, weights, duplicated ? undefined : limit)
        const unique = deduplicate(ranked, duplicated)
        const valid = unique.filter(result => result.score >= minScore)

        // rank() ya ordena los resultados sin deduplicación.
        if (duplicated) valid.sort((a, b) => b.score - a.score)
        return limit === undefined ? valid : valid.slice(0, limit)
      }

      // La primera actualización permite mostrar resultados indexados de inmediato.
      onUpdate?.(getResults())

      await Promise.all(sources.map(async (source, sourceIndex) => {
        let response: SearchResults

        try {
          response = await withTimeout(
            Promise.resolve().then(() => source(query)),
            timeout
          )
        } catch (error) {
          onError?.(error, sourceIndex)
          return
        }

        resultsList.push(response)
        onUpdate?.(getResults())
      }))

      return getResults()
    },

    reindex: (data: SearchResults[]) => {
      index = data.length
        ? buildIndex<T>(data, getFields(data))
        : null
    }
  }
}
