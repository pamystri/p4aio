import { z } from 'zod';
import type { JsonValue } from '@connector-sdk/index';
import type { AmarisoftTargetConfiguration } from './amarisoft.types';

const defaultOrigin = 'http://private-5g-monitor.local';

const targetConfigurationSchema = z.object({
  transport: z.enum(['ws', 'wss']).default('ws'),
  path: z.string().startsWith('/').default('/'),
  origin: z.string().url().default(defaultOrigin),
  tlsRejectUnauthorized: z.boolean().default(true),
  ueGet: z
    .object({
      stats: z.boolean().default(true),
    })
    .default({ stats: true }),
  stats: z
    .object({
      samples: z.boolean().default(true),
      rf: z.boolean().default(true),
    })
    .default({ samples: true, rf: true }),
});

export const amarisoftConfigurationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transport: { type: 'string', enum: ['ws', 'wss'], default: 'ws' },
    path: { type: 'string', default: '/' },
    origin: { type: 'string', format: 'uri', default: defaultOrigin },
    tlsRejectUnauthorized: { type: 'boolean', default: true },
    ueGet: {
      type: 'object',
      additionalProperties: false,
      properties: { stats: { type: 'boolean', default: true } },
    },
    stats: {
      type: 'object',
      additionalProperties: false,
      properties: {
        samples: { type: 'boolean', default: true },
        rf: { type: 'boolean', default: true },
      },
    },
  },
} as const satisfies Readonly<Record<string, JsonValue>>;

export function parseAmarisoftTargetConfiguration(
  value: Readonly<Record<string, JsonValue>>,
): AmarisoftTargetConfiguration {
  return targetConfigurationSchema.parse(value);
}
