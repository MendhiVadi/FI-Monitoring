import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";

export function Modal({ children, onClose, label, style, className }: {
  children: ReactNode; onClose: () => void; label: string; style?: CSSProperties; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    let printing = false;
    let printFocus: HTMLElement | null = null;
    const beforePrint = () => {
      if (!dialog?.open || !dialog.classList.contains("dossier-dialog")) return;
      // Chromium can clip or add empty pages when printing the modal top layer.
      // Keep the same content in normal document flow for the print operation.
      printFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.close();
      dialog.show();
      printing = true;
    };
    const afterPrint = () => {
      if (!printing || !dialog) return;
      printing = false;
      dialog.close();
      dialog.showModal();
      if (printFocus && dialog.contains(printFocus)) printFocus.focus({ preventScroll: true });
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      dialog?.close(); previous?.focus();
    };
  }, []);
  return <dialog ref={ref} className={className} aria-label={label}
    style={{ border: 0, padding: 0, color: "inherit", maxWidth: "96vw", maxHeight: "94vh", ...style }}
    onCancel={event => { event.preventDefault(); close.current(); }}
    onClick={event => { if (event.target === ref.current) close.current(); }}>
    {children}
  </dialog>;
}
