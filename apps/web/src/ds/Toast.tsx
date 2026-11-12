import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Button';
import type { StatusTone } from './tokens';
import styles from './Toast.module.css';

export interface ToastInput {
  tone: StatusTone;
  title: string;
  detail?: string;
}

interface ToastApi {
  show(t: ToastInput): void;
}

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 5000;

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

type Item = ToastInput & { id: number };

function ToastItem({ item, onDismiss }: { item: Item; onDismiss(id: number): void }) {
  const isError = item.tone === 'err';
  useEffect(() => {
    if (isError) return undefined;
    const t = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [isError, item.id, onDismiss]);
  return (
    <div className={`${styles.toast} ${styles[item.tone]}`} role={isError ? 'alert' : 'status'}>
      <div className={styles.body}>
        <span className={styles.title}>{item.title}</span>
        {item.detail && <span className={styles.detail}>{item.detail}</span>}
      </div>
      <span className={styles.dismiss}>
        <IconButton icon="x" size="sm" aria-label="Dismiss notification" onClick={() => onDismiss(item.id)} />
      </span>
    </div>
  );
}

/** Hosts the toast region. Shows the newest three; non-error toasts leave after 5 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  const show = useCallback((t: ToastInput) => {
    nextId.current += 1;
    const item = { ...t, id: nextId.current };
    setItems((cur) => [...cur, item].slice(-MAX_VISIBLE));
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <section className={styles.region} aria-label="Notifications">
        {items.map((item) => (
          <ToastItem key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}
