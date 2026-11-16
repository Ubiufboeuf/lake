import { createLake } from '../src'
import { localMocks, remoteMocks } from './mocks'

const lake = createLake({
  indexed: [
    { origin: 'local', items: localMocks },
    { origin: 'remote', items: remoteMocks }
  ],

  duplicated: {
    join: (a, b) => a.item.id === b.item.id,
    resolve: (a, b) => a.score >= b.score ? a : b
  },

  timeout: 1500
})

const results = await lake?.query('s22', {
  onUpdate (results) {
    console.log('Actualización:', results)
  },
  onError (error, sourceIndex) {
    console.error(`Fuente ${sourceIndex}:`, error)
  }
})

console.log(results)
