const handleRequest = require('../../../server.js');

module.exports = async (req, res) => {
  if (!req.url || req.url === '/' || !req.url.startsWith('/api')) {
    const qIdx = req.url ? req.url.indexOf('?') : -1;
    const query = qIdx !== -1 ? req.url.substring(qIdx) : '';
    req.url = '/api/admin/data/restore' + query;
  }
  return handleRequest(req, res);
};
