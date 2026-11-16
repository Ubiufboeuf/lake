# Lake

**Lake** es un motor de búsqueda en TypeScript que combina catálogos indexados en memoria con fuentes de datos síncronas o asíncronas. Recupera candidatos mediante un índice invertido, calcula puntuaciones con pesos por campo, admite coincidencias aproximadas y permite recibir resultados progresivamente.

Pensado para búsquedas de productos, inventarios y aplicaciones que necesitan consultar varias fuentes desde una misma interfaz.

[English documentation](./README.en.md)

## Características

- **Índice en memoria:** búsqueda por términos con índice invertido, prefijos y candidatos fuzzy mediante bigramas.
- **Ranking ponderado:** coincidencias exactas, prefijos, tolerancia a errores ortográficos y bonificación por frases.
- **Campos preparados:** normalización y tokens reutilizables calculados durante la indexación.
- **Múltiples fuentes:** datos indexados y proveedores síncronos o asíncronos en una misma consulta.
- **Resultados progresivos:** callbacks cuando están disponibles los datos indexados y cuando responde cada fuente.
- **Top-K:** `limit` devuelve los mejores resultados mediante un heap, sin ordenar toda la lista cuando no hay deduplicación personalizada.
- **Deduplicación configurable:** agrupación y resolución de coincidencias entre proveedores.
- **Reindexación:** sustituye el catálogo indexado sin recrear Lake.
- **Sin dependencias externas para el motor de búsqueda.**

## Inicio rápido

El proyecto está escrito en TypeScript. Para trabajar con el repositorio:

```bash
bun install
```

Este ejemplo importa directamente desde `src` del repositorio. Si lo integrás como paquete, ajustá la ruta de importación según el nombre con el que lo publiques.

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
      origin: 'catalogo',
      items: [
        {
          id: 'p1',
          title: 'Samsung Galaxy S22 128GB',
          category: 'Celulares',
          sku: 'S22-128',
          price: 17990
        },
        {
          id: 'p2',
          title: 'Nintendo Switch OLED',
          category: 'Consolas',
          sku: 'NS-OLED',
          price: 15990
        }
      ]
    }
  ],
  fields: ['title', 'category', 'sku'],
  weights: { id: 0, title: 8, category: 2, sku: 10, price: 0 }
})

if (!lake) throw new Error('No hay fuentes configuradas')

const results = await lake.query('galaxi s22', { limit: 10 })

for (const { item, origin, score } of results) {
  console.log(item.title, origin, score)
}
```

Cada resultado tiene esta estructura:

```ts
{
  item: { id: 'p1', title: 'Samsung Galaxy S22 128GB', /* ... */ },
  origin: 'catalogo',
  score: 800 // Ilustrativo: depende de los pesos y de la consulta
}
```

## Combinar fuentes locales y remotas

Las funciones de `sources` reciben la consulta y devuelven un grupo `{ origin, items }`, directamente o mediante una promesa.

```ts
import { createLake, type Source } from './src'

const api: Source = async query => {
  // Endpoint ilustrativo: reemplazar por el de tu aplicación.
  const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  return {
    origin: 'api',
    items: await response.json() // Array de productos con id y title
  }
}

const local: Source = query => ({
  origin: 'local',
  items: [
    { id: 'local-1', title: `Resultado local para ${query}` }
  ]
})

const lake = createLake({
  indexed: [{ origin: 'inventario', items: [
    { id: '1', title: 'Samsung Galaxy S22' }
  ] }],
  sources: [local, api],
  timeout: 2000
})!

const results = await lake.query('samsung', {
  limit: 20,
  onUpdate(results) {
    // Primero se emiten los indexados; luego, cada fuente que termina.
    console.log('Actualización:', results)
  },
  onError(error, sourceIndex) {
    console.error(`Falló la fuente ${sourceIndex}:`, error)
  }
})

