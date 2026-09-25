import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.argv[2] || 'http://127.0.0.1:8000/';
const seed = Date.now().toString(36).toUpperCase().slice(-6);
const codes = Array.from({ length: 5 }, (_, index) => `W${seed}${index}`);
const players = [];
const errors = [];

function gameUrl(code, spectate = false) {
  const url = new URL(base);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') url.searchParams.set('backend', 'playhtml');
  url.searchParams.set('room', code);
  if (spectate) url.searchParams.set('spectate', '1');
  return url.href;
}

try {
  for (const code of codes) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    players.push(page);
  }
  try {
    for (const [index, page] of players.entries()) {
      await page.goto(gameUrl(codes[index]));
      await page.locator('#role-label').getByText(/PHE XANH/).waitFor({ timeout: 60000 });
    }
  } catch (error) {
    for (const [index, page] of players.entries()) {
      console.log(codes[index], await page.locator('#role-label').textContent(),
        await page.locator('#status-title').textContent(), await page.locator('#toast').textContent());
    }
    console.log('errors', errors);
    throw error;
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const watch = await context.newPage();
  watch.on('pageerror', (error) => errors.push(error.message));
  await watch.goto(new URL('watch.html?backend=playhtml', base).href);
  await watch.locator('.room-entry').first().waitFor({ timeout: 60000 });
  await watch.waitForFunction(() => document.querySelectorAll('.room-entry').length === 5, undefined, { timeout: 60000 });
  assert.equal(await watch.locator('.room-entry').count(), 5);
  for (const code of codes.slice(0, 4)) {
    await watch.locator(`.room-entry:has(.room-code:text-is("${code}")) button`).click();
  }
  assert.equal(await watch.locator('.watch-card').count(), 4);
  await watch.locator(`.room-entry:has(.room-code:text-is("${codes[4]}")) button`).click();
  assert.equal(await watch.locator('.watch-card').count(), 4);
  assert.match(await watch.locator('#toast').textContent(), /tối đa bốn/);
  for (const card of await watch.locator('.watch-card').all()) {
    await card.locator('.mini-square').first().waitFor({ timeout: 60000 });
    assert.equal(await card.locator('.mini-square').count(), 81);
  }
  const galleryBottom = await watch.locator('#watch-gallery').evaluate((node) => node.getBoundingClientRect().bottom);
  assert.ok(galleryBottom <= 900);
  const frames = watch.frameLocator('.watch-card iframe');
  assert.equal(await frames.first().locator('#claim-actions').isVisible(), false);

  const rivalContext = await browser.newContext();
  const rival = await rivalContext.newPage();
  await rival.goto(gameUrl(codes[0]));
  await rival.locator('#role-label').getByText(/PHE ĐỎ/).waitFor({ timeout: 60000 });
  await players[0].locator('.square[data-row="6"][data-col="0"]').click();
  await players[0].locator('.square[data-row="5"][data-col="0"]').click();
  const firstCard = watch.locator(`.watch-card[data-room="${codes[0]}"]`);
  await firstCard.locator('.watch-meta').getByText(/1 nước/).waitFor({ timeout: 30000 });
  assert.equal(await firstCard.locator('.mini-square').nth(45).locator('.mini-piece.p1').count(), 1);
  await players[0].context().close();
  await rivalContext.close();
  await watch.waitForFunction((room) => ![...document.querySelectorAll('.room-code')]
    .some((node) => node.textContent === room), codes[0], { timeout: 30000 });
  await watch.screenshot({ path: 'artifacts/watch-four-desktop.png', fullPage: true });
  await watch.setViewportSize({ width: 390, height: 844 });
  assert.equal(await watch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await watch.screenshot({ path: 'artifacts/watch-four-mobile.png', fullPage: true });
  await watch.setViewportSize({ width: 320, height: 800 });
  assert.equal(await watch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(gameUrl(codes[0], true));
  await mobile.locator('.square').first().waitFor({ timeout: 60000 });
  const geometry = await mobile.locator('.square').evaluateAll((squares) => squares.map((square) => {
    const rect = square.getBoundingClientRect();
    return [rect.width, rect.height];
  }));
  assert.ok(geometry.every(([width, height]) => width === height && width === geometry[0][0]));
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await mobile.locator('#claim-actions').isVisible(), false);
  assert.match(await mobile.locator('#role-label').textContent(), /KHÁN GIẢ/);
  await mobile.setViewportSize({ width: 320, height: 800 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.screenshot({ path: 'artifacts/watch-mobile-board.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Watch smoke: 5 active rooms, 4 gallery boards, spectator lock, fixed squares OK');
} finally {
  await browser.close();
}
