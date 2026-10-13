// Draws the app icon: the logo on a rounded-square tile, as macOS (and most Linux docks) show
// app icons. Run with Electron (it uses Chromium's canvas): npm run make-icon
// Reads resources/icons/logo.png and writes resources/icons/icon.png (1024 × 1024).
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'

const LOGO = 'resources/icons/logo.png'
const OUT = 'resources/icons/icon.png'

// Drawn in the page. Sizes follow Apple's icon grid: an 824px tile with a 100px margin
// (room for its shadow) and about 22.5% corner radius.
const draw = (logoBase64) => `(async () => {
  const size = 1024, inset = 100, tile = 824, radius = 185
  const bytes = Uint8Array.from(atob('${logoBase64}'), (c) => c.charCodeAt(0))
  const logo = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const tilePath = () => {
    ctx.beginPath()
    ctx.roundRect(inset, inset, tile, tile, radius)
  }

  // Tile: the Modern theme's accent gradient, with a soft drop shadow.
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
  ctx.shadowBlur = 28
  ctx.shadowOffsetY = 12
  const fill = ctx.createLinearGradient(inset, inset, inset + tile, inset + tile)
  fill.addColorStop(0, '#6a4cff')
  fill.addColorStop(1, '#0b7f9c')
  tilePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()

  // A light sheen over the top half, then a thin edge, so the tile reads well on dark docks.
  ctx.save()
  tilePath()
  ctx.clip()
  const sheen = ctx.createLinearGradient(0, inset, 0, inset + tile * 0.6)
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.22)')
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(inset, inset, tile, tile)
  ctx.restore()
  tilePath()
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
  ctx.stroke()

  // The logo, centred with some room around it.
  const art = tile * 0.8
  ctx.drawImage(logo, inset + (tile - art) / 2, inset + (tile - art) / 2, art, art)

  const png = await canvas.convertToBlob({ type: 'image/png' })
  const out = new Uint8Array(await png.arrayBuffer())
  let binary = ''
  for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000))
  return btoa(binary)
})()`

app.whenReady().then(async () => {
  try {
    const window = new BrowserWindow({ show: false })
    await window.loadURL('about:blank')
    const icon = await window.webContents.executeJavaScript(draw(readFileSync(LOGO).toString('base64')))
    writeFileSync(OUT, Buffer.from(icon, 'base64'))
    console.log(`Wrote ${OUT}`)
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  }
  app.quit()
})
