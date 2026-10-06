import { setSourceDirection, setSymmetry, updateCharacter } from '../../app/actions/project';
import { useAppState } from '../../app/store';
import {
  ART_STYLE_LABELS,
  ATTACHMENT_LABELS,
  CAMERA_LABELS,
  CHARACTER_TYPE_LABELS,
  FEATURE_CATEGORY_LABELS,
  FEATURE_SIDE_LABELS,
  HANDEDNESS_LABELS,
  SHADING_LABELS,
  createFeature,
  type CharacterFeature,
  type CharacterModel,
} from '../../core/character';
import type { SpriteAnalysis } from '../../core/analysis';
import { DIRECTIONS, directionInfo, type Direction } from '../../core/directions';
import type { ProjectSetup } from '../../core/project';
import { characterTree } from '../characterTree';
import { Button, Disclosure, IconButton, Notice, Select, Toggle } from './controls';

function options<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

function Confidence({ value, reason }: { value: number; reason?: string }) {
  const text = value === 0 ? 'not measurable' : value >= 0.85 ? 'detected' : value >= 0.5 ? 'likely' : 'guess';
  return (
    <span className="confidence" title={reason}>
      {text}
    </span>
  );
}

function FeatureRow({ feature, onChange, onRemove }: { feature: CharacterFeature; onChange: (f: CharacterFeature) => void; onRemove: () => void }) {
  return (
    <div className="feature" data-testid="feature-row">
      <input className="input feature-name" value={feature.name} aria-label="Detail name" onChange={(e) => onChange({ ...feature, name: e.target.value })} />
      <IconButton icon="trash" label={`Remove ${feature.name}`} onClick={onRemove} size={16} />
      <Select ariaLabel="Category" value={feature.category} options={options(FEATURE_CATEGORY_LABELS)} onChange={(category) => onChange({ ...feature, category })} />
      <Select ariaLabel="Body side" value={feature.side} options={options(FEATURE_SIDE_LABELS)} onChange={(side) => onChange({ ...feature, side })} testId="feature-side" />
      <Select ariaLabel="Attached to" value={feature.attachment} options={options(ATTACHMENT_LABELS)} onChange={(attachment) => onChange({ ...feature, attachment })} />
    </div>
  );
}

function Facts({ model, analysis, setup }: { model: CharacterModel; analysis: SpriteAnalysis; setup: ProjectSetup }) {
  const set = (patch: Partial<CharacterModel>) => updateCharacter((c) => ({ ...c, ...patch }));
  return (
    <dl className="facts" data-testid="analysis-facts">
      <dt>
        Character type
        <Confidence value={analysis.characterType.confidence} reason={analysis.characterType.reason} />
      </dt>
      <dd>
        <Select ariaLabel="Character type" value={model.type} options={options(CHARACTER_TYPE_LABELS)} onChange={(type) => set({ type })} testId="fact-type" />
      </dd>
      <dt>Source direction</dt>
      <dd>
        <Select<Direction>
          ariaLabel="Source direction"
          value={setup.sourceDirection}
          options={DIRECTIONS.map((d) => ({ value: d, label: `${d} — ${directionInfo(d).view}` }))}
          onChange={(d) => void setSourceDirection(d)}
          testId="fact-source"
        />
      </dd>
      <dt>
        Symmetry
        <span className="confidence" title={analysis.symmetry.reason}>
          image: {analysis.symmetry.verdict}
        </span>
      </dt>
      <dd>
        <Select
          ariaLabel="Symmetry"
          value={setup.symmetry}
          options={[
            { value: 'symmetric', label: 'Symmetric' },
            { value: 'asymmetric', label: 'Asymmetric' },
          ]}
          onChange={(m) => void setSymmetry(m)}
          testId="fact-symmetry"
        />
      </dd>
      <dt>
        Dominant hand
        <Confidence value={analysis.handedness.handedness ? analysis.handedness.confidence : 0} reason={analysis.handedness.reason} />
      </dt>
      <dd>
        <Select ariaLabel="Dominant hand" value={model.handedness} options={options(HANDEDNESS_LABELS)} onChange={(handedness) => set({ handedness })} testId="fact-hand" />
      </dd>
      <dt>
        Camera
        <Confidence value={0} reason={analysis.camera.reason} />
      </dt>
      <dd>
        <Select ariaLabel="Camera" value={model.camera} options={options(CAMERA_LABELS)} onChange={(camera) => set({ camera })} testId="fact-camera" />
      </dd>
      <dt>
        Art style
        <Confidence value={analysis.artStyle.confidence} reason={analysis.artStyle.reason} />
      </dt>
      <dd>
        <Select ariaLabel="Art style" value={model.style.art} options={options(ART_STYLE_LABELS)} onChange={(art) => set({ style: { ...model.style, art, pixelArt: art === 'pixel-art' ? true : model.style.pixelArt } })} testId="fact-style" />
      </dd>
      <dt>
        Shading
        <Confidence value={analysis.shading.confidence} reason={analysis.shading.reason} />
      </dt>
      <dd>
        <Select ariaLabel="Shading" value={model.style.shading} options={options(SHADING_LABELS)} onChange={(shading) => set({ style: { ...model.style, shading } })} />
      </dd>
      <dt>Pixel art</dt>
      <dd>
        <Toggle checked={model.style.pixelArt} onChange={(pixelArt) => set({ style: { ...model.style, pixelArt } })} label={model.style.pixelArt ? 'Preserve pixels' : 'Smooth art'} />
      </dd>
      <dt>Outline</dt>
      <dd>
        {model.style.outline.color && model.style.outline.enabled ? (
          <>
            <span className="swatch" style={{ background: model.style.outline.color }} />
            <span className="small mono">
              {model.style.outline.color} · {model.style.outline.thickness}px
            </span>
          </>
        ) : (
          <span className="small muted">none detected</span>
        )}
      </dd>
      <dt>Proportions</dt>
      <dd className="small">
        {model.proportions.heightPx}×{model.proportions.widthPx}px · {model.proportions.headsTall} heads{' '}
        <span className="confidence">{model.proportions.measured ? 'measured' : 'default'}</span>
      </dd>
    </dl>
  );
}

