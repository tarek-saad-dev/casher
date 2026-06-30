// Shared types — safe to import in both client and server components

export interface UserAccess {
  userID: number;
  userName: string;
  userLevel: string;
  roles: string[];
  isSuperAdmin: boolean;
  isPartnerOnly: boolean;
  defaultLandingPath: string;
  allowedPagePaths: string[];
  allowedPageKeys: string[];
}

export interface PageAccess {
  pageKey: string;
  pageName: string;
  pagePath: string;
  section: string | null;
  accessMode: 'all' | 'roles' | 'super_admin_only';
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
}
