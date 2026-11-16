# Lake

**Lake** is a TypeScript search engine that combines in-memory indexed catalogs with synchronous or asynchronous data sources. It retrieves candidates through an inverted index, scores them using field weights, supports fuzzy matching, and can stream progressive result updates through callbacks.

Built for product search, inventory systems, and applications that need to search across multiple providers through a single interface.

[Documentación en español](./README.md)

## Features

- **In-memory index:** term-based retrieval using an inverted index, prefixes, and bigram-based fuzzy candidates.
- **Weighted ranking:** exact and prefix matches, typo tolerance, and phrase bonuses.
- **Prepared fields:** reusable normalized values and tokens computed at indexing time.
- **Multiple sources:** indexed documents plus synchronous or asynchronous providers in the same query.
- **Progressive results:** callbacks when indexed results are ready and as individual sources finish.
- **Top-K:** `limit` selects the best results with a heap, avoiding a full sort when custom deduplication is not enabled.
- **Configurable deduplication:** merge results from multiple providers using your own identity and resolution rules.
- **Reindexing:** replace indexed documents without recreating the search engine.
- **No third-party dependencies required by the search engine itself.**

## Quick start

Lake is written in TypeScript. To work with the repository:

```bash
bun install
```

These examples import directly from the repository's `src` directory. When using Lake as a published package, update the import path to its actual package name.

```ts
import { createLake } from './src'

type Product = {
  id: string
  title: string
  category: string
  sku: string
  price: number
}

const lake = createLake<Product>({
  indexed: [
    {
      origin: 'catalog',
      items: [
        {
          id: 'p1',
          title: 'Samsung Galaxy S22 128GB',
          category: 'Phones',
          sku: 'S22-128',
          price: 17990
        },
        {
          id: 'p2',
          title: 'Nintendo Switch OLED',
          category: 'Consoles',
          sku: 'NS-OLED',
          price: 15990
        }
      ]
    }
  ],
  fields: ['title', 'category', 'sku'],
  weights: { id: 0, title: 8, category: 2, sku: 10, price: 0 }
})

if (!lake) throw new Error('No sources configured')

const results = await lake.query('galaxi s22', { limit: 10 })

for (const { item, origin, score } of results) {
  console.log(item.title, origin, score)
}
```

Each result has this shape:

```ts
{
  item: { id: 'p1', title: 'Samsung Galaxy S22 128GB', /* ... */ },
  origin: 'catalog',
  score: 800 // Illustrative: actual score depends on the query and weights
}
```

## Combining local and remote sources

Each function in `sources` receives the query and returns a `{ origin, items }` group, either immediately or through a promise.

```ts
import { createLake, type Source } from './src'

const api: Source = async query => {
  // Example endpoint: replace with your application's API.
  const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  return {
    origin: 'api',
    items: await response.json() // Array of products containing id and title
  }
}

const local: Source = query => ({
  origin: 'local',
  items: [
    { id: 'local-1', title: `Local result for ${query}` }
  ]
})

const lake = createLake({
  indexed: [{ origin: 'inventory', items: [
    { id: '1', title: 'Samsung Galaxy S22' }
  ] }],
  sources: [local, api],
  timeout: 2000
})!

const results = await lake.query('samsung', {
  limit: 20,
  onUpdate(results) {
    // Indexed results first; then an update for each completed source.
    console.log('Update:', results)
  },
  onError(error, sourceIndex) {
    console.error(`Source ${sourceIndex} failed:`, error)
  }
})

console.log('Final results:', results)
```

Sources run concurrently. A failed or timed-out source does not prevent results from other sources from being returned. `query()` resolves to the final set of available results; `onUpdate` receives the accumulated ranking as it changes.

## Limiting results with `limit`

```ts
const top20 = await lake.query('128gb', { limit: 20 })
const all = await lake.query('128gb')
const none = await lake.query('128gb', { limit: 0 }) // []
```

`limit` is optional and must be a non-negative safe integer. Invalid limits throw `RangeError`. The limit also applies to progressive updates.

Without custom deduplication, Lake uses a **Top-K heap** to avoid sorting the full result set. It still scores candidates retrieved from the index: `limit` does not guarantee constant-time queries. When custom deduplication is configured, Lake deduplicates and sorts the complete set first, because `resolve()` may alter scores.

## Fields and weights

