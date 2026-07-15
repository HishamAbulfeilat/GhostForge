import healthHandler from './health.js';
import ticketsHandler from './tickets.js';
import securityHandler from './security.js';
import reviewHandler from './review.js';
import deployHandler from './deploy.js';
import optimizeHandler from './optimize.js';
import helpHandler from './help.js';
import fallbackHandler from './fallback.js';

const HANDLERS = {
  health: healthHandler,
  tickets: ticketsHandler,
  'fix-tickets': ticketsHandler,
  security: securityHandler,
  review: reviewHandler,
  deploy: deployHandler,
  optimize: optimizeHandler,
  help: helpHandler,
  h: helpHandler,
};

export async function route(command, args, context, res) {
  const handler = HANDLERS[command] || fallbackHandler;
  await handler(args, context, res);
}
