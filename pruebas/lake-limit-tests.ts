/**
 * Pruebas puntuales de la opción limit.
 * Ejecutar: bun pruebas/lake-limit-tests.ts
 */
import { createLake, type SearchResults, type ScoredItem, type Source } from '../src'
import { buildIndex } from '../src/search-index'
import { rank } from '../src/rank'

function equal (actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nactual=${JSON.stringify(actual)?.slice(0, 400)}\nesperado=${JSON.stringify(expected)?.slice(0, 400)}`)
  }
}

function ok (value: unknown, message: string): void {
  if (!value) throw new Error(message)
}

function compact (results: ScoredItem[]) {
  return results.map(({ item, origin, score }) => ({ id: item.id, origin, score }))
}

async function main (): Promise<void> {
  const titles = [
    'Samsung Galaxy S22 128GB', 'Samsung Galaxy S23 256GB',
    'Apple iPhone 15 128GB', 'Nintendo Switch OLED',
    'HP EliteBook 845 G8', 'Samsng Galaxi S22 128GB',
    'Kingston SSD 128GB', 'Logitech MX Master'
  ]
  const docs: SearchResults[] = [
    { origin: 'a', items: Array.from({ length: 600 }, (_, i) => ({
      id: `a${i}`, title: titles[i % titles.length],
      category: i % 2 ? 'Celulares' : 'Electronica',
      price: 100 + i % 100
    })) },
    { origin: 'b', items: Array.from({ length: 600 }, (_, i) => ({
      id: `b${i}`, title: titles[(i + 3) % titles.length],
      category: i % 3 ? 'Celulares' : 'Almacenamiento',
      price: 100 + i % 100
    })) }
  ]
  const idx = buildIndex(docs, ['title', 'category'])
  const queryList = ['128gb', 'samsng galaxi', 'galaxy', 's22', 'celulares', 'nintendo', 'xyz', '128gb galaxy']
  const limits = [0, 1, 2, 7, 20, 500, 2000]

  let matches = 0
  for (const query of queryList) {
    const candidates = idx.search(query)
    const all = compact(rank(query, candidates, undefined))
    for (const k of limits) {
      equal(compact(rank(query, candidates, undefined, k)), all.slice(0, k),
        `Top-K diferente del ranking completo en '${query}' con k=${k}`)
      matches++
    }
  }
  console.log(`✓ ${matches} comparaciones Top-K vs ranking completo (incluidos empates y búsquedas vacías)`)

  const weights = (item: SearchResults['items'][number], origin: string) => ({
    id: 0, title: origin === 'a' ? 2 : 10, category: item.price % 2 ? 5 : 0, price: 0
  })
  const lake = createLake({ indexed: docs, fields: ['title', 'category'], weights })!
  for (const query of queryList) {
    const full = compact(await lake.query(query))
    for (const k of [0, 1, 10, 20, 200]) {
      equal(compact(await lake.query(query, { limit: k })), full.slice(0, k),
        `createLake con pesos dinámicos difiere para ${query} con k=${k}`)
    }
  }
  console.log('✓ createLake con pesos dinámicos, múltiples orígenes y limit=0')

  const sources: Source[] = [
    () => ({ origin: 'remota', items: [
      { id: 'remote-a', title: 'Samsung Galaxy S22 128GB' },
      { id: 'remote-b', title: 'Samsng Galaxi 128GB' }
    ] }),
    async () => ({ origin: 'remota2', items: [
      { id: 'remote-c', title: 'Samsung Galaxy 128GB' }
    ] })
  ]
  const mixed = createLake({ indexed: docs, sources, fields: ['title'] })!
  const fullUpdates: ReturnType<typeof compact>[] = []
  const topUpdates: ReturnType<typeof compact>[] = []
  const full = compact(await mixed.query('128gb', { onUpdate: r => fullUpdates.push(compact(r)) }))
  const top = compact(await mixed.query('128gb', { limit: 7, onUpdate: r => topUpdates.push(compact(r)) }))
  equal(top, full.slice(0, 7), 'Fuente local/remota: resultados finales diferentes')
  equal(topUpdates, fullUpdates.map(u => u.slice(0, 7)), 'Fuente local/remota: callbacks diferentes')
  console.log('✓ Fuentes remotas + indexadas y callbacks progresivos limitados')

  const duplicated = {
    key: (r: ScoredItem) => r.item.id,
    join: (a: ScoredItem, b: ScoredItem) => a.item.id === b.item.id,
    // La resolución puede modificar la puntuación: no debemos truncar antes de deduplicar.
    resolve: (a: ScoredItem, b: ScoredItem): ScoredItem => ({
      ...a, score: a.score + b.score
    })
  }
  const dupData: SearchResults[] = [{ origin: 'a', items: [
    { id: 'same', title: 'Samsung 128GB' },
    { id: 'same', title: 'Samsung 128GB' },
    { id: 'other', title: 'Samsung 128GB' },
    { id: 'other2', title: 'Samsung 128GB' }
  ] }]
  const dedupLake = createLake({ indexed: dupData, duplicated, fields: ['title'] })!
  const dedupAll = compact(await dedupLake.query('samsung'))
  equal(compact(await dedupLake.query('samsung', { limit: 1 })), dedupAll.slice(0, 1), 'Deduplicación antes de limit')
  ok(dedupAll[0].id === 'same', 'La resolución modificó el orden esperado')
  console.log('✓ Deduplicación personalizada y resolve() que altera puntuaciones')

  const minLake = createLake({ indexed: docs, fields: ['title'], minScore: 400 })!
  for (const query of queryList) {
    const all = compact(await minLake.query(query))
    equal(compact(await minLake.query(query, { limit: 5 })), all.slice(0, 5),
      `minScore vs limit para ${query}`)
  }
  console.log('✓ minScore y límite aplicados en orden correcto')

  const invalid = [-1, 1.5, Infinity, NaN]
  for (const n of invalid) {
    let rejected = false
    try { await lake.query('s22', { limit: n }) } catch (e) { rejected = e instanceof RangeError }
    ok(rejected, `Se esperaba RangeError para ${n}`)
  }
  console.log('✓ Rechazo de límites inválidos')

  lake.reindex([{ origin: 'new', items: [{ id: 'new-1', title: 'Samsung Galaxy S22' }] }])
  equal(compact(await lake.query('s22', { limit: 1 })).map(x => x.id), ['new-1'], 'Reindex y limit')
  console.log('✓ Reindexación y limit')

  console.log('\nLAKE LIMIT: TODAS LAS PRUEBAS SUPERADAS')
}

void main().catch(error => { console.error(error); throw error })