In the following examples, `products` refers to an existing `Product[]` array in your application.

```ts
const lake = createLake<Product>({
  indexed: [{ origin: 'store', items: products }],
  fields: ['title', 'sku', 'category'],
  weights: {
    id: 0,
    title: 10,
    sku: 8,
    category: 3,
    price: 0
  },
  minScore: 10
})
```

You can also compute weights per item and source:

```ts
const lake = createLake<Product>({
  indexed: [{ origin: 'store', items: products }],
  weights: (item, origin) => ({
    id: 0,
    title: origin === 'store' ? 10 : 5,
    category: item.category === 'Phones' ? 3 : 1,
    price: 0
  })
})
```

- `fields` controls which fields are used to **retrieve candidates from the local index**. When omitted, Lake detects string and numeric fields in indexed documents.
- `weights` controls how much each field contributes to the **ranking**. By default, `id` has weight `10`, `title` has weight `7`, and other fields have weight `1`.
- Ranking examines an item's string and numeric fields; `fields` alone does not restrict which fields are scored.
- A zero or negative weight excludes a field from scoring.
- `minScore` filters ranked results (default: `1`).

## Deduplication

This example reuses `products` and the `api` source from the preceding sections.

Lake can combine equivalent results from different sources. Supply `join` and `resolve`; adding `key` allows more efficient candidate grouping.

```ts
import { createLake, type ScoredItem } from './src'

const lake = createLake({
  indexed: [{ origin: 'provider-a', items: products }],
  sources: [api],
  duplicated: {
    key: ({ item }) => item.sku,
    join: (a, b) => a.item.sku === b.item.sku,
    resolve: (a, b): ScoredItem =>
      a.score >= b.score ? a : b
  }
})!

const results = await lake.query('samsung', { limit: 10 })
```

Choose a key that represents the same identity tested by `join`. If `resolve` changes scores, Lake re-sorts results before applying `limit`. Without `key`, arbitrary comparison functions remain supported but may cost more on large datasets.

## Reindexing

```ts
lake.reindex([
  {
    origin: 'inventory',
    items: [
      { id: 'p3', title: 'Samsung Galaxy S23' }
    ]
  }
])

const results = await lake.query('s23', { limit: 5 })
```

`reindex()` **replaces** indexed documents rather than appending to them. Remote sources and Lake settings are preserved. Reindex after significant catalog changes.

## API reference

### `createLake(options)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `indexed` | `SearchResults[]` | `[]` | Documents to index in memory. |
| `sources` | `Source[]` | `[]` | Synchronous or asynchronous source functions. |
| `fields` | `(keyof T)[]` | Automatic detection | Fields used to retrieve indexed candidates. |
| `weights` | Object or function | `id: 10, title: 7` | Field importance for scoring. |
| `duplicated` | `{ key?, join, resolve }` | No deduplication | Rules to merge duplicate results. |
| `minScore` | `number` | `1` | Minimum score required to return a result. |
| `timeout` | `number` | `2000` | Per-source timeout in milliseconds; `<= 0` disables it. |

If both `indexed` and `sources` are empty, `createLake()` returns `null`.

### `lake.query(query, options?)`

| Option | Type | Description |
| --- | --- | --- |
| `limit` | `number` | Maximum number of results; non-negative integer. |
| `onUpdate` | `(results: ScoredItem[]) => void` | Called with updated partial results. |
| `onError` | `(error: unknown, sourceIndex: number) => void` | Called for individual source failures. |

Returns `Promise<ScoredItem[]>`, sorted by descending score. Each entry contains `{ item, origin, score }`.

### `lake.reindex(data)`

Replaces the indexed collection with new `SearchResults[]` groups.

## Tests and performance

```bash
bun pruebas/lake-limit-tests.ts
bun pruebas/lake-stress-suite.ts --full
```

The stress suite covers correctness, resilience, asynchronous sources, indexing, ranking, memory, and load. Benchmark numbers are indicative only: performance depends on hardware, match counts, indexed fields, and data distribution. The index consumes additional memory to speed up repeated searches.

## Notes

- The index is **in memory**; disk persistence is not included.
- External-source results are scored as they arrive; remote data is not automatically inserted into the local index.
- Queries with many matching candidates can still require substantial scoring work, even with `limit`.
- If indexed items change, call `reindex()` to rebuild their prepared search structures.
