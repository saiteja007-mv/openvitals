import { useEffect, useState } from 'react'
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
  { to: '/', label: 'Today', icon: '◉', end: true },
  { to: '/exercises', label: 'Exercises', icon: '🏋', end: false },
  { to: '/workouts', label: 'Workouts', icon: '✓', end: false },
  { to: '/food', label: 'Food', icon: '🍽', end: false },
  { to: '/body', label: 'Body', icon: '⚖', end: false },
  { to: '/trends', label: 'Trends', icon: '📈', end: false },
]

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
        <div className="brand">Consied<span>.</span></div>
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
            <span className="bnitem-ico">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
