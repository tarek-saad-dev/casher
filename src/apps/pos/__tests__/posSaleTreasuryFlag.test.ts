import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isPosSaleTreasuryPostingEnabled } from '../internal/posSaleTreasuryFlag';
import { getDrvoModuleRolloutSpec } from '@/platform/drvo/moduleManifest';

describe('DRVO-009 pos-sale-treasury flag', () => {
  afterEach(() => {
    delete process.env.POS_SALE_TREASURY_PORT;
    delete process.env.DRVO_FORCE_POS_SALE_TREASURY_PATH;
  });

  it('defaults to extracted from manifest after DRVO-009 Stage 2 activation', () => {
    const spec = getDrvoModuleRolloutSpec('pos-sale-treasury');
    expect(spec.drvoId).toBe('DRVO-009');
    expect(spec.rollout).toBe('extracted');
    expect(isPosSaleTreasuryPostingEnabled()).toBe(true);
  });

  it('force env legacy wins over manifest extracted', () => {
    process.env.DRVO_FORCE_POS_SALE_TREASURY_PATH = 'legacy';
    expect(isPosSaleTreasuryPostingEnabled()).toBe(false);
  });

  it('compat env true forces extracted for staging tests', () => {
    process.env.POS_SALE_TREASURY_PORT = 'true';
    expect(isPosSaleTreasuryPostingEnabled()).toBe(true);
  });

  it('force env legacy wins over compat true', () => {
    process.env.POS_SALE_TREASURY_PORT = 'true';
    process.env.DRVO_FORCE_POS_SALE_TREASURY_PATH = 'legacy';
    expect(isPosSaleTreasuryPostingEnabled()).toBe(false);
  });

  it('extracted POS sale create rejects zero-total via payment allocation gate', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/sales/route.ts'),
      'utf8',
    );
    expect(src).toContain('activeAllocations.length === 0');
    expect(src).toContain('amt > 0');
  });
});
