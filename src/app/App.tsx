import { useState } from 'react'
import { AuthScreen } from '../features/auth/AuthScreen'
import { LandingPage } from '../features/landing/LandingPage'
import { useAuth } from '../hooks/useAuth'
import AuthenticatedApp from './AuthenticatedApp'

type AuthMode = 'login' | 'register'

// Read once at mount: RegisterForm strips `invite` from the URL after consuming it.
const initialAuthMode = (): AuthMode | null => {
  const { pathname, search } = window.location
  const params = new URLSearchParams(search)
  if (params.has('invite')) return 'register'
  if (params.has('token') || pathname.includes('reset-password')) return 'login'
  return null
}

function App() {
  const { status } = useAuth()
  const [authMode, setAuthMode] = useState<AuthMode | null>(initialAuthMode)

  if (status === 'authenticated') {
    return <AuthenticatedApp />
  }
  if (status === 'unauthenticated') {
    if (authMode === null) {
      return <LandingPage onSignUp={() => setAuthMode('register')} onLogIn={() => setAuthMode('login')} />
    }
    return <AuthScreen initialMode={authMode} onBack={() => setAuthMode(null)} />
  }
  return (
    <div className="app-shell">
      <p role="status">
        {status === 'databaseWaking'
          ? 'The database is waking up. This can take a few seconds...'
          : 'Checking your session...'}
      </p>
    </div>
  )
}

export default App
