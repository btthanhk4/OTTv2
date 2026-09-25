import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.argv[2] || 'http://127.0.0.1:8000/';
const code = `Q${Date.now().toString(36).toUpperCase().slice(-7)}`;
const errors = [];

function url(room, skip = null) {
  const target = new URL(base);
  if (target.hostname === 'localhost' || target.hostname === '127.0.0.1') {
    target.searchParams.set('backend', 'playhtml');
  }
  if (room) target.searchParams.set('room', room);
  if (skip !== null) {
    target.searchParams.set('quick', '1');
    target.searchParams.set('skip', skip.join(','));
  }
  return target.href;
}

async function newPage() {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}

try {
  const directory = await newPage();
  await directory.goto(new URL('watch.html', base).href);
  await directory.locator('#lobby-status').getByText(/Danh sách tự cập nhật/).waitFor({ timeout: 60000 });
  const occupied = await directory.locator('.room-code').allTextContents();
  await directory.close();

  const seeker = await newPage();
  await seeker.setViewportSize({ width: 390, height: 844 });
  await seeker.goto(url(null, occupied));
  await seeker.locator('#quick-wait').waitFor({ state: 'visible', timeout: 30000 });
  await seeker.waitForTimeout(2200);
  assert.equal(new URL(seeker.url()).searchParams.has('room'), false);
  assert.equal(await seeker.locator('#game-view').isVisible(), false);
  assert.equal(await seeker.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await seeker.screenshot({ path: 'artifacts/quick-wait-mobile.png', fullPage: true });

  const host = await newPage();
  await host.goto(url(code));
  await host.locator('#role-label').getByText(/PHE XANH/).waitFor({ timeout: 60000 });
  await seeker.locator('#role-label').getByText(/PHE ĐỎ/).waitFor({ timeout: 60000 });
  assert.equal(new URL(seeker.url()).searchParams.get('room'), code);
  await seeker.close();
  await host.close();

  const first = await newPage();
  await first.goto(url(null, [...occupied, code]));
  await first.locator('#quick-wait').waitFor({ state: 'visible', timeout: 30000 });
  await first.waitForTimeout(2200);
  assert.equal(new URL(first.url()).searchParams.has('room'), false);

  const second = await newPage();
  await second.goto(url(null, [...occupied, code]));
  await first.locator('#role-label').getByText(/PHE XANH/).waitFor({ timeout: 60000 });
  await second.locator('#role-label').getByText(/PHE ĐỎ/).waitFor({ timeout: 60000 });
  const pairedRoom = new URL(first.url()).searchParams.get('room');
  assert.ok(pairedRoom);
  assert.equal(new URL(second.url()).searchParams.get('room'), pairedRoom);
  await first.close();
  await second.close();

  const cancel = await newPage();
  await cancel.goto(url(null, [...occupied, code, pairedRoom]));
  await cancel.locator('#quick-wait').waitFor({ state: 'visible', timeout: 30000 });
  await cancel.locator('#cancel-quick').click();
  await cancel.waitForURL((value) => !value.searchParams.has('quick'));
  assert.equal(await cancel.locator('#home-view').isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('Matchmaking smoke: waits without a room, joins a host, pairs two seekers, and cancels');
} finally {
  await browser.close();
}
