// Uses existing Chrome. Only this test server accelerates growth; production takes 180 seconds.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const { createGardenServer } = require('../server');

(async () => {
  const { server, io } = createGardenServer({ tickMs: 100, gameOptions: { growSeconds: 6, drift: false } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const gardenerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const keeperContext = await browser.newContext();
    const first = await gardenerContext.newPage();
    const second = await keeperContext.newPage();
    const errors = [];
    for (const page of [first, second]) {
      page.on('pageerror', error => errors.push(error.stack));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    }
    const url = `http://127.0.0.1:${server.address().port}`;
    await first.goto(url);
    await first.screenshot({ path: 'test-results/intro-desktop.png', fullPage: true });
    await first.getByRole('button', { name: 'Enter the Garden' }).click();
    await first.getByRole('button', { name: 'Join or create garden' }).click();
    await first.locator('#garden').waitFor({ state: 'visible' });
    const code = await first.locator('#current-code').textContent();
    assert.equal(await first.locator('.plot-button').first().isDisabled(), true);
    await second.goto(`${url}/?room=${code}&role=keeper`);
    await second.getByRole('button', { name: 'Enter the Garden' }).click();
    assert.equal(await second.locator('input[value="keeper"]').isChecked(), true);
    await second.getByRole('button', { name: 'Join or create garden' }).click();
    await second.locator('#garden').waitFor({ state: 'visible' });
    await first.waitForFunction(() => document.querySelector('#presence').textContent.includes('both here'));
    await first.locator('#garden-canvas canvas').waitFor();
    assert.equal(await first.locator('#rainfall').isDisabled(), true);
    assert.equal(await second.locator('#rainfall').isEnabled(), true);
    assert.equal(await second.locator('.plot-button').first().isDisabled(), true);

    // Keeper changes weather, Gardener plants with keyboard, and both see the same seed.
    await second.locator('#rainfall').fill('0');
    await first.waitForFunction(() => window.gardenScene.state.rainfall === 0);
    const plot = first.locator('.plot-button').first();
    await plot.focus();
    await first.keyboard.press('Enter');
    await second.waitForFunction(() => window.gardenScene.state.plots[0].stage === 'seed');
    assert.equal(await second.evaluate(() => window.gardenScene.state.healthy), false);
    for (let id = 1; id < 6; id++) await first.locator('.plot-button').nth(id).click();
    await second.locator('#rainfall').fill('55');
    await second.locator('#sunlight').fill('60');
    await first.waitForFunction(() => window.gardenScene.state.sunlight === 60);
    await first.waitForFunction(() => window.gardenScene.state.plots[0].stage === 'sprout');

    // A reload rejoins the existing role and retains planted flowers.
    await second.reload();
    await second.locator('#garden').waitFor({ state: 'visible' });
    assert.equal(await second.locator('#keeper-you').textContent(), '(you)');
    assert.equal(await second.evaluate(() => window.gardenScene.state.plots.filter(p => p.stage !== 'empty').length), 6);
    const third = await gardenerContext.newPage();
    await third.goto(`${url}/?room=${code}`);
    await third.getByRole('button', { name: 'Enter the Garden' }).click();
    await third.getByRole('button', { name: 'Join or create garden' }).click();
    await third.waitForFunction(() => document.querySelector('#join-error').textContent.includes('occupied'));
    await first.locator('#completion').waitFor({ state: 'visible', timeout: 15000 });
    await second.locator('#completion').waitFor({ state: 'visible' });
    assert.equal(await first.evaluate(() => window.gardenScene.state.blooms), 6);
    await first.screenshot({ path: 'test-results/garden-desktop.png', fullPage: true, animations: 'disabled' });
    await first.setViewportSize({ width: 390, height: 844 });
    await first.waitForFunction(() => document.querySelector('#garden-canvas canvas').getBoundingClientRect().width < innerWidth);
    await first.screenshot({ path: 'test-results/garden-mobile.png', fullPage: true, animations: 'disabled' });
    assert.equal(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await first.locator('.garden-sidebar').evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await first.emulateMedia({ reducedMotion: 'reduce' });
    await first.locator('#restart').click();
    await second.waitForFunction(() => window.gardenScene.state.round === 2 && !window.gardenScene.state.complete);
    await first.locator('#completion').waitFor({ state: 'hidden' });
    assert.equal(await second.evaluate(() => window.gardenScene.state.plots.every(p => p.stage === 'empty')), true);

    // Disconnect mid-round: growth must freeze while the Keeper is away.
    await first.locator('.plot-button').first().click();
    await second.close();
    await first.waitForFunction(() => window.gardenScene.state.paused);
    const frozen = await first.evaluate(() => window.gardenScene.state.plots[0].growth);
    await first.waitForTimeout(350);
    assert.equal(await first.evaluate(() => window.gardenScene.state.plots[0].growth), frozen);
    assert.equal(await first.locator('.plot-button').nth(1).isDisabled(), true);
    await first.locator('#leave').click();
    await first.locator('#lobby').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: two independent sessions, role-aware controls, keyboard planting, shared weather/growth, reload recovery, full-room rejection, six-flower completion, replay, disconnect pause, leave, reduced motion, mobile layout, no page/HTTP errors.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => io.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