console.log('Resultado final:', results)
```

Las fuentes se consultan concurrentemente. Un fallo o timeout de una fuente no impide recibir los resultados de las demás. `query()` devuelve una promesa con la lista final de resultados disponibles; `onUpdate` recibe el ranking acumulado hasta ese momento.

## Limitar resultados con `limit`

```ts
const top20 = await lake.query('128gb', { limit: 20 })
const todos = await lake.query('128gb')
const ninguno = await lake.query('128gb', { limit: 0 }) // []
```

`limit` es opcional y debe ser un entero seguro no negativo. Los límites inválidos generan `RangeError`. Se aplica también a las actualizaciones progresivas.

Sin deduplicación personalizada, Lake utiliza un **heap Top-K** para evitar ordenar todos los resultados. Sigue evaluando las puntuaciones de los candidatos recuperados por el índice: `limit` no garantiza que una consulta se resuelva en tiempo constante. Con deduplicación personalizada, primero se deduplica y ordena el conjunto completo, porque `resolve()` puede modificar las puntuaciones.

## Pesos y campos

En los siguientes ejemplos, `products` representa el arreglo `Product[]` de tu aplicación.

```ts
const lake = createLake<Product>({
  indexed: [{ origin: 'tienda', items: products }],
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

También podés calcular los pesos según el producto y su origen:

```ts
const lake = createLake<Product>({
  indexed: [{ origin: 'tienda', items: products }],
  weights: (item, origin) => ({
    id: 0,
    title: origin === 'tienda' ? 10 : 5,
    category: item.category === 'Celulares' ? 3 : 1,
    price: 0
  })
})
```

- `fields` determina qué campos se utilizan para **recuperar candidatos del índice local**. Si se omite, Lake detecta los campos de texto y números del catálogo indexado.
- `weights` determina cuánto influye cada campo en el **ranking**. Por defecto, `id` tiene peso `10`, `title` tiene peso `7` y los demás campos tienen peso `1`.
- El ranking examina los campos de texto y numéricos del elemento; `fields` no restringe por sí mismo los campos puntuados.
- Un peso `0` o negativo excluye ese campo del cálculo de puntuación.
- `minScore` filtra los resultados después del ranking (valor predeterminado: `1`).

## Deduplicación

En este ejemplo se reutilizan `products` y la fuente `api` de las secciones anteriores.

Lake puede combinar resultados repetidos de diferentes fuentes. Proporcioná `join` y `resolve`; agregar `key` permite agrupar candidatos de forma más eficiente.

```ts
import { createLake, type ScoredItem } from './src'

const lake = createLake({
  indexed: [{ origin: 'proveedor-a', items: products }],
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

Usá una clave que represente realmente la identidad que `join` compara. Si `resolve` modifica la puntuación, Lake vuelve a ordenar los resultados antes de aplicar `limit`. Si no indicás `key`, la deduplicación conserva los comparadores arbitrarios, aunque puede ser más costosa en colecciones grandes.

## Reindexar el catálogo

```ts
lake.reindex([
  {
    origin: 'inventario',
    items: [
      { id: 'p3', title: 'Samsung Galaxy S23' }
    ]
  }
])

const results = await lake.query('s23', { limit: 5 })
```

`reindex()` reemplaza los documentos indexados, no los agrega a los anteriores. Mantiene las fuentes remotas y la configuración de Lake. Conviene reindexar después de cambios importantes en el catálogo.

## Referencia rápida de la API

### `createLake(options)`

| Opción | Tipo | Predeterminado | Descripción |
| --- | --- | --- | --- |
| `indexed` | `SearchResults[]` | `[]` | Documentos que se indexan en memoria. |
| `sources` | `Source[]` | `[]` | Funciones síncronas o asíncronas de consulta. |
| `fields` | `(keyof T)[]` | Detección automática | Campos para recuperar candidatos indexados. |
| `weights` | Objeto o función | `id: 10, title: 7` | Importancia de los campos en el ranking. |
| `duplicated` | `{ key?, join, resolve }` | Sin deduplicación | Reglas para combinar coincidencias. |
| `minScore` | `number` | `1` | Puntuación mínima para devolver resultados. |
| `timeout` | `number` | `2000` | Tiempo máximo por fuente, en ms; `<= 0` lo desactiva. |

Si no se configura ninguna fuente ni grupo indexado, `createLake()` devuelve `null`.

### `lake.query(query, options?)`

| Opción | Tipo | Descripción |
| --- | --- | --- |
| `limit` | `number` | Máximo de resultados; entero no negativo. |
| `onUpdate` | `(results: ScoredItem[]) => void` | Recibe el ranking parcial actualizado. |
| `onError` | `(error: unknown, sourceIndex: number) => void` | Recibe errores de fuentes individuales. |

Devuelve `Promise<ScoredItem[]>`, con resultados ordenados de mayor a menor puntuación. Cada elemento contiene `{ item, origin, score }`.

### `lake.reindex(data)`

Reemplaza la colección indexada con nuevos grupos `SearchResults[]`.

## Pruebas y rendimiento

```bash
bun pruebas/lake-limit-tests.ts
bun pruebas/lake-stress-suite.ts --full
```

La batería de estrés evalúa corrección, resiliencia, fuentes asíncronas, indexación, ranking, memoria y carga. Los resultados de rendimiento son orientativos: dependen del hardware, la cantidad de coincidencias, los campos indexados y la distribución de los datos. El índice utiliza memoria adicional para acelerar búsquedas repetidas.

## Consideraciones

- El índice es **en memoria**; no incluye persistencia en disco.
- El ranking de fuentes externas se calcula cuando llega cada respuesta; estas fuentes no se integran automáticamente al índice local.
- Las búsquedas con muchos candidatos pueden seguir requiriendo trabajo significativo de puntuación, incluso usando `limit`.
- Si los artículos indexados cambian, volvé a ejecutar `reindex()` para reconstruir las estructuras preparadas.
