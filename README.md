# Electron Midi Player

An electron based MIDI player for practicing vocal parts. The player displays one track at a time and plays it back in the chosen tempo. 

The main idea is to provide a minimal interface to a MIDI file. A single track is shown at a time, under the assumption that someone only practices a single track. The other MIDI parts still play, and have their own volume control in the interface.

## Main Features

- Import MIDI files
- Export .mp3 files
- Multitrack MIDI
- Volume control per track
- Playback tempo control
- Saving/Loading presets for volume, tempo and export
- Display single track as notes on a staff
- Basic sound selection per track
- Pan control per track

## Development

Requires Node.js 22 or newer.

```sh
npm install
node node_modules/electron/install.js   # only if `npm install` skipped the Electron download
npm run fetch-soundfont                 # downloads GeneralUser GS into resources/soundfonts/
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Start the app with hot reload |
| `npm test` | Unit tests (vitest); the MP3 render test is skipped without the SoundFont |
| `npm run smoke` | Build, then drive the app with Playwright: playback, mixer, staff, presets, export |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run make-samples` | Regenerate `samples/satb-chorale.mid` |
| `npm run build:dir` | Package an unpacked app into `dist/win-unpacked/` |
| `npm run build:win` | Build the Windows installer into `dist/` |

### How it works

- **Song model** (`src/renderer/src/model`): MIDI files are parsed with `midi-file` into tracks
  (split per channel), a tempo map and time/key signatures.
- **Playback** (`src/renderer/src/audio`): FluidSynth (WASM, via `js-synthesizer`) runs in an
  AudioWorklet and plays a generated MIDI file with one synth channel per track. Volume, pan and
  instrument are applied live; a small worklet hook (`worklet/mixerHook.js`) keeps them in effect
  after FluidSynth's player resets the synth on play and seek.
- **Staff** (`src/renderer/src/notation`): the selected track is drawn as an SVG staff with notes
  positioned by pitch and time.
- **Export** (`src/main/export`): the same generated MIDI is rendered offline by FluidSynth in a
  Node worker thread and encoded with lamejs.
- **Presets** are auto-saved per MIDI file in the app's user data folder and can be saved to or
  loaded from `.json` files.

### Third-party licenses

- [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) SoundFont by S. Christian
  Collins: see `resources/soundfonts/GeneralUser-GS-LICENSE.txt`.
- FluidSynth (bundled in `js-synthesizer`): LGPL-2.1.
- lamejs (`@breezystack/lamejs`): LGPL-3.0.