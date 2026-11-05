import { AuthScreen } from '../features/auth/AuthScreen'
import { useAuth } from '../hooks/useAuth'
import AuthenticatedApp from './AuthenticatedApp'

function App() {
  const { status } = useAuth()

  if (status === 'authenticated') {
    return <AuthenticatedApp />
  }
  if (status === 'unauthenticated') {
    return <AuthScreen />
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
