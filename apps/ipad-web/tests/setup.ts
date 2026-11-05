import { TextEncoder as NodeTextEncoder } from 'node:util'

// jsdom's typed-array realm differs from Node's TextEncoder output. JSZip uses
// instanceof checks, so encoders must return the active test realm's byte view.
if (typeof window !== 'undefined') {
  if (!Range.prototype.getClientRects)
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  if (!Range.prototype.getBoundingClientRect)
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
  Object.defineProperty(globalThis, 'TextEncoder', {
    configurable: true,
    value: class extends NodeTextEncoder {
      override encode(input = '') {
        return Uint8Array.from(super.encode(input))
      }
    },
  })
}
