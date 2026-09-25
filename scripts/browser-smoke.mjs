import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const newPage = async (width = 1440) => {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
};

try {
  const local = await newPage();
  await local.goto('http://127.0.0.1:8000/');
  await local.locator('#start-offline').click();
  await local.locator('.square').first().waitFor();
  assert.equal(await local.locator('.square').count(), 81);
  await local.locator('.square[data-row="6"][data-col="0"]').click();
  assert.ok(await local.locator('.legal-move').count() > 0);
  await local.locator('.square[data-row="5"][data-col="0"]').click();
  assert.match(await local.locator('#status-title').textContent(), /Đỏ/);
  assert.match(await local.locator('#move-total').textContent(), /01/);
  await local.screenshot({ path: 'artifacts/offline-desktop.png', fullPage: true });

  const p1 = await newPage();
  await p1.goto('http://127.0.0.1:8000/');
  await p1.locator('#player-name').fill('An');
  await p1.locator('#create-online').click();
  await p1.locator('#role-label').getByText(/PHE XANH/).waitFor({ timeout: 20000 });
  const url = p1.url();
  const p2 = await newPage();
  await p2.goto(url);
  await p2.locator('#role-label').getByText(/PHE ĐỎ/).waitFor({ timeout: 20000 });
  await p1.locator('#status-title').getByText(/Lượt phe Xanh/).waitFor();
  await p1.locator('.square[data-row="6"][data-col="0"]').click();
  await p1.locator('.square[data-row="5"][data-col="0"]').click();
  await p2.locator('#move-total').getByText(/01/).waitFor({ timeout: 10000 });
  assert.match(await p2.locator('#status-title').textContent(), /Đỏ/);
  await p1.screenshot({ path: 'artifacts/online-desktop.png', fullPage: true });

  const watcher = await newPage(390);
  await watcher.goto(url);
  await watcher.locator('#role-label').getByText(/KHÁN GIẢ/).waitFor({ timeout: 20000 });
  await watcher.screenshot({ path: 'artifacts/online-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser smoke: offline, 2 online players, spectator, responsive screenshots OK');
} finally {
  await browser.close();
}
