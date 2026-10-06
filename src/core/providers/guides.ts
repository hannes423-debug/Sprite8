import { mirroredDirection } from '../directions';
import { isMirrorDerivable, mirrorFrame, mirrorShortcutAllowed, silhouetteGuideSource } from '../symmetry';
import {
  ProviderError,
  type DirectionResult,
  type ImageGenerationProvider,
  type ViewSnapshot,
} from './types';

const USABLE: ReadonlySet<ViewSnapshot['status']> = new Set(['source', 'ai', 'imported', 'edited']);

/**
 * "Guides only" — the default, always-available, deterministic provider.
 *
 * It does NOT invent unseen sides of a character. For each direction it:
 *   • returns the source sprite for the source direction,
 *   • for symmetric characters with the symmetry shortcut explicitly
 *     enabled, mirrors the partner view (E→W, NE→NW, SE→SW) around the
 *     foot anchor — the only case where a mirror is geometrically correct,
 *   • otherwise leaves the view empty and marks it as "guide": the UI then
 *     shows proportion lines, side markers and (when the opposite view
 *     exists) the exact mirrored outline to draw over.
 */
export const guidesProvider: ImageGenerationProvider = {
  id: 'guides',
  label: 'Guides only (no AI)',
  kind: 'deterministic',
  description:
    'Deterministic, offline and free. Places the source, mirrors partner views for symmetric characters (only when you enable the shortcut) and shows construction guides for the rest. It never pretends to reconstruct unseen sides — draw them in the editor, import images, or connect an AI provider.',
  capabilities: { generatesNewViews: false, variations: false, analysis: false, references: false, seeds: false },
  settingsFields: [],

  async checkStatus() {
    return { ok: true, message: 'Always available — runs entirely in your browser.' };
  },

  async analyzeCharacter() {
    return {};
  },

  async generateDirection(req): Promise<DirectionResult> {
    const { direction, character, views, cell } = req;
    const byDir = new Map(views.map((v) => [v.direction, v]));
    if (direction === character.sourceDirection) {
      const src = byDir.get(direction);
      return { kind: 'source', image: src?.image ?? null };
    }
    if (mirrorShortcutAllowed(character.symmetry, req.options.symmetryShortcut) && isMirrorDerivable(direction)) {
      const partner = mirroredDirection(direction);
      const view = byDir.get(partner);
      if (view && USABLE.has(view.status)) {
        return {
          kind: 'mirror',
          image: mirrorFrame(view.image, cell.anchorX),
          mirroredFrom: partner,
          notes: [`Mirrored from ${partner} (symmetry shortcut).`],
        };
      }
    }
    const available = new Set(views.filter((v) => USABLE.has(v.status)).map((v) => v.direction));
    const silhouette = silhouetteGuideSource(direction, available);
    const notes = [
      'No AI provider: this view needs to be drawn (guides are shown), imported, or generated with an AI provider.',
    ];
    if (silhouette) notes.push(silhouette.reason);
    if (character.symmetry === 'asymmetric') {
      notes.push('Asymmetric character: mirroring is disabled so handedness and one-sided details stay correct.');
    }
    return { kind: 'guide', image: null, notes };
  },

  async generateVariation() {
    throw new ProviderError('Variations need an AI provider.', 'Choose ComfyUI, Stable Diffusion WebUI or a custom server in the provider settings.');
  },
};
