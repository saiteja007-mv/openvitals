import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Routes, Route } from 'react-router-dom'
import { api } from './api'
import Today from './screens/Today'
import Exercises from './screens/Exercises'
import Workouts from './screens/Workouts'
import Food from './screens/Food'
import Body from './screens/Body'
import Trends from './screens/Trends'
import SettingsPage from './screens/Settings'
import Login from './screens/Login'

const NAV = [
  { to: '/', label: 'Today', icon: 'today', end: true },
  { to: '/exercises', label: 'Exercises', icon: 'dumbbell', end: false },
  { to: '/workouts', label: 'Workouts', icon: 'list', end: false },
  { to: '/food', label: 'Food', icon: 'plate', end: false },
  { to: '/body', label: 'Body', icon: 'body', end: false },
  { to: '/trends', label: 'Trends', icon: 'chart', end: false },
]

// Monochrome line icons — inherit currentColor so they stay on-brand (no colored emoji).
const ICONS: Record<string, ReactNode> = {
  today: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" /></>,
  dumbbell: <path d="M6.5 9v6M4 10.5v3M17.5 9v6M20 10.5v3M6.5 12h11" />,
  list: <path d="M9 7h9M9 12h9M9 17h9M4.5 7h.01M4.5 12h.01M4.5 17h.01" />,
  plate: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /></>,
  body: <><circle cx="12" cy="7.5" r="3" /><path d="M5.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2" /></>,
  chart: <path d="M4 5v14h16M7.5 15l3-4 3 2.5 4.5-6" />,
}
function NavIcon({ name }: { name: string }) {
  return (
    <svg className="bnitem-ico" viewBox="0 0 24 24" width="22" height="22" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null) // null = still checking

  useEffect(() => {
    api.me().then(() => setAuthed(true)).catch(() => setAuthed(false))
    const onUnauthed = () => setAuthed(false)
    window.addEventListener('consied:unauthorized', onUnauthed)
    return () => window.removeEventListener('consied:unauthorized', onUnauthed)
  }, [])

  if (authed === null) return <div className="center-load"><span className="spin spin-dark" /></div>
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />

  return (
    <div className="app">
      <header className="appbar">
        <NavLink to="/" end className="brand" aria-label="Consied — Today">Consied<span>.</span></NavLink>
        <nav className="topnav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <NavLink to="/settings" className="iconbtn" aria-label="Settings">⚙</NavLink>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/exercises" element={<Exercises />} />
          <Route path="/workouts" element={<Workouts />} />
          <Route path="/food" element={<Food />} />
          <Route path="/body" element={<Body />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <nav className="bottomnav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'bnitem' + (isActive ? ' active' : '')}>
            <NavIcon name={n.icon} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
