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

## Installing

Download the installer for your system from the
[releases page](https://github.com/Florian-Heringa/electron-midi-player/releases):

| System | File |
|---|---|
| Windows | `electron-midi-player-<version>-setup.exe` |
| macOS (Apple Silicon) | `electron-midi-player-<version>-mac-arm64.dmg` |
| macOS (Intel) | `electron-midi-player-<version>-mac-x64.dmg` |
| Linux | `…-linux-x86_64.AppImage` (any distribution) or `…-linux-amd64.deb` (Debian, Ubuntu) |

The installers are not signed yet, so the system asks before running the app the first time:

- **Windows:** SmartScreen says "Windows protected your PC". Click **More info**, then **Run anyway**.
- **macOS:** the app is blocked on first open. Open **System Settings > Privacy & Security**,
  scroll down and click **Open Anyway** next to Electron MIDI Player. If macOS says the app
  is damaged, run `xattr -cr "/Applications/Electron MIDI Player.app"` in Terminal and open
  it again.
- **Linux:** make the AppImage executable (`chmod +x`, or Properties > Permissions), then run it.

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
| `npm run build:dir` | Package an unpacked app for this system into `dist/` |
| `npm run build:win` / `build:mac` / `build:linux` | Build that system's installers into `dist/` (each only builds on its own system) |

### Releasing

Installers are built by GitHub Actions (`.github/workflows/release.yml`) on Windows, macOS and
Linux:

1. Set the new `version` in `package.json` and commit it.
2. Tag the commit with that version and push: `git tag v0.2.0 && git push origin main v0.2.0`.
3. The workflow runs the checks, builds the installers and attaches them to a **draft** release.
   Review it on GitHub and publish it.

To test the installers without releasing, run the workflow by hand (Actions > Release > Run
workflow); the installers are then downloadable from the run's artifacts.

The app icon comes from `_resources/MidiPlayerLogo.png` (square, 1024px).

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