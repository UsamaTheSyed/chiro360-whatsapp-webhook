const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Your Twilio credentials (from environment variables)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Main webhook endpoint
app.post('/send-report', async (req, res) => {
  try {
    console.log('Received request:', req.body);

    const { pdfUrl, recipientNumber, reportName } = req.body;

    // Validate inputs
    if (!recipientNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing recipientNumber'
      });
    }

    // Format WhatsApp number (must include country code)
    const toNumber = recipientNumber.startsWith('whatsapp:') 
      ? recipientNumber 
      : `whatsapp:${recipientNumber}`;

    console.log(`Sending to: ${toNumber}`);

    // Send WhatsApp message with PDF
    const message = await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: toNumber,
      mediaUrl: pdfUrl,
      body: `📋 Your report is ready: ${reportName || 'Report'}`
    });

    console.log(`✅ Message sent successfully: ${message.sid}`);

    res.json({
      success: true,
      messageSid: message.sid,
      message: 'Report sent to WhatsApp successfully'
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint (for monitoring)
app.get('/health', (req, res) => {
  res.json({
    status: 'Server running',
    timestamp: new Date()
  });
});

// Welcome page
app.get('/', (req, res) => {
  res.json({
    message: 'Chiro360 WhatsApp Webhook Server',
    endpoint: '/send-report',
    method: 'POST',
    documentation: 'Send a POST request with pdfUrl, recipientNumber, and reportName'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});
