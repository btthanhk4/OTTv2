import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.argv[2] || 'http://127.0.0.1:8000/';
const code = `Q${Date.now().toString(36).toUpperCase().slice(-7)}`;
const errors = [];

function url(room) {
  const target = new URL(base);
  if (target.hostname === 'localhost' || target.hostname === '127.0.0.1') {
    target.searchParams.set('backend', 'playhtml');
  }
  if (room) target.searchParams.set('room', room);
  return target.href;
}

try {
  const waiting = await browser.newPage();
  waiting.on('pageerror', (error) => errors.push(error.message));
  await waiting.goto(url(code));
  await waiting.locator('#role-label').getByText(/PHE XANH/).waitFor({ timeout: 60000 });

  const challenger = await browser.newPage();
  challenger.on('pageerror', (error) => errors.push(error.message));
  await challenger.goto(url());
  await challenger.locator('#quick-match').click();
  await challenger.locator('#role-label').getByText(/PHE ĐỎ/).waitFor({ timeout: 60000 });
  assert.equal(new URL(challenger.url()).searchParams.get('room'), code);
  assert.equal(new URL(challenger.url()).searchParams.has('quick'), false);
  await waiting.locator('#status-title').getByText(/Lượt phe/).waitFor({ timeout: 30000 });
  await challenger.close();
  await waiting.close();

  const solo = await browser.newPage();
  solo.on('pageerror', (error) => errors.push(error.message));
  const soloUrl = new URL(url());
  soloUrl.searchParams.set('quick', '1');
  soloUrl.searchParams.set('skip', code);
  await solo.goto(soloUrl.href);
  await solo.locator('#role-label').getByText(/PHE XANH/).waitFor({ timeout: 60000 });
  assert.notEqual(new URL(solo.url()).searchParams.get('room'), code);
  assert.equal(new URL(solo.url()).searchParams.has('quick'), false);
  assert.deepEqual(errors, []);
  console.log('Matchmaking smoke: filled waiting room and created a new room when none was available');
} finally {
  await browser.close();
}
