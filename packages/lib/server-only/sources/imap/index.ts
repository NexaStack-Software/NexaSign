// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
// Side-effect-Import: registriert imapSourceAdapter in der Registry beim Laden.
import './imap-source-adapter';

export { imapSourceAdapter } from './imap-source-adapter';
export {
  encryptImapConfig,
  decryptImapConfig,
  CURRENT_KEY_VERSION,
  type EncryptedImapConfig,
} from './imap-credentials';
export {
  validateImapHost,
  getDefaultImapHostAllowlist,
  isCustomImapHostsAllowed,
  type HostValidationResult,
} from './host-allowlist';
export type { ImapAccountConfig } from './types';
export { ZImapAccountConfigSchema } from './types';
export { resyncSingleDocument } from './imap-resync-single';
export type { ResyncSingleInput, ResyncSingleResult } from './imap-resync-single';
export { lookupPortalUrl, PORTAL_URLS_BY_DOMAIN } from './keywords';
export { parseAmountToNumber } from './classifier';
