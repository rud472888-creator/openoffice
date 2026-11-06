# DeckCraft in EveryOffice

The iPad app ships the DeckCraft web editor, engine and PPTX reader/writer from [storytold/deckcraft](https://github.com/storytold/deckcraft/tree/9a95c3a63942377b1a4c8d79844a94a54ffac370). The bundled runtime comes from that source revision. Its upstream workspace version is 0.15.0.

The local patch acknowledges when the incoming presentation is open and lets the host request Save on the active DeckCraft document. The host checks the document identity before requesting a write. Protected presentations open in reading view. The font patch embeds NanumGothic for Korean slides and Carlito for Latin presentation text. The font source is [craft-fonts at the pinned revision](https://github.com/storytold/craft-fonts/tree/37827adc41fd165f9a9234ac40f94dbad353aa69).

Normal app builds verify the SHA-256 of the checked-in runtime archive and unpack it into the offline editor resources. To rebuild the archive, use Rust 1.95.0, the wasm32-unknown-unknown target and wasm-bindgen CLI 0.2.129, then run `vendor/deckcraft/build.sh`. After changing a dependency or font, refresh its notices and run the editor smoke test.