export function AnalysisPanel() {
  const model = useAppState((s) => s.project.character);
  const analysis = useAppState((s) => s.project.analysis);
  const setup = useAppState((s) => s.project.setup);
  const hasSource = useAppState((s) => !!s.project.source);

  return (
    <section className="card" id="step-analyze" aria-labelledby="analysis-title" data-testid="analysis-panel">
      <div className="card-head">
        <span className="step-num">4</span>
        <h2 id="analysis-title">Analysis</h2>
      </div>
      {!model || !analysis ? (
        <p className="small muted">
          {hasSource
            ? 'Click “Analyze character” to measure silhouette, proportions, palette, outline, shading, symmetry and handedness. You can correct everything before generating.'
            : 'Upload a character to begin.'}
        </p>
      ) : (
        <>
          <Facts model={model} analysis={analysis} setup={setup} />
          <div className="card-sub">
            <h3>Palette ({model.colors.palette.length})</h3>
            <div className="swatches" data-testid="palette">
              {model.colors.palette.map((hex) => (
                <span key={hex} className="swatch" style={{ background: hex }} title={hex} />
              ))}
            </div>
            <p className="small faint">Main colours: {model.colors.dominant.slice(0, 4).map((d) => `${d.name} (${Math.round(d.share * 100)}%)`).join(', ')}</p>
          </div>
          <div className="card-sub">
            <h3>Description (used in AI prompts)</h3>
            <textarea
              className="input"
              value={model.description}
              onChange={(e) => updateCharacter((c) => ({ ...c, description: e.target.value }))}
              aria-label="Character description"
              data-testid="description"
            />
          </div>
          <div className="card-sub">
            <h3>Side-specific details</h3>
            <p className="small faint">Clothing, equipment and accessories with the body side they belong to. Sprite8 keeps them on that side in every direction.</p>
            <div className="feature-list">
              {model.features.map((f) => (
                <FeatureRow
                  key={f.id}
                  feature={f}
                  onChange={(next) => updateCharacter((c) => ({ ...c, features: c.features.map((x) => (x.id === f.id ? next : x)) }))}
                  onRemove={() => updateCharacter((c) => ({ ...c, features: c.features.filter((x) => x.id !== f.id) }))}
                />
              ))}
            </div>
            <div className="row">
              <Button size="small" icon="plus" onClick={() => updateCharacter((c) => ({ ...c, features: [...c.features, createFeature({ name: 'Weapon', side: c.handedness === 'left' ? 'left' : 'right' })] }))} testId="add-feature">
                Add detail
              </Button>
            </div>
          </div>
          {analysis.notes.length ? <Notice kind="info">{analysis.notes.join(' ')}</Notice> : null}
          <Disclosure summary="Character model (persistent reference)" testId="character-model">
            <pre className="tree">{characterTree(model, setup)}</pre>
          </Disclosure>
        </>
      )}
    </section>
  );
}
