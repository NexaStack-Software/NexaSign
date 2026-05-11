// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { DocumentStatus, EnvelopeType, SigningStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@nexasign/prisma';

import { authenticatedProcedure } from '../trpc';

export const ZFindOutstandingForSignerRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
  })
  .optional();

export const ZFindOutstandingForSignerResponseSchema = z.object({
  envelopes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      sentAt: z.coerce.date().nullable(),
      createdAt: z.coerce.date(),
      totalRecipients: z.number().int(),
      signedRecipients: z.number().int(),
      hasReminderEligible: z.boolean(),
    }),
  ),
});

export type TFindOutstandingForSignerResponse = z.infer<
  typeof ZFindOutstandingForSignerResponseSchema
>;

/**
 * Liste der Envelopes, die der angemeldete User selbst zur Unterschrift
 * verschickt hat und die noch auf mindestens eine Empfänger-Unterschrift
 * warten. Für die Lifecycle-Hub-Liste — dort werden Discovery-Belege und
 * Envelope-Items zusammen gezeigt.
 */
export const findOutstandingForSignerRoute = authenticatedProcedure
  .input(ZFindOutstandingForSignerRequestSchema)
  .output(ZFindOutstandingForSignerResponseSchema)
  .query(async ({ input, ctx }) => {
    const limit = input?.limit ?? 20;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const envelopes = await prisma.envelope.findMany({
      where: {
        userId: ctx.user.id,
        type: EnvelopeType.DOCUMENT,
        status: DocumentStatus.PENDING,
        deletedAt: null,
        recipients: {
          some: { signingStatus: SigningStatus.NOT_SIGNED },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        createdAt: true,
        recipients: {
          select: { signingStatus: true },
        },
      },
    });

    return {
      envelopes: envelopes.map((env) => {
        const total = env.recipients.length;
        const signed = env.recipients.filter(
          (r) => r.signingStatus === SigningStatus.SIGNED,
        ).length;
        return {
          id: env.id,
          title: env.title,
          sentAt: env.createdAt, // dateSent ist nicht persisted — createdAt ist die nächstbeste Zeitangabe.
          createdAt: env.createdAt,
          totalRecipients: total,
          signedRecipients: signed,
          // Erinnerung sinnvoll, wenn der Lauf älter als 7 Tage ist.
          hasReminderEligible: env.createdAt < oneWeekAgo,
        };
      }),
    };
  });
