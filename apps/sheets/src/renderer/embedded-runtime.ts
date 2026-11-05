import type { UniverRuntime } from './univer-state'

export interface EmbeddedRuntimeHost {
  everyOfficeDesktopRuntimeReady?: (runtime: UniverRuntime | null) => void
  everyOfficeDesktopWorkbookReady?: (sessionId: string) => void
  everyOfficeDesktopSaveStarted?: (mode: string) => void
  everyOfficeDesktopSaveCompleted?: (mode: string, outcome: { ok: boolean; error?: string }) => void
}

/** One completion covers all save phases, including session reinstalls. */
export async function runEmbeddedSave<T extends { ok: boolean; error?: string }>(
  host: EmbeddedRuntimeHost,
  mode: string,
  action: () => Promise<T>,
): Promise<T> {
  host.everyOfficeDesktopSaveStarted?.(mode)
  try {
    const outcome = await action()
    host.everyOfficeDesktopSaveCompleted?.(mode, outcome)
    return outcome
  } catch (error) {
    host.everyOfficeDesktopSaveCompleted?.(mode, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Merge the opt-in host contract into Window.
  interface Window extends EmbeddedRuntimeHost {}
}

/** Optional browser-host lifecycle; regular desktop windows have no callback. */
export function notifyEmbeddedRuntime(
  host: EmbeddedRuntimeHost,
  runtime: UniverRuntime | null,
): void {
  host.everyOfficeDesktopRuntimeReady?.(runtime)
}
