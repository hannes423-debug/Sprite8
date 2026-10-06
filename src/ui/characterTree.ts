import {
  ART_STYLE_LABELS,
  SHADING_LABELS,
  type CharacterFeature,
  type CharacterModel,
} from '../core/character';
import type { ProjectSetup } from '../core/project';

/** Text rendering of the persistent character reference. */
export function characterTree(model: CharacterModel, setup: ProjectSetup): string {
  const p = model.proportions;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const group = (cat: CharacterFeature['category']) => {
    const items = model.features.filter((f) => f.category === cat);
    return items.length
      ? items
          .map(
            (f) =>
              `${f.name} (${f.side}${f.side === 'right' || f.side === 'left' ? ` ${f.attachment}` : ''})`,
          )
          .join(', ')
      : '—';
  };
  const part = (k: keyof CharacterModel['anatomy']) => {
    const a = model.anatomy[k];
    const r = a.region ? `${a.region.width}×${a.region.height}px` : 'not measured';
    return a.description ? `${a.description} · ${r}` : r;
  };
  return [
    `Character Model — ${setup.name}`,
    `├── proportions   ${p.heightPx}×${p.widthPx}px · ${p.headsTall} heads tall${p.measured ? '' : ' (defaults)'}`,
    `│                neck ${pct(p.neckY)} · shoulders ${pct(p.shoulderY)} · hips ${pct(p.hipY)} · knees ${pct(p.kneeY)}`,
    `├── head          ${part('head')}`,
    `├── torso         ${part('torso')}`,
    `├── arms          ${part('arms')}`,
    `├── hands         ${part('hands')}`,
    `├── legs          ${part('legs')}`,
    `├── feet          ${part('feet')}`,
    `├── clothing      ${group('clothing')}`,
    `├── equipment     ${group('equipment')}`,
    `├── accessories   ${group('accessory')}${model.features.some((f) => f.category === 'marking') ? ` · markings: ${group('marking')}` : ''}`,
    `├── colors        ${model.colors.dominant.map((d) => `${d.name} ${d.hex}`).join(', ')}`,
    `├── style         ${ART_STYLE_LABELS[model.style.art]} · ${SHADING_LABELS[model.style.shading]} · outline ${model.style.outline.enabled ? model.style.outline.color : 'none'}`,
    `├── symmetry      ${setup.symmetry}`,
    `└── handedness    ${model.handedness}`,
  ].join('\n');
}
