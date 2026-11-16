/**
 * Batería de estrés de Lake.
 * Ubicación sugerida: pruebas/stress-suite.ts
 * Dependencias: ../src, ./stress-mocks (ya existentes en el proyecto).
 *
 * bun pruebas/stress-suite.ts
 * bun pruebas/stress-suite.ts --full
 * bun pruebas/stress-suite.ts --extreme
 * bun pruebas/stress-suite.ts --queries=250 --concurrency=80 --sources=20
 *
 * Nota: es un benchmark sintético, no representa latencia de una red real.
 */
import { createLake, type ScoredItem, type SearchResults, type Source } from '../src'
import { buildIndex } from '../src/search-index'
import { rank } from '../src/rank'
import { deduplicate } from '../src/deduplicate'
import { generateStressMocks } from './stress-mocks'

// process existe tanto en Bun como en Node. Declaración mínima para poder
// comprobar este archivo incluso sin instalar @types/node.
declare const process: {
  argv: string[]
  exitCode?: number
  memoryUsage: () => { rss: number; heapUsed: number }
}

const args = process.argv.slice(2)
const extreme = args.includes('--extreme')
const full = extreme || args.includes('--full')

function numberArg (name: string, fallback: number): number {
  const raw = args.find(arg => arg.startsWith(`--${name}=`))
  if (!raw) return fallback
  const n = Number(raw.slice(name.length + 3))
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`--${name} debe ser un entero positivo`)
  }
  return n
}

const queryCount = numberArg('queries', extreme ? 1000 : full ? 500 : 100)
const concurrency = numberArg('concurrency', extreme ? 200 : full ? 100 : 30)
const sourceCount = numberArg('sources', extreme ? 50 : full ? 30 : 10)
const sizes = extreme ? [1_000, 10_000, 100_000, 500_000]
  : full ? [1_000, 10_000, 100_000]
    : [1_000, 10_000]

type Check = { name: string; success: boolean; duration: number; detail: string }
const checks: Check[] = []
const queries = [
  'samsung s22',
  'samsng galaxi',
  'iphone 15',
  'elitebook 845',
  'nintendo switch',
  'logitech mx',
  '128gb',
  'xyznoexiste'
]

