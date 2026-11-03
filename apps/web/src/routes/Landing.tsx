import { BASE_TAKES, JOB_NAMES } from '@salvage-rights/engine';
import { Link } from '@tanstack/react-router';
import { PayoutDemo } from '@/components/PayoutDemo';
import { Record } from '@/components/Record';
import { StartCard } from '@/components/StartCard';

export function Landing() {
  return (
    <main className="page">
      <header className="topbar">
        <Link className="wordmark" to="/">
          Salvage Rights
          <small>a game for 2–6 players</small>
        </Link>
        <nav className="meta">
          <a href="#rules">How a haul pays out</a>
          <a href="#ai">The Broker</a>
          <a href="#record">The record</a>
        </nav>
      </header>

      <section className="hero">
        <div>
          <h1>Eight hauls. One crew. Every claim is contested.</h1>
          <p className="lede">
            Your crew reaches a derelict. Before the cargo is split, each of you secretly calls <b className="collect">Collect</b> — take your
            fair share — or <b className="steal">Steal</b> — fire thrusters and tow the lot. The calls go live at the same time. Eight hauls,
            the cargo gets richer, and the manifest remembers everything.
          </p>
          <PayoutDemo />
        </div>
        <StartCard />
      </section>

      <section className="section" id="rules">
        <h2>How a haul pays out</h2>
        <p className="intro">
          Stealing pays only when you are the only one doing it. That is the whole game: read the crew, remember who jumped your claim, and
          decide how much you trust them while the cargo gets richer every haul.
        </p>
        <div className="rules-grid">
          <div className="plate rule">
            <h3>Clean split</h3>
            <div className="when">Nobody steals</div>
            <p>The cargo splits evenly. Dull, reliable, and the only way everyone flies home paid.</p>
          </div>
          <div className="plate rule">
            <h3 className="steal">Claim jumped</h3>
            <div className="when">Exactly one steals</div>
            <p>The stealer tows the entire haul. The collectors get nothing and a long memory.</p>
          </div>
          <div className="plate rule">
            <h3 className="steal">Collision</h3>
            <div className="when">Two or more steal, but not everyone</div>
            <p>The stealers collide and come away with nothing. Collectors keep their share, and the contested cargo stays drifting for the next haul.</p>
          </div>
          <div className="plate rule">
            <h3 className="danger">Standoff</h3>
            <div className="when">Everyone steals</div>
            <p>Everyone burns fuel and loses an even share, and the entire haul is still drifting at the next derelict. Expect it to get ugly.</p>
          </div>
        </div>
        <div className="hauls">
          <span>The eight derelicts:</span>
          {BASE_TAKES.map((t, i) => (
            <span key={i} title={JOB_NAMES[i]}>
              <b className="num">{t}</b>
            </span>
          ))}
          <span>plus anything left drifting. Ties go to the cleaner record.</span>
        </div>
      </section>

      <section className="section" id="ai">
        <h2>You are not flying alone</h2>
        <p className="intro">Three ways the station helps, none of which can see anyone&apos;s secret call.</p>
        <div className="three">
          <div className="plate hud">
            <h3>The Broker</h3>
            <p>
              A private advisor you can consult once per haul. The Broker reads the manifest, the scores and the cargo, then tells you who to
              worry about and what it would do. Advice is yours alone, and it is never the same tip for the whole crew.
            </p>
          </div>
          <div className="plate hud">
            <h3>AI crew</h3>
            <p>
              Short a player? The host can seat up to five AI crew members: a lifer, a scavenger, a grudge-holder, a glitch and a hunter,
              each with habits to learn.
            </p>
          </div>
          <div className="plate hud">
            <h3>The mission log</h3>
            <p>After the eighth haul the station writes up what happened: the decisive claim-jump, the quiet loyalty, who really won.</p>
          </div>
        </div>
      </section>

      <Record />

      <footer className="footer">
        <span>Rooms are free, need no account, and expire a day after the last move.</span>
        <span>Built on Cloudflare Workers, Durable Objects and Vite.</span>
      </footer>
    </main>
  );
}
