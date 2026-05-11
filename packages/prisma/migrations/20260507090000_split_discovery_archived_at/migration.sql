-- Trennt den GoBD-WORM-Trigger von "Beleg akzeptiert".
--
-- Vor dieser Migration war `acceptedAt` zugleich
--   (a) das Signal "User hat den Beleg als Geschäftsbeleg übernommen", und
--   (b) der WORM-Trigger (10-Jahres-Aufbewahrung, read-only ab dann).
--
-- Diese Doppelbelegung verhinderte den UX-Wunsch, einem User nach dem Akzept
-- noch einmal zu erlauben, Felder zu korrigieren oder den Beleg wieder
-- zurückzunehmen — alles war ab `acceptedAt` gesperrt.
--
-- Ab jetzt:
--   acceptedAt → "User hat den Beleg übernommen, ist im Archiv-Tab unter
--                'Zur Ablage bereit', editierbar."
--   archivedAt → "User hat 'Rechtssicher archivieren' geklickt, WORM aktiv,
--                10-Jahres-Frist läuft."
--
-- Migration der Bestandsdaten: alle bisherigen ACCEPTED/ARCHIVED-Belege haben
-- `acceptedAt` und galten als WORM. Sie bekommen `archivedAt = acceptedAt`,
-- damit der WORM-Status erhalten bleibt — nichts entWORMt sich.

ALTER TABLE "DiscoveryDocument"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" INTEGER;

ALTER TABLE "DiscoveryDocument"
  ADD CONSTRAINT "DiscoveryDocument_archivedById_fkey"
  FOREIGN KEY ("archivedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DiscoveryDocument_archivedAt_idx"
  ON "DiscoveryDocument"("archivedAt");

-- Backfill: jeder bestehende ACCEPTED/ARCHIVED-Beleg, der vor der Migration
-- WORM war, bleibt WORM. archivedAt = acceptedAt; archivedById = acceptedById.
-- Belege ohne acceptedAt (INBOX, IGNORED, PENDING_MANUAL) bleiben unangetastet.
UPDATE "DiscoveryDocument"
   SET "archivedAt"   = "acceptedAt",
       "archivedById" = "acceptedById"
 WHERE "acceptedAt" IS NOT NULL;
