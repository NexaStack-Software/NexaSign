-- Audit-Event für „User hat ein erkanntes Feld manuell korrigiert" — die
-- vom IMAP-Klassifikator extrahierten Werte (Betrag, Rechnungs-Nr,
-- Korrespondent) sind Heuristiken und treffen nicht jeden Fall. Edits sind
-- vor `acceptedAt` zulässig; nach Akzeptieren greift WORM. Jeder Edit wird
-- einzeln im Audit-Log mit Liste der geänderten Felder festgehalten.
ALTER TYPE "DiscoveryAuditEvent" ADD VALUE 'DISCOVERY_DOCUMENT_UPDATED';
