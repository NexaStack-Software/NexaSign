-- Sender-Adresse + Domain pro DiscoveryDocument. Wird vom IMAP-Adapter beim
-- Anlegen geschrieben; UI nutzt Domain fuer Portal-Direktlinks im
-- Korrespondenten-View, Adresse als Anzeige-Detail im Beleg.
ALTER TABLE "DiscoveryDocument"
  ADD COLUMN "senderEmail" TEXT,
  ADD COLUMN "senderDomain" TEXT;

CREATE INDEX "DiscoveryDocument_senderDomain_idx" ON "DiscoveryDocument"("senderDomain");
