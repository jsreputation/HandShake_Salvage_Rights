import { OUTCOME_LABEL, resolveChoices, type Choice } from '@salvage-rights/engine';
import { useState } from 'react';

const NAMES = ['You', 'Vega', 'Orion', 'Lyra'];

/** The landing hero: the rule itself, live. Tap a seat to flip its choice. */
export function PayoutDemo() {
  const [choices, setChoices] = useState<Choice[]>(['collect', 'collect', 'steal', 'collect']);
  const pot = 120;
  const res = resolveChoices(pot, choices);
  const fair = Math.floor(pot / choices.length);

  const explain: Record<typeof res.outcome, string> = {
    clean: `Nobody fires. The ${pot} of cargo splits ${choices.length} ways.`,
    doublecross: `One crew member jumps the claim and tows the whole ${pot}. Everyone else gets nothing.`,
    scramble: `${res.stealers} stealers collide and come away with nothing. Collectors keep their ${fair}; the contested cargo stays drifting for the next haul.`,
    standoff: `Everyone fires at once. Everyone pays ${fair}, and the whole haul is still drifting next time.`,
  };
  const tone = res.outcome === 'clean' ? '' : res.outcome === 'standoff' ? 'danger' : 'steal';

  return (
    <div className="plate hud demo" aria-label="Payout demo">
      <div className="demo-head">
        <span>
          <b>Try it.</b> Tap a crew member to change their call.
        </span>
        <span>
          Cargo on the line: <b className="num">{pot}</b>
        </span>
      </div>
      <div className="demo-seats" role="group" aria-label="Crew">
        {choices.map((c, i) => (
          <button
            key={i}
            type="button"
            className="seat"
            data-choice={c}
            aria-pressed={c === 'steal'}
            aria-label={`${NAMES[i]}: ${c}. Tap to switch.`}
            onClick={() => setChoices((prev) => prev.map((x, j) => (j === i ? (x === 'steal' ? 'collect' : 'steal') : x)))}
          >
            {c.toUpperCase()}
            <span>{NAMES[i]}</span>
          </button>
        ))}
      </div>
      <div className="demo-result" aria-live="polite">
        <div className={`outcome ${tone}`}>{OUTCOME_LABEL[res.outcome]}</div>
        <p>{explain[res.outcome]}</p>
        <div className="demo-payouts">
          {res.deltas.map((d, i) => (
            <div key={i}>
              <b className={d < 0 ? 'neg' : ''}>{d > 0 ? `+${d}` : d}</b>
              <span>{NAMES[i]}</span>
            </div>
          ))}
          {res.carryOut > 0 && (
            <div className="carry">
              <b>{res.carryOut}</b>
              <span>left drifting</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
