// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LaunchSetup from '@/components/onboarding/LaunchSetup';

const { openMyShift, refresh } = vi.hoisted(()=>({openMyShift:vi.fn(async (_id:number)=>{}),refresh:vi.fn(async()=>{})}));
vi.mock('@/hooks/useSession',()=>({useSession:()=>({loading:false,user:{UserID:1},hasActiveDay:true,hasActiveShift:false,hasOpenShift:false,defaultShiftId:null,openMyShift,refresh})}));

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
describe('onboarding launch without a default shift',()=>{
  it.each([
    {format:'actual array',body:[{ShiftID:3,ShiftName:'Morning'},{ShiftID:0,ShiftName:'Invalid'}]},
    {format:'legacy wrapper',body:{shifts:[{ShiftID:3,ShiftName:'Morning'}]}},
  ])('loads $format and opens the selected shift',async({body})=>{
    const onSaved=vi.fn(async()=>{});
    const request=vi.fn(async()=>new Response(JSON.stringify(body),{status:200}));
    vi.stubGlobal('fetch',request);
    render(<LaunchSetup onSaved={onSaved}/>);
    const button=screen.getByRole('button',{name:'فتح وردية'});
    expect(button).toBeDisabled();
    const select=await screen.findByRole('combobox',{name:'اختيار الوردية'});
    expect(screen.getByRole('option',{name:'Morning'})).toBeInTheDocument();
    expect(screen.queryByRole('option',{name:'Invalid'})).not.toBeInTheDocument();
    fireEvent.change(select,{target:{value:'3'}});
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(()=>expect(onSaved).toHaveBeenCalledTimes(1));
    expect(openMyShift).toHaveBeenCalledExactlyOnceWith(3);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual(['/api/shift/definitions',expect.objectContaining({cache:'no-store'})]);
  });
});