const time = () => performance.now()
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const ms = (value: number) => `${value.toFixed(2)} ms`
function assert (condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function stats (values: number[]) {
  assert(values.length > 0, 'No se registraron tiempos')
  const sorted = [...values].sort((a, b) => a - b)
  const p = (fraction: number) => sorted[Math.ceil(fraction * sorted.length) - 1]
  const total = values.reduce((sum, value) => sum + value, 0)
  return `avg=${ms(total / values.length)} p50=${ms(p(.5))} p95=${ms(p(.95))} p99=${ms(p(.99))} max=${ms(sorted.at(-1)!)}`
}
function memory () {
  const { rss, heapUsed } = process.memoryUsage()
  return `heap=${mb(heapUsed)} rss=${mb(rss)}`
}
async function check (name: string, task: () => Promise<string> | string) {
  const started = time()
  try {
    const detail = await task()
    const duration = time() - started
    checks.push({ name, success: true, duration, detail })
    console.log(`  ✓ ${name}: ${detail} (${ms(duration)})`)
  } catch (error) {
    const duration = time() - started
    const detail = error instanceof Error ? error.message : String(error)
    checks.push({ name, success: false, duration, detail })
    console.error(`  ✗ ${name}: ${detail} (${ms(duration)})`)
  }
}
function scored (id: string, score = 100): ScoredItem {
  return { item: { id, title: `Samsung Galaxy S22 ${id}` }, origin: 'test', score }
}

async function correctness () {
  console.log('\n[1/4] CORRECCIÓN Y RESILIENCIA')

  await check('Callbacks progresivos y resultado final', async () => {
    const updates: { ids: string[]; at: number }[] = []
    const started = time()
    const sources: Source[] = [
      async () => { await sleep(20); return { origin: 'fast', items: [{ id: 'fast', title: 'Samsung S22' }] } },
      async () => { await sleep(85); return { origin: 'slow', items: [{ id: 'slow', title: 'Galaxy S22' }] } }
    ]
    const lake = createLake({
      indexed: [{ origin: 'index', items: [{ id: 'indexed', title: 'Samsung Galaxy S22' }] }],
      sources,
      fields: ['title'],
      timeout: 500
    })!
    const results = await lake.query('s22', {
      onUpdate (current) {
        updates.push({ ids: current.map(r => r.item.id), at: time() - started })
      }
    })
    assert(updates.length === 3, `Se esperaban 3 callbacks, hubo ${updates.length}`)
    assert(updates[0].ids.join(',') === 'indexed', 'El índice no se entregó primero')
    assert(updates[1].ids.includes('fast') && !updates[1].ids.includes('slow'), 'Fast no llegó antes que slow')
    assert(updates[2].ids.includes('slow'), 'Slow nunca fue publicado')
    assert(results.length === 3, `Resultado final incorrecto: ${results.length}`)
    assert(updates[1].at < updates[2].at, 'No hubo entrega progresiva real')
    return `updates=${updates.length}, tiempos=[${updates.map(u => Math.round(u.at)).join(', ')}] ms`
  })

  await check('Fallo síncrono, rechazo y timeout aislados', async () => {
    const failures: number[] = []
    const sources: Source[] = [
      async () => { await sleep(10); return { origin: 'ok', items: [{ id: 'ok', title: 'Galaxy S22' }] } },
      () => { throw new Error('Error síncrono') },
      async () => { throw new Error('Error asíncrono') },
      () => new Promise<SearchResults>(() => {})
    ]
    const lake = createLake({ sources, timeout: 55 })!
    const start = time()
    const results = await lake.query('s22', { onError: (_error, i) => failures.push(i) })
    const elapsed = time() - start
    assert(results.length === 1 && results[0].item.id === 'ok', 'Perdimos la fuente correcta')
    assert(failures.sort().join(',') === '1,2,3', `Errores recibidos: ${failures}`)
    assert(elapsed >= 45, 'El timeout no parece haberse respetado')
    return `errores=[${failures}], total=${ms(elapsed)}`
  })

  await check('Deduplicación y ranking acumulado', async () => {
    const lake = createLake({
      sources: [
        () => ({ origin: 'a', items: [{ id: 'same', title: 'Galaxy S22' }] }),
        async () => ({ origin: 'b', items: [{ id: 'same', title: 'Samsung Galaxy S22' }] })
      ],
      duplicated: {
        key: ({ item }) => item.id,
        join: (a, b) => a.item.id === b.item.id,
        resolve: (a, b) => a.score >= b.score ? a : b
      }
    })!
    const outputs: number[] = []
    const result = await lake.query('s22', { onUpdate: r => outputs.push(r.length) })
    assert(result.length === 1, `No se eliminó el duplicado: ${result.length}`)
    assert(outputs.length === 3, `No llegaron todas las actualizaciones: ${outputs.length}`)
    assert(result[0].score > 0, 'Score inválido')
    return `updates=${outputs}, únicos=${result.length}`
  })

  await check('Reindexación reemplaza los documentos anteriores', async () => {
    const lake = createLake({ indexed: [{ origin: 'a', items: [{ id: 'old', title: 'Alpha' }] }], fields: ['title'] })!
    assert((await lake.query('alpha')).length === 1, 'Índice inicial incorrecto')
    lake.reindex([{ origin: 'b', items: [{ id: 'new', title: 'Beta' }] }])
    assert((await lake.query('alpha')).length === 0, 'Quedaron datos del índice viejo')
    assert((await lake.query('beta'))[0]?.item.id === 'new', 'El índice nuevo no funciona')
    return 'índice reemplazado correctamente'
  })
}

async function indexedBenchmarks () {
  console.log('\n[2/4] ÍNDICE, RANKING Y ESCALABILIDAD')
  let lastIndex: ReturnType<typeof buildIndex> | undefined
  let lastSize = 0
  const fields = ['title', 'brand', 'category', 'description'] as const

  for (const count of sizes) {
    await check(`Índice con ${count.toLocaleString('es-UY')} documentos`, async () => {
      const generateStart = time()
      const { sources } = generateStressMocks(count, 2)
      const data = await Promise.all(sources.map(s => s('')))
      const generation = time() - generateStart
      const start = time()
      const index = buildIndex(data, [...fields])
      const build = time() - start
      assert(index.size === count, `El índice contiene ${index.size}, esperados ${count}`)
      const sample: { query: string; count: number; search: number; rank: number }[] = []
      for (const query of queries) {
        const s = time()
        const candidates = index.search(query)
        const afterSearch = time()
        const ranked = rank(query, candidates, undefined)
        sample.push({ query, count: ranked.length, search: afterSearch - s, rank: time() - afterSearch })
      }
      const peak = sample.reduce((best, s) => s.search + s.rank > best.search + best.rank ? s : best)
      lastIndex = index
      lastSize = count
      return `generación=${ms(generation)} indexación=${ms(build)} vocabulario=${index.vocabularySize}, peor consulta="${peak.query}" total=${ms(peak.search + peak.rank)} [index.search=${ms(peak.search)}, rank=${ms(peak.rank)}] (${peak.count} resultados), ${memory()}`
    })
  }

  if (!lastIndex) return
  const index = lastIndex
  await check(`${queryCount.toLocaleString('es-UY')} consultas consecutivas (${lastSize.toLocaleString('es-UY')} docs)`, () => {
    const searchTimes: number[] = []
    const rankTimes: number[] = []
    const totalTimes: number[] = []
    for (let i = 0; i < 8; i++) {
      const query = queries[i]
      rank(query, index.search(query), undefined) // calentamiento completo
    }
    for (let i = 0; i < queryCount; i++) {
      const query = queries[i % queries.length]
      const started = time()
      const candidates = index.search(query)
      const afterSearch = time()
      rank(query, candidates, undefined)
      const finished = time()
      searchTimes.push(afterSearch - started)
      rankTimes.push(finished - afterSearch)
      totalTimes.push(finished - started)
    }
    const total = totalTimes.reduce((a, b) => a + b, 0)
    return `TOTAL: ${stats(totalTimes)} | INDEX.SEARCH: ${stats(searchTimes)} | RANK: ${stats(rankTimes)} | rendimiento efectivo=${(queryCount / (total / 1000)).toFixed(1)} consultas/s`
  })
}

async function concurrencyBenchmarks () {
  console.log('\n[3/4] CONCURRENCIA Y CALLBACKS')

  await check(`${concurrency} búsquedas simultáneas`, async () => {
    const { sources } = generateStressMocks(1_000, 5)
    const data = await Promise.all(sources.map(s => s('')))
    const lake = createLake({ indexed: data, fields: ['title', 'brand', 'description'] })!
    const started = time()
    const samples: number[] = []
    let calls = 0
    const all = Array.from({ length: concurrency }, (_, i) => {
      const start = time()
      return lake.query(queries[i % queries.length], { onUpdate: () => { calls++ } })
        .then(results => {
          assert(Array.isArray(results), 'Respuesta inválida')
          samples.push(time() - start)
        })
    })
    await Promise.all(all)
    assert(calls === concurrency, `Callbacks: ${calls}, esperados ${concurrency}`)
    return `${stats(samples)}; total=${ms(time() - started)}, callbacks=${calls}`
  })

  await check(`${sourceCount} fuentes con latencia variable`, async () => {
    const sources: Source[] = Array.from({ length: sourceCount }, (_, index) => async () => {
      await sleep(5 + (index % 7) * 8)
      return {
        origin: `source-${index}`,
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `s${index}-${i}`,
          title: `Samsung Galaxy S22 modelo ${i}`
        }))
      }
    })
    const lake = createLake({ sources, timeout: 1_000 })!
    const started = time()
    const timings: number[] = []
    let finalCount = 0
    const results = await lake.query('s22', {
      onUpdate (r) {
        timings.push(time() - started)
        finalCount = r.length
      }
    })
    assert(timings.length === sourceCount + 1, `Actualizaciones: ${timings.length}`)
    assert(results.length === sourceCount * 20, `Se perdieron resultados: ${results.length}`)
    assert(finalCount === results.length, 'Última actualización != resultado final')
    return `updates=${timings.length}, primera=${ms(timings[0])}, última=${ms(timings.at(-1)!)}, elementos=${results.length}`
  })
}

