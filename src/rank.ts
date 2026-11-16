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
): ScoredItem[] {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return []

  const queryTokens = normalizedQuery.split(/\s+/)
  const multipleWords = queryTokens.length > 1
  const tokenHasDigits = queryTokens.map(token => /\d/.test(token))

  // Caché local a cada consulta: una misma palabra del catálogo no necesita
  // repetir cientos o miles de veces el cálculo fuzzy.
  const matchCache = queryTokens.map(() => new Map<string, number>())
  // Límite por búsqueda para no acumular todos los campos de catálogos enormes.
  const valueCache = new Map<string, { normalized: string; tokens: string[] }>()
  const results: ScoredItem[] = []

  for (const { items, origin } of resultsList) {
    for (const item of items) {
      const score = calculateScore(
        normalizedQuery,
        queryTokens,
        multipleWords,
        tokenHasDigits,
        matchCache,
        valueCache,
        item,
        origin,
        weights
      )

      if (score > 0) results.push({ item, origin, score })
    }
  }

  return results.sort((a, b) => b.score - a.score)
}

function calculateScore<T extends SearchItem> (
  query: string,
  queryTokens: string[],
  multipleWords: boolean,
  tokenHasDigits: boolean[],
  matchCache: Map<string, number>[],
  valueCache: Map<string, { normalized: string; tokens: string[] }>,
  item: SearchItem,
  origin: string,
  weights: Weights<T> | undefined
): number {
  const fieldWeights = typeof weights === 'function'
    ? weights(item as T, origin)
    : weights

  const tokens: Token[] = []
  let phraseBonus = 0

  for (const [key, value] of Object.entries(item)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue

    const weight = fieldWeights?.[key as keyof T] ?? 1
    if (weight <= 0) continue

    const rawValue = String(value)
    let cached = valueCache.get(rawValue)
    if (!cached) {
      const normalized = normalize(rawValue)
      cached = { normalized, tokens: normalized.split(/\s+/) }
      if (typeof value === 'string' && valueCache.size < 16_384) {
        valueCache.set(rawValue, cached)
      }
    }

    const normalizedValue = cached.normalized
    if (!normalizedValue) continue

    for (const token of cached.tokens) {
      if (token) tokens.push({ value: token, weight })
    }

    if (multipleWords) {
      if (normalizedValue === query) {
        phraseBonus = Math.max(phraseBonus, 100 * weight)
      } else if (normalizedValue.includes(query)) {
        phraseBonus = Math.max(phraseBonus, 50 * weight)
      }
    }
  }

  let score = 0
  const used = new Set<number>()

  for (let qi = 0; qi < queryTokens.length; qi++) {
    const queryToken = queryTokens[qi]
    const cache = matchCache[qi]

    let bestScore = 0
    let bestIndex = -1

    for (let i = 0; i < tokens.length; i++) {
      if (used.has(i)) continue
      const token = tokens[i]

      let matchScore = cache.get(token.value)
      if (matchScore === undefined) {
        matchScore = queryToken === token.value
          ? 100
          : !tokenHasDigits[qi] && token.value.startsWith(queryToken)
            ? 70
            : fuzzy(queryToken, token.value)
        cache.set(token.value, matchScore)
      }

      const weightedScore = matchScore * token.weight

      if (weightedScore > bestScore) {
        bestScore = weightedScore
        bestIndex = i
      }
    }

    if (bestIndex === -1) return 0

    used.add(bestIndex)
    score += bestScore
  }

  return score + phraseBonus
}
