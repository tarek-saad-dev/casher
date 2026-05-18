// Test script for the print service
// Run with: node test-print.js

const http = require('http');

const testData = {
  invID: 999,
  invDate: new Date().toISOString().split('T')[0],
  invTime: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
  customerName: 'عميل تجريبي',
  customerPhone: '01234567890',
  SubTotal: 200,
  Dis: 10,
  DisVal: 20,
  GrandTotal: 180,
  PayCash: 180,
  PayVisa: 0,
  PaymentMethodID: 1,
  items: [
    {
      ProName: 'حلاقة رجالية',
      EmpName: 'أحمد',
      SPrice: 100,
      Qty: 1,
      SPriceAfterDis: 90
    },
    {
      ProName: 'تشقير لحية',
      EmpName: 'محمد',
      SPrice: 100,
      Qty: 1,
      SPriceAfterDis: 90
    }
  ]
};

function testHealth() {
  console.log('🔍 Testing health endpoint...');
  
  const req = http.request({
    hostname: '127.0.0.1',
    port: 7788,
    path: '/health',
    method: 'GET'
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Health check passed:', JSON.parse(data));
        testPrint();
      } else {
        console.error('❌ Health check failed:', res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('❌ Cannot connect to print service:', err.message);
    console.log('\n💡 Make sure the print service is running:');
    console.log('   cd print-service && npm start');
  });

  req.end();
}

function testPrint() {
  console.log('\n🖨️  Testing print receipt...');
  
  const postData = JSON.stringify(testData);
  
  const req = http.request({
    hostname: '127.0.0.1',
    port: 7788,
    path: '/print/receipt',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        const result = JSON.parse(data);
        console.log('✅ Print test passed:', result);
        console.log('\n🎉 Print service is working correctly!');
      } else {
        console.error('❌ Print test failed:', res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('❌ Print request failed:', err.message);
  });

  req.write(postData);
  req.end();
}

// Start testing
console.log('🧪 POS Print Service Test');
console.log('========================\n');
testHealth();
