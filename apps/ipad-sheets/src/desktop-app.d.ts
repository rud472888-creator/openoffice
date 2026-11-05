declare module '@ipad/desktop-app' {
  import type { ComponentType } from 'react'
  export const App: ComponentType<{ queuedWorkbookAtBoot?: boolean }>
}
