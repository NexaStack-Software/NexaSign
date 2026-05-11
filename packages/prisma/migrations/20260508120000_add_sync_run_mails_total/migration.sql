-- Erweiterte SyncRun-Telemetrie:
--   mailsTotal       — Obergrenze fuer den Lauf (vom IMAP-Search), erlaubt
--                       Frontend-Progress-Bar und ETA-Berechnung.
--   truncationReason — wenn ein Cap (RAM/Mails) gegriffen hat: BYTES_CAP /
--                       MAILS_CAP / null. UI zeigt das als Hinweis, statt den
--                       gekappten Lauf still als SUCCESS zu praesentieren.
ALTER TABLE "SyncRun"
  ADD COLUMN "mailsTotal" INTEGER,
  ADD COLUMN "truncationReason" TEXT;
