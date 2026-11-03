import type { FixerAdvice, RoomSnapshot } from '@salvage-rights/engine';

interface Props {
  snapshot: RoomSnapshot;
  advice: FixerAdvice | null;
  pending: boolean;
  canAsk: boolean;
  onAsk: () => void;
}

export function Broker({ snapshot, advice, pending, canAsk, onAsk }: Props) {
  const current = advice && advice.round === snapshot.round ? advice : null;
  return (
    <section className="plate hud broker" aria-label="The Broker">
      <div className="plate-title">
        <span>The Broker</span>
        <span className="muted">private · once per haul</span>
      </div>
      {snapshot.phase !== 'choosing' ? (
        <p className="muted" style={{ fontSize: 14 }}>
          {snapshot.phase === 'lobby' ? 'On the line once the first derelict is in reach.' : 'Back before the next haul.'}
        </p>
      ) : current ? (
        <div data-testid="fixer-advice">
          <span className={`rec ${current.recommendation}`}>
            {current.recommendation === 'steal' ? 'Says steal' : 'Says collect'} · {Math.round(current.confidence * 100)}% sure
          </span>
          <h3 className="headline">{current.headline}</h3>
          <ul>
            {current.reasoning.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {current.reads.length > 0 && (
            <div className="reads">
              {current.reads.map((r) => (
                <div className="read" key={r.playerId}>
                  <div className="bar">
                    <b>{r.name}</b>
                    <i style={{ ['--w' as string]: `${Math.round(r.stealRate * 100)}%` }} aria-hidden="true" />
                    <span>{Math.round(r.stealRate * 100)}%</span>
                  </div>
                  <p>{r.note}</p>
                </div>
              ))}
            </div>
          )}
          <div className="source">{current.source === 'heuristic' ? 'Read by the station computer.' : `Briefing written by ${current.source}.`}</div>
        </div>
      ) : pending ? (
        <p className="muted thinking" style={{ fontSize: 14 }}>
          The Broker is reading the crew <i /> <i /> <i />
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
            Who&apos;s likely to fire this haul, and what to do about it. Only you see the answer.
          </p>
          <button type="button" className="btn btn-hull btn-block" onClick={onAsk} disabled={!canAsk} data-testid="ask-fixer">
            Ask the Broker
          </button>
        </>
      )}
    </section>
  );
}
