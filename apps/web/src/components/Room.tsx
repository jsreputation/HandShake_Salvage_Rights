import { TOTAL_ROUNDS, type BotStyle, type Choice, type RoomSnapshot, type Settings } from '@salvage-rights/engine';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { loadIdentity, setName, type Identity } from '@/lib/identity';
import { useRoom, type ConnectionStatus } from '@/lib/useRoom';
import { Broker } from './Broker';
import { Crew } from './Crew';
import { Dock } from './Dock';
import { EndOfRun } from './EndOfRun';
import { Manifest } from './Manifest';
import { Table } from './Table';

export function Room({ code }: { code: string }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    const id = loadIdentity();
    setIdentity(id);
    setDraftName(id.name);
  }, []);

  const room = useRoom(code, identity && identity.name ? identity : null);
  const { snapshot, send } = room;
  const meId = identity?.id ?? null;

  const onChoose = useCallback((choice: Choice) => send({ t: 'choose', choice }), [send]);
  const onNext = useCallback(() => send({ t: 'next' }), [send]);
  const onStart = useCallback(() => send({ t: 'start' }), [send]);
  const onSettings = useCallback((patch: Partial<Settings>) => send({ t: 'settings', patch }), [send]);
  const onAddBot = useCallback((style: BotStyle) => send({ t: 'addBot', style }), [send]);
  const onRemove = useCallback((playerId: string) => send({ t: 'removePlayer', playerId }), [send]);
  const onReact = useCallback((emoji: string) => send({ t: 'react', emoji }), [send]);
  const onRematch = useCallback(() => send({ t: 'rematch', vote: true }), [send]);
  const onLobby = useCallback(() => send({ t: 'lobby' }), [send]);

  // Tab title nudge: people alt-tab while others decide.
  useEffect(() => {
    const base = `Salvage Rights · ${code}`;
    if (!snapshot) {
      document.title = base;
      return;
    }
    const me = snapshot.players.find((p) => p.id === meId);
    if (snapshot.phase === 'choosing' && me && !me.locked) document.title = `● Your call — ${base}`;
    else if (snapshot.phase === 'reveal') document.title = `Haul ${snapshot.round} revealed — ${base}`;
    else if (snapshot.phase === 'finished') document.title = `Run over — ${base}`;
    else document.title = base;
    return () => {
      document.title = 'Salvage Rights';
    };
  }, [snapshot, meId, code]);

  if (identity === null) return null;

  if (!/^[A-HJ-NP-Z2-9]{4,8}$/.test(code)) {
    return <Fatal title="No room in that link" body="Room links look like /r/KX7PQ. Head back and open or join one." />;
  }

  if (!identity.name) {
    return (
      <main className="page">
        <Header code={code} status="closed" />
        <div className="fatal">
          <h1>Who&apos;s docking?</h1>
          <p>Pick the callsign the crew will see on the manifest.</p>
          <form
            className="plate hud name-form"
            onSubmit={(e) => {
              e.preventDefault();
              const clean = draftName.trim();
              if (!clean) return;
              setIdentity(setName(clean));
            }}
          >
            <input className="input" value={draftName} maxLength={16} placeholder="Your callsign" autoFocus onChange={(e) => setDraftName(e.target.value)} data-testid="name" />
            <button type="submit" className="btn btn-amber" data-testid="join-room">
              Dock
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (room.fatal) {
    const titles: Record<string, string> = {
      no_such_room: 'That room is gone',
      kicked: 'You were removed',
      bad_secret: 'That seat is taken',
      bad_identity: 'Something is off with your identity',
    };
    return (
      <Fatal
        title={titles[room.fatal.code] ?? 'Could not dock'}
        body={room.fatal.code === 'no_such_room' ? 'Rooms expire a day after the last move. Open a new one and send a fresh link.' : room.fatal.message}
      />
    );
  }

  if (!snapshot) {
    return (
      <main className="page">
        <Header code={code} status={room.status} />
        <p className="muted" style={{ textAlign: 'center', padding: 60 }}>
          {room.status === 'reconnecting' ? 'Re-establishing the link…' : 'Finding the dock…'}
        </p>
      </main>
    );
  }

  return (
    <main className="page">
      <Header code={code} status={room.status} snapshot={snapshot} />
      <div className="room">
        <div className="col-left">
          <Crew snapshot={snapshot} meId={meId} reactions={room.reactions} onReact={snapshot.phase === 'lobby' ? undefined : onReact} onRemove={onRemove} showSeats={snapshot.phase === 'lobby'} />
        </div>
        <div className="col-center">
          {snapshot.phase === 'lobby' && <Dock snapshot={snapshot} meId={meId} onStart={onStart} onSettings={onSettings} onAddBot={onAddBot} />}
          {(snapshot.phase === 'choosing' || snapshot.phase === 'reveal') && <Table snapshot={snapshot} meId={meId} skew={room.skew} onChoose={onChoose} onNext={onNext} />}
          {snapshot.phase === 'finished' && <EndOfRun snapshot={snapshot} meId={meId} onRematch={onRematch} onLobby={onLobby} />}
        </div>
        <div className="col-right">
          <Manifest snapshot={snapshot} meId={meId} />
          <Broker snapshot={snapshot} advice={room.fixer} pending={room.fixerPending} canAsk={snapshot.me?.role === 'player' && snapshot.me.choice === null} onAsk={room.askFixer} />
        </div>
      </div>
      <div className="toasts" aria-live="polite">
        {room.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </main>
  );
}

function Header({ code, status, snapshot }: { code: string; status: ConnectionStatus | string; snapshot?: RoomSnapshot }) {
  const round = snapshot?.round ?? 0;
  const playing = snapshot && snapshot.phase !== 'lobby';
  return (
    <header className="topbar">
      <Link className="wordmark" to="/">
        Salvage Rights
        <small>docking code {code}</small>
      </Link>
      {playing && (
        <div className="track" aria-label={`Haul ${round} of ${TOTAL_ROUNDS}`}>
          {Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
            const n = i + 1;
            const cls = snapshot.phase === 'finished' ? 'done' : n < round ? 'done' : n === round ? 'now' : '';
            return <i key={n} className={cls} />;
          })}
          <span>{snapshot.phase === 'finished' ? 'run complete' : `haul ${round}/${TOTAL_ROUNDS}`}</span>
        </div>
      )}
      <div className="meta">
        {snapshot && snapshot.gameNumber > 1 ? <span>run {snapshot.gameNumber}</span> : null}
        <span className={`status-pill${status === 'open' ? '' : ' off'}`} data-testid="status">
          {status === 'open' ? 'connected' : status === 'reconnecting' ? 'reconnecting' : status === 'connecting' ? 'connecting' : 'offline'}
        </span>
      </div>
    </header>
  );
}

function Fatal({ title, body }: { title: string; body: string }) {
  return (
    <main className="page">
      <header className="topbar">
        <Link className="wordmark" to="/">
          Salvage Rights
        </Link>
      </header>
      <div className="fatal">
        <h1>{title}</h1>
        <p>{body}</p>
        <Link className="btn btn-amber" to="/">
          Back to the station
        </Link>
      </div>
    </main>
  );
}
