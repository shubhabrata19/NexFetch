import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light'

const root = document.getElementById('root')
if (!root) throw new Error('The renderer root element is missing.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
