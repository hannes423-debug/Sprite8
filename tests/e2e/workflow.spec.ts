import { expect, test } from '@playwright/test';
import {
  countColor,
  download,
  expectStatus,
  frameColorCount,
  opaqueCount,
  paintLine,
  png,
  readZip,
  workingCell,
} from './helpers';

const GREEN: [number, number, number] = [0, 255, 136];

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
});

test('main workflow: upload → asymmetric → source direction → generate → edit one direction → export sprite sheet', async ({
  page,
}) => {
  await page.goto('/');

  // 1. Upload: a 4× upscaled sprite on an opaque white background.
  await page
    .getByTestId('source-file-input')
    .setInputFiles('tests/fixtures/hockey-player-4x-white.png');
  await expect(page.getByTestId('source-meta')).toContainText('37×54px');
  await expect(page.getByTestId('source-meta')).toContainText('upscaled 4×');
  await expect(page.getByTestId('source-meta')).toContainText('background removed');
  await expectStatus(page, 'S', 'source');

  // 2. Choose Asymmetric.
  await page.getByTestId('symmetry-asymmetric').click();
  await expect(page.getByTestId('symmetry-asymmetric')).toHaveAttribute('aria-checked', 'true');

  // 3. Choose the source direction (try SE, then settle on S).
  await page.getByTestId('source-dir-SE').click();
  await expectStatus(page, 'SE', 'source');
  await page.getByTestId('source-dir-S').click();
  await expectStatus(page, 'S', 'source');
  await expectStatus(page, 'SE', 'empty');

  // 4. Analyze — detected values are shown and editable.
  await page.getByTestId('analyze').click();
  await expect(page.getByTestId('analysis-facts')).toBeVisible();
  await expect(page.getByTestId('fact-symmetry')).toHaveValue('asymmetric');
  await expect(page.getByTestId('fact-hand')).toHaveValue('right');
  await expect(page.getByTestId('fact-style')).toHaveValue('pixel-art');
  await page.getByTestId('fact-camera').selectOption('side');
  await expect(page.getByTestId('fact-camera')).toHaveValue('side');

  // 5. Generate (no AI provider): the source is placed, every other view gets guides — no fake views.
  await page.getByTestId('generate-all').click();
  await expect(page.getByTestId('no-ai-notice')).toBeVisible();
  for (const d of ['N', 'NE', 'E', 'SE', 'SW', 'W', 'NW']) await expectStatus(page, d, 'guide');
  await expectStatus(page, 'S', 'source');

  // Side hints follow the character's handedness.
  await page.getByTestId('cell-N').click();
  await expect(page.getByTestId('side-hints')).toContainText(
    "The character's right side appears on the RIGHT side of the image.",
  );

  // 6–8. Edit one direction (N): stamp the opposite-view outline, paint, undo, redo.
  await page.getByTestId('edit-direction').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('stamp-silhouette').click();
  await expectStatus(page, 'N', 'edited');
  await page.getByLabel('Colour hex').fill('#00ff88');
  await page.getByTestId('tool-pencil').click();
  const cell = await workingCell(page);
  const row = Math.round(cell.anchorY - 30);
  const cx = Math.round(cell.anchorX);
  await paintLine(page, [cx - 3, row], [cx + 3, row]);
  await expect.poll(() => frameColorCount(page, 'N', GREEN)).toBe(7);
  await page.getByTestId('editor-undo').click();
  await expect.poll(() => frameColorCount(page, 'N', GREEN)).toBe(0);
  await page.getByTestId('editor-redo').click();
  await expect.poll(() => frameColorCount(page, 'N', GREEN)).toBe(7);
  // Keyboard: Ctrl+Z / Ctrl+Shift+Z inside the editor.
  await page.keyboard.press('Control+z');
  await expect.poll(() => frameColorCount(page, 'N', GREEN)).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => frameColorCount(page, 'N', GREEN)).toBe(7);
  await page.getByTestId('editor-done').click();
  await expect(page.getByTestId('editor')).toBeHidden();
  await expectStatus(page, 'N', 'edited');

  // 9. Export the sprite sheet: 8 × 1 cells of 64 px.
  await page.getByTestId('sheet-target').selectOption('64');
  await expect(page.getByTestId('sheet-dims')).toContainText('512 × 64px');
  const sheet = await download(page, () => page.getByTestId('export-sheet').click());
  expect(sheet.name).toBe('hockey-player-4x-white_sheet.png');
  const img = png(sheet.bytes);
  expect([img.width, img.height]).toEqual([512, 64]);
  // N is the first cell: it contains the painted green pixels (scaled by an integer factor).
  expect(countColor(img, GREEN, { x: 0, y: 0, w: 64, h: 64 })).toBeGreaterThan(0);
  // S (fifth cell) contains the source; NE (second, guide only) is empty.
  expect(opaqueCount(img, { x: 256, y: 0, w: 64, h: 64 })).toBeGreaterThan(300);
  expect(opaqueCount(img, { x: 64, y: 0, w: 64, h: 64 })).toBe(0);

  // Everything in one archive: sheet, eight individual PNGs and JSON metadata.
  const zip = await download(page, () => page.getByTestId('export-zip').click());
  const files = readZip(zip.bytes);
  expect([...files.keys()]).toEqual([
    'hockey-player-4x-white_sheet.png',
    ...['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((d) => `hockey-player-4x-white_${d}.png`),
    'hockey-player-4x-white.json',
  ]);
  const meta = JSON.parse(new TextDecoder().decode(files.get('hockey-player-4x-white.json')));
  expect(meta).toMatchObject({
    character: 'hockey-player-4x-white',
    cellWidth: 64,
    cellHeight: 64,
    anchor: { x: 32, y: 60 },
    symmetry: 'asymmetric',
    handedness: 'right',
    sourceDirection: 'S',
  });
  expect(meta.directions.NE).toBe('hockey-player-4x-white_NE.png');
  const nCell = png(files.get('hockey-player-4x-white_N.png')!);
  expect([nCell.width, nCell.height]).toEqual([64, 64]);
  expect(countColor(nCell, GREEN)).toBeGreaterThan(0);
});

test('layout options change the exported sheet', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('example-robot').click();
  await expectStatus(page, 'S', 'source');
  await page.getByTestId('sheet-layout').selectOption('4x2');
  await page.getByTestId('sheet-target').selectOption('48');
  await page.getByTestId('export-scale-2').click();
  await expect(page.getByTestId('sheet-dims')).toContainText('384 × 192px');
  const sheet = await download(page, () => page.getByTestId('export-sheet').click());
  const img = png(sheet.bytes);
  expect([img.width, img.height]).toEqual([384, 192]);
  // S is the first cell of the second row in the default N→NW order.
  expect(opaqueCount(img, { x: 0, y: 96, w: 96, h: 96 })).toBeGreaterThan(500);
  const json = await download(page, () => page.getByTestId('export-json').click());
  const meta = JSON.parse(new TextDecoder().decode(json.bytes));
  expect(meta).toMatchObject({
    cellWidth: 96,
    cellHeight: 96,
    anchor: { x: 48, y: 88 },
    sheet: { columns: 4, rows: 2 },
  });
});

test('keyboard shortcuts on the main screen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('example-hockey').click();
  await expectStatus(page, 'S', 'source');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('1');
  await expect(page.getByTestId('cell-N')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('cell-NE')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('cell-E')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('e');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('tool-fill')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('editor')).toBeHidden();
  await page.keyboard.press('?');
  await expect(page.getByTestId('help-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help-dialog')).toBeHidden();
});
