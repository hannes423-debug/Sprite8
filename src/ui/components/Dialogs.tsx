import { useEffect, useRef, type ReactNode } from 'react';
import { checkProvider, setProvider, updateProviderSettings } from '../../app/actions/generation';
import { closeDialog, dismissToast } from '../../app/actions/ui';
import { useAppState, type DialogState } from '../../app/store';
import { APP_URL } from '../../core/export';
import { PROVIDERS, getProvider, resolveProviderSettings, type ProviderSettingField, type ProviderSettingValue } from '../../core/providers';
import { Button, Disclosure, Field, IconButton, Notice, NumberInput, Toggle } from './controls';
import { Icon } from './Icon';

function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Close"])');
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog${props.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title} data-testid={props.testId}>
        <div className="dialog-head">
          <h2>{props.title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="dialog-body">{props.children}</div>
        {props.footer ? <div className="dialog-foot">{props.footer}</div> : null}
      </div>
    </div>
  );
}

function SettingInput({ field, value, onChange }: { field: ProviderSettingField; value: ProviderSettingValue; onChange: (v: ProviderSettingValue) => void }) {
  if (field.type === 'checkbox') return <Toggle checked={!!value} onChange={onChange} label={field.label} />;
  return (
    <Field label={field.label} help={field.help}>
      {(id) =>
        field.type === 'number' ? (
          <NumberInput id={id} value={Number(value)} min={field.min} max={field.max} step={field.step} onChange={onChange} testId={`setting-${field.key}`} />
        ) : field.type === 'textarea' ? (
          <textarea id={id} className="input code" value={String(value)} onChange={(e) => onChange(e.target.value)} spellCheck={false} data-testid={`setting-${field.key}`} />
        ) : field.type === 'select' ? (
          <select id={id} className="input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            className="input"
            type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
            value={String(value)}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-testid={`setting-${field.key}`}
          />
        )
      }
    </Field>
  );
}

const KIND_LABEL = { deterministic: 'No AI · offline', 'local-ai': 'Local AI', 'remote-ai': 'Remote AI' } as const;

