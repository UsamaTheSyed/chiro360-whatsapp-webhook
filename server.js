const express = require('express');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Store PDFs in memory (cleared when server restarts)
const storedPdfs = {};

// Meta WhatsApp Cloud API credentials (set these in Render env vars)
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const META_API_VERSION = 'v21.0';
const META_API_URL = `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`;

// Webhook endpoint that accepts base64 PDFs
app.post('/send-report', async (req, res) => {
  try {
    const { pdfUrl, pdfBase64, recipientNumber, reportName, message } = req.body;

    let finalPdfUrl = pdfUrl;

    if (pdfBase64) {
      const pdfId = `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      storedPdfs[pdfId] = pdfBase64;
      finalPdfUrl = `https://${req.hostname}/download-pdf/${pdfId}`;
      console.log(`Stored PDF temporarily: ${pdfId}`);
      console.log(`Download URL: ${finalPdfUrl}`);
    }

    if (!recipientNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing recipientNumber'
      });
    }

    // Meta API wants the number WITHOUT "whatsapp:" prefix and without "+"
    const toNumber = recipientNumber.replace('whatsapp:', '').replace('+', '');

    console.log(`Sending to: ${toNumber}`);

    let payload;

    if (finalPdfUrl) {
      payload = {
        messaging_product: 'whatsapp',
        to: toNumber,
        type: 'document',
        document: {
          link: finalPdfUrl,
          filename: `${reportName || 'Report'}.pdf`,
          caption: `Your report is ready: ${reportName || 'Report'}`
        }
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        to: toNumber,
        type: 'text',
        text: { body: message || `${reportName || 'Notification'}` }
      };
    }

    const response = await fetch(META_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Meta API error:', JSON.stringify(data));
      return res.status(500).json({
        success: false,
        error: data.error ? data.error.message : 'Unknown Meta API error',
        details: data
      });
    }

    const messageId = data.messages && data.messages[0] ? data.messages[0].id : null;
    console.log(`Message sent successfully: ${messageId}`);

    res.json({
      success: true,
      messageId,
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

// Endpoint to download stored PDFs
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

// Webhook verification (Meta calls this once when you click "Verify and save")
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed - token mismatch');
    res.sendStatus(403);
  }
});

// Webhook events (Meta calls this for incoming messages, delivery/read status, etc.)
app.post('/webhook', (req, res) => {
  console.log('Webhook event received:', JSON.stringify(req.body, null, 2));
  // Just acknowledge for now - we can add logic here later if needed
  // (e.g. detecting when someone joins so we know they can receive messages)
  res.sendStatus(200);
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'Server running',
    timestamp: new Date(),
    storedPdfs: Object.keys(storedPdfs).length
  });
});

// Home page
app.get('/', (req, res) => {
  res.json({
    message: 'Chiro360 WhatsApp Webhook Server (Meta Cloud API)',
    endpoints: {
      '/send-report': 'POST - Send report with pdfUrl OR pdfBase64, or plain text via message field',
      '/download-pdf/:pdfId': 'GET - Download stored PDF',
      '/health': 'GET - Health check'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
