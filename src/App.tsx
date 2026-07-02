import { NavLink, Routes, Route } from 'react-router-dom'
import Today from './screens/Today'
import Exercises from './screens/Exercises'
import Workouts from './screens/Workouts'
import Meals from './screens/Meals'
import Trends from './screens/Trends'

const NAV = [
  { to: '/', label: 'Today', icon: '◉', end: true },
  { to: '/exercises', label: 'Exercises', icon: '🏋', end: false },
  { to: '/workouts', label: 'Workouts', icon: '✓', end: false },
  { to: '/meals', label: 'Meals', icon: '🍽', end: false },
  { to: '/trends', label: 'Trends', icon: '📈', end: false },
]

export default function App() {
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
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/exercises" element={<Exercises />} />
          <Route path="/workouts" element={<Workouts />} />
          <Route path="/meals" element={<Meals />} />
          <Route path="/trends" element={<Trends />} />
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
