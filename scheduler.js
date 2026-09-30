const axios = require('axios');

// ============================================================
// CLIENT CONFIG — add one object per Chiro360 practice here.
// Each client needs its own set of GitHub Secrets (see bottom
// of this file for the full list of secret names expected).
// ============================================================
const CLIENTS = [
  {
    name: 'chiro360mi',
    apiBaseUrl: 'https://backend.chiro360mi.com/api',
    email: process.env.CHIRO360MI_EMAIL,
    password: process.env.CHIRO360MI_PASSWORD,
    whatsappNumber: process.env.CHIRO360MI_WHATSAPP_NUMBER
  },
  {
    name: 'finishlineptmi',
    // Confirmed via browser Network tab — this client's API lives directly
    // on the portal domain (no "backend." subdomain, unlike chiro360mi).
    apiBaseUrl: 'https://finishlineptmi.chiro360mi.com/api',
    email: process.env.FINISHLINEPTMI_EMAIL,
    password: process.env.FINISHLINEPTMI_PASSWORD,
    whatsappNumber: process.env.FINISHLINEPTMI_WHATSAPP_NUMBER
  }
];

const WEBHOOK_URL = process.env.WEBHOOK_URL; // shared across all clients
const RUN_TIME = process.env.RUN_TIME; // '4am' or '5pm', passed from workflow

// ============================================================
// Report schedule — same for every client unless told otherwise
// ============================================================
function getReportsForTime(runTime) {
  if (runTime === '4am') {
    return [
      { kind: 'verification', label: 'Insurance Verification Worklist' },
      { kind: 'ready_to_bill', label: 'Visits Ready to Bill' }
    ];
  }

  // 5pm reports
  const reports = [
    { kind: 'visit_log', label: 'Daily Visit & CPT Log' },
    { kind: 'weekly_claims', label: 'Weekly Claims Submitted' },
    { kind: 'ar_by_patient', label: 'A/R — Outstanding by Patient' },
    { kind: 'new_patients', label: 'New Patients This Week' },
    { kind: 'bills_30_no_eob', label: 'Bills 30+ Days — No EOB' }
  ];

  // Provider Suit — every other Friday only
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
// Per-client login
// ============================================================
async function login(client) {
  const response = await axios.post(`${client.apiBaseUrl}/auth/login`, {
    email: client.email,
    password: client.password
  }, {
    withCredentials: true
  });

  // JWT comes back via Set-Cookie: access_token=<JWT>
  const setCookie = response.headers['set-cookie'];
  if (!setCookie) {
    throw new Error(`[${client.name}] Login did not return a Set-Cookie header`);
  }

  const tokenCookie = setCookie.find(c => c.startsWith('access_token='));
  if (!tokenCookie) {
    throw new Error(`[${client.name}] No access_token cookie found in login response`);
  }

  const token = tokenCookie.split('access_token=')[1].split(';')[0];
  return token;
}

// ============================================================
// Generate one report (base64 PDF)
// ============================================================
async function generateReport(client, token, kind) {
  const response = await axios.get(`${client.apiBaseUrl}/reports/daily/${kind}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = response.data.data || response.data;
  return data; // expected shape: { filename, pdf_base64, count }
}

// ============================================================
// Send one report to the webhook
// ============================================================
async function sendToWhatsApp(client, report, label) {
  try {
    const response = await axios.post(WEBHOOK_URL, {
      pdfBase64: report.pdf_base64,
      recipientNumber: client.whatsappNumber,
      reportName: `${client.name} — ${label}`
    });

    console.log(`✅ [${client.name}] Sent: ${label} (${response.data.messageSid || response.data.messageId || 'no id returned'})`);
    return true;
  } catch (error) {
    const msg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.log(`❌ [${client.name}] Error sending ${label}: ${msg}`);
    return false;
  }
}

// ============================================================
// Process one client fully: login → generate → send, for every
// report due at this run time.
// ============================================================
async function processClient(client, reportsToGenerate) {
  console.log(`\n--- ${client.name} ---`);

  if (!client.email || !client.password || !client.whatsappNumber) {
    console.log(`⚠️  [${client.name}] Skipped — missing credentials or WhatsApp number in secrets.`);
    return { sent: 0, total: reportsToGenerate.length };
  }

  let token;
  try {
    console.log(`🔐 [${client.name}] Logging in...`);
    token = await login(client);
    console.log(`✅ [${client.name}] Logged in`);
  } catch (error) {
    console.log(`❌ [${client.name}] Login failed: ${error.message}`);
    return { sent: 0, total: reportsToGenerate.length };
  }

  let sentCount = 0;

  for (const { kind, label } of reportsToGenerate) {
    try {
      console.log(`📄 [${client.name}] Generating: ${label}...`);
      const report = await generateReport(client, token, kind);
      console.log(`✅ [${client.name}] Generated: ${label}`);

      const sent = await sendToWhatsApp(client, report, label);
      if (sent) sentCount++;
    } catch (error) {
      console.log(`❌ [${client.name}] Error generating ${label}: ${error.message}`);
    }
  }

  console.log(`--- ${client.name}: ${sentCount}/${reportsToGenerate.length} reports sent ---`);
  return { sent: sentCount, total: reportsToGenerate.length };
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

  console.log(`\n=== Overall: ${totalSent}/${totalExpected} reports sent across ${CLIENTS.length} client(s) ===`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
