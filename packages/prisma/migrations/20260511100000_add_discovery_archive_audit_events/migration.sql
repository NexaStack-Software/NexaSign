-- Audit-Events sauber nach Nutzerabsicht trennen:
--   DISCOVERY_DOCUMENT_ACCEPTED   = Beleg uebernommen, noch korrigierbar.
--   DISCOVERY_DOCUMENT_ARCHIVED   = Beleg endgueltig archiviert, WORM aktiv.
--   DISCOVERY_DOCUMENT_UNACCEPTED = aus der korrigierbaren Archiv-Stufe zurueck in den Eingang.
ALTER TYPE "DiscoveryAuditEvent" ADD VALUE 'DISCOVERY_DOCUMENT_ARCHIVED';
ALTER TYPE "DiscoveryAuditEvent" ADD VALUE 'DISCOVERY_DOCUMENT_UNACCEPTED';
