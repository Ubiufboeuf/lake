/**
 * Pruebas de cancelación con AbortSignal.
 * Ejecutar: bun pruebas/lake-abort-tests.ts
 */
import { createLake, type SearchResults } from '../src'

function ok (condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function expectAbort (promise: Promise<unknown>, signal: AbortSignal) {
  let rejected = false
  try {
    await promise
  } catch (error) {
    rejected = true
    ok(error === signal.reason, 'La promesa debe rechazar con signal.reason')
  }
  ok(rejected, 'La consulta cancelada debería rechazar')
}

async function main () {
  // Cancelación previa: no se consultan fuentes ni se emiten resultados.
  const before = new AbortController()
  before.abort()
  let called = 0
  const initialLake = createLake({
    sources: [() => { called++; return { origin: 'api', items: [] } }]
  })!
  await expectAbort(initialLake.query('samsung', { signal: before.signal, onUpdate: () => { called++ } }), before.signal)
  ok(called === 0, 'No deberían iniciarse búsquedas abortadas')
  console.log('✓ Señal abortada antes de query()')

  // La primera actualización sigue llegando de inmediato, y puede abortar el resto.
  const duringUpdate = new AbortController()
  let remoteCalled = false
  let updates = 0
  const localLake = createLake({
    indexed: [{ origin: 'cache', items: [{ id: 'p1', title: 'Samsung Galaxy S22' }] }],
    sources: [() => { remoteCalled = true; return { origin: 'api', items: [] } }]
  })!
  await expectAbort(localLake.query('samsung', {
    signal: duringUpdate.signal,
    onUpdate: () => { updates++; duringUpdate.abort() }
  }), duringUpdate.signal)
  ok(updates === 1 && !remoteCalled, 'Abortar en onUpdate debe impedir consultar las fuentes')
  console.log('✓ Abortar desde la primera actualización indexada')

  // Aunque una fuente ignore la señal, Lake deja de esperar e ignora resultados tardíos.
  const pending = new AbortController()
  let finishSource: ((response: SearchResults) => void) | undefined
  const neverCanceled = new Promise<SearchResults>(resolve => { finishSource = resolve })
  const remoteLake = createLake({
    sources: [() => neverCanceled],
    timeout: 0
  })!
  let lateUpdates = 0
  const request = remoteLake.query('samsung', {
    signal: pending.signal,
    onUpdate: () => { lateUpdates++ }
  })
  await Promise.resolve()
  pending.abort()
  await expectAbort(request, pending.signal)
  finishSource?.({ origin: 'api', items: [{ id: 'p2', title: 'Samsung Galaxy A55' }] })
  await Promise.resolve()
  ok(lateUpdates === 1, 'No deberían emitirse actualizaciones después de abortar')
  console.log('✓ Fuente sin soporte de cancelación, timeout desactivado')

  // La señal llega a la fuente y permite cancelar su trabajo interno.
  const forwarded = new AbortController()
  let received: AbortSignal | undefined
  let sourceAborted = false
  const signalLake = createLake({
    sources: [(_query, signal) => {
      received = signal
      return new Promise<SearchResults>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          sourceAborted = true
          reject(signal.reason)
        }, { once: true })
      })
    }]
  })!
  const activeRequest = signalLake.query('samsung', { signal: forwarded.signal })
  await Promise.resolve()
  ok(received === forwarded.signal, 'Las fuentes deben recibir la señal externa')
  forwarded.abort()
  await expectAbort(activeRequest, forwarded.signal)
  ok(sourceAborted, 'La fuente debe recibir el evento abort')
  console.log('✓ Propagación de AbortSignal a fuentes asíncronas')

  // Las llamadas sin signal siguen funcionando, incluyendo los errores por timeout.
  let reported = 0
  const timeoutLake = createLake({
    sources: [() => new Promise<SearchResults>(() => {})],
    timeout: 5
  })!
  const results = await timeoutLake.query('samsung', { onError: () => { reported++ } })
  ok(results.length === 0 && reported === 1, 'El timeout original debe seguir funcionando')
  console.log('✓ Compatibilidad con consultas sin señal y timeout existente')

  console.log('\nLAKE ABORT: TODAS LAS PRUEBAS SUPERADAS')
}

void main().catch(error => { console.error(error); throw error })
