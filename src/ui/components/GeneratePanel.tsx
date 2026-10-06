import { useMemo } from 'react';
import { cancelGeneration, generateAll } from '../../app/actions/generation';
import { updateCharacter } from '../../app/actions/project';
import { updateGeneration } from '../../app/actions/settings';
import { openDialog } from '../../app/actions/ui';
import { useAppState } from '../../app/store';
import { LOCK_LABELS, characterReference, type StyleLocks } from '../../core/character';
import { buildDirectionPrompt } from '../../core/generation';
import { getProvider } from '../../core/providers';
import { MIRROR_CAVEATS } from '../../core/symmetry';
import {
  Button,
  Disclosure,
  Field,
  Notice,
  NumberInput,
  Segmented,
  Select,
  Toggle,
} from './controls';
import { Icon } from './Icon';

function ProviderPill() {
  const providerId = useAppState((s) => s.settings.providerId);
  const status = useAppState((s) => s.ui.providerStatus.status);
  const provider = getProvider(providerId);
  const dot = provider.kind === 'deterministic' ? '' : status ? (status.ok ? 'ok' : 'bad') : 'ai';
  return (
    <button
      type="button"
      className="provider-pill"
      onClick={() => openDialog({ kind: 'provider' })}
      title="Choose and configure the generation provider"
      data-testid="provider-pill"
    >
      <span className={`dot ${dot}`} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {provider.label}
      </span>
      <Icon name="sliders" size={14} />
    </button>
  );
}

function PromptPreview() {
  const project = useAppState((s) => s.project);
  const selected = useAppState((s) => s.ui.selected);
  const prompt = useMemo(() => {
    if (!project.character) return null;
    return buildDirectionPrompt(characterReference(project.character, project.setup), selected, {
      style: project.generation.promptStyle,
      extraPrompt: project.generation.extraPrompt,
      extraNegative: project.generation.extraNegative,
    });
  }, [project.character, project.setup, project.generation, selected]);
  if (!prompt) return <p className="small faint">Analyze the character to see the prompts.</p>;
  return (
    <div className="card-sub" data-testid="prompt-preview">
      <h3>Prompt for {selected}</h3>
      <textarea
        className="input code"
        readOnly
        value={
          project.generation.promptStyle === 'instruction' ? prompt.instruction : prompt.positive
        }
        style={{ minHeight: 120 }}
        aria-label={`Prompt for ${selected}`}
      />
      <h3>Negative prompt</h3>
      <textarea
        className="input code"
        readOnly
        value={prompt.negative}
        style={{ minHeight: 60 }}
        aria-label="Negative prompt"
      />
    </div>
  );
}

