const axios = require('axios');

// ============================================================
// CLIENT CONFIG
// whatsappNumbers is a comma-separated list in the secret value,
// e.g. "+13133778221,+923001234567,+13135551212"
// Every number in the list gets every report for that client.
// ============================================================
function parseNumbers(envValue) {
  if (!envValue) return [];
  return envValue.split(',').map(n => n.trim()).filter(n => n.length > 0);
}

const CLIENTS = [
  {
    name: 'chiro360mi',
    apiBaseUrl: 'https://backend.chiro360mi.com/api',
    email: process.env.CHIRO360MI_EMAIL,
    password: process.env.CHIRO360MI_PASSWORD,
    whatsappNumbers: parseNumbers(process.env.CHIRO360MI_WHATSAPP_NUMBER)
  },
  {
    name: 'finishlineptmi',
    apiBaseUrl: 'https://finishlineptmi.chiro360mi.com/api',
    email: process.env.FINISHLINEPTMI_EMAIL,
    password: process.env.FINISHLINEPTMI_PASSWORD,
    whatsappNumbers: parseNumbers(process.env.FINISHLINEPTMI_WHATSAPP_NUMBER)
  }
];

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const RUN_TIME = process.env.RUN_TIME;

// ============================================================
// Report schedule
// ============================================================
function getReportsForTime(runTime) {
  if (runTime === '4am') {
    return [
      { kind: 'verification', label: 'Insurance Verification Worklist' },
      { kind: 'ready_to_bill', label: 'Visits Ready to Bill' }
    ];
  }

  const reports = [
    { kind: 'visit_log', label: 'Daily Visit & CPT Log' },
    { kind: 'weekly_claims', label: 'Weekly Claims Submitted' },
    { kind: 'ar_by_patient', label: 'A/R — Outstanding by Patient' },
    { kind: 'new_patients', label: 'New Patients This Week' },
    { kind: 'bills_30_no_eob', label: 'Bills 30+ Days — No EOB' }
  ];

  const now = new Date();
  const weekNumber = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
  const isFriday = now.getUTCDay() === 5;
  const isEvenWeek = weekNumber % 2 === 0;

  if (isFriday && isEvenWeek) {
    reports.push({ kind: 'provider_suit', label: 'Provider Suit — Legal Worklist' });
  }

  return reports;
}

// ============================================================
// Login
// ============================================================
async function login(client) {
  const response = await axios.post(`${client.apiBaseUrl}/auth/login`, {
    email: client.email,
    password: client.password
  }, {
    withCredentials: true
  });

  const setCookie = response.headers['set-cookie'];
  if (!setCookie) {
    throw new Error(`[${client.name}] Login did not return a Set-Cookie header`);
  }

  const tokenCookie = setCookie.find(c => c.startsWith('access_token='));
  if (!tokenCookie) {
    throw new Error(`[${client.name}] No access_token cookie found in login response`);
  }

  return tokenCookie.split('access_token=')[1].split(';')[0];
}

// ============================================================
// Generate one report
// ============================================================
async function generateReport(client, token, kind) {
  const response = await axios.get(`${client.apiBaseUrl}/reports/daily/${kind}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  return response.data.data || response.data;
}

// ============================================================
// Send one report to ONE number
// ============================================================
async function sendToWhatsApp(client, report, label, number) {
  try {
    const response = await axios.post(WEBHOOK_URL, {
      pdfBase64: report.pdf_base64,
      recipientNumber: number,
      reportName: `${client.name} — ${label}`
    });

    console.log(`✅ [${client.name}] Sent to ${number}: ${label} (${response.data.messageSid || response.data.messageId || 'no id returned'})`);
    return true;
  } catch (error) {
    const msg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.log(`❌ [${client.name}] Error sending to ${number} — ${label}: ${msg}`);
    return false;
  }
}

// ============================================================
// Process one client: login → generate each report once →
// send that same generated PDF to every configured number
// ============================================================
async function processClient(client, reportsToGenerate) {
  console.log(`\n--- ${client.name} ---`);

  if (!client.email || !client.password || client.whatsappNumbers.length === 0) {
    console.log(`⚠️  [${client.name}] Skipped — missing credentials or no WhatsApp numbers in secrets.`);
    return { sent: 0, total: reportsToGenerate.length * 1 };
  }

  console.log(`📱 [${client.name}] Recipients: ${client.whatsappNumbers.join(', ')}`);

  let token;
  try {
    console.log(`🔐 [${client.name}] Logging in...`);
    token = await login(client);
    console.log(`✅ [${client.name}] Logged in`);
  } catch (error) {
    console.log(`❌ [${client.name}] Login failed: ${error.message}`);
    return { sent: 0, total: reportsToGenerate.length * client.whatsappNumbers.length };
  }

  let sentCount = 0;
  const totalExpected = reportsToGenerate.length * client.whatsappNumbers.length;

  for (const { kind, label } of reportsToGenerate) {
    let report;
    try {
      console.log(`📄 [${client.name}] Generating: ${label}...`);
      report = await generateReport(client, token, kind);
      console.log(`✅ [${client.name}] Generated: ${label}`);
    } catch (error) {
      console.log(`❌ [${client.name}] Error generating ${label}: ${error.message}`);
      continue; // skip sending this report to anyone if generation failed
    }

    // Send the SAME generated report to every configured number
    for (const number of client.whatsappNumbers) {
      const sent = await sendToWhatsApp(client, report, label, number);
      if (sent) sentCount++;
    }
  }

  console.log(`--- ${client.name}: ${sentCount}/${totalExpected} sends completed ---`);
  return { sent: sentCount, total: totalExpected };
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('🤖 Starting Multi-Client Chiro360 → WhatsApp Report Automation');
  console.log(`⏰ Run Time: ${RUN_TIME}`);
  console.log(`🕐 Timestamp: ${new Date().toISOString()}`);

  const reportsToGenerate = getReportsForTime(RUN_TIME);
  console.log(`\n📋 Reports to generate for ${RUN_TIME}:`);
  reportsToGenerate.forEach(r => console.log(`  - ${r.label} (${r.kind})`));

  let totalSent = 0;
  let totalExpected = 0;

  for (const client of CLIENTS) {
    const result = await processClient(client, reportsToGenerate);
    totalSent += result.sent;
    totalExpected += result.total;
  }

  console.log(`\n=== Overall: ${totalSent}/${totalExpected} sends completed across ${CLIENTS.length} client(s) ===`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
