import { useState, type DragEvent } from 'react';
import {
  analyze,
  chooseSourceFile,
  importSourceFile,
  loadExample,
  setSourceDirection,
  setSymmetry,
} from '../../app/actions/project';
import { importDirectionFiles } from '../../app/actions/frames';
import { useAppState } from '../../app/store';
import { directionInfo } from '../../core/directions';
import { isImageFile } from '../../platform/files';
import { SpriteCanvas } from '../canvas/SpriteCanvas';
import { EXAMPLES } from '../examples';
import { Button, Notice, Segmented } from './controls';
import { CompassPicker } from './CompassPicker';
import { Icon } from './Icon';

export function SourcePanel() {
  const source = useAppState((s) => s.project.source);
  const setup = useAppState((s) => s.project.setup);
  const analyzed = useAppState((s) => !!s.project.character);
  const analyzing = useAppState((s) => s.ui.analyzing);
  const [drag, setDrag] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const files = Array.from(e.dataTransfer.files).filter(isImageFile);
    if (files.length === 1) void importSourceFile(files[0]);
    else if (files.length > 1) void importDirectionFiles(files);
  };

  return (
    <section className="card" id="step-source" aria-labelledby="source-title">
      <div className="card-head">
        <span className="step-num">1</span>
        <h2 id="source-title">Source</h2>
        {source ? (
          <div className="card-actions">
            <Button
              size="small"
              icon="upload"
              onClick={() => void chooseSourceFile()}
              testId="replace-source"
            >
              Replace
            </Button>
          </div>
        ) : null}
      </div>

      <div
        className={`dropzone${drag ? ' drag' : ''}${source ? ' has-image' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={source ? undefined : () => void chooseSourceFile()}
        role={source ? undefined : 'button'}
        tabIndex={source ? undefined : 0}
        onKeyDown={(e) => {
          if (!source && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            void chooseSourceFile();
          }
        }}
        data-testid="dropzone"
      >
        {source ? (
          <SpriteCanvas
            image={source.sprite}
            pixelated={source.import.pixelArt}
            className="source-preview"
            testId="source-preview"
            ariaLabel="Source sprite preview"
          />
        ) : (
          <div className="dropzone-empty">
            <Icon name="upload" size={30} />
            <strong>Upload one character image</strong>
            <span className="small">PNG with transparency works best · drop, tap or paste</span>
          </div>
        )}
      </div>
      {/* Hidden input for automation and keyboard users. */}
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        data-testid="source-file-input"
        aria-label="Upload source image"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importSourceFile(f);
          e.target.value = '';
        }}
      />

      {source ? (
        <div className="source-meta" data-testid="source-meta">
          <span className="tag" title={source.fileName}>
            <Icon name="image" size={12} /> {source.sprite.width}×{source.sprite.height}px
          </span>
          {source.import.pixelScale > 1 ? (
            <span className="tag">upscaled {source.import.pixelScale}× → native</span>
          ) : null}
          <span className="tag">{source.import.pixelArt ? 'pixel art' : 'high-res art'}</span>
          {source.import.background === 'removed' ? (
            <span className="tag">background removed</span>
          ) : null}
          {source.import.background === 'kept' ? (
            <span className="tag" style={{ color: 'var(--warn)' }}>
              no transparency
            </span>
          ) : null}
        </div>
      ) : (
        <div className="card-sub">
          <h3>Or try an example</h3>
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <Button
                key={ex.id}
                size="small"
                onClick={() => void loadExample(ex.url, ex.fileName, ex.hints)}
                testId={`example-${ex.id}`}
              >
                {ex.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="card-sub">
        <h3>2 · Character symmetry</h3>
        <Segmented
          label="Character symmetry"
          block
          value={setup.symmetry}
          onChange={(m) => void setSymmetry(m)}
          options={[
            {
              value: 'symmetric',
              label: 'Symmetric',
              testId: 'symmetry-symmetric',
              title: 'Left and right side look the same (generic NPC, robot, basic knight)',
            },
            {
              value: 'asymmetric',
              label: 'Asymmetric',
              testId: 'symmetry-asymmetric',
              title: 'Sides differ (weapon hand, hockey stick, one shoulder pad, scars)',
            },
          ]}
        />
        <p className="small muted">
          {setup.symmetry === 'asymmetric'
            ? 'Each side keeps its identity: a right-handed character stays right-handed in every direction. Sprite8 never mirrors this character.'
            : 'Left and right sides look alike. Mirroring partner views (E↔W, NE↔NW, SE↔SW) can be enabled as an explicit shortcut.'}
        </p>
      </div>

      <div className="card-sub">
        <h3>3 · Source direction</h3>
        <CompassPicker
          label="Source direction"
          value={setup.sourceDirection}
          onChange={(d) => void setSourceDirection(d)}
          testIdPrefix="source-dir"
        />
        <p className="small muted" style={{ textAlign: 'center' }}>
          The uploaded image shows the character facing{' '}
          <strong>{directionInfo(setup.sourceDirection).name}</strong> (
          {directionInfo(setup.sourceDirection).view}).
        </p>
      </div>

      <Button
        variant={source && !analyzed ? 'primary' : 'secondary'}
        icon="wand"
        block
        disabled={!source}
        busy={analyzing}
        onClick={() => void analyze()}
        testId="analyze"
      >
        {analyzed ? '4 · Re-analyze character' : '4 · Analyze character'}
      </Button>
      {source?.import.background === 'kept' ? (
        <Notice kind="warn">
          This image has no transparent or uniform background. The background stays part of the
          sprite; a transparent PNG gives much better results.
        </Notice>
      ) : null}
    </section>
  );
}
