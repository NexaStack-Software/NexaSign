import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { uploadIntakeDocument } from '@nexasign/lib/server-only/intake/upload-document';
import { prisma } from '@nexasign/prisma';
import { seedUser } from '@nexasign/prisma/seed/users';

import { apiSignin } from '../fixtures/authentication';

const examplePdfPath = fileURLToPath(new URL('../../../../assets/example.pdf', import.meta.url));

type SeededUser = Awaited<ReturnType<typeof seedUser>>;

const pdfBytes = async () => new Uint8Array(await fs.readFile(examplePdfPath));

const cleanupDiscoveryFixtures = async ({
  documentIds,
  userIds,
}: {
  documentIds: string[];
  userIds: number[];
}) => {
  if (documentIds.length > 0) {
    await prisma.discoveryAuditLog.deleteMany({
      where: { discoveryDocumentId: { in: documentIds } },
    });
    await prisma.discoveryArtifact.deleteMany({
      where: { discoveryDocumentId: { in: documentIds } },
    });
    await prisma.discoveryDocument.deleteMany({
      where: { id: { in: documentIds } },
    });
  }

  for (const userId of userIds) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
};

const seedDiscoveryDocument = async ({
  seed,
  title,
  amount,
  invoiceNumber,
  withAttachment,
}: {
  seed: SeededUser;
  title: string;
  amount: string | null;
  invoiceNumber: string | null;
  withAttachment: boolean;
}) => {
  const bytes = await pdfBytes();
  const doc = await uploadIntakeDocument({
    teamId: seed.team.id,
    userId: seed.user.id,
    fileName: `${title}.pdf`,
    contentType: 'application/pdf',
    bytes,
  });

  await prisma.discoveryDocument.update({
    where: { id: doc.id },
    data: {
      title,
      correspondent: 'E2E Muster GmbH',
      detectedAmount: amount,
      detectedInvoiceNumber: invoiceNumber,
      documentDate: new Date('2026-04-30T00:00:00.000Z'),
      capturedAt: new Date('2026-05-01T09:00:00.000Z'),
      providerNativeId: `e2e-${doc.id}`,
      senderEmail: 'rechnung@e2e-muster.example',
      senderDomain: 'e2e-muster.example',
      bodyText: 'E2E Rechnung fuer den Dokumente-finden-Archivfluss.',
      archivePath: withAttachment ? `e2e/${doc.id}` : null,
    },
  });

  if (withAttachment) {
    await prisma.discoveryArtifact.create({
      data: {
        discoveryDocumentId: doc.id,
        kind: 'ATTACHMENT',
        fileName: `${title}.pdf`,
        contentType: 'application/pdf',
        fileSize: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        relativePath: `${title}.pdf`,
      },
    });
  }

  return doc.id;
};

const discoveryStatus = async (id: string) => {
  const doc = await prisma.discoveryDocument.findUniqueOrThrow({
    where: { id },
    select: { status: true, acceptedAt: true, archivedAt: true },
  });

  return `${doc.status}:${Boolean(doc.acceptedAt)}:${Boolean(doc.archivedAt)}`;
};

test.describe('Discovery archive UX flow', () => {
  test('stages row archive decisions until the user confirms them', async ({ page }) => {
    const seed = await seedUser({ name: 'E2E Discovery Archiv Staging' });
    const documentIds: string[] = [];

    try {
      const title = `E2E Rechnung Staged ${Date.now()}`;
      const docId = await seedDiscoveryDocument({
        seed,
        title,
        amount: '119,00',
        invoiceNumber: 'E2E-STAGED-1',
        withAttachment: true,
      });
      documentIds.push(docId);

      await apiSignin({
        page,
        email: seed.user.email,
        redirectPath: `/t/${seed.team.url}/find-documents?query=${encodeURIComponent(title)}`,
      });

      const row = page.locator('li', { hasText: title }).first();
      await expect(row).toBeVisible();
      await expect(row.getByText('Vormerken')).toBeVisible();
      await expect(row.getByText('Unten bestätigen')).toBeVisible();

      await row.getByRole('button', { name: 'Archiv' }).click();
      await expect(row.getByText('Wird erst mit „Bestätigen“ ins Archiv gelegt.')).toBeVisible();
      await expect.poll(async () => discoveryStatus(docId)).toBe('INBOX:false:false');

      await page.getByRole('button', { name: /Bestätigen/ }).click();
      await page.getByRole('button', { name: 'Ja, übernehmen' }).click();

      await expect(page.getByRole('heading', { name: 'Geschafft!' })).toBeVisible();
      await expect.poll(async () => discoveryStatus(docId)).toBe('ACCEPTED:true:false');

      await expect
        .poll(async () =>
          prisma.discoveryAuditLog.count({
            where: { discoveryDocumentId: docId, event: 'DISCOVERY_DOCUMENT_ACCEPTED' },
          }),
        )
        .toBe(1);
      await expect(
        await prisma.discoveryAuditLog.count({
          where: { discoveryDocumentId: docId, event: 'DISCOVERY_DOCUMENT_ARCHIVED' },
        }),
      ).toBe(0);
    } finally {
      await cleanupDiscoveryFixtures({
        documentIds,
        userIds: [seed.user.id],
      });
    }
  });

  test('archives the current review document immediately from review mode', async ({ page }) => {
    const seed = await seedUser({ name: 'E2E Discovery Review Sofort' });
    const documentIds: string[] = [];

    try {
      const title = `E2E Rechnung Review ${Date.now()}`;
      const docId = await seedDiscoveryDocument({
        seed,
        title,
        amount: '42,00',
        invoiceNumber: null,
        withAttachment: false,
      });
      documentIds.push(docId);

      await apiSignin({
        page,
        email: seed.user.email,
        redirectPath: `/t/${seed.team.url}/find-documents?query=${encodeURIComponent(title)}`,
      });

      await expect(page.getByText('Erst die Prüfung abschließen')).toBeVisible();
      await expect(page.getByRole('button', { name: /Bestätigen/ })).toBeDisabled();

      await page.getByRole('button', { name: 'Prüfung fortsetzen' }).click();
      await expect(page.getByText('Beleg 1 von 1 prüfen')).toBeVisible();
      await expect(page.getByText(title).first()).toBeVisible();

      await page.getByRole('button', { name: 'Jetzt ins Archiv' }).click();

      await expect.poll(async () => discoveryStatus(docId)).toBe('ACCEPTED:true:false');
      await expect
        .poll(async () =>
          prisma.discoveryAuditLog.count({
            where: { discoveryDocumentId: docId, event: 'DISCOVERY_DOCUMENT_ACCEPTED' },
          }),
        )
        .toBe(1);
    } finally {
      await cleanupDiscoveryFixtures({
        documentIds,
        userIds: [seed.user.id],
      });
    }
  });
});
