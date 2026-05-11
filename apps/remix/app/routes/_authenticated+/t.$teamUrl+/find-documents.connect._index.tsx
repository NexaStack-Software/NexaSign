// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
//
// /find-documents/connect — Step 1 nach Wireframe finden.html.
// Email-First-Eingabe (Auto-Provider-Detect) + Provider-Tiles als Fallback.
import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { ArrowRightIcon, MailIcon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import { Button } from '@nexasign/ui/primitives/button';
import { Input } from '@nexasign/ui/primitives/input';

import { Illustration } from '~/components/general/illustration';
import { appMetaTags } from '~/utils/meta';

const detectProvider = (email: string): string | null => {
  const lower = email.trim().toLowerCase();
  const at = lower.indexOf('@');
  if (at < 0) return null;
  const domain = lower.slice(at + 1);
  if (domain.endsWith('gmail.com') || domain.endsWith('googlemail.com')) return 'gmail';
  if (
    domain.endsWith('outlook.com') ||
    domain.endsWith('hotmail.com') ||
    domain.endsWith('live.com') ||
    domain.endsWith('outlook.de') ||
    domain.endsWith('hotmail.de')
  )
    return 'outlook';
  if (domain.endsWith('gmx.de') || domain.endsWith('gmx.com') || domain.endsWith('gmx.net'))
    return 'gmx';
  if (domain.endsWith('web.de')) return 'web-de';
  if (domain.endsWith('t-online.de')) return 't-online';
  return null;
};

export function meta() {
  return appMetaTags(msg`Postfach verbinden`);
}

// Provider-Tiles linken auf den Source-Manager unter /settings/sources, der
// einen vollwertigen Anbieter-Picker mit Server-Presets enthält. Der ?provider=
// Param wird dort gelesen, damit der gewünschte Anbieter direkt vorausgewählt
// ist. Provider-IDs müssen mit den IDs in components/sources/imap-providers.ts
// übereinstimmen, sonst greift das Preset nicht.
const PROVIDERS = [
  {
    id: 'gmail',
    initial: 'G',
    label: 'Gmail',
    sub: 'Google-Anmeldung',
    href: '/settings/sources?provider=gmail',
  },
  {
    id: 'outlook',
    initial: 'O',
    label: 'Outlook',
    sub: 'Microsoft-Anmeldung',
    href: '/settings/sources?provider=outlook',
  },
  {
    id: 'gmx',
    initial: 'G',
    label: 'GMX',
    sub: 'E-Mail + Passwort',
    href: '/settings/sources?provider=gmx',
  },
  {
    id: 'web-de',
    initial: 'W',
    label: 'web.de',
    sub: 'E-Mail + Passwort',
    href: '/settings/sources?provider=web-de',
  },
  {
    id: 't-online',
    initial: 'T',
    label: 'T-Online',
    sub: 'E-Mail + Passwort',
    href: '/settings/sources?provider=t-online',
  },
] as const;

const StepIndicator = ({ active }: { active: 1 | 2 | 3 }) => (
  <nav aria-label="Fortschritt" className="flex items-center justify-between">
    <ol className="flex flex-1 items-center gap-2 text-xs text-neutral-500">
      <li className="flex flex-1 items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
            active === 1 ? 'bg-neutral-900 text-white' : 'bg-neutral-300 text-white'
          }`}
        >
          {active > 1 ? '✓' : '1'}
        </span>
        <span className={active === 1 ? 'font-medium text-neutral-900' : 'text-neutral-700'}>
          <Trans>Postfach verbinden</Trans>
        </span>
        <span className="h-px flex-1 bg-neutral-300" />
      </li>
      <li className="flex flex-1 items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
            active === 2
              ? 'bg-neutral-900 text-white'
              : active > 2
                ? 'bg-neutral-300 text-white'
                : 'border border-neutral-300 bg-white text-neutral-400'
          }`}
        >
          {active > 2 ? '✓' : '2'}
        </span>
        <span className={active === 2 ? 'font-medium text-neutral-900' : ''}>
          <Trans>Zeitraum wählen</Trans>
        </span>
        <span className="h-px flex-1 bg-neutral-200" />
      </li>
      <li className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
            active === 3
              ? 'bg-neutral-900 text-white'
              : 'border border-neutral-300 bg-white text-neutral-400'
          }`}
        >
          3
        </span>
        <span className={active === 3 ? 'font-medium text-neutral-900' : ''}>
          <Trans>Belege durchgehen</Trans>
        </span>
      </li>
    </ol>
  </nav>
);

export { StepIndicator };

export default function ConnectMailboxPage() {
  const params = useParams();
  const teamUrl = params.teamUrl ?? '';
  const navigate = useNavigate();
  const { data } = trpc.discovery.findDocuments.useQuery({ status: 'all' });
  const sources = data?.sources ?? [];

  const [email, setEmail] = useState('');
  const detectedProvider = detectProvider(email);

  const handleEmailContinue = () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) return;
    const emailParam = `email=${encodeURIComponent(trimmed)}`;
    if (detectedProvider) {
      void navigate(`/settings/sources?provider=${detectedProvider}&${emailParam}`);
      return;
    }
    // Bekanntes E-Mail-Format, aber Anbieter unbekannt → Source-Manager mit
    // vorgefuellter Adresse, der Picker erkennt den Anbieter im useEffect.
    void navigate(`/settings/sources?${emailParam}`);
  };

  const hasConnectedSources = sources.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10 md:px-6">
      <StepIndicator active={1} />

      <section className="flex flex-col items-start gap-6 md:flex-row md:items-center">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {hasConnectedSources ? (
              <Trans>Welches Postfach soll durchsucht werden?</Trans>
            ) : (
              <Trans>Welches E-Mail-Postfach sollen wir durchsuchen?</Trans>
            )}
          </h1>
          <p className="mt-2 text-base text-neutral-600">
            {hasConnectedSources ? (
              <Trans>
                Wählen Sie ein bereits verbundenes Postfach für einen neuen Lauf — oder hängen Sie
                weiter unten ein zusätzliches Postfach an.
              </Trans>
            ) : (
              <Trans>
                In drei Schritten haben wir alle Ihre Rechnungen beisammen — ohne dass Sie einzeln
                durch Mails scrollen müssen.
              </Trans>
            )}
          </p>
        </div>
        <Illustration
          name="connect-mailbox"
          alt="Postfach verbinden"
          tone="sky"
          className="h-28 w-40 shrink-0"
          hideOnError
        />
      </section>

      {/* Bereits verbundene Quellen — wenn vorhanden, oben als primaerer
          Weg, mit deutlichem "Weiter"-Button pro Eintrag. */}
      {hasConnectedSources && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-sm font-semibold text-emerald-900">
            <Trans>Bereits verbundene Postfächer</Trans>
          </h2>
          <p className="mt-1 text-sm text-emerald-900">
            <Trans>Klicken Sie auf „Weiter" — Schritt 2 wählt den Zeitraum für den Lauf.</Trans>
          </p>
          <ul className="mt-4 space-y-2">
            {sources.map((src) => (
              <li
                key={src.id}
                className="flex items-center gap-3 rounded-md border border-emerald-300 bg-white p-4 shadow-sm"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
                  aria-hidden
                >
                  ✓
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-neutral-900">{src.label}</div>
                  {src.lastSuccessfulSyncRangeTo && (
                    <div className="text-xs text-neutral-500">
                      <Trans>
                        Letzter Lauf bis{' '}
                        {new Date(src.lastSuccessfulSyncRangeTo).toLocaleDateString('de')}
                      </Trans>
                    </div>
                  )}
                </div>
                <Button asChild size="sm" className="shrink-0">
                  <Link to={`/t/${teamUrl}/find-documents/range?sourceId=${src.id}`}>
                    <Trans>Weiter</Trans>
                    <ArrowRightIcon className="ml-2 h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasConnectedSources && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="h-px flex-1 bg-neutral-200" />
          <Trans>oder ein weiteres Postfach hinzufügen</Trans>
          <span className="h-px flex-1 bg-neutral-200" />
        </div>
      )}

      {/* EMAIL-FIRST-EINGABE — Erstanbindung oder zusaetzliches Postfach. */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <label htmlFor="connect-email" className="block">
          <span className="text-sm font-semibold text-neutral-900">
            {hasConnectedSources ? (
              <Trans>Weiteres Postfach mit E-Mail-Adresse hinzufügen</Trans>
            ) : (
              <Trans>Mit E-Mail-Adresse starten</Trans>
            )}
          </span>
          <span className="mt-1 block text-xs text-neutral-500">
            <Trans>
              Geben Sie Ihre Adresse ein — wir erkennen den Anbieter und übernehmen die Adresse
              direkt in den nächsten Schritt, damit Sie sie nicht erneut tippen müssen.
            </Trans>
          </span>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <MailIcon
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
              <Input
                id="connect-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vorname.name@beispiel.de"
                className="pl-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleEmailContinue();
                  }
                }}
              />
            </div>
            <Button
              onClick={handleEmailContinue}
              disabled={!email.includes('@')}
              className="shrink-0"
            >
              <Trans>Weiter</Trans>
              <ArrowRightIcon className="ml-2 h-4 w-4" aria-hidden />
            </Button>
          </div>
          {detectedProvider && (
            <p className="mt-2 text-xs text-emerald-700">
              <Trans>
                ✓ Erkannt: {detectedProvider} — wir öffnen den passenden Anmelde-Dialog.
              </Trans>
            </p>
          )}
        </label>
      </section>

      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className="h-px flex-1 bg-neutral-200" />
        <Trans>oder direkt einen Anbieter wählen</Trans>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <section aria-labelledby="provider-heading">
        <h2 id="provider-heading" className="sr-only">
          <Trans>E-Mail-Anbieter wählen</Trans>
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {PROVIDERS.map((p) => (
            <Link
              key={p.id}
              to={p.href}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-4 text-left shadow-sm hover:border-neutral-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-base font-semibold">
                {p.initial}
              </div>
              <div className="min-w-0">
                <div className="font-semibold">{p.label}</div>
                <div className="text-xs text-neutral-500">{p.sub}</div>
              </div>
            </Link>
          ))}

          <Link
            to="../settings/sources/new"
            className="flex items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white p-4 text-left shadow-sm hover:border-neutral-400 hover:shadow-md"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-lg font-bold">
              +
            </div>
            <div className="min-w-0">
              <div className="font-semibold">
                <Trans>Anderer Anbieter</Trans>
              </div>
              <div className="text-xs text-neutral-500">
                <Trans>Mit Server-Adresse</Trans>
              </div>
            </div>
          </Link>
        </div>
      </section>

      <section className="rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
        <p>
          <strong>
            <Trans>Ihre Privatsphäre.</Trans>
          </strong>{' '}
          <Trans>
            Wir durchsuchen den gewählten Zeitraum im verbundenen Postfach nach Rechnungs- und
            Beleg-Kandidaten. Andere Mails können dabei technisch mit geprüft werden, werden aber
            nicht als Beleg übernommen. Ihr Passwort wird verschlüsselt gespeichert und kann
            jederzeit in den Einstellungen wieder entfernt werden.
          </Trans>
        </p>
      </section>

      <section className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-5 text-sm text-neutral-700">
        <h3 className="font-semibold text-neutral-900">
          <Trans>Was als nächstes passiert</Trans>
        </h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            <Trans>
              Sie wählen, wie weit zurück wir suchen sollen — von einem Monat bis zu fünf Jahren.
            </Trans>
          </li>
          <li>
            <Trans>
              Wir durchsuchen Ihr Postfach im Hintergrund und stellen die wahrscheinlichsten
              Rechnungs- und Beleg-Treffer für Sie zusammen.
            </Trans>
          </li>
          <li>
            <Trans>
              Sie gehen die Treffer durch — pro Beleg ein Klick: ins Archiv oder ignorieren. Fertig.
            </Trans>
          </li>
        </ol>
      </section>
    </div>
  );
}