async function dedupBenchmarks () {
  console.log('\n[4/4] DEDUPLICACIÓN Y REINDEXACIÓN')
  const duplicated = {
    key: ({ item }: ScoredItem) => item.id,
    join: (a: ScoredItem, b: ScoredItem) => a.item.id === b.item.id,
    resolve: (a: ScoredItem, b: ScoredItem) => a.score >= b.score ? a : b
  }
  const dedupSizes = extreme ? [1_000, 5_000, 15_000, 50_000]
    : full ? [1_000, 5_000, 15_000]
      : [1_000, 5_000]
  for (const count of dedupSizes) {
    await check(`Deduplicación peor caso: ${count.toLocaleString('es-UY')} IDs únicos`, () => {
      const input = Array.from({ length: count }, (_, i) => scored(`p${i}`))
      const start = time()
      const output = deduplicate(input, duplicated)
      const elapsed = time() - start
      assert(output.length === count, 'Se eliminaron IDs únicos')
      return `${ms(elapsed)} para ${count} elementos`
    })
  }
  await check('50% de duplicados', () => {
    const input = Array.from({ length: 5_000 }, (_, i) => scored(`p${i % 2_500}`, i))
    const start = time()
    const output = deduplicate(input, duplicated)
    assert(output.length === 2_500, `Únicos: ${output.length}`)
    return `${ms(time() - start)}, entrada=5000, salida=${output.length}`
  })
  await check('Reindexación de catálogo (10.000 documentos)', async () => {
    const { sources } = generateStressMocks(10_000, 5)
    const data = await Promise.all(sources.map(s => s('')))
    const lake = createLake({ indexed: data, fields: ['title', 'brand', 'category', 'description'] })!
    const start = time()
    lake.reindex(data)
    const duration = time() - start
    const res = await lake.query('samsung s22')
    assert(res.length > 0, 'No se encuentran productos tras reindexar')
    return `${ms(duration)}, resultados=${res.length}, ${memory()}`
  })
}

