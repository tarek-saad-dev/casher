export type GoLiveMilestoneStatus = 'done' | 'pending' | 'not_applicable';

export type GoLiveMilestoneId =
  | 'commercial_access'
  | 'active_branch'
  | 'catalog'
  | 'team'
  | 'users'
  | 'business_day'
  | 'first_shift'
  | 'first_sale'
  | 'first_booking';

export type GoLiveMilestone = {
  id: GoLiveMilestoneId;
  label: string;
  detail: string;
  status: GoLiveMilestoneStatus;
  count: number | null;
  action: string;
};

export type TenantGoLiveReport = {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  ownerLoginName: string | null;
  bookingInstalled: boolean;
  status: 'READY_FOR_HANDOFF' | 'IN_PROGRESS';
  completed: number;
  total: number;
  progressPercent: number;
  milestones: GoLiveMilestone[];
  primaryBranch: {
    branchId: number;
    branchCode: string;
    branchName: string | null;
  } | null;
};
