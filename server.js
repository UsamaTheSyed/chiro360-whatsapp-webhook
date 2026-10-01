const express = require('express');
const twilio = require('twilio');
const path = require('path');          // NEW
const crypto = require('crypto');      // NEW

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Store PDFs in memory (cleared when server restarts)
const storedPdfs = {};
const agendaPdfs = {}; // NEW

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

// ---------- NEW: daily agenda ----------

// Fake sample PDF, used only for WhatsApp template approval
app.get('/agenda/sample.pdf', (req, res) => {
  res.sendFile(path.join(__dirname, 'sample-agenda.pdf'));
});

// Temporary link that Twilio downloads the real agenda from
app.get('/agenda/:pdfId.pdf', (req, res) => {
  const pdf = agendaPdfs[req.params.pdfId];
  if (!pdf) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.send(pdf);
});

// Called by GitHub Actions at 5am. Needs the secret header.
app.post('/send-agenda', async (req, res) => {
  try {
    const secret = process.env.AGENDA_UPLOAD_SECRET;
    if (!secret || req.get('x-upload-secret') !== secret) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { pdfBase64, dateLabel } = req.body;
    const to = process.env.AGENDA_WHATSAPP_TO;
    const contentSid = process.env.TWILIO_AGENDA_CONTENT_SID;

    if (!pdfBase64 || !dateLabel || !to || !contentSid) {
      return res.status(400).json({
        success: false,
        error: 'Missing pdfBase64, dateLabel, AGENDA_WHATSAPP_TO or TWILIO_AGENDA_CONTENT_SID'
      });
    }

    const pdfId = crypto.randomBytes(24).toString('hex');
    agendaPdfs[pdfId] = Buffer.from(pdfBase64, 'base64');
    setTimeout(() => { delete agendaPdfs[pdfId]; }, 30 * 60 * 1000);

    const message = await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      contentSid,
      contentVariables: JSON.stringify({ 1: dateLabel, 2: pdfId })
    });

    console.log(`Agenda sent: ${message.sid}`);
    res.json({ success: true, messageSid: message.sid });
  } catch (error) {
    console.error('Agenda error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- end NEW ----------

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
