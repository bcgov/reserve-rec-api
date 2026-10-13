// CDK synth imports this file for `filters`, so nothing from /opt may load at the top level.

// A topic's minTier outside this map ('superadmin') admits superadmins only.
const TIER_RANK = { limited: 1, staff: 2 };

const isSuperAdmin = (permissions) => permissions?.superadmin === 'superadmin';
const staffAddedEnabled = () => process.env.REALTIME_STAFF_ADDED_ENABLED === 'true';

const customerData = (user) => ({
  givenName: user.givenName,
  familyName: user.familyName,
  email: user.email,
  mobilePhone: user.mobilePhone,
  createdAt: user.createdAt,
});

// The earliest completed booking in a park announces the customer there, so a cart completing several
// at once normally sends one `added`; GSI lag can still duplicate it, and the client dedupes.
async function hasEarlierCompletedBooking(booking, deps) {
  const { items } = await deps.runQuery({
    TableName: deps.TRANSACTIONAL_DATA_TABLE_NAME,
    IndexName: deps.USERID_INDEX_NAME,
    KeyConditionExpression: '#userId = :userId',
    FilterExpression: '#schema = :schema AND collectionId = :collectionId AND '
      + '(bookingCompletionTime < :completed OR (bookingCompletionTime = :completed AND bookingId < :bookingId))',
    ExpressionAttributeNames: { '#userId': deps.USERID_PROPERTY_NAME, '#schema': 'schema' },
    ExpressionAttributeValues: {
      ':userId': { S: booking.userId },
      ':schema': { S: 'booking' },
      ':collectionId': { S: booking.collectionId },
      ':completed': { N: String(booking.bookingCompletionTime) },
      ':bookingId': { S: booking.bookingId },
    },
  }, null, null, false);
  return items.length > 0;
}

const customers = {
  source: 'transactional',
  // Staff may subscribe only while staff `added` events are on; until then only superadmins.
  get minTier() { return staffAddedEnabled() ? 'staff' : 'superadmin'; },
  // Event-source filter patterns; booking completions only matter while staff `added` is on.
  filters: ({ staffAddedEnabled }) => [
    { eventName: ['INSERT'], dynamodb: { Keys: { pk: { S: ['user'] } } } },
    ...(staffAddedEnabled ? [{
      eventName: ['MODIFY'],
      dynamodb: { NewImage: { schema: { S: ['booking'] }, bookingCompletionTime: { N: [{ exists: true }] } } },
    }] : []),
  ],

  async resolve(record, deps) {
    const { eventName, dynamodb: change } = record;
    const newImage = change?.NewImage && deps.unmarshall(change.NewImage);
    if (!newImage) return null;

    if (eventName === 'INSERT' && newImage.pk === 'user' && newImage.schema === 'user') {
      return { type: 'created', id: newImage.sk, data: customerData(newImage) };
    }

    if (!staffAddedEnabled()) return null;
    const oldImage = change.OldImage && deps.unmarshall(change.OldImage);
    if (
      eventName !== 'MODIFY'
      || newImage.schema !== 'booking'
      || newImage.bookingCompletionTime == null
      || oldImage?.bookingCompletionTime != null
      || !newImage.userId
      || !newImage.collectionId
      || !newImage.bookingId
    ) {
      return null;
    }
    if (await hasEarlierCompletedBooking(newImage, deps)) return null;

    const user = await deps.getOne('user', newImage.userId, deps.TRANSACTIONAL_DATA_TABLE_NAME);
    if (!user) return null;
    return { type: 'added', id: newImage.userId, collectionId: newImage.collectionId, data: customerData(user) };
  },

  audience(event, permissions) {
    if (event.type === 'created') return isSuperAdmin(permissions);
    if (event.type === 'added' && staffAddedEnabled()) {
      const { effectiveCollectionRole } = require('/opt/base');
      return !isSuperAdmin(permissions)
        && effectiveCollectionRole({ permissions }, event.collectionId) === 'staff';
    }
    return false;
  },
};

const TOPICS = { customers };

function canSubscribe(topic, permissions) {
  if (!Object.hasOwn(TOPICS, topic)) return false;
  if (isSuperAdmin(permissions)) return true;
  const min = TIER_RANK[TOPICS[topic].minTier];
  if (!min) return false;
  return Object.values(permissions ?? {}).some((tier) => (TIER_RANK[tier] ?? 0) >= min);
}

module.exports = { TOPICS, canSubscribe };
