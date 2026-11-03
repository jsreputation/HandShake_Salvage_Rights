import { isValidRoomCode } from '@salvage-rights/engine';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { createRoom, fetchDirectory, fetchRoom, type DirectoryRoom } from '@/lib/api';
import { loadIdentity, setName } from '@/lib/identity';

export function StartCard() {
  const [name, setNameState] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<DirectoryRoom[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    setNameState(loadIdentity().name);
    let alive = true;
    const load = () => fetchDirectory().then((rooms) => alive && setOpen(rooms)).catch(() => undefined);
    load();
    const t = window.setInterval(load, 15_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const requireName = (): string | null => {
    const clean = name.trim();
    if (!clean) {
      setError('Pick a callsign first so the crew knows who you are.');
      return null;
    }
    setName(clean);
    return clean;
  };

  const onCreate = async () => {
    setError(null);
    if (!requireName()) return;
    setBusy('create');
    try {
      const room = await createRoom({});
      await navigate({ to: '/r/$code', params: { code: room.code } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const go = async (target: string) => {
    setError(null);
    if (!requireName()) return;
    const clean = target.trim().toUpperCase();
    if (!isValidRoomCode(clean)) {
      setError('Docking codes are 5 letters and numbers, like KX7PQ.');
      return;
    }
    setBusy('join');
    try {
      const room = await fetchRoom(clean);
      if (!room) {
        setError(`No room is docked at ${clean}. Check the code or ask for a fresh link.`);
        setBusy(null);
        return;
      }
      await navigate({ to: '/r/$code', params: { code: clean } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    void go(code);
  };

  return (
    <aside className="plate hud amber start-card">
      <div className="plate-title">
        <span>Assemble a crew</span>
      </div>
      <div className="stack">
        <label className="field">
          <span>Your name</span>
          <input
            className="input"
            value={name}
            maxLength={16}
            placeholder="Your callsign"
            autoComplete="nickname"
            onChange={(e) => setNameState(e.target.value)}
            data-testid="name"
          />
        </label>
        <button type="button" className="btn btn-amber btn-block" onClick={onCreate} disabled={busy !== null} data-testid="create">
          {busy === 'create' ? 'Opening a dock…' : 'Open a room'}
        </button>
        <div className="or">or dock with a code</div>
        <form className="row" onSubmit={onJoin}>
          <input
            className="input code"
            value={code}
            maxLength={8}
            placeholder="DOCKING CODE"
            aria-label="Room code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            data-testid="code"
          />
          <button type="submit" className="btn btn-signal" disabled={busy !== null} data-testid="join">
            {busy === 'join' ? 'Checking…' : 'Join'}
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {open.length > 0 && (
        <div className="open-tables">
          <div className="plate-title">
            <span>Open docks</span>
            <span className="muted">crews looking for players</span>
          </div>
          <ul>
            {open.map((r) => (
              <li key={r.code}>
                <span>
                  <span className="code">{r.code}</span> <span className="muted">· {r.host}</span>
                </span>
                <span className="muted">
                  {r.players}/{r.maxPlayers}
                </span>
                <button type="button" className="btn btn-sm btn-signal" onClick={() => void go(r.code)}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
