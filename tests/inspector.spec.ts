import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, isMobile }) => {
  await page.goto('./');
  if (isMobile)
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'Object', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
});

test('effect headers stay compact and toggles do not change disclosure state', async ({
  page,
  isMobile,
}, testInfo) => {
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  const card = page
    .locator('#inspector-effects .inspector-stack-card')
    .filter({ has: page.getByRole('button', { name: 'Bevel', exact: true }) });
  const disclosure = card.getByRole('button', { name: 'Bevel', exact: true });
  const checkbox = card.getByRole('checkbox', {
    name: 'Enable Bevel',
    exact: true,
  });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.inspector-stack-body')).toBeHidden();
  const collapsed = await card.boundingBox();
  expect(collapsed!.height).toBeLessThanOrEqual(isMobile ? 64 : 56);

  const layout = await card
    .locator('.inspector-stack-header')
    .evaluate((header) => {
      const boxes = [
        'input',
        '.disclosure-chevron',
        '.inspector-stack-title',
        '.inspector-stack-actions',
      ].map((selector) =>
        header.querySelector(selector)!.getBoundingClientRect(),
      );
      return boxes.map((box) => ({ x: box.x, center: box.y + box.height / 2 }));
    });
  expect(layout[0].x).toBeLessThan(layout[1].x);
  expect(layout[1].x).toBeLessThan(layout[2].x);
  expect(layout[2].x).toBeLessThan(layout[3].x);
  expect(
    Math.max(...layout.map((box) => box.center)) -
      Math.min(...layout.map((box) => box.center)),
  ).toBeLessThan(3);

  await checkbox.uncheck();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.inspector-stack-body')).toBeHidden();
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(card.getByLabel('Depth', { exact: true })).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await card.getByLabel('Depth', { exact: true }).fill('180');
  const opacity = card.getByRole('spinbutton', { name: 'Opacity', exact: true });
  await opacity.fill('0.255');
  await expect(opacity).toHaveValue('0.255');
  await opacity.press('ArrowUp');
  await expect(opacity).toHaveValue('0.26');
  await disclosure.click();
  await expect(card.locator('.inspector-stack-body')).toBeHidden();
  expect((await card.boundingBox())!.height).toBe(collapsed!.height);
  await page.screenshot({
    path: testInfo.outputPath('compact-effects.png'),
  });
});

test('authors motion with a header checkbox and preserves animation history', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Motion', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Motion', exact: true });
  await panel
    .getByLabel('New animation', { exact: true })
    .selectOption('pulse');
  await panel.getByRole('button', { name: '+ Add', exact: true }).click();
  const pulse = panel.locator('.inspector-stack-card');
  await expect(
    pulse.getByRole('button', { name: 'Pulse', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(pulse.getByRole('checkbox')).toHaveCount(1);
  await expect(pulse.getByLabel('Enabled', { exact: true })).toHaveCount(0);
  await pulse
    .getByLabel('Loop duration (seconds)', { exact: true })
    .fill('0.5');
  await pulse.getByLabel('Amount', { exact: true }).fill('0.25');
  await pulse.getByRole('button', { name: 'Pulse', exact: true }).click();
  await pulse
    .getByRole('checkbox', { name: 'Enable Pulse', exact: true })
    .uncheck();
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeDisabled();
  await expect(pulse.locator('.inspector-stack-body')).toBeHidden();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(
    pulse.getByRole('checkbox', { name: 'Enable Pulse', exact: true }),
  ).toBeChecked();
  await pulse.getByRole('button', { name: 'Pulse', exact: true }).click();
  await expect(pulse.getByLabel('Amount', { exact: true })).toHaveValue('0.25');
  await expect(
    pulse.getByLabel('Loop duration (seconds)', { exact: true }),
  ).toHaveValue('0.5');
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeEnabled();
  await pulse
    .getByRole('button', { name: 'Remove Pulse', exact: true })
    .click();
  await expect(panel.locator('.inspector-stack-card')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeDisabled();
});

test('reaches typography, exact geometry and document controls through contextual sections', async ({
  page,
  isMobile,
}) => {
  const object = page.getByRole('tabpanel', { name: 'Object', exact: true });
  await object.getByText('Text layout', { exact: true }).click();
  const spacing = object.getByLabel('Letter spacing', { exact: true });
  await spacing.selectText();
  await spacing.pressSequentially('0.2');
  await expect(spacing).toHaveValue('0.2');
  await object.getByText('Exact position & transform', { exact: true }).click();
  const position = object.getByLabel('Position X', { exact: true });
  await position.selectText();
  await position.pressSequentially('-45');
  await expect(position).toHaveValue('-45');
  // Invalid intermediate input is a local draft, never an invalid document value.
  await position.fill('');
  await position.blur();
  await expect(position).toHaveValue('-45');
  await object
    .getByLabel('Warp type', { exact: true })
    .selectOption('perspective');
  await object.getByLabel('Top left X', { exact: true }).fill('0.1');
  await expect(page.locator('.render-error')).toHaveCount(0);
  // Arrow navigation switches the tab, never nudging the artwork underneath the focused tab.
  await page.getByRole('tab', { name: 'Object', exact: true }).focus();
  await page.keyboard.press('End');
  const canvas = page.getByRole('tabpanel', { name: 'Canvas', exact: true });
  await expect(canvas).toBeVisible();
  await canvas.getByLabel('Width', { exact: true }).fill('1024');
  await canvas.getByLabel('Height', { exact: true }).fill('768');
  await canvas.getByText('Global light', { exact: true }).click();
  await canvas.getByLabel('Altitude', { exact: true }).fill('55');
  await page.getByRole('tab', { name: 'Object', exact: true }).click();
  await expect(object.getByLabel('Position X', { exact: true })).toHaveValue(
    '-45',
  );
  await expect(
    object.getByLabel('Letter spacing', { exact: true }),
  ).toHaveValue('0.2');
  if (!isMobile) {
    // Keep the web catalogue, including system fonts, instead of inheriting native font limits.
    await page.getByRole('button', { name: /Font family/ }).click();
    await expect(
      page.getByRole('option', { name: 'Arial Black', exact: true }),
    ).toBeVisible();
  }
});

test('phone inspector scrolls by touch and gives its canvas space back when closed', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(!isMobile, 'Phone layout only');
  const inspect = page.getByRole('button', { name: 'Inspect', exact: true });
  await inspect.click();
  const workspace = await page.locator('.workspace').boundingBox();
  const canvas = await page.locator('.canvas-panel').boundingBox();
  expect(canvas!.height).toBeGreaterThanOrEqual(workspace!.height - 2);
  await inspect.click();
  const inspector = page.locator('#inspector-panel');
  await expect(inspector).toHaveCSS('overflow-y', 'auto');
  if (browserName === 'chromium') {
    const bounds = await inspector.boundingBox();
    const session = await page.context().newCDPSession(page);
    const point = { x: bounds!.x + 12, y: bounds!.y + bounds!.height - 40 };
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point],
    });
    for (let step = 1; step <= 5; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...point, y: point.y - step * 40 }],
      });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(() => inspector.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(40);
    await session.detach();
  }
});
