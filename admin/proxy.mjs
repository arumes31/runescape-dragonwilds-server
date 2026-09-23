import { BlockList, isIP } from 'node:net';

function normalize(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) throw new Error('Invalid IP address');
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}
export function trustedProxyMatcher(entries = []) {
  if (!Array.isArray(entries)) throw new Error('Trusted proxies must be a list of IP addresses or CIDRs');
  const list = new BlockList();
  for (const entry of entries) {
    if (typeof entry !== 'string') throw new Error('Invalid trusted proxy');
    const parts = entry.split('/');
    if (parts.length > 2) throw new Error('Invalid trusted proxy CIDR');
    const address = normalize(parts[0]);
    const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
    if (parts.length === 1) list.addAddress(address, family);
    else {
      const prefix = Number(parts[1]);
      if (!/^[0-9]+$/.test(parts[1]) || prefix < 1 || prefix > (family === 'ipv4' ? 32 : 128)) throw new Error('Invalid trusted proxy prefix; trusting every address is forbidden');
      list.addSubnet(address, prefix, family);
    }
  }
  return address => {
    const normalized = normalize(address);
    return list.check(normalized, isIP(normalized) === 4 ? 'ipv4' : 'ipv6');
  };
}
export function clientAddress(request, trusted) {
  const peer = normalize(request.socket.remoteAddress);
  if (!trusted(peer)) return peer;
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded === undefined) return peer;
  try {
    if (typeof forwarded !== 'string' || forwarded.length > 4096) throw new Error('Invalid forwarding header');
    const hops = forwarded.split(',');
    if (!hops.length || hops.length > 32) throw new Error('Invalid forwarding chain');
    // Validate the entire header, then walk from the nearest trusted hop outward.
    const chain = hops.map(hop => normalize(hop.trim()));
    let address = peer;
    for (let i = chain.length - 1; i >= 0 && trusted(address); i--) address = chain[i];
    return address;
  } catch {
    const error = new Error('Invalid X-Forwarded-For header'); error.statusCode = 400; throw error;
  }
}
