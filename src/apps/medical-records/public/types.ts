export type ClinicEncounterStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type ClinicVisitType = 'new' | 'follow_up' | 'procedure';

export type ClinicPrescriptionStatus = 'draft' | 'signed' | 'void';

export type ClinicPatientProfile = {
  tenantId: string;
  clientId: number;
  bloodType: string | null;
  allergies: string | null;
  chronicConditions: string | null;
  currentMedications: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  updatedAt: Date;
};

export type ClinicEncounter = {
  encounterId: string;
  tenantId: string;
  clientId: number;
  practitionerEmpId: number;
  locationId: string;
  bookingRef: string | null;
  visitType: ClinicVisitType;
  status: ClinicEncounterStatus;
  chiefComplaint: string | null;
  clinicalNotes: string | null;
  diagnosisSummary: string | null;
  vitalsJson: string | null;
  followUpAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ClinicPrescriptionItem = {
  medicationName: string;
  strength?: string | null;
  dosage?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
};

export type ClinicPrescription = {
  prescriptionId: string;
  tenantId: string;
  encounterId: string;
  practitionerEmpId: number;
  status: ClinicPrescriptionStatus;
  notes: string | null;
  signedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: ClinicPrescriptionItem[];
};
