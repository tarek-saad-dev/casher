#!/usr/bin/env node
async function main() {
  const payload = {
    type: 'employee_sale',
    phone: '01039244023',
    customerName: 'زياد',
    invoiceNumber: 'INV-7304',
    services: ['Hair Cut', 'Basic Skin Care'],
    branchName: 'جليم',
  };
  const res = await fetch('http://localhost:3000/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log('status:', res.status);
  console.log('body:', text);
}
main().catch(console.error);
