import { BOT_STYLES, BOT_STYLE_INFO, MAX_PLAYERS, MIN_PLAYERS, type BotStyle, type RoomSnapshot, type Settings } from '@salvage-rights/engine';
import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'react';
import { roomLink } from '@/lib/api';

interface Props {
  snapshot: RoomSnapshot;
  meId: string | null;
  onStart: () => void;
  onSettings: (patch: Partial<Settings>) => void;
  onAddBot: (style: BotStyle) => void;
}

function qrDataUrl(text: string): string | null {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(4, 0);
  } catch {
    return null;
  }
}

/** The lobby: a dock where the crew gathers before the first haul. */
export function Dock({ snapshot, meId, onStart, onSettings, onAddBot }: Props) {
  const me = snapshot.players.find((p) => p.id === meId);
  const isHost = me?.isHost ?? false;
  const host = snapshot.players.find((p) => p.isHost);
  const [copied, setCopied] = useState(false);
  const [style, setStyle] = useState<BotStyle>('shark');
  const link = roomLink(snapshot.code);
  const qr = useMemo(() => qrDataUrl(link), [link]);
  const enough = snapshot.players.length >= MIN_PLAYERS;

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      window.prompt('Copy this link', link);
    }
  };

  return (
    <div>
      <div className="dock-hero">
        <div className="label">Docking code</div>
        <div className="code" data-testid="room-code">
          {snapshot.code}
        </div>
        <p>
          {snapshot.gameNumber > 1 ? `Run ${snapshot.gameNumber}. ` : ''}
          Send the link or show the code. The crew launches when the host says so.
        </p>
      </div>

      <div className="plate hud" style={{ marginTop: 20 }}>
        <div className="plate-title">
          <span>Invite the crew</span>
          <span className="muted">up to {MAX_PLAYERS} players</span>
        </div>
        <div className="invite">
          <input className="input" readOnly value={link} aria-label="Room link" onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" />
          <button type="button" className="btn btn-signal" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {qr && (
          <div className="invite-qr">
            <img src={qr} alt={`QR code for ${link}`} width={96} height={96} />
            <span>Same room? Point a phone camera at this and it docks straight in.</span>
          </div>
        )}

        {isHost ? (
          <>
            <div className="dock-settings">
              <label className="field">
                <span>Time to call it</span>
                <select className="input" value={snapshot.settings.timerSeconds} onChange={(e) => onSettings({ timerSeconds: Number(e.target.value) })} data-testid="timer-select">
                  <option value={0}>No timer</option>
                  <option value={20}>20 seconds</option>
                  <option value={40}>40 seconds</option>
                  <option value={60}>60 seconds</option>
                  <option value={90}>90 seconds</option>
                </select>
              </label>
              <label className="field">
                <span>After the reveal</span>
                <select className="input" value={snapshot.settings.revealSeconds} onChange={(e) => onSettings({ revealSeconds: Number(e.target.value) })} data-testid="reveal-select">
                  <option value={0}>Wait for the host</option>
                  <option value={6}>Next haul after 6s</option>
                  <option value={10}>Next haul after 10s</option>
                  <option value={20}>Next haul after 20s</option>
                </select>
              </label>
              <label className="toggle wide">
                <input type="checkbox" checked={snapshot.settings.isPublic} onChange={(e) => onSettings({ isPublic: e.target.checked })} />
                List this dock on the station page so strangers can join
              </label>
            </div>
            <div className="bot-row">
              <select className="input" value={style} onChange={(e) => setStyle(e.target.value as BotStyle)} aria-label="AI crew style" data-testid="bot-style">
                {BOT_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {BOT_STYLE_INFO[s].label} — {BOT_STYLE_INFO[s].blurb}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-hull" onClick={() => onAddBot(style)} disabled={snapshot.players.length >= MAX_PLAYERS} data-testid="add-bot">
                Add AI crew
              </button>
            </div>
          </>
        ) : (
          <p className="muted" style={{ marginTop: 14, fontSize: 14 }}>
            {snapshot.settings.timerSeconds ? `${snapshot.settings.timerSeconds} seconds to call each haul.` : 'No timer on this run.'}{' '}
            {host ? `${host.name} can add AI crew and launch.` : ''}
          </p>
        )}
      </div>

      <div className="launch">
        {isHost ? (
          <>
            <button type="button" className="btn btn-amber" onClick={onStart} disabled={!enough} data-testid="start">
              Launch
            </button>
            {!enough && <span className="muted">You need at least {MIN_PLAYERS} crew members. Add AI crew or share the link.</span>}
          </>
        ) : me ? (
          <span className="muted">Waiting for {host?.name ?? 'the host'} to launch.</span>
        ) : (
          <span className="muted">The crew is full. You&apos;ll get a seat if one opens up.</span>
        )}
      </div>
    </div>
  );
}