export function GeneratePanel() {
  const generation = useAppState((s) => s.project.generation);
  const symmetry = useAppState((s) => s.project.setup.symmetry);
  const locks = useAppState((s) => s.project.character?.locks ?? null);
  const ready = useAppState((s) => !!s.project.source && !!s.project.character);
  const hasSource = useAppState((s) => !!s.project.source);
  const generating = useAppState((s) => s.ui.generating);
  const providerId = useAppState((s) => s.settings.providerId);
  const provider = getProvider(providerId);

  return (
    <section className="card" id="step-generate" aria-labelledby="generate-title">
      <div className="card-head">
        <span className="step-num">5</span>
        <h2 id="generate-title">8-direction generator</h2>
      </div>
      <div className="generate-bar">
        <ProviderPill />
        {generating ? (
          <Button icon="stop" onClick={cancelGeneration} testId="stop-generation">
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="sparkles"
            disabled={!ready}
            onClick={() => void generateAll()}
            testId="generate-all"
          >
            Generate 8 directions
          </Button>
        )}
      </div>
      {!hasSource ? null : !ready ? (
        <Notice kind="info">
          Analyze the character first — every direction is generated from the same character
          reference.
        </Notice>
      ) : provider.capabilities.generatesNewViews ? (
        <p className="small muted">
          Each direction is generated separately from the source and the character model, then
          conformed: background removed, scaled to the reference height, feet on the anchor
          {locks?.palette ? ', snapped to the palette' : ''}.
        </p>
      ) : (
        <Notice kind="info" testId="no-ai-notice">
          <strong>No AI connected.</strong> A browser algorithm cannot invent the unseen sides of a
          character, so Sprite8 places the source, prepares guides (proportion lines, R/L side
          markers, opposite-view outlines)
          {symmetry === 'symmetric' ? ' and — if you allow it — mirrors partner views' : ''}. Draw
          or import the rest, or{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              openDialog({ kind: 'provider' });
            }}
          >
            connect a local AI provider
          </a>
          .
        </Notice>
      )}

      {symmetry === 'symmetric' ? (
        <div className="card-sub">
          <Toggle
            checked={generation.symmetryShortcut}
            onChange={(v) => updateGeneration({ symmetryShortcut: v })}
            label="Symmetry shortcut: mirror partner views (E↔W, NE↔NW, SE↔SW)"
            testId="symmetry-shortcut"
          />
          {generation.symmetryShortcut ? (
            <p className="small faint">{MIRROR_CAVEATS.join(' ')}</p>
          ) : null}
        </div>
      ) : null}

      <div className="card-sub">
        <h3>Style locks</h3>
        <div className="locks" data-testid="locks">
          {(Object.keys(LOCK_LABELS) as Array<keyof StyleLocks>).map((k) => (
            <button
              key={k}
              type="button"
              className="chip"
              aria-pressed={!!locks?.[k]}
              disabled={!locks}
              onClick={() =>
                updateCharacter((c) => ({ ...c, locks: { ...c.locks, [k]: !c.locks[k] } }))
              }
              title={`Lock ${LOCK_LABELS[k].toLowerCase()} across all eight directions`}
            >
              <Icon name={locks?.[k] ? 'lock' : 'unlock'} size={13} />
              {LOCK_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      <Disclosure summary="Advanced generation settings" testId="advanced-generation">
        <div className="grid-2">
          <Field label="Base seed">
            {(id) => (
              <NumberInput
                id={id}
                value={generation.seed}
                min={0}
                max={2_147_483_646}
                onChange={(seed) => updateGeneration({ seed })}
              />
            )}
          </Field>
          <Field label="Generation size">
            {(id) => (
              <Select
                id={id}
                value={String(generation.generationSize)}
                options={[
                  { value: '512', label: '512 px' },
                  { value: '768', label: '768 px' },
                  { value: '1024', label: '1024 px' },
                ]}
                onChange={(v) => updateGeneration({ generationSize: Number(v) })}
              />
            )}
          </Field>
        </div>
        <Field
          label="Prompt style"
          help="Tags suit Stable Diffusion models; instructions suit image-edit models (e.g. Qwen-Image-Edit, FLUX Kontext)."
        >
          {() => (
            <Segmented
              label="Prompt style"
              value={generation.promptStyle}
              onChange={(promptStyle) => updateGeneration({ promptStyle })}
              options={[
                { value: 'tags', label: 'Tags' },
                { value: 'instruction', label: 'Instruction' },
              ]}
            />
          )}
        </Field>
        <Field label="Scale normalisation">
          {(id) => (
            <Select
              id={id}
              value={generation.scaleMode}
              onChange={(scaleMode) => updateGeneration({ scaleMode })}
              options={[
                { value: 'height', label: 'Match the reference height (recommended)' },
                { value: 'generation', label: 'Keep the generation scale' },
                { value: 'off', label: 'Off' },
              ]}
            />
          )}
        </Field>
        <Field label={`Variation strength: ${Math.round(generation.variationStrength * 100)}%`}>
          {(id) => (
            <input
              id={id}
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={generation.variationStrength}
              onChange={(e) => updateGeneration({ variationStrength: Number(e.target.value) })}
            />
          )}
        </Field>
        <Toggle
          checked={generation.includeReferences}
          onChange={(v) => updateGeneration({ includeReferences: v })}
          label="Send finished views as extra references"
        />
        <Field label="Extra prompt">
          {(id) => (
            <input
              id={id}
              className="input"
              value={generation.extraPrompt}
              onChange={(e) => updateGeneration({ extraPrompt: e.target.value })}
              placeholder="e.g. 16-bit SNES style"
            />
          )}
        </Field>
        <Field label="Extra negative prompt">
          {(id) => (
            <input
              id={id}
              className="input"
              value={generation.extraNegative}
              onChange={(e) => updateGeneration({ extraNegative: e.target.value })}
            />
          )}
        </Field>
        <PromptPreview />
      </Disclosure>
    </section>
  );
}
