/**
 * WhatsApp group notification targets — domain types.
 */

/** System events that can trigger a group message. */
export type WhatsAppGroupEventKey =
  | 'booking.created'
  | 'booking.cancelled'
  | 'booking.moved'
  | 'sale.completed';

export type WhatsAppGroupRow = {
  id: number;
  name: string;
  inviteLink: string;
  subscribedEvents: WhatsAppGroupEventKey[];
  branchId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type WhatsAppGroupInput = {
  name: string;
  inviteLink: string;
  subscribedEvents: WhatsAppGroupEventKey[];
  branchId?: number | null;
  isActive?: boolean;
};

export type WhatsAppGroupSendResult = {
  groupId: number;
  groupName: string;
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  messageId?: string;
};
