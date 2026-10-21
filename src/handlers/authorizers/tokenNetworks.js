// Counts the distinct client networks (IPv4 /24, IPv6 /64) one token subject
// has used within TOKEN_NETWORK_WINDOW_SECONDS.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { logger } = require('/opt/base');
const { PutItemCommand, QueryCommand, marshall } = require('/opt/dynamodb');

const CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX = 5000;
const cache = new Map();

let client;
const ddb = () => (client ??= new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1' }));

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

function ipv4Octets(addr) {
  const match = addr.match(IPV4);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

const ipv4Network = ([a, b, c]) => `${a}.${b}.${c}.0/24`;

function ipv6Groups(addr) {
  // A dotted IPv4 tail ("::ffff:192.0.2.1") becomes its two hextets.
  const tail = addr.match(/^(.*:)([^:]+\.[^:]+)$/);
  if (tail) {
    const octets = ipv4Octets(tail[2]);
    if (!octets) return null;
    addr = `${tail[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  let groups = head;
  if (halves.length === 2) {
    const rest = halves[1] ? halves[1].split(':') : [];
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill('0'), ...rest];
  }
  if (groups.length !== 8 || !groups.every((g) => HEXTET.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

// "a.b.c.0/24" for IPv4 and IPv4-mapped IPv6, "h:h:h:h::/64" (lowercase,
// no leading zeros) for IPv6, null when unparseable.
function networkOf(ip) {
  if (typeof ip !== 'string') return null;
  const addr = ip.trim().toLowerCase();
  const octets = ipv4Octets(addr);
  if (octets) return ipv4Network(octets);
  if (!addr.includes(':')) return null;

  const groups = ipv6Groups(addr);
  if (!groups) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return ipv4Network([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8]);
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

function settings() {
  return {
    limit: Number(process.env.TOKEN_NETWORK_LIMIT) || 0,
    windowSeconds: Number(process.env.TOKEN_NETWORK_WINDOW_SECONDS) || 0,
    tableName: process.env.TOKEN_NETWORKS_TABLE,
  };
}

async function countNetworks(tableName, sub, since) {
  let count = 0;
  let startKey;
  do {
    const res = await ddb().send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :sub',
      FilterExpression: 'lastSeen >= :since',
      ExpressionAttributeValues: marshall({ ':sub': sub, ':since': since }),
      Select: 'COUNT',
      ExclusiveStartKey: startKey,
    }));
    count += res.Count || 0;
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return count;
}

// Records sub on ip's network at now (ms) and counts its networks in the window;
// answers cached per sub+network. Off, no ip, or a DynamoDB error: { over: false }.
async function checkNetworks({ sub, ip, now = Date.now() }) {
  const { limit, windowSeconds, tableName } = settings();
  if (limit <= 0 || windowSeconds <= 0 || !tableName || !sub) return { over: false };
  const network = networkOf(ip);
  if (!network) {
    logger.info('event=viewer_ip_missing', { sub });
    return { over: false };
  }

  const key = `${sub}|${network}`;
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.result;

  const windowMs = windowSeconds * 1000;
  let result;
  try {
    await ddb().send(new PutItemCommand({
      TableName: tableName,
      Item: marshall({ pk: sub, sk: network, lastSeen: now, expiresAt: Math.floor((now + windowMs) / 1000) }),
    }));
    const networks = await countNetworks(tableName, sub, now - windowMs);
    result = { over: networks > limit, networks };
  } catch (error) {
    logger.warn('Token network check failed; allowing', { sub, error: error?.message });
    return { over: false };
  }

  cache.delete(key);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { result, expires: now + CACHE_TTL_MS });
  return result;
}

module.exports = { checkNetworks, networkOf };
