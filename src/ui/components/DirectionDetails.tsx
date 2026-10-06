import { useMemo } from 'react';
import { exportDirectionPng } from '../../app/actions/export';
import { chooseDirectionImport, clearDirection, deriveMirror, toggleLock } from '../../app/actions/frames';
import { dismissJob, regenerate } from '../../app/actions/generation';
import { openEditor } from '../../app/actions/ui';
import { useAppState } from '../../app/store';
import { FRAME_STATUS_LABELS, getFrame } from '../../core/animation';
import { describeSide, featureHints } from '../../core/asymmetry';
import { consistencyReport } from '../../core/consistency';
import { directionInfo, mirroredDirection, oppositeDirection } from '../../core/directions';
import { activeAnimation } from '../../core/project';
import { getProvider } from '../../core/providers';
import { SIDE_COLORS } from '../canvas/guides';
import { useFrame, useProject } from '../hooks';
import { Button, Disclosure, Notice } from './controls';
import { Icon } from './Icon';

const CHECK_ICON = { ok: 'check', warn: 'warning', info: 'info' } as const;

export function DirectionDetails() {
  const project = useProject();
  const direction = useAppState((s) => s.ui.selected);
  const frame = useFrame(direction);
  const job = useAppState((s) => s.ui.jobs[direction]);
  const generating = useAppState((s) => s.ui.generating);
  const providerId = useAppState((s) => s.settings.providerId);
  const provider = getProvider(providerId);
  const anim = activeAnimation(project);
  const locked = anim.tracks[direction].locked;
  const info = directionInfo(direction);
  const status = frame?.status ?? 'empty';
  const isSource = direction === project.setup.sourceDirection;
  const hasPixels = !!frame?.image && status !== 'guide' && status !== 'empty';
  const partner = mirroredDirection(direction);
  const partnerFrame = getFrame(anim, partner, 0);
  const canMirror =
    project.setup.symmetry === 'symmetric' && partner !== direction && !!partnerFrame?.image && partnerFrame.status !== 'guide' && partnerFrame.status !== 'mirror';
  const ready = !!project.character;
  const sourceImage = useAppState((s) => getFrame(activeAnimation(s.project), s.project.setup.sourceDirection, 0)?.image ?? null);

  const { cell, character } = project;
  const { sourceDirection, symmetry } = project.setup;
  const checks = useMemo(
    () => consistencyReport({ frame, direction, sourceDirection, sourceImage, cell, character, symmetry }),
    [frame, direction, sourceDirection, sourceImage, cell, character, symmetry],
  );
  const hints = useMemo(() => (character ? featureHints(character.features, direction) : []), [character, direction]);

  if (!project.source) return null;
  const origin = frame?.origin;
  const originText =
    status === 'ai'
      ? `${origin?.providerLabel ?? 'AI'}${origin?.seed !== undefined ? ` · seed ${origin.seed}` : ''}`
      : status === 'mirror'
        ? `Mirrored from ${origin?.mirroredFrom ?? partner}`
        : status === 'imported'
          ? `From ${origin?.fileName ?? 'an imported image'}`
          : status === 'source'
            ? `Uploaded source (${project.source.fileName})`
            : status === 'edited'
              ? `Edited${origin?.kind && origin.kind !== 'manual' ? ` (was ${FRAME_STATUS_LABELS[origin.kind === 'guide' ? 'guide' : origin.kind]})` : ''}`
              : status === 'guide'
                ? 'Guides only — no pixels yet'
                : 'Empty';

  return (
    <div className="details" data-testid="direction-details">
      <div className="details-head">
        <h3>
          {direction} · {info.name}
        </h3>
        <span className="muted small">{info.view}</span>
      </div>
      <div className="row small">
        <span className={`tag status-${status}`} style={{ borderColor: 'currentColor' }} data-testid="detail-status">
          {FRAME_STATUS_LABELS[status]}
        </span>
        <span className="muted">{originText}</span>
        {locked ? (
          <span className="tag">
            <Icon name="lock" size={11} /> locked
          </span>
        ) : null}
      </div>

      <div className="action-row">
        <Button variant="primary" icon="pencil" onClick={() => openEditor(direction)} testId="edit-direction">
          Edit
        </Button>
        <Button icon="refresh" disabled={!ready || generating || isSource} onClick={() => void regenerate(direction)} testId="regenerate-direction" title={isSource ? 'The source direction is the reference' : `Regenerate only ${direction}`}>
          Regenerate {direction}
        </Button>
        {provider.capabilities.variations ? (
          <Button icon="shuffle" disabled={!ready || generating || !hasPixels || isSource} onClick={() => void regenerate(direction, 'variation')} testId="variation-direction">
            Variation
          </Button>
        ) : null}
        <Button icon="upload" onClick={() => void chooseDirectionImport(direction)} testId="import-direction" title="Import your own image for this direction (drawn elsewhere or made with another tool)">
          Import image
        </Button>
        {canMirror ? (
          <Button icon="mirror" onClick={() => void deriveMirror(direction)} testId="mirror-direction" title="Symmetry shortcut for symmetric characters">
            Mirror {partner}
          </Button>
        ) : null}
        <Button icon={locked ? 'unlock' : 'lock'} variant="ghost" onClick={() => toggleLock(direction)} testId="lock-direction">
          {locked ? 'Unlock' : 'Lock'}
        </Button>
        <Button icon="download" variant="ghost" disabled={!hasPixels} onClick={() => void exportDirectionPng(direction)}>
          PNG
        </Button>
        <Button icon="trash" variant="ghost" disabled={!frame?.image || isSource} onClick={() => clearDirection(direction)} testId="clear-direction">
          Clear
        </Button>
      </div>

      {job?.state === 'error' ? (
        <Notice kind="warn">
          <strong>{job.error}</strong>
          {job.hint ? <div>{job.hint}</div> : null}
          <button type="button" className="btn small ghost" onClick={() => dismissJob(direction)} style={{ marginTop: 6 }}>
            Dismiss
          </button>
        </Notice>
      ) : null}

      {status === 'guide' || status === 'empty' ? (
        <Notice kind="info">
          {provider.capabilities.generatesNewViews
            ? `Generate ${direction} with ${provider.label}, draw it in the editor, or import an image.`
            : `Draw ${direction} in the editor (guides, side markers${getFrame(anim, oppositeDirection(direction), 0)?.image ? ` and the outline mirrored from ${oppositeDirection(direction)}` : ''} help), import an image, or connect an AI provider.`}
        </Notice>
      ) : null}

      {project.setup.symmetry === 'asymmetric' ? (
        <div className="card-sub">
          <h3>Where each side goes in {direction}</h3>
          <ul className="hints" data-testid="side-hints">
            <li>
              <strong style={{ color: SIDE_COLORS.right }}>R</strong> {describeSide(direction, 'right')}
            </li>
            <li>
              <strong style={{ color: SIDE_COLORS.left }}>L</strong> {describeSide(direction, 'left')}
            </li>
            {hints.filter((h) => h.screen !== null || h.visibility !== 'n/a').map((h) => (
              <li key={h.featureId}>{h.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card-sub">
        <h3>Consistency</h3>
        <ul className="checks" data-testid="consistency-checks">
          {checks.map((c) => (
            <li key={c.id}>
              <Icon name={CHECK_ICON[c.status]} size={15} className={c.status} />
              <span className="label">{c.label}</span>
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
      </div>

      {origin?.notes?.length ? (
        <Disclosure summary="Generation notes">
          <ul className="hints">
            {origin.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
      {origin?.prompt ? (
        <Disclosure summary="Prompt used">
          <textarea className="input code" readOnly value={origin.prompt} style={{ minHeight: 100 }} aria-label="Prompt used" />
        </Disclosure>
      ) : null}
    </div>
  );
}
