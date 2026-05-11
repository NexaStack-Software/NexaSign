// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { z } from 'zod';

import { ZSourceKindSchema, ZSourceSyncStatusSchema } from '../discovery-router/schema';

export const ZSourceListItemSchema = z.object({
  id: z.string(),
  kind: ZSourceKindSchema,
  label: z.string(),
  teamId: z.number().int().positive(),
  teamName: z.string(),
  lastSyncAt: z.coerce.date().nullable(),
  lastSyncStatus: ZSourceSyncStatusSchema,
  lastSyncError: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
});

export const ZListSourcesResponseSchema = z.array(ZSourceListItemSchema);

export const ZDeleteSourceRequestSchema = z.object({
  sourceId: z.string(),
});

export const ZDeleteSourceResponseSchema = z.object({
  deleted: z.boolean(),
});

export const ZImapConnectionConfigSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(993),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
  tlsVerify: z.boolean().default(true),
});

export const ZCreateImapSourceRequestSchema = ZImapConnectionConfigSchema.extend({
  teamId: z.number().int().positive(),
  label: z.string().min(1).max(120),
});

export const ZUpdateImapSourceRequestSchema = ZCreateImapSourceRequestSchema.extend({
  sourceId: z.string(),
  password: z.string().min(1).max(1024).optional(),
});

export const ZTestSourceRequestSchema = z.object({
  sourceId: z.string().optional(),
  config: ZImapConnectionConfigSchema.optional(),
});

export const ZTestSourceResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

export const ZReactivateSourceRequestSchema = z.object({
  sourceId: z.string(),
});

export const ZReactivateSourceResponseSchema = z.object({
  reactivated: z.boolean(),
});

// SyncRun-Modell — User triggert pro Lauf einen expliziten Zeitraum.
export const ZSyncRunStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
]);

export const ZSyncRunSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  rangeFrom: z.coerce.date(),
  rangeTo: z.coerce.date(),
  searchTerm: z.string().nullable(),
  status: ZSyncRunStatusSchema,
  // Obergrenze: Anzahl Mails, die der Adapter im Range gefunden hat. null bei
  // alten Runs vor Migration oder wenn der Adapter den Wert noch nicht setzt.
  mailsTotal: z.number().int().nonnegative().nullable(),
  mailsChecked: z.number().int().nonnegative(),
  documentsAuto: z.number().int().nonnegative(),
  documentsManual: z.number().int().nonnegative(),
  documentsIgnored: z.number().int().nonnegative(),
  documentsFailed: z.number().int().nonnegative(),
  errorMessage: z.string().nullable(),
  cancelRequested: z.boolean(),
  // Wenn ein Cap gegriffen hat, hier der Grund: 'BYTES_CAP' / 'MAILS_CAP'.
  // null = Lauf vollstaendig durch. Frontend rendert daraus einen Hinweis.
  truncationReason: z.string().nullable(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
});

export const ZStartSyncRunRequestSchema = z
  .object({
    sourceId: z.string(),
    from: z.coerce.date(),
    to: z.coerce.date(),
    searchTerm: z.string().trim().min(1).max(120).optional(),
  })
  .refine((data) => data.from < data.to, {
    message: '„Von"-Datum muss vor „Bis"-Datum liegen.',
    path: ['from'],
  });

export const ZStartSyncRunResponseSchema = ZSyncRunSchema;

export const ZListSyncRunsRequestSchema = z.object({
  sourceId: z.string(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const ZListSyncRunsResponseSchema = z.array(ZSyncRunSchema);

export const ZRecentSyncRunSchema = ZSyncRunSchema.extend({
  sourceLabel: z.string(),
});

export const ZListRecentSyncRunsRequestSchema = z.object({
  limit: z.number().int().min(1).max(10).default(5),
});

export const ZListRecentSyncRunsResponseSchema = z.array(ZRecentSyncRunSchema);

export const ZCancelSyncRunRequestSchema = z.object({
  syncRunId: z.string(),
});

export const ZCancelSyncRunResponseSchema = z.object({
  cancelRequested: z.boolean(),
});

export const ZSourceCapabilitiesResponseSchema = z.object({
  imap: z.object({
    maxAccountsPerUser: z.number().int().positive(),
    allowedHosts: z.array(z.string()),
    customHostsAllowed: z.boolean(),
  }),
  availableTeams: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      url: z.string(),
      organisationName: z.string(),
    }),
  ),
});

export type TSourceListItem = z.infer<typeof ZSourceListItemSchema>;
export type TListSourcesResponse = z.infer<typeof ZListSourcesResponseSchema>;
export type TDeleteSourceRequest = z.infer<typeof ZDeleteSourceRequestSchema>;
export type TCreateImapSourceRequest = z.infer<typeof ZCreateImapSourceRequestSchema>;
export type TUpdateImapSourceRequest = z.infer<typeof ZUpdateImapSourceRequestSchema>;
export type TTestSourceRequest = z.infer<typeof ZTestSourceRequestSchema>;
export type TTestSourceResponse = z.infer<typeof ZTestSourceResponseSchema>;
export type TReactivateSourceRequest = z.infer<typeof ZReactivateSourceRequestSchema>;

export type TSyncRun = z.infer<typeof ZSyncRunSchema>;
export type TSyncRunStatus = z.infer<typeof ZSyncRunStatusSchema>;
export type TStartSyncRunRequest = z.infer<typeof ZStartSyncRunRequestSchema>;
export type TListSyncRunsRequest = z.infer<typeof ZListSyncRunsRequestSchema>;
export type TRecentSyncRun = z.infer<typeof ZRecentSyncRunSchema>;
export type TCancelSyncRunRequest = z.infer<typeof ZCancelSyncRunRequestSchema>;

// IMAP-Folder-Diagnose: zeigt der Persona, welche Folder ihr IMAP-Account
// exposed und welche der Sync-Adapter wirklich scannt. Kernzweck: Gmail-User
// stossen darauf, dass sie „[Gmail]/Alle Nachrichten" in IMAP freigeben muessen.
export const ZInspectImapFoldersRequestSchema = z.object({
  sourceId: z.string(),
});

export const ZImapFolderInfoSchema = z.object({
  path: z.string(),
  specialUse: z.string().nullable(),
  scanned: z.boolean(),
});

export const ZInspectImapFoldersResponseSchema = z.object({
  folders: z.array(ZImapFolderInfoSchema),
  scannedPaths: z.array(z.string()),
  isGmailHost: z.boolean(),
  // Wenn der Provider Gmail ist und „All Mail" / „Alle Nachrichten" NICHT in
  // der Folder-Liste auftaucht, scannen wir nur die INBOX — das ist fast immer
  // ein Konfigurations-Bug auf Gmail-Seite.
  gmailAllMailVisible: z.boolean(),
});

export type TInspectImapFoldersRequest = z.infer<typeof ZInspectImapFoldersRequestSchema>;
export type TInspectImapFoldersResponse = z.infer<typeof ZInspectImapFoldersResponseSchema>;
export type TImapFolderInfo = z.infer<typeof ZImapFolderInfoSchema>;
