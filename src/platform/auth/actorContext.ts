export type ActorType = 'platform_admin' | 'staff' | 'customer' | 'service';

export interface ActorContext {
  actorType: ActorType;
  actorId: string;
  tenantId: string | null;
  membershipId: string | null;
  viewLocationId: string | null;
}

export interface StaffActorContext extends ActorContext {
  actorType: 'staff';
  tenantId: string;
  membershipId: string;
}
