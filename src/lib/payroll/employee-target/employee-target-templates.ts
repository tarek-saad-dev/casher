export type EmployeeTargetTemplateTier = {
  inputStartAmount: number;
  ratePercent: number;
};

export type EmployeeTargetTemplate = {
  id: string;
  name: string;
  isEnabled: boolean;
  inputBasis: 'monthly';
  conversionDays: number;
  tiers: EmployeeTargetTemplateTier[];
  createdAt: string;
  updatedAt: string;
};

export type EmployeeTargetTemplatesFile = {
  version: 1;
  templates: EmployeeTargetTemplate[];
};

export function createEmptyTemplatesFile(): EmployeeTargetTemplatesFile {
  return { version: 1, templates: [] };
}

function parseTier(raw: unknown): EmployeeTargetTemplateTier[] {
  if (!Array.isArray(raw)) throw new Error('شرائح القالب غير صالحة');
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`شريحة القالب #${index + 1} غير صالحة`);
    }
    const t = item as Record<string, unknown>;
    const inputStartAmount = Number(t.inputStartAmount);
    const ratePercent = Number(t.ratePercent);
    if (!Number.isFinite(inputStartAmount) || inputStartAmount < 0) {
      throw new Error(`بداية شريحة القالب #${index + 1} غير صالحة`);
    }
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
      throw new Error(`نسبة شريحة القالب #${index + 1} غير صالحة`);
    }
    return { inputStartAmount, ratePercent };
  });
}

export function parseEmployeeTargetTemplatesFile(raw: unknown): EmployeeTargetTemplatesFile {
  if (!raw || typeof raw !== 'object') return createEmptyTemplatesFile();
  const b = raw as Record<string, unknown>;
  const list = Array.isArray(b.templates) ? b.templates : [];
  const templates: EmployeeTargetTemplate[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const id = typeof t.id === 'string' ? t.id.trim() : '';
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!id || !name) continue;
    try {
      const tiers = parseTier(t.tiers);
      const conversionDays = Number(t.conversionDays ?? 26);
      templates.push({
        id,
        name,
        isEnabled: Boolean(t.isEnabled),
        inputBasis: 'monthly',
        conversionDays:
          Number.isInteger(conversionDays) && conversionDays >= 1 && conversionDays <= 31
            ? conversionDays
            : 26,
        tiers,
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
        updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : new Date().toISOString(),
      });
    } catch {
      // skip corrupt template rows
    }
  }

  return { version: 1, templates };
}

export function serializeEmployeeTargetTemplatesFile(
  file: EmployeeTargetTemplatesFile,
): EmployeeTargetTemplatesFile {
  return {
    version: 1,
    templates: file.templates.map((t) => ({
      id: t.id,
      name: t.name,
      isEnabled: Boolean(t.isEnabled),
      inputBasis: 'monthly' as const,
      conversionDays: t.conversionDays,
      tiers: t.tiers.map((tier) => ({
        inputStartAmount: tier.inputStartAmount,
        ratePercent: tier.ratePercent,
      })),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  };
}

export function validateTemplateDraft(input: {
  name: string;
  isEnabled: boolean;
  tiers: Array<{ inputStartAmount: number | string; ratePercent: number | string }>;
}): { name: string; isEnabled: boolean; tiers: EmployeeTargetTemplateTier[] } {
  const name = input.name.trim();
  if (!name) throw new Error('اسم القالب مطلوب');
  if (name.length > 80) throw new Error('اسم القالب أطول من المسموح');

  const tiers = parseTier(input.tiers);
  if (input.isEnabled && tiers.length === 0) {
    throw new Error('القالب المفعّل يحتاج شريحة واحدة على الأقل');
  }

  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1]!.inputStartAmount;
    const cur = tiers[i]!.inputStartAmount;
    if (cur < prev) throw new Error('يجب ترتيب الشرائح تصاعديًا');
    if (cur === prev) throw new Error('لا يمكن تكرار بداية شريحتين');
  }

  return { name, isEnabled: input.isEnabled, tiers };
}

export function newTemplateId(): string {
  return `tt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
