// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
//
// /aufgaben — Aufgaben-Start nach Wireframe index.html.
// Vier Kachel-Eingangspunkte in Klartext-Sprache (Erstellen → Finden →
// Unterschreiben → Archivieren), dazu eine "Was liegt noch offen?"-Sektion mit
// den dringlichsten Items aus dem aktuellen Stand. Persona-Anker: Erstnutzer
// (GF) sieht beim ersten Öffnen die vier echten Anliegen, nicht eine Power-
// User-Übersicht. (Versenden ist KEINE eigene Kachel — die Unterschreiben-
// Kachel deckt /documents ab und beinhaltet sowohl eingehende Signatur-
// Anfragen als auch eigene Dokumente, die rausgeschickt werden.)
import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { XIcon } from 'lucide-react';
// Lucide-Icons für Tile-Glyphen bewusst NICHT — Tiles nutzen Text-Symbole nach
// Wireframe (✎ ⬚ @ €), das wirkt menschlicher als Tech-Glyphen.
import { Link, useParams } from 'react-router';

import { trpc } from '@nexasign/trpc/react';

import { Illustration } from '~/components/general/illustration';
import { appMetaTags } from '~/utils/meta';

const WELCOME_DISMISS_KEY = 'nexafile_welcome_dismissed';

export function meta() {
  return appMetaTags(msg`Was möchten Sie tun?`);
}

