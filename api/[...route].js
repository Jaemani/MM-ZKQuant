import { PlatformDatabase } from '../src/platform/database.js';
import { handlePlatformRequest } from '../src/platform/handler.js';
import { PlatformService } from '../src/platform/service.js';

let service;
function platformService() {
  if (!service) service = new PlatformService(new PlatformDatabase({ databaseUrl: process.env.DATABASE_URL }));
  return service;
}

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  return handlePlatformRequest(request, response, platformService(), { origin: process.env.PLATFORM_ORIGIN || 'https://mm-zkquant.vercel.app', prefix: '/api' });
}
