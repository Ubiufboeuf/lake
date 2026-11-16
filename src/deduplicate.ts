import type { Duplicated, ScoredItem } from '.'

export function deduplicate (results: ScoredItem[], duplicated?: Duplicated): ScoredItem[] {
  if (!duplicated) return results

  const unique: ScoredItem[] = []

  // Compatibilidad con comparadores arbitrarios.
  if (!duplicated.key) {
    for (const result of results) {
      const index = unique.findIndex(item =>
        duplicated.join(item, result)
      )

      if (index === -1) {
        unique.push(result)
      } else {
        unique[index] = duplicated.resolve(unique[index], result)
      }
    }

    return unique
  }

  const groups = new Map<string | number, number[]>()

  for (const result of results) {
    const key: string | number = duplicated.key(result)
    const candidates: number[] = groups.get(key) ?? []

    const index = candidates.find(i =>
      duplicated.join(unique[i], result)
    )

    if (index === undefined) {
      candidates.push(unique.push(result) - 1)
      groups.set(key, candidates)
      continue
    }

    const merged = duplicated.resolve(unique[index], result)
    unique[index] = merged

    // Actualizar la posición si resolve cambia la clave.
    const nextKey = duplicated.key(merged)
    if (nextKey === key) continue

    candidates.splice(candidates.indexOf(index), 1)
    if (!candidates.length) groups.delete(key)

    const nextCandidates = groups.get(nextKey) ?? []
    const insertion = nextCandidates.findIndex(i => i > index)

    if (insertion === -1) nextCandidates.push(index)
    else nextCandidates.splice(insertion, 0, index)

    groups.set(nextKey, nextCandidates)
  }

  return unique
}
