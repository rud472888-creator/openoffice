# Supplemental license texts

Some npm distributions omit their upstream license file. These copies are used by the iPad notice generator; the original text is kept unchanged.

- `saxes-6.0.0-LICENSE.txt`: `lddubeau/saxes`, tag `v6.0.0`, commit `211fa0ebec9b628affc09219199639887174bfc3`, [LICENSE](https://github.com/lddubeau/saxes/blob/211fa0ebec9b628affc09219199639887174bfc3/LICENSE).
- `nodable-MIT.txt`: the previously recorded upstream MIT license for `@nodable/entities`.

The HWP embed SDK belongs to the same MIT-licensed rhwp repository as the pinned engine; its license is included from `vendor/rhwp-core/LICENSE`.

## Additional bundled browser dependencies

`sources.json` records the upstream repository, commit, path, URL and SHA-256 for each unchanged supplemental text. Package versions are pinned in the fallback map; updates require a new source review.

- `unicount` 1.1.0: ISC section of upstream README at tag `v1.1.0` / npm `gitHead` `79d4e85321209b72459cc0ff9d26d51f544039e9`; exactly matches the installed release README.
- `ot-text-unicode` 4.0.0: MIT section of README at npm `gitHead` `bdcfc545c1a2eda48fe5968ae2ce80cf743b9c08`, in **ottypes/text-unicode** (npm repository metadata points to the older text repository). Exactly matches the installed README. npm metadata declares ISC while the README explicitly grants MIT terms; the notice preserves and identifies that discrepancy. The unusual singular “condition” and omitted MIT condition line are unchanged upstream wording.
- `franc-min` 6.2.0: repository-root `license` at the `franc-min@6.2.0` tag / npm `gitHead` `3f9f0b51a96c5df32a407dad865a3011ac0fa2d1`.
- `@fluentui/react-icons` 2.0.333: repository-root `LICENSE` at npm `gitHead` `c6456e145a239c390deac0a84cfdbfadcef2b504`.
- `ot-json1` 1.0.2: ISC section of its published README, verified byte-for-byte (ignoring only surrounding whitespace) against upstream tag `v1.0.1` / commit `3de511690bcccd41d845eb10a2f151704f83f0fb`. The 1.0.2 npm publish commit `4ef85ce5e0ff9e9b9969da13303913b11fec86cf` is unavailable from either the named repository or its `ottypes/json1` relocation; this is **not** claimed as a 1.0.2 tag checkout.
- `fastdom` 1.0.12: MIT section of its published README, verified against upstream tag `v1.0.9` / commit `ec00811f2c77d9a1cede4054380e382d8226d8e0`. The 1.0.12 npm publish commit `a7b9044d58952b970c8b918dcf0e7c8824ba0ff5` is unavailable from upstream; no 1.0.12 tag was advertised.
- `react-remove-scroll-bar` 2.3.8: upstream repository's full `LICENSE` at observed commit `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff`, copyright 2025 Anton Korzunov. The published release README and npm metadata both declare MIT, but omit full terms. Its npm publish commit `b3b1287aad81def2e2ae707274b74531b61ddbaf` is unavailable, and this license copy is **not** claimed to be from an exact 2.3.8 checkout.

`@univerjs/protocol` declares Apache-2.0 but omits a license file; its existing fallback includes DreamNum's copyright and the authoritative Apache text shipped by sibling `@univerjs/core`. `numfmt/lib/package.json` is only a module-type marker, so the scan continues to the actual `numfmt` metadata and its bundled LICENSE.

The draw.io section is generated separately from the verified pinned release and complete inventory, including all restriction/license files, excluded release patterns and exact approved cut offsets. Standard MIT, Zlib and BSD terms are read as plain string literals from the existing desktop notice generator; its code is never evaluated. Apache and OFL full texts are read from their existing authoritative repository files. No license grants or copyright holders are inferred.
