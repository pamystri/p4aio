import { isIP } from 'node:net';
import type {
  CanonicalUeInventoryObservation,
  CanonicalUeSession,
  JsonValue,
} from '@connector-sdk/index';
import type { AmarisoftParserContext, AmarisoftTargetConfiguration } from '../amarisoft.types';
import { externalIdentifier, isJsonArray, isJsonRecord, responseObservedAt } from './parser.helpers';

const ipFieldPattern = /^(?:ip|ip_addr|ue_ip|ue_ipv4|ue_ipv6|pdn_addr|ipv4|ipv4_addr|ipv4_address|ipv6|ipv6_addr|ipv6_address|ipv6_prefix)$/i;
const sessionContainerFields = new Set(['bearers', 'pdn_list', 'pdu_sessions']);

/** Normalizes MME/AMF registration and bearer data without leaking identities into metrics. */
export function parseMmeInventory(
  records: readonly JsonValue[],
  context: AmarisoftParserContext,
  configuration: AmarisoftTargetConfiguration,
): { inventory: CanonicalUeInventoryObservation[]; warnings: string[] } {
  const inventory: CanonicalUeInventoryObservation[] = [];
  const warnings: string[] = [];
  for (const value of records) {
    if (!isJsonRecord(value)) {
      warnings.push('Ignored a non-object MME UE entry');
      continue;
    }
    const identity = subscriberIdentity(value);
    if (!identity) {
      warnings.push('Ignored MME UE entry without IMSI, SUPI, or temporary identity');
      continue;
    }
    const ranNode = value['ran_id'];
    inventory.push({
      identityType: identity.type,
      externalIdentity: identity.value,
      ranUeKey: externalIdentifier(value),
      ranNodeKey:
        typeof ranNode === 'string' || typeof ranNode === 'number'
          ? `ran_id:${String(ranNode)}`
          : configuration.correlation.ranNodeKey,
      registered: value['registered'] !== false,
      observedAt: responseObservedAt(value, context.observedAt),
      sessions: sessions(value),
    });
  }
  return { inventory, warnings };
}

function subscriberIdentity(record: { readonly [key: string]: JsonValue }): {
  type: CanonicalUeInventoryObservation['identityType'];
  value: string;
} | null {
  for (const [field, type] of [
    ['supi', 'supi'],
    ['imsi', 'imsi'],
    ['5g_tmsi', 'temporary'],
    ['tmsi', 'temporary'],
  ] as const) {
    const value = record[field];
    if (typeof value === 'string' || typeof value === 'number') {
      return { type, value: String(value) };
    }
  }
  return null;
}

function sessions(record: { readonly [key: string]: JsonValue }): CanonicalUeSession[] {
  const candidates: Array<{ value: JsonValue; index: number }> = [{ value: record, index: 0 }];
  for (const key of ['bearers', 'pdn_list', 'pdu_sessions']) {
    const nested = record[key];
    if (isJsonArray(nested)) nested.forEach((value, index) => candidates.push({ value, index }));
  }
  const output = new Map<string, CanonicalUeSession>();
  for (const candidate of candidates) {
    if (!isJsonRecord(candidate.value)) continue;
    const addresses = collectIpAddresses(candidate.value);
    if (addresses.length === 0) continue;
    const key = sessionKey(candidate.value, candidate.index);
    const dnn = text(candidate.value['dnn']) ?? text(candidate.value['apn']);
    output.set(`${key}:${addresses.join(',')}`, { sessionKey: key, ipAddresses: addresses, dnn });
  }
  return [...output.values()];
}

function collectIpAddresses(value: JsonValue): string[] {
  const output = new Set<string>();
  const visit = (candidate: JsonValue, key?: string): void => {
    if (typeof candidate === 'string' && key && ipFieldPattern.test(key)) {
      const address = candidate.split('/')[0];
      if (address && isIP(address) !== 0) output.add(address);
      return;
    }
    if (isJsonArray(candidate)) {
      for (const child of candidate) visit(child);
      return;
    }
    if (isJsonRecord(candidate)) {
      for (const [childKey, child] of Object.entries(candidate)) {
        // Session containers are parsed independently by sessions(). Descending into
        // them here would attribute a child bearer address to the parent UE as well.
        if (!sessionContainerFields.has(childKey)) visit(child, childKey);
      }
    }
  };
  visit(value);
  return [...output].sort();
}

function sessionKey(record: { readonly [key: string]: JsonValue }, index: number): string {
  for (const field of ['pdu_session_id', 'pdn_id', 'ebi', 'bearer_id', 'session_id']) {
    const value = record[field];
    if (typeof value === 'string' || typeof value === 'number') return `${field}:${String(value)}`;
  }
  return `session:${index}`;
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
