import { describe, expect, it } from 'vitest'
import { checkForUpdate, isNewer, parseVersion, RELEASES_PAGE } from '../updates'

const answer = (status: number, body?: unknown) => async (): Promise<Response> =>
  new Response(body === undefined ? null : JSON.stringify(body), { status })

describe('versions', () => {
  it('reads tags with or without a v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('0.10.0-beta')).toEqual([0, 10, 0])
    expect(parseVersion('latest')).toBeNull()
  })

  it('compares numerically, part by part', () => {
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('v1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('v0.0.9', '0.1.0')).toBe(false)
    expect(isNewer('nonsense', '0.1.0')).toBe(false)
  })
})

describe('checkForUpdate', () => {
  it('reports a newer release with its page', async () => {
    const result = await checkForUpdate('0.1.0', answer(200, { tag_name: 'v0.2.0', html_url: `${RELEASES_PAGE}/tag/v0.2.0` }))
    expect(result).toEqual({ status: 'available', version: '0.2.0', url: `${RELEASES_PAGE}/tag/v0.2.0` })
  })

  it('is current with the same or an older release, or none published yet', async () => {
    expect(await checkForUpdate('0.2.0', answer(200, { tag_name: 'v0.2.0' }))).toEqual({ status: 'current', version: '0.2.0' })
    expect(await checkForUpdate('0.2.0', answer(200, { tag_name: 'v0.1.0' }))).toMatchObject({ status: 'current' })
    expect(await checkForUpdate('0.1.0', answer(404))).toMatchObject({ status: 'current' })
  })

  it('never links outside the project releases', async () => {
    const result = await checkForUpdate('0.1.0', answer(200, { tag_name: 'v0.2.0', html_url: 'https://evil.example/v0.2.0' }))
    expect(result).toMatchObject({ url: `${RELEASES_PAGE}/tag/v0.2.0` })
  })

  it('fails gracefully', async () => {
    expect(await checkForUpdate('0.1.0', answer(500))).toMatchObject({ status: 'failed' })
    expect(await checkForUpdate('0.1.0', answer(200, { name: 'no tag' }))).toMatchObject({ status: 'failed' })
    const offline = async (): Promise<Response> => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    }
    expect(await checkForUpdate('0.1.0', offline)).toMatchObject({ status: 'failed', message: expect.stringContaining('reached') })
  })
})
