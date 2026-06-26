import { registerAs } from '@nestjs/config';

import { getEnv } from './validate-env.js';

export default registerAs('database', () => {
  const e = getEnv();

  return {
    type: 'postgres' as const,
    host: e.DB_HOST,
    port: e.DB_PORT,
    username: e.DB_USERNAME,
    password: e.DB_PASSWORD,
    database: e.DB_NAME,
    logging: e.DB_LOGGING_ENABLED ?? e.NODE_ENV === 'development',
  };
});
