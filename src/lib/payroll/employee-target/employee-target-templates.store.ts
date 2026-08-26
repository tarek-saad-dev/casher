import 'server-only';

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  createEmptyTemplatesFile,
  newTemplateId,
  parseEmployeeTargetTemplatesFile,
  serializeEmployeeTargetTemplatesFile,
  validateTemplateDraft,
  type EmployeeTargetTemplate,
  type EmployeeTargetTemplatesFile,
} from './employee-target-templates';

const TEMPLATES_FILE = path.join(process.cwd(), 'data', 'employee-target-templates.json');

async function ensureFile(): Promise<void> {
  await mkdir(path.dirname(TEMPLATES_FILE), { recursive: true });
  try {
    await readFile(TEMPLATES_FILE, 'utf-8');
  } catch {
    const initial = serializeEmployeeTargetTemplatesFile(createEmptyTemplatesFile());
    await writeFile(TEMPLATES_FILE, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8');
  }
}

async function readFileData(): Promise<EmployeeTargetTemplatesFile> {
  await ensureFile();
  const raw = await readFile(TEMPLATES_FILE, 'utf-8');
  return parseEmployeeTargetTemplatesFile(JSON.parse(raw) as unknown);
}

async function writeFileData(file: EmployeeTargetTemplatesFile): Promise<void> {
  await mkdir(path.dirname(TEMPLATES_FILE), { recursive: true });
  const serialized = serializeEmployeeTargetTemplatesFile(file);
  await writeFile(TEMPLATES_FILE, `${JSON.stringify(serialized, null, 2)}\n`, 'utf-8');
}

export async function listEmployeeTargetTemplates(): Promise<EmployeeTargetTemplate[]> {
  const file = await readFileData();
  return [...file.templates].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export async function createEmployeeTargetTemplate(input: {
  name: string;
  isEnabled: boolean;
  tiers: Array<{ inputStartAmount: number | string; ratePercent: number | string }>;
  conversionDays?: number;
}): Promise<EmployeeTargetTemplate> {
  const draft = validateTemplateDraft(input);
  const now = new Date().toISOString();
  const conversionDays =
    input.conversionDays != null &&
    Number.isInteger(input.conversionDays) &&
    input.conversionDays >= 1 &&
    input.conversionDays <= 31
      ? input.conversionDays
      : 26;

  const template: EmployeeTargetTemplate = {
    id: newTemplateId(),
    name: draft.name,
    isEnabled: draft.isEnabled,
    inputBasis: 'monthly',
    conversionDays,
    tiers: draft.tiers,
    createdAt: now,
    updatedAt: now,
  };

  const file = await readFileData();
  const sameName = file.templates.find(
    (t) => t.name.trim().toLocaleLowerCase('ar') === draft.name.toLocaleLowerCase('ar'),
  );
  if (sameName) {
    sameName.isEnabled = template.isEnabled;
    sameName.inputBasis = 'monthly';
    sameName.conversionDays = template.conversionDays;
    sameName.tiers = template.tiers;
    sameName.updatedAt = now;
    await writeFileData(file);
    return sameName;
  }

  file.templates.push(template);
  await writeFileData(file);
  return template;
}

export async function deleteEmployeeTargetTemplate(id: string): Promise<boolean> {
  const file = await readFileData();
  const next = file.templates.filter((t) => t.id !== id);
  if (next.length === file.templates.length) return false;
  file.templates = next;
  await writeFileData(file);
  return true;
}
