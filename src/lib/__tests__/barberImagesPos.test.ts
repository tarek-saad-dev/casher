import { describe, expect, it } from 'vitest';
import { resolvePosBarberImageUrl } from '@/lib/barberImages';

describe('resolvePosBarberImageUrl', () => {
  it('prefers DB ImageUrl over name map', () => {
    expect(resolvePosBarberImageUrl('/barber-custom.jpg', 'كريم')).toBe('/barber-custom.jpg');
    expect(resolvePosBarberImageUrl('https://cdn.example/a.jpg', 'كريم')).toBe('https://cdn.example/a.jpg');
  });

  it('falls back to name presets when DB empty', () => {
    expect(resolvePosBarberImageUrl(null, 'كريم')).toBe('/barber-kareem.jpg');
    expect(resolvePosBarberImageUrl('', 'زياد')).toBe('/barber-ziad.jpg');
  });

  it('rejects unsafe schemes', () => {
    expect(resolvePosBarberImageUrl('javascript:alert(1)', 'كريم')).toBe('/barber-kareem.jpg');
  });
});
