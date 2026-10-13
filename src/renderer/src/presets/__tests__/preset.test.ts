import { describe, expect, it } from 'vitest'
import { defaultMix } from '../../audio/mixer'
import { parseSong, type Song } from '../../model/song'
import { buildMidi, note, trackName } from '../../model/__tests__/midiBuilder'
import { applyPreset, createPreset, matchTracks, parsePreset, type PlayerSettings } from '../preset'

function songWith(names: string[]): Song {
  return parseSong(
    buildMidi(names.map((name, i) => [trackName(name), ...note(0, 60 + i, 480, i)])),
    'song.mid'
  )
}

const settingsFor = (song: Song): PlayerSettings => ({
  mixes: song.tracks.map((t, i) => ({ ...defaultMix(t), volume: 50 + i, pan: i - 1 })),
  tempoFactor: 0.75,
  selectedTrackId: 1,
  exportSettings: { bitrate: 128, mode: 'practice-muted', range: 'loop', repeats: 3 },
  trackLabels: song.tracks.map((_, i) => (i === 0 ? 'Me' : '')),
  keyChoice: { accidentals: 'flats', mode: 'minor' },
  baseBpm: 96,
  // The test songs are one bar long.
  loop: { enabled: true, startBar: 1, endBar: 1 }
})

describe('presets', () => {
  it('round-trips settings through JSON', () => {
    const song = songWith(['Soprano', 'Alto', 'Tenor'])
    const settings = settingsFor(song)
    const preset = createPreset(song, settings, { name: 'song.mid', hash: 'abc' })
    const restored = applyPreset(
      song,
      parsePreset(JSON.parse(JSON.stringify(preset))),
      song.tracks.map(defaultMix)
    )
    expect(restored).toEqual(settings)
  })

  it('matches tracks by name when tracks are reordered', () => {
    const saved = createPreset(songWith(['Soprano', 'Alto']), settingsFor(songWith(['Soprano', 'Alto'])))
    const reordered = songWith(['Alto', 'Soprano'])
    const restored = applyPreset(reordered, saved, reordered.tracks.map(defaultMix))
    expect(restored.mixes.map((m) => m.volume)).toEqual([51, 50])
    expect(restored.selectedTrackId).toBe(0) // Alto moved to index 0
  })

  it('falls back to position for renamed tracks and defaults for new ones', () => {
    const saved = createPreset(songWith(['Soprano', 'Alto']), settingsFor(songWith(['Soprano', 'Alto'])))
    const edited = songWith(['Soprano', 'Alto 1', 'Tenor'])
    const matched = matchTracks(edited, saved.tracks)
    expect(matched.map((m) => m?.name)).toEqual(['Soprano', 'Alto', undefined])
    const restored = applyPreset(edited, saved, edited.tracks.map(defaultMix))
    expect(restored.mixes.map((m) => m.volume)).toEqual([50, 51, 100])
  })

  it('keeps custom track names with the matched track', () => {
    const saved = createPreset(songWith(['Soprano', 'Alto']), settingsFor(songWith(['Soprano', 'Alto'])))
    expect(saved.tracks[0].label).toBe('Me')
    expect(saved.tracks[1]).not.toHaveProperty('label')
    const reordered = songWith(['Alto', 'Soprano'])
    expect(applyPreset(reordered, saved, reordered.tracks.map(defaultMix)).trackLabels).toEqual(['', 'Me'])
  })

  it('keeps a saved loop within the song', () => {
    const song = songWith(['Soprano'])
    const saved = { ...createPreset(song, settingsFor(song)), loop: { enabled: true, startBar: 4, endBar: 9 } }
    expect(applyPreset(song, saved, song.tracks.map(defaultMix)).loop).toEqual({ enabled: true, startBar: 1, endBar: 1 })
    const old = { ...createPreset(song, settingsFor(song)), loop: undefined }
    expect(applyPreset(song, old, song.tracks.map(defaultMix)).loop).toEqual({ enabled: false, startBar: 1, endBar: 1 })
  })

  it('pairs repeated track names in order', () => {
    const song = songWith(['Voice', 'Voice'])
    const saved = createPreset(song, settingsFor(song))
    expect(matchTracks(song, saved.tracks).map((m) => m?.index)).toEqual([0, 1])
  })

  it('rejects invalid files and clamps out-of-range values', () => {
    expect(() => parsePreset('nope')).toThrow(/JSON object/)
    expect(() => parsePreset({ version: 99, tracks: [] })).toThrow(/version/)
    expect(() => parsePreset({ version: 1, tracks: [{}] })).toThrow(/track 1/)

    const preset = parsePreset({
      version: 1,
      tempoFactor: 9,
      tracks: [{ name: 'A', volume: 300, pan: -100, program: 3.6, muted: 'yes' }],
      export: { bitrate: 100, mode: 'other' }
    })
    expect(preset.tempoFactor).toBe(2)
    expect(preset.tracks[0]).toEqual({
      index: 0,
      name: 'A',
      volume: 127,
      pan: -64,
      program: 4,
      muted: false,
      solo: false
    })
    expect(preset.export).toEqual({ bitrate: 192, mode: 'mix', range: 'song', repeats: 1 })
    expect(preset.loop).toBeUndefined()
    expect(parsePreset({ version: 1, tracks: [], export: { repeats: 99 } }).export.repeats).toBe(20)
    expect(preset.baseBpm).toBeUndefined()
    expect(parsePreset({ version: 1, tracks: [], baseBpm: 1000 }).baseBpm).toBe(400)
    expect(parsePreset({ version: 1, tracks: [], baseBpm: '96' }).baseBpm).toBeUndefined()
    expect(preset.selectedTrack).toBeNull()
    const labelled = parsePreset({
      version: 1,
      tracks: [{ name: 'A', label: '  ' + 'x'.repeat(80) }, { name: 'B', label: '   ' }, { name: 'C', label: 5 }]
    })
    expect(labelled.tracks.map((t) => t.label?.length)).toEqual([60, undefined, undefined])
    expect(parsePreset({ version: 1, tracks: [], key: { accidentals: 'flats', mode: 'minor' } }).key).toEqual({
      accidentals: 'flats',
      mode: 'minor'
    })
    expect(parsePreset({ version: 1, tracks: [], key: { accidentals: 'both', mode: 'minor' } }).key).toBeUndefined()
    expect(parsePreset({ version: 1, tracks: [], key: { accidentals: 'sharps', mode: 'major', source: 'estimate' } }).key).toEqual({
      accidentals: 'sharps',
      mode: 'major',
      source: 'estimate'
    })
  })
})
