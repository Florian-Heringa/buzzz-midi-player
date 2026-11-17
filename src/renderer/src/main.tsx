import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './themes.css'
import { initTheme } from './ui/theme'

async function start(): Promise<void> {
  // The Electron preload provides window.api; as a web page, the browser implementation does.
  if (!window.api) window.api = (await import('./web/webApi')).createWebApi()
  initTheme()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void start()
