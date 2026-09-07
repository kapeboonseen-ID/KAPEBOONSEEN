const handleRequest = require('../server.js');

module.exports = async (req, res) => {
  if (req.query && req.query.all) {
    const subpath = Array.isArray(req.query.all) ? req.query.all.join('/') : String(req.query.all);
    req.url = '/api/' + subpath;
  }
  return handleRequest(req, res);
};
