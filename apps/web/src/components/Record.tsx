import { useEffect, useState } from 'react';
import { apiOrigin } from '@/lib/api';
import { loadIdentity } from '@/lib/identity';

interface Stats {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  totalScore: number;
  bestScore: number;
  steals: number;
}

/** Your record and the table of records. Renders nothing until the data layer is configured. */
export function Record() {
  const [mine, setMine] = useState<Stats | null>(null);
  const [board, setBoard] = useState<Stats[] | null>(null);

  useEffect(() => {
    let alive = true;
    const id = loadIdentity().id;
    void fetch(`${apiOrigin()}/api/leaderboard?limit=10`)
      .then((r) => r.json())
      .then((data: { enabled: boolean; players: Stats[] }) => alive && data.enabled && setBoard(data.players))
      .catch(() => undefined);
    void fetch(`${apiOrigin()}/api/players/${id}/stats`)
      .then((r) => r.json())
      .then((data: { enabled: boolean; stats: Stats | null }) => alive && data.enabled && setMine(data.stats))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!board || (!board.length && !mine)) return null;

  return (
    <section className="section" id="record">
      <h2>The record</h2>
      <p className="intro">Every finished run is logged. Guests are tracked by this browser; sign-in, when it lands, will let you claim them all.</p>
      <div className="three">
        <div className="plate" data-testid="my-record">
          <h3>{mine ? `Your record, ${mine.name}` : 'Your record'}</h3>
          {mine ? (
            <p>
              {mine.games} run{mine.games === 1 ? '' : 's'}, {mine.wins} win{mine.wins === 1 ? '' : 's'}. Best run {mine.bestScore}; {mine.steals} claim
              {mine.steals === 1 ? '' : 's'} jumped in total.
            </p>
          ) : (
            <p>No finished runs yet. The first one goes in the log.</p>
          )}
        </div>
        <div className="plate" style={{ gridColumn: 'span 2' }} data-testid="leaderboard">
          <h3>Most wins</h3>
          {board.length ? (
            <ol className="podium">
              {board.map((p, i) => (
                <li key={p.playerId} className={p.playerId === mine?.playerId ? 'winner' : ''}>
                  <span className="rank">{i + 1}</span>
                  <span className="name">
                    {p.name}
                    <small>
                      {p.games} run{p.games === 1 ? '' : 's'} · avg {Math.round(p.totalScore / Math.max(1, p.games))}
                    </small>
                  </span>
                  <span className="final num">{p.wins}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>Nobody holds any rights yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
