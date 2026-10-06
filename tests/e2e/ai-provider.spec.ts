import { expect, test } from '@playwright/test';
import {
  download,
  expectStatus,
  png,
  readZip,
  startMockAi,
  useHttpProvider,
  opaqueCount,
} from './helpers';

const OTHERS = ['N', 'NE', 'E', 'SE', 'SW', 'W', 'NW'];

let ai: Awaited<ReturnType<typeof startMockAi>>;

test.beforeAll(async () => {
  // The mock backend fakes imperfect model output; SE is deliberately rendered
  // with swapped hands to check that Sprite8 flags it.
  ai = await startMockAi({ mirrorBug: ['SE'] });
});

test.afterAll(async () => {
  await ai.close();
});

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
});

test('AI provider: eight conformed directions, handedness check, regenerating one direction leaves the rest untouched', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('example-hockey').click();
  await expectStatus(page, 'S', 'source');
  await page.getByTestId('analyze').click();
  await expect(page.getByTestId('fact-hand')).toHaveValue('right');
  await useHttpProvider(page, ai.url);

  await page.getByTestId('generate-all').click();
  for (const d of OTHERS) await expectStatus(page, d, 'ai');
  await expectStatus(page, 'S', 'source');

  // Consistency system: every view has the reference height and stands on the ground line.
  const metrics = await page.evaluate(() => {
    const s = window.sprite8!.getState();
    const anim = s.project.animations[0];
    const out: Record<string, { top: number; bottom: number }> = {};
    for (const [d, track] of Object.entries(anim.tracks)) {
      const img = track.frames[0].image!;
      let top = img.height;
      let bottom = -1;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (img.data[(y * img.width + x) * 4 + 3] > 0) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      out[d] = { top, bottom };
    }
    return { out, anchorY: s.project.cell.anchorY, height: s.project.source!.sprite.height };
  });
  for (const [, m] of Object.entries(metrics.out)) {
    expect(m.bottom + 1).toBe(metrics.anchorY);
    expect(Math.abs(m.bottom - m.top + 1 - metrics.height)).toBeLessThanOrEqual(1);
  }

  // Asymmetry system: the swapped-hands SE render is flagged, NE is fine.
  await page.getByTestId('cell-SE').click();
  await expect(page.getByTestId('consistency-checks')).toContainText('may be mirrored');
  await expect(page.getByTestId('cell-SE').locator('.flag.warn')).toBeVisible();
  await page.getByTestId('cell-NE').click();
  await expect(page.getByTestId('consistency-checks')).toContainText('as expected');

  // Regenerate NE only: every other frame object must stay identical.
  await page.evaluate(() => {
    const anim = window.sprite8!.getState().project.animations[0];
    (window as unknown as { sprite8Before: Record<string, unknown> }).sprite8Before =
      Object.fromEntries(Object.entries(anim.tracks).map(([d, t]) => [d, t.frames[0]]));
  });
  const seedBefore = await page.evaluate(
    () => window.sprite8!.getState().project.animations[0].tracks.NE.frames[0].origin?.seed,
  );
  await page.getByTestId('regenerate-direction').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.sprite8!.getState().project.animations[0].tracks.NE.frames[0].origin?.seed,
      ),
    )
    .not.toBe(seedBefore);
  await expect
    .poll(() => page.evaluate(() => window.sprite8!.getState().ui.generating))
    .toBe(false);
  const identity = await page.evaluate(() => {
    const before = (window as unknown as { sprite8Before: Record<string, unknown> }).sprite8Before;
    const anim = window.sprite8!.getState().project.animations[0];
    return Object.fromEntries(
      Object.entries(anim.tracks).map(([d, t]) => [d, t.frames[0] === before[d]]),
    );
  });
  expect(identity).toEqual({
    N: true,
    NE: false,
    E: true,
    SE: true,
    S: true,
    SW: true,
    W: true,
    NW: true,
  });

  // Undo restores the previous NE.
  await page.getByTestId('undo').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.sprite8!.getState().project.animations[0].tracks.NE.frames[0].origin?.seed,
      ),
    )
    .toBe(seedBefore);

  // Variations are available with an AI provider.
  await page.getByTestId('cell-E').click();
  await page.getByTestId('variation-direction').click();
  await expect
    .poll(() => page.evaluate(() => window.sprite8!.getState().ui.generating))
    .toBe(false);
  await expectStatus(page, 'E', 'ai');

  // Export: eight non-empty cells.
  const zip = await download(page, () => page.getByTestId('export-zip').click());
  const files = readZip(zip.bytes);
  const sheet = png(files.get('hockey_player_sheet.png')!);
  for (let i = 0; i < 8; i++) {
    expect(
      opaqueCount(sheet, { x: (sheet.width / 8) * i, y: 0, w: sheet.width / 8, h: sheet.height }),
    ).toBeGreaterThan(200);
  }
  const meta = JSON.parse(new TextDecoder().decode(files.get('hockey_player.json')));
  expect(Object.keys(meta.directions)).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
});

test('an unreachable provider is reported clearly', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('example-robot').click();
  await page.getByTestId('analyze').click();
  await page.getByTestId('provider-pill').click();
  await page.getByTestId('provider-sprite8-http').click();
  await page.getByTestId('setting-endpoint').fill('http://127.0.0.1:9');
  await page.getByTestId('test-connection').click();
  await expect(page.getByTestId('provider-status')).toContainText('Could not reach');
  await page.getByTestId('provider-done').click();
  await page.getByTestId('generate-all').click();
  await expect(page.getByTestId('toast-error')).toContainText('Could not reach');
  await expect
    .poll(() => page.evaluate(() => window.sprite8!.getState().ui.generating))
    .toBe(false);
  // Nothing was overwritten.
  await expectStatus(page, 'S', 'source');
});
