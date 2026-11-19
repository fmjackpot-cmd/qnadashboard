// Shared protocol, with the SDK injected so the LAN server needs no packages.
export function createBrokerWithClient({ apiKey, namespace = 'production', RestClient }) {
  if (!apiKey) throw new Error('ABLY_API_KEY is not configured');
  const ably = new RestClient({ key: apiKey, httpRequestTimeout: 8000 });
  const channelName = room => `dashboard:${namespace}:${room}`;
  return {
    async issueToken(room) {
      return {
        channel: channelName(room),
        tokenRequest: await ably.auth.createTokenRequest({ ttl: 60 * 60 * 1000,
          capability: JSON.stringify({ [channelName(room)]: ['subscribe'] }) })
      };
    },
    async publish(room, state) {
      await ably.channels.get(channelName(room)).publish({ name: 'navigate', data: state, id: state.revision });
    }
  };
}
