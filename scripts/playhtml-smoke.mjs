import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const code = `P${Date.now().toString(36).toUpperCase()}`;
const url = `http://127.0.0.1:8000/?backend=playhtml&room=${code}`;
const errors = [];
async function page() {
  const context = await browser.newContext();
  const tab = await context.newPage();
  tab.on('pageerror', (error) => errors.push(error.message));
  return tab;
}

try {
  const a = await page();
  await a.goto(url);
  await a.locator('#role-label').getByText(/PHE XANH/).waitFor({ timeout: 45000 });
  const b = await page();
  await b.goto(url);
  await b.locator('#role-label').getByText(/PHE ĐỎ/).waitFor({ timeout: 45000 });
  await a.locator('#status-title').getByText(/Lượt phe Xanh/).waitFor({ timeout: 30000 });
  await a.locator('.square[data-row="6"][data-col="0"]').click();
  await a.locator('.square[data-row="5"][data-col="0"]').click();
  try {
  await b.locator('#move-total').getByText(/01/).waitFor({ timeout: 15000 });
  } catch (error) {
    console.log('A', await a.locator('#status-title').textContent(), await a.locator('#move-total').textContent(), await a.locator('#toast').textContent());
    console.log('B', await b.locator('#status-title').textContent(), await b.locator('#move-total').textContent(), await b.locator('#toast').textContent());
    console.log('errors', errors);
    await a.screenshot({ path: 'artifacts/playhtml-a.png', fullPage: true });
    await b.screenshot({ path: 'artifacts/playhtml-b.png', fullPage: true });
    throw error;
  }
  assert.match(await b.locator('#status-title').textContent(), /Đỏ/);
  const watcher = await page();
  await watcher.goto(url);
  await watcher.locator('#role-label').getByText(/KHÁN GIẢ/).waitFor({ timeout: 45000 });
  await b.locator('#leave-seat').click();
  await watcher.locator('#role-label').getByText(/PHE ĐỎ/).waitFor({ timeout: 30000 });
  await a.locator('#move-total').getByText(/00/).waitFor({ timeout: 30000 });
  assert.deepEqual(errors, []);
  console.log('PlayHTML smoke: two browsers, seats, synced move OK');
} finally {
  await browser.close();
}
