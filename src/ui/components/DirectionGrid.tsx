import { useCallback, useEffect, useMemo, useState } from 'react';
import { chooseBatchImport } from '../../app/actions/frames';
import { updateUiSettings } from '../../app/actions/settings';
import { openEditor, selectDirection } from '../../app/actions/ui';
import { useAppState } from '../../app/store';
import { FRAME_STATUS_LABELS, getFrame } from '../../core/animation';
import { consistencyReport, reportStatus } from '../../core/consistency';
import { DIRECTIONS, directionInfo, type Direction } from '../../core/directions';
import { activeAnimation } from '../../core/project';
import { drawGuideImage, drawGuides } from '../canvas/guides';
import { SpriteCanvas, type Painter } from '../canvas/SpriteCanvas';
import { guideSpec, isPixelArt, silhouetteGuideFor, useFrame, useProject } from '../hooks';
import { DirectionDetails } from './DirectionDetails';
import { Button, IconButton, Segmented } from './controls';
import { Icon } from './Icon';

function DirectionCell({ direction }: { direction: Direction }) {
  const project = useProject();
  const frame = useFrame(direction);
  const frameIndex = useAppState((s) => s.ui.frame);
  const selected = useAppState((s) => s.ui.selected === direction);
  const job = useAppState((s) => s.ui.jobs[direction]);
  const showGuides = useAppState((s) => s.settings.ui.showGuides);
  const showSideMarkers = useAppState((s) => s.settings.ui.showSideMarkers);
  const locked = activeAnimation(project).tracks[direction].locked;
  const pixelated = isPixelArt(project);
  const status = frame?.status ?? 'empty';
  const unfinished = !frame?.image || status === 'guide' || status === 'empty';
  const sourceFrame = getFrame(activeAnimation(project), project.setup.sourceDirection, 0);

  const silhouette = useMemo(
    () => (showGuides && unfinished ? silhouetteGuideFor(project, direction, frameIndex) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showGuides, unfinished, project.animations, project.cell, direction, frameIndex],
  );
  const spec = useMemo(
    () => guideSpec(project, direction, true, { proportions: unfinished, sideMarkers: showSideMarkers && (unfinished || selected) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.cell, project.character, project.source, project.setup.symmetry, direction, unfinished, showSideMarkers, selected],
  );
  const overlay = useCallback<Painter>((ctx, v) => (showGuides ? drawGuides(ctx, v, spec) : undefined), [showGuides, spec]);
  const underlay = useMemo<Painter | undefined>(() => (silhouette ? (ctx, v) => drawGuideImage(ctx, v, silhouette, 0.3, pixelated) : undefined), [silhouette, pixelated]);
  const report = useMemo(
    () =>
      unfinished
        ? null
        : reportStatus(
            consistencyReport({
              frame,
              direction,
              sourceDirection: project.setup.sourceDirection,
              sourceImage: sourceFrame?.image ?? null,
              cell: project.cell,
              character: project.character,
              symmetry: project.setup.symmetry,
            }),
          ),
    [unfinished, frame, direction, project.setup.sourceDirection, sourceFrame, project.cell, project.character, project.setup.symmetry],
  );

  const info = directionInfo(direction);
  const cls = ['dir-cell', selected ? 'selected' : '', job?.state === 'queued' ? 'queued' : '', job?.state === 'running' ? 'running' : ''].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={() => selectDirection(direction)}
      onDoubleClick={() => openEditor(direction)}
      aria-pressed={selected}
      aria-label={`${info.name} (${direction}): ${FRAME_STATUS_LABELS[status]}`}
      data-testid={`cell-${direction}`}
      data-status={status}
    >
      <SpriteCanvas image={frame?.image ?? null} width={project.cell.width} height={project.cell.height} pixelated={pixelated} className="dir-canvas" overlay={overlay} underlay={underlay} />
      <div className="dir-label">
        <span className="dir-name">{direction}</span>
      </div>
      <div className="dir-flags">
        {locked ? (
          <span className="flag" title="Locked: skipped by Generate">
            <Icon name="lock" size={12} />
          </span>
        ) : null}
        {report === 'warn' ? (
          <span className="flag warn" title="Consistency warnings — see details">
            <Icon name="warning" size={12} />
          </span>
        ) : report === 'ok' ? (
          <span className="flag ok" title="Consistent with the reference">
            <Icon name="check" size={12} />
          </span>
        ) : null}
      </div>
      {!job || job.state === 'done' ? <span className={`status-badge status-${status}`}>{FRAME_STATUS_LABELS[status]}</span> : null}
      {job && job.state !== 'done' ? (
        <div className={`dir-job${job.state === 'error' ? ' error' : ''}`}>
          {job.state === 'queued' ? 'Queued' : job.state === 'error' ? `Failed: ${job.error}` : job.message ?? 'Generating…'}
          {job.state === 'running' ? (
            <div className="bar">
              <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

/** Centre of the compass: cycles through the eight views like a turntable. */
function Turntable() {
  const anim = useAppState((s) => activeAnimation(s.project));
  const frame = useAppState((s) => s.ui.frame);
  const cell = useAppState((s) => s.project.cell);
  const pixelated = useAppState((s) => isPixelArt(s.project));
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const available = DIRECTIONS.filter((d) => {
    const f = anim.tracks[d].frames[frame];
    return f?.image && f.status !== 'guide';
  });
  useEffect(() => {
    if (!playing || available.length < 2) return;
    const t = setInterval(() => setI((x) => x + 1), 420);
    return () => clearInterval(t);
  }, [playing, available.length]);
  const d = available.length ? available[i % available.length] : null;
  const image = d ? anim.tracks[d].frames[frame]?.image ?? null : null;
  return (
    <button type="button" className="dir-center" onClick={() => setPlaying((p) => !p)} title={playing ? 'Pause turntable' : 'Play turntable'} data-testid="turntable">
      <SpriteCanvas image={image} width={cell.width} height={cell.height} pixelated={pixelated} className="dir-canvas" checker={false} />
      <div className="turntable-label">
        <span>
          <Icon name={playing ? 'pause' : 'play'} size={11} /> turntable
        </span>
        <span>{d ?? '—'}</span>
      </div>
    </button>
  );
}

export function DirectionGrid() {
  const mode = useAppState((s) => s.settings.ui.gridMode);
  const order = useAppState((s) => s.project.sheet.order);
  const showGuides = useAppState((s) => s.settings.ui.showGuides);
  const showSideMarkers = useAppState((s) => s.settings.ui.showSideMarkers);
  const asymmetric = useAppState((s) => s.project.setup.symmetry === 'asymmetric');
  const hasSource = useAppState((s) => !!s.project.source);

  const compassCells: Array<Direction | 'center'> = Array(9).fill('center');
  for (const d of DIRECTIONS) {
    const { col, row } = directionInfo(d).compass;
    compassCells[row * 3 + col] = d;
  }

  return (
    <section className="card" aria-labelledby="directions-title" data-testid="directions-card">
      <div className="card-head">
        <span className="step-num">6</span>
        <h2 id="directions-title">Directions</h2>
        <div className="card-actions">
          <Segmented
            label="Grid layout"
            value={mode}
            onChange={(gridMode) => updateUiSettings({ gridMode })}
            options={[
              { value: 'compass', label: <Icon name="compass" size={15} />, title: 'Compass layout' },
              { value: 'sheet', label: <Icon name="sheet" size={15} />, title: 'Sheet order (4 × 2)' },
            ]}
          />
          <IconButton icon="grid" label="Show guides" active={showGuides} onClick={() => updateUiSettings({ showGuides: !showGuides })} />
          {asymmetric ? <IconButton icon="symmetry" label="Show R/L side markers" active={showSideMarkers} onClick={() => updateUiSettings({ showSideMarkers: !showSideMarkers })} /> : null}
        </div>
      </div>
      <div className={`direction-grid ${mode}`} data-testid="direction-grid">
        {mode === 'compass'
          ? compassCells.map((c, i) => (c === 'center' ? <Turntable key={`c${i}`} /> : <DirectionCell key={c} direction={c} />))
          : order.map((d) => <DirectionCell key={d} direction={d} />)}
      </div>
      {hasSource ? (
        <div className="row small faint" style={{ justifyContent: 'space-between' }}>
          <span>Click a direction to inspect it · double-click to edit</span>
          <Button size="small" variant="ghost" icon="upload" onClick={() => void chooseBatchImport()} title="Import several views at once — directions are read from file names like hero_NE.png">
            Import views…
          </Button>
        </div>
      ) : null}
      <DirectionDetails />
    </section>
  );
}
