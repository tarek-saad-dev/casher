import { describe,it,expect } from 'vitest';
import { GET as balance } from '@/app/api/public/client/loyalty/me/route';
import { GET as activity } from '@/app/api/public/client/loyalty/activity/route';
import { GET as rewards } from '@/app/api/public/client/loyalty/rewards/route';
import { GET as inventory } from '@/app/api/public/client/inventory/route';
import { GET as store } from '@/app/api/public/client/store/route';
import { GET as referral } from '@/app/api/public/client/referral/route';
import { POST as profile } from '@/app/api/public/client/profile/route';
import { POST as buy } from '@/app/api/public/client/store/buy/route';
import { POST as mystery } from '@/app/api/public/client/store/open-box/route';

describe('CUT CLUB old public clientId routes are fail-closed',()=>{
  it.each([
    ['balance',balance],['activity',activity],['rewards',rewards],
    ['inventory',inventory],['store',store],['referral',referral],
    ['phone-profile',profile],['coins-buy',buy],['open-box',mystery],
  ])('%s cannot read/mutate by guessing a customer id or phone',async(_name,handler)=>{
    // There must be no database connection, auth bypass or runtime side effect.
    // The retired route ignores all untrusted input and returns 403 immediately.
    const response=await handler();
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual({ok:false,code:'CUT_CLUB_VERIFIED_SESSION_REQUIRED'});
  });
});
