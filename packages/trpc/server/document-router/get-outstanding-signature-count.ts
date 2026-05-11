// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { DocumentStatus, EnvelopeType, SigningStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@nexasign/prisma';

import { authenticatedProcedure } from '../trpc';

export const ZGetOutstandingSignatureCountRequestSchema = z
  .object({
    /** Optional: nur Envelopes älter als N Tage zählen (für „seit-X-Tagen"-Anzeigen). */
    olderThanDays: z.number().int().min(0).max(365).optional(),
  })
  .optional();

export const ZGetOutstandingSignatureCountResponseSchema = z.object({
  count: z.number(),
  /** Wieviele davon sind älter als 7 Tage — für „seit über einer Woche"-Anzeige. */
  olderThanWeekCount: z.number(),
});

export type TGetOutstandingSignatureCountResponse = z.infer<
  typeof ZGetOutstandingSignatureCountResponseSchema
>;

/**
 * Anzahl Envelopes, die der angemeldete User selbst zur Unterschrift verschickt
 * hat und bei denen mindestens ein Empfänger noch nicht signiert hat. Wird auf
 * dem Aufgaben-Start als drittes Task-Item gezeigt: "Verträge warten auf
 * Empfänger-Signaturen".
 *
 * `olderThanWeekCount` zählt zusätzlich, wieviele davon schon länger als 7 Tage
 * offen sind — diese Zahl füttert die Wireframe-Aussage "warten seit über einer
 * Woche". Wenn die Zahl > 0 ist, kann der Aufgaben-Start die schärfere
 * Formulierung wählen.
 */
export const getOutstandingSignatureCountRoute = authenticatedProcedure
  .input(ZGetOutstandingSignatureCountRequestSchema)
  .output(ZGetOutstandingSignatureCountResponseSchema)
  .query(async ({ ctx }) => {
    const baseWhere = {
      userId: ctx.user.id,
      type: EnvelopeType.DOCUMENT,
      status: DocumentStatus.PENDING,
      deletedAt: null,
      recipients: {
        some: {
          signingStatus: SigningStatus.NOT_SIGNED,
        },
      },
    } as const;

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [count, olderThanWeekCount] = await Promise.all([
      prisma.envelope.count({ where: baseWhere }),
      prisma.envelope.count({
        where: {
          ...baseWhere,
          createdAt: { lt: oneWeekAgo },
        },
      }),
    ]);

    return { count, olderThanWeekCount };
  });
