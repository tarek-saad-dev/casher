import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const stubs=vi.hoisted(()=>({admin:vi.fn(),page:vi.fn()}));
vi.mock('@/lib/api-auth',()=>({requireAdmin:stubs.admin,requirePageAccess:stubs.page,isAuthResult:(v:unknown)=>!!v&&typeof v==='object'&&'ok' in v&&v.ok===true}));
import {receptionAllowed,requireDecemberReception} from './receptionAuth';
const admin={ok:true,userId:1},staff={ok:true,userId:17};
describe('December reception permission boundary',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('DECEMBER_EXAM_RECEPTION_USER_IDS','17, 24');stubs.admin.mockResolvedValue(new NextResponse(null,{status:403}));stubs.page.mockResolvedValue(staff);});
 it('allows only an explicitly assigned numeric ID',()=>{expect(receptionAllowed(17,'17, 24')).toBe(true);expect(receptionAllowed(1,'17,24')).toBe(false);expect(receptionAllowed(0,'0')).toBe(false);expect(receptionAllowed(17,undefined)).toBe(false);});
 it('allows admin directly',async()=>{stubs.admin.mockResolvedValue(admin);expect(await requireDecemberReception()).toEqual(admin);expect(stubs.page).not.toHaveBeenCalled();});
 it('requires the POS gate and assigned staff',async()=>{expect(await requireDecemberReception()).toEqual(staff);expect(stubs.page).toHaveBeenCalledWith('/income/pos');vi.stubEnv('DECEMBER_EXAM_RECEPTION_USER_IDS','24');expect((await requireDecemberReception() as NextResponse).status).toBe(403);});
 it('does not bypass a denied POS gate',async()=>{stubs.page.mockResolvedValue(new NextResponse(null,{status:401}));expect((await requireDecemberReception() as NextResponse).status).toBe(401);});
});
