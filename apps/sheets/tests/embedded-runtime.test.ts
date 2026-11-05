import { describe, expect, it } from 'vitest'
import { notifyEmbeddedRuntime, runEmbeddedSave } from '../src/renderer/embedded-runtime'
import type { UniverRuntime } from '../src/renderer/univer-state'

describe('embedded renderer lifecycle', () => {
  it('leaves ordinary desktop hosts without a callback unchanged', () => {
    expect(() => notifyEmbeddedRuntime({}, {} as UniverRuntime)).not.toThrow()
    expect(() => notifyEmbeddedRuntime({}, null)).not.toThrow()
  })

  it('delivers the actual runtime identity and its disposal to the opt-in host', () => {
    const received: Array<UniverRuntime | null> = []
    const host = {
      everyOfficeDesktopRuntimeReady: (runtime: UniverRuntime | null) => received.push(runtime),
    }
    const runtime = { univerAPI: {} } as UniverRuntime
    notifyEmbeddedRuntime(host, runtime)
    notifyEmbeddedRuntime(host, null)
    expect(received).toEqual([runtime, null])
    expect(received[0]).toBe(runtime)
  })

  it('reports one completion after every phase of a save has settled', async () => {
    const events: string[] = []
    const host = {
      everyOfficeDesktopSaveStarted: () => {
        events.push('started')
      },
      everyOfficeDesktopSaveCompleted: (_mode: string, outcome: { ok: boolean }) => {
        events.push(outcome.ok ? 'completed' : 'failed')
      },
    }
    let release!: () => void
    const phase = new Promise<void>((resolve) => {
      release = resolve
    })
    const result = runEmbeddedSave(host, 'save', async () => {
      events.push('phase-one')
      await phase
      events.push('phase-two')
      return { ok: true }
    })
    await Promise.resolve()
    expect(events).toEqual(['started', 'phase-one'])
    release()
    await result
    expect(events).toEqual(['started', 'phase-one', 'phase-two', 'completed'])
  })

  it('preserves successful results without a host and reports failures without swallowing them', async () => {
    const outcome = { ok: true }
    expect(await runEmbeddedSave({}, 'save', async () => outcome)).toBe(outcome)
    const reported: unknown[] = []
    const error = new Error('disk failure')
    await expect(
      runEmbeddedSave(
        { everyOfficeDesktopSaveCompleted: (_mode, value) => reported.push(value) },
        'save',
        async () => {
          throw error
        },
      ),
    ).rejects.toBe(error)
    expect(reported).toEqual([{ ok: false, error: 'disk failure' }])
  })
})
