import { expect, test, type Page } from '@playwright/test';
import { download, expectStatus } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
});

async function makeCharacter(page: Page) {
  await page.goto('/');
  await page.getByTestId('example-hockey').click();
  await page.getByTestId('analyze').click();
  await page.getByTestId('generate-all').click();
  await expectStatus(page, 'N', 'guide');
  await page.getByTestId('cell-N').click();
  await page.getByTestId('edit-direction').click();
  await page.getByTestId('stamp-silhouette').click();
  await page.getByTestId('editor-done').click();
  await expectStatus(page, 'N', 'edited');
}

test('autosaves in the browser and restores the session after a reload', async ({ page }) => {
  await makeCharacter(page);
  await expect(page.getByText('Saved in this browser')).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expectStatus(page, 'S', 'source');
  await expectStatus(page, 'N', 'edited');
  await expect(page.getByTestId('fact-hand')).toHaveValue('right');
});

test('project files round-trip through save, new project and open', async ({ page }) => {
  await makeCharacter(page);
  const file = await download(page, () => page.getByTestId('save-project').click());
  expect(file.name).toBe('hockey_player.sprite8.json');
  const text = new TextDecoder().decode(file.bytes);
  expect(JSON.parse(text).format).toBe('sprite8-project-file');

  await page.getByTestId('new-project').click();
  await page.getByTestId('confirm-ok').click();
  await expectStatus(page, 'S', 'empty');
  await expect(page.getByTestId('dropzone')).toContainText('Upload one character image');

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('open-project').click(),
  ]);
  await chooser.setFiles({
    name: 'hockey_player.sprite8.json',
    mimeType: 'application/json',
    buffer: Buffer.from(file.bytes),
  });
  await expectStatus(page, 'S', 'source');
  await expectStatus(page, 'N', 'edited');
  await expect(page.getByTestId('fact-hand')).toHaveValue('right');
});
