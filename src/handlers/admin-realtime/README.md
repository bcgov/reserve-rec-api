# Admin realtime feed

An admin-only WebSocket API (`AdminRealtimeStack`) that pushes events to the
admin app. A client connects with its admin access token
(`wss://…/ws?token=…`), subscribes to topics, and receives one JSON message per
event. Connections and subscriptions live in `AdminRealtimeTable`.

Files:

- `authorizer.js`, `connect.js`, `disconnect.js`, `subscribe.js`,
  `unsubscribe.js`, `ping.js`, `default.js`: the WebSocket routes.
- `store.js`: table keys and connection bookkeeping.
- `topics.js`: the topic registry (`TOPICS`, `canSubscribe`).
- `publish.js`: `publish(topic, event)`, which sends one event to a topic's subscribers.
- `publisher.js`: the stream consumer that turns table changes into events.

## Messages

Client to server, routed on `action`:

```json
{ "action": "subscribe", "topic": "customers" }
{ "action": "unsubscribe", "topic": "customers" }
{ "action": "ping" }
```

Replies: `{"type":"subscribed","topic":…}`, `{"type":"unsubscribed","topic":…}`,
`{"type":"pong"}`, `{"type":"error","code":"forbidden"|"unknown_topic"|"bad_request"}`.

Server to client, one per event:

```json
{ "v": 1, "topic": "customers", "type": "created", "id": "<entity id>",
  "at": 1760000000000, "collectionId": "<only when park-scoped>", "data": { } }
```

- `type` is defined by the topic. `type: "changed"` with no `data` means
  "this entity changed, refetch it"; use it when the full record is large or
  when sending it would widen what the subscriber can see.
- `data` is optional. When present it holds only the fields the admin list shows.
- Delivery is at least once. The client deduplicates on `(type, id, collectionId)`
  and ignores types it does not handle.

## Adding a topic

Every topic needs an entry in `TOPICS` in `topics.js` with:

- `source`: the stream it reads, a key of `STREAM_SOURCES` in
  `lib/admin-realtime-stack/admin-realtime-stack.js`, or `null` if it is only sent through `publish()`.
- `minTier`: the lowest admin tier that may subscribe: `'limited'`, `'staff'`, or
  `'superadmin'` (superadmins only). Superadmins always may. Use a getter when it
  depends on a flag, as `customers` does; the authorizer refuses a caller who may
  subscribe to no topic.
- `audience(event, permissions)`: whether one connection receives this event.

### From the transactional table stream

Set `source: 'transactional'` and add:

- `filters(options)`: returns Lambda event-source filter patterns. Filter
  narrowly; every match invokes the publisher.
- `resolve(record, deps)`: turns a stream record into
  `{ type, id, collectionId?, data? }`, or `null` for no event. `deps` is the
  `/opt/dynamodb` module.

The stack collects every topic's filters onto the publisher's event source, so
this needs no stack change unless `resolve` reads a table or index the publisher
cannot read yet.

Do not load anything from `/opt` at the top of `topics.js`; CDK synth imports
it to read `filters`.

### From any Lambda

Set `source: null` and no `filters`, then call `publish()` where the change happens:

```js
const { publish } = require('../admin-realtime/publish');

await publish('passes', { type: 'changed', id: passId, collectionId });
```

`publish()` returns `{ sent, failed, gone, expired }`. It throws only when it
cannot read the subscription rows, so a caller that must not fail on realtime
errors should catch it.

Grant the function from its stack:

```js
const { grantRealtimePublish } = require('../admin-realtime-stack/admin-realtime-stack');

grantRealtimePublish(fn);
```

