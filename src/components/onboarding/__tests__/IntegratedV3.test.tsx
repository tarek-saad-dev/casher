// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PublicSignupFlow from '@/components/public/PublicSignupFlow';
import TrainingExperience from '@/components/onboarding/TrainingExperience';

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

function advanceSignup(){
  fireEvent.change(screen.getByLabelText('رقم الموبايل'),{target:{value:'01012345678'}});
  fireEvent.click(screen.getByRole('button',{name:'متابعة'}));
  fireEvent.change(screen.getByLabelText('الاسم بالكامل'),{target:{value:'Test Owner'}});
  fireEvent.change(screen.getByPlaceholderText('10 أحرف على الأقل'),{target:{value:'test-password-123'}});
  fireEvent.change(screen.getByLabelText('تأكيد كلمة المرور'),{target:{value:'test-password-123'}});
  fireEvent.click(screen.getByRole('button',{name:'متابعة'}));
  fireEvent.click(screen.getByRole('button',{name:/صالون \/ Barbershop/}));
  fireEvent.change(screen.getByLabelText('اسم المنشأة'),{target:{value:'Test Salon'}});
  fireEvent.click(screen.getByRole('button',{name:'متابعة'}));
  fireEvent.click(screen.getByRole('button',{name:'متابعة'}));
}

describe('V3 registration interface',()=>{
  it('requires the final OTP proof, sends only the phone and consumes the proof in the signup request',async()=>{
    const fetchMock=vi.fn(async (url:string,opts?:RequestInit)=>{
      if(url.endsWith('/otp/send'))return new Response(JSON.stringify({ok:true,ticket:'test-ticket',expiresAtUtc:new Date(Date.now()+240000).toISOString(),resendAfterSec:60}),{status:200});
      if(url.endsWith('/complete'))return new Response(JSON.stringify({ok:true,ownerLoginName:'owner-test',nextPath:'/setup'}),{status:201});
      throw new Error('Unexpected request');
    });
    vi.stubGlobal('fetch',fetchMock);
    render(<PublicSignupFlow otpRequired/>);
    fireEvent.click(screen.getByRole('button',{name:'متابعة'}));
    expect(screen.getByRole('alert')).toHaveTextContent('اكتب رقم موبايل مصري صحيح.');
    advanceSignup();
    expect(screen.getByRole('button',{name:'إنشاء الحساب'})).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'إرسال رمز التحقق'}));
    const input=await screen.findByLabelText('رمز التحقق');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({phone:'01012345678'});
    fireEvent.change(input,{target:{value:'123456'}});
    fireEvent.click(screen.getByRole('button',{name:'إنشاء الحساب'}));
    await waitFor(()=>expect(screen.getByText('owner-test')).toBeInTheDocument());
    const body=JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({industry:'salon',phone:'01012345678',otp:{ticket:'test-ticket',code:'123456'}});
    expect(body).not.toHaveProperty('confirmation');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does not require an OTP or request one when the server flag is off',()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    render(<PublicSignupFlow otpRequired={false}/>);
    advanceSignup();
    expect(screen.queryByRole('button',{name:'إرسال رمز التحقق'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'إنشاء الحساب'})).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
describe('V3 training interface',()=>{
  it('completes all six exercises without operational fetch or persistent storage',()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    const storage=vi.spyOn(Storage.prototype,'setItem');
    render(<TrainingExperience apps={['pos','booking','queue','treasury']}/>);
    const click=(name:string)=>fireEvent.click(screen.getByRole('button',{name}));
    click('حفظ العميل التدريبي');
    fireEvent.click(screen.getByRole('radio',{name:'بطاقة'}));
    click('حفظ فاتورة تدريبية');
    click('تأكيد الموعد التدريبي');
    click('إضافة للطابور التدريبي');
    const amount=screen.getByLabelText('النقد الذي عدّيته (ج.م)');
    fireEvent.change(amount,{target:{value:'200'}});
    click('مطابقة الخزنة');
    expect(screen.getByRole('alert')).toHaveTextContent('راجع النقد الموجود');
    fireEvent.change(amount,{target:{value:'0'}});
    click('مطابقة الخزنة');
    click('قفل الوردية التدريبية');
    expect(screen.getByText('خلصت التدريب!')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    click('إعادة التدريب');
    expect(screen.getByRole('button',{name:'حفظ العميل التدريبي'})).toBeInTheDocument();
  });
});
