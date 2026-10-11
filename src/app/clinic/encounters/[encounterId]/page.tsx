import EncounterWorkspace from './EncounterWorkspace';

export const metadata = {
  title: 'Clinical Encounter | DRVO Clinics',
};

export default async function EncounterPage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}) {
  const { encounterId } = await params;
  return <EncounterWorkspace encounterId={encounterId} />;
}
