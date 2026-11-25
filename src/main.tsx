import './services/version/bootstrap'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/nunito-sans/opsz.css'
import './index.css'
import App from './app/App.tsx'
import { VehicleSettingsProvider } from './hooks/VehicleSettingsProvider'
import { ThemeProvider } from './hooks/ThemeProvider'
import { AuthProvider } from './hooks/AuthProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <VehicleSettingsProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </VehicleSettingsProvider>
    </ThemeProvider>
  </StrictMode>,
)
