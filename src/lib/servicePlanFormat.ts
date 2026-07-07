/** Client-safe helpers — no DB imports */

export function formatServiceSummary(serviceNames: string[]): string {
  if (serviceNames.length === 0) return '';
  if (serviceNames.length === 1) return serviceNames[0];
  if (serviceNames.length === 2) return `${serviceNames[0]} + ${serviceNames[1]}`;
  return `${serviceNames[0]} +${serviceNames.length - 1}`;
}
