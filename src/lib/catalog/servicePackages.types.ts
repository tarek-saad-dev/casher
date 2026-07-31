import type { PackageKind } from '@/lib/migrations/ensureServicePackages';

export interface PackageItemInput {
  ProID: number;
  Qty?: number;
  SortOrder?: number;
  IsOptional?: boolean;
}

export interface PackageItemRow {
  PackageItemID: number;
  PackageID: number;
  ProID: number;
  Qty: number;
  SortOrder: number;
  IsOptional: boolean;
  ProName: string | null;
  ProNameAr: string | null;
  SPrice1: number | null;
  DurationMinutes: number | null;
}

export interface ServicePackageRow {
  PackageID: number;
  NameEn: string;
  NameAr: string | null;
  PackageKind: PackageKind;
  PackagePrice: number;
  OriginalPrice: number | null;
  DurationMinutes: number | null;
  Bonus: number;
  ImageUrl: string | null;
  DescriptionAr: string | null;
  DescriptionEn: string | null;
  SortOrder: number;
  IsPopular: boolean;
  isDeleted: boolean;
  DepositAmount: number | null;
  IncludesTrial: boolean;
  SessionCount: number | null;
  NotesAr: string | null;
  CreatedAt?: string | null;
  UpdatedAt?: string | null;
  ItemCount?: number;
  items?: PackageItemRow[];
}

export interface PackageWriteBody {
  NameEn: string;
  NameAr?: string | null;
  PackageKind: PackageKind;
  PackagePrice: number;
  OriginalPrice?: number | null;
  DurationMinutes?: number | null;
  Bonus?: number;
  ImageUrl?: string | null;
  DescriptionAr?: string | null;
  DescriptionEn?: string | null;
  SortOrder?: number;
  IsPopular?: boolean;
  isActive?: boolean;
  DepositAmount?: number | null;
  IncludesTrial?: boolean;
  SessionCount?: number | null;
  NotesAr?: string | null;
  items?: PackageItemInput[];
}
