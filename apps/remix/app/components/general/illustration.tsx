// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
//
// Illustration-Komponente — Platzhalter für UI-Illustrationen.
// Versucht, eine SVG/PNG aus /illustrations/{name}.{ext} zu laden. Wenn das
// Asset (noch) nicht existiert, fällt sie sauber auf einen Verlauf-Platzhalter
// zurück — die UX bricht nicht, das Layout bleibt stabil.
//
// Wenn echte Illustrationen kommen: Datei nach
// apps/remix/public/illustrations/<name>.svg legen, fertig.
import { useState } from 'react';

type Tone = 'neutral' | 'emerald' | 'amber' | 'sky' | 'purple';

const TONE_GRADIENTS: Record<Tone, string> = {
  neutral: 'from-neutral-200 via-neutral-100 to-neutral-200',
  emerald: 'from-emerald-200 via-emerald-100 to-emerald-200',
  amber: 'from-amber-200 via-amber-100 to-amber-200',
  sky: 'from-sky-200 via-sky-100 to-sky-200',
  purple: 'from-purple-200 via-purple-100 to-purple-200',
};

type Props = {
  /** Asset-Name ohne Endung — App lädt /illustrations/{name}.svg. */
  name: string;
  /** Beschreibung für Screen-Reader und Fallback-Label. */
  alt: string;
  /** Tailwind-Klassen für Größe (z.B. "h-32" oder "max-w-xs"). */
  className?: string;
  /** Farb-Ton des Fallback-Platzhalters. */
  tone?: Tone;
  /** Falls true, Fallback komplett unsichtbar (für Layout-stille Stellen). */
  hideOnError?: boolean;
};

export const Illustration = ({
  name,
  alt,
  className = 'h-32 w-full',
  tone = 'neutral',
  hideOnError = false,
}: Props) => {
  const [errored, setErrored] = useState(false);

  if (errored && hideOnError) return null;

  if (errored) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex items-center justify-center rounded-lg bg-gradient-to-br ${TONE_GRADIENTS[tone]} ${className}`}
      >
        <span className="px-4 text-center text-xs text-neutral-600">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={`/illustrations/${name}.svg`}
      alt={alt}
      className={`object-contain ${className}`}
      onError={() => setErrored(true)}
      loading="lazy"
    />
  );
};
