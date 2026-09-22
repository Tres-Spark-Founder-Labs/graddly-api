import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { EmailTemplate } from './email-template.enum.js';

/**
 * Every email template is a complete set: subject, HTML and text.
 *
 * `EmailTemplateRendererService.render` reads all three parts
 * unconditionally, so a set missing one fails in the email worker — after
 * the sender has already recorded the email as sent. The levy expiry
 * warnings (F1.1.2 AC4) had only their `.html.njk` and never reached an
 * employer; nothing failed where anyone was looking.
 *
 * Checked two ways, so neither kind of gap can hide: every value of the
 * `EmailTemplate` enum (what code can send) must have all three files, and
 * every template name found in `templates/emails` (what someone started
 * writing) must too.
 */
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates', 'emails');
const PARTS = ['subject', 'html', 'txt'] as const;

/** `name: missing part(s)` for each incomplete set. */
function incompleteSets(files: string[], sendable: string[]): string[] {
  const parts = new Map<string, Set<string>>();
  for (const file of files) {
    const match = /^(.+)\.(subject|html|txt)\.njk$/.exec(file);
    if (!match) continue;
    const [, name, part] = match;
    parts.set(name, (parts.get(name) ?? new Set()).add(part));
  }
  const names = new Set([...parts.keys(), ...sendable]);
  const problems: string[] = [];
  for (const name of [...names].sort()) {
    const have = parts.get(name) ?? new Set<string>();
    const missing = PARTS.filter((part) => !have.has(part));
    if (missing.length > 0) {
      problems.push(`${name}: missing ${missing.join(', ')}`);
    }
  }
  return problems;
}

describe('email template sets are complete', () => {
  const files = readdirSync(TEMPLATES_DIR);
  const sendable = Object.values(EmailTemplate) as string[];

  it('has templates to check', () => {
    // Guards the guard: an empty or moved directory would pass the check.
    expect(
      files.filter((f) => f.endsWith('.njk')).length,
    ).toBeGreaterThanOrEqual(sendable.length * PARTS.length);
  });

  it('has subject, HTML and text for every template, sendable or started', () => {
    expect(incompleteSets(files, sendable)).toEqual([]);
  });

  describe('the check still bites', () => {
    it('finds a set with only its HTML, as the levy expiry sets were', () => {
      expect(
        incompleteSets(['levy-expiry-90.html.njk'], ['levy-expiry-90']),
      ).toEqual(['levy-expiry-90: missing subject, txt']);
    });

    it('finds a sendable template with no files at all', () => {
      expect(incompleteSets([], ['new-template'])).toEqual([
        'new-template: missing subject, html, txt',
      ]);
    });

    it('finds a started set nothing sends yet', () => {
      expect(incompleteSets(['draft.subject.njk'], [])).toEqual([
        'draft: missing html, txt',
      ]);
    });
  });
});
