const fs   = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../core/fileUtils');

const FILE = path.join(__dirname, '..', 'data', 'flowforge.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { flows: [] }; }
}

function save(data) {
  atomicWriteJson(FILE, data);
}

function getFlows()       { return load().flows || []; }
function getFlow(id)      { return getFlows().find(f => f.id === id) || null; }

function upsertFlow(flow) {
  const flows = getFlows();
  const idx   = flows.findIndex(f => f.id === flow.id);
  if (idx >= 0) flows[idx] = flow; else flows.push(flow);
  save({ flows });
  return flow;
}

function deleteFlow(id) {
  save({ flows: getFlows().filter(f => f.id !== id) });
}

module.exports = { getFlows, getFlow, upsertFlow, deleteFlow };
