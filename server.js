const express = require('express');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Store PDFs in memory (cleared when server restarts)
const storedPdfs = {};

// Your Twilio credentials
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Webhook endpoint that accepts base64 PDFs
app.post('/send-report', async (req, res) => {
  try {
    const { pdfUrl, pdfBase64, recipientNumber, reportName } = req.body;

    // Handle two cases: URL or base64
    let finalPdfUrl = pdfUrl;

    if (pdfBase64) {
      // Generate unique ID for this PDF
      const pdfId = `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Store base64 in memory
      storedPdfs[pdfId] = pdfBase64;
      
      // Create a download URL on this server
      finalPdfUrl = `https://${req.hostname}/download-pdf/${pdfId}`;
      
      console.log(`📁 Stored PDF temporarily: ${pdfId}`);
      console.log(`📎 Download URL: ${finalPdfUrl}`);
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

    // Send WhatsApp message with PDF
    const message = await client.messages.create({
      messagingServiceSid: 'MG0404c5a318bde7f214979ac64f6333d9',
      to: toNumber,
      mediaUrl: finalPdfUrl,
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

    console.log(`📥 PDF downloaded: ${pdfId}`);

    // Clean up after download (optional - keeps memory clean)
    setTimeout(() => {
      delete storedPdfs[pdfId];
      console.log(`🗑️  PDF deleted: ${pdfId}`);
    }, 5000); // Delete after 5 seconds

  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ error: error.message });
  }
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
    message: 'Chiro360 WhatsApp Webhook Server',
    endpoints: {
      '/send-report': 'POST - Send report with pdfUrl OR pdfBase64',
      '/download-pdf/:pdfId': 'GET - Download stored PDF',
      '/health': 'GET - Health check'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
