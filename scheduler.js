const axios = require('axios');

// Configuration
const CHIRO360_BASE_URL = 'https://backend.chiro360mi.com/api';
const CHIRO360_EMAIL = process.env.CHIRO360_EMAIL;
const CHIRO360_PASSWORD = process.env.CHIRO360_PASSWORD;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER;

// Report kinds to send
const DAILY_REPORTS = ['visit_log', 'verification'];
const WEEKLY_REPORTS = ['weekly_claims', 'ar_by_patient', 'new_patients', 'ready_to_bill', 'bills_30_no_eob'];
const BIWEEKLY_REPORTS = ['provider_suit'];

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

    // Extract JWT from Set-Cookie header
    const setCookieHeader = response.headers['set-cookie'];
    if (setCookieHeader && Array.isArray(setCookieHeader)) {
      const tokenCookie = setCookieHeader.find(cookie => cookie.includes('access_token='));
      if (tokenCookie) {
        authToken = tokenCookie.split('access_token=')[1].split(';')[0];
        console.log('✅ Successfully logged in');
        return true;
      }
    }
    
    console.log('❌ Could not extract token from response');
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

    console.log('📋 Full API Response:', JSON.stringify(response.data, null, 2));
    
    // API returns { success: true, data: { generated, stored, emailed } }
    const apiData = response.data.data || response.data;
    
    const generated = apiData.generated || 0;
    const stored = apiData.stored || 0;
    const emailed = apiData.emailed || false;

    console.log(`✅ Generated: ${generated} reports`);
    console.log(`✅ Stored: ${stored} reports`);
    console.log(`✅ Emailed: ${emailed}`);
    
    return generated > 0;
  } catch (error) {
    console.error('❌ Report generation failed');
    console.error('Status:', error.response?.status);
    console.error('Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Message:', error.message);
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

    console.log('📋 Reports Response:', JSON.stringify(response.data, null, 2));
    
    // Handle both response formats: array or { success, data: array }
    let reportsArray = Array.isArray(response.data) 
      ? response.data 
      : (response.data.data || []);

    console.log(`✅ Found ${reportsArray.length} reports`);
    return reportsArray;
  } catch (error) {
    console.error('❌ Failed to fetch reports:', error.response?.status);
    console.error('Error:', error.response?.data || error.message);
    return [];
  }
}

// Step 4: Send to WhatsApp (most recent reports only - today's)
  console.log('---');
  console.log('📤 Sending reports to WhatsApp...');
  
  // Get today's date in ISO format
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Today's date: ${today}`);
  
  // Filter reports from today and take up to 10
  const recentReports = Array.isArray(reports) 
    ? reports.filter(r => {
        const reportDate = r.report_date ? r.report_date.split('T')[0] : '';
        return reportDate === today;
      }).slice(0, 10)
    : [];

  console.log(`📋 Filtered ${recentReports.length} reports for today`);

  if (recentReports.length === 0) {
    console.log('⚠️  No reports found for today');
    return;
  }

  let sentCount = 0;
  for (const report of recentReports) {
    const sent = await sendReportToWhatsApp(report);
    if (sent) sentCount++;
    // Small delay between messages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('---');
  console.log(`✅ Automation Complete: ${sentCount}/${recentReports.length} reports sent`);

/**
 * Main orchestration
 */
async function main() {
  console.log('🚀 Starting Chiro360 → WhatsApp Report Automation');
  console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
  console.log('---');

  // Validate environment variables
  if (!CHIRO360_EMAIL || !CHIRO360_PASSWORD || !WEBHOOK_URL || !WHATSAPP_NUMBER) {
    console.error('❌ Missing environment variables');
    console.error(`   CHIRO360_EMAIL: ${CHIRO360_EMAIL ? '✓' : '✗'}`);
    console.error(`   CHIRO360_PASSWORD: ${CHIRO360_PASSWORD ? '✓' : '✗'}`);
    console.error(`   WEBHOOK_URL: ${WEBHOOK_URL ? '✓' : '✗'}`);
    console.error(`   WHATSAPP_NUMBER: ${WHATSAPP_NUMBER ? '✓' : '✗'}`);
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

  // Wait a bit for S3 upload to complete
  console.log('⏳ Waiting for S3 upload...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 3: Fetch reports
  const reports = await getGeneratedReports();
  if (reports.length === 0) {
    console.error('❌ No reports found. Aborting.');
    process.exit(1);
  }

  // Step 4: Send to WhatsApp (most recent reports only - today's)
  console.log('---');
  console.log('📤 Sending reports to WhatsApp...');
  
  const today = new Date().toISOString().split('T')[0];
  const recentReports = reports.filter(r => r.report_date.startsWith(today)).slice(0, 8);

  let sentCount = 0;
  for (const report of recentReports) {
    const sent = await sendReportToWhatsApp(report);
    if (sent) sentCount++;
    // Small delay between messages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('---');
  console.log(`✅ Automation Complete: ${sentCount}/${recentReports.length} reports sent`);
}

// Run it
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
