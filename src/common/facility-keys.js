// Booking facility keys: `<collectionId>::<facilityType>::<facilityId>`.
// Kept free of /opt imports so the backfill script under src/scripts can use the same rule.

const FACILITY_PK = /^facility::([^:]+)$/;

// A link counts only if pk1 is `facility::<c>`; `<c>` comes from pk1 because a linked
// facility can sit in another collection than the activity. Other links come back as `skipped`.
function facilityKeysFromLinks(links = []) {
  const keys = [];
  const skipped = [];
  for (const link of links) {
    const collectionId = FACILITY_PK.exec(link?.pk1 || "")?.[1];
    if (collectionId && link.sk1) {
      keys.push(`${collectionId}::${link.sk1}`);
    } else {
      skipped.push(link);
    }
  }
  return { keys: [...new Set(keys)], skipped };
}

module.exports = { facilityKeysFromLinks };
