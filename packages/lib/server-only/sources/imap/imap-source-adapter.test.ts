// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 NexaStack, NexaSign contributors
import { describe, expect, it } from 'vitest';

import { pickMailboxes } from './imap-source-adapter';

describe('pickMailboxes', () => {
  it('prefers Gmail All Mail over individual folders', async () => {
    const client = {
      list: async () => Promise.resolve([
        { path: 'INBOX', specialUse: '\\Inbox' },
        { path: '[Gmail]/All Mail', specialUse: '\\All' },
        { path: '[Gmail]/Sent Mail', specialUse: '\\Sent' },
      ]),
    };

    await expect(pickMailboxes(client)).resolves.toEqual(['[Gmail]/All Mail']);
  });

  it('includes inbox and recognized archive folders for non-Gmail providers', async () => {
    const client = {
      list: async () => Promise.resolve([
        { path: 'INBOX', specialUse: '\\Inbox' },
        { path: 'Archive', specialUse: '\\Archive' },
        { path: 'Rechnungen', specialUse: null },
        { path: 'Spam', specialUse: '\\Junk' },
      ]),
    };

    await expect(pickMailboxes(client)).resolves.toEqual([
      'INBOX',
      'Archive',
      'Rechnungen',
    ]);
  });
});
