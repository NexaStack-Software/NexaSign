-- Discovery rules store user-approved automation hints derived from repeated
-- archive/ignore decisions. Rules start as suggestions; active application is
-- intentionally explicit and auditable in the application layer.
CREATE TYPE "DiscoveryRuleScope" AS ENUM ('SENDER_DOMAIN');
CREATE TYPE "DiscoveryRuleAction" AS ENUM ('ARCHIVE', 'IGNORE');
CREATE TYPE "DiscoveryRuleStatus" AS ENUM ('SUGGESTED', 'ACTIVE', 'DISMISSED');

CREATE TABLE "DiscoveryRule" (
  "id" TEXT NOT NULL,
  "teamId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "scope" "DiscoveryRuleScope" NOT NULL,
  "pattern" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "action" "DiscoveryRuleAction" NOT NULL,
  "status" "DiscoveryRuleStatus" NOT NULL DEFAULT 'SUGGESTED',
  "confidence" INTEGER NOT NULL,
  "evidenceCount" INTEGER NOT NULL,
  "lastMatchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DiscoveryRule_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DiscoveryRule"
  ADD CONSTRAINT "DiscoveryRule_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveryRule"
  ADD CONSTRAINT "DiscoveryRule_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DiscoveryRule_teamId_userId_scope_pattern_action_key"
  ON "DiscoveryRule"("teamId", "userId", "scope", "pattern", "action");

CREATE INDEX "DiscoveryRule_teamId_userId_status_idx"
  ON "DiscoveryRule"("teamId", "userId", "status");

CREATE INDEX "DiscoveryRule_teamId_userId_scope_pattern_idx"
  ON "DiscoveryRule"("teamId", "userId", "scope", "pattern");
