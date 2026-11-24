import { useEffect, useRef, type Dispatch, type MouseEvent, type SetStateAction } from 'react';

/**
 * Windows Explorer–style multi-selection for a list of items identified by keys:
 * - Ctrl+click toggles one item,
 * - Shift+click selects every item between the anchor (last plain/Ctrl click) and this one,
 * - Ctrl+Shift+click adds that range to the current selection,
 * - Ctrl+A selects all items, Escape clears the selection (when `keyboardEnabled`).
 * A plain click keeps the view's own behaviour (open preview / enter folder).
 */
export function useExplorerSelection(
  orderedKeys: string[],
  setSelected: Dispatch<SetStateAction<string[]>>,
  keyboardEnabled: boolean
) {
  const anchorRef = useRef<string | null>(null);
  const orderedRef = useRef(orderedKeys);
  orderedRef.current = orderedKeys;

  const selectRange = (key: string, additive: boolean) => {
    const ordered = orderedRef.current;
    const anchor = anchorRef.current;
    const from = anchor ? ordered.indexOf(anchor) : -1;
    const to = ordered.indexOf(key);
    const range =
      from >= 0 && to >= 0 ? ordered.slice(Math.min(from, to), Math.max(from, to) + 1) : [key];
    if (from < 0) anchorRef.current = key;
    setSelected((prev) => (additive ? Array.from(new Set([...prev, ...range])) : range));
  };

  const toggle = (key: string) => {
    anchorRef.current = key;
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  /** Click on an item: handles Ctrl/Shift, otherwise runs onPlainClick. */
  const handleItemClick = (e: MouseEvent, key: string, onPlainClick: () => void) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      selectRange(key, ctrl);
      return;
    }
    if (ctrl) {
      toggle(key);
      return;
    }
    anchorRef.current = key;
    onPlainClick();
  };

  /** Click on an item's checkbox: toggles it, or selects a range with Shift. */
  const handleCheckboxClick = (e: MouseEvent, key: string) => {
    e.stopPropagation();
    if (e.shiftKey) {
      selectRange(key, true);
      return;
    }
    toggle(key);
  };

  /** Stops the browser from highlighting text while Shift-clicking items. */
  const preventShiftTextSelection = (e: MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
  };

  useEffect(() => {
    if (!keyboardEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected([...orderedRef.current]);
      } else if (e.key === 'Escape') {
        setSelected([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardEnabled, setSelected]);

  return { handleItemClick, handleCheckboxClick, preventShiftTextSelection };
}
