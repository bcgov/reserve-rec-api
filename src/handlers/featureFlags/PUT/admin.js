const { Exception, logger, sendResponse, validateSuperAdminAuth, writeAuditLog, getNowISO } = require('/opt/base');
const { getOne, putItem, marshall, batchWriteData, REFERENCE_DATA_TABLE_NAME, AUDIT_TABLE_NAME } = require('/opt/dynamodb');

exports.handler = async (event, context) => {
  logger.info('Update Feature Flags', event);
  
  // Handle CORS preflight
  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {
    // Enforce superadmin authorization
    const claims = validateSuperAdminAuth(event, 'update feature flags');
    
    const body = JSON.parse(event?.body);
    if (!body || !body.flags) {
      throw new Exception('Request body with flags is required', { code: 400 });
    }

    // Validate flag values are all booleans
    for (const [key, value] of Object.entries(body.flags)) {
      if (typeof value !== 'boolean') {
        throw new Exception(`Flag "${key}" must be a boolean value`, { code: 400 });
      }
    }

    // Get current flags for audit log
    const currentConfig = await getOne('config', 'featureFlags', REFERENCE_DATA_TABLE_NAME);
    const previousFlags = currentConfig?.flags || {};

    // Build updated record
    const timestamp = getNowISO();
    const updatedConfig = {
      pk: 'config',
      sk: 'featureFlags',
      flags: body.flags,
      metadata: {
        lastUpdated: timestamp,
        updatedBy: claims.sub,
        updatedByEmail: claims.email || 'unknown'
      },
      version: (currentConfig?.version || 0) + 1
    };

    // Save to DynamoDB
    await putItem(updatedConfig, REFERENCE_DATA_TABLE_NAME);

    // Write audit log
    await writeAuditLog(
      claims.sub,
      'featureFlags',
      'FEATURE_FLAGS_UPDATE',
      {
        previousFlags,
        newFlags: body.flags,
        changedBy: claims.email || claims.sub,
        timestamp
      },
      marshall,
      batchWriteData,
      AUDIT_TABLE_NAME
    );

    logger.info('Feature flags updated successfully', { updatedBy: claims.sub, newFlags: body.flags });

    return sendResponse(200, {
      flags: updatedConfig.flags,
      metadata: updatedConfig.metadata,
      version: updatedConfig.version
    }, 'Feature flags updated successfully', null, context);

  } catch (error) {
    logger.error('Error updating feature flags', error);
    return sendResponse(
      Number(error?.code) || 400,
      null,
      error?.message || 'Error updating feature flags',
      error?.error || error,
      context
    );
  }
};
