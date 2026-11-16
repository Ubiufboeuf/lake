import type { Source } from '../src'
import { localMocks, remoteMocks } from './mocks'

export const local: Source = () => ({
  origin: 'local',
  items: localMocks
})

export const remote: Source = async () => ({
  origin: 'remote',
  items: remoteMocks
})
