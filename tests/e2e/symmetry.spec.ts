import { expect, test } from '@playwright/test';
import { expectStatus } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
});

async function generateSkippingManual(page: import('@playwright/test').Page) {
  await page.getByTestId('generate-all').click();
  const dialog = page.getByTestId('confirm-dialog');
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false))
    await page.getByTestId('confirm-ok').click();
}

test('symmetric characters mirror partner views only with the explicit shortcut; asymmetric ones never', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('example-robot').click();
  await expect(page.getByTestId('symmetry-symmetric')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('analyze').click();
  await expect(page.getByTestId('fact-symmetry')).toHaveValue('symmetric');

  // Provide an E view by importing an image for that direction.
  await page.getByTestId('cell-E').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('import-direction').click(),
  ]);
  await chooser.setFiles('assets/examples/robot.png');
  await expectStatus(page, 'E', 'imported');

  // Shortcut off: W is NOT derived by mirroring.
  await generateSkippingManual(page);
  await expectStatus(page, 'W', 'guide');
  await expectStatus(page, 'E', 'imported');

  // Shortcut on: W becomes the mirror of E (around the foot anchor); NW has no partner yet.
  await page.getByTestId('symmetry-shortcut').check();
  await generateSkippingManual(page);
  await expectStatus(page, 'W', 'mirror');
  await expectStatus(page, 'NW', 'guide');
  await expectStatus(page, 'N', 'guide');
  const mirrored = await page.evaluate(() => {
    const s = window.sprite8!.getState();
    const t = s.project.animations[0].tracks;
    const e = t.E.frames[0].image!;
    const w = t.W.frames[0].image!;
    const axis2 = Math.round(s.project.cell.anchorX * 2);
    for (let y = 0; y < e.height; y++) {
      for (let x = 0; x < e.width; x++) {
        const mx = axis2 - x - 1;
        if (mx < 0 || mx >= e.width) continue;
        for (let c = 0; c < 4; c++)
          if (e.data[(y * e.width + x) * 4 + c] !== w.data[(y * w.width + mx) * 4 + c])
            return false;
      }
    }
    return true;
  });
  expect(mirrored).toBe(true);
  await page.getByTestId('cell-W').click();
  await expect(page.getByTestId('consistency-checks')).toContainText('Mirrored from E');

  // Switching to asymmetric offers to remove views that were made by mirroring.
  await page.getByTestId('symmetry-asymmetric').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
  await expectStatus(page, 'W', 'empty');

  // Asymmetric: even with the shortcut still stored in the project, nothing is mirrored.
  await generateSkippingManual(page);
  await expectStatus(page, 'W', 'guide');
  await page.getByTestId('cell-W').click();
  await expect(page.getByTestId('mirror-direction')).toHaveCount(0);
});