function ProviderDialog() {
  const providerId = useAppState((s) => s.settings.providerId);
  const stored = useAppState((s) => s.settings.providers[providerId]);
  const status = useAppState((s) => s.ui.providerStatus);
  const provider = getProvider(providerId);
  const settings = resolveProviderSettings(provider, stored);
  const basic = provider.settingsFields.filter((f) => !f.advanced);
  const advanced = provider.settingsFields.filter((f) => f.advanced);
  return (
    <Modal
      title="Generation provider"
      onClose={closeDialog}
      wide
      testId="provider-dialog"
      footer={
        <>
          {provider.kind !== 'deterministic' ? (
            <Button icon="refresh" onClick={() => void checkProvider()} busy={status.checking} testId="test-connection">
              Test connection
            </Button>
          ) : null}
          <Button variant="primary" onClick={closeDialog} testId="provider-done">
            Done
          </Button>
        </>
      }
    >
      <p className="small muted">
        Sprite8 is not tied to any AI vendor. Pick how missing directions are produced. Everything else (analysis, consistency checks, editing, export) always runs locally in your browser.
      </p>
      <div className="provider-options" role="radiogroup" aria-label="Provider">
        {PROVIDERS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={p.id === providerId} className="provider-option" onClick={() => setProvider(p.id)} data-testid={`provider-${p.id}`}>
            <span className="radio-dot" />
            <span>
              <span className="title">
                {p.label} <span className="tag">{KIND_LABEL[p.kind]}</span>
              </span>
              <span className="desc">{p.description}</span>
            </span>
          </button>
        ))}
      </div>
      {basic.map((f) => (
        <SettingInput key={f.key} field={f} value={settings[f.key]} onChange={(v) => updateProviderSettings(provider.id, { [f.key]: v })} />
      ))}
      {advanced.length ? (
        <Disclosure summary="Advanced">
          {advanced.map((f) => (
            <SettingInput key={f.key} field={f} value={settings[f.key]} onChange={(v) => updateProviderSettings(provider.id, { [f.key]: v })} />
          ))}
        </Disclosure>
      ) : null}
      {status.status ? (
        <div>
          <div className={`status-line ${status.status.ok ? 'ok' : 'bad'}`} data-testid="provider-status">
            <Icon name={status.status.ok ? 'check' : 'warning'} size={16} />
            <span>{status.status.message}</span>
          </div>
          {status.status.details?.length ? (
            <ul className="status-details">
              {status.status.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {provider.kind !== 'deterministic' ? (
        <Notice kind="info">
          Browsers only allow calls to servers that permit this page (CORS). Running Sprite8 locally with <code>npm run dev</code>? Use the built-in proxies <code>/proxy/comfyui</code>, <code>/proxy/a1111</code> or{' '}
          <code>/proxy/sprite8</code> as the URL instead. Setup guides:{' '}
          <a href={`${APP_URL}/blob/main/docs/providers.md`} target="_blank" rel="noreferrer">
            docs/providers.md
          </a>
          .
        </Notice>
      ) : null}
    </Modal>
  );
}

function HelpDialog() {
  const shortcuts: Array<[string, string]> = [
    ['1 – 8', 'Select N, NE, E, SE, S, SW, W, NW'],
    ['← ↑ → ↓', 'Move around the compass'],
    ['Enter', 'Edit the selected direction'],
    ['Shift + R', 'Regenerate the selected direction'],
    ['Shift + G', 'Generate all directions'],
    ['Ctrl/⌘ + Z · Shift + Z', 'Undo · redo'],
    ['Ctrl/⌘ + S · O', 'Save · open project file'],
    ['?', 'This help'],
  ];
  const editor: Array<[string, string]> = [
    ['B · E · G · I · M · H', 'Pencil · eraser · fill · eyedropper · select · pan'],
    ['Space (hold)', 'Pan'],
    ['[ · ]', 'Brush size'],
    ['Ctrl/⌘ + C · X · V · A', 'Copy · cut · paste · select all'],
    ['F · Shift + F', 'Flip selection horizontally · vertically'],
    ['R · Shift + R', 'Rotate selection 90° clockwise · counter-clockwise'],
    ['Arrows (Shift)', 'Nudge selection 1 px (10 px)'],
    ['Delete · Esc · Enter', 'Clear selection · deselect · apply'],
    ['+ · − · 0', 'Zoom in · out · fit'],
    ['O', 'Toggle onion skin'],
  ];
  return (
    <Modal title="How Sprite8 works" onClose={closeDialog} wide testId="help-dialog" footer={<Button variant="primary" onClick={closeDialog}>Got it</Button>}>
      <div className="help-section">
        <h3>Workflow</h3>
        <ol>
          <li>Upload one character image (transparent PNG works best).</li>
          <li>Choose Symmetric or Asymmetric.</li>
          <li>Select the direction the source faces.</li>
          <li>Analyze, then review and correct the detected information.</li>
          <li>Generate the eight directions.</li>
          <li>Inspect them side by side — warnings flag height, ground, palette and handedness problems.</li>
          <li>Regenerate single directions; the others never change.</li>
          <li>Fix details in the editor.</li>
          <li>Export the sprite sheet, individual PNGs and JSON metadata.</li>
        </ol>
      </div>
      <div className="help-section">
        <h3>What is AI and what is not</h3>
        <ul>
          <li>Analysis, consistency checks, background removal, scaling, palette locking, editing and export are deterministic and run in your browser.</li>
          <li>Seeing the unseen side of a character requires an image model. Sprite8 talks to one you choose (ComfyUI, Stable Diffusion WebUI, or any server speaking the Sprite8 protocol) and never pretends a geometric transform can do it.</li>
          <li>Without a model, Sprite8 gives you construction guides: proportion lines, R/L side markers, the exact mirrored outline of the opposite view, and — only for symmetric characters and only if you enable it — mirrored partner views.</li>
        </ul>
      </div>
      <div className="help-section">
        <h3>Shortcuts</h3>
        <div className="help-grid">
          {shortcuts.map(([k, v]) => (
            <span key={k} style={{ display: 'contents' }}>
              <kbd>{k}</kbd>
              <span className="muted">{v}</span>
            </span>
          ))}
        </div>
        <h3 style={{ marginTop: 8 }}>Editor</h3>
        <div className="help-grid">
          {editor.map(([k, v]) => (
            <span key={k} style={{ display: 'contents' }}>
              <kbd>{k}</kbd>
              <span className="muted">{v}</span>
            </span>
          ))}
        </div>
      </div>
      <p className="small faint">
        Sprite8 is free and open source (MIT).{' '}
        <a href={APP_URL} target="_blank" rel="noreferrer">
          Source code &amp; documentation
        </a>
      </p>
    </Modal>
  );
}

function ConfirmDialog({ dialog }: { dialog: Extract<DialogState, { kind: 'confirm' }> }) {
  return (
    <Modal
      title={dialog.title}
      onClose={() => dialog.resolve('cancel')}
      testId="confirm-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={() => dialog.resolve('cancel')} testId="confirm-cancel">
            Cancel
          </Button>
          {dialog.extraLabel ? (
            <Button onClick={() => dialog.resolve('extra')} testId="confirm-extra">
              {dialog.extraLabel}
            </Button>
          ) : null}
          <Button variant={dialog.danger ? 'danger' : 'primary'} onClick={() => dialog.resolve('confirm')} testId="confirm-ok">
            {dialog.confirmLabel}
          </Button>
        </>
      }
    >
      <p>{dialog.message}</p>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useAppState((s) => s.ui.dialog);
  if (!dialog) return null;
  if (dialog.kind === 'provider') return <ProviderDialog />;
  if (dialog.kind === 'help') return <HelpDialog />;
  return <ConfirmDialog dialog={dialog} />;
}

export function Toasts() {
  const toasts = useAppState((s) => s.ui.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} data-testid={`toast-${t.kind}`}>
          <Icon name={t.kind === 'success' ? 'check' : t.kind === 'error' || t.kind === 'warn' ? 'warning' : 'info'} size={17} />
          <div>
            <div className="msg">{t.message}</div>
            {t.detail ? <div className="detail">{t.detail}</div> : null}
          </div>
          <IconButton icon="close" label="Dismiss" onClick={() => dismissToast(t.id)} size={14} />
        </div>
      ))}
    </div>
  );
}

export function BusyIndicator() {
  const busy = useAppState((s) => s.ui.busy);
  if (!busy) return null;
  return (
    <div className="busy-overlay" role="status" data-testid="busy">
      <span className="spinner" />
      {busy}
    </div>
  );
}
