import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Button(props: {
  children?: ReactNode;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'normal' | 'big';
  block?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  testId?: string;
  busy?: boolean;
  type?: 'button' | 'submit';
}) {
  const cls = ['btn', props.variant && props.variant !== 'secondary' ? props.variant : '', props.size && props.size !== 'normal' ? props.size : '', props.block ? 'block' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type={props.type ?? 'button'} className={cls} disabled={props.disabled || props.busy} title={props.title} onClick={props.onClick} data-testid={props.testId}>
      {props.busy ? <span className="spinner" /> : props.icon ? <Icon name={props.icon} size={props.size === 'small' ? 15 : 17} /> : null}
      {props.children}
    </button>
  );
}

export function IconButton(props: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${props.active ? ' active' : ''}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active === undefined ? undefined : props.active}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testId}
    >
      <Icon name={props.icon} size={props.size ?? 18} />
    </button>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string; testId?: string }>;
  onChange: (value: T) => void;
  label: string;
  block?: boolean;
}) {
  return (
    <div className={`seg${props.block ? ' block' : ''}`} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          title={o.title}
          data-testid={o.testId}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; testId?: string; title?: string }) {
  return (
    <label className="toggle" title={props.title}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} data-testid={props.testId} />
      <span className="track" />
      <span>{props.label}</span>
    </label>
  );
}

export function Field(props: { label: ReactNode; help?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
      {props.help ? <div className="field-help">{props.help}</div> : null}
    </div>
  );
}

export function Select<T extends string>(props: {
  id?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  testId?: string;
  ariaLabel?: string;
}) {
  return (
    <select id={props.id} className="input" value={props.value} onChange={(e) => props.onChange(e.target.value as T)} data-testid={props.testId} aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberInput(props: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  testId?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      id={props.id}
      className="input"
      type="number"
      inputMode="decimal"
      value={Number.isFinite(props.value) ? props.value : ''}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      aria-label={props.ariaLabel}
      data-testid={props.testId}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v)) {
          const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v));
          props.onChange(clamped);
        }
      }}
    />
  );
}

export function Notice(props: { kind?: 'info' | 'warn' | 'ok'; children: ReactNode; testId?: string }) {
  const kind = props.kind ?? 'info';
  return (
    <div className={`notice ${kind}`} data-testid={props.testId}>
      <Icon name={kind === 'warn' ? 'warning' : kind === 'ok' ? 'check' : 'info'} size={16} />
      <div>{props.children}</div>
    </div>
  );
}

export function Disclosure(props: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  return (
    <details className="disclosure" open={props.defaultOpen} data-testid={props.testId}>
      <summary>{props.summary}</summary>
      <div className="disclosure-body">{props.children}</div>
    </details>
  );
}
