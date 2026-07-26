import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');

describe('phase1oCampCaesarSharedIntegrations', () => {
  it('shared printer/whatsapp policies with branch identity', () => {
    const pol = fs.readFileSync(path.join(root, 'src/lib/branch/branchSetupPolicy.ts'), 'utf8');
    const rec = fs.readFileSync(path.join(root, 'src/lib/branch/branchReceiptIdentity.ts'), 'utf8');
    expect(pol).toContain('SharedPrinterApproved');
    expect(pol).toContain('SharedWhatsAppApproved');
    expect(rec).toContain('mock-no-print');
    expect(rec).toContain('containsGleemName');
  });
});
