// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { Trans } from '@lingui/react/macro';
import { ExternalLinkIcon } from 'lucide-react';

import { Card } from '@nexasign/ui/primitives/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nexasign/ui/primitives/select';

import { IMAP_PROVIDERS, type ImapProvider } from './imap-providers';

type Props = {
  value: string | null;
  onValueChange: (providerId: string) => void;
  /** Wenn true, ist die Auswahl „Anderer Anbieter" verfügbar, die Expert-Felder freischaltet. */
  allowCustom: boolean;
};

const CUSTOM_VALUE = '__custom__';

/**
 * Provider-Picker für IMAP-Setup. Markennamen statt Hostnamen, plus pro Anbieter
 * eine konkrete Anleitung, wo man das App-Passwort findet. Reduziert die
 * Onboarding-Reibung für nicht-technische Nutzer drastisch.
 */
export const ImapProviderPicker = ({ value, onValueChange, allowCustom }: Props) => {
  const selected = IMAP_PROVIDERS.find((p) => p.id === value);
  const isCustom = value === CUSTOM_VALUE;

  return (
    <div className="flex flex-col gap-2">
      <Select value={value ?? ''} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Anbieter auswählen" />
        </SelectTrigger>
        <SelectContent>
          {IMAP_PROVIDERS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
          {allowCustom && (
            <SelectItem value={CUSTOM_VALUE}>
              <Trans>Anderer Anbieter (manuelle Eingabe)</Trans>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      {selected && <ProviderHelpCard provider={selected} />}

      {isCustom && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Sie können Server, Port und Zugangsdaten manuell eintragen. Fragen Sie Ihren Provider
            nach den IMAP-Einstellungen, falls Sie sie nicht kennen.
          </Trans>
        </p>
      )}
    </div>
  );
};

const ProviderHelpCard = ({ provider }: { provider: ImapProvider }) => (
  <Card className="border-primary/30 bg-primary/5 p-3 text-xs">
    <p className="font-medium text-foreground">
      <Trans>So finden Sie Ihr App-Passwort bei {provider.label}</Trans>
    </p>
    <p className="mt-1 text-muted-foreground">{provider.appPasswordHelp}</p>
    {provider.appPasswordUrl && (
      <a
        href={provider.appPasswordUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        <Trans>Direkt zur App-Passwort-Seite öffnen</Trans>
        <ExternalLinkIcon className="h-3 w-3" aria-hidden />
      </a>
    )}
    <p className="mt-2 text-muted-foreground">
      <Trans>
        Wichtig: Das normale Login-Passwort funktioniert nicht — Sie brauchen ein eigenes Passwort
        für externe Programme.
      </Trans>
    </p>
  </Card>
);

export const isCustomProvider = (value: string | null) => value === CUSTOM_VALUE;
export const CUSTOM_PROVIDER_VALUE = CUSTOM_VALUE;
