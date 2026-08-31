import { isAiControlPlanePhase1Enabled } from '../featureFlag';
import type { ControlPlaneStore } from './memoryStore';
import { MemoryControlPlaneStore } from './memoryStore';

let sqlStore: ControlPlaneStore | null = null;
let sqlProbe: boolean | null = null;

async function probeSqlReady(): Promise<boolean> {
  if (sqlProbe != null) return sqlProbe;
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    sqlProbe = false;
    return false;
  }
  try {
    const { probeControlPlaneTables } = await import('./sqlRepository');
    const p = await probeControlPlaneTables();
    sqlProbe = p.ready;
    return p.ready;
  } catch {
    sqlProbe = false;
    return false;
  }
}

export async function getControlPlaneStore(): Promise<ControlPlaneStore> {
  if (!(await probeSqlReady())) {
    return new MemoryControlPlaneStore();
  }
  if (!sqlStore) {
    const { SqlControlPlaneStore } = await import('./sqlRepository');
    sqlStore = new SqlControlPlaneStore();
  }
  return sqlStore;
}

export function requireControlPlaneEnabled(): void {
  if (!isAiControlPlanePhase1Enabled()) {
    throw new Error('AI_CONTROL_PLANE_PHASE1 is not enabled');
  }
}
