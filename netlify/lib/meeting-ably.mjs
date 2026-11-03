import { Rest } from 'ably';

// Only this server-side adapter receives the long-lived Ably secret.
export function createBroker({ apiKey, namespace = 'production', RestClient = Rest }) {
  if (!apiKey) throw new Error('ABLY_API_KEY is not configured');
  const ably = new RestClient({ key: apiKey, httpRequestTimeout: 8000 });
  const channelName = room => `dashboard:${namespace}:${room}`;
  return {
    async issueToken(room) {
      return {
        channel: channelName(room),
        tokenRequest: await ably.auth.createTokenRequest({
          ttl: 60 * 60 * 1000,
          capability: JSON.stringify({ [channelName(room)]: ['subscribe'] })
        })
      };
    },
    async publish(room, state) {
      await ably.channels.get(channelName(room)).publish({ name: 'navigate', data: state, id: state.revision });
    }
  };
}
