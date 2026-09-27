/**
 * Shared UI primitives. Used by BOTH surfaces.
 * Every visual value comes from a token — there is not one colour literal here.
 */

import { useEffect, useRef, type ComponentType, type ReactNode, type ButtonHTMLAttributes, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Inbox, Loader2, X, Ambulance, Shield, Flame, Anchor, TrafficCone, Trash2, Zap,
  Hospital, Landmark, Siren, type LucideProps,
} from 'lucide-react';
import { t } from '../../lib/i18n';
import { dismissToast, useToasts } from '../../lib/stores/toast';
import './ui.scss';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

// ── Button ───────────────────────────────────────────────────────────────────

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `advisory` wears the metallic chrome and is reserved for the Act action. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'advisory';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  iconOnly?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary', size = 'md', block, iconOnly, loading,
  className = '', children, disabled, ...rest
}: ButtonProps) {
  const cls = [
    'u-btn', `u-btn--${variant}`,
    size !== 'md' && `u-btn--${size}`,
    block && 'u-btn--block',
    iconOnly && 'u-btn--icon',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="u-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

// `title` is widened to ReactNode, so it is omitted from the DOM attribute set rather
// than colliding with the native string-only title attribute.
interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  variant?: 'raised' | 'flat' | 'inset';
  flush?: boolean;
  /** Marks the panel as fed by synthesised data. Permanent, not a tooltip. */
  simulated?: boolean;
  children?: ReactNode;
}

export function Card({
  title, subtitle, actions, footer, variant = 'raised', flush, simulated,
  className = '', children, ...rest
}: CardProps) {
  const cls = ['u-card', variant !== 'raised' && `u-card--${variant}`, className]
    .filter(Boolean).join(' ');

  return (
    <div className={cls} {...rest}>
      {(title || actions) && (
        <div className="u-card__head">
          <div>
            {title && <h3 className="u-card__title">{title}</h3>}
            {subtitle && <div className="u-card__sub">{subtitle}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-8)' }}>
            {simulated && <SimulatedChip />}
            {actions}
          </div>
        </div>
      )}
      <div className={`u-card__body${flush ? ' u-card__body--flush' : ''}`}>{children}</div>
      {footer && <div className="u-card__foot">{footer}</div>}
    </div>
  );
}

// ── Chip, dot ────────────────────────────────────────────────────────────────

export function Chip({ tone = 'neutral', children, className = '', ...rest }:
  { tone?: Tone } & HTMLAttributes<HTMLSpanElement>) {
  return <span className={`u-chip u-chip--${tone} ${className}`} {...rest}>{children}</span>;
}

/** "Simulated source" — the honesty marker. Appears on every panel fed by synthesised
 *  or mocked data. Being asked "is this real?" and having the screen already answer is
 *  worth a great deal in front of an authority. */
export function SimulatedChip({ label }: { label?: string }) {
  return (
    <span className="u-chip u-chip--simulated" title="This panel is fed by synthesised data, not a live source">
      {label ?? t('common.simulated')}
    </span>
  );
}

export function Dot({ tone = 'neutral', title }: { tone?: Tone; title?: string }) {
  return <span className={`u-dot u-dot--${tone}`} title={title} aria-hidden />;
}

// ── Segmented control ────────────────────────────────────────────────────────

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="u-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value}
                onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Field ────────────────────────────────────────────────────────────────────

export function Field({ label, help, error, children }: {
  label?: string; help?: string; error?: string; children: ReactNode;
}) {
  return (
    <label className="u-field">
      {label && <span className="u-field__label">{label}</span>}
      {children}
      {error ? <span className="u-field__error">{error}</span>
        : help ? <span className="u-field__help">{help}</span> : null}
    </label>
  );
}

// ── States ───────────────────────────────────────────────────────────────────

export function Skeleton({ height = 16, width = '100%', style, ...rest }:
  { height?: number | string; width?: number | string } & HTMLAttributes<HTMLDivElement>) {
  return <div className="u-skeleton" style={{ height, width, ...style }} {...rest} />;
}

export function EmptyState({ title, body, icon, action }: {
  title: string; body?: string; icon?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="u-empty">
      {icon ?? <Inbox aria-hidden />}
      <div className="u-empty__title">{title}</div>
      {body && <div className="u-empty__body">{body}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: {
  title?: string; body?: string; onRetry?: () => void;
}) {
  return (
    <div className="u-error">
      <AlertTriangle aria-hidden />
      <div className="u-error__title">{title ?? t('common.error')}</div>
      {body && <div className="u-error__body">{body}</div>}
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>{t('common.retry')}</Button>}
    </div>
  );
}

// ── Predicted value ──────────────────────────────────────────────────────────

/**
 * Wraps a value that came from a model. A prediction is NEVER presented as fact:
 * the dotted underline and the title reveal the method and confidence.
 */
export function Predicted({ children, method, confidence, title }: {
  children: ReactNode; method?: string; confidence?: number | null; title?: string;
}) {
  const detail = title ?? [
    method && `Method: ${method}`,
    confidence != null ? `Confidence: ${Math.round(confidence * 100)}%` : 'Confidence: not enough data',
  ].filter(Boolean).join(' · ');
  return <span className="is-predicted" title={detail}>{children}</span>;
}

// ── Modal ────────────────────────────────────────────────────────────────────

/**
 * A dialog over the page. Escape and the backdrop close it; focus moves into it on open
 * and back to where it was on close, so a keyboard user is never stranded.
 */
export function Modal({ title, subtitle, open, onClose, children, footer, width = 520 }: {
  title: ReactNode;
  subtitle?: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.u-modal__close)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="u-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="u-modal__panel" role="dialog" aria-modal="true" ref={panelRef} style={{ maxWidth: width }}>
        <div className="u-modal__head">
          <div>
            <h2 className="u-modal__title">{title}</h2>
            {subtitle && <div className="u-modal__sub">{subtitle}</div>}
          </div>
          <button type="button" className="u-modal__close" onClick={onClose} aria-label={t('common.close')}>
            <X aria-hidden />
          </button>
        </div>
        <div className="u-modal__body">{children}</div>
        {footer && <div className="u-modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────

/** Rendered once by each surface's shell. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="u-toasts" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`u-toast u-toast--${item.level}`} role={item.level === 'danger' ? 'alert' : 'status'}>
          <div className="u-toast__text">
            <div className="u-toast__title">{item.title}</div>
            {item.body && <div className="u-toast__body">{item.body}</div>}
          </div>
          {item.action && (
            <Button size="sm" variant="ghost" onClick={() => { item.action?.run(); dismissToast(item.id); }}>
              {item.action.label}
            </Button>
          )}
          <button type="button" className="u-toast__close" onClick={() => dismissToast(item.id)} aria-label={t('common.close')}>
            <X aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Agency glyph ─────────────────────────────────────────────────────────────

const AGENCY_GLYPHS: Record<string, ComponentType<LucideProps>> = {
  ambulance: Ambulance, shield: Shield, flame: Flame, anchor: Anchor, 'traffic-cone': TrafficCone,
  'trash-2': Trash2, zap: Zap, hospital: Hospital, landmark: Landmark,
};

/** Agency identity: glyph first, colour second (docs/05 §5.3). The name is always there for
 *  a screen reader and on hover — colour alone never carries it. */
export function AgencyGlyph({ glyph, slot, name, size = 14 }: {
  glyph: string | null | undefined; slot?: number | null; name: string; size?: number;
}) {
  const Icon = AGENCY_GLYPHS[glyph ?? ''] ?? Siren;
  return (
    <span className="u-agency" title={name} style={{ color: `var(--series-${Math.min(8, Math.max(1, slot ?? 1))})` }}>
      <Icon width={size} height={size} aria-hidden />
      <span className="u-sr">{name}</span>
    </span>
  );
}

/** A 0..1 value as a thin bar. Never the only encoding — the number sits beside it. */
export function Meter({ value, tone = 'accent', label }: { value: number; tone?: Tone; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className={`u-meter u-meter--${tone}`} role="img" aria-label={label ?? `${Math.round(pct)}%`}>
      <span className="u-meter__fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

export { CctvFeed } from './CctvFeed';
export { AdvisoryStrip, type Finding, type FindingTone } from './AdvisoryStrip';
