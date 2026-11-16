
/* eslint-disable @typescript-eslint/no-explicit-any */
import { deduplicate } from './deduplicate'
import { rank } from './rank'
import { buildIndex } from './search-index'

export type Source = (query: string, signal?: AbortSignal) => SearchResults | Promise<SearchResults>

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
  /** Cancela la búsqueda actual y se transmite a las fuentes. */
  signal?: AbortSignal
  onUpdate?: (results: ScoredItem[]) => void
  onError?: (error: unknown, sourceIndex: number) => void
}

function withTimeout<T> (
  promise: Promise<T>,
  timeout: number,
  signal?: AbortSignal
): Promise<T> {
  if (timeout <= 0 && !signal) return promise

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      cleanup()
      reject(signal?.reason)
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    if (timeout > 0) {
      timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Lake source timed out after ${timeout} ms`))
      }, timeout)
    }

    promise.then(
      value => {
        cleanup()
        resolve(value)
      },
      error => {
        cleanup()
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
    query: async (query: string, { onUpdate, onError, limit, signal }: QueryOptions = {}) => {
      signal?.throwIfAborted()
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
        throw new RangeError('limit debe ser un entero no negativo')
      }
      if (!query.trim()) {
        onUpdate?.([])
        signal?.throwIfAborted()
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

      const notify = () => {
        signal?.throwIfAborted()
        const results = getResults()
        signal?.throwIfAborted()
        onUpdate?.(results)
      }

      // La primera actualización permite mostrar resultados indexados de inmediato.
      notify()
      signal?.throwIfAborted()

      await Promise.all(sources.map(async (source, sourceIndex) => {
        let response: SearchResults

        try {
          signal?.throwIfAborted()
          response = await withTimeout(
            Promise.resolve().then(() => {
              signal?.throwIfAborted()
              return source(query, signal)
            }),
            timeout,
            signal
          )
        } catch (error) {
          if (signal?.aborted) return
          onError?.(error, sourceIndex)
          return
        }

        if (signal?.aborted) return
        resultsList.push(response)
        notify()
      }))

      signal?.throwIfAborted()
      return getResults()
    },

    reindex: (data: SearchResults[]) => {
      index = data.length
        ? buildIndex<T>(data, getFields(data))
        : null
    }
  }
}
