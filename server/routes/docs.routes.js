const express = require('express');
const swaggerUi = require('swagger-ui-express');
const yaml = require('yaml');
const fs = require('node:fs');
const path = require('node:path');

const router = express.Router();

const yamlPath = path.join(__dirname, '../../docs/openapi.yaml');
let spec = {};
try {
  const raw = fs.readFileSync(yamlPath, 'utf8');
  spec = yaml.parse(raw);
} catch (e) {
  console.error('Failed to load openapi.yaml for docs.routes', e);
  spec = { openapi: '3.1.0', info: { title: 'Loadbyton API', version: '1.0.0' }, paths: {} };
}

// Serve Swagger UI at GET /api/docs and GET /api/docs/ (HTML) via yaml.parse spec
// Handle exact /api/docs before serve to avoid 301 redirect — ensures curl /api/docs returns HTML directly
router.get('/api/docs', swaggerUi.setup(spec, { explorer: true }));
router.use('/api/docs', swaggerUi.serve);
router.get('/api/docs/', swaggerUi.setup(spec, { explorer: true }));
// GET /api/docs.json -> JSON spec (parsed via yaml.parse)
router.get('/api/docs.json', (req, res) => res.json(spec));

module.exports = router;
