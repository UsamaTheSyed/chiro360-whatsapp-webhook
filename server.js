const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Store PDFs in memory (cleared when server restarts)
const storedPdfs = {};

// Your Twilio credentials
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER; // e.g. whatsapp:+12283355862

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

app.post('/send-report', async (req, res) => {
  try {
    const { pdfUrl, pdfBase64, recipientNumber, reportName } = req.body;

    let finalPdfUrl = pdfUrl;

    if (pdfBase64) {
      const pdfId = `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      storedPdfs[pdfId] = pdfBase64;
      finalPdfUrl = `https://${req.hostname}/download-pdf/${pdfId}`;
      console.log(`Stored PDF temporarily: ${pdfId}`);
      console.log(`Download URL: ${finalPdfUrl}`);
    }

    if (!finalPdfUrl || !recipientNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing pdfUrl/pdfBase64 or recipientNumber'
      });
    }

    const toNumber = recipientNumber.startsWith('whatsapp:')
      ? recipientNumber
      : `whatsapp:${recipientNumber}`;

    console.log(`Sending to: ${toNumber}`);
    console.log(`Sending from: ${TWILIO_WHATSAPP_NUMBER}`);

    const message = await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: toNumber,
      mediaUrl: finalPdfUrl,
      body: `Your report is ready: ${reportName || 'Report'}`
    });

    console.log(`Message sent successfully: ${message.sid}`);

    res.json({
      success: true,
      messageSid: message.sid,
      message: 'Report sent to WhatsApp successfully'
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/download-pdf/:pdfId', (req, res) => {
  try {
    const { pdfId } = req.params;

    if (!storedPdfs[pdfId]) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    const pdfBase64 = storedPdfs[pdfId];
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfId}.pdf"`);
    res.send(pdfBuffer);

    console.log(`PDF downloaded: ${pdfId}`);

    setTimeout(() => {
      delete storedPdfs[pdfId];
      console.log(`PDF deleted: ${pdfId}`);
    }, 5000);

  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'Server running',
    timestamp: new Date(),
    storedPdfs: Object.keys(storedPdfs).length
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Chiro360 WhatsApp Webhook Server (Twilio)',
    endpoints: {
      '/send-report': 'POST - Send report with pdfUrl OR pdfBase64',
      '/download-pdf/:pdfId': 'GET - Download stored PDF',
      '/health': 'GET - Health check'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