It reads AdminRealtimeStack's values from SSM by path, so it imports no
CloudFormation export and works from stacks built before that one. The calling
stack needs `dep(<yourStack>, adminRealtimeStack)` in `bin/app.js`, so the SSM
parameters exist before its first deploy. It adds
`execute-api:ManageConnections` on the stage, Query, BatchGetItem and
DeleteItem on `AdminRealtimeTable`, and sets `ADMIN_REALTIME_TABLE_NAME` and
`WEBSOCKET_MANAGEMENT_ENDPOINT`. Add the base and awsUtils layers yourself.
Inside AdminRealtimeStack use the method `this.grantRealtimePublish(fn)`
instead; that stack cannot read its own SSM parameters on first deploy.

### From a new source table

1. Add an entry to `STREAM_SOURCES` in
   `lib/admin-realtime-stack/admin-realtime-stack.js`:
   - `table(scope, stack)`: `{ tableName, tableArn, tableStreamArn }`, read
     through SSM by a resolver the owning stack binds (see
     `resolveTransDataTableNameFromSsm` in the transactional data stack). Call
     each resolver once; each call adds a construct.
   - `wire(fn, table, scope)`: the environment and read grants the topics'
     `resolve` needs. Take index names and the like from the owning stack, not
     literals.
2. Add topics that use the new key as their `source`.

The stack then gives the publisher an event source on that stream, with the
same retry, bisect and failure queue settings. It also adds the table to the
publisher's `REALTIME_SOURCES` (a JSON map of table name to source name). The
publisher reads each record's table from `eventSourceARN` and resolves only
that source's topics; a record from a table not in the map is skipped with a
warning. Synth fails if a topic uses a source with no `STREAM_SOURCES` entry.

### Cross-stack values

Read through SSM (`AWS::SSM::Parameter::Value` parameters): the transactional
table name, ARN and stream ARN, the reference table name and ARN, the admin user
pool and client ids, and the layer ARNs. The only `Fn::ImportValue`s are the
NoOp provider ARNs of the Core, AdminIdentity, ReferenceData and
TransactionalData stacks, which `resolveReference` adds as redeploy triggers.

DynamoDB Streams recommends at most two Lambda consumers per stream; beyond
that, reads are throttled. The transactional table stream already has two (the
OpenSearch sync and this publisher), so another topic on that table goes
through the existing publisher, not a new consumer.

## Audience rules

- An event is never sent to someone who could not read the same data through
  the matching admin REST endpoint. Check that endpoint's tier rule before
  writing `audience`.
- Superadmin: `permissions.superadmin === 'superadmin'`.
- Per park: use `effectiveCollectionRole({ permissions }, event.collectionId)`
  from `/opt/base`, and set `collectionId` on the event.
- `canSubscribe` uses `minTier`; `audience` decides per event. A connection
  whose token has expired cannot subscribe, receives nothing and is closed.
- Never turn on data-trace, execution or access logging on the `ws` stage: the
  token is in the `$connect` query string. A stack test enforces this.
- `WEBSOCKET_URL` on `config/admin` is written by a custom resource whose role
  may update only that attribute on `config` items. Write `config/admin` by
  hand with update-item only; a full put-item drops the URL until the next
  stack change.

## Staff events flag

`REALTIME_STAFF_ADDED_ENABLED` (stack config `realtimeStaffAddedEnabled`,
default `'false'`) turns on the park-scoped `added` events of the `customers`
topic. While it is off, staff cannot subscribe to `customers`, booking
completions are not read, and superadmins receive `created` only. Other topics
do not read it.

## Admin client

The admin app subscribes with `RealtimeService.topic$('<name>')`, which opens
the socket while at least one topic has subscribers. Handle the new topic's
types there and ignore the rest.

## Testing

- Unit tests for a topic: `test/admin-realtime/topics.test.js` (filters,
  `resolve`, `audience`, `canSubscribe`).
- `publish()`: `test/admin-realtime/publish.test.js`.
- End to end: `test/admin-realtime/seams.test.js` runs authorizer, connect,
  subscribe, publisher and disconnect against an in-memory DynamoDB and a fake
  management API. Add a case for each new topic there.
