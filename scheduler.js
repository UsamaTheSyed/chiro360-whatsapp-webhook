const axios = require('axios');

// Configuration
const CHIRO360_BASE_URL = 'https://backend.chiro360mi.com/api';
const CHIRO360_EMAIL = process.env.CHIRO360_EMAIL;
const CHIRO360_PASSWORD = process.env.CHIRO360_PASSWORD;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER;
const RUN_TIME = process.env.RUN_TIME || '5pm';

let authToken = null;

/**
 * Get reports for current time with bi-weekly logic
 */
function getReportsForTime(runTime) {
  const baseSchedule = {
    '4am': [
      { kind: 'verification', title: 'Insurance Verification Worklist' },
      { kind: 'ready_to_bill', title: 'Visits Ready to Bill' }
    ],
    '5pm': [
      { kind: 'visit_log', title: 'Daily Visit & CPT Log' },
      { kind: 'weekly_claims', title: 'Weekly Claims Submitted' },
      { kind: 'ar_by_patient', title: 'A/R — Outstanding by Patient' },
      { kind: 'new_patients', title: 'New Patients This Week' },
      { kind: 'bills_30_no_eob', title: 'Bills 30+ Days — No EOB' }
    ]
  };

  const reports = baseSchedule[runTime] || baseSchedule['5pm'];

  // Add Provider Suit only on alternating Fridays
  if (runTime === '5pm') {
    const today = new Date();
    const dayOfWeek = today.getDay();
    
    // Check if today is Friday (5)
    if (dayOfWeek === 5) {
      // Calculate week number from start of year
      const startOfYear = new Date(today.getFullYear(), 0, 1);
      const diff = today - startOfYear;
      const oneDay = 1000 * 60 * 60 * 24;
      const dayOfYear = Math.floor(diff / oneDay);
      const weekNumber = Math.floor(dayOfYear / 7);
      
      // Only include Provider Suit on even weeks (alternating)
      if (weekNumber % 2 === 0) {
        reports.push({ kind: 'provider_suit', title: 'Provider Suit — Legal Worklist' });
        console.log(`📋 Alternating Friday (Week ${weekNumber}) - Including Provider Suit`);
      } else {
        console.log(`📋 Regular Friday (Week ${weekNumber}) - Skipping Provider Suit`);
      }
    }
  }

  return reports;
}

/**
 * Step 1: Login to Chiro360
 */
async function loginToChiro360() {
  try {
    console.log('🔐 Logging into Chiro360...');
    
    const response = await axios.post(`${CHIRO360_BASE_URL}/auth/login`, {
      email: CHIRO360_EMAIL,
      password: CHIRO360_PASSWORD
    }, {
      withCredentials: true
    });

    const setCookieHeader = response.headers['set-cookie'];
    if (setCookieHeader && Array.isArray(setCookieHeader)) {
      const tokenCookie = setCookieHeader.find(cookie => cookie.includes('access_token='));
      if (tokenCookie) {
        authToken = tokenCookie.split('access_token=')[1].split(';')[0];
        console.log('✅ Successfully logged in');
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    return false;
  }
}

/**
 * Step 2: Generate a single report
 */
async function generateSingleReport(kind) {
  try {
    console.log(`📄 Generating report: ${kind}...`);
    
    const response = await axios.get(
      `${CHIRO360_BASE_URL}/reports/daily/${kind}`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      }
    );

    const apiData = response.data.data || response.data;
    
    if (apiData.pdf_base64) {
      console.log(`✅ Generated ${kind}: ${apiData.filename}`);
      return {
        kind: kind,
        filename: apiData.filename,
        pdf_base64: apiData.pdf_base64
      };
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Failed to generate ${kind}: ${error.message}`);
    return null;
  }
}

/**
 * Step 3: Send report to webhook with base64
 */
async function sendReportToWebhook(kind, title, pdfBase64) {
  try {
    console.log(`📱 Sending to WhatsApp: ${title}`);
    
    const payload = {
      pdfBase64: pdfBase64,
      recipientNumber: WHATSAPP_NUMBER,
      reportName: title
    };

    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    if (response.data.success) {
      console.log(`✅ WhatsApp sent: ${title} (${response.data.messageSid})`);
      return true;
    } else {
      console.error(`❌ WhatsApp send failed: ${response.data.error}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error sending report: ${error.message}`);
    return false;
  }
}

/**
 * Main orchestration
 */
async function main() {
  console.log('🚀 Starting Chiro360 → WhatsApp Report Automation');
  console.log(`⏰ Run Time: ${RUN_TIME.toUpperCase()}`);
  console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
  console.log('---');

  // Validate environment variables
  if (!CHIRO360_EMAIL || !CHIRO360_PASSWORD || !WEBHOOK_URL || !WHATSAPP_NUMBER) {
    console.error('❌ Missing environment variables');
    process.exit(1);
  }

  // Get reports for this time with bi-weekly logic
  const reportsConfig = getReportsForTime(RUN_TIME);
  
  console.log(`📋 Reports to generate for ${RUN_TIME}:`);
  reportsConfig.forEach(r => console.log(`  - ${r.title} (${r.kind})`));
  console.log('---');

  // Step 1: Login
  const loggedIn = await loginToChiro360();
  if (!loggedIn) {
    console.error('❌ Authentication failed. Aborting.');
    process.exit(1);
  }

  // Step 2: Generate only the reports we need
  console.log('---');
  console.log('📊 Generating specific reports...');
  
  const generatedReports = [];
  for (const reportConfig of reportsConfig) {
    const report = await generateSingleReport(reportConfig.kind);
    if (report) {
      generatedReports.push({
        ...report,
        title: reportConfig.title
      });
    }
    // Small delay between generations
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (generatedReports.length === 0) {
    console.error('❌ No reports generated. Aborting.');
    process.exit(1);
  }

  // Step 3: Send to WhatsApp via webhook
  console.log('---');
  console.log('📤 Sending reports to WhatsApp...');
  
  let sentCount = 0;
  for (const report of generatedReports) {
    const sent = await sendReportToWebhook(report.kind, report.title, report.pdf_base64);
    if (sent) sentCount++;
    // Delay between messages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('---');
  console.log(`✅ Complete: ${sentCount}/${generatedReports.length} ${RUN_TIME} reports sent`);
  process.exit(0);
}

// Run it
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
