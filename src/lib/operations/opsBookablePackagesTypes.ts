export type OpsBookablePackageService = {
  serviceId: number;
  nameAr: string;
  price: number;
  durationMinutes: number;
};

/** Package as resolved for one branch by the public booking package resolver. */
export type OpsBookablePackage = {
  packageId: number;
  kind: 'regular' | 'groom';
  nameAr: string;
  nameEn: string;
  /** Resolved booking total (PackagePrice). */
  price: number;
  originalPrice: number | null;
  /** Resolved booking duration — drives slot generation. */
  durationMinutes: number;
  serviceIds: number[];
  services: OpsBookablePackageService[];
  available: boolean;
  unavailableReason: string | null;
};

export type OpsBookablePackagesResponse = {
  ok: true;
  branchCode: string;
  packages: OpsBookablePackage[];
};
