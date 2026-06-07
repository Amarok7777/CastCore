const TOOLS = [
  {
    id: 'splitflow',
    name: 'SplitFlow',
    taglineKey: 'tool.splitflow.tagline',
    categoryKey: 'tool.category.speedrun',
    status: 'ready',
    route: '/tool/splitflow',
  },
  {
    id: 'scenepilot',
    name: 'ScenePilot',
    taglineKey: 'tool.scenepilot.tagline',
    categoryKey: 'tool.category.stream_control',
    status: 'ready',
    route: '/tool/scenepilot',
  },
  {
    id: 'trackpulse',
    name: 'TrackPulse',
    taglineKey: 'tool.trackpulse.tagline',
    categoryKey: 'tool.category.music_metadata',
    status: 'ready',
    route: '/tool/trackpulse',
  },
  {
    id: 'controldeck',
    name: 'ControlDeck',
    taglineKey: 'tool.controldeck.tagline',
    categoryKey: 'tool.category.stream_control',
    status: 'ready',
    route: '/tool/controldeck',
    bgService: false,
    showInGrid: false,
  },
  {
    id: 'chatdeck',
    name: 'ChatLink',
    taglineKey: 'tool.chatdeck.tagline',
    categoryKey: 'tool.category.chat',
    status: 'ready',
    route: '/tool/chatdeck',
    bgService: false,
  },
  {
    id: 'alertdeck',
    name: 'EventForge',
    taglineKey: 'tool.alertdeck.tagline',
    categoryKey: 'tool.category.chat',
    status: 'ready',
    route: '/tool/alertdeck',
    bgService: false,
  },
  {
    id: 'flowforge',
    name: 'FlowForge',
    taglineKey: 'tool.flowforge.tagline',
    categoryKey: 'tool.category.automation',
    status: 'ready',
    route: '/tool/flowforge',
    bgService: false,
  },
];

function getTools() {
  return TOOLS.map(t => ({ ...t }));
}

function getToolById(id) {
  if (id === 'tunapilot' || id === 'trackpilot' || id === 'trackflow') id = 'trackpulse';
  return TOOLS.find(t => t.id === id) || null;
}

module.exports = { getTools, getToolById };
