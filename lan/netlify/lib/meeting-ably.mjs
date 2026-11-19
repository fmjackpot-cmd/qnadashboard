import { Rest } from 'ably';
import { createBrokerWithClient } from './meeting-broker.mjs';

// Only this server-side adapter receives the long-lived Ably secret.
export function createBroker({ RestClient = Rest, ...options }) {
  return createBrokerWithClient({ ...options, RestClient });
}