export default function AufgabenPage() {
  const params = useParams();
  const teamUrl = params.teamUrl ?? '';
  const { data: overview } = trpc.discovery.getOverview.useQuery();
  const { data: pendingSignatures } = trpc.document.getOutstandingSignatureCount.useQuery();

  const inboxCount = overview?.needsReview ?? 0;
  const acceptedCount = overview?.accepted ?? 0;
  const waitingSigCount = pendingSignatures?.count ?? 0;
  const oldWaitingSigCount = pendingSignatures?.olderThanWeekCount ?? 0;
  const isFirstRun = (overview?.total ?? 0) === 0;

  // Welcome-Tour-Banner: zeigt sich beim ersten Öffnen (oder solange noch
  // keine Belege da sind). User kann's dismissen, der Flag bleibt im
  // localStorage. Beim ersten Beleg-Bestätigen ist die App eh nicht mehr neu.
  const [welcomeDismissed, setWelcomeDismissed] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setWelcomeDismissed(window.localStorage.getItem(WELCOME_DISMISS_KEY) === '1');
    } catch {
      setWelcomeDismissed(false);
    }
  }, []);
  const dismissWelcome = () => {
    setWelcomeDismissed(true);
    try {
      window.localStorage.setItem(WELCOME_DISMISS_KEY, '1');
    } catch {
      // Kein localStorage (Private Mode) — Banner kommt beim Reload wieder, akzeptabel.
    }
  };
  // Welcome zeigt sich beim ersten Mal IMMER, unabhängig vom Beleg-Stand —
  // sonst sehen Bestandsnutzer das Onboarding nie. Erst nach Dismiss verschwindet's.
  const showWelcome = !welcomeDismissed;

  return (
    <div className="mx-auto w-full max-w-screen-xl space-y-10 px-4 py-8 md:px-6">
      {/* WELCOME-TOUR — nur beim ersten Mal, dismissable. */}
      {showWelcome && (
        <section className="relative overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 p-6 md:p-8">
          <button
            onClick={dismissWelcome}
            aria-label="Welcome-Tour schließen"
            className="absolute right-4 top-4 rounded-full p-1 text-neutral-500 hover:bg-white/60 hover:text-neutral-900"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:gap-10">
            <Illustration
              name="welcome"
              alt="Willkommen bei NexaFile"
              tone="emerald"
              className="h-32 w-full max-w-[200px] shrink-0"
            />
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-neutral-900 md:text-2xl">
                <Trans>Willkommen bei NexaFile!</Trans>
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-neutral-700 md:text-base">
                <Trans>
                  NexaFile deckt vier Schritte für Sie ab: <strong>Dokumente erstellen</strong> aus
                  Vorlagen, <strong>Dokumente im Postfach finden</strong>,{' '}
                  <strong>Dokumente unterschreiben</strong> (eigene zur Unterschrift versenden oder
                  selbst unterschreiben), und alles <strong>rechtssicher archivieren</strong>.
                  Wählen Sie unten eine der vier Kacheln — wir führen Sie dann Schritt für Schritt
                  durch.
                </Trans>
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                <Trans>
                  Tipp: Wenn Sie noch nicht wissen, womit anfangen — „Dokumente im Postfach finden"
                  ist der häufigste erste Schritt.
                </Trans>
              </p>
            </div>
          </div>
        </section>
      )}

      {/* BEGRÜSSUNG */}
      <section className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            <Trans>Was möchten Sie tun?</Trans>
          </h1>
          <p className="mt-2 text-base text-neutral-600">
            <Trans>Wählen Sie, was heute ansteht — wir führen Sie Schritt für Schritt durch.</Trans>
          </p>
        </div>
        {!showWelcome && (
          <Illustration
            name="aufgaben-hero"
            alt="Aufgaben-Übersicht"
            tone="sky"
            className="hidden h-24 w-32 shrink-0 md:block"
            hideOnError
          />
        )}
      </section>

      {/* VIER AUFGABEN-TILES — Reihenfolge nach NexaFile-Workflow:
          Erstellen → Finden → Unterschreiben → Archivieren.
          (Versenden steckt im Unterschreiben-Bereich /documents drin und ist
          deshalb hier KEINE eigene Kachel — sonst doppelter Einstieg.) */}
      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="sr-only">
          <Trans>Aufgaben</Trans>
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* 1. Erstellen — externer PHP-Bereich /vorlagen/ */}
          <TaskTile
            to="/vorlagen/"
            external
            icon="✎"
            title={<Trans>Dokumente erstellen</Trans>}
            description={
              <Trans>
                Arbeitsvertrag, NDA, Beratungsvertrag, AV-Vertrag, X-Rechnung und mehr — fertig
                vorbereitete deutsche Vorlagen, Sie füllen nur die Felder aus.
              </Trans>
            }
          />

          {/* 2. Im Postfach finden — Discovery */}
          <TaskTile
            to={`/t/${teamUrl}/find-documents`}
            icon="@"
            title={<Trans>Dokumente im Postfach finden</Trans>}
            description={
              <Trans>
                Wir verbinden uns einmal mit Ihrem E-Mail-Postfach und finden alle Rechnungen
                automatisch — ideal, wenn Sie für die Steuer ein ganzes Jahr nachholen müssen.
              </Trans>
            }
          />

          {/* 3. Unterschreiben — sowohl eigene Dokumente zur Unterschrift
                 verschicken als auch eingehende Anfragen unterschreiben. */}
          <TaskTile
            to={`/t/${teamUrl}/documents`}
            icon="✍"
            title={<Trans>Dokumente unterschreiben</Trans>}
            description={
              <Trans>
                Verträge selbst unterschreiben oder zur Unterschrift an Empfänger senden — Sie sehen
                jederzeit, was offen ist und wer schon unterschrieben hat.
              </Trans>
            }
          />

          {/* 4. Archivieren / Steuerpaket */}
          <TaskTile
            to={`/t/${teamUrl}/archiv`}
            icon="⬚"
            title={<Trans>Dokumente archivieren</Trans>}
            description={
              <Trans>
                Alle übernommenen Belege endgültig archivieren, Felder korrigieren oder ein
                Steuerpaket (DATEV-CSV) für Ihren Steuerberater exportieren.
              </Trans>
            }
          />
        </div>
      </section>

      {/* WAS LIEGT NOCH OFFEN? — Items aus echten Daten, falls > 0. */}
      {(inboxCount > 0 || acceptedCount > 0 || waitingSigCount > 0) && (
        <section aria-labelledby="open-heading">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 id="open-heading" className="text-lg font-semibold">
                <Trans>Was liegt noch offen?</Trans>
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                <Trans>
                  Diese Dinge brauchen jetzt eine Entscheidung von Ihnen — Klick und erledigt.
                </Trans>
              </p>
            </div>
            <Link
              to={`/t/${teamUrl}/find-documents/hub`}
              className="text-sm font-medium text-neutral-700 underline-offset-4 hover:underline"
            >
              <Trans>Alle Dokumente ansehen →</Trans>
            </Link>
          </div>

          <ul className="space-y-2">
            {inboxCount > 0 && (
              <OpenTask
                count={inboxCount}
                badgeColor="amber"
                title={<Trans>Belege liegen im Eingang und warten auf Ihre Entscheidung</Trans>}
                hint={
                  <Trans>
                    Wir haben sie in Ihrem E-Mail-Postfach gefunden. Pro Beleg ein Klick: ins Archiv
                    oder ignorieren.
                  </Trans>
                }
                cta={<Trans>Jetzt durchgehen</Trans>}
                ctaHref={`/t/${teamUrl}/find-documents`}
                ctaPrimary
              />
            )}
            {waitingSigCount > 0 && (
              <OpenTask
                count={oldWaitingSigCount > 0 ? oldWaitingSigCount : waitingSigCount}
                badgeColor="neutral"
                title={
                  oldWaitingSigCount > 0 ? (
                    <Trans>
                      Verträge warten seit über einer Woche auf Empfänger-Unterschriften
                    </Trans>
                  ) : (
                    <Trans>Verträge warten auf Empfänger-Unterschriften</Trans>
                  )
                }
                hint={
                  <Trans>
                    Sie können den Empfängern eine freundliche Erinnerung schicken — mit einem
                    Klick.
                  </Trans>
                }
                cta={<Trans>Status sehen</Trans>}
                ctaHref={`/t/${teamUrl}/documents`}
              />
            )}
            {acceptedCount > 0 && (
              <OpenTask
                count={acceptedCount}
                badgeColor="neutral"
                title={<Trans>Belege sind bereit zur finalen Ablage</Trans>}
                hint={
                  <Trans>
                    Sie haben sie übernommen — jetzt nur noch ein Klick, und sie sind 10 Jahre lang
                    sicher abgelegt.
                  </Trans>
                }
                cta={<Trans>Ablegen</Trans>}
                ctaHref={`/t/${teamUrl}/archiv`}
              />
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

const TaskTile = ({
  to,
  external,
  icon,
  title,
  description,
}: {
  to: string;
  external?: boolean;
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
}) => {
  const className =
    'group flex gap-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:border-neutral-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const inner = (
    <>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xl font-semibold text-neutral-700">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-lg font-semibold">{title}</div>
        <p className="mt-1.5 text-sm text-neutral-600">{description}</p>
      </div>
    </>
  );
  if (external) {
    return (
      <a href={to} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {inner}
    </Link>
  );
};

const OpenTask = ({
  count,
  badgeColor,
  title,
  hint,
  cta,
  ctaHref,
  ctaPrimary,
}: {
  count: number;
  badgeColor: 'amber' | 'neutral';
  title: React.ReactNode;
  hint: React.ReactNode;
  cta: React.ReactNode;
  ctaHref: string;
  ctaPrimary?: boolean;
}) => (
  <li className="flex items-start gap-3 rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
        badgeColor === 'amber' ? 'bg-amber-100 text-amber-900' : 'bg-neutral-100 text-neutral-700'
      }`}
    >
      {count}
    </div>
    <div className="min-w-0 flex-1">
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 text-sm text-neutral-600">{hint}</div>
    </div>
    <Link
      to={ctaHref}
      className={
        ctaPrimary
          ? 'rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800'
          : 'rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50'
      }
    >
      {cta}
    </Link>
  </li>
);
