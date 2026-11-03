import { OUTCOME_LABEL, type Choice, type RoomSnapshot } from '@salvage-rights/engine';
import { useEffect, useState } from 'react';

interface Props {
  snapshot: RoomSnapshot;
  meId: string | null;
  skew: number;
  onChoose: (choice: Choice) => void;
  onNext: () => void;
}

function useCountdown(deadline: number | null, skew: number): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, deadline - (Date.now() + skew)));
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [deadline, skew]);
  return left;
}

function outcomeTone(outcome: string): string {
  if (outcome === 'clean') return '';
  if (outcome === 'standoff') return 'danger';
  return 'steal';
}

export function Table({ snapshot, meId, skew, onChoose, onNext }: Props) {
  const me = snapshot.players.find((p) => p.id === meId) ?? null;
  const isHost = me?.isHost ?? false;
  const left = useCountdown(snapshot.deadline, skew);
  const [draft, setDraft] = useState<Choice | null>(null);

  // Reset the draft whenever a new haul starts.
  useEffect(() => setDraft(null), [snapshot.round, snapshot.gameNumber, snapshot.phase]);

  const locked = snapshot.me?.choice ?? null;
  const canPick = snapshot.phase === 'choosing' && me !== null && locked === null;

  // Keyboard: C / S to pick, Enter to lock in, Escape to change your mind.
  useEffect(() => {
    if (!canPick) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'c' || e.key === 'C') setDraft('collect');
      else if (e.key === 's' || e.key === 'S') setDraft('steal');
      else if (e.key === 'Enter' && draft) onChoose(draft);
      else if (e.key === 'Escape') setDraft(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canPick, draft, onChoose]);

  const lockedCount = snapshot.players.filter((p) => p.locked).length;
  const waitingOn = snapshot.players.filter((p) => !p.locked).map((p) => p.name);
  const seconds = left === null ? null : Math.ceil(left / 1000);
  const total = snapshot.settings.timerSeconds * 1000;
  const pct = left === null || total === 0 ? 100 : Math.max(0, Math.min(100, (left / total) * 100));
  const shown = locked ?? draft;

  return (
    <section className="plate hud amber console" aria-live="polite">
      <div className="step">
        Haul {snapshot.round} of {snapshot.totalRounds}
        {snapshot.round === snapshot.totalRounds ? ' · final' : ''}
      </div>
      <h2>{snapshot.jobName}</h2>
      <div className="readout">
        <div className="value" data-testid="pot">
          {snapshot.pot}
        </div>
        <div className="label">cargo on the line</div>
        <div className="note">
          {snapshot.carry > 0 ? `${snapshot.baseTake} aboard the derelict, ${snapshot.carry} still drifting from last time` : 'everything the derelict is carrying'}
        </div>
      </div>

      {snapshot.phase === 'choosing' && (
        <>
          {seconds !== null && (
            <>
              <div className={`timer${seconds <= 10 ? ' urgent' : ''}`} role="progressbar" aria-valuenow={seconds} aria-valuemin={0} aria-valuemax={snapshot.settings.timerSeconds}>
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="timer-label">{seconds > 0 ? `${seconds}s to call it · undecided crew collect` : 'Calling the haul…'}</div>
            </>
          )}

          {me ? (
            <>
              <div className="choice-pad" role="group" aria-label="Your call">
                <button
                  type="button"
                  className={`control collect${shown === 'collect' ? (locked ? ' locked' : ' chosen') : ''}`}
                  disabled={locked !== null}
                  aria-pressed={shown === 'collect'}
                  onClick={() => setDraft('collect')}
                  data-testid="chip-collect"
                >
                  {locked === 'collect' && <span className="latch">locked</span>}
                  <span className="key hint">C</span>
                  <span className="word">COLLECT</span>
                  <span className="sub">take your share</span>
                </button>
                <button
                  type="button"
                  className={`control steal${shown === 'steal' ? (locked ? ' locked' : ' chosen') : ''}`}
                  disabled={locked !== null}
                  aria-pressed={shown === 'steal'}
                  onClick={() => setDraft('steal')}
                  data-testid="chip-steal"
                >
                  {locked === 'steal' && <span className="latch">locked</span>}
                  <span className="key hint">S</span>
                  <span className="word">STEAL</span>
                  <span className="sub">jump the claim</span>
                </button>
              </div>
              <div className="confirm-bar">
                {locked ? null : draft ? (
                  <>
                    <button type="button" className={`btn ${draft === 'steal' ? 'btn-amber' : 'btn-signal'}`} onClick={() => onChoose(draft)} data-testid="lock-in">
                      Lock in {draft === 'steal' ? 'Steal' : 'Collect'} <span className="key">↵</span>
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                      Change
                    </button>
                  </>
                ) : null}
              </div>
              <div className="lock-strip" aria-label="Who has locked in">
                {snapshot.players.map((p) => (
                  <span key={p.id} className={`dot${p.locked ? ' locked' : ''}`}>
                    <i aria-hidden="true" />
                    {p.name}
                  </span>
                ))}
              </div>
              <p className="choose-note" data-testid="choose-note">
                {locked ? (
                  waitingOn.length ? (
                    <>
                      Locked in. Waiting on <b>{waitingOn.join(', ')}</b>.
                    </>
                  ) : (
                    'Everyone is in. Going live…'
                  )
                ) : draft ? (
                  'Calls are final once locked.'
                ) : (
                  <>
                    <b>{lockedCount}</b> of {snapshot.players.length} locked in. Make your call.
                  </>
                )}
              </p>
              {isHost && !waitingOn.some((n) => snapshot.players.find((p) => p.name === n)?.connected) && waitingOn.length > 0 && (
                <div className="confirm-bar">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onNext}>
                    Call the haul without {waitingOn.join(', ')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="choose-note" style={{ marginTop: 24 }}>
              You&apos;re watching this one. <b>{lockedCount}</b> of {snapshot.players.length} locked in.
            </p>
          )}
        </>
      )}

      {snapshot.phase === 'reveal' && <Reveal snapshot={snapshot} isHost={isHost} seconds={seconds} onNext={onNext} />}
    </section>
  );
}

function Reveal({ snapshot, isHost, seconds, onNext }: { snapshot: RoomSnapshot; isHost: boolean; seconds: number | null; onNext: () => void }) {
  const result = snapshot.history[snapshot.history.length - 1];
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    setFlipped(false);
    const t = window.setTimeout(() => setFlipped(true), 120);
    try {
      navigator.vibrate?.(30);
    } catch {
      /* not supported */
    }
    return () => window.clearTimeout(t);
  }, [result?.round, snapshot.gameNumber]);
  if (!result) return null;
  const last = result.round === snapshot.totalRounds;
  return (
    <div className="reveal" data-testid="reveal">
      <div className="reveal-cards">
        {snapshot.players.map((p) => {
          const c = result.choices[p.id];
          const d = result.deltas[p.id] ?? 0;
          return (
            <div key={p.id} className={`card${flipped ? ' flipped' : ''}`} data-testid={`card-${p.name}`} data-choice={c}>
              <div className="back" aria-hidden="true" />
              <div className={`face ${c}`}>
                <span className="name">{p.name}</span>
                <span className="word">{c === 'steal' ? 'STEAL' : 'COLLECT'}</span>
                <span className={`delta${d < 0 ? ' neg' : ''}`}>{d > 0 ? `+${d}` : d}</span>
                {result.timedOut.includes(p.id) && <span className="timed">timed out</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className={`reveal-outcome${flipped ? ' in' : ''}`}>
        <h3 className={outcomeTone(result.outcome)} data-testid="outcome">
          {OUTCOME_LABEL[result.outcome]}
        </h3>
        <p>{result.narration}</p>
      </div>
      <div className="reveal-actions">
        {isHost ? (
          <button type="button" className="btn btn-amber" onClick={onNext} data-testid="next-job">
            {last ? 'See the final manifest' : 'Next haul'}
            {seconds !== null && seconds > 0 ? ` (${seconds}s)` : ''}
          </button>
        ) : seconds !== null ? (
          <span>{last ? 'Final manifest' : 'Next haul'} in {seconds}s</span>
        ) : (
          <span>Waiting for the host.</span>
        )}
      </div>
    </div>
  );
}
