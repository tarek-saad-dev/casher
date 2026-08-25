/**
 * Temporary branch transfer public API (Phase A facade).
 * Runtime implementation remains src/lib/hr/temporaryBranchTransfer.ts
 */
import 'server-only';

export {
  cancelTemporaryBranchTransfer,
  createTemporaryBranchTransfer,
  listTemporaryBranchTransfers,
  previewTemporaryBranchTransfer,
  type TemporaryTransferListRow,
  type TransferPreviewResult,
} from './infra/temporaryBranchTransfer';
