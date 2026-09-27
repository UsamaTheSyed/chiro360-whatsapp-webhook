const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const CHIRO360_BASE_URL = 'https://backend.chiro360mi.com/api';
const CHIRO360_EMAIL = process.env.CHIRO360_EMAIL;
const CHIRO360_PASSWORD = process.env.CHIRO360_PASSWORD;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER;
const RUN_TIME = process.env.RUN_TIME || '5pm';

// Only generate the specific reports for each time
const REPORT_SCHEDULE = {
  '4am': [
    { kind: 'verification', title: 'Insurance Verification Worklist' },
    { kind: 'ready_to_bill', title: 'Visits Ready to Bill' }
  ],
  '5pm': [
    { kind: 'visit_log', title: 'Daily Visit & CPT Log' },
    { kind: 'weekly_claims', title: 'Weekly Claims Submitted' },
    { kind: 'ar_by_patient', title: 'A/R — Outstanding by Patient' },
    { kind: 'new_patients', title: 'New Patients This Week' },
    { kind: 'bills_30_no_eob', title: 'Bills 30+ Days — No EOB' },
    { kind: 'provider_suit', title: 'Provider Suit — Legal Worklist' }
  ]
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
    console.error('❌ Login failed:', error.message);
    return false;
  }
}

/**
 * Step 2: Generate a single report on demand
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
        pdf_base64: apiData.pdf_base64,
        count: apiData.count
      };
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Failed to generate ${kind}:`, error.message);
    return null;
  }
}

/**
 * Step 3: Save PDF locally for upload
 */
function savePdfLocally(pdfBase64, filename) {
  try {
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const filepath = path.join('/tmp', filename);
    fs.writeFileSync(filepath, pdfBuffer);
    console.log(`✅ Saved PDF locally: ${filepath}`);
    return filepath;
  } catch (error) {
    console.error(`❌ Failed to save PDF: ${error.message}`);
    return null;
  }
}

/**
 * Step 4: Create a direct download URL using raw.githubusercontent.com
 */
async function createPdfUrl(pdfBase64, filename) {
  try {
    // For testing, we'll use a public PDF URL from your existing GitHub repo
    // In production, you'd upload to a cloud storage service
    
    // For now, use the test PDF from your repo:
    const testUrl = 'https://raw.githubusercontent.com/UsamaTheSyed/chiro360-whatsapp-webhook/main/Syed_Usama_Ali_Shah_Resume%20(3).pdf';
    
    console.log(`📎 PDF URL: ${testUrl}`);
    return testUrl;
  } catch (error) {
    console.error(`❌ Failed to create PDF URL: ${error.message}`);
    return null;
  }
}

/**
 * Step 5: Send report to WhatsApp via webhook
 */
async function sendReportToWhatsApp(kind, title, pdfUrl) {
  try {
    console.log(`📱 Sending to WhatsApp: ${title}`);
    
    const payload = {
      pdfUrl: pdfUrl,
      recipientNumber: WHATSAPP_NUMBER,
      reportName: title
    };

    console.log(`   Payload: ${JSON.stringify(payload, null, 2)}`);

    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    console.log(`   Response: ${JSON.stringify(response.data)}`);

    if (response.data.success) {
      console.log(`✅ WhatsApp sent: ${title}`);
      return true;
    } else {
      console.error(`❌ WhatsApp send failed: ${response.data.error}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error sending report:`, error.response?.data || error.message);
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

  // Get reports for this time
  const reportsConfig = REPORT_SCHEDULE[RUN_TIME] || REPORT_SCHEDULE['5pm'];
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

  // Step 3: Convert to URLs and send to WhatsApp
  console.log('---');
  console.log('📤 Sending reports to WhatsApp...');
  
  let sentCount = 0;
  for (const report of generatedReports) {
    // Create PDF URL (in production, upload to cloud storage)
    const pdfUrl = await createPdfUrl(report.pdf_base64, report.filename);
    
    if (pdfUrl) {
      const sent = await sendReportToWhatsApp(report.kind, report.title, pdfUrl);
      if (sent) sentCount++;
    }
    
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
