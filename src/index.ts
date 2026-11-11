/* eslint-disable @typescript-eslint/no-explicit-any */
import { deduplicate } from './deduplicate'
import { rank } from './rank'

export type Source = (query: string) => SearchResults | Promise<SearchResults>
export type SearchItem = { id: string, title: string, [key: string]: any }
export type SearchResults = { origin: string, items: SearchItem[] }
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
  sources: Source[]
  duplicated?: Duplicated
  weights?: Weights<T>
  minScore?: number
}

const DEFAULT_WEIGHTS = {
  id: 10,
  title: 7
}

export function createLake<T extends SearchItem> ({ sources, duplicated, weights = DEFAULT_WEIGHTS as Weights<T>, minScore = 1 }: Props<T>) {
  if (!sources.length) return null

  const lake = {
    query: async (query: string) => {
      const resultsList = await Promise.all(
        sources.map((source) => source(query))
      )
      
      const ranked = rank(query, resultsList, weights)
      const unique = deduplicate(ranked, duplicated)
      return unique
        .filter((result) => result.score >= minScore)
        .sort((a, b) => b.score - a.score)
    }
  }
  
  return lake  
}
