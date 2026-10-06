import { useEffect, useState } from 'react';
import { redo, undo } from '../../app/actions/document';
import { newProject, openProjectFile, saveProjectFile } from '../../app/actions/project';
import { openDialog } from '../../app/actions/ui';
import { useAppState } from '../../app/store';
import { DIRECTIONS } from '../../core/directions';
import { activeAnimation } from '../../core/project';
import { fullscreenSupported, isFullscreen, toggleFullscreen } from '../../platform/fullscreen';
import { IconButton } from './controls';
import { Icon } from './Icon';

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden>
      <rect width="16" height="16" rx="3" fill="#1d2130" />
      <g fill="#7c9cff">
        <rect x="7" y="1" width="2" height="3" />
        <rect x="7" y="12" width="2" height="3" />
        <rect x="1" y="7" width="3" height="2" />
        <rect x="12" y="7" width="3" height="2" />
      </g>
      <g fill="#4a5578">
        <rect x="3" y="3" width="2" height="2" />
        <rect x="11" y="3" width="2" height="2" />
        <rect x="3" y="11" width="2" height="2" />
        <rect x="11" y="11" width="2" height="2" />
      </g>
      <rect x="6" y="6" width="4" height="4" fill="#f4c27a" />
    </svg>
  );
}

export function Header() {
  const canUndo = useAppState((s) => s.history.past.length > 0);
  const canRedo = useAppState((s) => s.history.future.length > 0);
  const lastSavedAt = useAppState((s) => s.ui.lastSavedAt);
  const hasSource = useAppState((s) => !!s.project.source);
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const onChange = () => setFs(isFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  return (
    <header className="app-header">
      <div className="brand">
        <BrandMark />
        <div style={{ minWidth: 0 }}>
          <h1>Sprite8</h1>
          <div className="tagline">One character → a consistent 8-direction sprite sheet</div>
        </div>
      </div>
      <div className="header-actions">
        {lastSavedAt && hasSource ? <span className="save-state">Saved in this browser</span> : null}
        <IconButton icon="undo" label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} testId="undo" />
        <IconButton icon="redo" label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} testId="redo" />
        <IconButton icon="filePlus" label="New project" onClick={() => void newProject()} testId="new-project" />
        <IconButton icon="folder" label="Open project file (Ctrl+O)" onClick={() => void openProjectFile()} testId="open-project" />
        <IconButton icon="save" label="Save project file (Ctrl+S)" onClick={() => void saveProjectFile()} disabled={!hasSource} testId="save-project" />
        <IconButton icon="help" label="Help & shortcuts (?)" onClick={() => openDialog({ kind: 'help' })} testId="help" />
        {fullscreenSupported() ? (
          <IconButton icon={fs ? 'fullscreenExit' : 'fullscreen'} label={fs ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => void toggleFullscreen()} />
        ) : null}
      </div>
    </header>
  );
}

const STEPS = [
  { id: 'source', label: 'Source' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'generate', label: '8-direction generator' },
  { id: 'inspect', label: 'Inspect & edit' },
  { id: 'export', label: 'Sprite sheet' },
] as const;

/** SOURCE → GENERATOR → N NE E SE S SW W NW → SPRITE SHEET, with progress. */
export function FlowStrip() {
  const hasSource = useAppState((s) => !!s.project.source);
  const analyzed = useAppState((s) => !!s.project.character);
  const filled = useAppState((s) => {
    const anim = activeAnimation(s.project);
    return DIRECTIONS.filter((d) => anim.tracks[d].frames[0]?.image && anim.tracks[d].frames[0].status !== 'guide').length;
  });
  const done = [hasSource, analyzed, filled > 1, filled === 8, false];
  const current = done.findIndex((d) => !d);
  const scrollTo = (id: string) => document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <nav className="flow" aria-label="Workflow">
      {STEPS.map((step, i) => (
        <span key={step.id} style={{ display: 'contents' }}>
          {i > 0 ? <Icon name="arrowRight" size={14} className="flow-arrow" /> : null}
          <button type="button" className={`flow-step${done[i] ? ' done' : ''}${i === current ? ' current' : ''}`} onClick={() => scrollTo(step.id === 'inspect' ? 'generate' : step.id)}>
            <span className="num">{done[i] ? '✓' : i + 1}</span>
            {step.label}
            {step.id === 'inspect' ? <span className="faint">{filled}/8</span> : null}
          </button>
        </span>
      ))}
    </nav>
  );
}
