// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  Loader2Icon,
  PauseCircleIcon,
  PlugIcon,
  PlusIcon,
} from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@nexasign/trpc/react';
import type { TSourceListItem } from '@nexasign/trpc/server/sources-router/schema';
import { Badge } from '@nexasign/ui/primitives/badge';
import { Button } from '@nexasign/ui/primitives/button';
import { Card } from '@nexasign/ui/primitives/card';
import { Checkbox } from '@nexasign/ui/primitives/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@nexasign/ui/primitives/dialog';
import { Input } from '@nexasign/ui/primitives/input';
import { Label } from '@nexasign/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nexasign/ui/primitives/select';
import { Skeleton } from '@nexasign/ui/primitives/skeleton';
import { useToast } from '@nexasign/ui/primitives/use-toast';

import { SettingsHeader } from '~/components/general/settings-header';
import {
  CUSTOM_PROVIDER_VALUE,
  ImapProviderPicker,
  isCustomProvider,
} from '~/components/sources/imap-provider-picker';
import { detectProviderByEmail, getProviderById } from '~/components/sources/imap-providers';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags(msg`Quellen`);
}

const StatusBadge = ({ source }: { source: TSourceListItem }) => {
  if (source.lastSyncStatus === 'SUSPENDED') {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <PauseCircleIcon className="h-3.5 w-3.5" aria-hidden />
        <Trans>Gesperrt</Trans>
      </Badge>
    );
  }
  if (source.lastSyncStatus === 'FAILED') {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <AlertCircleIcon className="h-3.5 w-3.5" aria-hidden />
        <Trans>Fehler</Trans>
      </Badge>
    );
  }
  if (source.lastSyncStatus === 'SUCCESS') {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <CheckCircleIcon className="h-3.5 w-3.5 text-green-600" aria-hidden />
        <Trans>Aktiv</Trans>
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" className="gap-1.5">
      <ClockIcon className="h-3.5 w-3.5" aria-hidden />
      <Trans>Wartet auf ersten Sync</Trans>
    </Badge>
  );
};

const SourceRow = ({ source }: { source: TSourceListItem }) => (
  <Link to={`/settings/sources/${source.id}`} className="block">
    <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/40">
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold">{source.label}</h3>
        <p className="text-sm text-muted-foreground">
          <Trans>IMAP-Konto · Team: {source.teamName}</Trans>
          {source.lastSyncError && (
            <>
              <span className="mx-1">·</span>
              <span className="text-destructive">{source.lastSyncError}</span>
            </>
          )}
        </p>
      </div>
      <StatusBadge source={source} />
    </Card>
  </Link>
);

type AvailableTeam = {
  id: number;
  name: string;
  url: string;
  organisationName: string;
};

