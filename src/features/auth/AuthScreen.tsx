import { useState } from 'react'
import { ThemeToggle } from '../../components/common/ThemeToggle'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'
import { ForgotPasswordForm } from './ForgotPasswordForm'
import { ResetPasswordForm } from './ResetPasswordForm'
import './auth.css'

type AuthView = 'login' | 'register' | 'forgot' | 'reset'

type AuthScreenProps = {
  initialMode?: 'login' | 'register'
  onBack?: () => void
}

const initialViewFor = (mode: 'login' | 'register'): AuthView => {
  const { pathname, search } = window.location
  if (pathname.includes('reset-password') || new URLSearchParams(search).has('token')) return 'reset'
  return mode
}

export const AuthScreen = ({ initialMode = 'login', onBack }: AuthScreenProps = {}) => {
  const [view, setView] = useState<AuthView>(() => initialViewFor(initialMode))

  const goLogin = () => {
    // Leave the reset URL so a reload does not reopen the reset view.
    if (view === 'reset') window.history.replaceState(null, '', '/')
    setView('login')
  }

  return (
    <main className="auth-screen">
      <div className="auth-theme-toggle">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        {onBack && (
          <button type="button" className="auth-link" onClick={onBack}>← Back</button>
        )}
        <h1 className="auth-brand">RV Trip Planner</h1>
        {view === 'login' && (
          <LoginForm onForgotPassword={() => setView('forgot')} onRegister={() => setView('register')} />
        )}
        {view === 'register' && <RegisterForm onLogin={goLogin} />}
        {view === 'forgot' && <ForgotPasswordForm onLogin={goLogin} />}
        {view === 'reset' && <ResetPasswordForm onLogin={goLogin} />}
      </div>
    </main>
  )
}
