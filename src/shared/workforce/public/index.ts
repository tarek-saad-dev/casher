export type {
  OccupancyPort,
  OccupancySource,
  TimeInterval,
} from './ports';
export { createLegacyWorkforceOccupancyAdapter } from '../internal/legacyAdapter';
export type {
  WorkforceEmployeeSnapshot,
  WorkforceLocationScope,
  WorkforceDirectoryFilter,
  WorkforceDirectoryPort,
} from './directory';
export { createLegacyWorkforceDirectoryAdapter } from '../internal/directoryAdapter';