async function main () {
  console.log('LAKE — BATERÍA DE ESTRÉS')
  console.log(`Modo=${extreme ? 'EXTREMO' : full ? 'COMPLETO' : 'RÁPIDO'}, tamaños=[${sizes.join(', ')}], consultas=${queryCount}, concurrencia=${concurrency}, fuentes=${sourceCount}`)
  console.log(`Memoria inicial: ${memory()}`)
  if (extreme) console.log('AVISO: 500k documentos pueden consumir mucho tiempo y memoria.')
  await correctness()
  await indexedBenchmarks()
  await concurrencyBenchmarks()
  await dedupBenchmarks()

  const failed = checks.filter(c => !c.success)
  console.log('\n=== RESUMEN ===')
  console.log(`Pruebas: ${checks.length} | OK: ${checks.length - failed.length} | Fallidas: ${failed.length}`)
  console.log(`Memoria final: ${memory()}`)
  if (failed.length) {
    for (const f of failed) console.error(`  FALLÓ ${f.name}: ${f.detail}`)
    process.exitCode = 1
  }
}

if (args.includes('--help')) {
  console.log('Opciones: --full | --extreme | --queries=N | --concurrency=N | --sources=N')
} else {
  void main().catch(error => {
    console.error('Error inesperado:', error)
    process.exitCode = 1
  })
}
