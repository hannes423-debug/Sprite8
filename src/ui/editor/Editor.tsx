import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { redo, undo } from '../../app/actions/document';
import { addFrame, commitFrameImage, deleteFrame, stampSilhouette } from '../../app/actions/frames';
import { updateEditorSettings } from '../../app/actions/settings';
import { closeEditor, selectDirection, toast } from '../../app/actions/ui';
import { setUi, useAppState } from '../../app/store';
import { getFrame } from '../../core/animation';
import { describeSide, featureHints } from '../../core/asymmetry';
import { DIRECTIONS, directionInfo, oppositeDirection, rotateDirection, type Direction } from '../../core/directions';
import { activeAnimation } from '../../core/project';
import { createRaster, hexToRgba, rgbaToHex, type Rgba } from '../../core/sprite';
import { EditorController, hasClipboard, type Tool } from '../../editor/controller';
import { decodeImage } from '../../platform/canvas';
import { SIDE_COLORS } from '../canvas/guides';
import { SpriteCanvas } from '../canvas/SpriteCanvas';
import { Button, IconButton, NumberInput, Select, Toggle } from '../components/controls';
import type { IconName } from '../components/Icon';
import { guideSpec, isPixelArt, silhouetteGuideFor } from '../hooks';
import { isTypingTarget } from '../useGlobalShortcuts';
import { EditorStage } from './EditorStage';

