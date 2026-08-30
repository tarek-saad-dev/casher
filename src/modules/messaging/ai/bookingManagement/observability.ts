export function logBookingManagementEvent(
  type: string,
  fields: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      type,
      at: new Date().toISOString(),
      ...fields,
    }),
  );
}
