import { useDeferredValue, useMemo } from 'react';
import { copyMetadata, exportIndividualPngs, exportJson, exportSheetPng, exportZip, updateSheet } from '../../app/actions/export';
import { useAppState } from '../../app/store';
import { GRID_PRESETS, ORDER_PRESETS, matchOrderPreset, type GridPresetId, type OrderPresetId } from '../../core/directions';
import { buildSheet } from '../../core/export';
import type { SheetSettings, TargetResolution } from '../../core/project';
import { SpriteCanvas } from '../canvas/SpriteCanvas';
import { Button, Disclosure, Field, Notice, NumberInput, Segmented, Select, Toggle } from './controls';

const TARGETS: Array<{ value: TargetResolution; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: '32', label: '32 px' },
  { value: '48', label: '48 px' },
  { value: '64', label: '64 px' },
  { value: '96', label: '96 px' },
  { value: '128', label: '128 px' },
  { value: 'custom', label: 'Custom…' },
];

function OrderEditor({ settings }: { settings: SheetSettings }) {
  const preset = matchOrderPreset(settings.order);
  const move = (i: number, delta: number) => {
    const order = settings.order.slice();
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    updateSheet({ order });
  };
  return (
    <>
      <Field label="Direction order">
        {(id) => (
          <Select<OrderPresetId>
            id={id}
            value={preset}
            options={[...ORDER_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom order' }]}
            onChange={(v) => {
              const p = ORDER_PRESETS.find((x) => x.id === v);
              if (p) updateSheet({ order: [...p.order] });
            }}
            testId="sheet-order"
          />
        )}
      </Field>
      <div className="order-list" aria-label="Order of directions on the sheet">
        {settings.order.map((d, i) => (
          <span className="order-item" key={d}>
            {d}
            <button type="button" aria-label={`Move ${d} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
              ◀
            </button>
            <button type="button" aria-label={`Move ${d} later`} disabled={i === settings.order.length - 1} onClick={() => move(i, 1)}>
              ▶
            </button>
          </span>
        ))}
      </div>
    </>
  );
}

export function SheetPanel() {
  const project = useAppState((s) => s.project);
  const deferred = useDeferredValue(project);
  const settings = project.sheet;
  const busy = useAppState((s) => s.ui.busy);
  const sheet = useMemo(() => (deferred.source ? buildSheet(deferred) : null), [deferred]);
  const pixelated = settings.pixelPreservation || settings.nearestNeighbor;

  return (
    <section className="card" id="step-export" aria-labelledby="sheet-title" data-testid="sheet-panel">
      <div className="card-head">
        <span className="step-num">9</span>
        <h2 id="sheet-title">Sprite sheet</h2>
      </div>
      <div className="sheet-preview">
        <SpriteCanvas image={sheet?.image ?? null} pixelated={pixelated} className="dir-canvas" testId="sheet-preview" ariaLabel="Sprite sheet preview" />
      </div>
      <div className="sheet-dims" data-testid="sheet-dims">
        {sheet ? (
          <>
            <span>
              {sheet.image.width} × {sheet.image.height}px · {sheet.columns}×{sheet.rows}
            </span>
            <span>
              cell {sheet.cellWidth}×{sheet.cellHeight} · anchor {sheet.anchor.x},{sheet.anchor.y} · ×{Math.round(sheet.scale * 100) / 100}
            </span>
          </>
        ) : (
          <span>Upload a character to build a sheet.</span>
        )}
      </div>
      {sheet?.warnings.length ? <Notice kind="warn">{sheet.warnings.join(' ')}</Notice> : null}

      <div className="grid-2">
        <Field label="Layout">
          {(id) => (
            <Select<GridPresetId> id={id} value={settings.grid} options={GRID_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={(grid) => updateSheet({ grid })} testId="sheet-layout" />
          )}
        </Field>
        <Field label="Cell size">
          {(id) => <Select<TargetResolution> id={id} value={settings.target} options={TARGETS} onChange={(target) => updateSheet({ target })} testId="sheet-target" />}
        </Field>
      </div>
      {settings.grid === 'custom' ? (
        <div className="grid-2">
          <Field label="Columns">{(id) => <NumberInput id={id} value={settings.columns} min={1} max={8} onChange={(columns) => updateSheet({ columns })} />}</Field>
          <Field label="Rows">{(id) => <NumberInput id={id} value={settings.rows} min={1} max={8} onChange={(rows) => updateSheet({ rows })} />}</Field>
        </div>
      ) : null}
      {settings.target === 'custom' ? (
        <div className="grid-2">
          <Field label="Cell width">{(id) => <NumberInput id={id} value={settings.customWidth} min={4} max={1024} onChange={(customWidth) => updateSheet({ customWidth })} />}</Field>
          <Field label="Cell height">{(id) => <NumberInput id={id} value={settings.customHeight} min={4} max={1024} onChange={(customHeight) => updateSheet({ customHeight })} />}</Field>
        </div>
      ) : null}

      <div className="card-sub">
        <Toggle
          checked={settings.pixelPreservation}
          onChange={(pixelPreservation) => updateSheet({ pixelPreservation })}
          label="Pixel preservation (integer scaling, hard edges)"
          testId="pixel-preservation"
        />
        <Toggle
          checked={settings.nearestNeighbor}
          disabled={settings.pixelPreservation}
          onChange={(nearestNeighbor) => updateSheet({ nearestNeighbor })}
          label="Nearest-neighbour scaling"
          testId="nearest-neighbor"
        />
      </div>

      <Field label="Export scale">
        {() => (
          <Segmented
            label="Export scale"
            value={String(settings.exportScale)}
            onChange={(v) => updateSheet({ exportScale: Number(v) })}
            options={['1', '2', '3', '4'].map((v) => ({ value: v, label: `${v}×`, testId: `export-scale-${v}` }))}
          />
        )}
      </Field>

      <Disclosure summary="Order, padding, anchor & background" testId="sheet-advanced">
        <OrderEditor settings={settings} />
        <div className="grid-2">
          <Field label="Padding (px)">{(id) => <NumberInput id={id} value={settings.padding} min={0} max={64} onChange={(padding) => updateSheet({ padding })} testId="sheet-padding" />}</Field>
          <Field label="Spacing between cells">{(id) => <NumberInput id={id} value={settings.spacing} min={0} max={64} onChange={(spacing) => updateSheet({ spacing })} />}</Field>
        </div>
        <Field label="Anchor point" help="The point between the feet on the ground line. Engines use it as the sprite origin.">
          {(id) => (
            <Select
              id={id}
              value={settings.anchorMode}
              onChange={(anchorMode) => updateSheet({ anchorMode })}
              options={[
                { value: 'bottom-center', label: 'Bottom centre (feet)' },
                { value: 'center', label: 'Cell centre' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          )}
        </Field>
        {settings.anchorMode === 'custom' ? (
          <div className="grid-2">
            <Field label="Anchor x">{(id) => <NumberInput id={id} value={settings.anchorX} min={0} max={1024} onChange={(anchorX) => updateSheet({ anchorX })} />}</Field>
            <Field label="Anchor y">{(id) => <NumberInput id={id} value={settings.anchorY} min={0} max={1024} onChange={(anchorY) => updateSheet({ anchorY })} />}</Field>
          </div>
        ) : null}
        <Field label="Centring">
          {(id) => (
            <Select
              id={id}
              value={settings.align}
              onChange={(align) => updateSheet({ align })}
              options={[
                { value: 'feet', label: 'Auto-centre on the feet (consistent ground position)' },
                { value: 'as-is', label: 'Keep positions as edited' },
              ]}
            />
          )}
        </Field>
        <Field label="Background">
          {() => (
            <div className="row">
              <Segmented
                label="Background"
                value={settings.background}
                onChange={(background) => updateSheet({ background })}
                options={[
                  { value: 'transparent', label: 'Transparent' },
                  { value: 'color', label: 'Colour' },
                ]}
              />
              {settings.background === 'color' ? (
                <input type="color" value={settings.backgroundColor} onChange={(e) => updateSheet({ backgroundColor: e.target.value })} aria-label="Background colour" />
              ) : null}
            </div>
          )}
        </Field>
        {sheet && sheet.frameCount > 1 ? (
          <Field label="Animation frames">
            {(id) => (
              <Select
                id={id}
                value={settings.frameLayout}
                onChange={(frameLayout) => updateSheet({ frameLayout })}
                options={[
                  { value: 'direction-rows', label: 'One row per direction' },
                  { value: 'direction-columns', label: 'One column per direction' },
                ]}
              />
            )}
          </Field>
        ) : null}
      </Disclosure>

      <div className="export-buttons">
        <Button variant="primary" icon="download" disabled={!project.source || !!busy} onClick={() => void exportZip()} testId="export-zip">
          Download all (ZIP)
        </Button>
        <Button icon="sheet" disabled={!project.source || !!busy} onClick={() => void exportSheetPng()} testId="export-sheet">
          Sheet PNG
        </Button>
        <Button icon="layers" disabled={!project.source || !!busy} onClick={() => void exportIndividualPngs()} testId="export-individual">
          8 PNGs
        </Button>
        <Button icon="download" disabled={!project.source || !!busy} onClick={() => void exportJson()} testId="export-json">
          JSON
        </Button>
        <Button icon="copy" disabled={!project.source || !!busy} onClick={() => void copyMetadata()}>
          Copy JSON
        </Button>
      </div>
    </section>
  );
}