const TOOLS: Array<{ id: Tool; icon: IconName; label: string; key: string }> = [
  { id: 'pencil', icon: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', icon: 'bucket', label: 'Fill', key: 'G' },
  { id: 'picker', icon: 'eyedropper', label: 'Eyedropper', key: 'I' },
  { id: 'select', icon: 'select', label: 'Select / move', key: 'M' },
  { id: 'pan', icon: 'hand', label: 'Pan', key: 'H' },
];

type OnionSource = 'none' | 'source' | 'opposite' | 'prev' | 'next' | Direction;

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <div className="editor-section" data-testid={testId}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export default function Editor() {
  const project = useAppState((s) => s.project);
  const direction = useAppState((s) => s.ui.selected);
  const frameIndex = useAppState((s) => s.ui.frame);
  const editorSettings = useAppState((s) => s.settings.editor);
  const anim = activeAnimation(project);
  const frame = getFrame(anim, direction, frameIndex);
  const cell = project.cell;
  const pixelated = isPixelArt(project);
  const blank = useMemo(() => createRaster(cell.width, cell.height), [cell.width, cell.height]);
  const image = frame?.image ?? blank;
  const [panelOpen, setPanelOpen] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [onionSource, setOnionSource] = useState<OnionSource>('source');
  const [recent, setRecent] = useState<string[]>([]);
  const [rotateDeg, setRotateDeg] = useState(15);
  const [scalePct, setScalePct] = useState(100);
  const [opacityPct, setOpacityPct] = useState(50);
  const target = useRef({ direction, frame: frameIndex });
  target.current = { direction, frame: frameIndex };

  const ctlRef = useRef<EditorController | null>(null);
  if (!ctlRef.current) {
    ctlRef.current = new EditorController(image, { x: cell.anchorX, y: cell.anchorY }, {
      commit: (img, label) => commitFrameImage(target.current.direction, target.current.frame, img, label),
      colorPicked: (c) => setRecent((r) => [rgbaToHex(c, true), ...r.filter((x) => x !== rgbaToHex(c, true))].slice(0, 12)),
      notify: (m) => toast('info', m, undefined, 2200),
    });
    ctlRef.current.brushSize = editorSettings.brushSize;
    ctlRef.current.mirrorPaint = editorSettings.mirrorPaint;
    ctlRef.current.overlays.grid = editorSettings.showGrid;
  }
  const ctl = ctlRef.current;
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);

  // Store → editor: new frame (undo, regenerate, switching direction).
  useEffect(() => {
    ctl.setImage(image, { x: cell.anchorX, y: cell.anchorY });
  }, [ctl, image, cell.anchorX, cell.anchorY]);

  // Reference image for onion skin / compare.
  const onionDirection: Direction | null =
    onionSource === 'none'
      ? null
      : onionSource === 'source'
        ? project.setup.sourceDirection
        : onionSource === 'opposite'
          ? oppositeDirection(direction)
          : onionSource === 'prev'
            ? rotateDirection(direction, -1)
            : onionSource === 'next'
              ? rotateDirection(direction, 1)
              : onionSource;
  const onionFrame = onionDirection ? getFrame(anim, onionDirection, frameIndex) : null;
  const onionImage = onionDirection && onionDirection !== direction && onionFrame?.image && onionFrame.status !== 'guide' ? onionFrame.image : null;
  const silhouette = useMemo(() => silhouetteGuideFor(project, direction, frameIndex), [project, direction, frameIndex]);
  const spec = useMemo(
    () => guideSpec(project, direction, false, { proportions: true, sideMarkers: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.cell, project.character, project.source, project.setup.symmetry, direction],
  );

  useEffect(() => {
    ctl.overlays = {
      ...ctl.overlays,
      guides: showGuides ? spec : null,
      onion: editorSettings.onion ? onionImage : null,
      onionAlpha: editorSettings.onionOpacity,
      silhouette: showGuides ? silhouette : null,
      pixelated,
      grid: editorSettings.showGrid,
    };
    ctl.emit();
  }, [ctl, showGuides, spec, onionImage, silhouette, pixelated, editorSettings.onion, editorSettings.onionOpacity, editorSettings.showGrid]);

  // Lock page scroll while editing.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const done = () => {
    ctl.commitFloating();
    closeEditor();
  };

  const switchDirection = (d: Direction) => {
    ctl.commitFloating();
    selectDirection(d);
  };

  const setColor = (c: Rgba) => {
    ctl.color = c;
    ctl.emit();
  };

  const editorSettingsRef = useRef(editorSettings);
  editorSettingsRef.current = editorSettings;

  // Keyboard shortcuts and clipboard.
  useEffect(() => {
    let pendingPaste = false;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (k === ' ' && !e.repeat) {
        ctl.spaceDown = true;
        ctl.emit();
        e.preventDefault();
        return;
      }
      if (mod) {
        const lower = k.toLowerCase();
        if (lower === 'z' || lower === 'y') {
          e.preventDefault();
          if (ctl.cancelFloating()) return;
          if (lower === 'y' || e.shiftKey) redo();
          else undo();
        } else if (lower === 'c') {
          e.preventDefault();
          ctl.copy();
          toast('info', 'Copied.', 'Paste it into any direction with Ctrl+V.', 1600);
        } else if (lower === 'x') {
          e.preventDefault();
          ctl.cut();
        } else if (lower === 'v') {
          pendingPaste = true;
          setTimeout(() => {
            if (pendingPaste) ctl.paste();
            pendingPaste = false;
          }, 0);
        } else if (lower === 'a') {
          e.preventDefault();
          ctl.selectAll();
        }
        return;
      }
      if (e.altKey) return;
      const tool = TOOLS.find((t) => t.key.toLowerCase() === k.toLowerCase());
      if (tool && !e.shiftKey) {
        ctl.setTool(tool.id);
        return;
      }
      switch (k) {
        case 'Escape':
          e.preventDefault();
          if (ctl.cancelFloating()) return;
          if (ctl.selection) ctl.deselect();
          else done();
          return;
        case 'Enter':
          ctl.commitFloating();
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          ctl.deleteSelection();
          return;
        case '[':
          ctl.brushSize = Math.max(1, ctl.brushSize - 1);
          updateEditorSettings({ brushSize: ctl.brushSize });
          ctl.emit();
          return;
        case ']':
          ctl.brushSize = Math.min(32, ctl.brushSize + 1);
          updateEditorSettings({ brushSize: ctl.brushSize });
          ctl.emit();
          return;
        case 'f':
        case 'F':
          ctl.flip(e.shiftKey ? 'v' : 'h');
          return;
        case 'r':
        case 'R':
          ctl.rotate(e.shiftKey ? -90 : 90);
          return;
        case '+':
        case '=':
          ctl.zoomStep(1);
          return;
        case '-':
          ctl.zoomStep(-1);
          return;
        case '0':
          ctl.fit();
          return;
        case 'o':
        case 'O':
          updateEditorSettings({ onion: !editorSettingsRef.current.onion });
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
          const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
          ctl.nudge(dx, dy);
          return;
        }
        default:
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        ctl.spaceDown = false;
        ctl.emit();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      pendingPaste = false;
      void decodeImage(file).then((img) => ctl.paste(img), () => toast('warn', 'Could not read the pasted image.'));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl]);

  const info = directionInfo(direction);
  const historyHasPast = useAppState((s) => s.history.past.length > 0);
  const canUndo = historyHasPast || !!ctl.floating;
  const canRedo = useAppState((s) => s.history.future.length > 0);
  const palette = project.character?.colors.palette ?? [];
  const hex = rgbaToHex(ctl.color, true);
  const hasSel = !!ctl.selection || !!ctl.floating;
  const hints = project.character ? featureHints(project.character.features, direction) : [];
  const frameCount = anim.tracks.N.frames.length;
  const pickColor = (h: string) => {
    const c = hexToRgba(h);
    if (c) setColor(c);
  };

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label={`Edit ${info.name}`} data-testid="editor">
      <div className="editor-top">
        <Button variant="primary" icon="check" onClick={done} testId="editor-done">
          Done
        </Button>
        <div className="editor-title">
          <strong>{direction}</strong>
          <span className="muted">{info.name}</span>
          <span className="faint small hide-sm">
            {cell.width}×{cell.height}
            {ctl.hover && ctl.hover.x >= 0 && ctl.hover.y >= 0 && ctl.hover.x < cell.width && ctl.hover.y < cell.height ? ` · ${ctl.hover.x},${ctl.hover.y}` : ''}
          </span>
        </div>
        <div className="editor-top-actions">
          <IconButton icon="undo" label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => (ctl.cancelFloating() ? undefined : undo())} testId="editor-undo" />
          <IconButton icon="redo" label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} testId="editor-redo" />
          <span className="sep" />
          <IconButton icon="zoomOut" label="Zoom out (−)" onClick={() => ctl.zoomStep(-1)} />
          <span className="zoom-label" data-testid="zoom-label">{Math.round(ctl.view.zoom * 100) / 100}×</span>
          <IconButton icon="zoomIn" label="Zoom in (+)" onClick={() => ctl.zoomStep(1)} />
          <IconButton icon="fit" label="Fit (0)" onClick={() => ctl.fit()} />
          <span className="sep hide-sm" />
          <IconButton icon="grid" label="Pixel grid" active={editorSettings.showGrid} onClick={() => updateEditorSettings({ showGrid: !editorSettings.showGrid })} />
          <IconButton icon="onion" label="Onion skin (O)" active={editorSettings.onion} onClick={() => updateEditorSettings({ onion: !editorSettings.onion })} testId="toggle-onion" />
          <IconButton icon="compass" label="Guides" active={showGuides} onClick={() => setShowGuides((v) => !v)} />
          <IconButton icon="sliders" label="Tools panel" active={panelOpen} onClick={() => setPanelOpen((v) => !v)} testId="toggle-panel" />
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-tools" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <IconButton key={t.id} icon={t.icon} label={`${t.label} (${t.key})`} active={ctl.tool === t.id} onClick={() => ctl.setTool(t.id)} testId={`tool-${t.id}`} />
          ))}
          <span className="tool-sep" />
          <label className="current-color" title="Current colour" style={{ ['--c' as string]: hex }}>
            <input type="color" value={hex.slice(0, 7)} onChange={(e) => pickColor(`${e.target.value}${hex.slice(7) || ''}`)} aria-label="Current colour" data-testid="color-input" />
          </label>
          <span className="brush-size" title="Brush size ([ / ])">{ctl.brushSize}px</span>
        </div>

        <div className="editor-stage">
          <EditorStage ctl={ctl} />
          {ctl.floating ? (
            <div className="floating-bar">
              <span className="small">Floating selection</span>
              <Button size="small" variant="primary" icon="check" onClick={() => ctl.commitFloating()} testId="apply-floating">
                Apply
              </Button>
              <Button size="small" variant="ghost" icon="close" onClick={() => ctl.cancelFloating()}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>

        <aside className={`editor-side${panelOpen ? ' open' : ''}`} aria-label="Editor panel">
          <Section title="Colour" testId="color-section">
            <div className="row nowrap">
              <input className="input mono" value={hex} onChange={(e) => pickColor(e.target.value)} aria-label="Colour hex" />
            </div>
            <label className="small muted">
              Alpha {ctl.color.a}
              <input type="range" min={0} max={255} value={ctl.color.a} onChange={(e) => setColor({ ...ctl.color, a: Number(e.target.value) })} />
            </label>
            {palette.length ? (
              <div className="swatches" data-testid="editor-palette">
                {palette.map((h) => (
                  <button key={h} type="button" className={`swatch${hex.slice(0, 7) === h ? ' active' : ''}`} style={{ background: h }} title={h} onClick={() => pickColor(h)} />
                ))}
              </div>
            ) : null}
            {recent.length ? (
              <div className="swatches">
                {recent.map((h) => (
                  <button key={h} type="button" className="swatch checker" title={h} onClick={() => pickColor(h)}>
                    <span style={{ display: 'block', width: '100%', height: '100%', background: h, borderRadius: 4 }} />
                  </button>
                ))}
              </div>
            ) : null}
          </Section>

          <Section title="Brush">
            <label className="small muted">
              Size {ctl.brushSize}px
              <input
                type="range"
                min={1}
                max={16}
                value={ctl.brushSize}
                onChange={(e) => {
                  ctl.brushSize = Number(e.target.value);
                  updateEditorSettings({ brushSize: ctl.brushSize });
                  ctl.emit();
                }}
              />
            </label>
            <Toggle
              checked={ctl.mirrorPaint}
              onChange={(v) => {
                ctl.mirrorPaint = v;
                updateEditorSettings({ mirrorPaint: v });
                ctl.emit();
              }}
              label="Mirror painting (around the centre line)"
            />
            <Toggle checked={!ctl.fillContiguous} onChange={(v) => { ctl.fillContiguous = !v; ctl.emit(); }} label="Fill replaces colour everywhere" />
          </Section>

          <Section title={hasSel ? 'Selection' : 'Transform frame'} testId="transform-section">
            <div className="tool-grid">
              <IconButton icon="flipH" label={hasSel ? 'Mirror selection horizontally (F)' : 'Mirror frame around the centre line (F)'} onClick={() => ctl.flip('h')} testId="op-flip-h" />
              <IconButton icon="flipV" label="Flip vertically (Shift+F)" onClick={() => ctl.flip('v')} />
              <IconButton icon="rotateCw" label="Rotate 90° clockwise (R)" onClick={() => ctl.rotate(90)} testId="op-rotate" />
              <IconButton icon="rotateCcw" label="Rotate 90° counter-clockwise (Shift+R)" onClick={() => ctl.rotate(-90)} />
              <IconButton icon="copy" label="Copy (Ctrl+C)" onClick={() => ctl.copy()} testId="op-copy" />
              <IconButton icon="scissors" label="Cut (Ctrl+X)" onClick={() => ctl.cut()} disabled={!hasSel} />
              <IconButton icon="paste" label="Paste (Ctrl+V)" onClick={() => ctl.paste()} disabled={!hasClipboard()} testId="op-paste" />
              <IconButton icon="trash" label="Delete selection (Del)" onClick={() => ctl.deleteSelection()} disabled={!hasSel} />
              <IconButton icon="select" label="Select all (Ctrl+A)" onClick={() => ctl.selectAll()} />
              <IconButton icon="crop" label="Crop to selection (clear outside)" onClick={() => ctl.cropToSelection()} disabled={!ctl.selection} testId="op-crop" />
            </div>
            <div className="op-row">
              <span className="small muted">Rotate</span>
              <NumberInput value={rotateDeg} min={-360} max={360} onChange={setRotateDeg} ariaLabel="Rotation in degrees" />
              <Button size="small" onClick={() => ctl.rotate(rotateDeg)}>
                Apply
              </Button>
            </div>
            <div className="op-row">
              <span className="small muted">Scale %</span>
              <NumberInput value={scalePct} min={5} max={1600} onChange={setScalePct} ariaLabel="Scale in percent" testId="scale-input" />
              <Button size="small" onClick={() => ctl.scale(scalePct / 100)} testId="op-scale">
                Apply
              </Button>
            </div>
            <div className="op-row">
              <span className="small muted">Opacity %</span>
              <NumberInput value={opacityPct} min={0} max={100} onChange={setOpacityPct} ariaLabel="Opacity in percent" />
              <Button size="small" onClick={() => ctl.opacity(opacityPct / 100)}>
                Apply
              </Button>
            </div>
          </Section>

          <Section title="Frame">
            <div className="action-row">
              {(direction === 'N' || direction === 'S') && project.setup.symmetry === 'symmetric' ? (
                <>
                  <Button size="small" icon="symmetry" onClick={() => ctl.symmetrize('left')} title="Copy the left half onto the right half">
                    Symmetrize ←
                  </Button>
                  <Button size="small" icon="symmetry" onClick={() => ctl.symmetrize('right')} title="Copy the right half onto the left half">
                    Symmetrize →
                  </Button>
                </>
              ) : null}
              {silhouette ? (
                <Button size="small" icon="stamp" onClick={() => stampSilhouette(direction, ctl.color)} testId="stamp-silhouette" title={`Fill the outline mirrored from ${oppositeDirection(direction)} with the current colour as a base to paint over`}>
                  Stamp outline
                </Button>
              ) : null}
              <Button size="small" icon="trash" variant="ghost" onClick={() => ctl.clearFrame()} testId="clear-frame">
                Clear
              </Button>
            </div>
          </Section>

          <Section title="Reference & onion skin" testId="onion-section">
            <Select<OnionSource>
              ariaLabel="Reference view"
              value={onionSource}
              onChange={setOnionSource}
              options={[
                { value: 'source', label: `Source (${project.setup.sourceDirection})` },
                { value: 'opposite', label: `Opposite (${oppositeDirection(direction)})` },
                { value: 'prev', label: `Previous (${rotateDirection(direction, -1)})` },
                { value: 'next', label: `Next (${rotateDirection(direction, 1)})` },
                ...DIRECTIONS.filter((d) => d !== direction).map((d) => ({ value: d as OnionSource, label: d })),
                { value: 'none', label: 'None' },
              ]}
            />
            <label className="small muted">
              Onion opacity {Math.round(editorSettings.onionOpacity * 100)}%
              <input type="range" min={0.05} max={0.9} step={0.05} value={editorSettings.onionOpacity} onChange={(e) => updateEditorSettings({ onionOpacity: Number(e.target.value), onion: true })} />
            </label>
            {onionImage ? (
              <div className="compare">
                <SpriteCanvas image={onionImage} pixelated={pixelated} className="compare-canvas" ariaLabel={`Reference ${onionDirection}`} />
                <span className="small faint">{onionDirection} for comparison</span>
              </div>
            ) : (
              <span className="small faint">{onionDirection && onionDirection !== direction ? `${onionDirection} has no image yet.` : 'No reference.'}</span>
            )}
          </Section>

          {project.setup.symmetry === 'asymmetric' ? (
            <Section title={`Sides in ${direction}`}>
              <ul className="hints">
                <li>
                  <strong style={{ color: SIDE_COLORS.right }}>R</strong> {describeSide(direction, 'right')}
                </li>
                <li>
                  <strong style={{ color: SIDE_COLORS.left }}>L</strong> {describeSide(direction, 'left')}
                </li>
                {hints
                  .filter((h) => h.screen !== null || h.visibility !== 'n/a')
                  .map((h) => (
                    <li key={h.featureId}>{h.text}</li>
                  ))}
              </ul>
            </Section>
          ) : null}
        </aside>
      </div>

      <div className="editor-strip" role="tablist" aria-label="Directions">
        {DIRECTIONS.map((d) => {
          const f = getFrame(anim, d, frameIndex);
          return (
            <button key={d} type="button" role="tab" aria-selected={d === direction} className={`strip-item${d === direction ? ' active' : ''}`} onClick={() => switchDirection(d)} data-testid={`strip-${d}`} title={directionInfo(d).name}>
              <SpriteCanvas image={f?.image && f.status !== 'guide' ? f.image : null} width={cell.width} height={cell.height} pixelated={pixelated} className="strip-canvas" />
              <span>{d}</span>
            </button>
          );
        })}
        <div className="frame-controls">
          <IconButton icon="chevronLeft" label="Previous frame" disabled={frameIndex === 0} onClick={() => setUi({ frame: frameIndex - 1 })} size={15} />
          <span className="small" data-testid="frame-label">
            Frame {frameIndex + 1}/{frameCount}
          </span>
          <IconButton icon="chevronRight" label="Next frame" disabled={frameIndex >= frameCount - 1} onClick={() => setUi({ frame: frameIndex + 1 })} size={15} />
          <IconButton icon="plus" label="Duplicate frame (all directions)" onClick={() => { ctl.commitFloating(); addFrame(true); }} size={15} testId="add-frame" />
          {frameCount > 1 ? <IconButton icon="trash" label="Delete frame" onClick={() => void deleteFrame()} size={15} /> : null}
        </div>
      </div>
    </div>
  );
}

