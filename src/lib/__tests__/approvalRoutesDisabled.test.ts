import { describe, it, expect } from 'vitest';
import { POST as approvePost } from '@/app/api/admin/approvals/[id]/approve/route';
import { POST as rejectPost } from '@/app/api/admin/approvals/[id]/reject/route';
import type { NextRequest } from 'next/server';

function nextReq(url: string): NextRequest {
  return new Request(url, { method: 'POST' }) as unknown as NextRequest;
}

describe('legacy approval endpoints', () => {
  it('approve endpoint returns 410 Gone', async () => {
    const res = await approvePost(nextReq('http://localhost:3000/api/admin/approvals/1/approve'));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain('إيقاف');
  });

  it('reject endpoint returns 410 Gone', async () => {
    const res = await rejectPost(nextReq('http://localhost:3000/api/admin/approvals/1/reject'));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain('إيقاف');
  });
});