const AddImapSourceDialog = ({
  capabilities,
  availableTeams,
  onCreated,
}: {
  capabilities:
    | { allowedHosts: string[]; customHostsAllowed: boolean; maxAccountsPerUser: number }
    | undefined;
  availableTeams: AvailableTeam[];
  onCreated: () => void;
}) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [teamId, setTeamId] = useState<string>(
    availableTeams[0] ? String(availableTeams[0].id) : '',
  );
  const [providerId, setProviderId] = useState<string | null>(null);
  const [customHost, setCustomHost] = useState('');
  const [port, setPort] = useState<number>(993);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tlsVerify, setTlsVerify] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Auto-Detect: sobald der Nutzer eine vollständige E-Mail tippt und noch
  // keinen Anbieter manuell gewählt hat, springt der Picker auf den passenden
  // Provider. Das spart einen Klick und verhindert Fehler-Konfigurationen.
  useEffect(() => {
    if (providerId) return;
    const detected = detectProviderByEmail(username);
    if (detected) {
      setProviderId(detected.id);
      setPort(detected.port);
    }
  }, [username, providerId]);

  // Wenn der Nutzer den Provider explizit wechselt, aktualisieren wir Port und
  // setzen den Custom-Host zurück, damit nichts inkonsistent stehen bleibt.
  const handleProviderChange = (id: string) => {
    setProviderId(id);
    if (id === CUSTOM_PROVIDER_VALUE) {
      setShowAdvanced(true);
      return;
    }
    const provider = getProviderById(id);
    if (provider) {
      setPort(provider.port);
      setCustomHost('');
      setShowAdvanced(false);
    }
  };

  const utils = trpc.useUtils();
  const create = trpc.sources.createImapSource.useMutation({
    onSuccess: () => {
      void utils.sources.listSources.invalidate();
      void utils.discovery.findDocuments.invalidate();
      toast({
        title: _(msg`Quelle hinzugefügt`),
        description: _(msg`Erster Sync läuft im Hintergrund.`),
      });
      onCreated();
      setOpen(false);
      setLabel('');
      setProviderId(null);
      setCustomHost('');
      setUsername('');
      setPassword('');
      setShowAdvanced(false);
    },
    onError: (err) => {
      toast({
        title: _(msg`Speichern fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const test = trpc.sources.testSource.useMutation({
    onSuccess: (result) => {
      toast({
        title: result.ok ? _(msg`Verbindung erfolgreich`) : _(msg`Verbindung fehlgeschlagen`),
        description: result.error,
        variant: result.ok ? 'default' : 'destructive',
      });
    },
    onError: (err) => {
      toast({
        title: _(msg`Test fehlgeschlagen`),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const effectiveHost = (() => {
    if (isCustomProvider(providerId)) return customHost.trim();
    if (providerId) return getProviderById(providerId)?.host ?? '';
    return '';
  })();
  const selectedProvider =
    providerId && !isCustomProvider(providerId) ? getProviderById(providerId) : undefined;
  const canSubmit =
    label.trim() && teamId && effectiveHost && username.trim() && password && !create.isPending;

  const buildConfig = () => ({
    host: effectiveHost,
    port,
    username: username.trim(),
    password,
    tlsVerify,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="mr-2 h-4 w-4" aria-hidden />
          <Trans>Quelle verbinden</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>IMAP-Konto verbinden</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Belege aus Ihrem Postfach werden automatisch im Eingang einsortiert. Zugangsdaten
              werden verschlüsselt gespeichert und sind nur für Sie sichtbar.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source-label">
              <Trans>Bezeichnung</Trans>
            </Label>
            <Input
              id="source-label"
              value={label}
              maxLength={120}
              placeholder={_(msg`Geschäftspostfach`)}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source-team">
              <Trans>Team</Trans>
            </Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger id="source-team">
                <SelectValue placeholder={_(msg`Team auswählen`)} />
              </SelectTrigger>
              <SelectContent>
                {availableTeams.map((team) => (
                  <SelectItem key={team.id} value={String(team.id)}>
                    {team.name}{' '}
                    <span className="text-xs text-muted-foreground">· {team.organisationName}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              <Trans>
                In dieses Team werden gefundene Belege einsortiert. Sie können das später nicht
                ändern — bei Bedarf eine neue Quelle anlegen.
              </Trans>
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source-username">
              <Trans>E-Mail-Adresse</Trans>
            </Label>
            <Input
              id="source-username"
              type="email"
              value={username}
              autoComplete="off"
              placeholder="dein.name@beispiel.de"
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              <Trans>Sobald du @ tippst, wählen wir den passenden Anbieter automatisch aus.</Trans>
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              <Trans>Anbieter</Trans>
            </Label>
            <ImapProviderPicker
              value={providerId}
              onValueChange={handleProviderChange}
              allowCustom={Boolean(capabilities?.customHostsAllowed)}
            />
          </div>

          {isCustomProvider(providerId) && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="source-custom-host">
                <Trans>IMAP-Server</Trans>
              </Label>
              <Input
                id="source-custom-host"
                value={customHost}
                placeholder="imap.example.com"
                onChange={(e) => setCustomHost(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Erlaubte Hosts (vom Admin freigegeben):{' '}
                  {(capabilities?.allowedHosts ?? []).join(', ')}
                </Trans>
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source-password">
              <Trans>App-Passwort</Trans>
            </Label>
            <Input
              id="source-password"
              type="password"
              value={password}
              autoComplete="new-password"
              placeholder={selectedProvider ? '••••••••••••••••' : '••••••••'}
              onChange={(e) => setPassword(e.target.value)}
            />
            {!selectedProvider && (
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Achtung: Bei den meisten Anbietern ist das nicht das normale Login-Passwort,
                  sondern ein eigens generiertes „App-Passwort". Wähl oben deinen Anbieter und du
                  bekommst die genaue Anleitung.
                </Trans>
              </p>
            )}
          </div>

          <button
            type="button"
            className="self-start text-xs text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? (
              <Trans>Erweiterte Einstellungen ausblenden</Trans>
            ) : (
              <Trans>Erweiterte Einstellungen (Port, TLS) anzeigen</Trans>
            )}
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted/30 p-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="source-port">
                  <Trans>Port</Trans>
                </Label>
                <Select value={String(port)} onValueChange={(v) => setPort(Number(v))}>
                  <SelectTrigger id="source-port">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="993">993 (IMAPS)</SelectItem>
                    <SelectItem value="143">143 (STARTTLS)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={tlsVerify}
                    onCheckedChange={(checked) => setTlsVerify(Boolean(checked))}
                  />
                  <span>
                    <Trans>TLS-Zertifikat prüfen</Trans>
                  </span>
                </label>
              </div>
            </div>
          )}

          {!tlsVerify && (
            <Card className="border-destructive bg-destructive/5 p-3 text-sm text-destructive">
              <Trans>
                Ohne TLS-Verifikation kann der Datenverkehr von einem Angreifer mitgelesen werden.
                Nur einsetzen, wenn der Server ein bekanntes selbst-signiertes Zertifikat hat.
              </Trans>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={!canSubmit || test.isPending}
            onClick={() => test.mutate({ config: buildConfig() })}
          >
            {test.isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            <Trans>Verbindung testen</Trans>
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              create.mutate({
                teamId: Number(teamId),
                label: label.trim(),
                ...buildConfig(),
              })
            }
          >
            {create.isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            <Trans>Speichern und synchronisieren</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default function SettingsSourcesIndex() {
  const { _ } = useLingui();

  const { data: sources, isLoading } = trpc.sources.listSources.useQuery();
  const { data: capabilities } = trpc.sources.getCapabilities.useQuery();

  const reachedLimit =
    capabilities && sources ? sources.length >= capabilities.imap.maxAccountsPerUser : false;

  return (
    <div>
      <SettingsHeader
        title={_(msg`Quellen`)}
        subtitle={_(
          msg`Verbinden Sie Postfächer, aus denen Belege automatisch in den Eingang einlaufen sollen.`,
        )}
      >
        {!reachedLimit && (
          <AddImapSourceDialog
            capabilities={capabilities?.imap}
            availableTeams={capabilities?.availableTeams ?? []}
            onCreated={() => {
              // tRPC-Invalidate passiert in der Mutation, hier nichts mehr.
            }}
          />
        )}
      </SettingsHeader>

      <div className="mt-6 flex flex-col gap-3">
        {isLoading && (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}

        {!isLoading && sources && sources.length === 0 && (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <PlugIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
            <div className="max-w-md">
              <h3 className="text-lg font-semibold">
                <Trans>Noch keine Quelle verbunden</Trans>
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                <Trans>
                  Sobald ein IMAP-Konto verbunden ist, starten Sie gezielte Sync-Läufe für bestimmte
                  Zeiträume. Gefundene Belege legt NexaFile im Eingang ab.
                </Trans>
              </p>
            </div>
          </Card>
        )}

        {!isLoading && sources?.map((source) => <SourceRow key={source.id} source={source} />)}

        {reachedLimit && (
          <p className="text-xs text-muted-foreground">
            <Trans>
              Limit erreicht: maximal {capabilities?.imap.maxAccountsPerUser} IMAP-Konten pro Konto.
              Bestehende Quelle löschen, um eine neue anzulegen.
            </Trans>
          </p>
        )}
      </div>
    </div>
  );
}
