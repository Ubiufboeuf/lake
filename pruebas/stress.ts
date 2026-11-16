import { rank } from '../src/rank'
import { buildIndex } from '../src/search-index'
import { generateStressMocks } from './stress-mocks'

const { sources } = generateStressMocks(100_000, 5)

// Estas fuentes de prueba ignoran la consulta.
const data = await Promise.all(
  sources.map(source => source(''))
)

console.time('Indexación')

const index = buildIndex(data, [
  'title',
  'brand',
  'category',
  'description'
])

console.timeEnd('Indexación')

console.log({
  documents: index.size,
  vocabulary: index.vocabularySize
})

console.time('Búsqueda')

const candidates = index.search('samsung s22')
const results = rank('samsung s22', candidates, undefined)

console.timeEnd('Búsqueda')

console.log('Resultados:', results.length)
