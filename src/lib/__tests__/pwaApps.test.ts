import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CUT_STAFF_PWA,
  CUT_SYSTEM_PWA,
  buildWebManifest,
  resolveCutPwaApp,
} from '@/lib/pwa/apps';

const root = process.cwd();

function readPublicJson(relPath: string) {
  return JSON.parse(readFileSync(join(root, 'public', relPath), 'utf8'));
}

describe('dual CUT PWAs', () => {
  it('resolves staff vs system by route', () => {
    expect(resolveCutPwaApp('/').id).toBe('cut-system');
    expect(resolveCutPwaApp('/login').id).toBe('cut-system');
    expect(resolveCutPwaApp('/admin/hr').id).toBe('cut-system');
    expect(resolveCutPwaApp('/employee-portal').id).toBe('cut-staff');
    expect(resolveCutPwaApp('/employee-portal/change-password').id).toBe('cut-staff');
  });

  it('keeps unique identities, scopes, and start URLs', () => {
    expect(CUT_SYSTEM_PWA.manifestId).not.toBe(CUT_STAFF_PWA.manifestId);
    expect(CUT_SYSTEM_PWA.name).toBe('CUT SYSTEM');
    expect(CUT_STAFF_PWA.name).toBe('CUT STAFF');
    expect(CUT_SYSTEM_PWA.startUrl).toBe('/');
    expect(CUT_STAFF_PWA.startUrl).toBe('/employee-portal');
    expect(CUT_SYSTEM_PWA.scope).toBe('/');
    expect(CUT_STAFF_PWA.scope).toBe('/employee-portal');
    expect(CUT_SYSTEM_PWA.serviceWorkerUrl).not.toBe(CUT_STAFF_PWA.serviceWorkerUrl);
  });

  it('ships matching static manifests and icon assets', () => {
    const systemManifest = readPublicJson('manifests/cut-system.webmanifest');
    const staffManifest = readPublicJson('employee-portal/manifest.webmanifest');

    expect(systemManifest).toEqual(buildWebManifest(CUT_SYSTEM_PWA));
    expect(staffManifest).toEqual(buildWebManifest(CUT_STAFF_PWA));

    for (const file of [
      CUT_SYSTEM_PWA.icon192,
      CUT_SYSTEM_PWA.icon512,
      CUT_SYSTEM_PWA.appleTouchIcon,
      CUT_STAFF_PWA.icon192,
      CUT_STAFF_PWA.icon512,
      CUT_STAFF_PWA.appleTouchIcon,
      CUT_SYSTEM_PWA.serviceWorkerUrl,
      CUT_STAFF_PWA.serviceWorkerUrl,
    ]) {
      expect(existsSync(join(root, 'public', file.replace(/^\//, '')))).toBe(true);
    }
  });
});
