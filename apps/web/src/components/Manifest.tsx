import { BASE_TAKES, OUTCOME_LABEL, TOTAL_ROUNDS, type RoomSnapshot } from '@salvage-rights/engine';

/** The manifest: one column per haul, one row per crew member. STEAL is an orange stamp. */
export function Manifest({ snapshot, meId }: { snapshot: RoomSnapshot; meId: string | null }) {
  const hauls = Array.from({ length: TOTAL_ROUNDS }, (_, i) => i + 1);
  const byRound = new Map(snapshot.history.map((r) => [r.round, r]));
  return (
    <section className="plate manifest" aria-label="Manifest">
      <div className="plate-title">
        <span>Manifest</span>
        <span className="muted">run {snapshot.gameNumber}</span>
      </div>
      {snapshot.phase === 'lobby' ? (
        <p className="manifest-empty">Every call ends up here. Eight columns, no corrections.</p>
      ) : (
        <table data-testid="ledger">
          <thead>
            <tr>
              <th scope="col">Haul</th>
              {hauls.map((h) => (
                <th key={h} scope="col" className={`haul${h === snapshot.round && snapshot.phase !== 'finished' ? ' current' : ''}`} title={byRound.get(h)?.jobName}>
                  {h}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.players.map((p) => (
              <tr key={p.id} className={p.id === meId ? 'me' : ''}>
                <td title={p.name}>{p.name}</td>
                {hauls.map((h) => {
                  const r = byRound.get(h);
                  const c = r?.choices[p.id];
                  const d = r?.deltas[p.id];
                  if (!r || !c) return <td key={h}>{h === snapshot.round && snapshot.phase === 'choosing' ? <span className="mark pending">?</span> : ''}</td>;
                  return (
                    <td key={h}>
                      <span className={`mark ${c}`} title={`${OUTCOME_LABEL[r.outcome]} · ${c}${r.timedOut.includes(p.id) ? ' (timed out)' : ''}`}>
                        {c === 'steal' ? 'S' : 'C'}
                      </span>
                      <span className={`delta${(d ?? 0) < 0 ? ' neg' : ''}`}>{d === undefined ? '' : d > 0 ? `+${d}` : d}</span>
                    </td>
                  );
                })}
                <td className="total" data-testid={`total-${p.name}`}>
                  {p.score}
                </td>
              </tr>
            ))}
            <tr className="cargo">
              <th scope="row">Cargo</th>
              {hauls.map((h) => {
                const r = byRound.get(h);
                const pot = r ? r.pot : h === snapshot.round ? snapshot.pot : BASE_TAKES[h - 1];
                return (
                  <td key={h} className="num">
                    {pot}
                  </td>
                );
              })}
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}
