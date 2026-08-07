import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import {
  DOCUMENT_FONTS,
  ensureFontLoaded,
  FONT_TAG_ORDER,
  getFontCatalogEntry,
  isFontReady,
  quoteFontFamily,
  type FontCatalogEntry,
} from '../text/fonts';

interface FontPickerProps {
  value: string;
  onPick: (entry: FontCatalogEntry) => void;
}

/**
 * The gooey font menu: every family renders in its own face, loaded lazily from the bundled
 * woff2 set while the popover is open. A family the catalogue does not know (an old autosave, a
 * share link) keeps a pinned option so picking something else never strands the document.
 */
export function FontPicker({ value, onPick }: FontPickerProps) {
  const baseId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [activeFamily, setActiveFamily] = useState(value);
  const [facesReady, setFacesReady] = useState(0);

  const known = getFontCatalogEntry(value);
  // UI-only faces (Baloo 2) are catalogued but never listed for documents, so a current family
  // that is one of them still needs the pinned keep option, exactly like an unknown family.
  const options: FontCatalogEntry[] = useMemo(
    () => known && !known.ui
      ? [...DOCUMENT_FONTS]
      : [{ family: value, source: 'local', weight: 400, tag: 'system' }, ...DOCUMENT_FONTS],
    [known, value],
  );

  useEffect(() => {
    if (!open) return;
    // System families never enter the ready set, so only bundled faces count here.
    if (DOCUMENT_FONTS.every((entry) => entry.source !== 'bundled' || isFontReady(entry.family))) return;
    let cancelled = false;
    void Promise.all(DOCUMENT_FONTS.map((entry) => ensureFontLoaded(entry.family))).then(() => {
      if (!cancelled) setFacesReady((count) => count + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (buttonRef.current?.contains(event.target) || listRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsidePress);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [open]);

  // Keyboard navigation moves activeFamily through a list taller than the popover; keep the
  // active option scrolled into view or arrow-key users lose track of where they are.
  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector(`#${CSS.escape(`${baseId}-option-${slugify(activeFamily)}`)}`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [open, activeFamily, baseId]);

  const openMenu = (startAt?: string) => {
    setActiveFamily(startAt ?? value);
    setOpen(true);
  };

  const pick = (family: string) => {
    const entry = options.find((option) => option.family === family);
    setOpen(false);
    buttonRef.current?.focus();
    if (entry && entry.family !== value) {
      void ensureFontLoaded(entry.family);
      onPick(entry);
    }
  };

  const step = (direction: -1 | 1) => {
    const index = options.findIndex((option) => option.family === activeFamily);
    const next = Math.min(options.length - 1, Math.max(0, (index < 0 ? 0 : index) + direction));
    setActiveFamily(options[next]!.family);
  };

  const onButtonKeyDown = (event: KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveFamily(options[0]!.family);
        break;
      case 'End':
        event.preventDefault();
        setActiveFamily(options[options.length - 1]!.family);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pick(activeFamily);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="font-picker">
      <span className="field-label" id={`${baseId}-label`}>Font family</span>
      <button
        ref={buttonRef}
        type="button"
        className="font-picker-button jelly-field"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-owns={open ? `${baseId}-list` : undefined}
        aria-labelledby={`${baseId}-label ${baseId}-value`}
        aria-activedescendant={open ? `${baseId}-option-${slugify(activeFamily)}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onButtonKeyDown}
      >
        <span
          id={`${baseId}-value`}
          className="font-picker-current"
          style={{ fontFamily: quoteFontFamily(value), fontWeight: known?.weight ?? 400 }}
        >
          {value}
        </span>
        <span className="font-picker-caret" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul
          id={`${baseId}-list`}
          ref={listRef}
          className="font-picker-list"
          role="listbox"
          aria-labelledby={`${baseId}-label`}
          data-faces={facesReady}
        >
          {FONT_TAG_ORDER.map((tag) => {
            const entries = options.filter((option) => option.tag === tag);
            if (entries.length === 0) return null;
            return (
              <li key={tag} role="group" aria-label={tag}>
                <span className="font-picker-group">{tag}</span>
                <ul>
                  {entries.map((entry) => (
                    <li
                      key={entry.family}
                      id={`${baseId}-option-${slugify(entry.family)}`}
                      role="option"
                      aria-selected={entry.family === value}
                      className={`font-picker-option ${entry.family === activeFamily ? 'active' : ''}`}
                      style={{ fontFamily: quoteFontFamily(entry.family), fontWeight: entry.weight }}
                      onPointerEnter={() => setActiveFamily(entry.family)}
                      onClick={() => pick(entry.family)}
                    >
                      {entry.family}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function slugify(family: string): string {
  return family.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
