const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { run, get, all } = require('./db');
const { createTransport } = require('./mailer');

const app = express();
const uploadsDir = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed.'));
      return;
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/config', (_req, res) => {
  res.json({
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  });
});

app.get('/api/plans', async (_req, res, next) => {
  try {
    const plans = await all('SELECT * FROM plans ORDER BY created_at DESC');
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

app.post('/api/plans', async (req, res, next) => {
  try {
    const { title, description = '', routeStart = '', routeEnd = '' } = req.body;
    if (!title || !title.trim()) {
      res.status(400).json({ message: 'Plan title is required.' });
      return;
    }

    const result = await run(
      `INSERT INTO plans (title, description, route_start, route_end) VALUES (?, ?, ?, ?)`,
      [title.trim(), description.trim(), routeStart.trim(), routeEnd.trim()],
    );

    const plan = await get('SELECT * FROM plans WHERE id = ?', [result.lastID]);
    res.status(201).json(plan);
  } catch (error) {
    next(error);
  }
});

app.get('/api/plans/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const plan = await get('SELECT * FROM plans WHERE id = ?', [id]);
    if (!plan) {
      res.status(404).json({ message: 'Plan not found.' });
      return;
    }
    const stops = await all('SELECT * FROM stops WHERE plan_id = ? ORDER BY created_at ASC', [id]);
    res.json({ ...plan, stops });
  } catch (error) {
    next(error);
  }
});

app.post('/api/plans/:id/stops', upload.single('image'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const plan = await get('SELECT id FROM plans WHERE id = ?', [id]);
    if (!plan) {
      res.status(404).json({ message: 'Plan not found.' });
      return;
    }

    const { name, notes = '', lat = null, lng = null, address = '' } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ message: 'Stop name is required.' });
      return;
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
    const latNum = lat !== null && lat !== '' ? Number(lat) : null;
    const lngNum = lng !== null && lng !== '' ? Number(lng) : null;

    const result = await run(
      `INSERT INTO stops (plan_id, name, notes, lat, lng, address, image_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), notes.trim(), latNum, lngNum, address.trim(), imagePath],
    );

    const stop = await get('SELECT * FROM stops WHERE id = ?', [result.lastID]);
    res.status(201).json(stop);
  } catch (error) {
    next(error);
  }
});

app.post('/api/plans/:id/email', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { to } = req.body;

    if (!to || !to.trim()) {
      res.status(400).json({ message: 'Recipient email is required.' });
      return;
    }

    const plan = await get('SELECT * FROM plans WHERE id = ?', [id]);
    if (!plan) {
      res.status(404).json({ message: 'Plan not found.' });
      return;
    }

    const stops = await all('SELECT * FROM stops WHERE plan_id = ? ORDER BY created_at ASC', [id]);

    const transport = createTransport();
    if (!transport) {
      res.status(400).json({
        message: 'Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.',
      });
      return;
    }

    const text = [
      `Road Trip Plan: ${plan.title}`,
      plan.description ? `Description: ${plan.description}` : '',
      plan.route_start || plan.route_end ? `Route: ${plan.route_start || '(unset)'} -> ${plan.route_end || '(unset)'}` : '',
      '',
      'Stops:',
      ...stops.map((stop, index) => `${index + 1}. ${stop.name}${stop.address ? ` (${stop.address})` : ''}${stop.notes ? ` - ${stop.notes}` : ''}`),
    ]
      .filter(Boolean)
      .join('\n');

    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to.trim(),
      subject: `Road Trip Plan Export: ${plan.title}`,
      text,
    });

    res.json({ message: 'Plan exported via email.' });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  const isUploadIssue = err instanceof multer.MulterError || err.message === 'Only image uploads are allowed.';
  if (isUploadIssue) {
    res.status(400).json({ message: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({ message: 'Unexpected server error.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Road trip planner server running on http://localhost:${port}`);
});
