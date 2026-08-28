/** Default team-facing booking notification (group channel). */
export const BOOKING_TEAM_NOTIFICATION_DEFAULT_TEMPLATE = `🔔 حجز جديد

العميل: {{customerName}}
📅 التاريخ: {{bookingDate}}
🕐 الوقت: {{bookingTime}}
💇 الحلاق: {{barberName}}
✂️ الخدمات: {{services}}
🏢 الفرع: {{branchName}}
🔖 رقم الحجز: {{bookingId}}`;

export const BOOKING_CANCELLED_TEAM_DEFAULT_TEMPLATE = `❌ تم إلغاء حجز

العميل: {{customerName}}
📅 التاريخ: {{bookingDate}}
🕐 الوقت: {{bookingTime}}
💇 الحلاق: {{barberName}}
🏢 الفرع: {{branchName}}
🔖 رقم الحجز: {{bookingId}}`;

export const BOOKING_MOVED_TEAM_DEFAULT_TEMPLATE = `🔄 تم تعديل موعد حجز

العميل: {{customerName}}
📅 الموعد الجديد: {{bookingDate}}
🕐 الساعة: {{bookingTime}}
💇 الحلاق: {{barberName}}
🏢 الفرع: {{branchName}}
🔖 رقم الحجز: {{bookingId}}`;

export const SALE_TEAM_DEFAULT_TEMPLATE = `💰 فاتورة مبيعات جديدة

العميل: {{customerName}}
رقم الفاتورة: {{invoiceNumber}}
الإجمالي: {{total}} ج.م
🏢 الفرع: {{branchName}}`;
