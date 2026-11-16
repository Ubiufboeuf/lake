import type { SearchResults, ScoredItem, Weights, SearchItem } from '.'
import { fuzzy } from './fuzzy'
import { normalize } from './normalize'
import { PREPARED_DOCUMENTS, type PreparedDocument, type PreparedSearchResults } from './search-index'

type Token = {
  value: string
  weight: number
}

export function rank<T extends SearchItem> (
  query: string,
  resultsList: SearchResults[],
  weights: Weights<T> | undefined,
  limit?: number
): ScoredItem[] {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new RangeError('limit debe ser un entero no negativo')
  }
  if (limit === 0) return []

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
  const topK = limit === undefined ? null : new TopK(limit)

  for (const group of resultsList) {
    const { items, origin } = group
    const prepared = (group as PreparedSearchResults)[PREPARED_DOCUMENTS]

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const score = prepared?.[i]
        ? calculatePreparedScore(
            normalizedQuery,
            queryTokens,
            multipleWords,
            tokenHasDigits,
            matchCache,
            prepared[i],
            item,
            origin,
            weights
          )
        : calculateScore(
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

      if (score > 0) {
        const result = { item, origin, score }
        if (topK) topK.add(result)
        else results.push(result)
      }
    }
  }

  return topK ? topK.toSortedArray() : results.sort((a, b) => b.score - a.score)
}

type RankedEntry = { result: ScoredItem; order: number }

/**
 * Heap mínimo con el peor resultado en la raíz.
 * En empates se conserva el orden de aparición, igual que Array.sort() estable.
 * Coste: O(n log k) para seleccionar los k mejores y O(k log k) para ordenarlos.
 */
class TopK {
  private readonly heap: RankedEntry[] = []
  private nextOrder = 0

  constructor (private readonly limit: number) {}

  private worse (a: RankedEntry, b: RankedEntry): boolean {
    return a.result.score < b.result.score ||
      (a.result.score === b.result.score && a.order > b.order)
  }

  add (result: ScoredItem): void {
    const entry: RankedEntry = { result, order: this.nextOrder++ }
    const heap = this.heap

    if (heap.length < this.limit) {
      heap.push(entry)
      let index = heap.length - 1
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2)
        if (!this.worse(heap[index], heap[parent])) break
        ;[heap[index], heap[parent]] = [heap[parent], heap[index]]
        index = parent
      }
      return
    }

    // El nuevo candidato no mejora al peor de los seleccionados.
    if (!this.worse(heap[0], entry)) return

    heap[0] = entry
    let index = 0
    while (true) {
      const left = 2 * index + 1
      const right = left + 1
      let worst = index
      if (left < heap.length && this.worse(heap[left], heap[worst])) worst = left
      if (right < heap.length && this.worse(heap[right], heap[worst])) worst = right
      if (worst === index) break
      ;[heap[index], heap[worst]] = [heap[worst], heap[index]]
      index = worst
    }
  }

  toSortedArray (): ScoredItem[] {
    return this.heap
      .sort((a, b) => b.result.score - a.result.score || a.order - b.order)
      .map(entry => entry.result)
  }
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

/**
 * Versión de cálculo para candidatos indexados: normalización y tokenización
 * realizadas una sola vez por documento en buildIndex().
 */
function calculatePreparedScore<T extends SearchItem> (
  query: string,
  queryTokens: string[],
  multipleWords: boolean,
  tokenHasDigits: boolean[],
  matchCache: Map<string, number>[],
  prepared: PreparedDocument,
  item: SearchItem,
  origin: string,
  weights: Weights<T> | undefined
): number {
  const fieldWeights = typeof weights === 'function'
    ? weights(item as T, origin)
    : weights

  const { keys, values } = prepared
  const effectiveWeights: number[] = []
  let phraseBonus = 0

  for (let fi = 0; fi < values.length; fi++) {
    const value = values[fi]
    const weight = fieldWeights?.[keys[fi] as keyof T] ?? 1
    effectiveWeights.push(weight)
    if (weight <= 0 || !value.normalized) continue

    if (multipleWords) {
      if (value.normalized === query) {
        phraseBonus = Math.max(phraseBonus, 100 * weight)
      } else if (value.normalized.includes(query)) {
        phraseBonus = Math.max(phraseBonus, 50 * weight)
      }
    }
  }

  let score = 0
  const used = multipleWords ? new Set<number>() : null

  for (let qi = 0; qi < queryTokens.length; qi++) {
    const queryToken = queryTokens[qi]
    const cache = matchCache[qi]
    let bestScore = 0
    let bestIndex = -1
    let tokenIndex = 0

    for (let fi = 0; fi < values.length; fi++) {
      const preparedValue = values[fi]
      const weight = effectiveWeights[fi]
      if (weight <= 0 || !preparedValue.normalized) continue

      for (const value of preparedValue.tokens) {
        const index = tokenIndex++
        if (used?.has(index)) continue

        let matchScore = cache.get(value)
        if (matchScore === undefined) {
          matchScore = queryToken === value
            ? 100
            : !tokenHasDigits[qi] && value.startsWith(queryToken)
              ? 70
              : fuzzy(queryToken, value)
          cache.set(value, matchScore)
        }

        const weightedScore = matchScore * weight
        if (weightedScore > bestScore) {
          bestScore = weightedScore
          bestIndex = index
        }
      }
    }

    if (bestIndex === -1) return 0
    used?.add(bestIndex)
    score += bestScore
  }

  return score + phraseBonus
}
