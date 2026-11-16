/**
 * Coincidencia aproximada, basada en la distancia de edición con
 * transposiciones adyacentes (Optimal String Alignment).
 *
 * Conserva el umbral de similitud de 0.75 y la puntuación de 0-40.
 */
export function fuzzy (query: string, value: string): number {
  if (!query || !value || query.length < 3) return 0

  // Los identificadores numéricos deben coincidir exactamente.
  if (/\d/.test(query) || /\d/.test(value)) return 0

  // Caso habitual dentro de rank(): comparamos dos tokens individuales.
  if (!/\s/.test(query) && !/\s/.test(value)) {
    return similarityScore(query, value)
  }

  // Se mantiene la comparación de frases para usos externos de fuzzy().
  const words = value.split(/\s+/)
  const queryWords = query.split(/\s+/).length
  let bestScore = 0

  for (let size = Math.max(1, queryWords - 1); size <= queryWords + 1; size++) {
    for (let i = 0; i <= words.length - size; i++) {
      const candidate = words.slice(i, i + size).join(' ')
      const score = similarityScore(query, candidate)
      if (score > bestScore) bestScore = score
    }
  }

  return bestScore
}

function similarityScore (query: string, candidate: string): number {
  const maxLength = Math.max(query.length, candidate.length)
  const maxDistance = Math.floor(maxLength * 0.25)

  if (Math.abs(query.length - candidate.length) > maxDistance) return 0

  const distance = boundedEditDistance(query, candidate, maxDistance)
  return distance > maxDistance ? 0 : Math.round((1 - distance / maxLength) * 40)
}

/**
 * DP con banda limitada al máximo de errores admitidos y tres filas:
 * O(k * min(longitudes)) en vez de la matriz completa.
 */
function boundedEditDistance (a: string, b: string, limit: number): number {
  const n = a.length
  const m = b.length
  const inf = limit + 1

  let prevPrev = new Int32Array(m + 1).fill(inf)
  let prev = new Int32Array(m + 1)
  let curr = new Int32Array(m + 1).fill(inf)

  for (let j = 0; j <= m; j++) prev[j] = Math.min(j, inf)

  for (let i = 1; i <= n; i++) {
    curr.fill(inf)
    if (i <= limit) curr[0] = i

    const start = Math.max(1, i - limit)
    const end = Math.min(m, i + limit)

    for (let j = start; j <= end; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1

      let distance = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      )

      if (
        i > 1 && j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        distance = Math.min(distance, prevPrev[j - 2] + 1)
      }

      curr[j] = distance
    }

    const oldPrevPrev = prevPrev
    prevPrev = prev
    prev = curr
    curr = oldPrevPrev
  }

  return prev[m]
}
