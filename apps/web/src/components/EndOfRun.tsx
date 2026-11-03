import type { RoomSnapshot } from '@salvage-rights/engine';

interface Props {
  snapshot: RoomSnapshot;
  meId: string | null;
  onRematch: () => void;
  onLobby: () => void;
}

export function EndOfRun({ snapshot, meId, onRematch, onLobby }: Props) {
  const me = snapshot.players.find((p) => p.id === meId);
  const isHost = me?.isHost ?? false;
  const ranked = [...snapshot.players].sort((a, b) => b.score - a.score || a.steals - b.steals || a.seat - b.seat);
  const winners = new Set(snapshot.winners);
  const humans = snapshot.players.filter((p) => !p.isBot && p.connected);
  const votes = humans.filter((p) => p.rematchVote).length;
  const seriesEntries = Object.entries(snapshot.series)
    .map(([id, wins]) => ({ name: snapshot.players.find((p) => p.id === id)?.name ?? '?', wins }))
    .sort((a, b) => b.wins - a.wins);
  const winnerNames = snapshot.winners.map((id) => snapshot.players.find((p) => p.id === id)?.name ?? '?');

  return (
    <div>
      <div className="dock-hero">
        <div className="label">Haul 8 complete</div>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(30px, 5vw, 52px)', color: 'var(--ice)', fontWeight: 700, lineHeight: 1.05, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 6 }} data-testid="winner">
          {winnerNames.length > 1 ? `${winnerNames.join(' and ')} share the salvage rights` : `${winnerNames[0]} holds the salvage rights`}
        </h2>
      </div>

      <div className="plate hud amber" style={{ marginTop: 20 }}>
        <div className="plate-title">
          <span>Final manifest</span>
          <span className="muted">ties go to the cleaner record</span>
        </div>
        <ol className="podium" data-testid="podium">
          {ranked.map((p, i) => (
            <li key={p.id} className={winners.has(p.id) ? 'winner' : ''}>
              <span className="rank">{i + 1}</span>
              <span className="name">
                {p.name}
                {p.id === meId ? ' (you)' : ''}
                <small>
                  {p.steals === 0 ? 'never jumped a claim' : `${p.steals} claim${p.steals === 1 ? '' : 's'} jumped`}
                  {p.isBot ? ' · AI' : ''}
                </small>
              </span>
              <span className="final num">{p.score}</span>
            </li>
          ))}
        </ol>

        {snapshot.report && (
          <div className="log" data-testid="report">
            <div className="plate-title" style={{ marginBottom: 6 }}>
              <span>Mission log</span>
            </div>
            <p>{snapshot.report}</p>
          </div>
        )}

        <div className="rematch">
          {seriesEntries.length > 0 && (
            <div className="series">
              Series: {seriesEntries.map((s) => `${s.name} ${s.wins}`).join(' · ')}
            </div>
          )}
          {me ? (
            <button type="button" className={`btn ${me.rematchVote ? 'btn-hull' : 'btn-amber'}`} onClick={onRematch} data-testid="rematch">
              {me.rematchVote ? `Waiting on the others (${votes} of ${humans.length} in)` : `Go again (${votes} of ${humans.length} in)`}
            </button>
          ) : (
            <span className="muted">You&apos;ll be seated for the next run if there&apos;s room.</span>
          )}
          {isHost && (
            <button type="button" className="btn btn-ghost" onClick={onLobby} data-testid="to-lobby">
              Back to the dock to change the crew
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
