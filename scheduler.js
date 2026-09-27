const axios = require('axios');

// Configuration
const CHIRO360_BASE_URL = 'https://backend.chiro360mi.com/api';
const CHIRO360_EMAIL = process.env.CHIRO360_EMAIL;
const CHIRO360_PASSWORD = process.env.CHIRO360_PASSWORD;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER;
const RUN_TIME = process.env.RUN_TIME || '5pm';

// Report mapping by schedule time
const REPORT_SCHEDULE = {
  '4am': {
    kinds: ['verification', 'ready_to_bill']
  },
  '5pm': {
    kinds: ['visit_log', 'weekly_claims', 'ar_by_patient', 'new_patients', 'bills_30_no_eob', 'provider_suit']
  }
};

let authToken = null;

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
    console.error('❌ Login failed:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Step 2: Generate all reports
 */
async function generateAllReports() {
  try {
    console.log('📊 Generating all reports...');
    
    const response = await axios.post(
      `${CHIRO360_BASE_URL}/reports/daily/run`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const apiData = response.data.data || response.data;
    const generated = apiData.generated || 0;
    const stored = apiData.stored || 0;

    console.log(`✅ Generated: ${generated} reports`);
    console.log(`✅ Stored: ${stored} reports`);
    
    return generated > 0;
  } catch (error) {
    console.error('❌ Report generation failed:', error.message);
    return false;
  }
}

/**
 * Step 3: Get generated reports with download URLs
 */
async function getGeneratedReports() {
  try {
    console.log('📥 Fetching generated reports...');
    
    const response = await axios.get(
      `${CHIRO360_BASE_URL}/reports/generated`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      }
    );

    let reportsArray = Array.isArray(response.data) 
      ? response.data 
      : (response.data.data || []);

    console.log(`✅ Found ${reportsArray.length} total reports`);
    return reportsArray;
  } catch (error) {
    console.error('❌ Failed to fetch reports:', error.message);
    return [];
  }
}

/**
 * Filter reports by kind for current run time
 */
function filterReportsForTime(reports, time) {
  const config = REPORT_SCHEDULE[time] || REPORT_SCHEDULE['5pm'];
  const allowedKinds = config.kinds;
  
  console.log(`🕐 ${time.toUpperCase()} reports allowed: ${allowedKinds.join(', ')}`);
  
  const filtered = reports.filter(report => {
    const isAllowed = allowedKinds.includes(report.kind);
    if (isAllowed) {
      console.log(`  ✅ Include: ${report.title} (${report.kind})`);
    } else {
      console.log(`  ❌ Exclude: ${report.title} (${report.kind})`);
    }
    return isAllowed;
  });
  
  console.log(`📋 Filtered to ${filtered.length} reports for ${time}`);
  return filtered;
}

/**
 * Step 4: Send each report to WhatsApp via webhook
 */
async function sendReportToWhatsApp(report) {
  try {
    console.log(`📱 Sending to WhatsApp: ${report.title}`);
    
    const payload = {
      pdfUrl: report.download_url,
      recipientNumber: WHATSAPP_NUMBER,
      reportName: report.title
    };

    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    if (response.data.success) {
      console.log(`✅ WhatsApp sent: ${report.title}`);
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

  // Step 1: Login
  const loggedIn = await loginToChiro360();
  if (!loggedIn) {
    console.error('❌ Authentication failed. Aborting.');
    process.exit(1);
  }

  // Step 2: Generate reports
  const generated = await generateAllReports();
  if (!generated) {
    console.error('❌ Report generation failed. Aborting.');
    process.exit(1);
  }

  // Wait for S3 upload
  console.log('⏳ Waiting for S3 upload...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 3: Fetch reports
  const allReports = await getGeneratedReports();
  if (allReports.length === 0) {
    console.error('❌ No reports found. Aborting.');
    process.exit(1);
  }

  // Step 4: Filter by today's date
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Today's date: ${today}`);
  
  const todaysReports = allReports.filter(r => {
    if (!r.report_date) return false;
    const reportDate = r.report_date.split('T')[0];
    return reportDate === today;
  });

  console.log(`📋 Today's reports: ${todaysReports.length}`);

  // Step 5: Filter by report kind for this time
  console.log('---');
  console.log('🔍 Filtering by report kind...');
  const reportsToSend = filterReportsForTime(todaysReports, RUN_TIME);

  if (reportsToSend.length === 0) {
    console.log(`⚠️  No ${RUN_TIME} reports found for today`);
    process.exit(0);
  }

  // Step 6: Send to WhatsApp
  console.log('---');
  console.log('📤 Sending reports to WhatsApp...');
  
  let sentCount = 0;
  for (const report of reportsToSend) {
    const sent = await sendReportToWhatsApp(report);
    if (sent) sentCount++;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('---');
  console.log(`✅ Complete: ${sentCount}/${reportsToSend.length} ${RUN_TIME} reports sent`);
  process.exit(0);
}

// Run it
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
