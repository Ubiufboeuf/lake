
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
  join: (a: ScoredItem, b: ScoredItem) => boolean
  resolve: (a: ScoredItem, b: ScoredItem) => ScoredItem
}

export type Weights<T extends SearchItem = SearchItem> =
  | Partial<Record<keyof T, number>>
  | ((item: T, origin: string) => Partial<Record<keyof T, number>>)

interface Props<T extends SearchItem> {
  sources?: Source[]
  indexed?: SearchResults[]
  fields?: (keyof T)[]
  duplicated?: Duplicated
  weights?: Weights<T>
  minScore?: number
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
  minScore = 1
}: Props<T>) {
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
    query: async (query: string) => {
      if (!query.trim()) return []

      const resultsList = await Promise.all(
        sources.map(source => source(query))
      )

      const indexedResults = index?.search(query) ?? []

      const ranked = rank<T>(
        query,
        [...indexedResults, ...resultsList],
        weights
      )

      const unique = deduplicate(ranked, duplicated)

      return unique
        .filter(result => result.score >= minScore)
        .sort((a, b) => b.score - a.score)
    },

    reindex: (data: SearchResults[]) => {
      index = data.length
        ? buildIndex<T>(data, getFields(data))
        : null
    }
  }
}
