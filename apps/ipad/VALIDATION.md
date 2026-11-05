# Validation evidence

Checked on Linux on 2026-11-05, before the initial GitHub branch push.

- DOCX adapter: 20 tests passed.
- XLSX adapter: 12 tests passed.
- PPTX adapter: 17 tests passed.
- All three adapter typechecks and production bundles passed.
- Targeted ESLint passed for the new adapters and browser verification scripts.
- Chromium integration check passed for all three formats: open a local fixture/template through the native message contract, edit Korean text, save, inspect the output archive, reopen the saved document, check 1024px and 390px layouts. No page exceptions or external network requests occurred.
- Native localization catalog: 62 keys, each with 21 locales.
- XcodeGen and Actions YAML parse; shell scripts pass syntax checks.
- App icon: opaque 1024 × 1024 PNG. Bundled dependency notices include 11 packages.

Chromium is not an iPad simulator and does not validate SwiftUI, WKWebView, PDFKit, file-provider access, device memory or Apple Pencil behavior. The browser test serves the exact offline HTML over a loopback HTTP server because this machine's Chromium policy blocks file URLs. The native app uses WKWebView file loading; its actual runtime checks are the macOS unit/UI tests.

The native target includes 9 unit tests and 2 UI tests, including a WKWebView DOCX edit/save/relaunch scenario. These have not run locally: Linux has no Xcode. `.github/workflows/ipad.yml` supplies the remote macOS/iPad simulator path. A workflow existing in Git does not establish its execution or success; check the Actions result before treating the native app as verified.

Local browser screenshots and the machine-readable result are generated in `apps/ipad/build/browser-smoke/` (ignored). Reproduce with `node apps/ipad/scripts/browser-smoke.mjs` after building all web resources; set `CHROMIUM_PATH` if Chromium is installed elsewhere.
