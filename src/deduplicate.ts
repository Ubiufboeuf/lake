import type { Duplicated, ScoredItem } from '.'

export function deduplicate (results: ScoredItem[], duplicated?: Duplicated): ScoredItem[] {
  if (!duplicated) return results

  const unique: ScoredItem[] = []

  for (const result of results) {
    const index = unique.findIndex(item =>
      duplicated.join(item, result)
    )

    if (index === -1) {
      unique.push(result)
      continue
    }

    unique[index] = duplicated.resolve(unique[index], result)
  }

  return unique
}
