import { useEffect, useState, useCallback } from 'react';

/**
 * Global keyboard shortcuts.
 * - g + c → /clients
 * - g + p → /projects
 * - g + i → /invoices
 * - n + p → new project (/projects?create=true)
 * - n + c → new client (/clients?create=true)
 * - n + i → new invoice (/invoices?create=true)
 * - ? → show shortcuts modal
 */
export function useKeyboardShortcuts(navigate) {
  const [showModal, setShowModal] = useState(false);

  const openModal = useCallback(() => setShowModal(true), []);
  const closeModal = useCallback(() => setShowModal(false), []);

  useEffect(() => {
    let firstKey = null;
    let timeout = null;

    const clear = () => {
      firstKey = null;
      if (timeout) clearTimeout(timeout);
    };

    const handler = (e) => {
      // Ignore when typing in inputs/textarea
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
        return;
      }

      // Show shortcuts modal
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowModal(prev => !prev);
        return;
      }

      if (firstKey) {
        const combo = `${firstKey}+${e.key.toLowerCase()}`;
        if (combo === 'g+c') { navigate('/clients'); e.preventDefault(); }
        else if (combo === 'g+p') { navigate('/projects'); e.preventDefault(); }
        else if (combo === 'g+i') { navigate('/invoices'); e.preventDefault(); }
        else if (combo === 'n+p') { navigate('/projects?create=true'); e.preventDefault(); }
        else if (combo === 'n+c') { navigate('/clients?create=true'); e.preventDefault(); }
        else if (combo === 'n+i') { navigate('/invoices?create=true'); e.preventDefault(); }
        clear();
        return;
      }

      if (e.key.toLowerCase() === 'g' || e.key.toLowerCase() === 'n') {
        firstKey = e.key.toLowerCase();
        timeout = setTimeout(clear, 1000);
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (timeout) clearTimeout(timeout);
    };
  }, [navigate]);

  return { showModal, openModal, closeModal };
}
