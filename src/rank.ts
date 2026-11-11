import type { SearchResults, ScoredItem, Weights, SearchItem } from '.'
import { fuzzy } from './fuzzy'
import { normalize } from './normalize'
import { tokenScore } from './tokens'

export function rank<T extends SearchItem> (
  query: string,
  resultsList: SearchResults[],
  weights: Weights<T> | undefined
) {
  const normalizedQuery = normalize(query)
  const results: ScoredItem[] = []

  for (const { items, origin } of resultsList) {
    for (const item of items) {
      const result: ScoredItem = {
        item,
        origin,
        score: calculateScore(normalizedQuery, item, origin, weights)
      }

      results.push(result)
    }
  }

  return results.sort((a, b) => b.score - a.score)
}

function calculateScore<T extends SearchItem> (
  query: string,
  item: SearchItem,
  origin: string,
  weights: Weights<T> | undefined
) {
  let score = 0

  const fieldWeights = typeof weights === 'function'
    ? weights(item as T, origin)
    : weights

  for (const [key, value] of Object.entries(item)) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      continue
    }

    const normalizedValue = normalize(String(value))
    const weight = fieldWeights?.[key as keyof T] ?? 1

    let matchScore

    if (normalizedValue === query) {
      matchScore = 100
    } else if (normalizedValue.startsWith(query)) {
      matchScore = 80
    } else if (normalizedValue.endsWith(query)) {
      matchScore = 70
    } else if (normalizedValue.includes(query)) {
      matchScore = 50
    } else {
      matchScore = query.includes(' ')
        ? tokenScore(query, normalizedValue)
        : Math.max(
            fuzzy(query, normalizedValue),
            tokenScore(query, normalizedValue)
          )
    }

    score += matchScore * weight
  }

  return score
}
