import { Link, Route, Routes } from 'react-router-dom';

function HomePage() {
  return (
    <section className="space-y-3">
      <h1 className="text-3xl font-bold text-slate-900">React + Vite Toolkit Template</h1>
      <p className="text-slate-600">
        Start building pages, queries, and stateful features from this baseline.
      </p>
    </section>
  );
}

function SettingsPage() {
  return <p className="text-slate-600">Settings route placeholder.</p>;
}

export default function App() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <nav className="mb-8 flex gap-4 text-sm font-medium text-slate-700">
        <Link to="/">Home</Link>
        <Link to="/settings">Settings</Link>
      </nav>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  );
}
