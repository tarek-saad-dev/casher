export type HardInvariant = {
  id: string;
  descriptionAr: string;
  descriptionEn: string;
  patterns: RegExp[];
};

export const HARD_INVARIANTS: HardInvariant[] = [
  {
    id: 'BOOKING_SUCCESS_REQUIRES_COMMITTED_BOOKING',
    descriptionAr: 'لا يتم تأكيد نجاح الحجز قبل اكتماله فعليًا في النظام.',
    descriptionEn: 'Never claim booking success before committed booking.',
    patterns: [
      /تم\s*الحجز|قول.*تم.*حجز|أكد.*حجز.*قبل|نجاح\s*الحجز\s*قبل/i,
      /claim.*booking.*success|before.*commit/i,
    ],
  },
  {
    id: 'NO_FAKE_COMMITTED_STATE',
    descriptionAr: 'لا يُسمح بادعاء حالة حجز غير موجودة في السجل.',
    descriptionEn: 'No fake committed booking state.',
    patterns: [/حجز\s*مؤكد\s*من\s*غير|fake.*booking|ادعاء.*حجز/i],
  },
  {
    id: 'HUMAN_CONTROL_SUPPRESSES_AI',
    descriptionAr: 'عند استلام الموظف للمحادثة، البوت لا يكمل الرد.',
    descriptionEn: 'Human takeover suppresses AI replies.',
    patterns: [
      /موظف\s*استلم|استلم\s*الشات|خلي\s*البوت\s*يكمل.*موظف|حتى\s*لو\s*موظف/i,
      /human.*takeover|bot.*continue.*human/i,
    ],
  },
  {
    id: 'NO_AI_BOOKING_MUTATION_WHILE_HUMAN',
    descriptionAr: 'لا تعديل على الحجز أثناء تحكم الموظف.',
    descriptionEn: 'No AI booking mutation during human control.',
    patterns: [/البوت.*يلغي.*موظف|bot.*cancel.*human/i],
  },
  {
    id: 'BOOKING_MUTATION_REQUIRES_DOMAIN_VALIDATION',
    descriptionAr: 'إلغاء أو تعديل الحجز يتطلب مسار التأكيد المعتمد.',
    descriptionEn: 'Booking mutations require confirmation workflow.',
    patterns: [
      /الغي\s*الحجز\s*فور|ألغ.*من\s*غير\s*تأكيد|الغيه\s*فور/i,
      /cancel.*without.*confirm/i,
      /من\s*غير\s*مسار\s*التأكيد/i,
    ],
  },
  {
    id: 'CUSTOMER_BOOKING_OWNERSHIP_REQUIRED',
    descriptionAr: 'لا يمكن تجاوز ملكية الحجز للعميل.',
    descriptionEn: 'Customer booking ownership required.',
    patterns: [/حجز\s*عميل\s*تاني|bypass.*ownership/i],
  },
  {
    id: 'IDEMPOTENT_TRANSACTIONAL_MUTATIONS',
    descriptionAr: 'المعاملات يجب أن تبقى idempotent وآمنة.',
    descriptionEn: 'Transactional mutations must remain idempotent.',
    patterns: [/تعطيل.*idempotent|disable.*idempotency/i],
  },
];

export type InvariantCheckResult = {
  blocked: boolean;
  invariantId: string | null;
  messageAr: string | null;
};

export function checkHardInvariants(text: string, artifactInstruction?: string): InvariantCheckResult {
  const combined = `${text}\n${artifactInstruction ?? ''}`;
  for (const inv of HARD_INVARIANTS) {
    for (const pattern of inv.patterns) {
      if (pattern.test(combined)) {
        return { blocked: true, invariantId: inv.id, messageAr: inv.descriptionAr };
      }
    }
  }
  return { blocked: false, invariantId: null, messageAr: null };
}

export function getInvariantById(id: string): HardInvariant | undefined {
  return HARD_INVARIANTS.find((i) => i.id === id);
}
