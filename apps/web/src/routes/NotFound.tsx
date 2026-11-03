import { Link } from '@tanstack/react-router';

export function NotFound() {
  return (
    <main className="page">
      <header className="topbar">
        <Link className="wordmark" to="/">
          Salvage Rights
        </Link>
      </header>
      <div className="fatal">
        <h1>Nothing here</h1>
        <p>Nothing docked here. Room links look like /r/KX7PQ.</p>
        <Link className="btn btn-amber" to="/">
          Back to the station
        </Link>
      </div>
    </main>
  );
}
