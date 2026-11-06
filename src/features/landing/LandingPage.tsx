import { ThemeToggle } from '../../components/common/ThemeToggle'
import { InviteRequestForm } from './InviteRequestForm'
import './LandingPage.css'

type LandingPageProps = {
  onSignUp: () => void
  onLogIn: () => void
}

const FEATURES = [
  { icon: '🗺️', title: 'Route planning on the map', text: 'Add stops and see your route drawn on an open-source map.' },
  { icon: '🌤️', title: 'Weather forecasts per stop', text: 'Daily forecasts for every stop on your arrival and departure dates.' },
  { icon: '⛽', title: 'Fuel cost estimates', text: 'Estimate fuel cost from your vehicle MPG and gas prices.' },
  { icon: '🏕️', title: 'Campsite search', text: 'Look for campsites near the stops on your trip.' },
  { icon: '📄', title: 'PDF / calendar export', text: 'Print your itinerary as a PDF or export it to your calendar.' },
  { icon: '☁️', title: 'Saved to your account', text: 'Your trips are stored with your account, so they follow you across devices.' },
]

const STEPS = [
  { title: 'Request an invite', text: 'Tell us who you are and we will email you an invite code.' },
  { title: 'Create your account', text: 'Sign up with your invite code and a password.' },
  { title: 'Plan your trip', text: 'Add stops, dates and vehicle details, then check the route, weather and fuel cost.' },
]

export const LandingPage = ({ onSignUp, onLogIn }: LandingPageProps) => (
  <div className="landing">
    <header className="landing-header">
      <span className="landing-brand">🚐 RV Trip Planner</span>
      <div className="landing-header-actions">
        <ThemeToggle />
        <button type="button" className="landing-btn landing-btn-secondary" onClick={onLogIn}>Log in</button>
      </div>
    </header>
    <main className="landing-main">
      <section className="landing-hero" aria-labelledby="landing-hero-title">
        <h1 id="landing-hero-title">Plan your next RV road trip with confidence</h1>
        <p className="landing-subhead">
          Map your route, check the weather at every stop and estimate fuel costs, all in one place.
        </p>
        <div className="landing-cta">
          <button type="button" className="landing-btn landing-btn-primary" onClick={onSignUp}>
            Sign up with invite code
          </button>
          <a className="landing-btn landing-btn-secondary" href="#request-invite">Request an invite</a>
        </div>
      </section>
      <section className="landing-section" aria-labelledby="landing-features-title">
        <h2 id="landing-features-title">Everything for the road ahead</h2>
        <ul className="landing-features">
          {FEATURES.map((f) => (
            <li key={f.title} className="landing-feature">
              <span className="landing-feature-icon" aria-hidden="true">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="landing-section" aria-labelledby="landing-how-title">
        <h2 id="landing-how-title">How it works</h2>
        <ol className="landing-steps">
          {STEPS.map((s) => (
            <li key={s.title} className="landing-step">
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section id="request-invite" className="landing-section landing-request" aria-labelledby="landing-request-title">
        <h2 id="landing-request-title">Request an invite</h2>
        <p className="landing-muted">Access is by invitation. Leave your details and we will be in touch.</p>
        <div className="landing-request-card">
          <InviteRequestForm />
        </div>
      </section>
    </main>
    <footer className="landing-footer">
      <p>RV Trip Planner. Maps by OpenStreetMap contributors.</p>
    </footer>
  </div>
)
