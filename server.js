// The server is based on Node.js with Express.
const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4178;
const ROOT_DIR = __dirname;
const HOSPITALS_DIR = path.join(ROOT_DIR, 'mediroute', 'hospitals');
const INDOOR_DIR = path.join(ROOT_DIR, 'mediroute', 'indoor');

// CORS is for allowing requests from specific origins, methods, and headers.
const cors = require('cors');
/**
 * Example CORS configuration:
 * const corsOptions = {
    origin: 'http://example.com',
    methods: 'GET,POST',
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200 // For legacy browsers
    };

    app.use(cors(corsOptions));
 */

app.use(cors());
// Compression is for reducing response sizes for faster load times
const compression = require('compression');
app.use(compression());
// Middleware
app.use((req, res, next) => {
    console.log(req.method, req.url);
    next();
});
app.use(express.json());

// Ensure Service Worker is not aggressively cached by intermediate proxies
app.use((req, res, next) => {
    if (req.path === '/sw.js' || req.path.startsWith('/workbox-')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    next();
});

// Serve static project files (HTML, assets/, mediroute/, pwa/, etc.)
app.use('/MediRoute-preview', express.static(ROOT_DIR));

app.get('/', (req, res) => {
    res.redirect(302, '/MediRoute-preview/');
});

// Helper: load hospital index and individual GeoJSON features
async function loadHospitals() {
    const indexPath = path.join(HOSPITALS_DIR, 'index.json');
    const rawIndex = await fs.readFile(indexPath, 'utf8');
    const indexData = JSON.parse(rawIndex);
    return indexData;
}

// --- API ENDPOINTS ---

// 1. Health & version check (useful for client sync / diagnostics)
app.get('/api/health', async (req, res) => {
    try {
        let version = null;
        try {
            const verRaw = await fs.readFile(path.join(ROOT_DIR, 'version.json'), 'utf8');
            version = JSON.parse(verRaw);
        } catch (_) {
            // version.json optional
        }
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version,
        });
    } catch (err) {
        res.status(500).json({ error: 'Health check failed' });
    }
});

// 2. Search & filter hospitals server-side instead of filtering huge lists on low-end mobile devices
app.get('/api/hospitals', async (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        const indexData = await loadHospitals();

        // Supports either an array or an object containing an array
        const list = Array.isArray(indexData)
            ? indexData
            : Array.isArray(indexData.hospitals)
                ? indexData.hospitals
                : Object.values(indexData);

        const filtered = q
            ? list.filter((item) => JSON.stringify(item).toLowerCase().includes(q))
            : list;

        res.json({
            count: filtered.length,
            results: filtered,
        });
    } catch (err) {
        console.error('Error loading hospitals index:', err);
        res.status(500).json({ error: 'Failed to load hospitals data' });
    }
});

// 3. Fetch a specific hospital's GeoJSON by slug/filename (e.g., /api/hospitals/queen_mary_hospital)
app.get('/api/hospitals/:slug', async (req, res) => {
    try {
        const safeSlug = path.basename(req.params.slug).replace(/\.geojson$/i, '');
        const filePath = path.join(HOSPITALS_DIR, `${safeSlug}.geojson`);
        const content = await fs.readFile(filePath, 'utf8');
        res.type('application/geo+json').send(content);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'Hospital GeoJSON not found' });
        }
        console.error('Error reading hospital GeoJSON:', err);
        res.status(500).json({ error: 'Failed to read hospital map data' });
    }
});

// 4. Fetch indoor map JSON (e.g., /api/indoor/kai_tak_hospital)
app.get('/api/indoor/:building', async (req, res) => {
    try {
        const safeBuilding = path.basename(req.params.building).replace(/\.json$/i, '');
        const filePath = path.join(INDOOR_DIR, `${safeBuilding}.json`);
        const content = await fs.readFile(filePath, 'utf8');
        res.type('application/json').send(content);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'Indoor map not found' });
        }
        console.error('Error reading indoor map:', err);
        res.status(500).json({ error: 'Failed to read indoor map data' });
    }
});

// 5. Example interactive endpoint: receive client route/navigation feedback or telemetry
app.post('/api/route-events', (req, res) => {
    const { hospital, mode, indoorFloor, timestamp } = req.body || {};
    if (!hospital) {
        return res.status(400).json({ error: 'Missing "hospital" in request body' });
    }

    // In production, persist to a database (PostgreSQL, SQLite, Redis, etc.)
    console.log('Route event received:', {
        hospital,
        mode: mode || 'unknown',
        indoorFloor: indoorFloor ?? null,
        timestamp: timestamp || new Date().toISOString(),
    });

    res.status(201).json({ accepted: true });
});

// Fallback for client-side routes / mediroute.html
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`MediRoute server running at http://localhost:${PORT}`);
});