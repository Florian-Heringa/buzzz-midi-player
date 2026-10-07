import { describe, expect, it } from 'vitest'
import { MAX_RECENT_FILES, parseRecent, withoutRecent, withRecent, type RecentEntry } from '../recentFiles'

describe('recent files', () => {
  it('puts the latest file first without duplicates', () => {
    let list: RecentEntry[] = []
    list = withRecent(list, 'C:/music/a.mid', 1)
    list = withRecent(list, 'C:/music/b.mid', 2)
    list = withRecent(list, 'C:/music/a.mid', 3)
    expect(list).toEqual([
      { path: 'C:/music/a.mid', openedAt: 3 },
      { path: 'C:/music/b.mid', openedAt: 2 }
    ])
  })

  it('keeps at most the maximum number of files', () => {
    let list: RecentEntry[] = []
    for (let i = 0; i < MAX_RECENT_FILES + 5; i++) list = withRecent(list, `C:/m/${i}.mid`, i)
    expect(list).toHaveLength(MAX_RECENT_FILES)
    expect(list[0].path).toBe(`C:/m/${MAX_RECENT_FILES + 4}.mid`)
  })

  it('removes a file', () => {
    const list = withRecent(withRecent([], 'C:/a.mid', 1), 'C:/b.mid', 2)
    expect(withoutRecent(list, 'C:/a.mid').map((e) => e.path)).toEqual(['C:/b.mid'])
  })

  it('ignores malformed saved data', () => {
    expect(parseRecent('nope')).toEqual([])
    expect(parseRecent([{ path: 'C:/a.mid', openedAt: 1 }, { path: 5 }, null])).toEqual([
      { path: 'C:/a.mid', openedAt: 1 }
    ])
  })
})
