import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// New design system (loaded first)
import './styles/tokens.css'
import './styles/base.css'
import './styles/primitives.css'

// Old styles as fallback until migration complete
import './styles/theme.css'
import './styles/components.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
