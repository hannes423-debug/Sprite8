import { expect, test } from '@playwright/test';
import { expectStatus, frameColorCount, workingCell } from './helpers';

const GREEN: [number, number, number] = [0, 255, 136];

async function noHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('phone: responsive layout, generation and touch editing', async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await noHorizontalOverflow(page);
  await page.getByTestId('example-hockey').tap();
  await expectStatus(page, 'S', 'source');
  await page.getByTestId('analyze').tap();
  await expect(page.getByTestId('fact-hand')).toHaveValue('right');
  await page.getByTestId('generate-all').tap();
  await expectStatus(page, 'N', 'guide');
  await noHorizontalOverflow(page);

  await page.getByTestId('cell-N').tap();
  await page.getByTestId('edit-direction').tap();
  await expect(page.getByTestId('editor')).toBeVisible();

  // The side panel is a bottom sheet on phones.
  await page.getByTestId('toggle-panel').tap();
  await page.getByLabel('Colour hex').fill('#00ff88');
  await page.getByTestId('toggle-panel').tap();

  // One tap paints one pixel with the pencil.
  const cell = await workingCell(page);
  const canvas = page.getByTestId('editor-canvas');
  const box = (await canvas.boundingBox())!;
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  const panY = Number(await canvas.getAttribute('data-pan-y'));
  const px = Math.round(cell.anchorX);
  const py = Math.round(cell.anchorY - 30);
  await page.touchscreen.tap(box.x + panX + (px + 0.5) * zoom, box.y + panY + (py + 0.5) * zoom);
  await expect.poll(() => frameColorCount(page, 'N', GREEN)).toBe(1);

  await page.getByTestId('editor-done').tap();
  await expectStatus(page, 'N', 'edited');
  await noHorizontalOverflow(page);
});
