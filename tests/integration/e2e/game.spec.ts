import { BASE_TAKES, TOTAL_ROUNDS, resolveChoices, type Choice } from '@salvage-rights/engine';
import { expect, test, type Page } from '@playwright/test';

/**
 * Two people, two browsers, one room link. Everything goes through the real UI:
 * create a room, join via the link, start, eight secret choices each, reveals, final count, rematch.
 */

const SCRIPT: Array<[Choice, Choice]> = [
  ['collect', 'collect'],
  ['steal', 'collect'],
  ['steal', 'steal'],
  ['collect', 'steal'],
  ['collect', 'collect'],
  ['steal', 'collect'],
  ['collect', 'collect'],
  ['steal', 'steal'],
];

async function lockIn(page: Page, choice: Choice) {
  await page.getByTestId(`chip-${choice}`).click();
  await page.getByTestId('lock-in').click();
  // Either "Locked in. Waiting on…" or, if this was the last choice, the reveal — in both cases the confirm button is gone.
  await expect(page.getByTestId('lock-in')).toHaveCount(0);
}

test('two independent clients play a complete eight-round game and rematch', async ({ browser, baseURL }) => {
  const anaCtx = await browser.newContext();
  const benCtx = await browser.newContext();
  const ana = await anaCtx.newPage();
  const ben = await benCtx.newPage();

  // Ana creates the room from the front page.
  await ana.goto('/');
  await ana.getByTestId('name').fill('Ana');
  await ana.getByTestId('create').click();
  await ana.waitForURL(/\/r\/[A-Z0-9]{5}$/);
  const code = await ana.getByTestId('room-code').textContent();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  const link = await ana.getByTestId('invite-link').inputValue();
  expect(link).toBe(`${baseURL}/r/${code}`);

  // Ben opens the link in a completely separate browser profile and picks a name.
  await ben.goto(link);
  await ben.getByTestId('name').fill('Ben');
  await ben.getByTestId('join-room').click();
  await expect(ben.getByTestId('crew-Ben')).toBeVisible();
  await expect(ana.getByTestId('crew-Ben')).toBeVisible();
  await expect(ben.getByTestId('status')).toHaveText('connected');

  // Host-only controls: Ben has no start button; Ana turns the timers off for a deterministic run.
  await expect(ben.getByTestId('start')).toHaveCount(0);
  await ana.getByTestId('timer-select').selectOption('0');
  await ana.getByTestId('reveal-select').selectOption('0');
  await ana.getByTestId('start').click();

  const totals = { Ana: 0, Ben: 0 };
  let carry = 0;

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    const [a, b] = SCRIPT[round - 1]!;
    const pot = BASE_TAKES[round - 1]! + carry;
    await expect(ana.getByText(`Haul ${round} of ${TOTAL_ROUNDS}`)).toBeVisible();
    await expect(ben.getByText(`Haul ${round} of ${TOTAL_ROUNDS}`)).toBeVisible();
    await expect(ana.getByTestId('pot')).toHaveText(String(pot));
    await expect(ben.getByTestId('pot')).toHaveText(String(pot));

    if (round === 1) {
      await ana.getByTestId('ask-fixer').click();
      await expect(ana.getByTestId('fixer-advice')).toBeVisible();
      await expect(ana.getByTestId('fixer-advice')).toContainText('Ben');
      await expect(ana.getByTestId('fixer-advice')).toContainText('Briefing written by mock');
      await expect(ben.getByTestId('fixer-advice')).toHaveCount(0);
    }

    // Ana locks in. Ben sees "locked in" but never her choice.
    await lockIn(ana, a);
    await expect(ben.getByTestId('crew-Ana')).toContainText('locked in');
    await expect(ben.getByTestId('reveal')).toHaveCount(0);
    expect(await ben.locator('[data-choice]').count()).toBe(0);

    await lockIn(ben, b);

    // Reveal lands on both screens with identical, rule-correct numbers.
    const expected = resolveChoices(pot, [a, b]);
    for (const page of [ana, ben]) {
      await expect(page.getByTestId('reveal')).toBeVisible();
      await expect(page.getByTestId('card-Ana')).toHaveAttribute('data-choice', a);
      await expect(page.getByTestId('card-Ben')).toHaveAttribute('data-choice', b);
      await expect(page.getByTestId('outcome')).toHaveText(
        { clean: 'Clean split', doublecross: 'Claim jumped', scramble: 'Collision', standoff: 'Standoff' }[expected.outcome],
      );
    }
    totals.Ana += expected.deltas[0]!;
    totals.Ben += expected.deltas[1]!;
    carry = round === TOTAL_ROUNDS ? 0 : expected.carryOut;
    for (const page of [ana, ben]) {
      await expect(page.getByTestId('score-Ana')).toHaveText(String(totals.Ana));
      await expect(page.getByTestId('score-Ben')).toHaveText(String(totals.Ben));
      await expect(page.getByTestId('total-Ana')).toHaveText(String(totals.Ana));
      await expect(page.getByTestId('total-Ben')).toHaveText(String(totals.Ben));
    }

    await expect(ben.getByTestId('next-job')).toHaveCount(0);
    await ana.getByTestId('next-job').click();
  }

  // Final count on both screens: a 390–390 tie that Ben wins on the cleaner record (3 steals vs 4).
  expect(totals).toEqual({ Ana: 390, Ben: 390 });
  for (const page of [ana, ben]) {
    await expect(page.getByTestId('podium')).toBeVisible();
    await expect(page.getByTestId('winner')).toHaveText('Ben holds the salvage rights');
    await expect(page.getByTestId('podium').locator('li').first()).toContainText('Ben');
    await expect(page.getByTestId('report')).toContainText('Mock mission log'); // local env: mock model path
  }

  // Rematch needs both humans; the second vote starts game two in the same room.
  await ben.getByTestId('rematch').click();
  await expect(ana.getByTestId('rematch')).toContainText('1 of 2 in');
  await ana.getByTestId('rematch').click();
  for (const page of [ana, ben]) {
    await expect(page.getByText(`Haul 1 of ${TOTAL_ROUNDS}`)).toBeVisible();
    await expect(page.getByTestId('pot')).toHaveText(String(BASE_TAKES[0]));
    await expect(page.getByTestId('score-Ana')).toHaveText('0');
    await expect(page.locator('header').getByText('run 2')).toBeVisible();
  }

  // The finished game is on the books: the front page shows Ben's record and the leaderboard.
  await ben.goto('/');
  await expect(ben.getByTestId('my-record')).toContainText('Your record, Ben');
  await expect(ben.getByTestId('my-record')).toContainText('1 win');
  await expect(ben.getByTestId('leaderboard')).toContainText('Ben');
  await ben.goto(link);
  await expect(ben.getByText(`Haul 1 of ${TOTAL_ROUNDS}`)).toBeVisible();

  // A reload mid-job keeps the seat and the locked choice.
  await lockIn(ana, 'steal');
  await ana.reload();
  await expect(ana.getByTestId('choose-note')).toContainText('Locked in');
  await expect(ana.getByTestId('chip-steal')).toHaveClass(/locked/);

  await anaCtx.close();
  await benCtx.close();
});
