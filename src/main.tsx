import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { VehicleSettingsProvider } from './hooks/VehicleSettingsProvider'
import { ThemeProvider } from './hooks/ThemeProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <VehicleSettingsProvider>
        <App />
      </VehicleSettingsProvider>
    </ThemeProvider>
  </StrictMode>,
)
