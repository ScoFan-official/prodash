import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Design system (tokens → base → primitives), then business component styles
import './styles/tokens.css'
import './styles/base.css'
import './styles/primitives.css'
import './styles/components.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
