import ClinicDoctorWorklist from '../ClinicDoctorWorklist';

export const metadata = {
  title: 'جدول مرضاي | DRVO Clinics',
  description: 'مواعيد الطبيب المرتبطة بحسابه، وقائمة المرضى الجاهزين للكشف.',
};

export default function ClinicDoctorPage() {
  return <ClinicDoctorWorklist />;
}
