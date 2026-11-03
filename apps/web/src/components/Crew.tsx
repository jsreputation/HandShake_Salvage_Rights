import { BOT_STYLE_INFO, MAX_PLAYERS, REACTIONS, type RoomSnapshot } from '@salvage-rights/engine';
import type { Reaction } from '@/lib/useRoom';

interface Props {
  snapshot: RoomSnapshot;
  meId: string | null;
  reactions: Reaction[];
  onReact?: (emoji: string) => void;
  onRemove?: (playerId: string) => void;
  showSeats?: boolean;
}

export function Crew({ snapshot, meId, reactions, onReact, onRemove, showSeats }: Props) {
  const isHost = snapshot.players.find((p) => p.id === meId)?.isHost ?? false;
  const inLobby = snapshot.phase === 'lobby';
  return (
    <section aria-label="Crew">
      <div className="plate-title">
        <span>Crew</span>
        <span className="muted">
          {snapshot.players.length} of {MAX_PLAYERS}
          {snapshot.spectators > 0 ? ` · ${snapshot.spectators} watching` : ''}
        </span>
      </div>
      <ul className="crew-list">
        {snapshot.players.map((p) => {
          const style = p.botStyle ? BOT_STYLE_INFO[p.botStyle] : null;
          const floats = reactions.filter((r) => r.playerId === p.id);
          return (
            <li key={p.id} className={`crew-row${p.id === meId ? ' me' : ''}${p.connected ? '' : ' offline'}`} data-testid={`crew-${p.name}`}>
              <div className={`avatar${p.isBot ? ' bot' : ''}`} aria-hidden="true">
                {p.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="who">
                <b>
                  {p.name}
                  {p.id === meId ? ' (you)' : ''}
                  {p.isHost && <span className="host-tag">host</span>}
                </b>
                <small>
                  {p.isBot ? `AI · ${style?.label ?? 'crew'}` : p.connected ? 'crew' : 'offline'}
                  {snapshot.phase !== 'lobby' && p.steals > 0 ? ` · ${p.steals} jumped` : ''}
                </small>
              </div>
              {inLobby ? (
                isHost && p.id !== meId && onRemove ? (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => onRemove(p.id)} aria-label={`Remove ${p.name}`}>
                    Remove
                  </button>
                ) : (
                  <span className="state">{p.isBot ? 'ready' : 'docked'}</span>
                )
              ) : (
                <div style={{ textAlign: 'right' }}>
                  <div className={`score num${p.score < 0 ? ' neg' : ''}`} data-testid={`score-${p.name}`}>
                    {p.score}
                  </div>
                  {snapshot.phase === 'choosing' && <div className={`state${p.locked ? ' locked' : ''}`}>{p.locked ? 'locked in' : 'deciding'}</div>}
                  {snapshot.phase === 'finished' && p.rematchVote && <div className="state locked">ready to go again</div>}
                </div>
              )}
              {floats.map((r) => (
                <span key={r.id} className="float" aria-hidden="true">
                  {r.emoji}
                </span>
              ))}
            </li>
          );
        })}
        {showSeats &&
          Array.from({ length: Math.max(0, MAX_PLAYERS - snapshot.players.length) }).map((_, i) => (
            <li key={`empty-${i}`} className="empty-seat">
              Open seat
            </li>
          ))}
      </ul>
      {onReact && meId && snapshot.players.some((p) => p.id === meId) && (
        <div className="reactions" aria-label="Reactions">
          {REACTIONS.map((e) => (
            <button key={e} type="button" onClick={() => onReact(e)} aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
