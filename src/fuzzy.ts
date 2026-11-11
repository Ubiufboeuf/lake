export function fuzzy (query: string, value: string): number {
  if (!query || !value || query.length < 3) return 0

  const words = value.split(/\s+/)
  const queryWords = query.split(/\s+/).length

  let bestScore = 0

  for (let size = Math.max(1, queryWords - 1); size <= queryWords + 1; size++) {
    for (let i = 0; i <= words.length - size; i++) {
      const candidate = words.slice(i, i + size).join(' ')
      const maxLength = Math.max(query.length, candidate.length)

      if (Math.abs(query.length - candidate.length) > maxLength * 0.3) {
        continue
      }

      const distance = editDistance(query, candidate)
      const similarity = 1 - distance / maxLength

      bestScore = Math.max(bestScore, similarity)
    }
  }

  if (bestScore < 0.7) return 0

  return Math.round(bestScore * 40)
}

function editDistance (a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1

  const matrix = Array.from(
    { length: rows },
    () => new Array<number>(cols).fill(0)
  )

  for (let i = 0; i < rows; i++) matrix[i][0] = i
  for (let j = 0; j < cols; j++) matrix[0][j] = j

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )

      // Letras adyacentes intercambiadas
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        matrix[i][j] = Math.min(
          matrix[i][j],
          matrix[i - 2][j - 2] + 1
        )
      }
    }
  }

  return matrix[a.length][b.length]
}
