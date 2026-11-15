
import type { SearchResults, ScoredItem, Weights, SearchItem } from '.'
import { fuzzy } from './fuzzy'
import { normalize } from './normalize'

type Token = {
  value: string
  weight: number
}

export function rank<T extends SearchItem> (
  query: string,
  resultsList: SearchResults[],
  weights: Weights<T> | undefined
) {
  const normalizedQuery = normalize(query)
  const results: ScoredItem[] = []

  for (const { items, origin } of resultsList) {
    for (const item of items) {
      const score = calculateScore(
        normalizedQuery,
        item,
        origin,
        weights
      )

      if (score <= 0) continue

      results.push({ item, origin, score })
    }
  }

  return results.sort((a, b) => b.score - a.score)
}

function calculateScore<T extends SearchItem> (
  query: string,
  item: SearchItem,
  origin: string,
  weights: Weights<T> | undefined
): number {
  if (!query) return 0

  const fieldWeights = typeof weights === 'function'
    ? weights(item as T, origin)
    : weights

  const queryTokens = query.split(/\s+/).filter(Boolean)
  const tokens: Token[] = []

  let phraseBonus = 0

  for (const [key, value] of Object.entries(item)) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      continue
    }

    const normalizedValue = normalize(String(value))
    const weight = fieldWeights?.[key as keyof T] ?? 1

    if (weight <= 0 || !normalizedValue) continue

    for (const token of normalizedValue.split(/\s+/)) {
      if (token) tokens.push({ value: token, weight })
    }

    if (queryTokens.length > 1) {
      if (normalizedValue === query) {
        phraseBonus = Math.max(phraseBonus, 100 * weight)
      } else if (normalizedValue.includes(query)) {
        phraseBonus = Math.max(phraseBonus, 50 * weight)
      }
    }
  }

  let score = 0
  const used = new Set<number>()

  for (const queryToken of queryTokens) {
    let bestScore = 0
    let bestIndex = -1

    for (let i = 0; i < tokens.length; i++) {
      if (used.has(i)) continue

      const token = tokens[i]
      let matchScore

      if (queryToken === token.value) {
        matchScore = 100
      } else if (
        !/\d/.test(queryToken) &&
        token.value.startsWith(queryToken)
      ) {
        matchScore = 70
      } else {
        matchScore = fuzzy(queryToken, token.value)
      }

      const weightedScore = matchScore * token.weight

      if (weightedScore > bestScore) {
        bestScore = weightedScore
        bestIndex = i
      }
    }

    // Todos los tokens deben encontrar una coincidencia.
    if (bestIndex === -1) return 0

    used.add(bestIndex)
    score += bestScore
  }

  return score + phraseBonus
}
