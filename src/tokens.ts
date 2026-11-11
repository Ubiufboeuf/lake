import { fuzzy } from './fuzzy'

export function tokenScore (query: string, value: string): number {
  const queryTokens = query.split(' ')
  const valueTokens = value.split(' ')

  let total = 0

  for (const token of queryTokens) {
    let bestScore = 0

    for (const word of valueTokens) {
      let score = 0

      if (word === token) score = 100
      else if (word.startsWith(token)) score = 80
      else if (word.endsWith(token)) score = 70
      else if (word.includes(token)) score = 50
      else if (!/\d/.test(token)) score = fuzzy(token, word)

      bestScore = Math.max(bestScore, score)
    }

    if (bestScore === 0) return 0

    total += bestScore
  }

  return Math.round((total / queryTokens.length) * 0.5)
}
