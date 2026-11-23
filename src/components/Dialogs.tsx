import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { FSNode } from '../types/fs';

interface InputDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  submitLabel: string;
  presets?: { label: string; ext: string }[];
  onClose: () => void;
  onSubmit: (value: string) => void;
}

export function InputDialog({
  open,
  title,
  description,
  label,
  initialValue,
  placeholder,
  submitLabel,
  presets,
  onClose,
  onSubmit,
}: InputDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
    }
  }, [open, initialValue]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {description && (
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{description}</p>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {label}
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
              className="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
            />
          </div>

          {presets && presets.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Extension rapide :</span>
              {presets.map((preset) => (
                <button
                  key={preset.ext}
                  type="button"
                  onClick={() => {
                    const base = value.replace(/\.[^.]+$/, '') || 'nouveau_fichier';
                    setValue(`${base}.${preset.ext}`);
                  }}
                  className="px-2.5 py-1 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  .{preset.ext}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ConfirmDeleteDialogProps {
  open: boolean;
  nodes: FSNode[];
  permanent: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({
  open,
  nodes,
  permanent,
  onClose,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  if (!open || nodes.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {permanent ? 'Supprimer définitivement' : 'Déplacer dans la corbeille'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {nodes.length === 1 ? (
              <>
                Voulez-vous {permanent ? 'supprimer définitivement' : 'envoyer dans la corbeille'}{' '}
                <span className="font-medium text-slate-900 dark:text-slate-100">{nodes[0].name}</span> ?
              </>
            ) : (
              <>
                Voulez-vous {permanent ? 'supprimer définitivement' : 'envoyer dans la corbeille'} les{' '}
                <span className="font-medium text-slate-900 dark:text-slate-100">{nodes.length} éléments</span>{' '}
                sélectionnés ?
              </>
            )}
            {permanent && ' Cette action est irréversible.'}
          </p>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {permanent ? 'Supprimer définitivement' : 'Mettre à la corbeille'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
