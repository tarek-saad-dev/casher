import {
  drvowaIntegrationErrorResponse,
  requireDrvowaIntegrationAuth,
} from '@/lib/integrations/drvowaAuth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireDrvowaIntegrationAuth(request);
    return Response.json({
      contractVersion: 'drvowa-erp-v1',
      provider: 'DRVOERP',
      providerVersion: 'casher-v1',
      capabilities: [
        'booking.read',
        'booking.availability',
        'booking.plan',
        'booking.create',
        'booking.cancel',
        'booking.reschedule',
      ],
      tools: [
        {
          name: 'booking.get_upcoming',
          description: 'Get upcoming bookings for a customer phone number.',
          mode: 'READ',
          approval: 'AUTO',
          inputSchema: {
            phone: 'string',
            fromDate: 'YYYY-MM-DD optional',
            limit: 'number optional',
          },
        },
        {
          name: 'booking.get_by_code',
          description: 'Get one booking by booking code and customer phone.',
          mode: 'READ',
          approval: 'AUTO',
          inputSchema: {
            code: 'string',
            phone: 'string',
          },
        },
        {
          name: 'booking.get_availability',
          description: 'Get booking availability matrix for branch/date/services.',
          mode: 'READ',
          approval: 'AUTO',
          inputSchema: {
            branchCode: 'string',
            fromBusinessDate: 'YYYY-MM-DD',
            toBusinessDate: 'YYYY-MM-DD',
            serviceIds: 'number[] optional',
            employeeId: 'number optional',
          },
        },
        {
          name: 'booking.plan',
          description: 'Validate a requested booking slot and return canonical plan token.',
          mode: 'READ',
          approval: 'AUTO',
          inputSchema: {
            branchCode: 'string',
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            dayOffset: '0|1',
            serviceIds: 'number[]',
            empId: 'number optional',
            mode: 'specific_barber|any_barber',
          },
        },
        {
          name: 'booking.create',
          description: 'Create a customer booking using a valid plan token.',
          mode: 'WRITE',
          approval: 'CUSTOMER_CONFIRM',
          inputSchema: {
            branchCode: 'string',
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            dayOffset: '0|1',
            serviceIds: 'number[]',
            empId: 'number optional',
            mode: 'specific_barber|any_barber',
            planToken: 'string',
            customer: '{name,phone}',
            idempotencyKey: 'string',
          },
        },
        {
          name: 'booking.cancel',
          description: 'Cancel an owned booking.',
          mode: 'WRITE',
          approval: 'CUSTOMER_CONFIRM',
          inputSchema: {
            code: 'string',
            phone: 'string',
            idempotencyKey: 'string',
            reasonCode: 'string optional',
            reasonText: 'string optional',
          },
        },
        {
          name: 'booking.reschedule',
          description: 'Move an owned booking to a new validated slot.',
          mode: 'WRITE',
          approval: 'CUSTOMER_CONFIRM',
          inputSchema: {
            code: 'string',
            phone: 'string',
            desired: '{workDate,time,empId,branchCode,serviceIds}',
            idempotencyKey: 'string',
          },
        },
      ],
    });
  } catch (error) {
    return drvowaIntegrationErrorResponse(error);
  }
}
